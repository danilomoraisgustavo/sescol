// backend/routes/veiculos-internos.js
import { Router } from 'express';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import multer from 'multer';
import { Pool } from 'pg';

const router = Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// uploads/veiculos_internos
const UPLOADS_BASE_DIR = path.join(__dirname, '..', 'uploads');
const UPLOADS_SUBDIR = 'veiculos_internos';
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
function shouldUseSSL() {
  const pgssl = String(process.env.PGSSL || '').toLowerCase();
  const dbssl = String(process.env.DATABASE_SSL || '').toLowerCase();
  const mode = String(process.env.PGSSLMODE || '').toLowerCase();
  const cs = String(process.env.DATABASE_URL || '');

  if (pgssl === 'true' || pgssl === '1') return true;
  if (dbssl === 'true' || dbssl === '1') return true;
  if (['require', 'verify-ca', 'verify-full'].includes(mode)) return true;
  if (cs.toLowerCase().includes('sslmode=require')) return true;

  const host = String(process.env.PGHOST || '');
  if (host && host !== 'localhost' && host !== '127.0.0.1') return true;

  return false;
}

const useSSL = shouldUseSSL();
const sslConfig = useSSL ? { rejectUnauthorized: false } : undefined;

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
 * GET /api/interno/veiculos
 * Query: q, status, tipo, page, limit
 * Retorna `arquivo_crlv_url` (doc CRLV mais recente) na listagem.
 */
router.get('/', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id ausente' });

  const q = String(req.query.q || '').trim();
  const status = String(req.query.status || '').trim().toLowerCase();
  const tipo = String(req.query.tipo || '').trim();
  const page = Math.max(parseInt(req.query.page || '1', 10) || 1, 1);
  const limit = Math.min(Math.max(parseInt(req.query.limit || '20', 10) || 20, 1), 200);
  const offset = (page - 1) * limit;

  const where = ['v.tenant_id = $1'];
  const params = [tenantId];

  if (status === 'ativo' || status === 'inativo') {
    params.push(status);
    where.push(`v.status = $${params.length}`);
  }

  if (tipo) {
    params.push(tipo);
    where.push(`v.tipo = $${params.length}`);
  }

  if (q) {
    params.push(`%${q}%`);
    const p = params.length;
    where.push(`(
      v.placa ILIKE $${p}
      OR v.marca ILIKE $${p}
      OR v.modelo ILIKE $${p}
      OR v.renavam ILIKE $${p}
      OR v.chassi ILIKE $${p}
    )`);
  }

  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  try {
    const totalR = await pool.query(
      `SELECT COUNT(*)::int AS total
         FROM veiculos_internos v
         ${whereSql}`,
      params
    );

    const rowsR = await pool.query(
      `SELECT
          v.id, v.tenant_id,
          v.placa, v.renavam, v.chassi,
          v.tipo, v.marca, v.modelo,
          v.ano_fabricacao, v.ano_modelo, v.cor,
          v.capacidade, v.combustivel,
          v.status, v.observacoes,
          v.created_at, v.updated_at,
          d.caminho_arquivo AS arquivo_crlv_path
       FROM veiculos_internos v
       LEFT JOIN LATERAL (
          SELECT caminho_arquivo
            FROM veiculos_internos_documentos
           WHERE tenant_id = v.tenant_id
             AND veiculo_interno_id = v.id
             AND tipo = 'crlv'
           ORDER BY created_at DESC, id DESC
           LIMIT 1
       ) d ON TRUE
       ${whereSql}
       ORDER BY v.placa ASC, v.id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset]
    );

    const out = (rowsR.rows || []).map(r => {
      const { arquivo_crlv_path, ...rest } = r;
      return { ...rest, arquivo_crlv_url: asUrl(arquivo_crlv_path) };
    });

    res.set('X-Total-Count', String(totalR.rows[0]?.total ?? 0));
    res.set('X-Page', String(page));
    res.set('X-Limit', String(limit));
    return res.json(out);
  } catch (e) {
    console.error('GET veiculos internos erro:', e);
    return res.status(500).json({ error: 'Erro ao listar veículos internos' });
  }
});

/**
 * GET /api/interno/veiculos/:id
 * Retorna veículo + documentos (com URLs prontas)
 */
router.get('/:id', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id ausente' });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });

  try {
    const r = await pool.query(
      `SELECT *
         FROM veiculos_internos
        WHERE tenant_id = $1 AND id = $2`,
      [tenantId, id]
    );

    if (!r.rows.length) return res.status(404).json({ error: 'Veículo interno não encontrado' });

    const docs = await pool.query(
      `SELECT id, tipo, nome_original, mime_type, tamanho_bytes, caminho_arquivo, created_at
         FROM veiculos_internos_documentos
        WHERE tenant_id = $1 AND veiculo_interno_id = $2
        ORDER BY created_at DESC, id DESC`,
      [tenantId, id]
    );

    const veiculo = r.rows[0];
    veiculo.documentos = (docs.rows || []).map(d => ({
      ...d,
      arquivo_url: asUrl(d.caminho_arquivo)
    }));

    const crlv = veiculo.documentos.find(d => d.tipo === 'crlv');
    veiculo.arquivo_crlv_url = crlv ? crlv.arquivo_url : null;

    return res.json(veiculo);
  } catch (e) {
    console.error('GET veiculo interno erro:', e);
    return res.status(500).json({ error: 'Erro ao buscar veículo interno' });
  }
});

/**
 * POST /api/interno/veiculos
 * multipart/form-data:
 * - dados: JSON string
 * - arquivo_crlv (1), arquivo_foto (até 5), arquivo_outro (até 5)
 */
router.post(
  '/',
  upload.fields([
    { name: 'arquivo_crlv', maxCount: 1 },
    { name: 'arquivo_foto', maxCount: 5 },
    { name: 'arquivo_outro', maxCount: 5 }
  ]),
  async (req, res) => {
    const tenantId = getTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'tenant_id ausente' });

    let dados = {};
    try {
      dados = req.body?.dados ? JSON.parse(req.body.dados) : {};
    } catch {
      return res.status(400).json({ error: 'Campo "dados" inválido (JSON)' });
    }

    const placa = String(dados.placa || '').trim().toUpperCase();
    if (!placa) return res.status(400).json({ error: 'Placa é obrigatória' });

    const status = normalizeStatus(dados.status);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const ins = await client.query(
        `INSERT INTO veiculos_internos (
          tenant_id, placa, renavam, chassi,
          tipo, marca, modelo,
          ano_fabricacao, ano_modelo, cor,
          capacidade, combustivel,
          status, observacoes
        ) VALUES (
          $1,$2,$3,$4,
          $5,$6,$7,
          $8,$9,$10,
          $11,$12,
          $13,$14
        )
        RETURNING id`,
        [
          tenantId,
          placa,
          dados.renavam || null,
          dados.chassi || null,
          dados.tipo || null,
          dados.marca || null,
          dados.modelo || null,
          dados.ano_fabricacao || null,
          dados.ano_modelo || null,
          dados.cor || null,
          (dados.capacidade !== undefined && dados.capacidade !== null && String(dados.capacidade).trim() !== '') ? Number(dados.capacidade) : null,
          dados.combustivel || null,
          status,
          dados.observacoes || null
        ]
      );

      const veiculoId = ins.rows[0].id;
      const files = req.files || {};

      const crlv = files['arquivo_crlv']?.[0];
      if (crlv) {
        const rel = path.join(UPLOADS_SUBDIR, path.basename(crlv.filename));
        await client.query(
          `INSERT INTO veiculos_internos_documentos
            (tenant_id, veiculo_interno_id, tipo, nome_original, mime_type, tamanho_bytes, caminho_arquivo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, veiculoId, 'crlv', crlv.originalname, crlv.mimetype, crlv.size, rel]
        );
      }

      const fotos = files['arquivo_foto'] || [];
      for (const f of fotos) {
        const rel = path.join(UPLOADS_SUBDIR, path.basename(f.filename));
        await client.query(
          `INSERT INTO veiculos_internos_documentos
            (tenant_id, veiculo_interno_id, tipo, nome_original, mime_type, tamanho_bytes, caminho_arquivo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, veiculoId, 'foto', f.originalname, f.mimetype, f.size, rel]
        );
      }

      const outros = files['arquivo_outro'] || [];
      for (const f of outros) {
        const rel = path.join(UPLOADS_SUBDIR, path.basename(f.filename));
        await client.query(
          `INSERT INTO veiculos_internos_documentos
            (tenant_id, veiculo_interno_id, tipo, nome_original, mime_type, tamanho_bytes, caminho_arquivo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, veiculoId, 'outro', f.originalname, f.mimetype, f.size, rel]
        );
      }

      await client.query('COMMIT');
      return res.status(201).json({ id: veiculoId });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('POST veiculo interno erro:', e);
      if (String(e?.code || '') == '23505') {
        return res.status(409).json({ error: 'Já existe veículo interno com essa placa' });
      }
      return res.status(500).json({ error: 'Erro ao criar veículo interno' });
    } finally {
      client.release();
    }
  }
);

/**
 * PUT /api/interno/veiculos/:id
 * multipart/form-data:
 * - dados: JSON string
 * - arquivos opcionais (crlv substitui o antigo; foto/outro adiciona)
 */
router.put(
  '/:id',
  upload.fields([
    { name: 'arquivo_crlv', maxCount: 1 },
    { name: 'arquivo_foto', maxCount: 5 },
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
    } catch {
      return res.status(400).json({ error: 'Campo "dados" inválido (JSON)' });
    }

    const placa = String(dados.placa || '').trim().toUpperCase();
    if (!placa) return res.status(400).json({ error: 'Placa é obrigatória' });

    const status = normalizeStatus(dados.status);

    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const exists = await client.query(
        `SELECT id FROM veiculos_internos WHERE tenant_id=$1 AND id=$2`,
        [tenantId, id]
      );
      if (!exists.rows.length) {
        await client.query('ROLLBACK');
        return res.status(404).json({ error: 'Veículo interno não encontrado' });
      }

      await client.query(
        `UPDATE veiculos_internos SET
          placa=$3, renavam=$4, chassi=$5,
          tipo=$6, marca=$7, modelo=$8,
          ano_fabricacao=$9, ano_modelo=$10, cor=$11,
          capacidade=$12, combustivel=$13,
          status=$14, observacoes=$15,
          updated_at=now()
        WHERE tenant_id=$1 AND id=$2`,
        [
          tenantId, id,
          placa,
          dados.renavam || null,
          dados.chassi || null,
          dados.tipo || null,
          dados.marca || null,
          dados.modelo || null,
          dados.ano_fabricacao || null,
          dados.ano_modelo || null,
          dados.cor || null,
          (dados.capacidade !== undefined && dados.capacidade !== null && String(dados.capacidade).trim() !== '') ? Number(dados.capacidade) : null,
          dados.combustivel || null,
          status,
          dados.observacoes || null
        ]
      );

      const files = req.files || {};

      const crlv = files['arquivo_crlv']?.[0];
      if (crlv) {
        await client.query(
          `DELETE FROM veiculos_internos_documentos
            WHERE tenant_id=$1 AND veiculo_interno_id=$2 AND tipo='crlv'`,
          [tenantId, id]
        );
        const rel = path.join(UPLOADS_SUBDIR, path.basename(crlv.filename));
        await client.query(
          `INSERT INTO veiculos_internos_documentos
            (tenant_id, veiculo_interno_id, tipo, nome_original, mime_type, tamanho_bytes, caminho_arquivo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, id, 'crlv', crlv.originalname, crlv.mimetype, crlv.size, rel]
        );
      }

      const fotos = files['arquivo_foto'] || [];
      for (const f of fotos) {
        const rel = path.join(UPLOADS_SUBDIR, path.basename(f.filename));
        await client.query(
          `INSERT INTO veiculos_internos_documentos
            (tenant_id, veiculo_interno_id, tipo, nome_original, mime_type, tamanho_bytes, caminho_arquivo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, id, 'foto', f.originalname, f.mimetype, f.size, rel]
        );
      }

      const outros = files['arquivo_outro'] || [];
      for (const f of outros) {
        const rel = path.join(UPLOADS_SUBDIR, path.basename(f.filename));
        await client.query(
          `INSERT INTO veiculos_internos_documentos
            (tenant_id, veiculo_interno_id, tipo, nome_original, mime_type, tamanho_bytes, caminho_arquivo)
           VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [tenantId, id, 'outro', f.originalname, f.mimetype, f.size, rel]
        );
      }

      await client.query('COMMIT');
      return res.json({ success: true });
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('PUT veiculo interno erro:', e);
      if (String(e?.code || '') == '23505') {
        return res.status(409).json({ error: 'Já existe veículo interno com essa placa' });
      }
      return res.status(500).json({ error: 'Erro ao atualizar veículo interno' });
    } finally {
      client.release();
    }
  }
);

/**
 * PATCH /api/interno/veiculos/:id/status
 */
router.patch('/:id/status', async (req, res) => {
  const tenantId = getTenantId(req);
  if (!tenantId) return res.status(400).json({ error: 'tenant_id ausente' });

  const id = Number(req.params.id);
  if (!Number.isFinite(id)) return res.status(400).json({ error: 'id inválido' });

  const status = normalizeStatus(req.body?.status);

  try {
    const r = await pool.query(
      `UPDATE veiculos_internos
          SET status=$3, updated_at=now()
        WHERE tenant_id=$1 AND id=$2
      RETURNING id`,
      [tenantId, id, status]
    );

    if (!r.rows.length) return res.status(404).json({ error: 'Veículo interno não encontrado' });

    return res.json({ success: true });
  } catch (e) {
    console.error('PATCH status veiculo interno erro:', e);
    return res.status(500).json({ error: 'Erro ao atualizar status' });
  }
});

/**
 * DELETE /api/interno/veiculos/:id
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
         FROM veiculos_internos_documentos
        WHERE tenant_id=$1 AND veiculo_interno_id=$2`,
      [tenantId, id]
    );

    await client.query(
      `DELETE FROM veiculos_internos_documentos
        WHERE tenant_id=$1 AND veiculo_interno_id=$2`,
      [tenantId, id]
    );

    const del = await client.query(
      `DELETE FROM veiculos_internos
        WHERE tenant_id=$1 AND id=$2
      RETURNING id`,
      [tenantId, id]
    );

    if (!del.rows.length) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Veículo interno não encontrado' });
    }

    await client.query('COMMIT');

    for (const d of docs.rows || []) {
      try {
        const rel = String(d.caminho_arquivo || '');
        const full = path.join(UPLOADS_BASE_DIR, rel);
        if (full.startsWith(UPLOADS_BASE_DIR) && fs.existsSync(full)) {
          fs.unlinkSync(full);
        }
      } catch (_) {}
    }

    return res.json({ success: true });
  } catch (e) {
    await client.query('ROLLBACK');
    console.error('DELETE veiculo interno erro:', e);
    return res.status(500).json({ error: 'Erro ao excluir veículo interno' });
  } finally {
    client.release();
  }
});

export default router;
