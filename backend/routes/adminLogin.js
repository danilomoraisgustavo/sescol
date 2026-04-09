// backend/routes/adminLogin.js
import express from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import { createRateLimit, buildTenantScopedKey } from '../middleware/rateLimit.js';
import { resolveTenantFromHost, isLocalhostRequest } from '../services/tenantHost.js';
import { getUsuarioSelectFields } from '../services/userSchema.js';
import {
    clearLoginFailures,
    ensureTenantSecurityDefaults,
    getEffectiveUserSecurity,
    getLoginLockoutStatus,
    getTenantSecurityPolicy,
    recordSecurityLog,
    registerFailedLoginAttempt,
} from '../services/security.js';

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
        const tenantCandidateId = tenantFromHost?.id || null;
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

        const lockoutTenantId = user?.tenant_id || tenantCandidateId || null;
        if (lockoutTenantId) {
            await ensureTenantSecurityDefaults(lockoutTenantId);
            const lockout = await getLoginLockoutStatus({ tenantId: lockoutTenantId, email });
            if (lockout?.is_locked) {
                await recordSecurityLog({
                    tenantId: lockoutTenantId,
                    userId: user?.id || null,
                    email,
                    action: 'AUTH_ADMIN_LOGIN_BLOCKED',
                    targetType: 'usuario',
                    targetId: user?.id || email,
                    description: 'Tentativa de login admin bloqueada por política de segurança.',
                    level: 'danger',
                    scope: 'Secretaria',
                    ip: req.ip,
                    userAgent: req.headers['user-agent'] || null,
                    metadata: { locked_until: lockout.locked_until }
                });
                return res.status(423).json({ error: 'Conta temporariamente bloqueada por tentativas inválidas.' });
            }
        }

        if (!user) {
            if (lockoutTenantId) {
                const policy = await getTenantSecurityPolicy(lockoutTenantId);
                await registerFailedLoginAttempt({ tenantId: lockoutTenantId, email, ip: req.ip, lockoutPolicy: policy });
                await recordSecurityLog({
                    tenantId: lockoutTenantId,
                    email,
                    action: 'AUTH_ADMIN_LOGIN_FAILURE',
                    targetType: 'usuario',
                    targetId: email,
                    description: 'Falha de login admin por credenciais inválidas.',
                    level: 'danger',
                    scope: 'Secretaria',
                    ip: req.ip,
                    userAgent: req.headers['user-agent'] || null,
                    metadata: { motivo: 'user_not_found' }
                });
            }
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
            await ensureTenantSecurityDefaults(user.tenant_id);
            const policy = await getTenantSecurityPolicy(user.tenant_id);
            await registerFailedLoginAttempt({ tenantId: user.tenant_id, email, ip: req.ip, lockoutPolicy: policy, metadata: { user_id: user.id } });
            await recordSecurityLog({
                tenantId: user.tenant_id,
                userId: user.id,
                email,
                action: 'AUTH_ADMIN_LOGIN_FAILURE',
                targetType: 'usuario',
                targetId: user.id,
                description: 'Falha de login admin por senha inválida.',
                level: 'danger',
                scope: 'Secretaria',
                ip: req.ip,
                userAgent: req.headers['user-agent'] || null,
                metadata: { motivo: 'invalid_password' }
            });
            return res.status(401).json({ error: 'Credenciais inválidas.' });
        }

        await ensureTenantSecurityDefaults(user.tenant_id);
        const policy = await getTenantSecurityPolicy(user.tenant_id);
        const security = await getEffectiveUserSecurity(user.id, user.tenant_id);
        await clearLoginFailures({ tenantId: user.tenant_id, email, ip: req.ip });

        const token = jwt.sign(
            {
                id: user.id,
                tenant_id: user.tenant_id,
                nome: user.nome,
                email: user.email,
                cargo: user.cargo,
                fornecedor_id: user.fornecedor_id ?? null,
                profiles: security.profiles,
                permissions: security.permissions,
            },
            getJwtSecret(),
            { expiresIn: `${Math.max(30, Number(policy?.session_minutes || 480))}m` }
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

        await recordSecurityLog({
            tenantId: user.tenant_id,
            userId: user.id,
            email: user.email,
            action: 'AUTH_ADMIN_LOGIN_SUCCESS',
            targetType: 'usuario',
            targetId: user.id,
            description: 'Login administrativo efetuado com sucesso.',
            level: 'info',
            scope: 'Secretaria',
            ip: req.ip,
            userAgent: req.headers['user-agent'] || null,
            metadata: { cargo: user.cargo, profiles: security.profiles.map((item) => item.codigo) }
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
                profiles: security.profiles,
                permissions: security.permissions,
            },
            redirectUrl: '/selecao-unidade',
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
