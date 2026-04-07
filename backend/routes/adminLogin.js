// backend/routes/adminLogin.js
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
 * POST /api/admin-login
 * Regras:
 * - usuário existe
 * - ativo = true
 * - init = true
 * - cargo = ADMIN
 * - senha válida (bcrypt)
 */
router.post('/admin-login', async (req, res) => {
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
        if (String(user.cargo).toUpperCase() !== 'ADMIN') {
            return res.status(403).json({ error: 'Acesso restrito ao ADMIN.' });
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
                cargo: user.cargo,
                fornecedor_id: user.fornecedor_id ?? null,
            },
            getJwtSecret(),
            { expiresIn: '8h' }
        );

        // grava token em cookie para permitir acesso às páginas protegidas (requireAuthPage)
        // Obs.: se você estiver atrás de proxy (nginx), considere também: app.set('trust proxy', 1)
        const isProd = process.env.NODE_ENV === 'production';
        res.cookie('setrane_token', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: isProd,
            path: '/',
            maxAge: 8 * 60 * 60 * 1000,
        });

        return res.json({
            success: true,
            message: 'Login admin efetuado com sucesso.',
            token,
            user: {
                id: user.id,
                tenant_id: user.tenant_id,
                nome: user.nome,
                email: user.email,
                cargo: user.cargo,
                fornecedor_id: user.fornecedor_id ?? null,
            },
            redirectUrl: '/admin/painel',
        });
    } catch (err) {
        console.error('Erro no admin-login:', err);
        return res.status(500).json({ error: 'Erro ao efetuar login admin', detail: err.message });
    } finally {
        if (client) client.release();
    }
});

export default router;