// backend/routes/motoristas-internos.js
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { Pool } from 'pg';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// uploads/motoristas_internos
const UPLOADS_BASE_DIR = path.join(__dirname, '..', 'uploads');
const UPLOADS_SUBDIR = 'motoristas_internos';
const UPLOADS_DIR = path.join(UPLOADS_BASE_DIR, UPLOADS_SUBDIR);

fs.mkdirSync(UPLOADS_DIR, { recursive: true });

function safeFilename(originalName = 'arquivo') {
  const base = String(originalName).replace(/[^\w.\-]+/g, '_');
  const ts = Date.now();
  const rand = Math.floor(Math.random() * 1e9);
  return `${ts}-${rand}-${base}`;
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOADS_DIR),
  filename: (req, file, cb) => cb(null, safeFilename(file.originalname))
});

const upload = multer({
  storage,
  limits: { fileSize: 30 * 1024 * 1024 } // 30MB por arquivo
});

// ======================
// Banco (PG) - Pool ÚNICO
// ======================
// IMPORTANTe: alguns ambientes exigem SSL (pg_hba.conf com hostssl).
// Esta lógica ativa SSL automaticamente quando necessário.
function shouldUseSSL() {
  const pgssl = String(process.env.PGSSL || '').toLowerCase();
  const dbssl = String(process.env.DATABASE_SSL || '').toLowerCase();
  const mode = String(process.env.PGSSLMODE || '').toLowerCase();
  const cs = String(process.env.DATABASE_URL || '');

  if (pgssl === 'true' || pgssl === '1') return true;
  if (dbssl === 'true' || dbssl === '1') return true;
  if (['require', 'verify-ca', 'verify-full'].includes(mode)) return true;
  if (cs.toLowerCase().includes('sslmode=require')) return true;

  // Se for host remoto (inclui IP privado), preferimos SSL por padrão
  const host = String(process.env.PGHOST || '');
  if (host && host !== 'localhost' && host !== '127.0.0.1') return true;

  return false;
}

const useSSL = shouldUseSSL();
const sslConfig = useSSL ? { rejectUnauthorized: false } : undefined;

// Preferir DATABASE_URL quando existir (evita divergência de host/usuário entre rotas)
const pool = process.env.DATABASE_URL
  ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: sslConfig })
  : new Pool({
    host: process.env.PGHOST || undefined,
    port: process.env.PGPORT ? Number(process.env.PGPORT) : undefined,
    user: process.env.PGUSER || undefined,
    password: process.env.PGPASSWORD || undefined,
    database: process.env.PGDATABASE || undefined,
    ssl: sslConfig
  });

function getTenantId(req) {
  return (
    req.user?.tenant_id ??
    req.tenant_id ??
    req.tenant?.tenant_id ??
    req.tenant?.id ??
    null
  );
}

function asUrl(relPath) {
  if (!relPath) return null;
  const clean = String(relPath).replace(/^\/+/, '');
  return clean.startsWith('uploads/') ? `/${clean}` : `/uploads/${clean}`;
}

function normalizeStatus(v) {
  const s = String(v || '').toLowerCase();
  return (s === 'inativo' || s === 'ativo') ? s : 'ativo';
}

/**
 * GET /api/interno/motoristas
 * Query: q, status, page, limit
 *
 * IMPORTANTE:
 * - Esta listagem já retorna `arquivo_cnh_url` (último doc tipo 'cnh'),
 *   para o frontend conseguir renderizar o botão "Ver" sem precisar chamar /:id.
 */
router.get('/', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id ausente' });

  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim().toLowerCase();
  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 200);
  const offset = (page - 1) * limit;

  const where = ['m.tenant_id = $1'];
  const params = [tenantId];

  if (status === 'ativo' || status === 'inativo') {
    params.push(status);
    where.push(`m.status = $${params.length}`);
  }

  if (q) {
    params.push(`%${q}%`);
    const p = params.length;
    where.push(`(
      m.nome ILIKE $${p}
      OR m.cpf ILIKE $${p}
      OR m.telefone ILIKE $${p}
      OR m.email ILIKE $${p}
    )`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const totalR = await pool.query(
      `SELECT COUNT(*)::int AS total
         FROM motoristas_internos m
         ${whereSql}`,
      params
    );

    // LATERAL: pega o doc CNH mais recente para cada motorista
    const rowsR = await pool.query(
      `SELECT
          m.id, m.tenant_id,
          m.nome, m.cpf, m.rg, m.data_nascimento,
          m.telefone, m.email,
          m.endereco, m.bairro, m.cidade, m.uf, m.cep,
          m.numero_cnh, m.categoria_cnh, m.validade_cnh, m.orgao_emissor_cnh,
          m.status,
          m.created_at, m.updated_at,
          d.caminho_arquivo AS arquivo_cnh_path
       FROM motoristas_internos m
       LEFT JOIN LATERAL (
          SELECT caminho_arquivo
            FROM motoristas_internos_documentos
           WHERE tenant_id = m.tenant_id
             AND motorista_interno_id = m.id
             AND tipo = 'cnh'
           ORDER BY created_at DESC, id DESC
           LIMIT 1
       ) d ON TRUE
       ${whereSql}
       ORDER BY m.nome ASC, m.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const out = (rowsR.rows || []).map(r => {
      const { arquivo_cnh_path, ...rest } = r;
      return { ...rest, arquivo_cnh_url: asUrl(arquivo_cnh_path) };
    });

    res.set('X-Total-Count', String(totalR.rows[0]?.total ?? 0));
    res.set('X-Page', String(page));
    res.set('X-Limit', String(limit));
    return res.json(out);
  } catch (e) {
    console.error('GET motoristas internos erro:', e);
    return res.status(500).json({ error: 'Erro ao listar motoristas internos' });
  }
});

/**
 * GET /api/interno/motoristas/:id
 * Retorna o motorista + lista de documentos + URLs prontas (arquivo_cnh_url, etc.)
 */
router.get('/:id', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id ausente' });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });

  try {
    const r = await pool.query(
      `SELECT *
         FROM motoristas_internos
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );

    if (!r.rows.length) return res.status(404).json({ error: 'Motorista interno não encontrado' });

    const docs = await pool.query(
      `SELECT id, tipo, nome_original, mime_type, tamanho_bytes, caminho_arquivo, created_at
         FROM motoristas_internos_documentos
        WHERE tenant_id = $1 AND motorista_interno_id = $2
        ORDER BY created_at DESC, id DESC`,
      [tenantId, id]
    );

    const motorista = r.rows[0];
    motorista.documentos = (docs.rows || []).map(d => ({
      ...d,
      arquivo_url: asUrl(d.caminho_arquivo)
    }));

    const cnh = motorista.documentos.find(d => d.tipo === 'cnh');
    const comprovante = motorista.documentos.find(d => d.tipo === 'comprovante');
    const outro = motorista.documentos.find(d => d.tipo === 'outro');

    motorista.arquivo_cnh_url = cnh ? cnh.arquivo_url : null;
    motorista.arquivo_comprovante_url = comprovante ? comprovante.arquivo_url : null;
    motorista.arquivo_outro_url = outro ? outro.arquivo_url : null;

    return res.json(motorista);
  } catch (e) {
    console.error('GET motorista interno erro:', e);
    return res.status(500).json({ error: 'Erro ao buscar motorista interno' });
  }
});

/**
 * POST /api/interno/motoristas
 * multipart/form-data:
 * - dados: JSON string
 * - arquivo_cnh, arquivo_comprovante, arquivo_outro: files (opcionais)
 *
 * Compat:
 * - se ainda vier `arquivo_crlv`, salvamos como tipo 'outro' (para não quebrar).
 */
router.post(
  '/',
  upload.fields([
    { name: 'arquivo_cnh', maxCount: 1 },
    { name: 'arquivo_comprovante', maxCount: 1 },
    { name: 'arquivo_crlv', maxCount: 1 }, // compat
    { name: 'arquivo_outro', maxCount: 5 }
  ]),
  async (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id ausente' });

    let dados = {};
    try {
      dados = req.body?.dados ? JSON.parse(req.body.dados) : {};
    } catch (e) {
      return res.status(400).json({ error: 'Campo "dados" inválido (JSON)' });
    }

    const nome = String(dados.nome || '').trim();
    const cpf = String(dados.cpf || '').trim();
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!cpf) return res.status(400).json({ error: 'CPF é obrigatório' });

    const status = normalizeStatus(dados.status);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const ins = await client.query(
        `INSERT INTO motoristas_internos (
          tenant_id, nome, cpf, rg, data_nascimento,
          telefone, email, endereco, bairro, cidade, uf, cep,
          numero_cnh, categoria_cnh, validade_cnh, orgao_emissor_cnh,
          status
        ) VALUES (
          $1,$2,$3,$4,$5,
          $6,$7,$8,$9,$10,$11,$12,
          $13,$14,$15,$16,
          $17
        )
        RETURNING id`,
        [
          tenantId, nome, cpf, dados.rg || null, dados.data_nascimento || null,
          dados.telefone || null, dados.email || null, dados.endereco || null, dados.bairro || null, dados.cidade || null, dados.uf || null, dados.cep || null,
          dados.numero_cnh || null, dados.categoria_cnh || null, dados.validade_cnh || null, dados.orgao_emissor_cnh || null,
          status
        ]
      );

      const motoristaId = ins.rows[0].id;

      const files = req.files || {};
      const fileMappings = [
        { key: 'arquivo_cnh', tipo: 'cnh' },
        { key: 'arquivo_comprovante', tipo: 'comprovante' }
      ];

      for (const m of fileMappings) {
        const f = files[m.key]?.[0];
        if (!f) continue;
        const rel = path.join(UPLOADS_SUBDIR, path.basename(f.filename));
        await client.query(
          `INSERT INTO motoristas_internos_documentos
            (tenant_id, motorista_interno_id, tipo, nome_original, mime_type, tamanho_bytes, caminho_arquivo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, motoristaId, m.tipo, f.originalname, f.mimetype, f.size, rel]
        );
      }

      const outros = files['arquivo_outro'] || [];
      const crlvAsOutro = files['arquivo_crlv'] || []; // compat
      for (const f of [...outros, ...crlvAsOutro]) {
        const rel = path.join(UPLOADS_SUBDIR, path.basename(f.filename));
        await client.query(
          `INSERT INTO motoristas_internos_documentos
            (tenant_id, motorista_interno_id, tipo, nome_original, mime_type, tamanho_bytes, caminho_arquivo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, motoristaId, 'outro', f.originalname, f.mimetype, f.size, rel]
        );
      }

      await client.query('COMMIT');
      return res.status(201).json({ id: motoristaId });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('POST motorista interno erro:', e);
      if (String(e?.code || '') === '23505') {
        return res.status(409).json({ error: 'Já existe motorista interno com esse CPF' });
      }
      return res.status(500).json({ error: 'Erro ao criar motorista interno' });
    } finally {
      client.release();
    }
  }
);

/**
 * PUT /api/interno/motoristas/:id
 * multipart/form-data:
 * - dados: JSON string
 * - arquivos opcionais (mesma lógica do POST)
 */
router.put(
  '/:id',
  upload.fields([
    { name: 'arquivo_cnh', maxCount: 1 },
    { name: 'arquivo_comprovante', maxCount: 1 },
    { name: 'arquivo_crlv', maxCount: 1 }, // compat
    { name: 'arquivo_outro', maxCount: 5 }
  ]),
  async (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id ausente' });

    const id = Number(req.params.id);
    if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });

    let dados = {};
    try {
      dados = req.body?.dados ? JSON.parse(req.body.dados) : {};
    } catch (e) {
      return res.status(400).json({ error: 'Campo "dados" inválido (JSON)' });
    }

    const nome = String(dados.nome || '').trim();
    const cpf = String(dados.cpf || '').trim();
    if (!nome) return res.status(400).json({ error: 'Nome é obrigatório' });
    if (!cpf) return res.status(400).json({ error: 'CPF é obrigatório' });

    const status = normalizeStatus(dados.status);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const exists = await client.query(
        `SELECT id FROM motoristas_internos WHERE tenant_id = $1 AND id = $2`,
        [tenantId, id]
      );
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Motorista interno não encontrado' });
      }

      await client.query(
        `UPDATE motoristas_internos SET
          nome=$3, cpf=$4, rg=$5, data_nascimento=$6,
          telefone=$7, email=$8, endereco=$9, bairro=$10, cidade=$11, uf=$12, cep=$13,
          numero_cnh=$14, categoria_cnh=$15, validade_cnh=$16, orgao_emissor_cnh=$17,
          status=$18,
          updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
        [
          tenantId, id,
          nome, cpf, dados.rg || null, dados.data_nascimento || null,
          dados.telefone || null, dados.email || null, dados.endereco || null, dados.bairro || null, dados.cidade || null, dados.uf || null, dados.cep || null,
          dados.numero_cnh || null, dados.categoria_cnh || null, dados.validade_cnh || null, dados.orgao_emissor_cnh || null,
          status
        ]
      );

      const files = req.files || {};
      const fileMappings = [
        { key: 'arquivo_cnh', tipo: 'cnh' },
        { key: 'arquivo_comprovante', tipo: 'comprovante' }
      ];

      // substitui doc cnh/comprovante quando enviar um novo
      for (const m of fileMappings) {
        const f = files[m.key]?.[0];
        if (!f) continue;

        await client.query(
          `DELETE FROM motoristas_internos_documentos
            WHERE tenant_id=$1 AND motorista_interno_id=$2 AND tipo=$3`,
          [tenantId, id, m.tipo]
        );

        const rel = path.join(UPLOADS_SUBDIR, path.basename(f.filename));
        await client.query(
          `INSERT INTO motoristas_internos_documentos
            (tenant_id, motorista_interno_id, tipo, nome_original, mime_type, tamanho_bytes, caminho_arquivo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, id, m.tipo, f.originalname, f.mimetype, f.size, rel]
        );
      }

      const outros = files['arquivo_outro'] || [];
      const crlvAsOutro = files['arquivo_crlv'] || []; // compat
      for (const f of [...outros, ...crlvAsOutro]) {
        const rel = path.join(UPLOADS_SUBDIR, path.basename(f.filename));
        await client.query(
          `INSERT INTO motoristas_internos_documentos
            (tenant_id, motorista_interno_id, tipo, nome_original, mime_type, tamanho_bytes, caminho_arquivo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, id, 'outro', f.originalname, f.mimetype, f.size, rel]
        );
      }

      await client.query('COMMIT');
      return res.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('PUT motorista interno erro:', e);
      if (String(e?.code || '') === '23505') {
        return res.status(409).json({ error: 'Já existe motorista interno com esse CPF' });
      }
      return res.status(500).json({ error: 'Erro ao atualizar motorista interno' });
    } finally {
      client.release();
    }
  }
);

/**
 * PATCH /api/interno/motoristas/:id/status
 */
router.patch('/:id/status', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id ausente' });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });

  const status = normalizeStatus(req.body?.status);

  try {
    const r = await pool.query(
      `UPDATE motoristas_internos
          SET status = $3, updated_at = now()
        WHERE tenant_id = $1 AND id = $2
      RETURNING id`,
      [tenantId, id, status]
    );

    if (!r.rows.length) return res.status(404).json({ error: 'Motorista interno não encontrado' });

    return res.json({ success: true });
  } catch (e) {
    console.error('PATCH status motorista interno erro:', e);
    return res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

/**
 * DELETE /api/interno/motoristas/:id
 * Remove registros e tenta remover arquivos do disco (best-effort)
 */
router.delete('/:id', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id ausente' });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });

  const client = await pool.connect();
  try {
    await client.query('BEGIN');

    const docs = await client.query(
      `SELECT caminho_arquivo
         FROM motoristas_internos_documentos
        WHERE tenant_id = $1 AND motorista_interno_id = $2`,
      [tenantId, id]
    );

    await client.query(
      `DELETE FROM motoristas_internos_documentos
        WHERE tenant_id = $1 AND motorista_interno_id = $2`,
      [tenantId, id]
    );

    const del = await client.query(
      `DELETE FROM motoristas_internos
        WHERE tenant_id = $1 AND id = $2
      RETURNING id`,
      [tenantId, id]
    );

    if (!del.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Motorista interno não encontrado' });
    }

    await client.query('COMMIT');

    // best-effort: remover arquivos do disco
    for (const d of docs.rows || []) {
      try {
        const rel = String(d.caminho_arquivo || '');
        const full = path.join(UPLOADS_BASE_DIR, rel);
        if (full.startsWith(UPLOADS_BASE_DIR) && fs.existsSync(full)) {
          fs.unlinkSync(full);
        }
      } catch (_) { }
    }

    return res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('DELETE motorista interno erro:', e);
    return res.status(500).json({ error: 'Erro ao excluir motorista interno' });
  } finally {
    client.release();
  }
});

export default router;
