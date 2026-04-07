// routes/motorista.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../db.js';

// IMPORTANTE: seguranca multi-tenant
import authMiddleware from '../middleware/auth.js';
import tenantMiddleware from '../middleware/tenant.js';

const router = express.Router();

// Protege TODAS as rotas deste modulo
router.use(authMiddleware);
router.use(tenantMiddleware);

function resolveTenantId(req) {
    const fromMiddleware = req.tenantId ?? req.tenant_id;
    if (fromMiddleware != null && String(fromMiddleware).trim() !== '') {
        const n = Number(fromMiddleware);
        return Number.isFinite(n) ? n : null;
    }
    const fromUser = req.user?.tenant_id ?? req.user?.tenantId;
    if (fromUser != null && String(fromUser).trim() !== '') {
        const n = Number(fromUser);
        return Number.isFinite(n) ? n : null;
    }
    return null;
}


// Resolve escopo do fornecedor consultando a tabela usuarios (fonte de verdade).
// Se o usuário for FORNECEDOR_ESCOLAR, força o fornecedor_id do banco e restringe leituras/escritas.
async function resolveEscopoFornecedor(req, res, tenantId) {
    try {
        // Tenta por ID primeiro (preferível)
        const userIdRaw = req?.user?.id ?? req?.user?.user_id ?? req?.auth?.id ?? req?.auth?.user_id ?? null;
        let row = null;

        if (userIdRaw != null && String(userIdRaw).trim() !== '') {
            const userId = Number.parseInt(String(userIdRaw), 10);
            if (Number.isInteger(userId) && userId > 0) {
                const r = await pool.query(
                    'SELECT cargo, fornecedor_id FROM usuarios WHERE tenant_id = $1 AND id = $2',
                    [tenantId, userId]
                );
                row = r.rows?.[0] || null;
            }
        }

        // Fallback por email (unique: tenant_id + email)
        if (!row) {
            const email = (req?.user?.email ?? req?.auth?.email ?? '').toString().trim();
            if (email) {
                const r = await pool.query(
                    'SELECT cargo, fornecedor_id FROM usuarios WHERE tenant_id = $1 AND email = $2',
                    [tenantId, email]
                );
                row = r.rows?.[0] || null;
            }
        }

        // Se não achou usuário, não libera escopo de fornecedor (segurança).
        if (!row) {
            res.status(403).json({ erro: 'Usuário não encontrado para validação de escopo.' });
            return { ok: false };
        }

        const cargoDb = (row.cargo || '').toString().toUpperCase();
        if (cargoDb !== 'FORNECEDOR_ESCOLAR') {
            return { ok: true, fornecedorId: null };
        }

        const fornecedorId = row.fornecedor_id ? Number.parseInt(String(row.fornecedor_id), 10) : null;
        if (!fornecedorId || Number.isNaN(fornecedorId)) {
            res.status(403).json({ erro: 'Usuário FORNECEDOR_ESCOLAR sem fornecedor_id no cadastro.' });
            return { ok: false };
        }

        return { ok: true, fornecedorId };
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: 'Erro ao validar escopo do fornecedor.' });
        return { ok: false };
    }
}

function getUserCargo(req) {
    const cargo = (req?.user?.cargo || req?.user?.role || req?.auth?.cargo || req?.auth?.role || '').toString();
    return cargo ? cargo.toUpperCase() : '';
}

function getUserFornecedorId(req) {
    const raw = (req?.user?.fornecedor_id ?? req?.user?.fornecedorId ?? req?.auth?.fornecedor_id ?? req?.auth?.fornecedorId ?? null);
    const n = Number.parseInt(String(raw ?? ''), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function isFornecedorEscolar(req) {
    return getUserCargo(req) === 'FORNECEDOR_ESCOLAR';
}

function assertFornecedorVinculado(req, res) {
    if (!isFornecedorEscolar(req)) return { ok: true, fornecedorId: null };
    const fornecedorId = getUserFornecedorId(req);
    if (!fornecedorId) {
        res.status(403).json({ erro: 'Usuário FORNECEDOR_ESCOLAR sem vínculo com fornecedor.' });
        return { ok: false };
    }
    return { ok: true, fornecedorId };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===================================================================
// UPLOADS: CNH + CERTIFICADOS DE CURSOS
// ===================================================================

const storageArquivosMotorista = multer.diskStorage({
    destination: (req, file, cb) => {
        let dest;
        if (file.fieldname === 'arquivo_cnh') {
            dest = path.join(__dirname, '..', 'uploads', 'cnh');
        } else {
            dest = path.join(__dirname, '..', 'uploads', 'certificados_motoristas');
        }
        fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.bin';
        if (file.fieldname === 'arquivo_cnh') {
            cb(null, `cnh_${Date.now()}${ext}`);
        } else {
            cb(null, `cert_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
        }
    }
});

const uploadMotorista = multer({ storage: storageArquivosMotorista });

// ===================================================================
// FUNÇÕES AUXILIARES
// ===================================================================

const TIPOS_CURSOS_OBRIGATORIOS = [
    'transporte_escolar',
    'direcao_defensiva',
    'primeiros_socorros',
    'relacoes_humanas'
];

function montarResumoCursos(cursos) {
    if (!Array.isArray(cursos) || !cursos.length) {
        return {
            cursos_resumo: null,
            cursos_obrigatorios_ok: false,
            cursos_pendentes: TIPOS_CURSOS_OBRIGATORIOS.length
        };
    }

    const hoje = new Date();
    const obrigStatus = {};

    TIPOS_CURSOS_OBRIGATORIOS.forEach((t) => {
        obrigStatus[t] = 'pendente'; // pendente, em_dia, vencido
    });

    cursos.forEach((c) => {
        if (!c?.tipo) return;
        if (!TIPOS_CURSOS_OBRIGATORIOS.includes(c.tipo)) return;

        if (!c.validade) {
            obrigStatus[c.tipo] = 'em_dia';
            return;
        }

        const val = new Date(c.validade);
        obrigStatus[c.tipo] = (val >= hoje) ? 'em_dia' : 'vencido';
    });

    let pendentes = 0;
    let vencidos = 0;
    Object.values(obrigStatus).forEach((st) => {
        if (st === 'pendente') pendentes++;
        if (st === 'vencido') vencidos++;
    });

    const cursosPendentes = pendentes + vencidos;
    const cursosOk = cursosPendentes === 0;

    const resumo = cursosOk
        ? 'Todos os cursos obrigatórios em dia'
        : `${cursosPendentes} curso(s) obrigatório(s) pendente(s) ou vencido(s)`;

    return {
        cursos_resumo: resumo,
        cursos_obrigatorios_ok: cursosOk,
        cursos_pendentes: cursosPendentes
    };
}

function buildArquivoUrl(filePath) {
    if (!filePath) return null;
    const parts = String(filePath).split('uploads');
    if (parts.length < 2) return null;
    return `/arquivos${parts[1]}`; // ex: /arquivos/cnh/arquivo.pdf
}

async function carregarCursosMotorista(client, tenantId, motoristaId) {
    const { rows } = await client.query(
        `SELECT id,
                tipo,
                data_conclusao,
                validade,
                observacoes,
                arquivo_path
           FROM motoristas_cursos
          WHERE tenant_id = $1 AND motorista_id = $2
          ORDER BY id`,
        [tenantId, motoristaId]
    );

    return rows.map((c) => ({
        ...c,
        arquivo_url: c.arquivo_path ? buildArquivoUrl(c.arquivo_path) : null
    }));
}

/**
 * Faz o parse dos cursos a partir do req.body e dos arquivos em req.files.
 *
 * Suporta dois formatos:
 *  1) req.body.cursos = Array([{ tipo, data_conclusao, validade, observacoes }])
 *  2) campos soltos: cursos[0][tipo], cursos[0][data_conclusao], ...
 */
function parseCursosFromRequest(req) {
    let cursos = [];

    // 1) Formato preferencial: req.body.cursos como array
    if (Array.isArray(req.body.cursos)) {
        cursos = req.body.cursos.map((item) => {
            let c = item;
            if (typeof c === 'string') {
                try { c = JSON.parse(c); } catch { c = {}; }
            }
            return {
                tipo: c.tipo || null,
                data_conclusao: c.data_conclusao || null,
                validade: c.validade || null,
                observacoes: c.observacoes || null,
                arquivo_path: null
            };
        });
    } else {
        // 2) Fallback: campos no padrão cursos[0][campo]
        const cursosTemp = {};

        Object.keys(req.body || {}).forEach((key) => {
            if (!key.startsWith('cursos[')) return;
            if (key === 'dados') return;

            // "cursos[0][tipo]" -> inner: "0][tipo"
            const inner = key.slice('cursos['.length, -1);
            const parts = inner.split('][');
            if (parts.length !== 2) return;

            const idx = parts[0];
            const campo = (parts[1] || '').trim();

            if (!cursosTemp[idx]) cursosTemp[idx] = {};
            let value = req.body[key];
            if (value === '') value = null;

            if (campo === 'arquivo') {
                if (!cursosTemp[idx].arquivo_path) cursosTemp[idx].arquivo_path = value;
            } else {
                cursosTemp[idx][campo] = value;
            }
        });

        cursos = Object.keys(cursosTemp).map((idx) => ({
            tipo: cursosTemp[idx].tipo || null,
            data_conclusao: cursosTemp[idx].data_conclusao || null,
            validade: cursosTemp[idx].validade || null,
            observacoes: cursosTemp[idx].observacoes || null,
            arquivo_path: cursosTemp[idx].arquivo_path || null
        }));
    }

    // 3) Associar arquivos de certificados aos cursos pelo índice
    if (Array.isArray(req.files)) {
        req.files.forEach((file) => {
            if (file.fieldname === 'arquivo_cnh') return;

            // Espera algo como "cursos[0][arquivo]"
            const match = file.fieldname.match(/^cursos\[(\d+)]\[arquivo]$/);
            if (!match) return;

            const idx = parseInt(match[1], 10);
            if (!cursos[idx]) {
                cursos[idx] = {
                    tipo: null,
                    data_conclusao: null,
                    validade: null,
                    observacoes: null,
                    arquivo_path: null
                };
            }

            cursos[idx].arquivo_path = file.path;
        });
    }

    // 4) Filtrar cursos totalmente vazios
    cursos = cursos.filter((c) => (
        (c.tipo && c.tipo !== '') ||
        (c.data_conclusao && c.data_conclusao !== '') ||
        (c.validade && c.validade !== '') ||
        (c.observacoes && c.observacoes !== '') ||
        (c.arquivo_path && c.arquivo_path !== '')
    ));

    return cursos;
}

// ===================================================================
// ROTAS
// ===================================================================

// GET /api/motoristas
router.get('/', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });
    const ctx = await resolveEscopoFornecedor(req, res, tenantId);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId;

    const client = await pool.connect();
    try {
        const { rows: motoristas } = await client.query(
            `SELECT m.id,
                    m.nome,
                    m.cpf,
                    m.telefone,
                    m.email,
                    m.numero_cnh,
                    m.categoria_cnh,
                    m.validade_cnh,
                    m.status,
                    m.arquivo_cnh_path,
                    mf.fornecedor_id,
                    f.razao_social      AS fornecedor_razao_social,
                    f.nome_fantasia     AS fornecedor_nome_fantasia,
                    f.cnpj              AS fornecedor_cnpj,
                    COALESCE(COUNT(DISTINCT mr.rota_escolar_id), 0) AS rotas_qtd,
                    COALESCE(string_agg(DISTINCT re.nome, ', ' ORDER BY re.nome), '') AS rotas_nomes
               FROM motoristas m
          LEFT JOIN motorista_fornecedor mf
                 ON mf.motorista_id = m.id AND mf.tenant_id = m.tenant_id
          LEFT JOIN fornecedores f
                 ON f.id = mf.fornecedor_id AND f.tenant_id = m.tenant_id
          LEFT JOIN motoristas_rotas mr
                 ON mr.motorista_id = m.id AND mr.tenant_id = m.tenant_id
          LEFT JOIN rotas_escolares re
                 ON re.id = mr.rota_escolar_id AND re.tenant_id = m.tenant_id
              WHERE m.tenant_id = $1
                AND ($2::bigint IS NULL OR mf.fornecedor_id = $2)
              GROUP BY
                    m.id, m.nome, m.cpf, m.telefone, m.email, m.numero_cnh,
                    m.categoria_cnh, m.validade_cnh, m.status, m.arquivo_cnh_path,
                    mf.fornecedor_id, f.razao_social, f.nome_fantasia, f.cnpj
              ORDER BY m.id`,
            [tenantId, fornecedorIdCtx]
        );

        if (!motoristas.length) return res.json([]);

        const ids = motoristas.map((m) => m.id);
        const { rows: cursos } = await client.query(
            `SELECT id,
                    motorista_id,
                    tipo,
                    data_conclusao,
                    validade,
                    observacoes,
                    arquivo_path
               FROM motoristas_cursos
              WHERE tenant_id = $1 AND motorista_id = ANY($2::int[])`,
            [tenantId, ids]
        );

        const cursosPorMotorista = {};
        cursos.forEach((c) => {
            if (!cursosPorMotorista[c.motorista_id]) cursosPorMotorista[c.motorista_id] = [];
            cursosPorMotorista[c.motorista_id].push(c);
        });

        const resultado = motoristas.map((m) => {
            const cursosMotorista = cursosPorMotorista[m.id] || [];
            const resumo = montarResumoCursos(cursosMotorista);

            return {
                id: m.id,
                nome: m.nome,
                cpf: m.cpf,
                telefone: m.telefone,
                email: m.email,
                numero_cnh: m.numero_cnh,
                categoria_cnh: m.categoria_cnh,
                validade_cnh: m.validade_cnh,
                status: m.status,
                cursos_resumo: resumo.cursos_resumo,
                cursos_obrigatorios_ok: resumo.cursos_obrigatorios_ok,
                cursos_pendentes: resumo.cursos_pendentes,
                arquivo_cnh_url: buildArquivoUrl(m.arquivo_cnh_path),
                fornecedor_id: m.fornecedor_id,
                fornecedor_razao_social: m.fornecedor_razao_social,
                fornecedor_nome_fantasia: m.fornecedor_nome_fantasia,
                fornecedor_cnpj: m.fornecedor_cnpj,
                rotas_qtd: m.rotas_qtd ? Number(m.rotas_qtd) : 0,
                rotas_nomes: m.rotas_nomes || ''
            };
        });

        res.json(resultado);
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao listar motoristas' });
    } finally {
        client.release();
    }
});


// ============================================================================
// Rotas escolares (para associação com motorista)
// ============================================================================

// GET /api/motoristas/rotas-escolares?status=ativo&tipo=municipal
// Lista rotas do tenant e, se usuário for FORNECEDOR_ESCOLAR, restringe ao fornecedor.
router.get('/rotas-escolares', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const ctx = await resolveEscopoFornecedor(req, res, tenantId);
    if (!ctx?.ok) return;

    const status = (req.query.status || 'ativo').toString();
    const tipo = (req.query.tipo || '').toString();

    const where = ['re.tenant_id = $1'];
    const params = [tenantId];
    let p = 1;

    if (status) {
        p += 1;
        where.push(`re.status = $${p}`);
        params.push(status);
    }
    if (tipo) {
        p += 1;
        where.push(`re.tipo = $${p}`);
        params.push(tipo);
    }
    if (ctx.fornecedorId) {
        p += 1;
        where.push(`re.fornecedor_id = $${p}`);
        params.push(ctx.fornecedorId);
    }

    try {
        const r = await pool.query(
            `SELECT re.id, re.nome, re.tipo, re.status, re.fornecedor_id
               FROM rotas_escolares re
              WHERE ${where.join(' AND ')}
              ORDER BY re.nome ASC`,
            params
        );
        res.json(r.rows || []);
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: 'Erro ao listar rotas escolares' });
    }
});

// GET /api/motoristas/:id/rotas
router.get('/:id(\\d+)/rotas', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const ctx = await resolveEscopoFornecedor(req, res, tenantId);
    if (!ctx?.ok) return;

    const motoristaId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(motoristaId) || motoristaId <= 0) {
        return res.status(400).json({ erro: 'ID inválido' });
    }

    try {
        // Se for fornecedor, garante que o motorista pertence ao fornecedor
        if (ctx.fornecedorId) {
            const chk = await pool.query(
                `SELECT 1
                   FROM motorista_fornecedor mf
                  WHERE mf.tenant_id = $1 AND mf.motorista_id = $2 AND mf.fornecedor_id = $3
                  LIMIT 1`,
                [tenantId, motoristaId, ctx.fornecedorId]
            );
            if (!chk.rowCount) return res.status(403).json({ erro: 'Sem permissão para este motorista.' });
        }

        const r = await pool.query(
            `SELECT mr.rota_escolar_id AS id, re.nome
               FROM motoristas_rotas mr
               JOIN rotas_escolares re ON re.id = mr.rota_escolar_id
              WHERE mr.tenant_id = $1 AND mr.motorista_id = $2
              ORDER BY re.nome ASC`,
            [tenantId, motoristaId]
        );

        const rotas = r.rows || [];
        res.json({
            motorista_id: motoristaId,
            rota_ids: rotas.map(x => x.id),
            rotas
        });
    } catch (e) {
        console.error(e);
        res.status(500).json({ erro: 'Erro ao buscar rotas do motorista' });
    }
});

// PUT /api/motoristas/:id/rotas  body: { rota_ids: [1,2,3] }
router.put('/:id(\\d+)/rotas', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const ctx = await resolveEscopoFornecedor(req, res, tenantId);
    if (!ctx?.ok) return;

    const motoristaId = Number.parseInt(req.params.id, 10);
    if (!Number.isInteger(motoristaId) || motoristaId <= 0) {
        return res.status(400).json({ erro: 'ID inválido' });
    }

    const rotaIdsRaw = req.body?.rota_ids;
    const rotaIds = Array.isArray(rotaIdsRaw)
        ? [...new Set(rotaIdsRaw.map(v => Number.parseInt(String(v), 10)).filter(n => Number.isInteger(n) && n > 0))]
        : [];

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Se for fornecedor, garante que o motorista pertence ao fornecedor
        if (ctx.fornecedorId) {
            const chk = await client.query(
                `SELECT 1
                   FROM motorista_fornecedor mf
                  WHERE mf.tenant_id = $1 AND mf.motorista_id = $2 AND mf.fornecedor_id = $3
                  LIMIT 1`,
                [tenantId, motoristaId, ctx.fornecedorId]
            );
            if (!chk.rowCount) {
                await client.query('ROLLBACK');
                return res.status(403).json({ erro: 'Sem permissão para este motorista.' });
            }
        }

        // Limpa associações atuais
        await client.query(
            `DELETE FROM motoristas_rotas
              WHERE tenant_id = $1 AND motorista_id = $2`,
            [tenantId, motoristaId]
        );

        // Insere novas
        for (const rotaId of rotaIds) {
            // Se for fornecedor, garante que a rota é do fornecedor
            if (ctx.fornecedorId) {
                const ok = await client.query(
                    `SELECT 1
                       FROM rotas_escolares re
                      WHERE re.tenant_id = $1 AND re.id = $2 AND re.fornecedor_id = $3
                      LIMIT 1`,
                    [tenantId, rotaId, ctx.fornecedorId]
                );
                if (!ok.rowCount) continue;
            } else {
                const ok = await client.query(
                    `SELECT 1 FROM rotas_escolares re WHERE re.tenant_id = $1 AND re.id = $2 LIMIT 1`,
                    [tenantId, rotaId]
                );
                if (!ok.rowCount) continue;
            }

            await client.query(
                `INSERT INTO motoristas_rotas (tenant_id, motorista_id, rota_escolar_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (tenant_id, motorista_id, rota_escolar_id) DO NOTHING`,
                [tenantId, motoristaId, rotaId]
            );
        }

        await client.query('COMMIT');
        res.json({ sucesso: true, motorista_id: motoristaId, rota_ids: rotaIds });
    } catch (e) {
        await client.query('ROLLBACK');
        console.error(e);
        res.status(500).json({ erro: 'Erro ao salvar rotas do motorista' });
    } finally {
        client.release();
    }
});


// GET /api/motoristas/:id
router.get('/:id(\\d+)', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });
    const ctx = await resolveEscopoFornecedor(req, res, tenantId);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId;

    const { id } = req.params;
    const client = await pool.connect();

    try {
        const { rows, rowCount } = await client.query(
            `SELECT m.*,
                    mf.fornecedor_id,
                    f.razao_social  AS fornecedor_razao_social,
                    f.nome_fantasia AS fornecedor_nome_fantasia,
                    f.cnpj          AS fornecedor_cnpj
               FROM motoristas m
          LEFT JOIN motorista_fornecedor mf
                 ON mf.motorista_id = m.id AND mf.tenant_id = m.tenant_id
          LEFT JOIN fornecedores f
                 ON f.id = mf.fornecedor_id AND f.tenant_id = m.tenant_id
              WHERE m.tenant_id = $1 AND m.id = $2 AND ($3::bigint IS NULL OR mf.fornecedor_id = $3)`
            ,
            [tenantId, id, fornecedorIdCtx]
        );

        if (!rowCount) return res.status(404).json({ erro: 'Motorista não encontrado' });

        const motorista = rows[0];
        const cursos = await carregarCursosMotorista(client, tenantId, id);
        const resumo = montarResumoCursos(cursos);

        res.json({
            ...motorista,
            arquivo_cnh_url: buildArquivoUrl(motorista.arquivo_cnh_path),
            cursos,
            cursos_resumo: resumo.cursos_resumo,
            cursos_obrigatorios_ok: resumo.cursos_obrigatorios_ok,
            cursos_pendentes: resumo.cursos_pendentes,
            fornecedor_id: motorista.fornecedor_id,
            fornecedor_razao_social: motorista.fornecedor_razao_social,
            fornecedor_nome_fantasia: motorista.fornecedor_nome_fantasia,
            fornecedor_cnpj: motorista.fornecedor_cnpj
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao carregar motorista' });
    } finally {
        client.release();
    }
});

// POST /api/motoristas
router.post('/', uploadMotorista.any(), async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });
    const ctx = await resolveEscopoFornecedor(req, res, tenantId);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (!req.body.dados) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Campo "dados" obrigatório' });
        }

        const dados = JSON.parse(req.body.dados);
        const ctx = await resolveEscopoFornecedor(req, res, tenantId);
        if (!ctx.ok) { await client.query('ROLLBACK'); return; }
        const fornecedorIdCtx = ctx.fornecedorId;

        // fornecedor_id é obrigatório
        let fornecedorId = fornecedorIdCtx ? fornecedorIdCtx : dados.fornecedor_id;
        if (fornecedorId === undefined || fornecedorId === null || fornecedorId === '') {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Fornecedor obrigatório para o motorista' });
        }
        fornecedorId = parseInt(fornecedorId, 10);
        if (Number.isNaN(fornecedorId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Fornecedor inválido' });
        }

        // valida se fornecedor existe (do tenant)
        const { rowCount: fornecedorExiste } = await client.query(
            'SELECT 1 FROM fornecedores WHERE tenant_id = $1 AND id = $2',
            [tenantId, fornecedorId]
        );
        if (!fornecedorExiste) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Fornecedor não encontrado' });
        }

        // Arquivo da CNH (opcional)
        let arquivoCnhPath = null;
        if (Array.isArray(req.files)) {
            req.files.forEach((file) => {
                if (file.fieldname === 'arquivo_cnh') arquivoCnhPath = file.path;
            });
        }

        // Cursos (body + arquivos)
        const cursos = parseCursosFromRequest(req);

        const insertMotoristaQuery = `
            INSERT INTO motoristas (
                tenant_id,
                nome, cpf, rg, data_nascimento,
                telefone, email, endereco, bairro, cidade, uf, cep,
                numero_cnh, categoria_cnh, validade_cnh, orgao_emissor_cnh,
                status, arquivo_cnh_path
            ) VALUES (
                $1,
                $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12,
                $13, $14, $15, $16,
                $17, $18
            )
            RETURNING *;
        `;

        const values = [
            tenantId,
            dados.nome,
            dados.cpf,
            dados.rg || null,
            dados.data_nascimento || null,
            dados.telefone || null,
            dados.email || null,
            dados.endereco || null,
            dados.bairro || null,
            dados.cidade || null,
            dados.uf || null,
            dados.cep || null,
            dados.numero_cnh,
            dados.categoria_cnh,
            dados.validade_cnh,
            dados.orgao_emissor_cnh || null,
            dados.status || 'ativo',
            arquivoCnhPath
        ];

        const { rows: motoristasRows } = await client.query(insertMotoristaQuery, values);
        const motorista = motoristasRows[0];

        // cria vínculo motorista_fornecedor
        await client.query(
            `INSERT INTO motorista_fornecedor (tenant_id, motorista_id, fornecedor_id)
             VALUES ($1, $2, $3)`,
            [tenantId, motorista.id, fornecedorId]
        );

        // cursos
        for (const c of cursos) {
            const tipoCurso = (typeof c.tipo === 'string' && c.tipo.trim() !== '')
                ? c.tipo.trim()
                : 'outro';

            await client.query(
                `INSERT INTO motoristas_cursos (
                    tenant_id, motorista_id, tipo, data_conclusao, validade, observacoes, arquivo_path
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7
                )`,
                [
                    tenantId,
                    motorista.id,
                    tipoCurso,
                    c.data_conclusao || null,
                    c.validade || null,
                    c.observacoes || null,
                    c.arquivo_path || null
                ]
            );
        }

        await client.query('COMMIT');

        res.status(201).json({
            ...motorista,
            arquivo_cnh_url: buildArquivoUrl(motorista.arquivo_cnh_path),
            fornecedor_id: fornecedorId
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        console.error(err);
        res.status(500).json({ erro: 'Erro ao criar motorista' });
    } finally {
        client.release();
    }
});

// PUT /api/motoristas/:id
router.put('/:id(\\d+)', uploadMotorista.any(), async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });
    const ctx = await resolveEscopoFornecedor(req, res, tenantId);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId;

    const { id } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        if (!req.body.dados) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Campo "dados" obrigatório' });
        }

        const dados = JSON.parse(req.body.dados);
        const ctx = await resolveEscopoFornecedor(req, res, tenantId);
        if (!ctx.ok) { await client.query('ROLLBACK'); return; }
        const fornecedorIdCtx = ctx.fornecedorId;

        // fornecedor_id é obrigatório na edição também
        let fornecedorId = fornecedorIdCtx ? fornecedorIdCtx : dados.fornecedor_id;
        if (fornecedorId === undefined || fornecedorId === null || fornecedorId === '') {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Fornecedor obrigatório para o motorista' });
        }
        fornecedorId = parseInt(fornecedorId, 10);
        if (Number.isNaN(fornecedorId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Fornecedor inválido' });
        }

        // valida se fornecedor existe (do tenant)
        const { rowCount: fornecedorExiste } = await client.query(
            'SELECT 1 FROM fornecedores WHERE tenant_id = $1 AND id = $2',
            [tenantId, fornecedorId]
        );
        if (!fornecedorExiste) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Fornecedor não encontrado' });
        }

        // valida se motorista existe no tenant
        const { rowCount: motoristaExiste } = await client.query(
            'SELECT 1 FROM motoristas WHERE tenant_id = $1 AND id = $2',
            [tenantId, id]
        );
        if (!motoristaExiste) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Motorista não encontrado' });
        }

        let arquivoCnhPath = null;
        if (Array.isArray(req.files)) {
            req.files.forEach((file) => {
                if (file.fieldname === 'arquivo_cnh') arquivoCnhPath = file.path;
            });
        }

        const cursos = parseCursosFromRequest(req);

        // Monta update com/sem arquivo
        const baseValues = [
            dados.nome,
            dados.cpf,
            dados.rg || null,
            dados.data_nascimento || null,
            dados.telefone || null,
            dados.email || null,
            dados.endereco || null,
            dados.bairro || null,
            dados.cidade || null,
            dados.uf || null,
            dados.cep || null,
            dados.numero_cnh,
            dados.categoria_cnh,
            dados.validade_cnh,
            dados.orgao_emissor_cnh || null,
            dados.status || 'ativo'
        ];

        let updateSql = `
            UPDATE motoristas
               SET nome = $1,
                   cpf = $2,
                   rg = $3,
                   data_nascimento = $4,
                   telefone = $5,
                   email = $6,
                   endereco = $7,
                   bairro = $8,
                   cidade = $9,
                   uf = $10,
                   cep = $11,
                   numero_cnh = $12,
                   categoria_cnh = $13,
                   validade_cnh = $14,
                   orgao_emissor_cnh = $15,
                   status = $16,
                   updated_at = NOW()
        `;

        if (arquivoCnhPath) {
            updateSql += `, arquivo_cnh_path = $17
              WHERE tenant_id = $18 AND id = $19
              RETURNING *;`;
            baseValues.push(arquivoCnhPath, tenantId, id);
        } else {
            updateSql += `
              WHERE tenant_id = $17 AND id = $18
              RETURNING *;`;
            baseValues.push(tenantId, id);
        }

        const { rows, rowCount } = await client.query(updateSql, baseValues);
        if (!rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Motorista não encontrado' });
        }

        // atualiza vínculo motorista_fornecedor: remove e cria
        await client.query(
            'DELETE FROM motorista_fornecedor WHERE tenant_id = $1 AND motorista_id = $2',
            [tenantId, id]
        );
        await client.query(
            `INSERT INTO motorista_fornecedor (tenant_id, motorista_id, fornecedor_id)
             VALUES ($1, $2, $3)`,
            [tenantId, id, fornecedorId]
        );

        // Recria cursos: remove todos e insere de novo
        await client.query(
            'DELETE FROM motoristas_cursos WHERE tenant_id = $1 AND motorista_id = $2',
            [tenantId, id]
        );

        for (const c of cursos) {
            const tipoCurso = (typeof c.tipo === 'string' && c.tipo.trim() !== '')
                ? c.tipo.trim()
                : 'outro';

            await client.query(
                `INSERT INTO motoristas_cursos (
                    tenant_id, motorista_id, tipo, data_conclusao, validade, observacoes, arquivo_path
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7
                )`,
                [
                    tenantId,
                    id,
                    tipoCurso,
                    c.data_conclusao || null,
                    c.validade || null,
                    c.observacoes || null,
                    c.arquivo_path || null
                ]
            );
        }

        await client.query('COMMIT');

        const motorista = rows[0];
        res.json({
            ...motorista,
            arquivo_cnh_url: buildArquivoUrl(motorista.arquivo_cnh_path),
            fornecedor_id: fornecedorId
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        console.error(err);
        res.status(500).json({ erro: 'Erro ao atualizar motorista' });
    } finally {
        client.release();
    }
});

// PATCH /api/motoristas/:id/status
router.patch('/:id/status', express.json(), async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });
    const ctx = await resolveEscopoFornecedor(req, res, tenantId);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId;

    const { id } = req.params;
    const { status } = req.body;

    if (!['ativo', 'inativo'].includes(status)) {
        return res.status(400).json({ erro: 'Status inválido' });
    }

    try {
        const { rowCount, rows } = await pool.query(
            `UPDATE motoristas
                SET status = $1,
                    updated_at = NOW()
              WHERE tenant_id = $2 AND id = $3
              RETURNING *`,
            [status, tenantId, id]
        );

        if (!rowCount) return res.status(404).json({ erro: 'Motorista não encontrado' });
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao alterar status do motorista' });
    }
});

// DELETE /api/motoristas/:id
router.delete('/:id(\\d+)', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });
    const ctx = await resolveEscopoFornecedor(req, res, tenantId);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId;

    const { id } = req.params;
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        await client.query(
            'DELETE FROM motoristas_cursos WHERE tenant_id = $1 AND motorista_id = $2',
            [tenantId, id]
        );
        await client.query(
            'DELETE FROM motorista_fornecedor WHERE tenant_id = $1 AND motorista_id = $2',
            [tenantId, id]
        );

        const { rowCount } = await client.query(
            'DELETE FROM motoristas WHERE tenant_id = $1 AND id = $2',
            [tenantId, id]
        );

        if (!rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Motorista não encontrado' });
        }

        await client.query('COMMIT');
        res.json({ sucesso: true });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        console.error(err);
        res.status(500).json({ erro: 'Erro ao excluir motorista' });
    } finally {
        client.release();
    }
});

export default router;