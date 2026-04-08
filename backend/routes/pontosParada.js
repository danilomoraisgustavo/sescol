// backend: src/routes/pontosParada.js
import express from "express";
import pool from "../db.js"; // seu pool do pg
import authMiddleware from "../middleware/auth.js";
import tenantMiddleware from "../middleware/tenant.js";

const router = express.Router();

// Protege TODAS as rotas e fixa o tenant a partir do JWT/cookie (sem aceitar spoof por header/query)
router.use(authMiddleware, tenantMiddleware);

let pontosParadaSchemaCache = null;

async function getPontosParadaSchema() {
    if (pontosParadaSchemaCache) return pontosParadaSchemaCache;
    const { rows } = await pool.query(`
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND (
            (table_name = 'pontos_parada' AND column_name IN ('tenant_id'))
            OR
            (table_name = 'zoneamentos' AND column_name IN ('tenant_id'))
          )
    `);

    const support = {
        pontosTenant: false,
        zoneamentosTenant: false
    };

    for (const row of rows || []) {
        if (row.table_name === 'pontos_parada' && row.column_name === 'tenant_id') support.pontosTenant = true;
        if (row.table_name === 'zoneamentos' && row.column_name === 'tenant_id') support.zoneamentosTenant = true;
    }

    pontosParadaSchemaCache = support;
    return support;
}

/**
 * Monta expressão de POINT para uso direto em SQL.
 * localizacao é GEOMETRY(Point, 4326) no PostGIS.
 * OBS: lat/lng são validados como number antes de usar.
 */
function buildPointFromLatLng(lat, lng) {
    return `ST_SetSRID(ST_Point(${lng}, ${lat}), 4326)`;
}

/**
 * Tenta encontrar um zoneamento (polígono/linha) para um ponto (lat, lng) DENTRO DO TENANT.
 * Retorna:
 *  - id
 *  - tipo_zona
 *  - tipo_relacao
 *  - distancia_m
 */
async function encontrarZoneamentoParaPonto(lat, lng, tenantId) {
    const schema = await getPontosParadaSchema();
    const pointExpr = buildPointFromLatLng(lat, lng);
    const tenantWhere = schema.zoneamentosTenant ? 'tenant_id = $1 AND' : '';
    const params = schema.zoneamentosTenant ? [tenantId] : [];

    // 1) POLÍGONO que INTERSECTA o ponto
    const sqlPoligonoIntersect = `
    SELECT 
      id,
      tipo_zona,
      'poligono_intersecta'::text AS tipo_relacao,
      0::double precision AS distancia_m
    FROM zoneamentos
    WHERE ${tenantWhere}
      AND geom IS NOT NULL
      AND (
            tipo_geometria = 'polygon'
         OR GeometryType(geom) IN ('ST_Polygon', 'ST_MultiPolygon')
      )
      AND geom && ${pointExpr}
      AND ST_Intersects(geom, ${pointExpr})
    LIMIT 1;
  `;

    const resultPoligonoIntersect = await pool.query(sqlPoligonoIntersect, params);
    if (resultPoligonoIntersect.rows.length) return resultPoligonoIntersect.rows[0];

    // 2) POLÍGONO mais próximo
    const distanciaMaxPoligono = 50; // metros
    const sqlPoligonoProximo = `
    SELECT 
      id,
      tipo_zona,
      'poligono_proximo'::text AS tipo_relacao,
      ST_Distance(geom::geography, ${pointExpr}::geography) AS distancia_m
    FROM zoneamentos
    WHERE ${tenantWhere}
      AND geom IS NOT NULL
      AND (
            tipo_geometria = 'polygon'
         OR GeometryType(geom) IN ('ST_Polygon', 'ST_MultiPolygon')
      )
      AND ST_DWithin(geom::geography, ${pointExpr}::geography, ${distanciaMaxPoligono})
    ORDER BY distancia_m ASC
    LIMIT 1;
  `;

    const resultPoligonoProximo = await pool.query(sqlPoligonoProximo, params);
    if (resultPoligonoProximo.rows.length) return resultPoligonoProximo.rows[0];

    // 3) LINHA que INTERSECTA diretamente o ponto
    const sqlLinhaIntersect = `
    SELECT 
      id,
      tipo_zona,
      'linha_intersecta'::text AS tipo_relacao,
      ST_Distance(geom::geography, ${pointExpr}::geography) AS distancia_m
    FROM zoneamentos
    WHERE ${tenantWhere}
      AND geom IS NOT NULL
      AND (
            tipo_geometria = 'line'
         OR GeometryType(geom) IN ('ST_LineString', 'ST_MultiLineString')
      )
      AND ST_Intersects(geom, ${pointExpr})
    ORDER BY distancia_m ASC
    LIMIT 1;
  `;

    const resultLinhaIntersect = await pool.query(sqlLinhaIntersect, params);
    if (resultLinhaIntersect.rows.length) return resultLinhaIntersect.rows[0];

    // 4) LINHA mais próxima dentro de um raio
    const distanciaMaxLinha = 5000; // 5 km
    const sqlLinhaProxima = `
    SELECT 
      id,
      tipo_zona,
      'linha_proxima'::text AS tipo_relacao,
      ST_Distance(geom::geography, ${pointExpr}::geography) AS distancia_m
    FROM zoneamentos
    WHERE ${tenantWhere}
      AND geom IS NOT NULL
      AND (
            tipo_geometria = 'line'
         OR GeometryType(geom) IN ('ST_LineString', 'ST_MultiLineString')
      )
      AND ST_DWithin(geom::geography, ${pointExpr}::geography, ${distanciaMaxLinha})
    ORDER BY distancia_m ASC
    LIMIT 1;
  `;

    const resultLinhaProxima = await pool.query(sqlLinhaProxima, params);
    if (resultLinhaProxima.rows.length) return resultLinhaProxima.rows[0];

    // 5) ÚLTIMO RECURSO: linha mais próxima SEM LIMITE
    const sqlLinhaMaisProximaSemLimite = `
    SELECT 
      id,
      tipo_zona,
      'linha_mais_proxima_sem_limite'::text AS tipo_relacao,
      ST_Distance(geom::geography, ${pointExpr}::geography) AS distancia_m
    FROM zoneamentos
    WHERE ${tenantWhere}
      AND geom IS NOT NULL
      AND (
            tipo_geometria = 'line'
         OR GeometryType(geom) IN ('ST_LineString', 'ST_MultiLineString')
      )
    ORDER BY distancia_m ASC
    LIMIT 1;
  `;

    const resultLinhaSemLimite = await pool.query(sqlLinhaMaisProximaSemLimite, params);
    if (resultLinhaSemLimite.rows.length) return resultLinhaSemLimite.rows[0];

    return null;
}

/**
 * LISTAR TODOS — GET /api/pontos-parada
 * Retorna também latitude / longitude para uso direto no Google Maps.
 */
router.get("/", async (req, res) => {
    const tenantId = req.tenantId;

    try {
        const schema = await getPontosParadaSchema();
        const joinTenantClause = schema.zoneamentosTenant && schema.pontosTenant
            ? 'AND z.tenant_id = p.tenant_id'
            : '';
        const whereClause = schema.pontosTenant ? 'WHERE p.tenant_id = $1' : '';
        const params = schema.pontosTenant ? [tenantId] : [];
        const sql = `
      SELECT 
        p.id,
        p.area,
        p.logradouro,
        p.numero,
        p.complemento,
        p.referencia,
        p.bairro,
        p.cep,
        p.zoneamento_id,
        z.nome AS zoneamento_nome,
        z.tipo_zona AS zoneamento_tipo_zona,
        p.status,
        p.criado_em,
        p.atualizado_em,
        ST_Y(p.localizacao::geometry) AS latitude,
        ST_X(p.localizacao::geometry) AS longitude,
        ST_AsGeoJSON(p.localizacao)::json AS localizacao_geojson
      FROM pontos_parada p
      LEFT JOIN zoneamentos z 
        ON z.id = p.zoneamento_id
       ${joinTenantClause}
      ${whereClause}
      ORDER BY p.id ASC;
    `;

        const result = await pool.query(sql, params);
        return res.json(result.rows);
    } catch (err) {
        console.error("Erro ao listar pontos de parada:", err);
        return res.status(500).json({ error: "Erro ao listar pontos de parada" });
    }
});

/**
 * ASSOCIAR EM MASSA — POST /api/pontos-parada/associar-zoneamentos
 * Recalcula zoneamento_id para todos os pontos DO TENANT.
 */
router.post("/associar-zoneamentos", async (req, res) => {
    const tenantId = req.tenantId;

    try {
        const pontosResult = await pool.query(
            `
      SELECT 
        id,
        ST_Y(localizacao::geometry) AS lat,
        ST_X(localizacao::geometry) AS lng
      FROM pontos_parada
      WHERE tenant_id = $1
        AND localizacao IS NOT NULL;
      `,
            [tenantId]
        );

        const pontosRows = pontosResult.rows;
        let atualizados = 0;
        let semZoneamento = 0;

        await pool.query("BEGIN");
        try {
            for (const p of pontosRows) {
                const { id, lat, lng } = p;
                if (lat == null || lng == null) {
                    semZoneamento++;
                    continue;
                }

                const z = await encontrarZoneamentoParaPonto(lat, lng, tenantId);
                if (!z) {
                    semZoneamento++;
                    continue;
                }

                // Atualiza zoneamento_id no ponto de parada (garantindo tenant)
                await pool.query(
                    `
          UPDATE pontos_parada
          SET zoneamento_id = $1,
              atualizado_em = NOW()
          WHERE id = $2
            AND tenant_id = $3;
          `,
                    [z.id, id, tenantId]
                );

                // Limpa associações anteriores deste ponto (sem depender de tenant_id na tabela pivô)
                await pool.query(
                    `
          DELETE FROM pontos_zoneamentos pz
          USING pontos_parada pp
          WHERE pz.ponto_id = pp.id
            AND pp.id = $1
            AND pp.tenant_id = $2;
          `,
                    [id, tenantId]
                );

                // Insere nova associação
                await pool.query(
                    `
          INSERT INTO pontos_zoneamentos (
            ponto_id,
            zoneamento_id,
            tipo_relacao,
            distancia_m,
            tenant_id
          ) VALUES ($1, $2, $3, $4, $5);
          `,
                    [
                        id,
                        z.id,
                        z.tipo_relacao || "indefinido",
                        typeof z.distancia_m === "number" ? z.distancia_m : 0,
                        tenantId
                    ]
                );

                atualizados++;
            }

            await pool.query("COMMIT");
            return res.json({
                message: "Associações de zoneamentos atualizadas",
                total: pontosRows.length,
                atualizados,
                semZoneamento
            });
        } catch (err) {
            await pool.query("ROLLBACK");
            throw err;
        }
    } catch (err) {
        console.error("Erro ao associar pontos aos zoneamentos:", err);
        return res.status(500).json({ error: "Erro ao associar pontos aos zoneamentos" });
    }
});


/**
 * PLANEJAMENTO DE PONTOS — GET /api/pontos-parada/planejamento-alunos
 * Retorna alunos geolocalizados para apoiar o planejamento de novos pontos.
 * Query params:
 * - escola_id: int (opcional)
 * - so_com_localizacao: por padrão true
 */
router.get("/planejamento-alunos", async (req, res) => {
    const tenantId = req.tenantId;

    try {
        const escolaIdRaw = Number.parseInt(String(req.query.escola_id || ""), 10);
        const escolaId = Number.isInteger(escolaIdRaw) && escolaIdRaw > 0 ? escolaIdRaw : null;
        const soComLocalizacao = String(req.query.so_com_localizacao || "true").trim().toLowerCase();

        const where = ["a.tenant_id = $1"];
        const params = [tenantId];
        let idx = 2;

        if (soComLocalizacao !== "0" && soComLocalizacao !== "false") {
            where.push("a.localizacao IS NOT NULL");
        }

        if (escolaId) {
            where.push(`ae.escola_id = $${idx}`);
            params.push(escolaId);
            idx += 1;
        }

        const sql = `
          SELECT
            a.id,
            a.pessoa_nome,
            a.unidade_ensino,
            a.turno_simplificado,
            a.deficiencia,
            e.id AS escola_id,
            e.nome AS escola_nome,
            ST_Y(a.localizacao::geometry) AS latitude,
            ST_X(a.localizacao::geometry) AS longitude,
            ST_AsGeoJSON(a.localizacao)::json AS localizacao_geojson
          FROM alunos_municipais a
          LEFT JOIN alunos_escolas ae
            ON ae.aluno_id = a.id
           AND ae.tenant_id = a.tenant_id
          LEFT JOIN escolas e
            ON e.id = ae.escola_id
           AND e.tenant_id = a.tenant_id
          WHERE ${where.join(" AND ")}
          ORDER BY e.nome ASC NULLS LAST, a.pessoa_nome ASC, a.id ASC;
        `;

        const result = await pool.query(sql, params);
        const rows = result.rows || [];

        return res.json({
            total: rows.length,
            escola_id: escolaId,
            data: rows
        });
    } catch (err) {
        console.error("Erro ao listar alunos para planejamento de pontos:", err);
        return res.status(500).json({ error: "Erro ao listar alunos para planejamento de pontos." });
    }
});


/**
 * ASSOCIAR ALUNOS FILTRADOS POR ESCOLA AO PONTO MAIS PRÓXIMO
 * POST /api/pontos-parada/associar-alunos-ponto-proximo
 * Body:
 * - escola_id: int (obrigatório)
 *
 * Regras:
 * - associa somente alunos da escola informada
 * - considera apenas alunos com localização
 * - considera apenas pontos com localização do mesmo tenant
 * - substitui associações anteriores desses alunos
 */
router.post("/associar-alunos-ponto-proximo", async (req, res) => {
    const tenantId = req.tenantId;

    const escolaIdRaw = Number.parseInt(String((req.body && req.body.escola_id) || ""), 10);
    const escolaId = Number.isInteger(escolaIdRaw) && escolaIdRaw > 0 ? escolaIdRaw : null;

    if (!escolaId) {
        return res.status(400).json({ error: "Informe uma escola válida para associar os alunos ao ponto de parada mais próximo." });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        const escolaRes = await client.query(
            `SELECT id, nome
               FROM escolas
              WHERE id = $1
                AND tenant_id = $2
              LIMIT 1`,
            [escolaId, tenantId]
        );

        if (!escolaRes.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Escola não encontrada." });
        }

        const pontosRes = await client.query(
            `SELECT COUNT(*)::int AS total
               FROM pontos_parada
              WHERE tenant_id = $1
                AND localizacao IS NOT NULL
                AND COALESCE(LOWER(status), 'ativo') <> 'inativo'`,
            [tenantId]
        );
        const totalPontos = Number((pontosRes.rows[0] && pontosRes.rows[0].total) || 0);

        if (!totalPontos) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Não há pontos de parada ativos com localização cadastrada para fazer a associação automática." });
        }

        const alunosRes = await client.query(
            `SELECT DISTINCT a.id, a.pessoa_nome
               FROM alunos_municipais a
               JOIN alunos_escolas ae
                 ON ae.aluno_id = a.id
                AND ae.tenant_id = a.tenant_id
              WHERE a.tenant_id = $1
                AND ae.escola_id = $2
                AND a.localizacao IS NOT NULL
              ORDER BY a.pessoa_nome ASC, a.id ASC`,
            [tenantId, escolaId]
        );

        const totalAlunos = alunosRes.rowCount || 0;
        if (!totalAlunos) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Não há alunos com localização cadastrada para a escola selecionada." });
        }

        const paresRes = await client.query(
            `WITH alunos_filtrados AS (
                SELECT DISTINCT ON (a.id)
                       a.id AS aluno_id,
                       a.localizacao
                  FROM alunos_municipais a
                  JOIN alunos_escolas ae
                    ON ae.aluno_id = a.id
                   AND ae.tenant_id = a.tenant_id
                 WHERE a.tenant_id = $1
                   AND ae.escola_id = $2
                   AND a.localizacao IS NOT NULL
                 ORDER BY a.id
            )
            SELECT
                af.aluno_id,
                pp.id AS ponto_id,
                ROUND(ST_Distance(af.localizacao::geography, pp.localizacao::geography))::int AS distancia_m
            FROM alunos_filtrados af
            JOIN LATERAL (
                SELECT p.id, p.localizacao
                  FROM pontos_parada p
                 WHERE p.tenant_id = $1
                   AND p.localizacao IS NOT NULL
                   AND COALESCE(LOWER(p.status), 'ativo') <> 'inativo'
                 ORDER BY af.localizacao <-> p.localizacao
                 LIMIT 1
            ) pp ON TRUE
            ORDER BY af.aluno_id ASC`,
            [tenantId, escolaId]
        );

        const pares = paresRes.rows || [];
        if (!pares.length) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Não foi possível localizar um ponto de parada próximo para os alunos filtrados." });
        }

        const alunoIds = pares.map((row) => Number(row.aluno_id)).filter((n) => Number.isInteger(n) && n > 0);

        await client.query(
            `DELETE FROM alunos_pontos
              WHERE tenant_id = $1
                AND aluno_id = ANY($2::int[])`,
            [tenantId, alunoIds]
        );

        for (const row of pares) {
            await client.query(
                `INSERT INTO alunos_pontos (aluno_id, ponto_id, tenant_id, associado_em)
                 VALUES ($1, $2, $3, now())`,
                [Number(row.aluno_id), Number(row.ponto_id), tenantId]
            );
        }

        await client.query("COMMIT");

        return res.json({
            ok: true,
            escola_id: escolaId,
            escola_nome: escolaRes.rows[0].nome,
            total_alunos: totalAlunos,
            associados: pares.length,
            total_pontos_considerados: totalPontos,
            data: pares.slice(0, 50)
        });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro ao associar alunos filtrados ao ponto mais próximo:", err);
        return res.status(500).json({ error: "Erro ao associar os alunos filtrados ao ponto de parada mais próximo." });
    } finally {
        client.release();
    }
});

/** OBTER POR ID — GET /api/pontos-parada/:id */
router.get("/:id", async (req, res) => {
    const tenantId = req.tenantId;

    try {
        const schema = await getPontosParadaSchema();
        const { id } = req.params;
        const joinTenantClause = schema.zoneamentosTenant && schema.pontosTenant
            ? 'AND z.tenant_id = p.tenant_id'
            : '';
        const sql = `
      SELECT 
        p.id,
        p.area,
        p.logradouro,
        p.numero,
        p.complemento,
        p.referencia,
        p.bairro,
        p.cep,
        p.zoneamento_id,
        z.nome AS zoneamento_nome,
        z.tipo_zona AS zoneamento_tipo_zona,
        p.status,
        p.criado_em,
        p.atualizado_em,
        ST_Y(p.localizacao::geometry) AS latitude,
        ST_X(p.localizacao::geometry) AS longitude,
        ST_AsGeoJSON(p.localizacao)::json AS localizacao_geojson
      FROM pontos_parada p
      LEFT JOIN zoneamentos z 
        ON z.id = p.zoneamento_id
       ${joinTenantClause}
      WHERE p.id = $1
        AND p.tenant_id = $2
      LIMIT 1;
    `;

        const result = await pool.query(sql, [id, tenantId]);
        if (!result.rows.length) return res.status(404).json({ error: "Ponto de parada não encontrado" });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error("Erro ao buscar ponto de parada:", err);
        return res.status(500).json({ error: "Erro ao buscar ponto de parada" });
    }
});

/** CRIAR — POST /api/pontos-parada */
router.post("/", async (req, res) => {
    const tenantId = req.tenantId;

    try {
        const schema = await getPontosParadaSchema();
        const {
            area,
            logradouro,
            numero,
            complemento,
            referencia,
            bairro,
            cep,
            localizacao,
            zoneamento_id,
            status
        } = req.body;

        if (!logradouro || !numero || !bairro || !cep) {
            return res.status(400).json({ error: "Campos obrigatórios: logradouro, número, bairro e cep." });
        }

        if (!localizacao || !localizacao.coordinates) {
            return res.status(400).json({ error: "Localização (Point) é obrigatória." });
        }

        const [lng, lat] = localizacao.coordinates;
        if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
            return res.status(400).json({ error: "Coordenadas de localização inválidas." });
        }

        let zonaId = zoneamento_id || null;
        let zonaTipo = null;
        let relacao = null;
        let distancia_m = 0;

        // Se não veio zoneamento_id, tenta achar automaticamente (no tenant)
        if (!zonaId) {
            const z = await encontrarZoneamentoParaPonto(lat, lng, tenantId);
            if (z) {
                zonaId = z.id;
                zonaTipo = z.tipo_zona;
                relacao = z.tipo_relacao || null;
                distancia_m = typeof z.distancia_m === "number" ? z.distancia_m : 0;
            }
        } else {
            // Se veio zoneamento_id, valida se ele pertence ao tenant
            const zoneamentoWhere = schema.zoneamentosTenant
                ? 'WHERE id = $1 AND tenant_id = $2'
                : 'WHERE id = $1';
            const zoneamentoParams = schema.zoneamentosTenant ? [zonaId, tenantId] : [zonaId];
            const zCheck = await pool.query(
                `SELECT id, tipo_zona FROM zoneamentos ${zoneamentoWhere} LIMIT 1;`,
                zoneamentoParams
            );
            if (!zCheck.rows.length) {
                return res.status(400).json({ error: "zoneamento_id inválido para este tenant." });
            }
            zonaTipo = zCheck.rows[0].tipo_zona;
        }

        // Se área não veio, tenta herdar do tipo_zona do zoneamento
        let areaFinal = area || null;
        if (!areaFinal && zonaTipo) {
            if (zonaTipo === "rural") areaFinal = "rural";
            if (zonaTipo === "urbana") areaFinal = "urbana";
        }

        const statusFinal = status || "ativo";

        const sql = `
      INSERT INTO pontos_parada (
        area,
        logradouro,
        numero,
        complemento,
        referencia,
        bairro,
        cep,
        localizacao,
        zoneamento_id,
        status,
        tenant_id
      ) VALUES (
        $1, $2, $3, $4, $5,
        $6, $7, ${buildPointFromLatLng(lat, lng)}, $8, $9, $10
      )
      RETURNING id;
    `;

        const result = await pool.query(sql, [
            areaFinal,
            logradouro,
            numero,
            complemento || null,
            referencia || null,
            bairro,
            cep,
            zonaId,
            statusFinal,
            tenantId
        ]);

        const novoId = result.rows[0].id;
        const joinTenantClause = schema.zoneamentosTenant && schema.pontosTenant
            ? 'AND z.tenant_id = p.tenant_id'
            : '';

        // Se encontrou zoneamento, grava também na tabela de associação
        if (zonaId) {
            await pool.query(
                `
        INSERT INTO pontos_zoneamentos (
          ponto_id,
          zoneamento_id,
          tipo_relacao,
          distancia_m,
          tenant_id
        ) VALUES ($1, $2, $3, $4, $5);
        `,
                [novoId, zonaId, relacao || "indefinido", distancia_m, tenantId]
            );
        }

        // Busca novamente para devolver no mesmo formato do GET
        const sqlBusca = `
      SELECT 
        p.id,
        p.area,
        p.logradouro,
        p.numero,
        p.complemento,
        p.referencia,
        p.bairro,
        p.cep,
        p.zoneamento_id,
        z.nome AS zoneamento_nome,
        z.tipo_zona AS zoneamento_tipo_zona,
        p.status,
        p.criado_em,
        p.atualizado_em,
        ST_Y(p.localizacao::geometry) AS latitude,
        ST_X(p.localizacao::geometry) AS longitude,
        ST_AsGeoJSON(p.localizacao)::json AS localizacao_geojson
      FROM pontos_parada p
      LEFT JOIN zoneamentos z 
        ON z.id = p.zoneamento_id
       ${joinTenantClause}
      WHERE p.id = $1
        AND p.tenant_id = $2
      LIMIT 1;
    `;

        const pontoCriado = await pool.query(sqlBusca, [novoId, tenantId]);
        return res.status(201).json(pontoCriado.rows[0]);
    } catch (err) {
        console.error("Erro ao criar ponto de parada:", err);
        return res.status(500).json({ error: "Erro ao criar ponto de parada" });
    }
});

/** ATUALIZAR — PUT /api/pontos-parada/:id */
router.put("/:id", async (req, res) => {
    const tenantId = req.tenantId;

    try {
        const schema = await getPontosParadaSchema();
        const { id } = req.params;
        const {
            area,
            logradouro,
            numero,
            complemento,
            referencia,
            bairro,
            cep,
            localizacao,
            zoneamento_id,
            status
        } = req.body;

        if (!logradouro || !numero || !bairro || !cep) {
            return res.status(400).json({ error: "Campos obrigatórios: logradouro, número, bairro e cep." });
        }

        if (!localizacao || !localizacao.coordinates) {
            return res.status(400).json({ error: "Localização (Point) é obrigatória." });
        }

        const [lng, lat] = localizacao.coordinates;
        if (typeof lat !== "number" || typeof lng !== "number" || Number.isNaN(lat) || Number.isNaN(lng)) {
            return res.status(400).json({ error: "Coordenadas de localização inválidas." });
        }

        let zonaId = zoneamento_id || null;
        let zonaTipo = null;
        let relacao = null;
        let distancia_m = 0;

        if (!zonaId) {
            const z = await encontrarZoneamentoParaPonto(lat, lng, tenantId);
            if (z) {
                zonaId = z.id;
                zonaTipo = z.tipo_zona;
                relacao = z.tipo_relacao || null;
                distancia_m = typeof z.distancia_m === "number" ? z.distancia_m : 0;
            }
        } else {
            const zoneamentoWhere = schema.zoneamentosTenant
                ? 'WHERE id = $1 AND tenant_id = $2'
                : 'WHERE id = $1';
            const zoneamentoParams = schema.zoneamentosTenant ? [zonaId, tenantId] : [zonaId];
            const zCheck = await pool.query(
                `SELECT id, tipo_zona FROM zoneamentos ${zoneamentoWhere} LIMIT 1;`,
                zoneamentoParams
            );
            if (!zCheck.rows.length) {
                return res.status(400).json({ error: "zoneamento_id inválido para este tenant." });
            }
            zonaTipo = zCheck.rows[0].tipo_zona;
        }

        let areaFinal = area || null;
        if (!areaFinal && zonaTipo) {
            if (zonaTipo === "rural") areaFinal = "rural";
            if (zonaTipo === "urbana") areaFinal = "urbana";
        }

        const statusFinal = status || "ativo";

        const sql = `
      UPDATE pontos_parada SET
        area = $1,
        logradouro = $2,
        numero = $3,
        complemento = $4,
        referencia = $5,
        bairro = $6,
        cep = $7,
        localizacao = ${buildPointFromLatLng(lat, lng)},
        zoneamento_id = $8,
        status = $9,
        atualizado_em = NOW()
      WHERE id = $10
        AND tenant_id = $11;
    `;

        const upd = await pool.query(sql, [
            areaFinal,
            logradouro,
            numero,
            complemento || null,
            referencia || null,
            bairro,
            cep,
            zonaId,
            statusFinal,
            id,
            tenantId
        ]);

        if (upd.rowCount === 0) {
            return res.status(404).json({ error: "Ponto de parada não encontrado" });
        }

        // Atualiza associação de ponto-zoneamento, se houver zoneamento
        if (zonaId) {
            await pool.query(
                `
        DELETE FROM pontos_zoneamentos pz
        USING pontos_parada pp
        WHERE pz.ponto_id = pp.id
          AND pp.id = $1
          AND pp.tenant_id = $2;
        `,
                [id, tenantId]
            );

            await pool.query(
                `
        INSERT INTO pontos_zoneamentos (
          ponto_id,
          zoneamento_id,
          tipo_relacao,
          distancia_m,
          tenant_id
        ) VALUES ($1, $2, $3, $4, $5);
        `,
                [id, zonaId, relacao || "indefinido", distancia_m, tenantId]
            );
        } else {
            await pool.query(
                `
        DELETE FROM pontos_zoneamentos pz
        USING pontos_parada pp
        WHERE pz.ponto_id = pp.id
          AND pp.id = $1
          AND pp.tenant_id = $2;
        `,
                [id, tenantId]
            );
        }

        return res.json({ message: "Ponto de parada atualizado com sucesso" });
    } catch (err) {
        console.error("Erro ao atualizar ponto de parada:", err);
        return res.status(500).json({ error: "Erro ao atualizar ponto de parada" });
    }
});

/** EXCLUIR — DELETE /api/pontos-parada/:id */
router.delete("/:id", async (req, res) => {
    const tenantId = req.tenantId;

    try {
        const { id } = req.params;

        // Remove pivô com segurança (sem depender de tenant_id na pivô)
        await pool.query(
            `
      DELETE FROM pontos_zoneamentos pz
      USING pontos_parada pp
      WHERE pz.ponto_id = pp.id
        AND pp.id = $1
        AND pp.tenant_id = $2;
      `,
            [id, tenantId]
        );

        const del = await pool.query(
            `DELETE FROM pontos_parada WHERE id = $1 AND tenant_id = $2;`,
            [id, tenantId]
        );

        if (del.rowCount === 0) {
            return res.status(404).json({ error: "Ponto de parada não encontrado" });
        }

        return res.json({ message: "Ponto de parada excluído com sucesso" });
    } catch (err) {
        console.error("Erro ao excluir ponto de parada:", err);
        return res.status(500).json({ error: "Erro ao excluir ponto de parada" });
    }
});

export default router;
