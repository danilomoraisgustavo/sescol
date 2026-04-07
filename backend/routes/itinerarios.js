// routes/itinerarios.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

function obterTenantId(req) {
    const candidates = [
        req?.tenant_id,
        req?.tenantId,
        req?.user?.tenant_id,
        req?.user?.tenantId,
        req?.auth?.tenant_id,
        req?.auth?.tenantId,
        req?.headers?.['x-tenant-id'],
        req?.headers?.['tenant-id'],
        req?.headers?.['x-tenantid'],
        req?.headers?.['x-tenant']
    ];
    for (const c of candidates) {
        const n = Number.parseInt(String(c ?? ''), 10);
        if (Number.isInteger(n) && n > 0) return n;
    }
    return null;
}


async function obterColunaAdaptacaoVeiculo(db = pool) {
    const { rows } = await db.query(`
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'veiculos'
          AND column_name IN ('possui_adaptacao', 'carro_adaptado')
        ORDER BY CASE column_name
            WHEN 'possui_adaptacao' THEN 1
            WHEN 'carro_adaptado' THEN 2
            ELSE 99
        END
        LIMIT 1
    `);

    return rows?.[0]?.column_name || null;
}

function sqlExprVeiculoAdaptado(alias = 'v', coluna = null) {
    if (!coluna) return 'FALSE';
    return `COALESCE(${alias}.${coluna}, FALSE)`;
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
    if (!isFornecedorEscolar(req)) return { ok: true };
    const fornecedorId = getUserFornecedorId(req);
    if (!fornecedorId) {
        res.status(403).json({ error: 'Usuário FORNECEDOR_ESCOLAR sem vínculo de fornecedor.' });
        return { ok: false };
    }
    return { ok: true, fornecedorId };
}


/**
 * Monta o SELECT padrão agregando escolas e zoneamentos
 */
const BASE_SELECT = `
    SELECT
        i.id,
        i.nome,
        i.descricao,
        i.criado_em,
        i.atualizado_em,
        COALESCE(i.tipo,'municipal') AS tipo,
        COALESCE(
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'id', e.id,
                    'nome', e.nome
                )
            ) FILTER (WHERE e.id IS NOT NULL),
            '[]'::jsonb
        ) AS escolas,
        COALESCE(
            jsonb_agg(
                DISTINCT jsonb_build_object(
                    'id', z.id,
                    'nome', z.nome,
                    'tipo_zona', z.tipo_zona,
                    'tipo_geometria', z.tipo_geometria
                )
            ) FILTER (WHERE z.id IS NOT NULL),
            '[]'::jsonb
        ) AS zoneamentos
    FROM itinerarios i
    LEFT JOIN itinerario_escola ie
        ON ie.itinerario_id = i.id
    LEFT JOIN escolas e
        ON e.id = ie.escola_id
    LEFT JOIN itinerario_zoneamento iz
        ON iz.itinerario_id = i.id
    LEFT JOIN zoneamentos z
        ON z.id = iz.zoneamento_id
`;

/**
 * GET /api/itinerarios
 * Lista todos os itinerários
 */
router.get('/', async (req, res) => {
    try {
        const tenantId = obterTenantId(req);
        if (!tenantId) {
            return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
        }

        const fornecedorCtx = assertFornecedorVinculado(req, res);
        if (!fornecedorCtx.ok) return;

        let where = 'i.tenant_id = $1';
        const params = [tenantId];

        if (isFornecedorEscolar(req)) {
            where += ` AND EXISTS (
                SELECT 1
                  FROM itinerario_rotas ir
                  JOIN rotas_escolares r
                    ON r.id = ir.rota_id
                   AND r.tenant_id = i.tenant_id
                 WHERE ir.itinerario_id = i.id
                   AND ir.tenant_id = i.tenant_id
                   AND r.fornecedor_id = $2
            )`;
            params.push(fornecedorCtx.fornecedorId);
        }

        const sql = `
            ${BASE_SELECT}
            WHERE ${where}
            GROUP BY i.id
            ORDER BY i.id ASC
        `;

        const result = await pool.query(sql, params);
        return res.json(result.rows || []);
    } catch (err) {
        console.error('Erro ao listar itinerários:', err);
        return res.status(500).json({ error: 'Erro ao listar itinerários' });
    }
});

/**
 * GET /api/itinerarios/:id
 * Busca um itinerário específico
 */
/**
 * GET /api/itinerarios/zoneamentos?escolas=1,2,3
 * Retorna zoneamentos associados às escolas informadas, usando geometria (polygon/line)
 * para identificar quais zoneamentos cobrem os alunos dessas escolas.
 *
 * Motivo: o frontend pode selecionar múltiplas escolas e precisa carregar TODOS os zoneamentos
 * possíveis para essas escolas (união).
 */
router.get('/zoneamentos', async (req, res) => {
    try {
        const tenantId = obterTenantId(req);
        if (!tenantId) {
            return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
        }

        // aceita ?escolas=1,2,3 ou ?escola_ids=1,2,3 (compat)
        const raw = (req.query.escolas ?? req.query.escola_ids ?? '').toString();
        const escolaIds = raw
            .split(',')
            .map(s => parseInt(String(s).trim(), 10))
            .filter(n => Number.isInteger(n) && n > 0);

        if (!escolaIds.length) {
            return res.json([]);
        }

        const sql = `
            SELECT DISTINCT
                z.id,
                z.nome,
                z.tipo_zona,
                z.tipo_geometria
            FROM zoneamentos z
            JOIN alunos_municipais a
              ON a.tenant_id = z.tenant_id
             AND a.localizacao IS NOT NULL
            JOIN alunos_escolas ae
              ON ae.aluno_id = a.id
            WHERE z.tenant_id = $1
              AND ae.escola_id = ANY($2::int[])
              AND (
                (z.tipo_geometria = 'polygon' AND ST_Contains(z.geom, a.localizacao))
                OR
                (z.tipo_geometria = 'line' AND ST_DWithin(z.geom::geography, a.localizacao::geography, 200))
              )
            ORDER BY z.nome;
        `;

        const { rows } = await pool.query(sql, [tenantId, escolaIds]);
        return res.json(rows || []);
    } catch (err) {
        console.error('Erro ao listar zoneamentos por escolas (itinerarios/zoneamentos):', err);
        return res.status(500).json({ error: 'Erro ao listar zoneamentos' });
    }
});


router.get('/:id', async (req, res) => {
    try {
        const tenantId = obterTenantId(req);
        if (!tenantId) {
            return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
        }

        const fornecedorCtx = assertFornecedorVinculado(req, res);
        if (!fornecedorCtx.ok) return;

        const id = parseInt(req.params.id, 10);
        if (Number.isNaN(id)) {
            return res.status(400).json({ error: 'ID inválido' });
        }

        let where = 'i.id = $1 AND i.tenant_id = $2';
        const params = [id, tenantId];

        if (isFornecedorEscolar(req)) {
            where += ` AND EXISTS (
                SELECT 1
                  FROM itinerario_rotas ir
                  JOIN rotas_escolares r
                    ON r.id = ir.rota_id
                   AND r.tenant_id = i.tenant_id
                 WHERE ir.itinerario_id = i.id
                   AND ir.tenant_id = i.tenant_id
                   AND r.fornecedor_id = $3
            )`;
            params.push(fornecedorCtx.fornecedorId);
        }

        const sql = `
            ${BASE_SELECT}
            WHERE ${where}
            GROUP BY i.id
        `;

        const result = await pool.query(sql, params);

        if (!result.rows.length) {
            return res.status(404).json({ error: 'Itinerário não encontrado' });
        }

        return res.json(result.rows[0]);
    } catch (err) {
        console.error('Erro ao buscar itinerário:', err);
        return res.status(500).json({ error: 'Erro ao buscar itinerário' });
    }
});

/**
 * POST /api/itinerarios
 * Cria um novo itinerário
 * body: { escola_ids: number[], zoneamento_ids: number[], nome?, descricao? }
 */
router.post('/', async (req, res) => {
    if (isFornecedorEscolar(req)) {
        return res.status(403).json({ error: 'Ação não permitida para FORNECEDOR_ESCOLAR.' });
    }

    const { escola_ids, zoneamento_ids, nome, descricao, tipo } = req.body || {};

    const tenantId = obterTenantId(req);
    if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
    }

    const tipoNormalizado = (tipo || 'municipal').toString().trim().toLowerCase();
    const TIPOS_VALIDOS = new Set(['municipal', 'exclusiva', 'estadual']);
    if (!TIPOS_VALIDOS.has(tipoNormalizado)) {
        return res.status(400).json({ error: 'tipo inválido. Use: municipal, exclusiva ou estadual.' });
    }

    if (!Array.isArray(escola_ids) || !escola_ids.length) {
        return res.status(400).json({ error: 'Informe pelo menos uma escola.' });
    }

    if (!Array.isArray(zoneamento_ids) || !zoneamento_ids.length) {
        return res.status(400).json({ error: 'Informe pelo menos um zoneamento.' });
    }

    const escolaIds = escola_ids
        .map((id) => parseInt(id, 10))
        .filter((n) => !Number.isNaN(n));
    const zoneamentoIds = zoneamento_ids
        .map((id) => parseInt(id, 10))
        .filter((n) => !Number.isNaN(n));

    if (!escolaIds.length || !zoneamentoIds.length) {
        return res.status(400).json({ error: 'IDs de escolas ou zoneamentos inválidos.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const insertItSql = `
            INSERT INTO itinerarios (nome, descricao, tipo, tenant_id)
            VALUES ($1, $2, $3, $4)
            RETURNING id, nome, descricao, criado_em, atualizado_em
        `;
        const itResult = await client.query(insertItSql, [
            nome || null,
            descricao || null,
            tipoNormalizado,
            tenantId
        ]);
        const itinerario = itResult.rows[0];

        const insertEscolaSql = `
            INSERT INTO itinerario_escola (itinerario_id, escola_id, tenant_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (itinerario_id, escola_id) DO NOTHING
        `;
        for (const escId of escolaIds) {
            await client.query(insertEscolaSql, [itinerario.id, escId, tenantId]);
        }

        const insertZoneamentoSql = `
            INSERT INTO itinerario_zoneamento (itinerario_id, zoneamento_id, tenant_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (itinerario_id, zoneamento_id) DO NOTHING
        `;
        for (const zonId of zoneamentoIds) {
            await client.query(insertZoneamentoSql, [itinerario.id, zonId, tenantId]);
        }

        await client.query('COMMIT');

        const sqlFinal = `
            ${BASE_SELECT}
            WHERE i.id = $1 AND i.tenant_id = $2
            GROUP BY i.id
        `;
        const finalResult = await pool.query(sqlFinal, [itinerario.id, tenantId]);

        return res.status(201).json(finalResult.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro ao criar itinerário:', err);
        return res.status(500).json({ error: 'Erro ao criar itinerário' });
    } finally {
        client.release();
    }
});

/**
 * PUT /api/itinerarios/:id
 * Atualiza escolas/zoneamentos (e opcionalmente nome/descricao)
 */
router.put('/:id', async (req, res) => {
    if (isFornecedorEscolar(req)) {
        return res.status(403).json({ error: 'Ação não permitida para FORNECEDOR_ESCOLAR.' });
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
        return res.status(400).json({ error: 'ID inválido.' });
    }

    const tenantId = obterTenantId(req);
    if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
    }

    const { escola_ids, zoneamento_ids, nome, descricao, tipo } = req.body || {};

    if (!Array.isArray(escola_ids) || !escola_ids.length) {
        return res.status(400).json({ error: 'Informe pelo menos uma escola.' });
    }

    if (!Array.isArray(zoneamento_ids) || !zoneamento_ids.length) {
        return res.status(400).json({ error: 'Informe pelo menos um zoneamento.' });
    }

    const escolaIds = escola_ids
        .map((id) => parseInt(id, 10))
        .filter((n) => !Number.isNaN(n));
    const zoneamentoIds = zoneamento_ids
        .map((id) => parseInt(id, 10))
        .filter((n) => !Number.isNaN(n));

    if (!escolaIds.length || !zoneamentoIds.length) {
        return res.status(400).json({ error: 'IDs de escolas ou zoneamentos inválidos.' });
    }

    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        const updItSql = `
            UPDATE itinerarios
               SET nome = COALESCE($1, nome),
                   descricao = COALESCE($2, descricao),
                   atualizado_em = NOW()
             WHERE id = $3 AND tenant_id = $4
            RETURNING id
        `;
        const updRes = await client.query(updItSql, [
            nome || null,
            descricao || null,
            id,
            tenantId
        ]);

        if (!updRes.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Itinerário não encontrado.' });
        }

        await client.query('DELETE FROM itinerario_escola WHERE itinerario_id = $1 AND tenant_id = $2', [id, tenantId]);
        await client.query('DELETE FROM itinerario_zoneamento WHERE itinerario_id = $1 AND tenant_id = $2', [id, tenantId]);

        const insertEscolaSql = `
            INSERT INTO itinerario_escola (itinerario_id, escola_id, tenant_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (itinerario_id, escola_id) DO NOTHING
        `;
        for (const escId of escolaIds) {
            await client.query(insertEscolaSql, [id, escId, tenantId]);
        }

        const insertZoneamentoSql = `
            INSERT INTO itinerario_zoneamento (itinerario_id, zoneamento_id, tenant_id)
            VALUES ($1, $2, $3)
            ON CONFLICT (itinerario_id, zoneamento_id) DO NOTHING
        `;
        for (const zonId of zoneamentoIds) {
            await client.query(insertZoneamentoSql, [id, zonId, tenantId]);
        }

        await client.query('COMMIT');

        const sqlFinal = `
            ${BASE_SELECT}
            WHERE i.id = $1 AND i.tenant_id = $2
            GROUP BY i.id
        `;
        const finalResult = await pool.query(sqlFinal, [id, tenantId]);

        return res.json(finalResult.rows[0]);
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro ao atualizar itinerário:', err);
        return res.status(500).json({ error: 'Erro ao atualizar itinerário' });
    } finally {
        client.release();
    }
});

/**
 * DELETE /api/itinerarios/:id
 */
/**
 * DELETE /api/itinerarios/:id
 *
 * Regra: ao excluir um itinerário, também removemos (em transação):
 *  - todas as rotas ligadas (itinerario_rotas)
 *  - e, ao deletar as rotas (rotas_escolares), o banco apaga em cascata:
 *      rotas_percursos, rotas_escolares_alunos, rotas_escolares_pontos, etc.
 */
router.delete('/:id', async (req, res) => {
    if (isFornecedorEscolar(req)) {
        return res.status(403).json({ error: 'Ação não permitida para FORNECEDOR_ESCOLAR.' });
    }

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
        return res.status(400).json({ error: 'ID inválido.' });
    }

    const tenantId = obterTenantId(req);
    if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
    }


    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1) Confere se existe
        const itRes = await client.query(
            'SELECT id FROM itinerarios WHERE id = $1 AND tenant_id = $2',
            [id, tenantId]
        );
        if (itRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Itinerário não encontrado.' });
        }

        // 2) Descobre rotas vinculadas ao itinerário
        const rotasRes = await client.query(
            `SELECT ir.rota_id
               FROM itinerario_rotas ir
               JOIN rotas_escolares r ON r.id = ir.rota_id
              WHERE ir.itinerario_id = $1 AND r.tenant_id = $2`,
            [id, tenantId]
        );
        const rotaIds = rotasRes.rows.map(r => r.rota_id).filter(Boolean);

        // 3) Remove vínculos (por segurança; mesmo com FK, evita dependências inesperadas)
        await client.query('DELETE FROM itinerario_rotas WHERE itinerario_id = $1 AND tenant_id = $2', [id, tenantId]);

        // 4) Remove rotas (isto dispara cascata para percursos e tabelas-filhas)
        let rotasDeletadas = 0;
        if (rotaIds.length) {
            const delRotas = await client.query(
                'DELETE FROM rotas_escolares WHERE id = ANY($1::bigint[]) AND tenant_id = $2 RETURNING id',
                [rotaIds, tenantId]
            );
            rotasDeletadas = delRotas.rowCount || 0;
        }

        // 5) Remove o itinerário (itinerario_escola / itinerario_zoneamento já caem via ON DELETE CASCADE)
        await client.query('DELETE FROM itinerarios WHERE id = $1 AND tenant_id = $2', [id, tenantId]);

        await client.query('COMMIT');

        return res.json({
            message: 'Itinerário excluído com sucesso (com cascata de rotas/percursos).',
            itinerario_id: id,
            rotas_excluidas: rotasDeletadas
        });
    } catch (err) {
        await client.query('ROLLBACK');
        console.error('Erro ao excluir itinerário (cascata):', err);
        return res.status(500).json({ error: 'Erro ao excluir itinerário' });
    } finally {
        client.release();
    }
});

/* =======================================================================
   ROTAS ESCOLARES GERADAS A PARTIR DO ITINERÁRIO
   ======================================================================= */

/**
 * Helper: inferir turno no backend (mesma lógica do frontend)
 */
function inferirTurnoBackend(aluno) {
    let fonte = [
        aluno.turma || '',
        aluno.ano || '',
        aluno.modalidade || '',
        aluno.formato_letivo || '',
        aluno.etapa || ''
    ].join(' ').toUpperCase();

    // remover acentos
    fonte = fonte
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    if (/\b(MAT|MANHA)\b/.test(fonte)) {
        return 'Manhã';
    }
    if (/\b(VESP|VESPERTINO|TARDE)\b/.test(fonte)) {
        return 'Tarde';
    }
    if (/\b(NOT|NOITE|NOTURNO)\b/.test(fonte)) {
        return 'Noite';
    }
    if (/\b(INT|INTEGRAL)\b/.test(fonte)) {
        return 'Integral';
    }
    return 'Não informado';
}

/**
 * Helper: gera nome da rota no formato "1-A", "1-B", etc
 */
function gerarNomeRota(itinerarioId, index) {
    const baseCharCode = 'A'.charCodeAt(0);
    const letra = String.fromCharCode(baseCharCode + index); // A, B, C...
    return `${itinerarioId}-${letra}`;
}

function extrairIndiceNomeRota(nome, itinerarioId) {
    const txt = String(nome || '').trim().toUpperCase();
    const match = txt.match(new RegExp(`^${itinerarioId}-([A-Z]+)$`));
    if (!match) return -1;
    const letters = match[1];
    let value = 0;
    for (const ch of letters) {
        value = (value * 26) + (ch.charCodeAt(0) - 64);
    }
    return value - 1;
}

function indiceParaSufixo(indice) {
    let n = Number(indice) + 1;
    let out = '';
    while (n > 0) {
        const rem = (n - 1) % 26;
        out = String.fromCharCode(65 + rem) + out;
        n = Math.floor((n - 1) / 26);
    }
    return out || 'A';
}

async function obterProximoNomeRotaDoItinerario(client, itinerarioId, tenantId) {
    const { rows } = await client.query(
        `
        SELECT r.nome
          FROM itinerario_rotas ir
          JOIN rotas_escolares r
            ON r.id = ir.rota_id
           AND r.tenant_id = ir.tenant_id
         WHERE ir.itinerario_id = $1
           AND ir.tenant_id = $2
        `,
        [itinerarioId, tenantId]
    );

    let maxIndex = -1;
    for (const row of (rows || [])) {
        const idx = extrairIndiceNomeRota(row.nome, itinerarioId);
        if (idx > maxIndex) maxIndex = idx;
    }
    return `${itinerarioId}-${indiceParaSufixo(maxIndex + 1)}`;
}

async function carregarDadosManuaisDoItinerario(client, itinerarioId, tenantId) {
    const itRes = await client.query(
        `
        SELECT i.id, COALESCE(i.tipo, 'municipal') AS tipo
          FROM itinerarios i
         WHERE i.id = $1
           AND i.tenant_id = $2
         LIMIT 1
        `,
        [itinerarioId, tenantId]
    );
    if (!itRes.rowCount) {
        return null;
    }

    const tipo = (itRes.rows[0].tipo || 'municipal').toString().toLowerCase();

    const escolasRes = await client.query(
        `
        SELECT DISTINCT
               e.id,
               e.nome,
               ST_Y(e.localizacao)::float AS lat,
               ST_X(e.localizacao)::float AS lng
          FROM itinerario_escola ie
          JOIN escolas e
            ON e.id = ie.escola_id
         WHERE ie.itinerario_id = $1
           AND ie.tenant_id = $2
         ORDER BY e.nome
        `,
        [itinerarioId, tenantId]
    );
    const escolas = (escolasRes.rows || []).map(r => ({
        id: Number(r.id),
        nome: r.nome,
        lat: r.lat != null ? Number(r.lat) : null,
        lng: r.lng != null ? Number(r.lng) : null
    }));
    const escolaIds = escolas.map(e => e.id).filter(n => Number.isInteger(n) && n > 0);

    const zoneRes = await client.query(
        `
        SELECT DISTINCT zoneamento_id
          FROM itinerario_zoneamento
         WHERE itinerario_id = $1
           AND tenant_id = $2
        `,
        [itinerarioId, tenantId]
    );
    const zoneamentoIds = (zoneRes.rows || []).map(r => Number(r.zoneamento_id)).filter(n => Number.isInteger(n) && n > 0);

    let pontos = [];
    let pontoIds = [];

    if (zoneamentoIds.length) {
        const pontosRes = await client.query(
            `
            WITH zona AS (
                SELECT UNNEST($1::int[]) AS zoneamento_id
            ),
            pontos_zona AS (
                SELECT DISTINCT p.id,
                       TRIM(CONCAT_WS(' - ',
                           NULLIF(TRIM(COALESCE(p.logradouro, '')), ''),
                           NULLIF(TRIM(COALESCE(p.numero, '')), ''),
                           NULLIF(TRIM(COALESCE(p.bairro, '')), '')
                       )) AS nome,
                       p.logradouro,
                       p.numero,
                       p.bairro,
                       p.referencia,
                       p.status,
                       ST_Y(p.localizacao)::float AS lat,
                       ST_X(p.localizacao)::float AS lng
                  FROM pontos_parada p
                  JOIN zona z
                    ON z.zoneamento_id = p.zoneamento_id
                 WHERE p.tenant_id = $2
                UNION
                SELECT DISTINCT p.id,
                       TRIM(CONCAT_WS(' - ',
                           NULLIF(TRIM(COALESCE(p.logradouro, '')), ''),
                           NULLIF(TRIM(COALESCE(p.numero, '')), ''),
                           NULLIF(TRIM(COALESCE(p.bairro, '')), '')
                       )) AS nome,
                       p.logradouro,
                       p.numero,
                       p.bairro,
                       p.referencia,
                       p.status,
                       ST_Y(p.localizacao)::float AS lat,
                       ST_X(p.localizacao)::float AS lng
                  FROM pontos_zoneamentos pz
                  JOIN pontos_parada p
                    ON p.id = pz.ponto_id
                   AND p.tenant_id = $2
                  JOIN zona z
                    ON z.zoneamento_id = pz.zoneamento_id
            )
            SELECT *
              FROM pontos_zona
             ORDER BY COALESCE(nome, logradouro, referencia, bairro, id::text)
            `,
            [zoneamentoIds, tenantId]
        );
        pontos = (pontosRes.rows || []).map(r => ({
            id: Number(r.id),
            nome: r.nome || null,
            logradouro: r.logradouro || null,
            numero: r.numero || null,
            referencia: r.referencia || null,
            bairro: r.bairro || null,
            status: r.status || null,
            lat: r.lat != null ? Number(r.lat) : null,
            lng: r.lng != null ? Number(r.lng) : null
        }));
        pontoIds = pontos.map(p => p.id).filter(n => Number.isInteger(n) && n > 0);
    }

    let alunos = [];
    if (escolaIds.length && pontoIds.length) {
        const alunosRes = await client.query(
            `
            SELECT
                a.id,
                a.pessoa_nome,
                a.turma,
                a.ano,
                a.modalidade,
                a.formato_letivo,
                a.etapa,
                ap.ponto_id,
                ST_Y(a.localizacao)::float AS lat,
                ST_X(a.localizacao)::float AS lng,
                ae.escola_id,
                e.nome AS escola_nome
            FROM alunos_municipais a
            JOIN alunos_pontos ap
              ON ap.aluno_id = a.id
            JOIN alunos_escolas ae
              ON ae.aluno_id = a.id
             AND ae.tenant_id = a.tenant_id
            LEFT JOIN escolas e
              ON e.id = ae.escola_id
            WHERE a.tenant_id = $3
              AND a.transporte_apto = TRUE
              AND COALESCE(a.rota_exclusiva, FALSE) = FALSE
              AND ae.escola_id = ANY($1::int[])
              AND ap.ponto_id = ANY($2::int[])
            ORDER BY a.pessoa_nome
            `,
            [escolaIds, pontoIds, tenantId]
        );

        const mapAlunos = new Map();
        for (const row of (alunosRes.rows || [])) {
            const id = Number(row.id);
            if (!mapAlunos.has(id)) {
                mapAlunos.set(id, {
                    id,
                    nome: row.pessoa_nome,
                    lat: row.lat != null ? Number(row.lat) : null,
                    lng: row.lng != null ? Number(row.lng) : null,
                    turno: inferirTurnoBackend(row),
                    escola_id: row.escola_id != null ? Number(row.escola_id) : null,
                    escola_nome: row.escola_nome || null,
                    ponto_ids: []
                });
            }
            const aluno = mapAlunos.get(id);
            const pid = Number(row.ponto_id);
            if (Number.isInteger(pid) && pid > 0 && !aluno.ponto_ids.includes(pid)) {
                aluno.ponto_ids.push(pid);
            }
        }
        alunos = Array.from(mapAlunos.values()).filter(a => a.turno !== 'Não informado');
    }

    const nomePrevisto = await obterProximoNomeRotaDoItinerario(client, itinerarioId, tenantId);

    return {
        itinerario_id: itinerarioId,
        tipo,
        nome_previsto: nomePrevisto,
        escolas,
        escola_ids: escolaIds,
        zoneamento_ids: zoneamentoIds,
        pontos,
        ponto_ids: pontoIds,
        alunos
    };
}

/**
 * GET /api/itinerarios/:id/geracao-manual-dados
 * Carrega escolas, pontos e alunos para montagem manual da rota no mapa.
 */
router.get('/:id/geracao-manual-dados', async (req, res) => {
    const itinerarioId = parseInt(req.params.id, 10);
    if (!Number.isInteger(itinerarioId)) {
        return res.status(400).json({ error: 'ID de itinerário inválido.' });
    }

    try {
        const tenantId = obterTenantId(req);
        if (!tenantId) {
            return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
        }

        const fornecedorCtx = assertFornecedorVinculado(req, res);
        if (!fornecedorCtx.ok) return;

        const client = await pool.connect();
        try {
            const dados = await carregarDadosManuaisDoItinerario(client, itinerarioId, tenantId);
            if (!dados) {
                return res.status(404).json({ error: 'Itinerário não encontrado.' });
            }
            return res.json(dados);
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Erro ao carregar dados da geração manual do itinerário:', err);
        return res.status(500).json({ error: 'Erro ao carregar dados da geração manual.' });
    }
});

/**
 * POST /api/itinerarios/:id/rotas-manual
 * Cria uma rota a partir da seleção ordenada de pontos no mapa.
 */
router.post('/:id/rotas-manual', async (req, res) => {
    if (isFornecedorEscolar(req)) {
        return res.status(403).json({ error: 'Ação não permitida para FORNECEDOR_ESCOLAR.' });
    }

    const itinerarioId = parseInt(req.params.id, 10);
    if (!Number.isInteger(itinerarioId)) {
        return res.status(400).json({ error: 'ID de itinerário inválido.' });
    }

    const tenantId = obterTenantId(req);
    if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
    }

    const pontoIdsBody = Array.isArray(req.body?.ponto_ids) ? req.body.ponto_ids : [];
    const pontoIds = pontoIdsBody
        .map(v => Number.parseInt(String(v), 10))
        .filter((v, i, arr) => Number.isInteger(v) && v > 0 && arr.indexOf(v) === i);

    if (!pontoIds.length) {
        return res.status(400).json({ error: 'Selecione pelo menos um ponto de parada.' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const dados = await carregarDadosManuaisDoItinerario(client, itinerarioId, tenantId);
        if (!dados) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Itinerário não encontrado.' });
        }

        const pontosValidos = new Set((dados.pontos || []).map(p => Number(p.id)));
        const pontosInvalidos = pontoIds.filter(pid => !pontosValidos.has(pid));
        if (pontosInvalidos.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Há pontos selecionados que não pertencem a este itinerário.' });
        }

        const alunosSelecionados = (dados.alunos || []).filter(aluno =>
            Array.isArray(aluno.ponto_ids) && aluno.ponto_ids.some(pid => pontoIds.includes(Number(pid)))
        );

        if (!alunosSelecionados.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Nenhum aluno elegível foi encontrado para os pontos selecionados.' });
        }

        const nomeRota = await obterProximoNomeRotaDoItinerario(client, itinerarioId, tenantId);

        const cont = { manha: 0, tarde: 0, noite: 0, integral: 0 };
        const contPorPonto = new Map();

        for (const aluno of alunosSelecionados) {
            const turno = aluno.turno;
            if (turno === 'Manhã') cont.manha += 1;
            if (turno === 'Tarde') cont.tarde += 1;
            if (turno === 'Noite') cont.noite += 1;
            if (turno === 'Integral') cont.integral += 1;

            const pid = (aluno.ponto_ids || []).find(x => pontoIds.includes(Number(x)));
            if (pid) contPorPonto.set(Number(pid), (contPorPonto.get(Number(pid)) || 0) + 1);
        }

        const totalAlunos = alunosSelecionados.length;
        const insertRota = await client.query(
            `
            INSERT INTO rotas_escolares (
                nome,
                veiculo_id,
                fornecedor_id,
                capacidade,
                qtd_alunos_manha,
                qtd_alunos_tarde,
                qtd_alunos_noite,
                qtd_alunos_integral,
                qtd_paradas,
                status,
                tipo,
                tenant_id
            )
            VALUES ($1, NULL, NULL, $2, $3, $4, $5, $6, $7, 'ativo', $8, $9)
            RETURNING id, nome, capacidade, qtd_alunos_manha, qtd_alunos_tarde, qtd_alunos_noite, qtd_alunos_integral, qtd_paradas, status, tipo
            `,
            [
                nomeRota,
                totalAlunos,
                cont.manha,
                cont.tarde,
                cont.noite,
                cont.integral,
                pontoIds.length,
                dados.tipo || 'municipal',
                tenantId
            ]
        );
        const rota = insertRota.rows[0];

        await client.query(
            `INSERT INTO itinerario_rotas (itinerario_id, rota_id, tenant_id)
             VALUES ($1, $2, $3)`,
            [itinerarioId, rota.id, tenantId]
        );

        for (const aluno of alunosSelecionados) {
            const pontoPrincipal = (aluno.ponto_ids || []).find(x => pontoIds.includes(Number(x))) || null;
            await client.query(
                `
                INSERT INTO rotas_escolares_alunos (rota_id, aluno_id, ponto_id, tenant_id)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (rota_id, aluno_id) DO NOTHING
                `,
                [rota.id, aluno.id, pontoPrincipal, tenantId]
            );
        }

        for (const pid of pontoIds) {
            await client.query(
                `
                INSERT INTO rotas_escolares_pontos (rota_id, ponto_id, qtd_alunos, tenant_id)
                VALUES ($1, $2, $3, $4)
                ON CONFLICT (rota_id, ponto_id)
                DO UPDATE SET qtd_alunos = EXCLUDED.qtd_alunos
                `,
                [rota.id, pid, Number(contPorPonto.get(Number(pid)) || 0), tenantId]
            );
        }

        await client.query('COMMIT');

        return res.status(201).json({
            success: true,
            message: `Rota ${rota.nome} criada com sucesso.`,
            rota: {
                id: rota.id,
                nome: rota.nome,
                capacidade: rota.capacidade,
                qtd_alunos_manha: rota.qtd_alunos_manha,
                qtd_alunos_tarde: rota.qtd_alunos_tarde,
                qtd_alunos_noite: rota.qtd_alunos_noite,
                qtd_alunos_integral: rota.qtd_alunos_integral,
                qtd_paradas: rota.qtd_paradas,
                status: rota.status,
                veiculo_nome: null,
                veiculo_placa: null,
                empresa: null
            }
        });
    } catch (err) {
        try { if (client) await client.query('ROLLBACK'); } catch (e) { }
        console.error('Erro ao salvar rota manual do itinerário:', err);
        return res.status(500).json({ error: 'Erro ao salvar rota manual do itinerário.' });
    } finally {
        if (client) client.release();
    }
});

/**
 * GET /api/itinerarios/:id/rotas
 * Lista rotas escolares associadas ao itinerário
 */
router.get('/:id/rotas', async (req, res) => {
    const itinerarioId = parseInt(req.params.id, 10);
    if (!Number.isInteger(itinerarioId)) {
        return res.status(400).json({ error: 'ID de itinerário inválido' });
    }

    const tenantId = obterTenantId(req);
    if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
    }

    const fornecedorCtx = assertFornecedorVinculado(req, res);
    if (!fornecedorCtx.ok) return;

    try {
        const colunaAdaptacaoVeiculo = await obterColunaAdaptacaoVeiculo(pool);
        const exprVeiculoAdaptado = sqlExprVeiculoAdaptado('v', colunaAdaptacaoVeiculo);

        const params = [itinerarioId, tenantId];
        let extraWhere = '';
        if (isFornecedorEscolar(req)) {
            extraWhere = ' AND r.fornecedor_id = $3';
            params.push(fornecedorCtx.fornecedorId);
        }

        const sql = `
            SELECT 
                r.id,
                r.nome,
                r.capacidade,
                r.qtd_alunos_manha,
                r.qtd_alunos_tarde,
                r.qtd_alunos_noite,
                r.qtd_alunos_integral,
                r.qtd_paradas,
                r.status,

                v.placa              AS veiculo_placa,
                COALESCE(v.prefixo, v.modelo) AS veiculo_nome,
                v.capacidade_lotacao AS capacidade_veiculo,
                ${exprVeiculoAdaptado} AS veiculo_adaptado,

                COALESCE(f.nome_fantasia, f.razao_social) AS fornecedor_nome
            FROM itinerario_rotas ir
            JOIN rotas_escolares r ON r.id = ir.rota_id AND r.tenant_id = $2
            LEFT JOIN veiculos v ON v.id = r.veiculo_id AND v.tenant_id = r.tenant_id
            LEFT JOIN veiculo_fornecedor vf 
                ON vf.veiculo_id = v.id AND vf.ativo = TRUE AND vf.tenant_id = r.tenant_id
            LEFT JOIN fornecedores f ON f.id = vf.fornecedor_id AND f.tenant_id = r.tenant_id
            WHERE ir.itinerario_id = $1 AND ir.tenant_id = $2${extraWhere}
            ORDER BY r.id;
        `;

        const { rows } = await pool.query(sql, params);

        const rotas = rows.map(r => ({
            id: r.id,
            nome: r.nome,
            capacidade: r.capacidade || r.capacidade_veiculo || null,
            qtd_alunos_manha: r.qtd_alunos_manha,
            qtd_alunos_tarde: r.qtd_alunos_tarde,
            qtd_alunos_noite: r.qtd_alunos_noite,
            qtd_alunos_integral: r.qtd_alunos_integral,
            qtd_paradas: r.qtd_paradas,
            status: r.status,
            veiculo_nome: r.veiculo_nome,
            veiculo_placa: r.veiculo_placa,
            veiculo_adaptado: !!r.veiculo_adaptado,
            empresa: r.fornecedor_nome
        }));

        res.json(rotas);
    } catch (err) {
        console.error('Erro ao listar rotas do itinerário', err);
        res.status(500).json({ error: 'Erro ao listar rotas do itinerário' });
    }
});

/**
 * POST /api/itinerarios/:id/gerar-rotas
 * Gera rotas inteligentes com base em pontos, alunos, turno e capacidade
 * IMPORTANTE: sobrescreve rotas existentes do itinerário.
 */
router.post('/:id/gerar-rotas', async (req, res) => {
    if (isFornecedorEscolar(req)) {
        return res.status(403).json({ error: 'Ação não permitida para FORNECEDOR_ESCOLAR.' });
    }

    const itinerarioId = parseInt(req.params.id, 10);
    if (!Number.isInteger(itinerarioId)) {
        return res.status(400).json({ error: 'ID de itinerário inválido' });
    }


    const tenantId = obterTenantId(req);
    if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
    }
    const client = await pool.connect();

    try {
        await client.query('BEGIN');

        // 1) Garante que o itinerário existe
        const itRes = await client.query(
            "SELECT id, COALESCE(tipo,'municipal') AS tipo FROM itinerarios WHERE id = $1 AND tenant_id = $2",
            [itinerarioId, tenantId]
        );
        if (itRes.rowCount === 0) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Itinerário não encontrado' });
        }

        const itinerarioTipo = (itRes.rows[0]?.tipo || 'municipal').toString().trim().toLowerCase();

        // Opções de geração (podem vir do frontend no body do POST)
        // politica_veiculo_turno:
        //   - 'multi' (default): um veículo pode operar em mais de um turno, desde que não conflite (mesmo turno)
        //   - 'um_turno': um veículo só pode ser usado em 1 turno no sistema (se usado em manhã, não pode pegar tarde/noite etc.)
        // filtro_deficiencia (aplica-se a itinerários municipal/estadual):
        //   - 'somente_sem' (default em municipal/estadual): inclui apenas alunos sem deficiência
        //   - 'somente_com': inclui apenas alunos com deficiência
        //   - 'todos': inclui todos

        // modo_turnos (como o frontend envia no payload):
        //   - 'diurno'       : Manhã + Tarde (pode compartilhar frota; pode misturar turnos na mesma rota)
        //   - 'manha_noite'  : Manhã + Noite (pode compartilhar frota; pode misturar turnos na mesma rota)
        //   - 'tarde_noite'  : Tarde + Noite (pode compartilhar frota; pode misturar turnos na mesma rota)
        //   - 'um_turno'     : Manhã e Tarde separados (não mistura manhã/tarde na mesma rota)
        //   - 'noturno'      : Somente Noite
        //   - 'tri_turno'    : Manhã + Tarde + Noite (comportamento padrão)
        //   - 'somente_manha': Somente Manhã
        //   - 'somente_tarde': Somente Tarde
        const rawModoTurnos = (req.body && req.body.modo_turnos != null)
            ? String(req.body.modo_turnos).trim().toLowerCase()
            : '';
        const modoTurnos = ([
            'diurno',
            'manha_noite', 'manha-noite',
            'tarde_noite', 'tarde-noite',
            'integral_noite', 'integral-noite',
            'um_turno',
            'noturno',
            'tri_turno', 'tri-turno',
            'somente_manha', 'somente-manha', 'manha', 'morning',
            'somente_tarde', 'somente-tarde', 'tarde', 'afternoon'
        ].includes(rawModoTurnos))
            ? (rawModoTurnos === 'tri-turno' ? 'tri_turno'
                : rawModoTurnos === 'somente-manha' ? 'somente_manha'
                    : rawModoTurnos === 'somente-tarde' ? 'somente_tarde'
                        : rawModoTurnos === 'manha' ? 'somente_manha'
                            : rawModoTurnos === 'tarde' ? 'somente_tarde'
                                : rawModoTurnos === 'manha-noite' ? 'manha_noite'
                                    : rawModoTurnos === 'tarde-noite' ? 'tarde_noite'
                                        : rawModoTurnos === 'integral-noite' ? 'integral_noite'
                                            : rawModoTurnos)
            : 'tri_turno';

        // modo_escolas (estratégia de agrupamento por escola):
        //   - '' (default): decide automaticamente
        //   - 'padrao'     : comportamento anterior (mistura escolas no mesmo bucket)
        //   - 'por_escola' : tenta manter cada rota com uma escola (reduz ônibus passando em todas as escolas)
        const rawModoEscolas = (req.body && req.body.modo_escolas != null)
            ? String(req.body.modo_escolas).trim().toLowerCase()
            : '';
        let modoEscolas = (['padrao', 'por_escola', 'auto', ''].includes(rawModoEscolas))
            ? (rawModoEscolas === 'auto' ? '' : rawModoEscolas)
            : '';



        // modo_alocacao (como o frontend envia no payload):
        //   - 'unificar'    : comportamento padrão (concentra alunos em menos veículos)
        //   - 'distribuir'  : espalha alunos entre veículos disponíveis, priorizando menor tempo de rota
        const rawModoAlocacao = (req.body && req.body.modo_alocacao != null)
            ? String(req.body.modo_alocacao).trim().toLowerCase()
            : '';
        const modoAlocacao = (rawModoAlocacao === 'distribuir' || rawModoAlocacao === 'unificar')
            ? rawModoAlocacao
            : 'unificar';



        // Turnos permitidos por modo. Integral permanece como turno próprio e é sempre considerado,
        // exceto nos modos explicitamente "somente_*" e "noturno".
        const turnosPermitidos = new Set();
        if (modoTurnos === 'noturno') {
            turnosPermitidos.add('Noite');
        } else if (modoTurnos === 'somente_manha') {
            turnosPermitidos.add('Manhã');
        } else if (modoTurnos === 'somente_tarde') {
            turnosPermitidos.add('Tarde');
        } else if (modoTurnos === 'diurno' || modoTurnos === 'um_turno') {
            turnosPermitidos.add('Manhã');
            turnosPermitidos.add('Tarde');
            // Mantém Integral por compatibilidade (se houver), isolado das demais.
            turnosPermitidos.add('Integral');
        } else if (modoTurnos === 'manha_noite') {
            turnosPermitidos.add('Manhã');
            turnosPermitidos.add('Noite');
            // Mantém Integral por compatibilidade (se houver), isolado das demais.
            turnosPermitidos.add('Integral');
        } else if (modoTurnos === 'tarde_noite') {
            turnosPermitidos.add('Tarde');
            turnosPermitidos.add('Noite');
            // Mantém Integral por compatibilidade (se houver), isolado das demais.
            turnosPermitidos.add('Integral');
        } else if (modoTurnos === 'integral_noite') {
            turnosPermitidos.add('Integral');
            turnosPermitidos.add('Noite');
        } else { // tri_turno (default)
            turnosPermitidos.add('Manhã');
            turnosPermitidos.add('Tarde');
            turnosPermitidos.add('Noite');
            turnosPermitidos.add('Integral');
        }

        const rawPolitica = (req.body && req.body.politica_veiculo_turno != null)
            ? String(req.body.politica_veiculo_turno).trim().toLowerCase()
            : '';
        const politicaVeiculoTurno = (['um', 'um_turno', 'um-turno', 'single', 'only_one', 'apenas_um'].includes(rawPolitica))
            ? 'um_turno'
            : 'multi';


        // Regra de elegibilidade:
        // - itinerário tipo 'exclusiva'  -> inclui SOMENTE alunos com DEFICIÊNCIA (não nula/vazia)
        //                                 E com `rota_exclusiva = TRUE` (busca em casa pela localização do aluno).
        // - itinerário tipo 'municipal'/'estadual' -> inclui SOMENTE alunos com `rota_exclusiva = FALSE` (ou NULL)
        //
        // Observação: mantemos `filtro_deficiencia` apenas por compatibilidade com front-ends antigos.
        // 2) Remove rotas anteriores do itinerário (sobrescrever sempre)
        const rotasAntigasRes = await client.query(
            `SELECT 
                        ir.rota_id,
                        r.veiculo_id,
                        r.nome,
                        COALESCE(
                            array_agg(DISTINCT mr.motorista_id) FILTER (WHERE mr.motorista_id IS NOT NULL),
                            '{}'::bigint[]
                        ) AS motorista_ids,
                        COALESCE(
                            array_agg(DISTINCT mnr.monitor_id) FILTER (WHERE mnr.monitor_id IS NOT NULL),
                            '{}'::bigint[]
                        ) AS monitor_ids
                       FROM itinerario_rotas ir
                       JOIN rotas_escolares r 
                         ON r.id = ir.rota_id
                        AND r.tenant_id = ir.tenant_id
                       LEFT JOIN motoristas_rotas mr
                         ON mr.rota_escolar_id = r.id
                        AND mr.tenant_id = r.tenant_id
                       LEFT JOIN monitores_rotas mnr
                         ON mnr.rota_escolar_id = r.id
                        AND mnr.tenant_id = r.tenant_id
                      WHERE ir.itinerario_id = $1 
                        AND ir.tenant_id = $2
                      GROUP BY ir.rota_id, r.veiculo_id, r.nome, r.id
                      ORDER BY r.id ASC`,
            [itinerarioId, tenantId]
        );
        const rotaIdsAntigas = rotasAntigasRes.rows.map(r => r.rota_id);

        // Modo de geração:
        // - por padrão, se já existem rotas para o itinerário, trabalhamos em modo incremental
        //   (somente inclui novos alunos ainda não associados a nenhuma rota deste itinerário),
        //   para não prejudicar a logística já definida.
        // - para forçar sobrescrever/regenerar tudo, envie no body: { modo_geracao: 'sobrescrever' }
        const modoGeracao = (req.body && req.body.modo_geracao ? String(req.body.modo_geracao) : 'auto').trim().toLowerCase();
        const incrementalMode = rotaIdsAntigas.length > 0 && modoGeracao !== 'sobrescrever' && modoGeracao !== 'regenerar';


        // Se já existiam rotas e o usuário trocou veículos/motoristas/monitores manualmente, queremos RESPEITAR
        // essas associações na próxima geração. Usamos a ordem por r.id (estável) como fila de preferência.
        const veiculosFixosFila = (rotasAntigasRes.rows || [])
            .map(r => (r.veiculo_id != null ? Number(r.veiculo_id) : null))
            .filter(v => Number.isInteger(v) && v > 0);

        const motoristasFixosFila = (rotasAntigasRes.rows || [])
            .map(r => (Array.isArray(r.motorista_ids) ? r.motorista_ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : []));

        const monitoresFixosFila = (rotasAntigasRes.rows || [])
            .map(r => (Array.isArray(r.monitor_ids) ? r.monitor_ids.map(Number).filter(n => Number.isInteger(n) && n > 0) : []));

        if (!incrementalMode && rotaIdsAntigas.length) {
            await client.query(
                'DELETE FROM rotas_escolares_alunos WHERE rota_id = ANY($1::bigint[]) AND tenant_id = $2',
                [rotaIdsAntigas, tenantId]
            );
            await client.query(
                'DELETE FROM rotas_escolares_pontos WHERE rota_id = ANY($1::bigint[]) AND tenant_id = $2',
                [rotaIdsAntigas, tenantId]
            );
            await client.query(
                'DELETE FROM itinerario_rotas WHERE itinerario_id = $1 AND tenant_id = $2',
                [itinerarioId, tenantId]
            );
            await client.query(
                'DELETE FROM rotas_escolares WHERE id = ANY($1::bigint[]) AND tenant_id = $2',
                [rotaIdsAntigas, tenantId]
            );
        }

        // 3) Recupera escolas e zoneamentos do itinerário
        const escolasRes = await client.query(
            'SELECT escola_id FROM itinerario_escola WHERE itinerario_id = $1',
            [itinerarioId]
        );
        const zoneamentosRes = await client.query(
            'SELECT zoneamento_id FROM itinerario_zoneamento WHERE itinerario_id = $1',
            [itinerarioId]
        );

        const escolaIds = escolasRes.rows.map(r => r.escola_id);
        const zoneamentoIds = zoneamentosRes.rows.map(r => r.zoneamento_id);

        if (!escolaIds.length || !zoneamentoIds.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({
                error: 'Itinerário sem escolas ou zoneamentos associados'
            });
        }

        // Decide modoEscolas automaticamente quando não vier do frontend
        // (padrão: em municipal/estadual com mais de uma escola, usa 'por_escola')
        if (!modoEscolas) {
            const multiEscola = Array.isArray(escolaIds) && escolaIds.length > 1;
            if (itinerarioTipo !== 'exclusiva' && multiEscola && (itinerarioTipo === 'municipal' || itinerarioTipo === 'estadual')) {
                modoEscolas = 'por_escola';
            } else {
                modoEscolas = 'padrao';
            }
        }


        // 4) Alunos elegíveis (varia conforme o tipo do itinerário)
        let alunos = [];
        let pontoIdsElegiveis = null;

        function temDeficiencia(v) {
            if (v === null || v === undefined) return false;
            const s = String(v).trim();
            return s.length > 0;
        }

        if (itinerarioTipo === 'exclusiva') {
            // Rotas Exclusivas: alunos com deficiência (deficiencia NOT NULL / NOT vazio)
            // E com rota_exclusiva = TRUE. Não usa ponto de parada: a rota busca na localização do aluno (casa).
            const alunosSqlExclusiva = `
                SELECT 
                    a.id              AS aluno_id,
                    a.turma,
                    a.ano,
                    a.modalidade,
                    a.formato_letivo,
                    a.etapa,
                    a.transporte_apto,
                    a.deficiencia,
                    a.rota_exclusiva,
                    a.localizacao,
                    zmatch.zoneamento_id
                FROM alunos_municipais a
                JOIN alunos_escolas ae ON ae.aluno_id = a.id
                JOIN LATERAL (
                    SELECT z.id AS zoneamento_id
                    FROM zoneamentos z
                    WHERE z.tenant_id = a.tenant_id
                      AND z.id = ANY($3::int[])
                      AND (
                        (z.tipo_geometria = 'polygon' AND ST_Contains(z.geom, a.localizacao))
                        OR
                        (z.tipo_geometria = 'line' AND ST_DWithin(z.geom::geography, a.localizacao::geography, 200))
                      )
                    ORDER BY
                      CASE WHEN z.tipo_geometria = 'polygon' THEN 0 ELSE 1 END,
                      ST_Distance(z.geom::geography, a.localizacao::geography)
                    LIMIT 1
                ) zmatch ON TRUE
                WHERE a.tenant_id = $2
                  AND a.transporte_apto = TRUE
                  AND ae.escola_id = ANY($1::int[])
                  AND COALESCE(a.rota_exclusiva, FALSE) = TRUE
                  AND a.deficiencia IS NOT NULL
                  AND BTRIM(a.deficiencia) <> ''
                  AND a.localizacao IS NOT NULL
            `;
            const alunosRes = await client.query(alunosSqlExclusiva, [escolaIds, tenantId, zoneamentoIds]);

            alunos = (alunosRes.rows || []).map(row => {
                const turno = inferirTurnoBackend(row);
                return {
                    aluno_id: row.aluno_id,
                    ponto_id: null,
                    turno
                };
            });
        } else {
            // Rotas Municipais/Estaduais (por enquanto seguem a mesma lógica baseada em ponto de parada)
            // 4.1) PONTOS vinculados aos zoneamentos do itinerário
            const pontosSql = `
                WITH zona AS (
                    SELECT UNNEST($1::int[]) AS zoneamento_id
                ),
                pontos_zona AS (
                    SELECT DISTINCT p.id
                    FROM pontos_parada p
                    JOIN zona z ON z.zoneamento_id = p.zoneamento_id
                    WHERE p.status = 'ativo'
                    UNION
                    SELECT DISTINCT pz.ponto_id
                    FROM pontos_zoneamentos pz
                    JOIN pontos_parada p ON p.id = pz.ponto_id
                    JOIN zona z ON z.zoneamento_id = pz.zoneamento_id
                    WHERE p.status = 'ativo'
                )
                SELECT id AS ponto_id
                FROM pontos_zona;
            `;
            const pontosRes = await client.query(pontosSql, [zoneamentoIds]);
            const pontoIds = (pontosRes.rows || []).map(r => r.ponto_id);
            pontoIdsElegiveis = pontoIds;

            if (!pontoIds.length) {
                await client.query('ROLLBACK');
                return res.status(200).json({
                    message: 'Nenhum ponto de parada ativo encontrado para este itinerário',
                    rotas: []
                });
            }

            // 4.2) Alunos vinculados a esses pontos E às escolas do itinerário
            const alunosSql = `
                SELECT 
                    a.id              AS aluno_id,
                    a.turma,
                    a.ano,
                    a.modalidade,
                    a.formato_letivo,
                    a.etapa,
                    a.transporte_apto,
                    a.deficiencia,
                    a.rota_exclusiva,
                    ap.ponto_id
                FROM alunos_municipais a
                JOIN alunos_pontos ap ON ap.aluno_id = a.id
                JOIN alunos_escolas ae ON ae.aluno_id = a.id
                WHERE a.tenant_id = $3
                  AND a.transporte_apto = TRUE
                  AND COALESCE(a.rota_exclusiva, FALSE) = FALSE
                  AND ap.ponto_id = ANY($1::int[])
                  AND ae.escola_id = ANY($2::int[]);
            `;
            const alunosRes = await client.query(alunosSql, [pontoIds, escolaIds, tenantId]);

            let rows = (alunosRes.rows || []); alunos = rows.map(row => {
                const turno = inferirTurnoBackend(row);
                return {
                    aluno_id: row.aluno_id,
                    ponto_id: row.ponto_id,
                    turno
                };
            });
        }

        // descarta "Não informado" para gerar rotas só com turno claro
        alunos = alunos.filter(a => a.turno !== 'Não informado');
        // aplica o modo_turnos escolhido no frontend
        alunos = alunos.filter(a => turnosPermitidos.has(a.turno));
        // Evita que o mesmo aluno pertença a mais de uma rota ao mesmo tempo (no mesmo tenant).
        // Regra:
        // - Se o aluno já estiver vinculado a uma rota ATIVA de OUTRO itinerário, ele NÃO entra nesta geração (para não duplicar).
        // - Em itinerário EXCLUSIVO, mantemos o comportamento anterior: removemos o aluno de rotas de outros itinerários
        //   para permitir "migrar" o aluno para a rota exclusiva.
        const conflitosAlunos = [];
        const alunoIdsGeracao = (Array.isArray(alunos) ? alunos : [])
            .map(a => Number(a.aluno_id || a.id))
            .filter(n => Number.isInteger(n) && n > 0);

        if (alunoIdsGeracao.length) {
            if (itinerarioTipo === 'exclusiva') {
                await client.query(
                    `
                    DELETE FROM rotas_escolares_alunos ra
                     USING itinerario_rotas ir
                    WHERE ra.tenant_id = $1
                      AND ra.aluno_id = ANY($2::int[])
                      AND ir.tenant_id = ra.tenant_id
                      AND ir.rota_id = ra.rota_id
                      AND ir.itinerario_id <> $3
                    `,
                    [tenantId, alunoIdsGeracao, itinerarioId]
                );
            } else {
                const ocupadosRes = await client.query(
                    `
                    SELECT DISTINCT
                           ra.aluno_id,
                           ra.rota_id,
                           COALESCE(r.nome, 'Sem nome') AS rota_nome,
                           ir.itinerario_id
                      FROM rotas_escolares_alunos ra
                      JOIN rotas_escolares r
                        ON r.id = ra.rota_id
                       AND r.tenant_id = ra.tenant_id
                       AND r.status = 'ativo'
                      JOIN itinerario_rotas ir
                        ON ir.rota_id = ra.rota_id
                       AND ir.tenant_id = ra.tenant_id
                     WHERE ra.tenant_id = $1
                       AND ra.aluno_id = ANY($2::int[])
                       AND ir.itinerario_id <> $3
                    `,
                    [tenantId, alunoIdsGeracao, itinerarioId]
                );

                const ocupadosSet = new Set((ocupadosRes.rows || []).map(r => Number(r.aluno_id)).filter(n => Number.isInteger(n)));
                if (ocupadosSet.size) {
                    // guarda detalhes para o frontend conseguir mostrar quem ficou de fora e onde ele já está
                    conflitosAlunos.push(...(ocupadosRes.rows || []).map(r => ({
                        aluno_id: Number(r.aluno_id),
                        rota_id: Number(r.rota_id),
                        rota_nome: r.rota_nome,
                        itinerario_id: Number(r.itinerario_id)
                    })));

                    alunos = alunos.filter(a => !ocupadosSet.has(Number(a.aluno_id || a.id)));
                }
            }
        }




        // Em modo incremental, por padrão NÃO removemos nada das rotas já existentes.
        // A automação deve apenas acrescentar alunos novos e preservar toda a logística atual.
        // Só removemos alunos/pontos antigos se o chamador pedir isso explicitamente.
        const permitirRemocoesIncrementais = Boolean(req.body && req.body.remover_ineligiveis === true);
        if (permitirRemocoesIncrementais && incrementalMode && itinerarioTipo !== 'exclusiva' && Array.isArray(pontoIdsElegiveis) && pontoIdsElegiveis.length) {
            // Remove alunos (e pontos) cujos pontos não fazem mais parte dos zoneamentos do itinerário
            const removidosRes = await client.query(
                `
                DELETE FROM rotas_escolares_alunos ra
                 USING itinerario_rotas ir
                WHERE ra.tenant_id = $1
                  AND ir.tenant_id = ra.tenant_id
                  AND ir.rota_id = ra.rota_id
                  AND ir.itinerario_id = $2
                  AND ra.ponto_id IS NOT NULL
                  AND NOT (ra.ponto_id = ANY($3::int[]))
                RETURNING ra.rota_id, ra.aluno_id
                `,
                [tenantId, itinerarioId, pontoIdsElegiveis]
            );

            const rotasAfetadas = Array.from(new Set((removidosRes.rows || []).map(r => Number(r.rota_id)).filter(n => Number.isInteger(n) && n > 0)));

            if (rotasAfetadas.length) {
                // remove também pontos fora da seleção atual
                await client.query(
                    `
                    DELETE FROM rotas_escolares_pontos rp
                     USING itinerario_rotas ir
                    WHERE rp.tenant_id = $1
                      AND ir.tenant_id = rp.tenant_id
                      AND ir.rota_id = rp.rota_id
                      AND ir.itinerario_id = $2
                      AND NOT (rp.ponto_id = ANY($3::int[]))
                    `,
                    [tenantId, itinerarioId, pontoIdsElegiveis]
                );

                // Recalcula contadores por turno e pontos por rota (para manter UI/relatórios coerentes)
                for (const rotaId of rotasAfetadas) {
                    const alunosRotaRes = await client.query(
                        `
                        SELECT 
                            ra.aluno_id,
                            ra.ponto_id,
                            a.turma,
                            a.ano,
                            a.modalidade,
                            a.formato_letivo,
                            a.etapa
                        FROM rotas_escolares_alunos ra
                        JOIN alunos_municipais a
                          ON a.id = ra.aluno_id
                         AND a.tenant_id = ra.tenant_id
                        WHERE ra.tenant_id = $1
                          AND ra.rota_id = $2
                        `,
                        [tenantId, rotaId]
                    );

                    let manha = 0, tarde = 0, noite = 0, integral = 0;
                    const pontosCount = new Map();

                    for (const row of (alunosRotaRes.rows || [])) {
                        const turno = inferirTurnoBackend(row);
                        if (turno === 'Manhã') manha++;
                        else if (turno === 'Tarde') tarde++;
                        else if (turno === 'Noite') noite++;
                        else if (turno === 'Integral') integral++;

                        const pid = row.ponto_id != null ? Number(row.ponto_id) : null;
                        if (pid != null && Number.isInteger(pid)) {
                            pontosCount.set(pid, (pontosCount.get(pid) || 0) + 1);
                        }
                    }

                    const qtdParadas = pontosCount.size;

                    await client.query(
                        `
                        UPDATE rotas_escolares
                        SET
                            qtd_alunos_manha = $2,
                            qtd_alunos_tarde = $3,
                            qtd_alunos_noite = $4,
                            qtd_alunos_integral = $5,
                            qtd_paradas = $6,
                            updated_at = now()
                        WHERE id = $1
                          AND tenant_id = $7
                        `,
                        [rotaId, manha, tarde, noite, integral, qtdParadas, tenantId]
                    );

                    // Recria pontos da rota com contagem atual (informativo no UI)
                    await client.query(
                        `DELETE FROM rotas_escolares_pontos WHERE rota_id = $1 AND tenant_id = $2`,
                        [rotaId, tenantId]
                    );

                    for (const [pontoId, qtd] of pontosCount.entries()) {
                        await client.query(
                            `
                            INSERT INTO rotas_escolares_pontos (rota_id, ponto_id, qtd_alunos, tenant_id)
                            VALUES ($1,$2,$3,$4)
                            ON CONFLICT (rota_id, ponto_id)
                            DO UPDATE SET qtd_alunos = EXCLUDED.qtd_alunos
                            `,
                            [rotaId, pontoId, qtd, tenantId]
                        );
                    }
                }
            }
        }

        // Em modo incremental, removemos da geração os alunos que JÁ estão associados a alguma rota deste itinerário
        // e tentamos apenas inserir os novos alunos nas rotas existentes, sem redistribuir os demais.
        if (incrementalMode) {
            const alunoIdsCandidatos = (Array.isArray(alunos) ? alunos : [])
                .map(a => Number(a.aluno_id || a.id))
                .filter(n => Number.isInteger(n) && n > 0);

            if (alunoIdsCandidatos.length) {
                const jaNoItRes = await client.query(
                    `
                    SELECT DISTINCT ra.aluno_id
                      FROM rotas_escolares_alunos ra
                      JOIN itinerario_rotas ir
                        ON ir.rota_id = ra.rota_id
                       AND ir.tenant_id = ra.tenant_id
                     WHERE ir.itinerario_id = $1
                       AND ra.tenant_id = $2
                       AND ra.aluno_id = ANY($3::int[])
                    `,
                    [itinerarioId, tenantId, alunoIdsCandidatos]
                );
                const jaNoItSet = new Set((jaNoItRes.rows || []).map(r => Number(r.aluno_id)).filter(n => Number.isInteger(n) && n > 0));
                if (jaNoItSet.size) {
                    alunos = alunos.filter(a => !jaNoItSet.has(Number(a.aluno_id || a.id)));
                }
            }

            if (!alunos.length) {
                // Em modo incremental, ausência de alunos elegíveis/novos NÃO pode apagar as rotas já existentes.
                // Apenas informamos que não houve nada novo para inserir e preservamos toda a estrutura atual.
                await client.query('COMMIT');
                return res.json({
                    message: `Nenhum aluno novo elegível foi encontrado para o itinerário #${itinerarioId}. As rotas existentes foram preservadas sem qualquer alteração.`,
                    rotas: [],
                    avisos: ['Nenhuma rota foi apagada. Nenhum aluno já vinculado foi removido.'],
                    conflitos_alunos: conflitosAlunos,
                    duplicados_geracao: []
                });
            }

            // Carrega rotas existentes (do itinerário) e capacidade por turno
            const rotasExistRes = await client.query(
                `
                SELECT r.id,
                       r.nome,
                       r.veiculo_id,
                       r.fornecedor_id,
                       r.capacidade,
                       COALESCE(r.qtd_alunos_manha,0)    AS qtd_alunos_manha,
                       COALESCE(r.qtd_alunos_tarde,0)    AS qtd_alunos_tarde,
                       COALESCE(r.qtd_alunos_noite,0)    AS qtd_alunos_noite,
                       COALESCE(r.qtd_alunos_integral,0) AS qtd_alunos_integral,
                       r.tipo,
                       r.status
                  FROM itinerario_rotas ir
                  JOIN rotas_escolares r
                    ON r.id = ir.rota_id
                   AND r.tenant_id = ir.tenant_id
                 WHERE ir.itinerario_id = $1
                   AND ir.tenant_id = $2
                   AND r.status = 'ativo'
                 ORDER BY r.id ASC
                `,
                [itinerarioId, tenantId]
            );
            const rotasExist = (rotasExistRes.rows || []).map(r => ({
                id: Number(r.id),
                nome: r.nome,
                veiculo_id: r.veiculo_id ? Number(r.veiculo_id) : null,
                fornecedor_id: r.fornecedor_id ? Number(r.fornecedor_id) : null,
                capacidade: (r.capacidade !== null && r.capacidade !== undefined) ? Number(r.capacidade) : null,
                qtd_manha: Number(r.qtd_alunos_manha || 0),
                qtd_tarde: Number(r.qtd_alunos_tarde || 0),
                qtd_noite: Number(r.qtd_alunos_noite || 0),
                qtd_integral: Number(r.qtd_alunos_integral || 0)
            }));

            const rotaIdsExist = rotasExist.map(r => r.id).filter(n => Number.isInteger(n) && n > 0);

            // Map de pontos por rota (só faz sentido em rotas não-exclusivas)
            const pontosPorRota = new Map(); // rota_id -> Map(ponto_id -> qtd_alunos)
            if (rotaIdsExist.length && itinerarioTipo !== 'exclusiva') {
                const pontosRes = await client.query(
                    `
                    SELECT rota_id, ponto_id, COALESCE(qtd_alunos,0) AS qtd_alunos
                      FROM rotas_escolares_pontos
                     WHERE tenant_id = $1
                       AND rota_id = ANY($2::bigint[])
                    `,
                    [tenantId, rotaIdsExist]
                );
                for (const row of (pontosRes.rows || [])) {
                    const rid = Number(row.rota_id);
                    const pid = Number(row.ponto_id);
                    const qtd = Number(row.qtd_alunos || 0);
                    if (!pontosPorRota.has(rid)) pontosPorRota.set(rid, new Map());
                    pontosPorRota.get(rid).set(pid, qtd);
                }
            }

            function capRota(r) {
                // Se existir veículo, a capacidade real pode ser a lotação dele (quando o campo estiver preenchido no cadastro).
                // Caso contrário, usa o campo 'capacidade' salvo na rota.
                const cap = Number.isFinite(r.capacidade) ? r.capacidade : null;
                return (cap && cap > 0) ? cap : null;
            }

            function restantePorTurno(r, turno) {
                const cap = capRota(r);
                // Sem capacidade definida -> deixa entrar (não bloqueia) para não travar inserção;
                // ainda assim, a contagem é atualizada.
                if (!cap) return Number.POSITIVE_INFINITY;

                if (turno === 'Manhã') return cap - r.qtd_manha;
                if (turno === 'Tarde') return cap - r.qtd_tarde;
                if (turno === 'Noite') return cap - r.qtd_noite;
                if (turno === 'Integral') return cap - r.qtd_integral;
                return 0;
            }

            function incContadorRota(r, turno) {
                if (turno === 'Manhã') r.qtd_manha++;
                else if (turno === 'Tarde') r.qtd_tarde++;
                else if (turno === 'Noite') r.qtd_noite++;
                else if (turno === 'Integral') r.qtd_integral++;
            }

            function colQtd(turno) {
                if (turno === 'Manhã') return 'qtd_alunos_manha';
                if (turno === 'Tarde') return 'qtd_alunos_tarde';
                if (turno === 'Noite') return 'qtd_alunos_noite';
                if (turno === 'Integral') return 'qtd_alunos_integral';
                return null;
            }

            // Tenta alocar novos alunos nas rotas existentes, priorizando rotas que já possuem o mesmo ponto_id
            const naoAlocados = [];
            let inseridos = 0;

            for (const aluno of alunos) {
                const alunoId = Number(aluno.aluno_id || aluno.id);
                const turno = String(aluno.turno || '').trim();
                const pontoId = aluno.ponto_id ? Number(aluno.ponto_id) : null;

                if (!Number.isInteger(alunoId) || alunoId <= 0 || !turno) {
                    naoAlocados.push(aluno);
                    continue;
                }

                let candidatos = rotasExist.filter(r => restantePorTurno(r, turno) > 0);

                if (itinerarioTipo !== 'exclusiva' && pontoId && Number.isInteger(pontoId)) {
                    const comMesmoPonto = candidatos.filter(r => pontosPorRota.has(r.id) && pontosPorRota.get(r.id).has(pontoId));
                    if (comMesmoPonto.length) candidatos = comMesmoPonto;
                }

                // escolhe a rota mais "equilibrada" para o TURNO do aluno:
                // regra: sempre inserir 1 a 1 na rota que tiver MENOS alunos naquele turno (para balancear),
                // com desempates que preservam logística:
                //  1) (não-exclusiva) preferir rota que já tenha o mesmo ponto_id
                //  2) maior folga no turno (para evitar estourar capacidade primeiro)
                //  3) menor total de alunos (soma dos turnos)
                //  4) menor id (estável)
                function qtdNoTurno(r, t) {
                    if (t === 'Manhã') return r.qtd_manha;
                    if (t === 'Tarde') return r.qtd_tarde;
                    if (t === 'Noite') return r.qtd_noite;
                    if (t === 'Integral') return r.qtd_integral;
                    return Number.POSITIVE_INFINITY;
                }
                function totalAlunos(r) {
                    return (r.qtd_manha || 0) + (r.qtd_tarde || 0) + (r.qtd_noite || 0) + (r.qtd_integral || 0);
                }

                candidatos.sort((a, b) => {
                    const qa = qtdNoTurno(a, turno);
                    const qb = qtdNoTurno(b, turno);
                    if (qa !== qb) return qa - qb; // menor qtd no turno primeiro

                    // desempate: preferir rota que já possui o mesmo ponto
                    if (itinerarioTipo !== 'exclusiva' && pontoId && Number.isInteger(pontoId)) {
                        const aTem = pontosPorRota.has(a.id) && pontosPorRota.get(a.id).has(pontoId);
                        const bTem = pontosPorRota.has(b.id) && pontosPorRota.get(b.id).has(pontoId);
                        if (aTem !== bTem) return aTem ? -1 : 1;
                    }

                    const fa = restantePorTurno(a, turno);
                    const fb = restantePorTurno(b, turno);
                    if (fa !== fb) return fb - fa; // maior folga primeiro

                    const ta = totalAlunos(a);
                    const tb = totalAlunos(b);
                    if (ta !== tb) return ta - tb; // menor total primeiro

                    return a.id - b.id;
                });
                const escolhida = candidatos[0];

                if (!escolhida) {
                    naoAlocados.push(aluno);
                    continue;
                }

                // Insere vínculo aluno -> rota
                await client.query(
                    `
                    INSERT INTO rotas_escolares_alunos (rota_id, aluno_id, ponto_id, tenant_id)
                    VALUES ($1,$2,$3,$4)
                    ON CONFLICT (rota_id, aluno_id) DO NOTHING
                    `,
                    [escolhida.id, alunoId, aluno.ponto_id || null, tenantId]
                );

                // Atualiza contador na rota
                const col = colQtd(turno);
                if (col) {
                    await client.query(
                        `UPDATE rotas_escolares SET ${col} = COALESCE(${col},0) + 1 WHERE id = $1 AND tenant_id = $2`,
                        [escolhida.id, tenantId]
                    );
                }
                incContadorRota(escolhida, turno);

                // Atualiza qtd_alunos por ponto (não-exclusiva)
                if (itinerarioTipo !== 'exclusiva' && pontoId && Number.isInteger(pontoId)) {
                    await client.query(
                        `
                        INSERT INTO rotas_escolares_pontos (rota_id, ponto_id, qtd_alunos, tenant_id)
                        VALUES ($1,$2,1,$3)
                        ON CONFLICT (rota_id, ponto_id)
                        DO UPDATE SET qtd_alunos = COALESCE(rotas_escolares_pontos.qtd_alunos,0) + 1
                        `,
                        [escolhida.id, pontoId, tenantId]
                    );

                    if (!pontosPorRota.has(escolhida.id)) pontosPorRota.set(escolhida.id, new Map());
                    const mp = pontosPorRota.get(escolhida.id);
                    mp.set(pontoId, (mp.get(pontoId) || 0) + 1);
                }

                inseridos++;
            }

            const rotasCriadas = [];

            // Se não coube em nenhuma rota existente, cria rotas extras priorizando veículos ainda livres.
            // Só cria rota sem veículo quando realmente não houver nenhum carro disponível/compatível.
            if (naoAlocados.length) {
                const nomesExist = new Set(rotasExist.map(r => String(r.nome || '').trim()).filter(Boolean));
                let baseIndex = rotasExist.length; // continua sequência

                const veiculosExtrasRes = await client.query(`
                    SELECT 
                        v.*,
                        vf.fornecedor_id,
                        COALESCE(f.nome_fantasia, f.razao_social) AS fornecedor_nome
                    FROM veiculos v
                    LEFT JOIN veiculo_fornecedor vf 
                        ON vf.veiculo_id = v.id AND vf.ativo = TRUE
                    LEFT JOIN fornecedores f 
                        ON f.id = vf.fornecedor_id
                    WHERE v.status = 'ativo'
                    ORDER BY v.capacidade_lotacao ASC NULLS LAST, v.id ASC;
                `);
                const veiculosExtras = (veiculosExtrasRes.rows || []).filter(v => Number(v?.capacidade_lotacao) > 0);

                const usoVeiculoExtra = new Map();
                const usoRotasExistentesExtraRes = await client.query(`
                    SELECT 
                        veiculo_id,
                        BOOL_OR(COALESCE(qtd_alunos_manha,0)    > 0) AS manha,
                        BOOL_OR(COALESCE(qtd_alunos_tarde,0)    > 0) AS tarde,
                        BOOL_OR(COALESCE(qtd_alunos_noite,0)    > 0) AS noite,
                        BOOL_OR(COALESCE(qtd_alunos_integral,0) > 0) AS integral
                    FROM rotas_escolares
                    WHERE tenant_id = $1
                      AND veiculo_id IS NOT NULL
                      AND status = 'ativo'
                    GROUP BY veiculo_id
                `, [tenantId]);
                for (const row of (usoRotasExistentesExtraRes.rows || [])) {
                    const vid = Number(row.veiculo_id);
                    if (!Number.isInteger(vid) || vid <= 0) continue;
                    usoVeiculoExtra.set(vid, {
                        manha: !!row.manha,
                        tarde: !!row.tarde,
                        noite: !!row.noite,
                        integral: !!row.integral
                    });
                }

                function conflitoTurnoExtra(uso, turnosObj) {
                    if (!uso) return false;
                    if (politicaVeiculoTurno === 'um_turno') {
                        const usado = !!(uso.integral || uso.manha || uso.tarde || uso.noite);
                        const novo = !!(turnosObj.integral || turnosObj.manha || turnosObj.tarde || turnosObj.noite);
                        return usado && novo;
                    }
                    if (turnosObj.integral) {
                        return !!(uso.integral || uso.manha || uso.tarde || uso.noite);
                    }
                    if (uso.integral) {
                        return !!(turnosObj.manha || turnosObj.tarde || turnosObj.noite || turnosObj.integral);
                    }
                    return !!(
                        (turnosObj.manha && uso.manha) ||
                        (turnosObj.tarde && uso.tarde) ||
                        (turnosObj.noite && uso.noite)
                    );
                }

                function marcarUsoExtra(veiculoId, turnosObj) {
                    if (!veiculoId) return;
                    const atual = usoVeiculoExtra.get(veiculoId) || { manha: false, tarde: false, noite: false, integral: false };
                    usoVeiculoExtra.set(veiculoId, {
                        manha: atual.manha || !!turnosObj.manha,
                        tarde: atual.tarde || !!turnosObj.tarde,
                        noite: atual.noite || !!turnosObj.noite,
                        integral: atual.integral || !!turnosObj.integral
                    });
                }

                function escolherVeiculoExtra(qtdMaxTurno, turnosObj, exigeAdaptado = false) {
                    let melhor = null;
                    for (const v of veiculosExtras) {
                        const vid = Number(v?.id);
                        const cap = Number(v?.capacidade_lotacao || 0);
                        if (!Number.isInteger(vid) || vid <= 0 || cap <= 0) continue;
                        if (exigeAdaptado && !veiculoEhAdaptado(v)) continue;
                        const uso = usoVeiculoExtra.get(vid);
                        if (conflitoTurnoExtra(uso, turnosObj)) continue;
                        if (!melhor) {
                            melhor = v;
                            continue;
                        }
                        const melhorCap = Number(melhor?.capacidade_lotacao || 0);
                        const melhorAtende = melhorCap >= qtdMaxTurno;
                        const atualAtende = cap >= qtdMaxTurno;
                        if (atualAtende && !melhorAtende) {
                            melhor = v;
                            continue;
                        }
                        if (atualAtende === melhorAtende && cap < melhorCap) {
                            melhor = v;
                        }
                    }
                    if (melhor) marcarUsoExtra(Number(melhor.id), turnosObj);
                    return melhor;
                }

                // agrupa por turno (e, para não-exclusiva, também por ponto) para reduzir número de rotas extras
                const grupos = new Map(); // key -> alunos[]
                for (const a of naoAlocados) {
                    const t = String(a.turno || '').trim();
                    const pid = (itinerarioTipo !== 'exclusiva' && a.ponto_id) ? Number(a.ponto_id) : null;
                    const key = (itinerarioTipo === 'exclusiva') ? `T:${t}` : `T:${t}|P:${pid || 0}`;
                    if (!grupos.has(key)) grupos.set(key, []);
                    grupos.get(key).push(a);
                }

                for (const [key, arr] of grupos.entries()) {
                    // gera nome único
                    let nomeRota = null;
                    for (let tent = 0; tent < 500; tent++) {
                        const candidato = gerarNomeRota(itinerarioId, baseIndex++);
                        if (!nomesExist.has(candidato)) { nomeRota = candidato; nomesExist.add(candidato); break; }
                    }
                    if (!nomeRota) nomeRota = `${itinerarioId}-X${Date.now()}`;

                    const turno = String(arr[0]?.turno || '').trim();

                    const qtdManha = turno === 'Manhã' ? arr.length : 0;
                    const qtdTarde = turno === 'Tarde' ? arr.length : 0;
                    const qtdNoite = turno === 'Noite' ? arr.length : 0;
                    const qtdIntegral = turno === 'Integral' ? arr.length : 0;

                    const qtdParadas = (itinerarioTipo === 'exclusiva')
                        ? arr.length
                        : new Set(arr.map(x => x.ponto_id).filter(Boolean)).size;

                    const capacidadeDemanda = Math.max(qtdManha, qtdTarde, qtdNoite, qtdIntegral) || null;
                    const turnosObj = {
                        manha: qtdManha > 0,
                        tarde: qtdTarde > 0,
                        noite: qtdNoite > 0,
                        integral: qtdIntegral > 0
                    };
                    const exigeAdaptado = itinerarioTipo === 'exclusiva' && arr.some(x => !!x.carro_adaptado);
                    const veiculoExtra = escolherVeiculoExtra(capacidadeDemanda || arr.length, turnosObj, exigeAdaptado);
                    const capacidadeRota = veiculoExtra ? Number(veiculoExtra.capacidade_lotacao || capacidadeDemanda || null) : capacidadeDemanda;

                    const insertRotaSql = `
                        INSERT INTO rotas_escolares (
                            nome, veiculo_id, fornecedor_id, capacidade,
                            qtd_alunos_manha, qtd_alunos_tarde, qtd_alunos_noite, qtd_alunos_integral,
                            qtd_paradas, status, tipo, tenant_id
                        ) VALUES (
                            $1,$2,$3,$4,$5,$6,$7,$8,$9,'ativo',$10,$11
                        )
                        RETURNING *;
                    `;
                    const insR = await client.query(insertRotaSql, [
                        nomeRota,
                        veiculoExtra ? veiculoExtra.id : null,
                        veiculoExtra ? (veiculoExtra.fornecedor_id || null) : null,
                        capacidadeRota,
                        qtdManha,
                        qtdTarde,
                        qtdNoite,
                        qtdIntegral,
                        qtdParadas,
                        itinerarioTipo,
                        tenantId
                    ]);
                    const rotaNova = insR.rows[0];

                    await client.query(
                        'INSERT INTO itinerario_rotas (itinerario_id, rota_id, tenant_id) VALUES ($1,$2,$3)',
                        [itinerarioId, rotaNova.id, tenantId]
                    );

                    // vincula alunos
                    for (const a of arr) {
                        const alunoId = Number(a.aluno_id || a.id);
                        await client.query(
                            `
                            INSERT INTO rotas_escolares_alunos (rota_id, aluno_id, ponto_id, tenant_id)
                            VALUES ($1,$2,$3,$4)
                    ON CONFLICT (rota_id, aluno_id) DO NOTHING
                            `,
                            [rotaNova.id, alunoId, a.ponto_id || null, tenantId]
                        );
                    }

                    // vincula pontos e contagens por ponto (não-exclusiva)
                    if (itinerarioTipo !== 'exclusiva') {
                        const contPorPonto = new Map();
                        for (const a of arr) {
                            const pid = a.ponto_id ? Number(a.ponto_id) : null;
                            if (!pid) continue;
                            contPorPonto.set(pid, (contPorPonto.get(pid) || 0) + 1);
                        }
                        for (const [pid, qtd] of contPorPonto.entries()) {
                            await client.query(
                                `
                                INSERT INTO rotas_escolares_pontos (rota_id, ponto_id, qtd_alunos, tenant_id)
                                VALUES ($1,$2,$3,$4)
                                ON CONFLICT (rota_id, ponto_id)
                                DO UPDATE SET qtd_alunos = EXCLUDED.qtd_alunos
                                `,
                                [rotaNova.id, pid, qtd, tenantId]
                            );
                        }
                    }

                    rotasCriadas.push({
                        id: rotaNova.id,
                        nome: rotaNova.nome,
                        capacidade: rotaNova.capacidade || null,
                        qtd_alunos_manha: rotaNova.qtd_alunos_manha,
                        qtd_alunos_tarde: rotaNova.qtd_alunos_tarde,
                        qtd_alunos_noite: rotaNova.qtd_alunos_noite,
                        qtd_alunos_integral: rotaNova.qtd_alunos_integral,
                        qtd_paradas: rotaNova.qtd_paradas,
                        status: rotaNova.status,
                        veiculo_nome: veiculoExtra ? (veiculoExtra.nome || veiculoExtra.modelo || veiculoExtra.tipo || 'Veículo') : null,
                        veiculo_placa: veiculoExtra ? (veiculoExtra.placa || null) : null,
                        empresa: veiculoExtra ? (veiculoExtra.fornecedor_nome || null) : null
                    });
                }
            }

            await client.query('COMMIT');

            const extrasComVeiculo = rotasCriadas.filter(r => !!r.veiculo_placa || !!r.veiculo_nome).length;
            const extrasSemVeiculo = rotasCriadas.length - extrasComVeiculo;
            const messageFinal = naoAlocados.length
                ? `Rotas atualizadas (modo incremental) no itinerário #${itinerarioId}: ${inseridos} aluno(s) inserido(s) em rotas existentes, ${extrasComVeiculo} rota(s) extra(s) com veículo e ${extrasSemVeiculo} rota(s) extra(s) sem veículo.`
                : `Rotas atualizadas (modo incremental) no itinerário #${itinerarioId}: ${inseridos} aluno(s) inserido(s) em rotas existentes.`;

            const avisosIncrementais = [];
            if (extrasSemVeiculo > 0) {
                avisosIncrementais.push('Algumas rotas extras ficaram sem veículo porque não havia carro livre/compatível para os turnos ou para a adaptação exigida.');
            }
            if (naoAlocados.length > 0) {
                avisosIncrementais.push('Não houve redistribuição dos alunos já alocados; somente novos alunos foram adicionados ou enviados para rotas extras.');
            }

            return res.json({
                message: messageFinal,
                rotas: rotasCriadas, // rotas novas (se houve). Rotas existentes permanecem.
                avisos: avisosIncrementais,
                conflitos_alunos: conflitosAlunos,
                duplicados_geracao: []
            });
        }

        if (!alunos.length) {
            await client.query('ROLLBACK');
            return res.status(200).json({
                message: incrementalMode
                    ? 'Nenhum aluno novo encontrado para adicionar. As rotas existentes foram preservadas sem alterações.'
                    : ((itinerarioTipo === 'exclusiva')
                        ? 'Nenhum aluno apto COM DEFICIÊNCIA (com turno identificado e com localização) para gerar rotas'
                        : 'Nenhum aluno apto (com turno identificado) para gerar rotas'),
                rotas: []
            });
        }

        // 6) Veículos e fornecedores disponíveis
        // Observação: vamos priorizar o uso TOTAL da frota (por turno) e só criar rota sem veículo
        // quando realmente não houver mais nenhum veículo disponível (sem conflito de turno).
        const veiculosSql = `
            SELECT 
                v.*,
                vf.fornecedor_id,
                COALESCE(f.nome_fantasia, f.razao_social) AS fornecedor_nome
            FROM veiculos v
            LEFT JOIN veiculo_fornecedor vf 
                ON vf.veiculo_id = v.id AND vf.ativo = TRUE
            LEFT JOIN fornecedores f 
                ON f.id = vf.fornecedor_id
            WHERE v.status = 'ativo'
            ORDER BY v.capacidade_lotacao DESC NULLS LAST, v.id ASC;
        `;
        const veiculosRes = await client.query(veiculosSql);
        const veiculos = (veiculosRes.rows || []).filter(v => Number(v?.capacidade_lotacao) > 0);

        // IMPORTANTE (modo_alocacao = 'distribuir'):
        // Para Rotas Exclusivas, não devemos usar TODA a frota ativa do banco.
        // Devemos usar APENAS os veículos que já estavam associados a este itinerário
        // (veículos das rotas existentes antes de regenerar).
        // Isso evita o comportamento de “1 aluno em cada carro disponível”.
        if (modoAlocacao === 'distribuir') {
            const idsVeiculosDoItinerario = Array.from(new Set((veiculosFixosFila || [])
                .map(n => Number(n))
                .filter(n => Number.isInteger(n) && n > 0)));

            if (!idsVeiculosDoItinerario.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'Nenhum veículo associado às rotas do itinerário.',
                    message: 'Para usar "Distribuir", primeiro defina os veículos nas rotas deste itinerário (ex.: crie/edite as rotas e selecione os veículos) e depois gere novamente.'
                });
            }

            // Restringe a lista de veículos ao conjunto já utilizado no itinerário.
            // Mantém a ordem do SELECT original (capacidade desc), mas só com os IDs permitidos.
            const idsSet = new Set(idsVeiculosDoItinerario);
            const veiculosFiltrados = veiculos.filter(v => idsSet.has(Number(v?.id)));

            if (!veiculosFiltrados.length) {
                await client.query('ROLLBACK');
                return res.status(400).json({
                    error: 'Veículos associados ao itinerário não encontrados ou inativos.',
                    message: 'Os veículos que estavam nas rotas anteriores não estão disponíveis como "ativos". Verifique o cadastro de veículos e tente novamente.'
                });
            }

            // Atualiza referência usada pelo algoritmo de escolha
            // (a fila veiculosFixosFila continua sendo usada para respeitar a ordem das rotas antigas).
            veiculos.length = 0;
            veiculos.push(...veiculosFiltrados);
        }


        // Capacidade base só para definir um "chute" inicial de buckets.
        // A alocação final respeita a capacidade real do veículo escolhido (com divisão automática).
        let capacidadeBase = 0;
        for (const v of veiculos) {
            const cap = capacidadeRealVeiculo(v); // já desconta motorista + monitor
            if (cap > capacidadeBase) capacidadeBase = cap;
        }
        if (!capacidadeBase) {
            // sem frota cadastrada -> tudo vira rota sem veículo
            capacidadeBase = Math.max(1, alunos.length);
        }

        // 7) Separa alunos por turno
        const alunosPorTurno = {
            'Manhã': [],
            'Tarde': [],
            'Noite': [],
            'Integral': []
        };

        for (const a of alunos) {
            if (!alunosPorTurno[a.turno]) {
                alunosPorTurno[a.turno] = [];
            }
            alunosPorTurno[a.turno].push(a);
        }

        const totalManha = alunosPorTurno['Manhã'].length;
        const totalTarde = alunosPorTurno['Tarde'].length;
        const totalNoite = alunosPorTurno['Noite'].length;
        const totalIntegral = alunosPorTurno['Integral'].length;

        // 8) Buckets: montagem conforme modo_turnos.
        // Regras gerais:
        //  - Integral fica isolado (não mistura com outros turnos)
        //  - No modo 'um_turno', Manhã e Tarde NÃO são misturados (viram buckets separados)
        //  - Nos demais modos, os turnos permitidos (exceto Integral) podem ficar juntos em um único bucket,
        //    e a função repartirBucketEmRotas faz a divisão mínima possível de rotas.
        const temIntegralBucket = totalIntegral > 0;
        const buckets = [];

        function criarBucketVazio() {
            return {
                alunos: [],
                qtdManha: 0,
                qtdTarde: 0,
                qtdNoite: 0,
                qtdIntegral: 0,
                pontosSet: new Set()
            };
        }

        function bucketAddAluno(bucket, aluno, campoQtd) {
            bucket.alunos.push(aluno);
            bucket[campoQtd]++;
            if (aluno.ponto_id) bucket.pontosSet.add(aluno.ponto_id);
        }


        // Capacidade planejada para decisões de bucket (heurística):
        // usamos a maior capacidade real da frota disponível; se não houver, usamos 45.
        const _capsBuckets = (veiculos || [])
            .map(v => capacidadeRealVeiculo(v))
            .filter(c => Number.isFinite(c) && c > 0);
        const capPlanejadaBuckets = _capsBuckets.length ? Math.max(..._capsBuckets) : 45;

        // 9) Distribuição por buckets conforme o modo
        //
        // modoEscolas:
        //  - 'padrao'     : comportamento anterior (mistura escolas no mesmo bucket)
        //  - 'por_escola' : cria buckets por escola (e por turno/combinação de turnos), evitando que
        //                  todos os ônibus passem em todas as escolas.
        //
        // Obs: itinerário EXCLUSIVO não usa escola_id como critério de bucket (mantém comportamento atual).
        const usarBucketsPorEscola = (itinerarioTipo !== 'exclusiva' && modoEscolas === 'por_escola');

        function groupByEscola(alunosList) {
            const by = new Map(); // escola_id -> alunos[]
            for (const a of (alunosList || [])) {
                const k = (a && a.escola_id != null) ? Number(a.escola_id) : 0;
                if (!by.has(k)) by.set(k, []);
                by.get(k).push(a);
            }
            return by;
        }

        // 9.1) Integral sempre isolado (quando existir e estiver permitido)
        if (temIntegralBucket) {
            if (usarBucketsPorEscola) {
                const byEscolaInt = groupByEscola(alunosPorTurno['Integral']);
                for (const [escolaId, lista] of byEscolaInt.entries()) {
                    if (!lista.length) continue;
                    buckets.push(criarBucketVazio());
                    const bInt = buckets[buckets.length - 1];
                    bInt.escola_id = escolaId || null;
                    for (const a of lista) bucketAddAluno(bInt, a, 'qtdIntegral');
                }
            } else {
                buckets.push(criarBucketVazio());
                const bInt = buckets[buckets.length - 1];
                for (const a of alunosPorTurno['Integral']) bucketAddAluno(bInt, a, 'qtdIntegral');
            }
        }

        // 9.2) Demais turnos
        if (modoTurnos === 'um_turno') {
            if (usarBucketsPorEscola) {
                const byEscolaManha = groupByEscola(alunosPorTurno['Manhã']);
                const byEscolaTarde = groupByEscola(alunosPorTurno['Tarde']);

                const escolasSet = new Set([...byEscolaManha.keys(), ...byEscolaTarde.keys()]);
                for (const escolaId of escolasSet) {
                    const listaM = byEscolaManha.get(escolaId) || [];
                    const listaT = byEscolaTarde.get(escolaId) || [];

                    if (listaM.length) {
                        buckets.push(criarBucketVazio());
                        const bM = buckets[buckets.length - 1];
                        bM.escola_id = escolaId || null;
                        for (const a of listaM) bucketAddAluno(bM, a, 'qtdManha');
                    }

                    if (listaT.length) {
                        buckets.push(criarBucketVazio());
                        const bT = buckets[buckets.length - 1];
                        bT.escola_id = escolaId || null;
                        for (const a of listaT) bucketAddAluno(bT, a, 'qtdTarde');
                    }
                }
            } else {
                // Manhã bucket
                if (totalManha > 0) {
                    buckets.push(criarBucketVazio());
                    const bM = buckets[buckets.length - 1];
                    for (const a of alunosPorTurno['Manhã']) bucketAddAluno(bM, a, 'qtdManha');
                }
                // Tarde bucket
                if (totalTarde > 0) {
                    buckets.push(criarBucketVazio());
                    const bT = buckets[buckets.length - 1];
                    for (const a of alunosPorTurno['Tarde']) bucketAddAluno(bT, a, 'qtdTarde');
                }
                // Noite não entra neste modo (já filtrado por turnosPermitidos)
            }
        } else {
            if (usarBucketsPorEscola) {
                const byEscolaManha = groupByEscola(alunosPorTurno['Manhã']);
                const byEscolaTarde = groupByEscola(alunosPorTurno['Tarde']);
                const byEscolaNoite = groupByEscola(alunosPorTurno['Noite']);

                const escolasSet = new Set([...byEscolaManha.keys(), ...byEscolaTarde.keys(), ...byEscolaNoite.keys()]);
                for (const escolaId of escolasSet) {
                    const listaM = byEscolaManha.get(escolaId) || [];
                    const listaT = byEscolaTarde.get(escolaId) || [];
                    const listaN = byEscolaNoite.get(escolaId) || [];

                    const total = listaM.length + listaT.length + listaN.length;
                    if (total > 0 || !buckets.length) {
                        buckets.push(criarBucketVazio());
                        const b = buckets[buckets.length - 1];
                        b.escola_id = escolaId || null;
                        for (const a of listaM) bucketAddAluno(b, a, 'qtdManha');
                        for (const a of listaT) bucketAddAluno(b, a, 'qtdTarde');
                        for (const a of listaN) bucketAddAluno(b, a, 'qtdNoite');
                    }
                }
            } else {
                // Um único bucket para os turnos permitidos (exceto Integral)
                const totalOutros = totalManha + totalTarde + totalNoite;
                if (totalOutros > 0 || !buckets.length) {
                    buckets.push(criarBucketVazio());
                    const b = buckets[buckets.length - 1];
                    for (const a of alunosPorTurno['Manhã']) bucketAddAluno(b, a, 'qtdManha');
                    for (const a of alunosPorTurno['Tarde']) bucketAddAluno(b, a, 'qtdTarde');
                    for (const a of alunosPorTurno['Noite']) bucketAddAluno(b, a, 'qtdNoite');
                }
            }
        }

        // 12) Sufixo (A, B, C...) baseado em quantas rotas já existiam (neste itinerário)
        const countRes = await client.query(
            'SELECT COUNT(*)::int AS total FROM itinerario_rotas WHERE itinerario_id = $1',
            [itinerarioId]
        );
        let baseIndex = countRes.rows[0]?.total || 0;

        // 13) Regra de ouro: um veículo NÃO pode estar em duas rotas no MESMO turno
        // (pode repetir se for em turno diferente)
        // Monta mapa de uso por veículo considerando TODAS as rotas do sistema.
        const usoVeiculoRes = await client.query(`
            SELECT
                veiculo_id,
                BOOL_OR(COALESCE(qtd_alunos_manha,0)    > 0) AS manha,
                BOOL_OR(COALESCE(qtd_alunos_tarde,0)    > 0) AS tarde,
                BOOL_OR(COALESCE(qtd_alunos_noite,0)    > 0) AS noite,
                BOOL_OR(COALESCE(qtd_alunos_integral,0) > 0) AS integral
            FROM rotas_escolares
            WHERE veiculo_id IS NOT NULL AND tenant_id = $1
            GROUP BY veiculo_id
        `, [tenantId]);

        const usoVeiculo = new Map();
        for (const row of (usoVeiculoRes.rows || [])) {
            usoVeiculo.set(Number(row.veiculo_id), {
                manha: !!row.manha,
                tarde: !!row.tarde,
                noite: !!row.noite,
                integral: !!row.integral
            });
        }


        // Para geração de rotas MUNICIPAIS: veículos já usados em rotas EXCLUSIVAS devem ser considerados indisponíveis.
        // Isso evita que a geração tente reutilizar um veículo reservado para exclusiva e cause erro pelo trigger de conflito.
        const veiculosBloqueadosExclusiva = new Set();
        if (String(itinerarioTipo || '').toLowerCase() !== 'exclusiva') {
            const vb = await client.query(
                `
                SELECT DISTINCT veiculo_id
                  FROM rotas_escolares
                 WHERE tenant_id = $1
                   AND veiculo_id IS NOT NULL
                   AND status = 'ativo'
                   AND tipo = 'exclusiva'
                   AND (
                        COALESCE(qtd_alunos_integral,0) > 0 OR
                        COALESCE(qtd_alunos_manha,0)    > 0 OR
                        COALESCE(qtd_alunos_tarde,0)    > 0 OR
                        COALESCE(qtd_alunos_noite,0)    > 0
                   )
                `,
                [tenantId]
            );
            for (const r of (vb.rows || [])) veiculosBloqueadosExclusiva.add(Number(r.veiculo_id));
        }
        function turnosFromCounts(counts) {
            return {
                manha: (counts.qtdManha || 0) > 0,
                tarde: (counts.qtdTarde || 0) > 0,
                noite: (counts.qtdNoite || 0) > 0,
                integral: (counts.qtdIntegral || 0) > 0
            };
        }

        async function buscarRotaConflitante(veiculoId, t) {
            if (!veiculoId) return null;

            // Política mais restrita: qualquer uso já bloqueia o veículo.
            if (politicaVeiculoTurno === 'um_turno') {
                const r = await client.query(
                    `SELECT id, nome
                   FROM rotas_escolares
                  WHERE tenant_id = $1
                    AND veiculo_id = $2
                    AND (
                      COALESCE(qtd_alunos_integral,0) > 0 OR
                      COALESCE(qtd_alunos_manha,0)    > 0 OR
                      COALESCE(qtd_alunos_tarde,0)    > 0 OR
                      COALESCE(qtd_alunos_noite,0)    > 0
                    )
                  ORDER BY id ASC
                  LIMIT 1`,
                    [tenantId, veiculoId]
                );
                return r.rows?.[0] || null;
            }

            const conds = [];
            const params = [tenantId, veiculoId];
            let p = 2;

            // Integral conflita com todos os turnos, e qualquer rota Integral também conflita.
            if (t.integral) {
                conds.push(`(
                COALESCE(qtd_alunos_integral,0) > 0 OR
                COALESCE(qtd_alunos_manha,0)    > 0 OR
                COALESCE(qtd_alunos_tarde,0)    > 0 OR
                COALESCE(qtd_alunos_noite,0)    > 0
            )`);
            } else {
                // Se existe rota Integral com o veículo, conflita com qualquer turno
                conds.push(`COALESCE(qtd_alunos_integral,0) > 0`);

                if (t.manha) conds.push(`COALESCE(qtd_alunos_manha,0) > 0`);
                if (t.tarde) conds.push(`COALESCE(qtd_alunos_tarde,0) > 0`);
                if (t.noite) conds.push(`COALESCE(qtd_alunos_noite,0) > 0`);
            }

            const whereTurno = conds.length ? `AND (${conds.join(' OR ')})` : '';
            const q = await client.query(
                `SELECT id, nome
               FROM rotas_escolares
              WHERE tenant_id = $1
                AND veiculo_id = $2
                ${whereTurno}
              ORDER BY id ASC
              LIMIT 1`,
                params
            );
            return q.rows?.[0] || null;
        }

        function haConflitoTurno(uso, t) {
            if (!uso) return false;

            // Política mais restrita: um veículo só pode atuar em 1 turno no sistema.
            // Se já está usado em qualquer turno, não pode ser reutilizado.
            if (politicaVeiculoTurno === 'um_turno') {
                return !!(uso.integral || uso.manha || uso.tarde || uso.noite);
            }

            const permiteIntegralComNoite = modoTurnos === 'integral_noite';

            // Regra padrão: Integral conflita com todos os outros turnos.
            // Exceção: no modo integral_noite, Integral pode coexistir com Noite,
            // mas continua sem poder misturar com Manhã/Tarde.
            if (t.integral) {
                if (uso.integral || uso.manha || uso.tarde) return true;
                if (!permiteIntegralComNoite && uso.noite) return true;
            }
            if (uso.integral) {
                if (t.integral || t.manha || t.tarde) return true;
                if (!permiteIntegralComNoite && t.noite) return true;
            }

            if (t.manha && uso.manha) return true;
            if (t.tarde && uso.tarde) return true;
            if (t.noite && uso.noite) return true;
            return false;
        }

        function marcarUso(veiculoId, t) {
            if (!veiculoId) return;
            const atual = usoVeiculo.get(veiculoId) || { manha: false, tarde: false, noite: false, integral: false };
            usoVeiculo.set(veiculoId, {
                manha: atual.manha || t.manha,
                tarde: atual.tarde || t.tarde,
                noite: atual.noite || t.noite,
                integral: atual.integral || t.integral
            });
        }

        // Escolhe um veículo que NÃO conflite com o turno e que ajude a "cobrir" a demanda atual.
        // Estratégia:
        //  - Se existir veículo com capacidade >= demanda: escolhe o MENOR que caiba (minimiza sobra).
        //  - Senão: escolhe o MAIOR disponível (maximiza uso) e repete (divide a rota).
        function capacidadeRealVeiculo(veiculo) {
            const lotacao = Number(veiculo?.capacidade_lotacao) || 0;

            // 2 lugares fixos: motorista + monitor
            const capacidadeReal = lotacao - 2;

            return capacidadeReal > 0 ? capacidadeReal : 0;
        }

        function escolherVeiculoPorDemanda(demanda, turnos) {
            if (!Number.isFinite(demanda) || demanda <= 0) return null;

            const candidatos = [];
            for (const v of veiculos) {
                const vid = Number(v?.id);
                if (!vid) continue;
                if (veiculosBloqueadosExclusiva && veiculosBloqueadosExclusiva.has(vid)) continue;

                const cap = capacidadeRealVeiculo(v);
                if (cap <= 0) continue;

                const uso = usoVeiculo.get(vid);
                if (haConflitoTurno(uso, turnos)) continue;

                candidatos.push({ v, cap, vid });
            }

            if (!candidatos.length) return null;

            // menor que atende
            let melhorMaiorOuIgual = null;
            for (const c of candidatos) {
                if (c.cap >= demanda) {
                    if (!melhorMaiorOuIgual || c.cap < melhorMaiorOuIgual.cap) {
                        melhorMaiorOuIgual = c;
                    }
                }
            }
            if (melhorMaiorOuIgual) {
                marcarUso(melhorMaiorOuIgual.vid, turnos);
                return melhorMaiorOuIgual.v;
            }

            // nenhum atende -> pega o maior disponível (para dividir)
            let maior = candidatos[0];
            for (const c of candidatos) {
                if (c.cap > maior.cap) maior = c;
            }
            marcarUso(maior.vid, turnos);
            return maior.v;
        }

        function construirBucketParcial({ alunosParte }) {
            const b = {
                alunos: [],
                qtdManha: 0,
                qtdTarde: 0,
                qtdNoite: 0,
                qtdIntegral: 0,
                pontosSet: new Set()
            };
            for (const a of alunosParte) {
                const t = a.turno;
                if (t === 'Integral') bucketAddAluno(b, a, 'qtdIntegral');
                else if (t === 'Manhã') bucketAddAluno(b, a, 'qtdManha');
                else if (t === 'Tarde') bucketAddAluno(b, a, 'qtdTarde');
                else if (t === 'Noite') bucketAddAluno(b, a, 'qtdNoite');
            }
            return b;
        }

        // Divide um bucket em 1..N rotas usando a frota disponível, sem estourar lotação.
        // Só cria rota sem veículo quando realmente não houver nenhum candidato disponível.

        // Divide um bucket em 1..N rotas usando a frota disponível, sem estourar lotação.
        // IMPORTANTE: quando o usuário troca o veículo manualmente (tela de edição),
        // esta função respeita a fila de veículos fixos (ordem por r.id das rotas antigas)
        // e NÃO tenta "otimizar" trocando por outro menor/maior.
        // Para evitar rotas extremamente lotadas enquanto outras ficam vazias, a distribuição
        // de alunos por turno é balanceada entre as rotas criadas (respeitando a capacidade de cada veículo).
        async function repartirBucketEmRotas(bucket) {
            const rem = {
                'Integral': bucket.alunos.filter(a => a.turno === 'Integral'),
                'Manhã': bucket.alunos.filter(a => a.turno === 'Manhã'),
                'Tarde': bucket.alunos.filter(a => a.turno === 'Tarde'),
                'Noite': bucket.alunos.filter(a => a.turno === 'Noite')
            };


            // 9.x) Heurística para reduzir rotas 'solo' de escola muito pequena:
            // Se uma escola tiver pouquíssimos alunos em um bucket, tentamos anexar esse bucket a outro bucket do mesmo padrão
            // (mesmos turnos) que ainda tenha folga, para evitar criar um ônibus só para 1-2 alunos.
            // Resultado: menos ônibus indo para 2 escolas ao mesmo tempo e menos rotas dedicadas para escola com demanda mínima.
            function bucketTotal(b) {
                return (Number(b.qtd_alunos_manha) || 0)
                    + (Number(b.qtd_alunos_tarde) || 0)
                    + (Number(b.qtd_alunos_noite) || 0)
                    + (Number(b.qtd_alunos_integral) || 0);
            }
            function bucketPattern(b) {
                return [
                    (Number(b.qtd_alunos_integral) || 0) > 0 ? 'I' : 'i',
                    (Number(b.qtd_alunos_manha) || 0) > 0 ? 'M' : 'm',
                    (Number(b.qtd_alunos_tarde) || 0) > 0 ? 'T' : 't',
                    (Number(b.qtd_alunos_noite) || 0) > 0 ? 'N' : 'n'
                ].join('');
            }
            function mergeSmallSchoolBuckets() {
                if (!usarBucketsPorEscola) return;
                if (!Array.isArray(buckets) || !buckets.length) return;

                const limiarPequeno = Math.max(2, Math.floor(Number(capPlanejadaBuckets) * 0.10)); // ~10% da capacidade

                // marca escola(s) do bucket (para debug/inspeção). Não impacta inserts.
                for (const b of buckets) {
                    if (!b) continue;
                    const eid = (b.escola_id != null) ? Number(b.escola_id) : null;
                    if (!b._escolasSet) b._escolasSet = new Set();
                    if (eid != null && Number.isFinite(eid)) b._escolasSet.add(eid);
                }

                // candidata: buckets com folga
                // fonte: buckets pequenos (<= limiar) e com escola definida
                let changed = true;
                while (changed) {
                    changed = false;

                    // reordena a cada ciclo
                    const pequenos = buckets
                        .filter(b => b && b.escola_id != null)
                        .map(b => ({ b, total: bucketTotal(b), pattern: bucketPattern(b) }))
                        .filter(x => x.total > 0 && x.total <= limiarPequeno)
                        .sort((a, b) => a.total - b.total);

                    for (const p of pequenos) {
                        const bSmall = p.b;
                        const totalSmall = p.total;
                        const pat = p.pattern;

                        // encontra melhor alvo: mesmo padrão, escola diferente, com maior folga
                        let best = null;
                        let bestFolga = -1;
                        for (const bCand of buckets) {
                            if (!bCand || bCand === bSmall) continue;
                            if (bucketPattern(bCand) !== pat) continue;
                            const totalCand = bucketTotal(bCand);
                            const folga = Number(capPlanejadaBuckets) - totalCand;
                            if (folga < totalSmall) continue;
                            // evita anexar em bucket que já tem muita mistura (heurística simples)
                            const mixCount = (bCand._escolasSet && bCand._escolasSet.size) ? bCand._escolasSet.size : 1;
                            if (mixCount >= 3) continue;
                            if (folga > bestFolga) {
                                bestFolga = folga;
                                best = bCand;
                            }
                        }

                        if (!best) continue;

                        // Move todos os alunos do bucket pequeno para o alvo
                        const alunosSmall = Array.isArray(bSmall.alunos) ? bSmall.alunos : [];
                        if (!Array.isArray(best.alunos)) best.alunos = [];
                        for (const a of alunosSmall) {
                            best.alunos.push(a);
                            // atualiza contadores conforme turno do aluno
                            if (a && a.turno) {
                                const t = String(a.turno).trim().toLowerCase();
                                if (t === 'manha' || t === 'manhã') best.qtd_alunos_manha = (Number(best.qtd_alunos_manha) || 0) + 1;
                                else if (t === 'tarde') best.qtd_alunos_tarde = (Number(best.qtd_alunos_tarde) || 0) + 1;
                                else if (t === 'noite') best.qtd_alunos_noite = (Number(best.qtd_alunos_noite) || 0) + 1;
                                else if (t === 'integral') best.qtd_alunos_integral = (Number(best.qtd_alunos_integral) || 0) + 1;
                            }
                            if (a && a.ponto_id && best.pontosSet) best.pontosSet.add(a.ponto_id);
                        }

                        // marca mix
                        if (!best._escolasSet) best._escolasSet = new Set();
                        if (bSmall._escolasSet) {
                            for (const eid of bSmall._escolasSet) best._escolasSet.add(eid);
                        } else if (bSmall.escola_id != null) {
                            best._escolasSet.add(Number(bSmall.escola_id));
                        }

                        // zera pequeno (será removido)
                        bSmall.alunos = [];
                        bSmall.qtd_alunos_manha = 0;
                        bSmall.qtd_alunos_tarde = 0;
                        bSmall.qtd_alunos_noite = 0;
                        bSmall.qtd_alunos_integral = 0;
                        if (bSmall.pontosSet) bSmall.pontosSet.clear();

                        // remove buckets vazios
                        for (let i = buckets.length - 1; i >= 0; i--) {
                            const b = buckets[i];
                            if (b && bucketTotal(b) === 0) buckets.splice(i, 1);
                        }

                        changed = true;
                        break; // recomeça para recalcular lista
                    }
                }
            }

            mergeSmallSchoolBuckets();

            const partesMeta = [];

            async function selecionarParte(demanda, turnos) {
                let veiculo = null;
                let parteMotoristasFixos = [];
                let parteMonitoresFixos = [];

                if (Array.isArray(veiculosFixosFila) && veiculosFixosFila.length) {
                    const veiculoIdFixo = veiculosFixosFila.shift();
                    veiculo = veiculos.find(v => Number(v?.id) === Number(veiculoIdFixo)) || null;

                    if (veiculo) {
                        const uso = usoVeiculo.get(Number(veiculoIdFixo));
                        const bloqueadoExclusiva = (veiculosBloqueadosExclusiva && veiculosBloqueadosExclusiva.has(Number(veiculoIdFixo)));
                        if (bloqueadoExclusiva || haConflitoTurno(uso, turnos)) {
                            const conflitante = await buscarRotaConflitante(Number(veiculoIdFixo), turnos);
                            const extra = conflitante ? ` (rota conflitante: ${conflitante.id} - ${conflitante.nome})` : '';
                            // Não derruba a geração: ignora o veículo fixo conflitante e tenta buscar outro disponível.
                            avisos.push(`Veículo ${Number(veiculoIdFixo)} indisponível${extra}. Ignorado na geração.`);
                            veiculo = null;
                        } else {
                            marcarUso(Number(veiculoIdFixo), turnos);
                        }
                    }

                    // Mantém o alinhamento das filas (mesma ordem por r.id das rotas antigas)
                    parteMotoristasFixos = (Array.isArray(motoristasFixosFila) && motoristasFixosFila.length) ? motoristasFixosFila.shift() : [];
                    parteMonitoresFixos = (Array.isArray(monitoresFixosFila) && monitoresFixosFila.length) ? monitoresFixosFila.shift() : [];

                    // Se o veículo fixo estava indisponível/conflitante, tenta selecionar outro veículo disponível.
                    if (!veiculo) {
                        veiculo = escolherVeiculoPorDemanda(demanda, turnos);
                    }

                } else {
                    veiculo = escolherVeiculoPorDemanda(demanda, turnos);
                }

                const cap = veiculo ? capacidadeRealVeiculo(veiculo) : demanda;
                if (veiculo && (!Number.isFinite(cap) || cap <= 0)) {
                    throw new Error(`Veículo ${Number(veiculo?.id) || 'desconhecido'} sem capacidade válida para alocação.`);
                }

                return {
                    veiculo,
                    cap: Number(cap) || 0,
                    motoristasFixos: parteMotoristasFixos || [],
                    monitoresFixos: parteMonitoresFixos || [],
                    alunosParte: []
                };
            }

            // Caso Integral: não mistura com outros turnos
            if (rem['Integral'].length) {
                while (rem['Integral'].length) {
                    const demanda = rem['Integral'].length;
                    const turnos = { integral: true, manha: false, tarde: false, noite: false };

                    const parte = await selecionarParte(demanda, turnos);
                    const cap = parte.cap || demanda;

                    parte.alunosParte.push(...rem['Integral'].splice(0, cap));
                    partesMeta.push(parte);

                    // Sem veículo: cria UMA rota excedente com o restante e para.
                    if (!parte.veiculo) {
                        const resto = rem['Integral'].splice(0);
                        if (resto.length) {
                            partesMeta.push({
                                veiculo: null,
                                cap: resto.length,
                                motoristasFixos: [],
                                monitoresFixos: [],
                                alunosParte: resto
                            });
                        }
                        break;
                    }
                }

                return partesMeta
                    .filter(p => Array.isArray(p.alunosParte) && p.alunosParte.length)
                    .map(p => ({
                        bucket: construirBucketParcial({ alunosParte: p.alunosParte }),
                        veiculo: p.veiculo,
                        motoristasFixos: p.motoristasFixos,
                        monitoresFixos: p.monitoresFixos
                    }));
            }

            // Caso manhã/tarde/noite: cria as partes (rotas) primeiro, depois distribui balanceado por turno.
            const need = {
                manha: rem['Manhã'].length,
                tarde: rem['Tarde'].length,
                noite: rem['Noite'].length
            };

            function needsAny() {
                return (need.manha > 0) || (need.tarde > 0) || (need.noite > 0);
            }

            // Capacidade "planejada" para rotas sem veículo:
            // - usa a maior capacidade real da frota disponível; se não houver, usa 45 como fallback seguro.
            const _capsDisponiveis = (veiculos || [])
                .map(v => capacidadeRealVeiculo(v))
                .filter(c => Number.isFinite(c) && c > 0);
            const capPadraoSemVeiculo = _capsDisponiveis.length ? Math.max(..._capsDisponiveis) : 45;

            // Cria partes até "cobrir" a demanda (capacidade por turno é a do veículo)
            // Importante: se faltar frota, ainda assim criamos novas partes SEM VEÍCULO respeitando capPadraoSemVeiculo,
            // para não deixar tudo agrupado em uma única rota.
            while (needsAny()) {
                const demanda = Math.max(need.manha, need.tarde, need.noite);
                const turnos = {
                    integral: false,
                    manha: need.manha > 0,
                    tarde: need.tarde > 0,
                    noite: need.noite > 0
                };

                const parte = await selecionarParte(demanda, turnos);
                if (!parte || typeof parte !== 'object') break;

                // Garante estrutura mínima
                if (!Array.isArray(parte.alunosParte)) parte.alunosParte = [];

                // Se vier sem veículo, não "engole" todo o restante.
                // Em vez disso, usa uma capacidade planejada e continua criando partes até cobrir a demanda.
                if (!parte.veiculo) {
                    const cap = (Number.isFinite(Number(parte.cap)) && Number(parte.cap) > 0)
                        ? Number(parte.cap)
                        : capPadraoSemVeiculo;

                    parte.cap = cap;
                    partesMeta.push(parte);

                    if (need.manha > 0) need.manha = Math.max(0, need.manha - cap);
                    if (need.tarde > 0) need.tarde = Math.max(0, need.tarde - cap);
                    if (need.noite > 0) need.noite = Math.max(0, need.noite - cap);

                    if (!Number.isFinite(cap) || cap <= 0) break;
                    continue;
                }

                partesMeta.push(parte);

                // Atualiza necessidades por turno (cada parte adiciona "cap" para cada turno)
                const cap = Number(parte.cap) || demanda;
                if (need.manha > 0) need.manha = Math.max(0, need.manha - cap);
                if (need.tarde > 0) need.tarde = Math.max(0, need.tarde - cap);
                if (need.noite > 0) need.noite = Math.max(0, need.noite - cap);

                // Segurança: evita loop caso cap inválida
                if (!Number.isFinite(cap) || cap <= 0) break;
            }

            // Distribuição balanceada por turno:
            // escolhe sempre a parte menos "cheia" naquele turno (qtd/cap).
            function alocarTurno(turnoKey, campoQtd) {
                const lista = rem[turnoKey] || [];
                if (!lista.length) return;

                for (const aluno of lista) {
                    let melhor = null;
                    let melhorScore = Infinity;

                    for (const p of partesMeta) {
                        const cap = Number(p.cap) || 0;
                        if (cap <= 0) continue;

                        const usado = Number(p[campoQtd] || 0);
                        if (usado >= cap) continue;

                        const score = usado / cap; // menor = mais vazio
                        if (score < melhorScore) {
                            melhorScore = score;
                            melhor = p;
                        }
                    }

                    if (!melhor) {
                        // fallback: cria parte sem veículo para não perder alunos
                        melhor = { veiculo: null, cap: capPadraoSemVeiculo, motoristasFixos: [], monitoresFixos: [], alunosParte: [] };
                        partesMeta.push(melhor);
                    }

                    melhor.alunosParte.push(aluno);
                    melhor[campoQtd] = (Number(melhor[campoQtd] || 0) + 1);
                }

                rem[turnoKey] = [];
            }

            // Inicializa contadores por turno em cada parte
            for (const p of partesMeta) {
                p.qtdManha = 0;
                p.qtdTarde = 0;
                p.qtdNoite = 0;
            }

            alocarTurno('Manhã', 'qtdManha');
            alocarTurno('Tarde', 'qtdTarde');
            alocarTurno('Noite', 'qtdNoite');

            return partesMeta
                .filter(p => Array.isArray(p.alunosParte) && p.alunosParte.length)
                .map(p => ({
                    bucket: construirBucketParcial({ alunosParte: p.alunosParte }),
                    veiculo: p.veiculo,
                    motoristasFixos: p.motoristasFixos,
                    monitoresFixos: p.monitoresFixos
                }));
        }

        // Variante: DISTRIBUIÇÃO (espalha alunos entre veículos disponíveis)
        // - Útil principalmente em itinerários EXCLUSIVOS, onde lotar um veículo pode deixar a rota muito demorada.
        // - Cria 1 rota por veículo disponível (até o limite de alunos), e atribui cada aluno ao veículo
        //   com menor quantidade no turno dele, respeitando lotação e a regra de conflito de turnos por veículo.
        async function repartirBucketEmRotasDistribuir(bucket) {
            const rem = {
                'Integral': bucket.alunos.filter(a => a.turno === 'Integral'),
                'Manhã': bucket.alunos.filter(a => a.turno === 'Manhã'),
                'Tarde': bucket.alunos.filter(a => a.turno === 'Tarde'),
                'Noite': bucket.alunos.filter(a => a.turno === 'Noite')
            };

            const totalAlunos = bucket.alunos.length || 0;
            if (totalAlunos <= 0) return [];

            // Monta lista de veículos candidatos: primeiro os "fixos" (ordem das rotas antigas), depois o restante.
            const candidatos = [];
            const seen = new Set();

            if (Array.isArray(veiculosFixosFila) && veiculosFixosFila.length) {
                for (const vid of veiculosFixosFila) {
                    const n = Number(vid);
                    if (!Number.isInteger(n) || n <= 0) continue;
                    if (seen.has(n)) continue;
                    seen.add(n);
                    candidatos.push(n);
                }
                // Não consome a fila aqui; o consumo continua sendo feito pela criação das partes abaixo.
            }

            for (const v of (veiculos || [])) {
                const n = Number(v?.id);
                if (!Number.isInteger(n) || n <= 0) continue;
                if (seen.has(n)) continue;
                seen.add(n);
                candidatos.push(n);
            }

            // Quantidade máxima de rotas (não faz sentido criar mais rotas do que alunos)
            const maxRotas = Math.max(1, Math.min(candidatos.length || 0, totalAlunos));

            const partesMeta = [];

            function nextMotoristasFixos() {
                return (Array.isArray(motoristasFixosFila) && motoristasFixosFila.length) ? (motoristasFixosFila.shift() || []) : [];
            }
            function nextMonitoresFixos() {
                return (Array.isArray(monitoresFixosFila) && monitoresFixosFila.length) ? (monitoresFixosFila.shift() || []) : [];
            }

            for (let i = 0; i < maxRotas; i++) {
                const veiculoId = candidatos[i] || null;
                const veiculo = veiculoId ? (veiculos.find(v => Number(v?.id) === Number(veiculoId)) || null) : null;

                const cap = veiculo ? capacidadeRealVeiculo(veiculo) : totalAlunos;
                if (veiculo && (!Number.isFinite(cap) || cap <= 0)) {
                    throw new Error(`Veículo ${Number(veiculo?.id) || 'desconhecido'} sem capacidade válida para alocação.`);
                }

                partesMeta.push({
                    veiculo,
                    cap: Number(cap) || 0,
                    motoristasFixos: nextMotoristasFixos(),
                    monitoresFixos: nextMonitoresFixos(),
                    alunosParte: [],
                    // controle interno
                    turnosUsados: { manha: false, tarde: false, noite: false, integral: false },
                    contagem: { manha: 0, tarde: 0, noite: 0, integral: 0 }
                });
            }

            // fallback: sem veículos -> cria uma única parte sem veículo
            if (!partesMeta.length) {
                partesMeta.push({
                    veiculo: null,
                    cap: totalAlunos,
                    motoristasFixos: [],
                    monitoresFixos: [],
                    alunosParte: [],
                    turnosUsados: { manha: false, tarde: false, noite: false, integral: false },
                    contagem: { manha: 0, tarde: 0, noite: 0, integral: 0 }
                });
            }

            function turnoKey(turno) {
                if (turno === 'Manhã') return 'manha';
                if (turno === 'Tarde') return 'tarde';
                if (turno === 'Noite') return 'noite';
                if (turno === 'Integral') return 'integral';
                return null;
            }

            function podeAtribuir(parte, turno) {
                const tk = turnoKey(turno);
                if (!tk) return false;

                const permiteIntegralComNoite = modoTurnos === 'integral_noite';
                const temIntegral = parte.contagem.integral > 0;
                const temManha = parte.contagem.manha > 0;
                const temTarde = parte.contagem.tarde > 0;
                const temNoite = parte.contagem.noite > 0;
                const temDiurno = temManha || temTarde;

                // Regra padrão: Integral não mistura com outros turnos.
                // Exceção: no modo integral_noite, Integral pode coexistir com Noite,
                // mas nunca com Manhã/Tarde.
                if (tk === 'integral') {
                    if (temDiurno) return false;
                    if (!permiteIntegralComNoite && temNoite) return false;
                } else if (tk === 'noite') {
                    if (temDiurno) return false;
                    if (temIntegral && !permiteIntegralComNoite) return false;
                } else {
                    if (temIntegral || temNoite) return false;
                }

                const totalParte = parte.alunosParte.length;
                if (Number.isFinite(parte.cap) && parte.cap > 0 && totalParte >= parte.cap) return false;

                // sem veículo sempre pode (até o limite de cap)
                if (!parte.veiculo) return true;

                const veiculoId = Number(parte.veiculo?.id);
                if (!Number.isInteger(veiculoId) || veiculoId <= 0) return false;

                // se ainda não marcou este turno para este veículo, verifica conflito global
                if (!parte.turnosUsados[tk]) {
                    const turnosObj = {
                        integral: tk === 'integral',
                        manha: tk === 'manha',
                        tarde: tk === 'tarde',
                        noite: tk === 'noite'
                    };
                    const uso = usoVeiculo.get(veiculoId);
                    if (haConflitoTurno(uso, turnosObj)) return false;
                }

                return true;
            }

            function marcarTurnoParte(parte, turno) {
                const tk = turnoKey(turno);
                if (!tk) return;

                if (!parte.veiculo) {
                    parte.turnosUsados[tk] = true;
                    return;
                }

                const veiculoId = Number(parte.veiculo?.id);
                if (!Number.isInteger(veiculoId) || veiculoId <= 0) return;

                if (!parte.turnosUsados[tk]) {
                    const turnosObj = {
                        integral: tk === 'integral',
                        manha: tk === 'manha',
                        tarde: tk === 'tarde',
                        noite: tk === 'noite'
                    };
                    marcarUso(veiculoId, turnosObj);
                    parte.turnosUsados[tk] = true;
                }
            }

            function escolherParte(turno) {
                const tk = turnoKey(turno);
                if (!tk) return null;

                let best = null;
                let bestCount = Number.POSITIVE_INFINITY;
                let bestTotal = Number.POSITIVE_INFINITY;

                for (const p of partesMeta) {
                    if (!podeAtribuir(p, turno)) continue;

                    const c = Number(p.contagem[tk] || 0);
                    const tot = p.alunosParte.length || 0;

                    // menor contagem no turno; desempata pelo menor total
                    if (c < bestCount || (c === bestCount && tot < bestTotal)) {
                        best = p;
                        bestCount = c;
                        bestTotal = tot;
                    }
                }
                return best;
            }

            // Distribui de forma balanceada por turno: sempre coloca o próximo aluno no "menor" veículo do turno.
            const filas = {
                'Integral': rem['Integral'].slice(),
                'Manhã': rem['Manhã'].slice(),
                'Tarde': rem['Tarde'].slice(),
                'Noite': rem['Noite'].slice()
            };

            function filasTemAlgum() {
                return filas['Integral'].length || filas['Manhã'].length || filas['Tarde'].length || filas['Noite'].length;
            }

            // Processa Integral primeiro (não mistura)
            while (filas['Integral'].length) {
                const aluno = filas['Integral'].shift();
                const parte = escolherParte('Integral') || partesMeta[0];
                if (!parte) break;
                if (!podeAtribuir(parte, 'Integral')) {
                    // cria parte sem veículo excedente
                    const pExtra = {
                        veiculo: null,
                        cap: filas['Integral'].length + 1,
                        motoristasFixos: [],
                        monitoresFixos: [],
                        alunosParte: [],
                        turnosUsados: { manha: false, tarde: false, noite: false, integral: false },
                        contagem: { manha: 0, tarde: 0, noite: 0, integral: 0 }
                    };
                    partesMeta.push(pExtra);
                    pExtra.alunosParte.push(aluno);
                    pExtra.contagem.integral += 1;
                    pExtra.turnosUsados.integral = true;
                    continue;
                }
                marcarTurnoParte(parte, 'Integral');
                parte.alunosParte.push(aluno);
                parte.contagem.integral += 1;
            }

            // Agora manhã/tarde/noite
            while (filasTemAlgum()) {
                // ordem: manhã -> tarde -> noite (mantém previsível)
                for (const t of ['Manhã', 'Tarde', 'Noite']) {
                    if (!filas[t].length) continue;
                    const aluno = filas[t].shift();

                    let parte = escolherParte(t);

                    if (!parte) {
                        // sem parte elegível: cria uma rota excedente sem veículo
                        const pExtra = {
                            veiculo: null,
                            cap: 999999,
                            motoristasFixos: [],
                            monitoresFixos: [],
                            alunosParte: [],
                            turnosUsados: { manha: false, tarde: false, noite: false, integral: false },
                            contagem: { manha: 0, tarde: 0, noite: 0, integral: 0 }
                        };
                        partesMeta.push(pExtra);
                        parte = pExtra;
                    }

                    marcarTurnoParte(parte, t);
                    parte.alunosParte.push(aluno);

                    const tk = turnoKey(t);
                    if (tk) parte.contagem[tk] += 1;
                }

                // só Integral pode ficar com alunos aqui (se já foi tudo)
                if (!(filas['Manhã'].length || filas['Tarde'].length || filas['Noite'].length)) break;
            }

            return partesMeta
                .filter(p => Array.isArray(p.alunosParte) && p.alunosParte.length)
                .map(p => ({
                    bucket: construirBucketParcial({ alunosParte: p.alunosParte }),
                    veiculo: p.veiculo,
                    motoristasFixos: p.motoristasFixos,
                    monitoresFixos: p.monitoresFixos
                }));
        }


        async function mesclarRotasRedundantesDoItinerario(itinerarioId) {
            const MERGE_MAX_PONTOS = 20;

            // Segurança: evita inserir tenant_id NULL em tabelas multi-tenant
            const tenantIdSafe = (Number.isInteger(Number(tenantId)) && Number(tenantId) > 0) ? Number(tenantId) : 1;

            // carrega rotas criadas (no mesmo TX) com capacidade real do veículo
            const rotasRes = await client.query(`
                SELECT
                    r.id,
                    r.veiculo_id,
                    COALESCE(v.capacidade_lotacao, r.capacidade) AS cap,
                    COALESCE(r.qtd_alunos_manha,0)    AS manha,
                    COALESCE(r.qtd_alunos_tarde,0)    AS tarde,
                    COALESCE(r.qtd_alunos_noite,0)    AS noite,
                    COALESCE(r.qtd_alunos_integral,0) AS integral
                FROM itinerario_rotas ir
                JOIN rotas_escolares r ON r.id = ir.rota_id
                LEFT JOIN veiculos v   ON v.id = r.veiculo_id
                WHERE ir.itinerario_id = $1
            `, [itinerarioId]);

            const rotas = (rotasRes.rows || []).map(r => ({
                id: Number(r.id),
                veiculo_id: r.veiculo_id != null ? Number(r.veiculo_id) : null,
                cap: Number(r.cap) || 0,
                manha: Number(r.manha) || 0,
                tarde: Number(r.tarde) || 0,
                noite: Number(r.noite) || 0,
                integral: Number(r.integral) || 0
            }));

            if (rotas.length < 2) return;

            // pontos por rota (para não estourar 20 waypoints)
            const ptsRes = await client.query(`
                SELECT rota_id, array_agg(ponto_id) AS pontos
                FROM rotas_escolares_pontos
                WHERE rota_id = ANY($1::int[])
                GROUP BY rota_id
            `, [rotas.map(r => r.id)]);

            const pontosPorRota = new Map();
            for (const row of (ptsRes.rows || [])) {
                pontosPorRota.set(Number(row.rota_id), (row.pontos || []).map(Number));
            }

            function setSizeUniao(a, b) {
                const s = new Set();
                (a || []).forEach(x => s.add(x));
                (b || []).forEach(x => s.add(x));
                return s.size;
            }

            function maxTurno(r) {
                return Math.max(r.manha, r.tarde, r.noite, r.integral);
            }

            // tenta mesclar repetidamente (porque uma mescla pode liberar outra)
            let mudou = true;
            while (mudou) {
                mudou = false;

                // ordena: tenta enfiar os pequenos dentro dos maiores
                const fontes = rotas
                    .filter(r => r.__remover !== true)
                    .sort((a, b) => maxTurno(a) - maxTurno(b) || a.id - b.id);

                const destinos = rotas
                    .filter(r => r.__remover !== true && r.veiculo_id != null && r.cap > 0)
                    .sort((a, b) => b.cap - a.cap || a.id - b.id);

                for (const src of fontes) {
                    if (src.__remover) continue;
                    // não faz sentido tentar "mesclar" em rota sem veículo (vamos tentar mesclar a rota sem veículo em alguma com veículo)
                    // e também não mescla rota em si mesma
                    for (const dst of destinos) {
                        if (dst.__remover) continue;
                        if (dst.id === src.id) continue;

                        // se src tem Integral, só mescla em rota que também seja Integral (não mistura Integral com outros turnos)
                        const srcEhIntegral = src.integral > 0;
                        const dstEhIntegral = dst.integral > 0;
                        if (srcEhIntegral !== dstEhIntegral) continue;
                        if (srcEhIntegral && (src.manha || src.tarde || src.noite)) continue;
                        if (dstEhIntegral && (dst.manha || dst.tarde || dst.noite)) continue;

                        const novoManha = dst.manha + src.manha;
                        const novoTarde = dst.tarde + src.tarde;
                        const novoNoite = dst.noite + src.noite;
                        const novoIntegral = dst.integral + src.integral;

                        const novaDemanda = Math.max(novoManha, novoTarde, novoNoite, novoIntegral);
                        if (novaDemanda > dst.cap) continue;

                        const ptsDst = pontosPorRota.get(dst.id) || [];
                        const ptsSrc = pontosPorRota.get(src.id) || [];
                        const uniaoPts = setSizeUniao(ptsDst, ptsSrc);
                        if (uniaoPts > MERGE_MAX_PONTOS) continue;

                        // OK: faz a mescla (move alunos, atualiza contadores, pontos; apaga rota src)
                        await client.query(
                            `UPDATE rotas_escolares_alunos
                                SET rota_id = $1
                              WHERE rota_id = $2
                                AND tenant_id = $3`,
                            [dst.id, src.id, tenantIdSafe]
                        );

                        // atualiza contadores e qtd_paradas na rota destino (sem depender de recalcular turno via SQL)
                        await client.query(
                            `
                            UPDATE rotas_escolares
                            SET
                                qtd_alunos_manha = $2,
                                qtd_alunos_tarde = $3,
                                qtd_alunos_noite = $4,
                                qtd_alunos_integral = $5,
                                qtd_paradas = $6
                            WHERE id = $1
                              AND tenant_id = $7
                            `,
                            [dst.id, novoManha, novoTarde, novoNoite, novoIntegral, uniaoPts, tenantIdSafe]
                        );

                        // pontos: recria para destino a partir da união (qtd_alunos por ponto é apenas informativo no UI)
                        await client.query(
                            `DELETE FROM rotas_escolares_pontos
                              WHERE rota_id = $1
                                AND tenant_id = $2`,
                            [dst.id, tenantIdSafe]
                        );

                        const pontosUnion = Array.from(new Set([...(ptsDst || []), ...(ptsSrc || [])]));
                        for (const pontoId of pontosUnion) {
                            const qtd = await client.query(
                                `SELECT COUNT(*)::int AS total
                                   FROM rotas_escolares_alunos
                                  WHERE rota_id = $1
                                    AND ponto_id = $2
                                    AND tenant_id = $3`,
                                [dst.id, pontoId, tenantIdSafe]
                            );
                            const total = qtd.rows[0]?.total || 0;
                            await client.query(
                                `
                                INSERT INTO rotas_escolares_pontos (rota_id, ponto_id, qtd_alunos, tenant_id)
                                VALUES ($1,$2,$3,COALESCE($4,1))
                                ON CONFLICT (rota_id, ponto_id)
                                DO UPDATE SET qtd_alunos = EXCLUDED.qtd_alunos
                                `,
                                [dst.id, pontoId, total, tenantIdSafe]
                            );
                        }

                        // remove a rota fonte
                        await client.query(
                            `DELETE FROM itinerario_rotas
                              WHERE itinerario_id = $1
                                AND rota_id = $2
                                AND tenant_id = $3`,
                            [itinerarioId, src.id, tenantIdSafe]
                        );
                        await client.query(
                            `DELETE FROM rotas_escolares
                              WHERE id = $1
                                AND tenant_id = $2`,
                            [src.id, tenantIdSafe]
                        );

                        // atualiza estruturas em memória
                        dst.manha = novoManha; dst.tarde = novoTarde; dst.noite = novoNoite; dst.integral = novoIntegral;
                        pontosPorRota.set(dst.id, pontosUnion);
                        src.__remover = true;
                        mudou = true;
                        break;
                    }
                    if (mudou) break;
                }
            }
        }



        let rotasCriadas = [];
        const avisos = [];
        const alunosAtribuidosSet = new Set();
        const duplicadosGeracao = [];

        for (let i = 0; i < buckets.length; i++) {
            const bucket = buckets[i];

            // ignora buckets vazios
            if (!bucket.alunos.length) continue;

            // Para cada bucket, cria 1..N rotas, dividindo conforme necessidade e frota disponível
            const partes = (itinerarioTipo === 'exclusiva' && modoAlocacao === 'distribuir')
                ? await repartirBucketEmRotasDistribuir(bucket)
                : await repartirBucketEmRotas(bucket);

            for (const parte of partes) {
                const b = parte.bucket;
                const v = parte.veiculo;

                const qtdParadas = (itinerarioTipo === 'exclusiva') ? b.alunos.length : b.pontosSet.size;

                const veiculoId = v ? v.id : null;
                const fornecedorId = v && v.fornecedor_id ? v.fornecedor_id : null;

                // capacidade REAL da rota: se tem veículo -> capacidade_lotacao dele.
                // senão -> demanda da rota (maior turno) só para registro.
                const capacidadeRota = v
                    ? capacidadeRealVeiculo(v) || null
                    : Math.max(b.qtdIntegral || 0, b.qtdManha || 0, b.qtdTarde || 0, b.qtdNoite || 0) || null;

                const nomeRota = gerarNomeRota(itinerarioId, baseIndex++);
                if (!veiculoId) {
                    avisos.push(`Rota ${nomeRota} criada sem veículo: frota insuficiente para atender (turnos: `
                        + `${b.qtdIntegral ? 'Integral' : ''}`
                        + `${!b.qtdIntegral && b.qtdManha ? 'Manhã' : ''}`
                        + `${!b.qtdIntegral && b.qtdTarde ? (b.qtdManha ? ', Tarde' : 'Tarde') : ''}`
                        + `${!b.qtdIntegral && b.qtdNoite ? ((b.qtdManha || b.qtdTarde) ? ', Noite' : 'Noite') : ''}`
                        + `).`);
                }

                const insertRotaSql = `
                    INSERT INTO rotas_escolares (
                        nome,
                        veiculo_id,
                        fornecedor_id,
                        capacidade,
                        qtd_alunos_manha,
                        qtd_alunos_tarde,
                        qtd_alunos_noite,
                        qtd_alunos_integral,
                        qtd_paradas,
                        status,
                        tipo,
                        tenant_id
                    ) VALUES (
                        $1,$2,$3,$4,$5,$6,$7,$8,$9,'ativo',$10,$11
                    )
                    RETURNING *;
                `;
                const insertRotaRes = await client.query(insertRotaSql, [
                    nomeRota,
                    veiculoId,
                    fornecedorId,
                    capacidadeRota,
                    b.qtdManha,
                    b.qtdTarde,
                    b.qtdNoite,
                    b.qtdIntegral,
                    qtdParadas,
                    itinerarioTipo,
                    tenantId
                ]);

                const rota = insertRotaRes.rows[0];

                await client.query(
                    'INSERT INTO itinerario_rotas (itinerario_id, rota_id, tenant_id) VALUES ($1,$2,$3)',
                    [itinerarioId, rota.id, tenantId]
                );

                // Reaplica associações (motorista/monitor) preservadas das rotas antigas, quando existirem
                if (Array.isArray(parte.motoristasFixos) && parte.motoristasFixos.length) {
                    for (const motoristaId of parte.motoristasFixos) {
                        await client.query(
                            `
                            INSERT INTO motoristas_rotas (tenant_id, motorista_id, rota_escolar_id)
                            VALUES ($1,$2,$3)
                            ON CONFLICT (tenant_id, motorista_id, rota_escolar_id) DO NOTHING;
                            `,
                            [tenantId, motoristaId, rota.id]
                        );
                    }
                }

                if (Array.isArray(parte.monitoresFixos) && parte.monitoresFixos.length) {
                    for (const monitorId of parte.monitoresFixos) {
                        await client.query(
                            `
                            INSERT INTO monitores_rotas (tenant_id, monitor_id, rota_escolar_id)
                            VALUES ($1,$2,$3)
                            ON CONFLICT (tenant_id, monitor_id, rota_escolar_id) DO NOTHING;
                            `,
                            [tenantId, monitorId, rota.id]
                        );
                    }
                }

                // vincula alunos à rota (garante que um aluno não seja incluído em duas rotas nesta mesma geração)
                for (const aluno of b.alunos) {
                    const alunoIdNum = Number(aluno?.aluno_id ?? aluno?.id);
                    if (!Number.isInteger(alunoIdNum) || alunoIdNum <= 0) continue;

                    if (alunosAtribuidosSet.has(alunoIdNum)) {
                        duplicadosGeracao.push({ aluno_id: alunoIdNum, rota_id_destino: rota.id });
                        continue;
                    }
                    alunosAtribuidosSet.add(alunoIdNum);

                    await client.query(
                        `
                        INSERT INTO rotas_escolares_alunos (rota_id, aluno_id, ponto_id, tenant_id)
                        VALUES ($1,$2,$3,$4)
                        ON CONFLICT (rota_id, aluno_id) DO NOTHING;
                        `,
                        [rota.id, alunoIdNum, aluno.ponto_id || null, tenantId]
                    );
                }

                // vincula pontos com contagem de alunos na rota (somente para rotas baseadas em pontos)
                if (itinerarioTipo !== 'exclusiva') {
                    for (const pontoId of b.pontosSet) {
                        const qtdAlunosPonto = b.alunos.filter(a => a.ponto_id === pontoId).length;
                        await client.query(
                            `
                        INSERT INTO rotas_escolares_pontos (rota_id, ponto_id, qtd_alunos, tenant_id)
                        VALUES ($1,$2,$3,COALESCE($4,1))
                        ON CONFLICT (rota_id, ponto_id) 
                        DO UPDATE SET qtd_alunos = EXCLUDED.qtd_alunos;
                        `,
                            [rota.id, pontoId, qtdAlunosPonto, tenantId]
                        );
                    }
                }

                rotasCriadas.push({
                    id: rota.id,
                    nome: rota.nome,
                    capacidade: rota.capacidade,
                    qtd_alunos_manha: rota.qtd_alunos_manha,
                    qtd_alunos_tarde: rota.qtd_alunos_tarde,
                    qtd_alunos_noite: rota.qtd_alunos_noite,
                    qtd_alunos_integral: rota.qtd_alunos_integral,
                    qtd_paradas: rota.qtd_paradas,
                    veiculo_id: rota.veiculo_id,
                    fornecedor_id: rota.fornecedor_id
                });
            }
        }
        // Tenta reduzir rotas redundantes (ex.: rota pequena que cabe em outra) antes de finalizar
        if (itinerarioTipo !== 'exclusiva') {
            await mesclarRotasRedundantesDoItinerario(itinerarioId);
        }

        // Recarrega as rotas finais do itinerário para retornar ao frontend já consolidadas
        const finalRes = await client.query(
            `
    SELECT 
      r.id,
      r.nome,
      r.capacidade,
      r.qtd_alunos_manha,
      r.qtd_alunos_tarde,
      r.qtd_alunos_noite,
      r.qtd_alunos_integral,
      r.qtd_paradas,
      r.veiculo_id,
      r.fornecedor_id
    FROM itinerario_rotas ir
    JOIN rotas_escolares r ON r.id = ir.rota_id
    WHERE ir.itinerario_id = $1 AND ir.tenant_id = $2 AND r.tenant_id = $2
    ORDER BY r.nome ASC
  `,
            [itinerarioId, tenantId]
        );

        rotasCriadas = finalRes.rows || [];

        await client.query('COMMIT');

        const messageFinal = avisos.length
            ? `Rotas geradas para o itinerário #${itinerarioId} (ATENÇÃO: ${avisos.length} rota(s) criada(s) sem veículo por falta de frota).`
            : `Rotas geradas para o itinerário #${itinerarioId}`;

        return res.json({
            message: messageFinal,
            rotas: rotasCriadas,
            avisos: [
                ...avisos,
                ...(duplicadosGeracao.length ? [`${duplicadosGeracao.length} aluno(s) foram ignorados por tentativa de duplicação dentro da própria geração.`] : [])
            ],
            conflitos_alunos: conflitosAlunos,
            duplicados_geracao: duplicadosGeracao
        });

    } catch (err) {
        console.error('Erro ao gerar rotas do itinerário', err);
        try {
            await client.query('ROLLBACK');
        } catch (e) {
            console.error('Erro ao dar ROLLBACK', e);
        }
        return res.status(500).json({ error: 'Erro ao gerar rotas do itinerário' });
    } finally {
        client.release();
    }
});


/* =======================================================================
   PERCURSOS (GOOGLE DIRECTIONS) EM LOTE POR ITINERÁRIO
   - Gera e salva rotas_percursos para cada rota do itinerário
   - Observação: para respeitar limite de waypoints, rotas com >20 pontos são puladas
   ======================================================================= */

const IT_GOOGLE_MAX_WAYPOINTS = 20;

function itNormalizarCoord(lat, lng) {
    const la = Number.parseFloat(lat);
    const ln = Number.parseFloat(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
    return { lat: la, lng: ln };
}

async function itFetchGoogleDirectionsJson({ origin, destination, waypoints, optimize = true, mode = 'driving' }) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_KEY;
    if (!apiKey) {
        const err = new Error('GOOGLE_MAPS_API_KEY não configurada no backend.');
        err.statusCode = 500;
        throw err;
    }

    const params = new URLSearchParams();
    params.set('origin', `${origin.lat},${origin.lng}`);
    params.set('destination', `${destination.lat},${destination.lng}`);
    params.set('mode', mode);
    params.set('language', 'pt-BR');
    params.set('key', apiKey);

    if (Array.isArray(waypoints) && waypoints.length) {
        const wpStr = (optimize ? 'optimize:true|' : '') + waypoints.map(p => `${p.lat},${p.lng}`).join('|');
        params.set('waypoints', wpStr);
    }

    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
    const resp = await fetch(url);
    if (!resp.ok) throw new Error(`Erro ao chamar Google Directions (${resp.status})`);

    const data = await resp.json();
    if (!data || data.status !== 'OK' || !data.routes || !data.routes.length) {
        const msg = data && data.error_message ? data.error_message : (data && data.status ? data.status : 'Falha ao gerar rota');
        const err = new Error(`Google Directions: ${msg}`);
        err.statusCode = 400;
        throw err;
    }
    return data;
}

function itSomarLegs(legs) {
    let metros = 0;
    let segundos = 0;
    (Array.isArray(legs) ? legs : []).forEach(l => {
        const dm = l?.distance?.value;
        const ds = l?.duration?.value;
        if (Number.isFinite(dm)) metros += dm;
        if (Number.isFinite(ds)) segundos += ds;
    });
    return { metros, segundos };
}

function itDecodeGooglePolyline(str) {
    // Decodifica polyline do Google (encoded polyline) -> [{lat,lng}, ...]
    // Implementação leve, suficiente para montar LINESTRING no PostGIS.
    if (!str || typeof str !== 'string') return [];
    let index = 0;
    const len = str.length;
    let lat = 0;
    let lng = 0;
    const coordinates = [];

    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = str.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = (result & 1) ? ~(result >> 1) : (result >> 1);
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = str.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = (result & 1) ? ~(result >> 1) : (result >> 1);
        lng += dlng;

        coordinates.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }

    return coordinates;
}

function itCoordsToWktLineString(coords) {
    if (!Array.isArray(coords) || coords.length < 2) return null;
    const parts = [];
    for (const p of coords) {
        const lat = Number(p?.lat);
        const lng = Number(p?.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) continue;
        parts.push(`${lng} ${lat}`);
    }
    if (parts.length < 2) return null;
    return `LINESTRING(${parts.join(',')})`;
}


async function itCarregarEscolasDestino(client, itinerarioId) {
    const sql = `
        SELECT 
          e.id,
          e.nome,
          ST_Y(e.localizacao)::float AS lat,
          ST_X(e.localizacao)::float AS lng
        FROM itinerario_escola ie
        JOIN escolas e ON e.id = ie.escola_id
        WHERE ie.itinerario_id = $1
          AND e.localizacao IS NOT NULL
        ORDER BY e.id;
    `;
    const r = await client.query(sql, [itinerarioId]);
    return (r.rows || []).map(row => ({
        id: Number(row.id),
        nome: row.nome,
        lat: Number(row.lat),
        lng: Number(row.lng)
    }));
}


/**
 * POST /api/itinerarios/:id/percursos/google?turno=manha|tarde|noite|integral&force=1
 */
router.post('/:id/percursos/google', async (req, res) => {
    if (isFornecedorEscolar(req)) {
        return res.status(403).json({ error: 'Ação não permitida para FORNECEDOR_ESCOLAR.' });
    }

    const itinerarioId = parseInt(req.params.id, 10);
    if (!Number.isInteger(itinerarioId)) {
        return res.status(400).json({ error: 'ID de itinerário inválido' });
    }

    const force = ['1', 'true', 'yes'].includes(String(req.query.force || '').toLowerCase());

    // Reusa o mesmo parser de turno (mantém consistência com rotas-escolares.js)
    function parseTurnoFiltroLocal(q) {
        if (!q) return null;
        const v = q.toString().trim().toLowerCase();
        if (['manha', 'manhã', 'man'].includes(v)) return 'Manhã';
        if (['tarde', 'vesp', 'vespertino'].includes(v)) return 'Tarde';
        if (['noite', 'not', 'noturno'].includes(v)) return 'Noite';
        if (['integral', 'int'].includes(v)) return 'Integral';
        return null;
    }
    const turnoFiltro = parseTurnoFiltroLocal(req.query.turno);
    const turnoLabel = turnoFiltro ? turnoFiltro.toLowerCase() : null;

    let client;
    try {
        client = await pool.connect();

        // Lista de rotas do itinerário
        const rotasRes = await client.query(
            `SELECT r.id, r.nome, r.fornecedor_id,
                    ST_Y(f.garagem_localizacao)::float AS garagem_lat,
                    ST_X(f.garagem_localizacao)::float AS garagem_lng
               FROM itinerario_rotas ir
               JOIN rotas_escolares r ON r.id = ir.rota_id
               LEFT JOIN fornecedores f ON f.id = r.fornecedor_id
              WHERE ir.itinerario_id = $1
              ORDER BY r.id;`,
            [itinerarioId]
        );

        if (!rotasRes.rowCount) {
            return res.json({ success: true, itinerario_id: itinerarioId, total: 0, gerados: 0, pulados: [], detalhes: [] });
        }

        const escolas = await itCarregarEscolasDestino(client, itinerarioId);
        const escolasCoords = (Array.isArray(escolas) ? escolas : [])
            .map(e => itNormalizarCoord(e.lat, e.lng))
            .filter(Boolean);
        if (!escolasCoords.length) {
            return res.status(400).json({ error: 'Itinerário sem escola(s) georreferenciada(s).' });
        }

        const pulados = [];
        const detalhes = [];

        for (const rota of rotasRes.rows) {
            const rotaId = rota.id;

            // Se não for force, tenta reaproveitar
            if (!force) {
                const ex = await client.query(`SELECT id FROM rotas_percursos WHERE rota_id = $1 LIMIT 1;`, [rotaId]);
                if (ex.rowCount) {
                    detalhes.push({ rota_id: rotaId, status: 'reutilizado', percurso_id: ex.rows[0].id });
                    continue;
                }
            }

            const pontosRes = await client.query(
                `SELECT ST_Y(p.localizacao)::float AS lat, ST_X(p.localizacao)::float AS lng
                   FROM rotas_escolares_pontos rp
                   JOIN pontos_parada p ON p.id = rp.ponto_id
                  WHERE rp.rota_id = $1
                    AND p.localizacao IS NOT NULL
                  ORDER BY rp.id ASC;`,
                [rotaId]
            );

            const pontos = pontosRes.rows.map(r => itNormalizarCoord(r.lat, r.lng)).filter(Boolean);

            const garagem = itNormalizarCoord(rota.garagem_lat, rota.garagem_lng);

            if (!pontos.length && !garagem) {
                pulados.push({ rota_id: rotaId, motivo: 'Rota sem pontos e sem garagem' });
                detalhes.push({ rota_id: rotaId, status: 'pulado' });
                continue;
            }

            // Origem = garagem, senão primeiro ponto
            let origin = garagem || null;
            let stops = pontos.slice();
            if (!origin && stops.length) origin = stops.shift();

            // Limite de waypoints
            if (stops.length > IT_GOOGLE_MAX_WAYPOINTS) {
                pulados.push({ rota_id: rotaId, motivo: `Muitos pontos (${stops.length}). Limite: ${IT_GOOGLE_MAX_WAYPOINTS}` });
                detalhes.push({ rota_id: rotaId, status: 'pulado' });
                continue;
            }

            // Percurso completo:
            // garagem -> (paradas otimizadas) -> escola -> garagem
            if (!garagem) {
                pulados.push({ rota_id: rotaId, motivo: 'Fornecedor/garagem não informado para esta rota.' });
                detalhes.push({ rota_id: rotaId, status: 'pulado' });
                continue;
            }

            const calcularTrecho = async ({ origin, destination, waypoints, optimize }) => {
                const data = await itFetchGoogleDirectionsJson({
                    origin,
                    destination,
                    waypoints: Array.isArray(waypoints) ? waypoints : [],
                    optimize: Boolean(optimize)
                });

                const route0 = data.routes[0];
                const poly = route0.overview_polyline?.points || null;
                const legs = route0.legs || [];
                const soma = itSomarLegs(legs);

                if (!poly) {
                    return { ok: false, motivo: 'Google retornou sem overview_polyline' };
                }

                const coords = itDecodeGooglePolyline(poly);
                return {
                    ok: true,
                    poly,
                    coords,
                    metros: soma.metros,
                    segundos: soma.segundos
                };
            };

            // Paradas (alunos/pontos). As escolas serão visitadas AO FINAL (na melhor ordem).
            const escolasOrdenadas = ordenarCoordsNearest(escolasCoords, garagem);

            if (stops.length > IT_GOOGLE_MAX_WAYPOINTS) {
                pulados.push({
                    rota_id: rotaId,
                    motivo: `Excede limite do Google (${IT_GOOGLE_MAX_WAYPOINTS}) para waypoints (paradas + escolas): ${stops.length}`
                });
                detalhes.push({ rota_id: rotaId, status: 'pulado' });
                continue;
            }

            // 1) Garagem -> primeira escola (paradas otimizadas)
            const primeiraEscola = escolasOrdenadas[0];
            const leg1 = await calcularTrecho({ origin: garagem, destination: primeiraEscola, waypoints: stops, optimize: true });

            let totalMetros = (leg1.totalMetros || 0);
            let totalSegundos = (leg1.totalSegundos || 0);
            let overviewPolylineFinal = leg1.overviewPolylineFinal || '';
            let coordsFinal = (leg1.coordsFinal || []).slice();

            // 2) Entre escolas
            for (let i = 0; i < escolasOrdenadas.length - 1; i++) {
                const a = escolasOrdenadas[i];
                const b = escolasOrdenadas[i + 1];
                const leg = await calcularTrecho({ origin: a, destination: b, waypoints: [], optimize: false });
                totalMetros += (leg.totalMetros || 0);
                totalSegundos += (leg.totalSegundos || 0);
                if (leg.overviewPolylineFinal) overviewPolylineFinal = leg.overviewPolylineFinal;
                if (Array.isArray(leg.coordsFinal) && leg.coordsFinal.length) coordsFinal = coordsFinal.concat(leg.coordsFinal.slice(1));
            }

            // 3) Última escola -> garagem (retorno)
            const ultimaEscola = escolasOrdenadas[escolasOrdenadas.length - 1];
            const legBack = await calcularTrecho({ origin: ultimaEscola, destination: garagem, waypoints: [], optimize: false });
            totalMetros += (legBack.totalMetros || 0);
            totalSegundos += (legBack.totalSegundos || 0);
            if (legBack.overviewPolylineFinal) overviewPolylineFinal = legBack.overviewPolylineFinal;
            if (Array.isArray(legBack.coordsFinal) && legBack.coordsFinal.length) coordsFinal = coordsFinal.concat(legBack.coordsFinal.slice(1));

            const wkt = itCoordsToWktLineString(coordsFinal);
            if (!wkt) {
                pulados.push({ rota_id: rotaId, motivo: 'Não foi possível montar LINESTRING do percurso (polyline vazia).' });
                detalhes.push({ rota_id: rotaId, status: 'pulado' });
                continue;
            }
            const upsert = await client.query(
                `
                INSERT INTO rotas_percursos (
                    rota_id,
                    trajeto,
                    origem,
                    destino,
                    distancia_m,
                    duracao_seg,
                    overview_polyline,
                    turno_label,
                    fonte,
                    created_at,
                    updated_at
                )
                VALUES (
                    $1,
                    ST_GeomFromText($2, 4326),
                    ST_SetSRID(ST_MakePoint($3::double precision, $4::double precision), 4326),
                    ST_SetSRID(ST_MakePoint($5::double precision, $6::double precision), 4326),
                    $7,
                    $8,
                    $9,
                    $10,
                    'google_maps',
                    NOW(),
                    NOW()
                )
                ON CONFLICT (rota_id) DO UPDATE
                SET
                    trajeto           = EXCLUDED.trajeto,
                    origem            = EXCLUDED.origem,
                    destino           = EXCLUDED.destino,
                    distancia_m       = EXCLUDED.distancia_m,
                    duracao_seg       = EXCLUDED.duracao_seg,
                    overview_polyline = EXCLUDED.overview_polyline,
                    turno_label       = EXCLUDED.turno_label,
                    fonte             = EXCLUDED.fonte,
                    updated_at        = NOW()
                RETURNING id;
                `,
                [
                    rotaId,
                    wkt,
                    garagem.lng, garagem.lat,
                    garagem.lng, garagem.lat,
                    Math.round(totalMetros) || null,
                    Math.round(totalSegundos) || null,
                    overviewPolylineFinal,
                    turnoLabel
                ]);

            detalhes.push({ rota_id: rotaId, status: 'gerado', percurso_id: upsert.rows[0]?.id || null });
        }

        const gerados = detalhes.filter(d => d.status === 'gerado').length;
        const reutilizados = detalhes.filter(d => d.status === 'reutilizado').length;

        return res.json({
            success: true,
            itinerario_id: itinerarioId,
            total: rotasRes.rowCount,
            gerados,
            reutilizados,
            pulados,
            detalhes
        });
    } catch (err) {
        console.error('Erro ao gerar percursos do itinerário:', err);
        const code = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
        return res.status(code).json({ error: err.message || 'Erro ao gerar percursos do itinerário.' });
    } finally {
        if (client) client.release();
    }
});

export default router;