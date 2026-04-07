// routes/monitores.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import pool from '../db.js';

// IMPORTANTE: segurança multi-tenant
import authMiddleware from '../middleware/auth.js';
import tenantMiddleware from '../middleware/tenant.js';

const router = express.Router();

// Protege TODAS as rotas deste módulo
router.use(authMiddleware);
router.use(tenantMiddleware);

// ===================================================================
// CONTEXTO DE FORNECEDOR (FONTE DE VERDADE = TABELA usuarios)
// - Se o cargo no banco for FORNECEDOR_ESCOLAR, força o escopo do fornecedor
// - Evita vazar registros de outros fornecedores quando token estiver incompleto
// ===================================================================

async function attachFornecedorContext(req, res, next) {
    try {
        const tenantId = resolveTenantId(req);
        if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

        const userId = Number.parseInt(String(req?.user?.id ?? req?.user?.user_id ?? ''), 10);
        const userEmail = (req?.user?.email || '').toString().trim();

        if (!Number.isInteger(userId) && !userEmail) {
            // Sem identificador confiável do usuário: não aplica filtro (admin/gestor),
            // mas também não assume fornecedor.
            req.fornecedorIdCtx = null;
            return next();
        }

        const client = await pool.connect();
        try {
            const params = [tenantId];
            let where = 'tenant_id = $1';
            if (Number.isInteger(userId)) {
                params.push(userId);
                where += ' AND id = $2';
            } else {
                params.push(userEmail);
                where += ' AND email = $2';
            }

            const { rows, rowCount } = await client.query(
                `SELECT id, cargo, fornecedor_id
                   FROM usuarios
                  WHERE ${where}
                  LIMIT 1`,
                params
            );

            if (!rowCount) {
                req.fornecedorIdCtx = null;
                return next();
            }

            const cargoDb = (rows[0].cargo || '').toString().toUpperCase();
            const fornecedorIdDb = rows[0].fornecedor_id ? Number(rows[0].fornecedor_id) : null;

            if (cargoDb === 'FORNECEDOR_ESCOLAR') {
                if (!fornecedorIdDb) {
                    return res.status(403).json({ erro: 'Usuário FORNECEDOR_ESCOLAR sem vínculo de fornecedor.' });
                }
                req.fornecedorIdCtx = fornecedorIdDb;
            } else {
                req.fornecedorIdCtx = null;
            }

            return next();
        } finally {
            client.release();
        }
    } catch (err) {
        console.error(err);
        return res.status(500).json({ erro: 'Erro ao resolver contexto do fornecedor' });
    }
}

router.use(attachFornecedorContext);

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
    // O vínculo é resolvido pelo middleware attachFornecedorContext via tabela usuarios.
    // Se o usuário for FORNECEDOR_ESCOLAR sem fornecedor_id, o middleware já responde 403.
    return { ok: true, fornecedorId: req.fornecedorIdCtx || null };
}

async function assertMonitorVinculadoAoFornecedor(client, tenantId, monitorId, fornecedorIdCtx) {
    if (!fornecedorIdCtx) return true;
    const { rowCount } = await client.query(
        `SELECT 1
           FROM monitor_fornecedor mf
          JOIN monitores m ON m.id = mf.monitor_id
         WHERE m.tenant_id = $1
           AND mf.monitor_id = $2
           AND mf.fornecedor_id = $3
           AND mf.ativo = TRUE
         LIMIT 1`,
        [tenantId, monitorId, fornecedorIdCtx]
    );
    return rowCount > 0;
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===================================================================
// UPLOADS: DOCUMENTOS PESSOAIS + CERTIFICADOS DE CURSOS
// ===================================================================

const storageArquivosMonitor = multer.diskStorage({
    destination: (req, file, cb) => {
        let dest;
        if (file.fieldname === 'arquivo_documento') {
            dest = path.join(__dirname, '..', 'uploads', 'monitores_documentos');
        } else {
            // cursos[0][arquivo], cursos[1][arquivo], etc.
            dest = path.join(__dirname, '..', 'uploads', 'certificados_monitores');
        }
        fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.bin';
        if (file.fieldname === 'arquivo_documento') {
            cb(null, `doc_${Date.now()}${ext}`);
        } else {
            cb(null, `cert_monitor_${Date.now()}_${Math.round(Math.random() * 1e6)}${ext}`);
        }
    }
});

const uploadMonitor = multer({ storage: storageArquivosMonitor });

// ===================================================================
// FUNÇÕES AUXILIARES
// ===================================================================

const TIPOS_CURSOS_OBRIGATORIOS_MONITOR = ['monitor_escolar'];

function montarResumoCursosMonitores(cursos) {
    if (!Array.isArray(cursos) || !cursos.length) {
        return {
            cursos_resumo: null,
            cursos_obrigatorios_ok: false,
            cursos_pendentes: TIPOS_CURSOS_OBRIGATORIOS_MONITOR.length
        };
    }

    const hoje = new Date();
    const obrigStatus = {};
    TIPOS_CURSOS_OBRIGATORIOS_MONITOR.forEach((t) => { obrigStatus[t] = 'pendente'; });

    cursos.forEach((c) => {
        if (!c?.tipo) return;
        if (!TIPOS_CURSOS_OBRIGATORIOS_MONITOR.includes(c.tipo)) return;

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

    return {
        cursos_resumo: cursosOk ? 'Curso de monitor escolar em dia' : `${cursosPendentes} curso(s) obrigatório(s) pendente(s) ou vencido(s)`,
        cursos_obrigatorios_ok: cursosOk,
        cursos_pendentes: cursosPendentes
    };
}

function buildArquivoUrl(filePath) {
    if (!filePath) return null;
    const parts = String(filePath).split('uploads');
    if (parts.length < 2) return null;
    return `/arquivos${parts[1]}`;
}

async function carregarCursosMonitor(client, tenantId, monitorId) {
    const { rows } = await client.query(
        `SELECT id,
                tipo,
                data_conclusao,
                validade,
                observacoes,
                arquivo_path
           FROM monitores_cursos
          WHERE tenant_id = $1 AND monitor_id = $2
          ORDER BY id`,
        [tenantId, monitorId]
    );

    return rows.map((c) => ({
        ...c,
        arquivo_url: c.arquivo_path ? buildArquivoUrl(c.arquivo_path) : null
    }));
}

/**
 * Parse cursos a partir de req.body e req.files.
 * Suporta campos no padrão cursos[0][tipo], cursos[0][validade] etc.
 */
function parseCursosFromRequest(req) {
    const cursosTemp = {};

    // arquivos: cursos[0][arquivo]
    if (Array.isArray(req.files)) {
        req.files.forEach((file) => {
            if (file.fieldname === 'arquivo_documento') return;
            const match = file.fieldname.match(/^cursos\[(\d+)]\[arquivo]$/);
            if (!match) return;
            const idx = match[1];
            if (!cursosTemp[idx]) cursosTemp[idx] = {};
            cursosTemp[idx].arquivo_path = file.path;
        });
    }

    // campos: cursos[0][tipo], etc.
    Object.keys(req.body || {}).forEach((key) => {
        const match = key.match(/^cursos\[(\d+)]\[(.+)]$/);
        if (!match) return;
        const idx = match[1];
        const campo = (match[2] || '').trim();
        if (!cursosTemp[idx]) cursosTemp[idx] = {};
        let value = req.body[key];
        if (value === '') value = null;
        cursosTemp[idx][campo] = value;
    });

    const cursosList = Object.values(cursosTemp)
        .map((c) => ({
            tipo: c.tipo || null,
            data_conclusao: c.data_conclusao || null,
            validade: c.validade || null,
            observacoes: c.observacoes || null,
            arquivo_path: c.arquivo_path || null
        }))
        .filter((c) => (
            (c.tipo && c.tipo !== '') ||
            (c.data_conclusao && c.data_conclusao !== '') ||
            (c.validade && c.validade !== '') ||
            (c.observacoes && c.observacoes !== '') ||
            (c.arquivo_path && c.arquivo_path !== '')
        ));

    return cursosList;
}


// ===================================================================
// ROTAS ESCOLARES (ASSOCIAÇÃO MONITOR x ROTAS)
// ===================================================================

async function listarRotasEscolaresDisponiveis(client, tenantId, fornecedorIdCtx, filtros = {}) {
    const status = (filtros.status || '').toString().trim() || null;
    const tipo = (filtros.tipo || '').toString().trim() || null;

    const params = [tenantId];
    let where = 'r.tenant_id = $1';

    if (status) {
        params.push(status);
        where += ` AND r.status = $${params.length}`;
    }

    if (tipo) {
        params.push(tipo);
        where += ` AND r.tipo = $${params.length}`;
    }

    if (fornecedorIdCtx) {
        params.push(fornecedorIdCtx);
        where += ` AND r.fornecedor_id = $${params.length}`;
    }

    const { rows } = await client.query(
        `SELECT r.id, r.nome, r.tipo, r.status
           FROM rotas_escolares r
          WHERE ${where}
          ORDER BY r.nome`,
        params
    );

    return rows || [];
}

async function listarRotasDoMonitor(client, tenantId, monitorId) {
    const { rows } = await client.query(
        `SELECT mr.rota_escolar_id AS id,
                r.nome,
                r.tipo,
                r.status
           FROM monitores_rotas mr
           JOIN rotas_escolares r
             ON r.id = mr.rota_escolar_id
            AND r.tenant_id = mr.tenant_id
          WHERE mr.tenant_id = $1
            AND mr.monitor_id = $2
          ORDER BY r.nome`,
        [tenantId, monitorId]
    );
    return rows || [];
}

async function substituirRotasDoMonitor(client, tenantId, monitorId, rotaIds) {
    const ids = Array.isArray(rotaIds) ? rotaIds : [];
    const idsFiltrados = ids
        .map((x) => Number.parseInt(String(x), 10))
        .filter((n) => Number.isInteger(n) && n > 0);

    await client.query(
        'DELETE FROM monitores_rotas WHERE tenant_id = $1 AND monitor_id = $2',
        [tenantId, monitorId]
    );

    for (const rotaId of idsFiltrados) {
        await client.query(
            `INSERT INTO monitores_rotas (tenant_id, monitor_id, rota_escolar_id)
             VALUES ($1, $2, $3)
             ON CONFLICT (tenant_id, monitor_id, rota_escolar_id) DO NOTHING`,
            [tenantId, monitorId, rotaId]
        );
    }

    return idsFiltrados;
}

// ===================================================================
// ROTAS
// ===================================================================


// GET /api/monitores/rotas-escolares
// Lista rotas disponíveis para associação (respeita tenant e, se usuário for FORNECEDOR_ESCOLAR, filtra pelo fornecedor do usuário)
router.get('/rotas-escolares', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const ctx = assertFornecedorVinculado(req, res);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId || null;

    const status = (req.query.status || '').toString().trim() || null;
    const tipo = (req.query.tipo || '').toString().trim() || null;

    const client = await pool.connect();
    try {
        const rotas = await listarRotasEscolaresDisponiveis(client, tenantId, fornecedorIdCtx, { status, tipo });
        res.json(rotas);
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao listar rotas escolares' });
    } finally {
        client.release();
    }
});

// GET /api/monitores/:id/rotas
router.get('/:id(\\d+)/rotas', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const { id } = req.params;
    const ctx = assertFornecedorVinculado(req, res);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId || null;

    const client = await pool.connect();
    try {
        const permitido = await assertMonitorVinculadoAoFornecedor(client, tenantId, id, fornecedorIdCtx);
        if (!permitido) return res.status(404).json({ erro: 'Monitor não encontrado' });

        const rotas = await listarRotasDoMonitor(client, tenantId, id);
        res.json({
            monitor_id: Number(id),
            rota_ids: rotas.map((r) => r.id),
            rotas
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao listar rotas do monitor' });
    } finally {
        client.release();
    }
});

// PUT /api/monitores/:id/rotas
// Substitui todas as associações do monitor
router.put('/:id(\\d+)/rotas', express.json(), async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const { id } = req.params;
    const ctx = assertFornecedorVinculado(req, res);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId || null;

    const rotaIds = Array.isArray(req.body?.rota_ids) ? req.body.rota_ids : [];

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        const permitido = await assertMonitorVinculadoAoFornecedor(client, tenantId, id, fornecedorIdCtx);
        if (!permitido) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Monitor não encontrado' });
        }

        // valida rotas no tenant (+ fornecedor se aplicável)
        const ids = rotaIds
            .map((x) => Number.parseInt(String(x), 10))
            .filter((n) => Number.isInteger(n) && n > 0);

        if (ids.length) {
            const params = [tenantId, ids];
            let where = 'tenant_id = $1 AND id = ANY($2::bigint[])';
            if (fornecedorIdCtx) {
                params.push(fornecedorIdCtx);
                where += ` AND fornecedor_id = $${params.length}`;
            }

            const { rows } = await client.query(
                `SELECT id
                   FROM rotas_escolares
                  WHERE ${where}`,
                params
            );

            const validSet = new Set((rows || []).map((r) => Number(r.id)));
            const invalid = ids.filter((n) => !validSet.has(n));
            if (invalid.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({ erro: 'Uma ou mais rotas não foram encontradas (ou não pertencem ao fornecedor/tenant).' });
            }
        }

        await substituirRotasDoMonitor(client, tenantId, id, ids);

        await client.query('COMMIT');

        const rotas = await listarRotasDoMonitor(client, tenantId, id);
        res.json({ sucesso: true, monitor_id: Number(id), rota_ids: rotas.map((r) => r.id), rotas });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { }
        console.error(err);
        res.status(500).json({ erro: 'Erro ao salvar rotas do monitor' });
    } finally {
        client.release();
    }
});


// GET /api/monitores
router.get('/', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const ctx = assertFornecedorVinculado(req, res);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId || null;

    const client = await pool.connect();
    try {
        const { rows: monitores } = await client.query(
            `SELECT m.id,
                    m.nome,
                    m.cpf,
                    m.telefone,
                    m.email,
                    m.status,
                    m.documento_pessoal_path,
                    mf.fornecedor_id,
                    f.nome_fantasia    AS fornecedor_nome_fantasia,
                    f.razao_social     AS fornecedor_razao_social,
                    f.cnpj             AS fornecedor_cnpj,
                    COALESCE(ra.rotas_qtd, 0) AS rotas_qtd,
                    ra.rotas_nomes            AS rotas_nomes
               FROM monitores m
          LEFT JOIN monitor_fornecedor mf
                 ON mf.monitor_id = m.id
                AND mf.ativo = TRUE
          LEFT JOIN fornecedores f
                 ON f.id = mf.fornecedor_id
                AND f.tenant_id = m.tenant_id
          LEFT JOIN (
                SELECT mr.tenant_id,
                       mr.monitor_id,
                       COUNT(*)::int AS rotas_qtd,
                       STRING_AGG(r.nome, ', ' ORDER BY r.nome) AS rotas_nomes
                  FROM monitores_rotas mr
                  JOIN rotas_escolares r
                    ON r.id = mr.rota_escolar_id
                   AND r.tenant_id = mr.tenant_id
                 GROUP BY mr.tenant_id, mr.monitor_id
          ) ra
                 ON ra.tenant_id = m.tenant_id
                AND ra.monitor_id = m.id
              WHERE m.tenant_id = $1
                AND ($2::bigint IS NULL OR mf.fornecedor_id = $2)
              ORDER BY m.id`,
            [tenantId, fornecedorIdCtx]
        );

        if (!monitores.length) return res.json([]);

        const ids = monitores.map((m) => m.id);
        const { rows: cursos } = await client.query(
            `SELECT id,
                    monitor_id,
                    tipo,
                    data_conclusao,
                    validade,
                    observacoes,
                    arquivo_path
               FROM monitores_cursos
              WHERE tenant_id = $1 AND monitor_id = ANY($2::int[])`,
            [tenantId, ids]
        );

        const cursosPorMonitor = {};
        cursos.forEach((c) => {
            if (!cursosPorMonitor[c.monitor_id]) cursosPorMonitor[c.monitor_id] = [];
            cursosPorMonitor[c.monitor_id].push(c);
        });

        const resultado = monitores.map((m) => {
            const cursosMonitor = cursosPorMonitor[m.id] || [];
            const resumo = montarResumoCursosMonitores(cursosMonitor);

            return {
                id: m.id,
                nome: m.nome,
                cpf: m.cpf,
                telefone: m.telefone,
                email: m.email,
                status: m.status,
                fornecedor_id: m.fornecedor_id,
                fornecedor_nome_fantasia: m.fornecedor_nome_fantasia,
                fornecedor_razao_social: m.fornecedor_razao_social,
                fornecedor_cnpj: m.fornecedor_cnpj,
                rotas_qtd: m.rotas_qtd,
                rotas_nomes: m.rotas_nomes,
                cursos_resumo: resumo.cursos_resumo,
                cursos_obrigatorios_ok: resumo.cursos_obrigatorios_ok,
                cursos_pendentes: resumo.cursos_pendentes,
                documento_pessoal_url: buildArquivoUrl(m.documento_pessoal_path)
            };
        });

        res.json(resultado);
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao listar monitores' });
    } finally {
        client.release();
    }
});

// GET /api/monitores/:id
router.get('/:id(\\d+)', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const { id } = req.params;
    const ctx = assertFornecedorVinculado(req, res);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId || null;

    const client = await pool.connect();

    try {
        // Para FORNECEDOR_ESCOLAR, garante que o monitor esteja vinculado ao fornecedor do usuário
        const permitido = await assertMonitorVinculadoAoFornecedor(client, tenantId, id, fornecedorIdCtx);
        if (!permitido) return res.status(404).json({ erro: 'Monitor não encontrado' });

        const { rows, rowCount } = await client.query(
            `SELECT m.*,
                    mf.fornecedor_id,
                    f.nome_fantasia AS fornecedor_nome_fantasia,
                    f.razao_social  AS fornecedor_razao_social,
                    f.cnpj          AS fornecedor_cnpj
               FROM monitores m
          LEFT JOIN monitor_fornecedor mf
                 ON mf.monitor_id = m.id
                AND mf.ativo = TRUE
                          LEFT JOIN fornecedores f
                 ON f.id = mf.fornecedor_id
                AND f.tenant_id = m.tenant_id
              WHERE m.tenant_id = $1 AND m.id = $2 AND ($3::bigint IS NULL OR mf.fornecedor_id = $3)`,
            [tenantId, id, fornecedorIdCtx]
        );

        if (!rowCount) return res.status(404).json({ erro: 'Monitor não encontrado' });

        const monitor = rows[0];
        const cursos = await carregarCursosMonitor(client, tenantId, id);
        const resumo = montarResumoCursosMonitores(cursos);

        res.json({
            ...monitor,
            documento_pessoal_url: buildArquivoUrl(monitor.documento_pessoal_path),
            cursos,
            cursos_resumo: resumo.cursos_resumo,
            cursos_obrigatorios_ok: resumo.cursos_obrigatorios_ok,
            cursos_pendentes: resumo.cursos_pendentes
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao carregar monitor' });
    } finally {
        client.release();
    }
});

// POST /api/monitores
router.post('/', uploadMonitor.any(), async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const ctx = assertFornecedorVinculado(req, res);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId || null;

    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (!req.body.dados) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Campo "dados" obrigatório' });
        }

        const dados = JSON.parse(req.body.dados);

        // fornecedor_id obrigatório (select obrigatório na tela)
        let fornecedorId = dados.fornecedor_id ? parseInt(dados.fornecedor_id, 10) : null;

        // Se o usuário for FORNECEDOR_ESCOLAR, ele só pode operar no fornecedor dele.
        // Ignora qualquer fornecedor_id vindo do front (evita troca maliciosa ou erro de UI).
        if (fornecedorIdCtx) {
            fornecedorId = fornecedorIdCtx;
        }

        if (!fornecedorId || Number.isNaN(fornecedorId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Fornecedor obrigatório para o monitor.' });
        }

        // valida fornecedor no tenant
        const { rowCount: fornecedorExiste } = await client.query(
            'SELECT 1 FROM fornecedores WHERE tenant_id = $1 AND id = $2',
            [tenantId, fornecedorId]
        );
        if (!fornecedorExiste) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Fornecedor não encontrado' });
        }

        let documentoPessoalPath = null;
        if (Array.isArray(req.files)) {
            req.files.forEach((file) => {
                if (file.fieldname === 'arquivo_documento') documentoPessoalPath = file.path;
            });
        }

        const cursosList = parseCursosFromRequest(req);

        const insertMonitorQuery = `
            INSERT INTO monitores (
                tenant_id,
                nome, cpf, rg, data_nascimento,
                telefone, email, endereco, bairro, cidade, uf, cep,
                status, documento_pessoal_path
            ) VALUES (
                $1,
                $2, $3, $4, $5,
                $6, $7, $8, $9, $10, $11, $12,
                $13, $14
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
            dados.status || 'ativo',
            documentoPessoalPath
        ];

        const { rows: monitoresRows } = await client.query(insertMonitorQuery, values);
        const monitor = monitoresRows[0];

        // vínculo monitor_fornecedor (ativo) - tenant
        await client.query(
            `INSERT INTO monitor_fornecedor (monitor_id, fornecedor_id, ativo)
             VALUES ($1, $2, TRUE)`,
            [monitor.id, fornecedorId]
        );

        // cursos - tenant
        for (const c of cursosList) {
            const tipoCurso = (typeof c.tipo === 'string' && c.tipo.trim() !== '')
                ? c.tipo.trim()
                : 'monitor_escolar';

            await client.query(
                `INSERT INTO monitores_cursos (
                    tenant_id, monitor_id, tipo, data_conclusao, validade, observacoes, arquivo_path
                ) VALUES (
                    $1, $2, $3, $4, $5, $6, $7
                )`,
                [
                    tenantId,
                    monitor.id,
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
            ...monitor,
            documento_pessoal_url: buildArquivoUrl(monitor.documento_pessoal_path),
            fornecedor_id: fornecedorId
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { }
        console.error(err);
        res.status(500).json({ erro: 'Erro ao criar monitor' });
    } finally {
        client.release();
    }
});

// PUT /api/monitores/:id
router.put('/:id(\\d+)', uploadMonitor.any(), async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const { id } = req.params;
    const ctx = assertFornecedorVinculado(req, res);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId || null;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        if (!req.body.dados) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Campo "dados" obrigatório' });
        }

        const dados = JSON.parse(req.body.dados);

        // Para FORNECEDOR_ESCOLAR, o fornecedor é FORÇADO pelo contexto do usuário.
        // Para demais cargos, o fornecedor vem do payload.
        let fornecedorId = fornecedorIdCtx || (dados.fornecedor_id ? parseInt(dados.fornecedor_id, 10) : null);
        if (!fornecedorId || Number.isNaN(fornecedorId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Fornecedor obrigatório para o monitor.' });
        }

        // valida fornecedor no tenant
        const { rowCount: fornecedorExiste } = await client.query(
            'SELECT 1 FROM fornecedores WHERE tenant_id = $1 AND id = $2',
            [tenantId, fornecedorId]
        );
        if (!fornecedorExiste) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Fornecedor não encontrado' });
        }

        // valida monitor no tenant
        const { rowCount: monitorExiste } = await client.query(
            'SELECT 1 FROM monitores WHERE tenant_id = $1 AND id = $2',
            [tenantId, id]
        );
if (!monitorExiste) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Monitor não encontrado' });
        }

        // Para FORNECEDOR_ESCOLAR: só permite editar se o monitor for do fornecedor do usuário
        const permitido = await assertMonitorVinculadoAoFornecedor(client, tenantId, id, fornecedorIdCtx);
        if (!permitido) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Monitor não encontrado' });
        }

        let documentoPessoalPath = null;
        if (Array.isArray(req.files)) {
            req.files.forEach((file) => {
                if (file.fieldname === 'arquivo_documento') documentoPessoalPath = file.path;
            });
        }

        const cursosList = parseCursosFromRequest(req);

        const values = [
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
            dados.status || 'ativo'
        ];

        let docClause = '';
        let whereTenantIdx;
        let whereIdIdx;

        if (documentoPessoalPath) {
            docClause = ', documento_pessoal_path = $13';
            values.push(documentoPessoalPath); // 13
            whereTenantIdx = 14;
            whereIdIdx = 15;
        } else {
            whereTenantIdx = 13;
            whereIdIdx = 14;
        }

        values.push(tenantId);
        values.push(id);

        const updateQuery = `
            UPDATE monitores
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
                   status = $12,
                   updated_at = NOW()
                   ${docClause}
             WHERE tenant_id = $${whereTenantIdx} AND id = $${whereIdIdx}
             RETURNING *;
        `;

        const { rows, rowCount } = await client.query(updateQuery, values);

        if (!rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Monitor não encontrado' });
        }

        // vínculo monitor_fornecedor: manter um ativo por monitor/tenant
        const { rows: vinculosAtivos } = await client.query(
            `SELECT fornecedor_id
               FROM monitor_fornecedor
              WHERE monitor_id = $1
                AND ativo = TRUE
              LIMIT 1`,
            [id]
        );

        const fornecedorAtualId = vinculosAtivos[0]?.fornecedor_id || null;

        if (fornecedorAtualId !== fornecedorId) {
            await client.query(
                `UPDATE monitor_fornecedor
                    SET ativo = FALSE
                  WHERE monitor_id = $1
                    AND ativo = TRUE`,
                [id]
            );

            await client.query(
                `INSERT INTO monitor_fornecedor (monitor_id, fornecedor_id, ativo)
                 VALUES ($1, $2, TRUE)`,
                [id, fornecedorId]
            );
        }

        // recria cursos (tenant)
        await client.query(
            'DELETE FROM monitores_cursos WHERE tenant_id = $1 AND monitor_id = $2',
            [tenantId, id]
        );

        for (const c of cursosList) {
            const tipoCurso = (typeof c.tipo === 'string' && c.tipo.trim() !== '')
                ? c.tipo.trim()
                : 'monitor_escolar';

            await client.query(
                `INSERT INTO monitores_cursos (
                    tenant_id, monitor_id, tipo, data_conclusao, validade, observacoes, arquivo_path
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

        const monitor = rows[0];
        const cursos = await carregarCursosMonitor(client, tenantId, id);
        const resumo = montarResumoCursosMonitores(cursos);

        res.json({
            ...monitor,
            documento_pessoal_url: buildArquivoUrl(monitor.documento_pessoal_path),
            cursos,
            cursos_resumo: resumo.cursos_resumo,
            cursos_obrigatorios_ok: resumo.cursos_obrigatorios_ok,
            cursos_pendentes: resumo.cursos_pendentes,
            fornecedor_id: fornecedorId
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { }
        console.error(err);
        res.status(500).json({ erro: 'Erro ao atualizar monitor' });
    } finally {
        client.release();
    }
});

// PATCH /api/monitores/:id/status
router.patch('/:id(\\d+)/status', express.json(), async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const { id } = req.params;
    const { status } = req.body;

    if (!['ativo', 'inativo'].includes(status)) {
        return res.status(400).json({ erro: 'Status inválido' });
    }

    const ctx = assertFornecedorVinculado(req, res);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId || null;

    const client = await pool.connect();
    try {
        // Para FORNECEDOR_ESCOLAR: impede mudar status de monitor de outro fornecedor
        const permitido = await assertMonitorVinculadoAoFornecedor(client, tenantId, id, fornecedorIdCtx);
        if (!permitido) return res.status(404).json({ erro: 'Monitor não encontrado' });

        const { rowCount, rows } = await client.query(
            `UPDATE monitores
                SET status = $1,
                    updated_at = NOW()
              WHERE tenant_id = $2 AND id = $3
              RETURNING *`,
            [status, tenantId, id]
        );

        if (!rowCount) return res.status(404).json({ erro: 'Monitor não encontrado' });
        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao alterar status do monitor' });
    } finally {
        client.release();
    }
});

// DELETE /api/monitores/:id
router.delete('/:id(\\d+)', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const { id } = req.params;
    const ctx = assertFornecedorVinculado(req, res);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId || null;

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // Para FORNECEDOR_ESCOLAR: impede excluir monitor de outro fornecedor
        const permitido = await assertMonitorVinculadoAoFornecedor(client, tenantId, id, fornecedorIdCtx);
        if (!permitido) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Monitor não encontrado' });
        }

        await client.query(
            'DELETE FROM monitores_cursos WHERE tenant_id = $1 AND monitor_id = $2',
            [tenantId, id]
        );
        await client.query(
            'DELETE FROM monitor_fornecedor WHERE monitor_id = $1',
            [id]
        );

        const { rowCount } = await client.query(
            'DELETE FROM monitores WHERE tenant_id = $1 AND id = $2',
            [tenantId, id]
        );

        if (!rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Monitor não encontrado' });
        }

        await client.query('COMMIT');
        res.json({ sucesso: true });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { }
        console.error(err);
        res.status(500).json({ erro: 'Erro ao excluir monitor' });
    } finally {
        client.release();
    }
});

export default router;