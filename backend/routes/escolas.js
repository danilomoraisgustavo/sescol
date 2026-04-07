import express from "express";
import pool from "../db.js";

const router = express.Router();

function buildPoint(lat, lng) {
    return `ST_SetSRID(ST_Point(${lng}, ${lat}), 4326)`;
}

/**
 * Tenta resolver o tenant_id do request de forma compatível com diferentes middlewares.
 * - Preferência: req.user.tenant_id / req.user.tenantId
 * - Alternativas: req.tenant_id / req.tenantId
 * - Fallback: header x-tenant-id (string numérica)
 */
function getTenantId(req) {
    const candidates = [
        req?.user?.tenant_id,
        req?.user?.tenantId,
        req?.tenant_id,
        req?.tenantId,
        req?.headers?.["x-tenant-id"],
        req?.headers?.["X-Tenant-Id"],
        req?.headers?.["x-tenantid"],
        req?.headers?.["x-tenant"],
    ];

    for (const c of candidates) {
        if (c === undefined || c === null) continue;
        const n = typeof c === "string" ? Number(c) : Number(c);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
}

async function getTenantIdByEscolaId(client, escolaId) {
    const r = await client.query(`SELECT tenant_id FROM escolas WHERE id=$1 LIMIT 1`, [escolaId]);
    return r.rowCount ? Number(r.rows[0].tenant_id) : null;
}

router.get("/", async (req, res) => {
    try {
        const tenantId = getTenantId(req);

        const params = [];
        let whereTenant = "";
        if (tenantId) {
            params.push(tenantId);
            whereTenant = `WHERE e.tenant_id = $${params.length}`;
        }

        const sql = `
            SELECT 
                e.*,
                ST_AsGeoJSON(e.localizacao)::json AS localizacao,
                COALESCE(
                    (
                        SELECT json_agg(z.id)
                        FROM escola_zoneamento ez
                        JOIN zoneamentos z ON z.id = ez.zoneamento_id
                        WHERE ez.escola_id = e.id
                          ${tenantId ? "AND ez.tenant_id = e.tenant_id" : ""}
                    ), 
                '[]') AS zoneamento_ids
            FROM escolas e
            ${whereTenant}
            ORDER BY e.id ASC
        `;
        const result = await pool.query(sql, params);
        return res.json(result.rows);
    } catch (err) {
        console.error("Erro ao listar escolas:", err);
        return res.status(500).json({ error: "Erro ao listar escolas" });
    }
});

router.get("/zoneamentos", async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const { escolas } = req.query;

        if (!escolas) {
            return res.status(400).json({ error: 'Parâmetro "escolas" é obrigatório.' });
        }

        const ids = String(escolas)
            .split(",")
            .map((id) => parseInt(id, 10))
            .filter((n) => !isNaN(n));

        if (!ids.length) {
            return res.status(400).json({ error: 'Nenhum ID de escola válido informado em "escolas".' });
        }

        const params = [ids];
        let tenantClause = "";
        if (tenantId) {
            params.push(tenantId);
            tenantClause = `AND ez.tenant_id = $${params.length}`;
        }

        const sql = `
            SELECT DISTINCT z.*
            FROM zoneamentos z
            JOIN escola_zoneamento ez ON ez.zoneamento_id = z.id
            WHERE ez.escola_id = ANY($1)
            ${tenantClause}
            ORDER BY z.nome
        `;
        const result = await pool.query(sql, params);
        return res.json(result.rows);
    } catch (err) {
        console.error("Erro ao buscar zoneamentos por escolas:", err);
        return res.status(500).json({ error: "Erro ao buscar zoneamentos relacionados às escolas" });
    }
});

router.get("/geocode/reverse", async (req, res) => {
    try {
        const { lat, lng } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({ error: "Parâmetros lat e lng são obrigatórios." });
        }

        const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
        if (!GOOGLE_API_KEY) {
            console.error("GOOGLE_MAPS_API_KEY não configurada.");
            return res.status(500).json({ error: "Serviço de geocodificação não configurado." });
        }

        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=pt-BR&key=${GOOGLE_API_KEY}`;

        const resp = await fetch(url);
        if (!resp.ok) {
            return res.status(500).json({ error: "Falha ao consultar o serviço de geocodificação." });
        }

        const data = await resp.json();
        if (!data.results || !data.results.length) {
            return res.status(404).json({ error: "Nenhum endereço encontrado para estas coordenadas." });
        }

        const result = data.results[0];
        const components = result.address_components || [];

        const getComp = (type) =>
            components.find((c) => c.types && c.types.includes(type)) || {};

        const route = getComp("route").long_name || "";
        const streetNumber = getComp("street_number").long_name || "";
        const neighborhood =
            getComp("sublocality_level_1").long_name ||
            getComp("sublocality").long_name ||
            getComp("political").long_name ||
            "";
        const postalCode = getComp("postal_code").long_name || "";
        const city = getComp("administrative_area_level_2").long_name || "";
        const state = getComp("administrative_area_level_1").short_name || "";

        const endereco = {
            logradouro: route,
            numero: streetNumber,
            bairro: neighborhood,
            cep: postalCode,
            cidade: city,
            uf: state,
            referencia: result.formatted_address
        };

        return res.json(endereco);
    } catch (err) {
        console.error("Erro na geocodificação reversa:", err);
        return res.status(500).json({ error: "Erro interno ao processar a geocodificação." });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const idRaw = req.params.id;
        const id = parseInt(idRaw, 10);

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de escola inválido." });
        }

        const tenantId = getTenantId(req);

        const params = [id];
        const tenantWhere = tenantId ? `AND e.tenant_id = $2` : "";

        if (tenantId) params.push(tenantId);

        const sql = `
            SELECT 
                e.*,
                ST_AsGeoJSON(e.localizacao)::json AS localizacao_geojson,
                COALESCE(
                    (
                        SELECT json_agg(z.id)
                        FROM escola_zoneamento ez
                        JOIN zoneamentos z ON z.id = ez.zoneamento_id
                        WHERE ez.escola_id = e.id
                          ${tenantId ? "AND ez.tenant_id = e.tenant_id" : ""}
                    ),
                '[]') AS zoneamento_ids
            FROM escolas e
            WHERE e.id = $1
            ${tenantWhere}
            LIMIT 1
        `;
        const result = await pool.query(sql, params);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Escola não encontrada" });
        }

        return res.json(result.rows[0]);
    } catch (err) {
        console.error("Erro ao buscar escola:", err);
        return res.status(500).json({ error: "Erro ao buscar escola" });
    }
});

router.post("/", async (req, res) => {
    const client = await pool.connect();
    try {
        const tenantId = getTenantId(req);
        if (!tenantId) {
            return res.status(400).json({ error: "tenant_id não identificado (req.user/req.tenant_id ou header x-tenant-id)." });
        }

        const {
            nome,
            codigo_inep,
            logradouro,
            numero,
            complemento,
            referencia,
            bairro,
            cep,
            localizacao,
            ensino_regime,
            ensino_nivel,
            ensino_horario,
            zoneamento_ids
        } = req.body;

        if (!localizacao || !localizacao.coordinates) {
            return res.status(400).json({ error: "Localização obrigatória" });
        }

        const [lng, lat] = localizacao.coordinates;

        await client.query("BEGIN");

        const insertEscola = `
            INSERT INTO escolas (
                nome, codigo_inep, logradouro, numero, complemento, referencia,
                bairro, cep, localizacao, ensino_regime, ensino_nivel, ensino_horario, tenant_id
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, ${buildPoint(lat, lng)}, $9, $10, $11, $12
            )
            RETURNING id
        `;

        const result = await client.query(insertEscola, [
            nome,
            codigo_inep,
            logradouro,
            numero,
            complemento,
            referencia,
            bairro,
            cep,
            ensino_regime ?? [],
            ensino_nivel ?? [],
            ensino_horario ?? [],
            tenantId
        ]);

        const escolaId = result.rows[0].id;

        if (Array.isArray(zoneamento_ids)) {
            for (const zid of zoneamento_ids) {
                await client.query(
                    `INSERT INTO escola_zoneamento (escola_id, zoneamento_id, tenant_id)
                     VALUES ($1, $2, $3)`,
                    [escolaId, zid, tenantId]
                );
            }
        }

        await client.query("COMMIT");
        return res.json({ id: escolaId, message: "Escola criada com sucesso" });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro ao criar escola:", err);
        return res.status(500).json({ error: "Erro ao criar escola" });
    } finally {
        client.release();
    }
});

router.put("/:id", async (req, res) => {
    const client = await pool.connect();
    try {
        const idRaw = req.params.id;
        const id = parseInt(idRaw, 10);

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de escola inválido." });
        }

        let tenantId = getTenantId(req);

        // Fallback: se não vier tenant no request, tenta descobrir pelo próprio registro da escola.
        // Isso resolve o erro do escola_zoneamento sem exigir mudança no frontend, desde que a escola exista.
        if (!tenantId) {
            tenantId = await getTenantIdByEscolaId(client, id);
        }
        if (!tenantId) {
            return res.status(404).json({ error: "Escola não encontrada (tenant_id não resolvido)." });
        }

        const {
            nome,
            codigo_inep,
            logradouro,
            numero,
            complemento,
            referencia,
            bairro,
            cep,
            localizacao,
            ensino_regime,
            ensino_nivel,
            ensino_horario,
            zoneamento_ids
        } = req.body;

        if (!localizacao || !localizacao.coordinates) {
            return res.status(400).json({ error: "Localização obrigatória" });
        }

        const [lng, lat] = localizacao.coordinates;

        await client.query("BEGIN");

        const sql = `
            UPDATE escolas SET
                nome=$1,
                codigo_inep=$2,
                logradouro=$3,
                numero=$4,
                complemento=$5,
                referencia=$6,
                bairro=$7,
                cep=$8,
                localizacao=${buildPoint(lat, lng)},
                ensino_regime=$9,
                ensino_nivel=$10,
                ensino_horario=$11,
                atualizado_em=NOW()
            WHERE id=$12 AND tenant_id=$13
        `;

        const upd = await client.query(sql, [
            nome,
            codigo_inep,
            logradouro,
            numero,
            complemento,
            referencia,
            bairro,
            cep,
            ensino_regime ?? [],
            ensino_nivel ?? [],
            ensino_horario ?? [],
            id,
            tenantId
        ]);

        if (upd.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Escola não encontrada" });
        }

        await client.query(`DELETE FROM escola_zoneamento WHERE escola_id=$1 AND tenant_id=$2`, [id, tenantId]);

        if (Array.isArray(zoneamento_ids)) {
            for (const zid of zoneamento_ids) {
                await client.query(
                    `INSERT INTO escola_zoneamento (escola_id, zoneamento_id, tenant_id)
                     VALUES ($1, $2, $3)`,
                    [id, zid, tenantId]
                );
            }
        }

        await client.query("COMMIT");
        return res.json({ message: "Escola atualizada com sucesso" });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro ao atualizar escola:", err);
        return res.status(500).json({ error: "Erro ao atualizar escola" });
    } finally {
        client.release();
    }
});

router.delete("/:id", async (req, res) => {
    const client = await pool.connect();
    try {
        const idRaw = req.params.id;
        const id = parseInt(idRaw, 10);

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de escola inválido." });
        }

        let tenantId = getTenantId(req);
        if (!tenantId) tenantId = await getTenantIdByEscolaId(client, id);
        if (!tenantId) {
            return res.status(404).json({ error: "Escola não encontrada" });
        }

        await client.query("BEGIN");

        await client.query(`DELETE FROM escola_zoneamento WHERE escola_id=$1 AND tenant_id=$2`, [id, tenantId]);
        await client.query(`DELETE FROM escolas WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);

        await client.query("COMMIT");
        return res.json({ message: "Escola excluída com sucesso" });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro ao excluir escola:", err);
        return res.status(500).json({ error: "Erro ao excluir escola" });
    } finally {
        client.release();
    }
});

export default router;
