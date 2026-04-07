// routes/fornecedores.js
import express from 'express';
import pool from '../db.js';

// IMPORTANTE: segurança multi-tenant
import authMiddleware from '../middleware/auth.js';
import tenantMiddleware from '../middleware/tenant.js';

const router = express.Router();

// Protege TODAS as rotas deste módulo
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

// Helper: converter linha do banco -> objeto esperado pelo frontend
function mapFornecedorRow(row) {
    return {
        id: row.id,
        razao_social: row.razao_social,
        nome_fantasia: row.nome_fantasia,
        cnpj: row.cnpj,
        telefone: row.telefone,
        email: row.email,
        responsavel: row.responsavel,
        status: row.status,
        inscricao_municipal: row.inscricao_municipal,

        logradouro_garagem: row.logradouro_garagem,
        numero_garagem: row.numero_garagem,
        complemento_garagem: row.complemento_garagem,
        bairro_garagem: row.bairro_garagem,
        cidade_garagem: row.cidade_garagem,
        cep_garagem: row.cep_garagem,
        referencia_garagem: row.referencia_garagem,

        // GeoJSON
        garagem_localizacao: row.garagem_localizacao ? row.garagem_localizacao : null,
    };
}

// GET /api/fornecedores (lista do tenant)
router.get('/', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ error: 'tenant_id não resolvido' });

    try {
        const result = await pool.query(
            `
      SELECT
        id,
        razao_social,
        nome_fantasia,
        cnpj,
        telefone,
        email,
        responsavel,
        status,
        inscricao_municipal,
        logradouro_garagem,
        numero_garagem,
        complemento_garagem,
        bairro_garagem,
        cidade_garagem,
        cep_garagem,
        referencia_garagem,
        ST_AsGeoJSON(garagem_localizacao)::jsonb AS garagem_localizacao
      FROM fornecedores
      WHERE tenant_id = $1
      ORDER BY razao_social ASC;
      `,
            [tenantId]
        );

        res.json(result.rows.map(mapFornecedorRow));
    } catch (err) {
        console.error('Erro ao listar fornecedores:', err);
        res.status(500).json({ error: 'Erro ao listar fornecedores.' });
    }
});

// GET /api/fornecedores/:id (buscar um do tenant)
router.get('/:id(\\d+)', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ error: 'tenant_id não resolvido' });

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

    try {
        const result = await pool.query(
            `
      SELECT
        id,
        razao_social,
        nome_fantasia,
        cnpj,
        telefone,
        email,
        responsavel,
        status,
        inscricao_municipal,
        logradouro_garagem,
        numero_garagem,
        complemento_garagem,
        bairro_garagem,
        cidade_garagem,
        cep_garagem,
        referencia_garagem,
        ST_AsGeoJSON(garagem_localizacao)::jsonb AS garagem_localizacao
      FROM fornecedores
      WHERE tenant_id = $1 AND id = $2
      LIMIT 1;
      `,
            [tenantId, id]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Fornecedor não encontrado.' });
        }

        res.json(mapFornecedorRow(result.rows[0]));
    } catch (err) {
        console.error('Erro ao buscar fornecedor:', err);
        res.status(500).json({ error: 'Erro ao buscar fornecedor.' });
    }
});

// POST /api/fornecedores (criar no tenant)
router.post('/', express.json({ limit: '2mb' }), async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ error: 'tenant_id não resolvido' });

    try {
        const {
            razao_social,
            nome_fantasia,
            cnpj,
            telefone,
            email,
            responsavel,
            status,
            inscricao_municipal,

            logradouro_garagem,
            numero_garagem,
            complemento_garagem,
            bairro_garagem,
            cidade_garagem,
            cep_garagem,
            referencia_garagem,

            garagem_localizacao,
        } = req.body || {};

        if (!razao_social || !cnpj) {
            return res.status(400).json({ error: 'Razão social e CNPJ são obrigatórios.' });
        }

        if (
            !garagem_localizacao ||
            garagem_localizacao.type !== 'Point' ||
            !Array.isArray(garagem_localizacao.coordinates)
        ) {
            return res.status(400).json({ error: 'garagem_localizacao deve ser um GeoJSON Point válido.' });
        }

        const [lng, lat] = garagem_localizacao.coordinates;
        if (
            typeof lat !== 'number' ||
            typeof lng !== 'number' ||
            Number.isNaN(lat) ||
            Number.isNaN(lng)
        ) {
            return res.status(400).json({ error: 'Coordenadas da garagem inválidas.' });
        }

        const result = await pool.query(
            `
      INSERT INTO fornecedores (
        tenant_id,
        razao_social,
        nome_fantasia,
        cnpj,
        telefone,
        email,
        responsavel,
        status,
        inscricao_municipal,
        logradouro_garagem,
        numero_garagem,
        complemento_garagem,
        bairro_garagem,
        cidade_garagem,
        cep_garagem,
        referencia_garagem,
        garagem_localizacao
      )
      VALUES (
        $1,
        $2, $3, $4, $5, $6, $7, COALESCE($8, 'ativo'), $9,
        $10, $11, $12, $13, $14, $15, $16,
        ST_SetSRID(ST_MakePoint($18, $17), 4326)
      )
      RETURNING
        id,
        razao_social,
        nome_fantasia,
        cnpj,
        telefone,
        email,
        responsavel,
        status,
        inscricao_municipal,
        logradouro_garagem,
        numero_garagem,
        complemento_garagem,
        bairro_garagem,
        cidade_garagem,
        cep_garagem,
        referencia_garagem,
        ST_AsGeoJSON(garagem_localizacao)::jsonb AS garagem_localizacao;
      `,
            [
                tenantId,                 // $1
                razao_social,             // $2
                nome_fantasia || null,    // $3
                cnpj,                     // $4
                telefone || null,         // $5
                email || null,            // $6
                responsavel || null,      // $7
                status || 'ativo',        // $8
                inscricao_municipal || null, // $9
                logradouro_garagem,       // $10
                numero_garagem,           // $11
                complemento_garagem || null, // $12
                bairro_garagem,           // $13
                cidade_garagem,           // $14
                cep_garagem,              // $15
                referencia_garagem || null, // $16
                lat,                      // $17
                lng                       // $18
            ]
        );

        res.status(201).json(mapFornecedorRow(result.rows[0]));
    } catch (err) {
        console.error('Erro ao criar fornecedor:', err);

        if (err.code === '23505') {
            // violação de unique (cnpj, por exemplo)
            return res.status(400).json({ error: 'Já existe um fornecedor com este CNPJ.' });
        }

        res.status(500).json({ error: 'Erro ao criar fornecedor.' });
    }
});

// PUT /api/fornecedores/:id (atualizar no tenant)
router.put('/:id(\\d+)', express.json({ limit: '2mb' }), async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ error: 'tenant_id não resolvido' });

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

    try {
        const {
            razao_social,
            nome_fantasia,
            cnpj,
            telefone,
            email,
            responsavel,
            status,
            inscricao_municipal,

            logradouro_garagem,
            numero_garagem,
            complemento_garagem,
            bairro_garagem,
            cidade_garagem,
            cep_garagem,
            referencia_garagem,

            garagem_localizacao,
        } = req.body || {};

        if (!razao_social || !cnpj) {
            return res.status(400).json({ error: 'Razão social e CNPJ são obrigatórios.' });
        }

        if (
            !garagem_localizacao ||
            garagem_localizacao.type !== 'Point' ||
            !Array.isArray(garagem_localizacao.coordinates)
        ) {
            return res.status(400).json({ error: 'garagem_localizacao deve ser um GeoJSON Point válido.' });
        }

        const [lng, lat] = garagem_localizacao.coordinates;
        if (
            typeof lat !== 'number' ||
            typeof lng !== 'number' ||
            Number.isNaN(lat) ||
            Number.isNaN(lng)
        ) {
            return res.status(400).json({ error: 'Coordenadas da garagem inválidas.' });
        }

        const result = await pool.query(
            `
      UPDATE fornecedores
      SET
        razao_social        = $1,
        nome_fantasia       = $2,
        cnpj                = $3,
        telefone            = $4,
        email               = $5,
        responsavel         = $6,
        status              = COALESCE($7, 'ativo'),
        inscricao_municipal = $8,
        logradouro_garagem  = $9,
        numero_garagem      = $10,
        complemento_garagem = $11,
        bairro_garagem      = $12,
        cidade_garagem      = $13,
        cep_garagem         = $14,
        referencia_garagem  = $15,
        garagem_localizacao = ST_SetSRID(ST_MakePoint($17, $16), 4326),
        updated_at          = NOW()
      WHERE tenant_id = $18 AND id = $19
      RETURNING
        id,
        razao_social,
        nome_fantasia,
        cnpj,
        telefone,
        email,
        responsavel,
        status,
        inscricao_municipal,
        logradouro_garagem,
        numero_garagem,
        complemento_garagem,
        bairro_garagem,
        cidade_garagem,
        cep_garagem,
        referencia_garagem,
        ST_AsGeoJSON(garagem_localizacao)::jsonb AS garagem_localizacao;
      `,
            [
                razao_social,              // $1
                nome_fantasia || null,     // $2
                cnpj,                      // $3
                telefone || null,          // $4
                email || null,             // $5
                responsavel || null,       // $6
                status || 'ativo',         // $7
                inscricao_municipal || null, // $8
                logradouro_garagem,        // $9
                numero_garagem,            // $10
                complemento_garagem || null, // $11
                bairro_garagem,            // $12
                cidade_garagem,            // $13
                cep_garagem,               // $14
                referencia_garagem || null, // $15
                lat,                       // $16
                lng,                       // $17
                tenantId,                  // $18
                id                         // $19
            ]
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: 'Fornecedor não encontrado.' });
        }

        res.json(mapFornecedorRow(result.rows[0]));
    } catch (err) {
        console.error('Erro ao atualizar fornecedor:', err);

        if (err.code === '23505') {
            return res.status(400).json({ error: 'Já existe um fornecedor com este CNPJ.' });
        }

        res.status(500).json({ error: 'Erro ao atualizar fornecedor.' });
    }
});

// DELETE /api/fornecedores/:id (excluir do tenant)
router.delete('/:id(\\d+)', async (req, res) => {
    const tenantId = resolveTenantId(req);
    if (!tenantId) return res.status(401).json({ error: 'tenant_id não resolvido' });

    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) return res.status(400).json({ error: 'ID inválido.' });

    try {
        const { rowCount } = await pool.query(
            'DELETE FROM fornecedores WHERE tenant_id = $1 AND id = $2',
            [tenantId, id]
        );

        if (!rowCount) return res.status(404).json({ error: 'Fornecedor não encontrado.' });
        res.json({ success: true });
    } catch (err) {
        console.error('Erro ao excluir fornecedor:', err);
        res.status(500).json({ error: 'Erro ao excluir fornecedor.' });
    }
});

export default router;