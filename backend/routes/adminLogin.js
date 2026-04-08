// backend/routes/adminLogin.js
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { createRateLimit, buildTenantScopedKey } from '../middleware/rateLimit.js';
import { resolveTenantFromHost, isLocalhostRequest } from '../services/tenantHost.js';
import { getUsuarioSelectFields } from '../services/userSchema.js';

const router = express.Router();

const adminAuthRateLimit = createRateLimit({
    namespace: 'auth-admin-login',
    windowMs: 15 * 60 * 1000,
    max: 8,
    key: (req) => buildTenantScopedKey(req, 'admin-login'),
    message: 'Muitas tentativas de login admin. Aguarde alguns minutos e tente novamente.'
});

function normalizeTenantCode(value) {
    const digits = String(value || '').replace(/\D/g, '').trim();
    return digits.length === 7 ? digits : null;
}

async function findAdminUsersByEmail(client, email) {
    const fields = await getUsuarioSelectFields('u');
    const { rows } = await client.query(
        `
        SELECT ${fields}
        FROM usuarios u
        WHERE lower(u.email) = lower($1)
        ORDER BY u.id ASC;
      `,
        [email]
    );
    return rows;
}

async function findAdminByEmailAndTenantCode(client, email, tenantCode) {
    const fields = await getUsuarioSelectFields('u');
    const { rows } = await client.query(
        `
        SELECT ${fields}
        FROM usuarios u
        JOIN tenants t ON t.id = u.tenant_id
        WHERE lower(u.email) = lower($1)
          AND t.codigo = $2
        LIMIT 1;
      `,
        [email, tenantCode]
    );
    return rows[0] || null;
}

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
router.post('/admin-login', adminAuthRateLimit, async (req, res) => {
    const { email, senha } = req.body || {};
    const tenantCode = normalizeTenantCode(req.body?.tenant_codigo);
    if (!email || !senha) {
        return res.status(400).json({ error: 'E-mail e senha são obrigatórios.' });
    }

    let client;
    try {
        client = await pool.connect();

        const tenantFromHost = await resolveTenantFromHost(req);
        const resolvedTenantCode = tenantFromHost ? null : tenantCode;

        let user = null;
        if (tenantFromHost?.id) {
            const fields = await getUsuarioSelectFields('u');
            const { rows } = await client.query(
                `
                SELECT ${fields}
                FROM usuarios u
                WHERE lower(u.email) = lower($1)
                  AND u.tenant_id = $2
                LIMIT 1
                `,
                [email, tenantFromHost.id]
            );
            user = rows[0] || null;
        } else if (resolvedTenantCode) {
            user = await findAdminByEmailAndTenantCode(client, email, resolvedTenantCode);
        } else {
            const matches = await findAdminUsersByEmail(client, email);
            if (matches.length > 1) {
                return res.status(409).json({
                    error: isLocalhostRequest(req)
                        ? 'Há mais de um tenant vinculado a este e-mail. Em ambiente local, informe também o código do tenant.'
                        : 'Não foi possível determinar o tenant pelo domínio acessado.'
                });
            }
            user = matches[0] || null;
        }

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
            tenant_codigo: resolvedTenantCode || null,
            tenant_host: tenantFromHost?.host || null,
        });
    } catch (err) {
        console.error('Erro no admin-login:', err);
        return res.status(500).json({ error: 'Erro ao efetuar login admin', detail: err.message });
    } finally {
        if (client) client.release();
    }
});

export default router;
