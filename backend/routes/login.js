// backend/routes/login.js
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pool from '../db.js';

const router = express.Router();

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) {
        throw new Error('JWT_SECRET não definido no .env');
    }
    return secret;
}

/**
 * POST /api/login
 *
 * Regras:
 * - ativo = true
 * - init = true
 * - cargo IN (ADMIN, GESTOR, USUARIO)
 * - senha válida (bcrypt)
 */
router.post('/login', async (req, res) => {
    const { email, senha } = req.body || {};
    if (!email || !senha) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    let client;
    try {
        client = await pool.connect();

        const { rows } = await client.query(
            `
        SELECT id, tenant_id, nome, email, senha_hash, cargo::text AS cargo, fornecedor_id, init, ativo
        FROM usuarios
        WHERE lower(email) = lower($1)
        LIMIT 1;
      `,
            [email]
        );

        const user = rows[0];
        if (!user) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }
        if (!user.ativo) {
            return res.status(403).json({ error: 'Usuário inativo.' });
        }
        if (!user.init) {
            return res.status(403).json({ error: 'Usuário ainda não inicializado.' });
        }

        const cargo = String(user.cargo || '').toUpperCase();
        if (!['ADMIN', 'GESTOR', 'USUARIO', 'FORNECEDOR_ESCOLAR'].includes(cargo)) {
            return res.status(403).json({ error: 'Cargo sem permissão para acessar o sistema.' });
        }

        if (cargo === 'FORNECEDOR_ESCOLAR' && user.fornecedor_id == null) {
            return res.status(403).json({ error: 'Usuário fornecedor sem vínculo com fornecedor.' });
        }

        const ok = await bcrypt.compare(String(senha), String(user.senha_hash));
        if (!ok) {
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        const token = jwt.sign(
            {
                id: user.id,
                tenant_id: user.tenant_id,
                nome: user.nome,
                email: user.email,
                cargo,
                fornecedor_id: user.fornecedor_id ?? null,
            },
            getJwtSecret(),
            { expiresIn: '8h' }
        );

        // ADMIN pode ter acesso ao painel admin do seu tenant (se você desejar)
        const redirectUrl = '/dashboard';

        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        // Cookie opcional para facilitar autenticação em páginas que não usam localStorage
        res.cookie('setrane_token', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: isSecure,
            maxAge: 8 * 60 * 60 * 1000,
            path: '/'
        });

        return res.json({
            success: true,
            token,
            user: {
                id: user.id,
                tenant_id: user.tenant_id,
                nome: user.nome,
                email: user.email,
                cargo,
                fornecedor_id: user.fornecedor_id ?? null,
            },
            redirectUrl,
        });
    } catch (err) {
        console.error('Erro no login:', err);
        return res.status(500).json({ error: 'Erro ao efetuar login', detail: err.message });
    } finally {
        if (client) client.release();
    }
});



/**
 * POST /api/cadastrar-usuario
 *
 * Cadastro por código do tenant:
 * - encontra tenant por tenants.codigo (7 dígitos)
 * - cria usuário com init = false e ativo = false (aguardando liberação)
 */
router.post('/cadastrar-usuario', async (req, res) => {
    const { tenant_codigo, nome_completo, email, telefone, senha } = req.body || {};
    const codigo = String(tenant_codigo || '').replace(/\D/g, '').trim();

    if (!nome_completo || !email || !senha || !codigo) {
        return res.status(400).json({
            success: false,
            message: 'Nome, e-mail, senha e código do tenant são obrigatórios.'
        });
    }
    if (codigo.length !== 7) {
        return res.status(400).json({
            success: false,
            message: 'Código do tenant inválido. Informe 7 dígitos.'
        });
    }

    let client;
    try {
        client = await pool.connect();

        const tenantRes = await client.query(
            'SELECT id, ativo FROM tenants WHERE codigo = $1 LIMIT 1;',
            [codigo]
        );

        if (!tenantRes.rows.length) {
            return res.status(400).json({ success: false, message: 'Código do tenant não encontrado.' });
        }

        const tenant = tenantRes.rows[0];
        if (!tenant.ativo) {
            return res.status(403).json({ success: false, message: 'Tenant inativo.' });
        }

        const senhaHash = await bcrypt.hash(String(senha), 10);

        const insertRes = await client.query(
            `
            INSERT INTO usuarios (tenant_id, nome, email, telefone, senha_hash, cargo, init, ativo)
            VALUES ($1, $2, lower($3), $4, $5, 'USUARIO'::cargo_usuario, false, false)
            RETURNING id;
            `,
            [tenant.id, nome_completo, email, telefone || null, senhaHash]
        );

        return res.json({
            success: true,
            message: 'Cadastro solicitado com sucesso. Aguarde a liberação do administrador.',
            userId: insertRes.rows[0]?.id
        });
    } catch (err) {
        if (err && err.code === '23505') {
            return res.status(409).json({
                success: false,
                message: 'Já existe um usuário com esse e-mail neste tenant.'
            });
        }
        console.error('Erro ao cadastrar usuário:', err);
        return res.status(500).json({
            success: false,
            message: 'Erro ao cadastrar usuário',
            detail: err.message
        });
    } finally {
        if (client) client.release();
    }
});


export default router;