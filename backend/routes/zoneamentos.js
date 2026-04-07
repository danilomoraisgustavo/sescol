// routes/zoneamentos.js
import express from 'express';
import multer from 'multer';
import pool from '../db.js';

// IMPORTANTE: segurança multi-tenant
// - tenantId vem do JWT validado (middleware tenant)
// - todas as queries filtram por tenant_id
import authMiddleware from '../middleware/auth.js';
import tenantMiddleware from '../middleware/tenant.js';

const router = express.Router();

// Protege TODAS as rotas deste módulo
router.use(authMiddleware);
router.use(tenantMiddleware);

function resolveTenantId(req) {
    const fromMiddleware = req.tenantId;
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

// Upload em memória (GeoJSON do território municipal)
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 20 * 1024 * 1024 }, // 20 MB
});

/**
 * Helper: insere ou atualiza um zoneamento (polígono/linha genérico)
 * Sempre aplica tenant_id.
 */
async function insertOrUpdateZoneamento({ tenantId, id = null, nome, tipo_zona, tipo_geometria, geojson }) {
    if (!tenantId) throw new Error('tenantId é obrigatório.');
    if (!geojson) throw new Error('GeoJSON da geometria é obrigatório.');

    const geomJson = JSON.stringify(geojson);

    // FIX: em alguns bancos (principalmente após inserts manuais/importações), a sequence do campo "id"
    // pode ficar "atrasada" e o Postgres tenta reutilizar um id já existente, gerando erro 23505.
    // Aqui fazemos um resync e tentamos novamente UMA vez quando isso acontecer.
    async function ensureZoneamentosIdSequence() {
        try {
            const { rows } = await pool.query("SELECT pg_get_serial_sequence('zoneamentos','id') AS seq");
            const seq = rows?.[0]?.seq;
            if (!seq) return;

            const { rows: r2 } = await pool.query('SELECT COALESCE(MAX(id), 0) AS max_id FROM zoneamentos');
            const maxId = Number(r2?.[0]?.max_id ?? 0);

            // setval(seq, maxId, true) => nextval() retorna maxId+1
            await pool.query('SELECT setval($1, $2, true)', [seq, maxId]);
        } catch (e) {
            // Não falha a operação por causa do resync; apenas deixa seguir.
            console.warn('Aviso: não foi possível resincronizar a sequence de zoneamentos:', e?.message || e);
        }
    }

    if (id === null) {
        const insertQuery = `
      INSERT INTO zoneamentos (tenant_id, nome, tipo_zona, tipo_geometria, geom)
      VALUES ($1, $2, $3, $4, ST_SetSRID(ST_GeomFromGeoJSON($5), 4326))
      RETURNING id, nome, tipo_zona, tipo_geometria,
                ST_AsGeoJSON(geom) AS geom,
                created_at, updated_at;
    `;

        try {
            const { rows } = await pool.query(insertQuery, [tenantId, nome, tipo_zona, tipo_geometria, geomJson]);
            return rows[0];
        } catch (err) {
            // 23505 = unique_violation
            if (err?.code === '23505' && String(err?.constraint || '') === 'zoneamentos_pkey') {
                await ensureZoneamentosIdSequence();
                const { rows } = await pool.query(insertQuery, [tenantId, nome, tipo_zona, tipo_geometria, geomJson]);
                return rows[0];
            }
            throw err;
        }
    }

    const updateQuery = `
    UPDATE zoneamentos
    SET nome = $1,
        tipo_zona = $2,
        tipo_geometria = $3,
        geom = ST_SetSRID(ST_GeomFromGeoJSON($4), 4326),
        updated_at = NOW()
    WHERE id = $5 AND tenant_id = $6
    RETURNING id, nome, tipo_zona, tipo_geometria,
              ST_AsGeoJSON(geom) AS geom,
              created_at, updated_at;
  `;
    const { rows } = await pool.query(updateQuery, [nome, tipo_zona, tipo_geometria, geomJson, id, tenantId]);
    return rows[0];
}

/**
 * Helper: extrai uma geometria válida (Polygon/MultiPolygon/etc)
 * de qualquer estrutura GeoJSON (FeatureCollection, Feature ou Geometry)
 */
function extractGeometryFromAny(json) {
    if (!json || typeof json !== 'object') throw new Error('GeoJSON vazio ou inválido.');

    // FeatureCollection
    if (json.type === 'FeatureCollection') {
        if (!Array.isArray(json.features) || json.features.length === 0) {
            throw new Error('FeatureCollection sem features.');
        }

        const geoms = json.features.map((f) => f && f.geometry).filter((g) => !!g);
        if (!geoms.length) throw new Error('Nenhuma geometria encontrada nas features.');

        // Caso simples: só uma geometria
        if (geoms.length === 1) return geoms[0];

        // Se todas forem Polygon/MultiPolygon, montamos um MultiPolygon único
        const allPolys = geoms.every((g) => g.type === 'Polygon' || g.type === 'MultiPolygon');
        if (allPolys) {
            const multiCoords = [];
            geoms.forEach((g) => {
                if (g.type === 'Polygon') multiCoords.push(g.coordinates);
                else if (g.type === 'MultiPolygon') multiCoords.push(...g.coordinates);
            });

            return { type: 'MultiPolygon', coordinates: multiCoords };
        }

        // Caso genérico: cria GeometryCollection (não ideal para Leaflet draw; mas mantém compatível)
        return { type: 'GeometryCollection', geometries: geoms };
    }

    // Feature
    if (json.type === 'Feature') {
        if (!json.geometry) throw new Error('Feature sem geometry.');
        return json.geometry;
    }

    // Geometry
    if (json.type && json.coordinates) return json;

    throw new Error('Estrutura GeoJSON não reconhecida.');
}

/**
 * ================== TERRITÓRIO MUNICIPAL ==================
 *
 * Endpoints usados pelo frontend:
 *  - POST /api/zoneamentos/territorio/upload   (campo form-data "arquivo", body "nome")
 *  - GET  /api/zoneamentos/territorio/geo      (retorna Feature GeoJSON)
 *
 * Multi-tenant correto:
 *  - A tabela territorios_municipios deve ter tenant_id e UNIQUE(tenant_id)
 *
 * IMPORTANTE (FIX):
 *  - Essas rotas precisam vir ANTES das rotas "/:id" OU "/:id" deve ser restrita a numérico,
 *    senão "/territorio/geo" é capturado como id="territorio".
 *  - Aqui aplicamos a restrição numérica em "/:id(\\d+)".
 */

/**
 * POST /api/zoneamentos/territorio/upload
 * Upload de arquivo GeoJSON com o limite territorial do município.
 * Aceita FeatureCollection, Feature ou Geometry.
 * Campo do form: arquivo
 */
router.post('/territorio/upload', upload.single('arquivo'), async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ error: 'tenant_id não resolvido' });

    if (!req.file) {
        return res.status(400).json({
            error: "Arquivo GeoJSON é obrigatório (campo 'arquivo').",
        });
    }

    const nomeMunicipio = req.body.nome || 'Território municipal';

    try {
        const rawText = req.file.buffer.toString('utf8');

        let json;
        try {
            json = JSON.parse(rawText);
        } catch {
            return res.status(400).json({ error: 'Arquivo não é um JSON válido.' });
        }

        let geometry;
        try {
            geometry = extractGeometryFromAny(json);
        } catch (e) {
            console.error('Erro ao extrair geometria do GeoJSON:', e);
            return res.status(400).json({ error: 'GeoJSON inválido: ' + e.message });
        }

        if (!geometry || !geometry.type) {
            return res.status(400).json({ error: 'Não foi possível determinar a geometria do GeoJSON.' });
        }

        const geomJson = JSON.stringify(geometry);

        // Upsert por tenant_id (não vaza entre tenants)
        const sql = `
      INSERT INTO territorios_municipios (tenant_id, nome, geom)
      VALUES (
        $1,
        $2,
        ST_SetSRID(
          ST_Multi(ST_GeomFromGeoJSON($3)),
          4326
        )
      )
      ON CONFLICT (tenant_id) DO UPDATE
        SET nome = EXCLUDED.nome,
            geom = EXCLUDED.geom,
            updated_at = NOW()
      RETURNING
        id,
        tenant_id,
        nome,
        ST_AsGeoJSON(geom) AS geom,
        created_at,
        updated_at;
    `;

        const { rows } = await pool.query(sql, [tenantId, nomeMunicipio, geomJson]);

        return res.json({ success: true, territorio: rows[0] });
    } catch (err) {
        console.error('Erro ao salvar território municipal:', err);
        return res.status(500).json({ error: 'Erro ao salvar território municipal.' });
    }
});

/**
 * GET /api/zoneamentos/territorio/geo
 * Retorna um Feature GeoJSON, pronto para L.geoJSON(...)
 */
router.get('/territorio/geo', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ error: 'tenant_id não resolvido' });

    try {
        const sql = `
      SELECT
        id,
        tenant_id,
        nome,
        ST_AsGeoJSON(geom) AS geom,
        created_at,
        updated_at
      FROM territorios_municipios
      WHERE tenant_id = $1
      LIMIT 1;
    `;
        const { rows } = await pool.query(sql, [tenantId]);

        if (!rows.length) return res.status(404).json({ error: 'Território municipal não cadastrado.' });

        const row = rows[0];
        const feature = {
            type: 'Feature',
            properties: { id: row.id, nome: row.nome },
            geometry: JSON.parse(row.geom),
        };

        res.json(feature);
    } catch (err) {
        console.error('Erro ao carregar território municipal:', err);
        res.status(500).json({ error: 'Erro ao carregar território municipal.' });
    }
});

/**
 * GET /api/zoneamentos
 * Lista zoneamentos do tenant
 */
router.get('/', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ error: 'tenant_id não resolvido' });

    try {
        const sql = `
      SELECT
        id,
        nome,
        tipo_zona,
        tipo_geometria,
        ST_AsGeoJSON(geom) AS geom,
        created_at,
        updated_at
      FROM zoneamentos
      WHERE tenant_id = $1
      ORDER BY id DESC;
    `;
        const { rows } = await pool.query(sql, [tenantId]);
        res.json(rows);
    } catch (err) {
        console.error('Erro ao listar zoneamentos:', err);
        res.status(500).json({ error: 'Erro ao listar zoneamentos.' });
    }
});

/**
 * GET /api/zoneamentos/:id
 * Busca um zoneamento pelo id (do tenant)
 *
 * FIX: restringe o param para SOMENTE NUMÉRICO, evitando conflito com "/territorio/geo"
 */
router.get('/:id(\\d+)', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ error: 'tenant_id não resolvido' });

    const { id } = req.params;

    try {
        const sql = `
      SELECT
        id,
        nome,
        tipo_zona,
        tipo_geometria,
        ST_AsGeoJSON(geom) AS geom,
        created_at,
        updated_at
      FROM zoneamentos
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1;
    `;
        const { rows } = await pool.query(sql, [tenantId, id]);

        if (rows.length === 0) return res.status(404).json({ error: 'Zoneamento não encontrado.' });
        res.json(rows[0]);
    } catch (err) {
        console.error('Erro ao buscar zoneamento:', err);
        res.status(500).json({ error: 'Erro ao buscar zoneamento.' });
    }
});

/**
 * POST /api/zoneamentos
 * Cria um zoneamento (polígono/linha genérico)
 */
router.post('/', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ error: 'tenant_id não resolvido' });

    try {
        const { nome, tipo_zona, tipo_geometria, geom } = req.body;

        if (!nome || !tipo_zona || !tipo_geometria || !geom) {
            return res.status(400).json({
                error: 'Campos obrigatórios: nome, tipo_zona, tipo_geometria, geom (GeoJSON).',
            });
        }

        const novo = await insertOrUpdateZoneamento({
            tenantId,
            nome,
            tipo_zona,
            tipo_geometria,
            geojson: geom,
        });

        res.status(201).json(novo);
    } catch (err) {
        console.error('Erro ao criar zoneamento:', err);
        res.status(500).json({ error: 'Erro ao criar zoneamento.' });
    }
});

/**
 * PUT /api/zoneamentos/:id
 * Atualiza um zoneamento do tenant
 *
 * FIX: restringe o param para SOMENTE NUMÉRICO, evitando conflito com "/territorio/geo"
 */
router.put('/:id(\\d+)', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ error: 'tenant_id não resolvido' });

    const { id } = req.params;

    try {
        const { nome, tipo_zona, tipo_geometria, geom } = req.body;

        if (!nome || !tipo_zona || !tipo_geometria || !geom) {
            return res.status(400).json({
                error: 'Campos obrigatórios: nome, tipo_zona, tipo_geometria, geom (GeoJSON).',
            });
        }

        const { rows: existing } = await pool.query(
            'SELECT id FROM zoneamentos WHERE tenant_id = $1 AND id = $2',
            [tenantId, id],
        );

        if (existing.length === 0) return res.status(404).json({ error: 'Zoneamento não encontrado.' });

        const atualizado = await insertOrUpdateZoneamento({
            tenantId,
            id,
            nome,
            tipo_zona,
            tipo_geometria,
            geojson: geom,
        });

        if (!atualizado) return res.status(404).json({ error: 'Zoneamento não encontrado.' });

        res.json(atualizado);
    } catch (err) {
        console.error('Erro ao atualizar zoneamento:', err);
        res.status(500).json({ error: 'Erro ao atualizar zoneamento.' });
    }
});

/**
 * DELETE /api/zoneamentos/:id
 * Exclui um zoneamento do tenant
 *
 * FIX: restringe o param para SOMENTE NUMÉRICO, evitando conflito com "/territorio/geo"
 */
router.delete('/:id(\\d+)', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ error: 'tenant_id não resolvido' });

    const { id } = req.params;

    try {
        const { rowCount } = await pool.query(
            'DELETE FROM zoneamentos WHERE tenant_id = $1 AND id = $2',
            [tenantId, id],
        );

        if (rowCount === 0) return res.status(404).json({ error: 'Zoneamento não encontrado.' });
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao excluir zoneamento:', err);
        res.status(500).json({ error: 'Erro ao excluir zoneamento.' });
    }
});

export default router;