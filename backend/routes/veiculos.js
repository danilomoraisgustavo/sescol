// routes/veiculos.js
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
// CONTEXTO DE FORNECEDOR (SEGURANÇA)
// - Se o usuário for FORNECEDOR_ESCOLAR, sempre filtra pelos veículos
//   vinculados ao fornecedor_id do próprio usuário (tabela usuarios).
// - Isso evita depender apenas do token e impede vazamento entre fornecedores.
// ===================================================================
router.use(async (req, res, next) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return next();

    // Sempre resolve o escopo pelo BANCO (fonte de verdade), usando o id do usuário.
    // Isso garante que FORNECEDOR_ESCOLAR veja APENAS seus próprios veículos.
    const rawUserId = req?.user?.id ?? req?.user?.user_id ?? req?.user?.usuario_id;
    const userId = Number.parseInt(String(rawUserId ?? ''), 10);

    // Fallback: se não há id, tenta usar dados do token (menos confiável)
    if (!Number.isInteger(userId) || userId <= 0) {
        const fornecedorToken = getUserFornecedorId(req);
        req.fornecedorIdCtx = isFornecedorEscolar(req) ? (fornecedorToken || null) : null;
        if (isFornecedorEscolar(req) && !req.fornecedorIdCtx) {
            return res.status(403).json({ erro: 'Usuário FORNECEDOR_ESCOLAR sem fornecedor_id no token e sem id para validar no banco.' });
        }
        return next();
    }

    try {
        const { rows, rowCount } = await pool.query(
            `SELECT cargo, fornecedor_id
               FROM usuarios
              WHERE id = $1
                AND tenant_id = $2
                AND ativo = TRUE`,
            [userId, tenantId]
        );

        if (!rowCount) {
            return res.status(403).json({ erro: 'Usuário não encontrado para validar escopo.' });
        }

        const cargoDb = String(rows[0].cargo || '').toUpperCase();
        const fornecedorDb = rows[0].fornecedor_id;

        if (cargoDb === 'FORNECEDOR_ESCOLAR') {
            const fId = Number.parseInt(String(fornecedorDb ?? ''), 10);
            if (!Number.isInteger(fId) || fId <= 0) {
                return res.status(403).json({ erro: 'Usuário FORNECEDOR_ESCOLAR sem fornecedor_id vinculado.' });
            }
            req.fornecedorIdCtx = fId;
        } else {
            req.fornecedorIdCtx = null;
        }

        return next();
    } catch (err) {
        console.error(err);
        return res.status(500).json({ erro: 'Erro ao validar vínculo/escopo de fornecedor.' });
    }
});


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


function normalizeDateInput(v) {
    // Aceita: 'YYYY-MM-DD', ISO string, timestamp (ms), ou null/''.
    if (v == null) return null;
    if (typeof v === 'string') {
        const s = v.trim();
        if (!s) return null;
        // já no formato do <input type="date">
        if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        const d = new Date(s);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return null;
    }
    if (typeof v === 'number') {
        // normalmente vem como timestamp em ms
        const d = new Date(v);
        if (!Number.isNaN(d.getTime())) return d.toISOString().slice(0, 10);
        return null;
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
    const cargo = getUserCargo(req);
    // Aceita variações/typos comuns vindos do token
    if (cargo === 'FORNECEDOR_ESCOLAR' || cargo === 'FONECEDOR_ESCOLAR') return true;
    // Ex.: FORNECEDOR-ESCOLAR, fornecedor_escolar, etc
    return cargo.includes('FORNECED') && cargo.includes('ESCOLAR');
}

function assertFornecedorVinculado(req, res) {
    // Se o middleware de contexto já resolveu, usa ele
    const ctxId = req?.fornecedorIdCtx ?? req?.contextoFornecedorId ?? null;
    if (ctxId) return { ok: true, fornecedorId: ctxId };

    // Se não for fornecedor escolar, não filtra
    if (!isFornecedorEscolar(req)) return { ok: true, fornecedorId: null };

    // Caso seja fornecedor escolar, exige fornecedor_id (token ou resolvido no middleware)
    const fornecedorId = getUserFornecedorId(req);
    if (!fornecedorId) {
        res.status(403).json({ erro: 'Usuário FORNECEDOR_ESCOLAR sem vínculo de fornecedor.' });
        return { ok: false };
    }
    return { ok: true, fornecedorId };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// ===================================================================
// UPLOADS: DOCUMENTO DO VEÍCULO + ALVARÁ
// ===================================================================

const storageArquivosVeiculo = multer.diskStorage({
    destination: (req, file, cb) => {
        let dest;
        if (file.fieldname === 'arquivo_documento') {
            dest = path.join(__dirname, '..', 'uploads', 'veiculos_documentos');
        } else if (file.fieldname === 'arquivo_alvara') {
            dest = path.join(__dirname, '..', 'uploads', 'veiculos_alvaras');
        } else {
            dest = path.join(__dirname, '..', 'uploads', 'veiculos_outros');
        }
        fs.mkdirSync(dest, { recursive: true });
        cb(null, dest);
    },
    filename: (req, file, cb) => {
        const ext = path.extname(file.originalname) || '.bin';
        if (file.fieldname === 'arquivo_documento') {
            cb(null, `doc_veiculo_${Date.now()}${ext}`);
        } else if (file.fieldname === 'arquivo_alvara') {
            cb(null, `alvara_veiculo_${Date.now()}${ext}`);
        } else {
            cb(null, `arquivo_veiculo_${Date.now()}${ext}`);
        }
    }
});

const uploadVeiculo = multer({ storage: storageArquivosVeiculo });

// ===================================================================
// FUNÇÕES AUXILIARES
// ===================================================================

async function assertVeiculoDoFornecedor(client, tenantId, veiculoId, fornecedorId) {
    if (!fornecedorId) return { ok: true }; // não é fornecedor escolar

    const { rowCount } = await client.query(
        `SELECT 1
           FROM veiculo_fornecedor vf
          WHERE vf.tenant_id = $1
            AND vf.veiculo_id = $2
            AND vf.fornecedor_id = $3
            AND vf.ativo = TRUE`,
        [tenantId, veiculoId, fornecedorId]
    );

    if (!rowCount) return { ok: false };
    return { ok: true };
}

function buildArquivoUrl(filePath) {
    if (!filePath) return null;
    const parts = String(filePath).split('uploads');
    if (parts.length < 2) return null;
    return `/arquivos${parts[1]}`; // ex: /arquivos/veiculos_documentos/doc_...pdf
}

function montarResumoAlvara(veiculo) {
    if (!veiculo.alvara_validade) {
        return { alvara_resumo: 'Sem alvará informado', alvara_status: 'sem_alvara' };
    }

    const hoje = new Date();
    const validade = new Date(veiculo.alvara_validade);
    const diffMs = validade.getTime() - hoje.getTime();
    const diffDias = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

    if (diffDias < 0) {
        return { alvara_resumo: `Alvará vencido há ${Math.abs(diffDias)} dia(s)`, alvara_status: 'vencido' };
    }
    if (diffDias <= 30) {
        return { alvara_resumo: `Alvará vence em ${diffDias} dia(s)`, alvara_status: 'perto_vencer' };
    }

    return { alvara_resumo: 'Alvará em dia', alvara_status: 'em_dia' };
}

// ===================================================================
// ROTAS
// ===================================================================

// GET /api/veiculos (lista do tenant)
router.get('/', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const ctx = assertFornecedorVinculado(req, res);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId || null;

    const { id } = req.params;

    const client = await pool.connect();
    try {
        const { rows } = await client.query(
            `SELECT v.id,
                    v.placa,
                    v.prefixo,
                    v.renavam,
                    v.marca,
                    v.modelo,
                    v.ano_fabricacao,
                    v.ano_modelo,
                    v.capacidade_lotacao,
                    v.tipo_combustivel,
                    v.status,
                    v.documento_path,
                    v.documento_validade,
                    v.alvara_path,
                    v.alvara_validade,
                    v.possui_adaptacao,
                    v.possui_plataforma,
                    v.adaptacao_descricao,
                    f.id               AS fornecedor_id,
                    f.nome_fantasia    AS fornecedor_nome_fantasia,
                    f.razao_social     AS fornecedor_razao_social,
                    f.cnpj             AS fornecedor_cnpj,
                    COALESCE(re.rotas_count, 0) AS rotas_escolares_count,
                    (COALESCE(re.rotas_count, 0) > 0) AS rota_vinculada,
                    re.rotas_escolares AS rotas_escolares,
                    re.rotas_escolares_texto AS rotas_escolares_texto
               FROM veiculos v
          LEFT JOIN veiculo_fornecedor vf
                 ON vf.veiculo_id = v.id
                AND vf.ativo = TRUE
                AND vf.tenant_id = v.tenant_id
          LEFT JOIN fornecedores f
                 ON f.id = vf.fornecedor_id
                AND f.tenant_id = v.tenant_id
          LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS rotas_count,
                       json_agg(
                           json_build_object(
                               'id', r.id,
                               'nome', r.nome,
                               'tipo', r.tipo,
                               'status', r.status
                           )
                           ORDER BY r.id
                       ) AS rotas_escolares,
                       string_agg((r.nome || ' (' || r.tipo || ')'), ' | ' ORDER BY r.id) AS rotas_escolares_texto
                  FROM rotas_escolares r
                 WHERE r.tenant_id = v.tenant_id
                   AND r.veiculo_id = v.id
                   AND r.status = 'ativo'
          ) re ON TRUE
              WHERE v.tenant_id = $1
                AND ($2::bigint IS NULL OR vf.fornecedor_id = $2)
              ORDER BY v.id`,
            [tenantId, fornecedorIdCtx]
        );

        const resultado = rows.map((v) => {
            const alvaraInfo = montarResumoAlvara(v);
            return {
                ...v,
                documento_url: buildArquivoUrl(v.documento_path),
                alvara_url: buildArquivoUrl(v.alvara_path),
                alvara_resumo: alvaraInfo.alvara_resumo,
                alvara_status: alvaraInfo.alvara_status
            };
        });

        res.json(resultado);
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao listar veículos' });
    } finally {
        client.release();
    }
});

// GET /api/veiculos/:id (do tenant)
router.get('/:id(\\d+)', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const ctx = assertFornecedorVinculado(req, res);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId || null;

    const { id } = req.params;
    const client = await pool.connect();
    try {
        const { rows, rowCount } = await client.query(
            `SELECT v.*,
                    f.id            AS fornecedor_id,
                    f.nome_fantasia AS fornecedor_nome_fantasia,
                    f.razao_social  AS fornecedor_razao_social,
                    f.cnpj          AS fornecedor_cnpj,
                    COALESCE(re.rotas_count, 0) AS rotas_escolares_count,
                    (COALESCE(re.rotas_count, 0) > 0) AS rota_vinculada,
                    re.rotas_escolares AS rotas_escolares,
                    re.rotas_escolares_texto AS rotas_escolares_texto
               FROM veiculos v
          LEFT JOIN veiculo_fornecedor vf
                 ON vf.veiculo_id = v.id
                AND vf.ativo = TRUE
                AND vf.tenant_id = v.tenant_id
          LEFT JOIN fornecedores f
                 ON f.id = vf.fornecedor_id
                AND f.tenant_id = v.tenant_id
          LEFT JOIN LATERAL (
                SELECT COUNT(*)::int AS rotas_count,
                       json_agg(
                           json_build_object(
                               'id', r.id,
                               'nome', r.nome,
                               'tipo', r.tipo,
                               'status', r.status
                           )
                           ORDER BY r.id
                       ) AS rotas_escolares,
                       string_agg((r.nome || ' (' || r.tipo || ')'), ' | ' ORDER BY r.id) AS rotas_escolares_texto
                  FROM rotas_escolares r
                 WHERE r.tenant_id = v.tenant_id
                   AND r.veiculo_id = v.id
                   AND r.status = 'ativo'
          ) re ON TRUE
              WHERE v.tenant_id = $1
                AND v.id = $2
                AND ($3::bigint IS NULL OR vf.fornecedor_id = $3)`,
            [tenantId, id, fornecedorIdCtx]
        );

        if (!rowCount) return res.status(404).json({ erro: 'Veículo não encontrado' });

        const veiculo = rows[0];
        const alvaraInfo = montarResumoAlvara(veiculo);

        res.json({
            ...veiculo,
            documento_url: buildArquivoUrl(veiculo.documento_path),
            alvara_url: buildArquivoUrl(veiculo.alvara_path),
            alvara_resumo: alvaraInfo.alvara_resumo,
            alvara_status: alvaraInfo.alvara_status
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao carregar veículo' });
    } finally {
        client.release();
    }
});

// POST /api/veiculos (criar no tenant)
router.post('/', uploadVeiculo.any(), async (req, res) => {
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

        // fornecedor_id obrigatório
        let fornecedorId = fornecedorIdCtx ? Number(fornecedorIdCtx) : (dados.fornecedor_id ? parseInt(dados.fornecedor_id, 10) : null);
        if (!fornecedorId || Number.isNaN(fornecedorId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Fornecedor obrigatório para o veículo.' });
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

        let documentoPath = null;
        let alvaraPath = null;

        if (Array.isArray(req.files)) {
            req.files.forEach((file) => {
                if (file.fieldname === 'arquivo_documento') documentoPath = file.path;
                else if (file.fieldname === 'arquivo_alvara') alvaraPath = file.path;
            });
        }

        const insertQuery = `
            INSERT INTO veiculos (
                tenant_id,
                placa,
                prefixo,
                renavam,
                marca,
                modelo,
                ano_fabricacao,
                ano_modelo,
                capacidade_lotacao,
                tipo_combustivel,
                possui_adaptacao,
                possui_plataforma,
                adaptacao_descricao,
                status,
                documento_path,
                documento_validade,
                alvara_path,
                alvara_validade
            ) VALUES (
                $1,
                $2, $3, $4, $5, $6,
                $7, $8, $9, $10, $11, $12, $13,
                $14, $15, $16, $17, $18
            )
            RETURNING *;
        `;

        // FIX: ordem correta (paths nos campos *_path, validade nos campos *_validade)
        const values = [
            tenantId,                           // $1
            dados.placa,                        // $2
            dados.prefixo || null,              // $3
            dados.renavam || null,              // $4
            dados.marca || null,                // $5
            dados.modelo || null,               // $6
            dados.ano_fabricacao || null,       // $7
            dados.ano_modelo || null,           // $8
            dados.capacidade_lotacao || null,   // $9
            dados.tipo_combustivel || null,     // $10
            !!dados.possui_adaptacao,           // $11 possui_adaptacao
            !!dados.possui_plataforma,          // $12 possui_plataforma
            dados.adaptacao_descricao || null,  // $13 adaptacao_descricao
            dados.status || 'ativo',            // $14 status
            documentoPath,                      // $15 documento_path
            normalizeDateInput(dados.documento_validade),   // $16 documento_validade
            alvaraPath,                         // $17 alvara_path
            normalizeDateInput(dados.alvara_validade)       // $18 alvara_validade
        ];

        const { rows } = await client.query(insertQuery, values);
        const veiculo = rows[0];

        // cria vínculo veiculo_fornecedor ativo (tenant)
        await client.query(
            `INSERT INTO veiculo_fornecedor (tenant_id, veiculo_id, fornecedor_id, ativo)
             VALUES ($1, $2, $3, TRUE)`,
            [tenantId, veiculo.id, fornecedorId]
        );

        await client.query('COMMIT');

        const alvaraInfo = montarResumoAlvara(veiculo);

        res.status(201).json({
            ...veiculo,
            documento_url: buildArquivoUrl(veiculo.documento_path),
            alvara_url: buildArquivoUrl(veiculo.alvara_path),
            alvara_resumo: alvaraInfo.alvara_resumo,
            alvara_status: alvaraInfo.alvara_status
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { }
        console.error(err);
        res.status(500).json({ erro: 'Erro ao criar veículo' });
    } finally {
        client.release();
    }
});

// PUT /api/veiculos/:id (atualizar no tenant)
router.put('/:id(\\d+)', uploadVeiculo.any(), async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const ctx = assertFornecedorVinculado(req, res);
    if (!ctx.ok) return;
    const fornecedorIdCtx = ctx.fornecedorId || null;

    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        if (!req.body.dados) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Campo "dados" obrigatório' });
        }

        const dados = JSON.parse(req.body.dados);

        // fornecedor_id obrigatório
        let fornecedorId = fornecedorIdCtx ? Number(fornecedorIdCtx) : (dados.fornecedor_id ? parseInt(dados.fornecedor_id, 10) : null);
        if (!fornecedorId || Number.isNaN(fornecedorId)) {
            await client.query('ROLLBACK');
            return res.status(400).json({ erro: 'Fornecedor obrigatório para o veículo.' });
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

        // valida veiculo no tenant
        const { rowCount: veiculoExiste } = await client.query(
            'SELECT 1 FROM veiculos WHERE tenant_id = $1 AND id = $2',
            [tenantId, id]
        );
        if (!veiculoExiste) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Veículo não encontrado' });
        }

        let documentoPath = null;
        let alvaraPath = null;

        if (Array.isArray(req.files)) {
            req.files.forEach((file) => {
                if (file.fieldname === 'arquivo_documento') documentoPath = file.path;
                else if (file.fieldname === 'arquivo_alvara') alvaraPath = file.path;
            });
        }

        const values = [
            dados.placa,
            dados.prefixo || null,
            dados.renavam || null,
            dados.marca || null,
            dados.modelo || null,
            dados.ano_fabricacao || null,
            dados.ano_modelo || null,
            dados.capacidade_lotacao || null,
            dados.tipo_combustivel || null,
            !!dados.possui_adaptacao,
            !!dados.possui_plataforma,
            dados.adaptacao_descricao || null,
            dados.status || 'ativo',
            normalizeDateInput(dados.documento_validade),
            normalizeDateInput(dados.alvara_validade)
        ];

        // IMPORTANTÍSSIMO: não usar placeholders dinâmicos aqui.
        // Quando tentamos montar o SET de documento_path/alvara_path com índices variáveis,
        // o bind dos parâmetros se desalinha e o Postgres acaba recebendo um INTEGER em
        // coluna DATE (ex.: documento_validade).
        // Solução: placeholders fixos e COALESCE para manter o valor antigo se não veio arquivo.

        // Sempre adiciona (mesmo que null) para manter índices estáveis
        values.push(documentoPath); // $16
        values.push(alvaraPath);    // $17
        values.push(tenantId);      // $18
        values.push(id);            // $19

        const updateQuery = `
            UPDATE veiculos
               SET placa = $1,
                   prefixo = $2,
                   renavam = $3,
                   marca = $4,
                   modelo = $5,
                   ano_fabricacao = $6,
                   ano_modelo = $7,
                   capacidade_lotacao = $8,
                   tipo_combustivel = $9,
                   possui_adaptacao = $10,
                   possui_plataforma = $11,
                   adaptacao_descricao = $12,
                   status = $13,
                   documento_validade = $14,
                   alvara_validade = $15,
                   documento_path = COALESCE($16, documento_path),
                   alvara_path = COALESCE($17, alvara_path),
                   updated_at = NOW()
             WHERE tenant_id = $18 AND id = $19
             RETURNING *;
        `;

        const { rows, rowCount } = await client.query(updateQuery, values);

        if (!rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Veículo não encontrado' });
        }

        // Atualizar vínculo veiculo_fornecedor (somente um ativo por veículo)
        const { rows: vinculosAtivos } = await client.query(
            `SELECT fornecedor_id
               FROM veiculo_fornecedor
              WHERE tenant_id = $1
                AND veiculo_id = $2
                AND ativo = TRUE
              LIMIT 1`,
            [tenantId, id]
        );

        const fornecedorAtualId = vinculosAtivos[0]?.fornecedor_id || null;

        if (fornecedorAtualId !== fornecedorId) {
            await client.query(
                `UPDATE veiculo_fornecedor
                    SET ativo = FALSE,
                        updated_at = NOW()
                  WHERE tenant_id = $1
                    AND veiculo_id = $2
                    AND ativo = TRUE`,
                [tenantId, id]
            );

            await client.query(
                `INSERT INTO veiculo_fornecedor (tenant_id, veiculo_id, fornecedor_id, ativo)
                 VALUES ($1, $2, $3, TRUE)`,
                [tenantId, id, fornecedorId]
            );
        }

        await client.query('COMMIT');

        const veiculo = rows[0];
        const alvaraInfo = montarResumoAlvara(veiculo);

        res.json({
            ...veiculo,
            documento_url: buildArquivoUrl(veiculo.documento_path),
            alvara_url: buildArquivoUrl(veiculo.alvara_path),
            alvara_resumo: alvaraInfo.alvara_resumo,
            alvara_status: alvaraInfo.alvara_status
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { }
        console.error(err);
        res.status(500).json({ erro: 'Erro ao atualizar veículo' });
    } finally {
        client.release();
    }
});

// PATCH /api/veiculos/:id/status (tenant)
router.patch('/:id(\\d+)/status', express.json(), async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const { id } = req.params;
    const { status } = req.body;

    if (!['ativo', 'inativo'].includes(status)) {
        return res.status(400).json({ erro: 'Status inválido' });
    }

    try {
        const { rows, rowCount } = await pool.query(
            `UPDATE veiculos
                SET status = $1,
                    updated_at = NOW()
              WHERE tenant_id = $2 AND id = $3
              RETURNING *`,
            [status, tenantId, id]
        );

        if (!rowCount) return res.status(404).json({ erro: 'Veículo não encontrado' });

        res.json(rows[0]);
    } catch (err) {
        console.error(err);
        res.status(500).json({ erro: 'Erro ao alterar status do veículo' });
    }
});

// DELETE /api/veiculos/:id (tenant)
router.delete('/:id(\\d+)', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ erro: 'tenant_id nao resolvido' });

    const { id } = req.params;
    const client = await pool.connect();
    try {
        await client.query('BEGIN');

        // Desfaz associações do veículo com rotas escolares antes de excluir.
        await client.query(
            `UPDATE rotas_escolares
                SET veiculo_id = NULL,
                    fornecedor_id = NULL
              WHERE tenant_id = $1 AND veiculo_id = $2`,
            [tenantId, id]
        );

        await client.query(
            'DELETE FROM veiculo_fornecedor WHERE tenant_id = $1 AND veiculo_id = $2',
            [tenantId, id]
        );

        const { rowCount } = await client.query(
            'DELETE FROM veiculos WHERE tenant_id = $1 AND id = $2',
            [tenantId, id]
        );

        if (!rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ erro: 'Veículo não encontrado' });
        }

        await client.query('COMMIT');
        res.json({ sucesso: true });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { }
        console.error(err);
        res.status(500).json({ erro: 'Erro ao excluir veículo' });
    } finally {
        client.release();
    }
});

export default router;