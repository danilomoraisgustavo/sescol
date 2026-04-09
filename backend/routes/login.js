// backend/routes/login.js
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

const authRateLimit = createRateLimit({
    namespace: 'auth-login',
    windowMs: 15 * 60 * 1000,
    max: 8,
    key: (req) => buildTenantScopedKey(req, 'login'),
    message: 'Muitas tentativas de login. Aguarde alguns minutos e tente novamente.'
});

function normalizeTenantCode(value) {
    const digits = String(value || '').replace(/\D/g, '').trim();
    return digits.length === 7 ? digits : null;
}

async function findUsersByEmail(client, email) {
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

async function findUserByEmailAndTenantCode(client, email, tenantCode) {
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
 * POST /api/login
 *
 * Regras:
 * - ativo = true
 * - init = true
 * - cargo IN (ADMIN, GESTOR, USUARIO)
 * - senha válida (bcrypt)
 */
router.post('/login', authRateLimit, async (req, res) => {
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
            user = await findUserByEmailAndTenantCode(client, email, resolvedTenantCode);
        } else {
            const matches = await findUsersByEmail(client, email);
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
                    action: 'AUTH_LOGIN_BLOCKED',
                    targetType: 'usuario',
                    targetId: user?.id || email,
                    description: 'Tentativa de login bloqueada por política de segurança.',
                    level: 'danger',
                    scope: 'Usuário',
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
                    action: 'AUTH_LOGIN_FAILURE',
                    targetType: 'usuario',
                    targetId: email,
                    description: 'Falha de login por credenciais inválidas.',
                    level: 'danger',
                    scope: 'Usuário',
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

        const cargo = String(user.cargo || '').toUpperCase();
        if (!['ADMIN', 'GESTOR', 'USUARIO', 'FORNECEDOR_ESCOLAR'].includes(cargo)) {
            return res.status(403).json({ error: 'Cargo sem permissão para acessar o sistema.' });
        }

        if (cargo === 'FORNECEDOR_ESCOLAR' && user.fornecedor_id == null) {
            return res.status(403).json({ error: 'Usuário fornecedor sem vínculo com fornecedor.' });
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
                action: 'AUTH_LOGIN_FAILURE',
                targetType: 'usuario',
                targetId: user.id,
                description: 'Falha de login por senha inválida.',
                level: 'danger',
                scope: 'Usuário',
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
                cargo,
                fornecedor_id: user.fornecedor_id ?? null,
                profiles: security.profiles,
                permissions: security.permissions,
            },
            getJwtSecret(),
            { expiresIn: `${Math.max(30, Number(policy?.session_minutes || 480))}m` }
        );

        // ADMIN pode ter acesso ao painel admin do seu tenant (se você desejar)
        const redirectUrl = '/selecao-unidade';

        const isSecure = req.secure || req.headers['x-forwarded-proto'] === 'https';
        // Cookie opcional para facilitar autenticação em páginas que não usam localStorage
        res.cookie('setrane_token', token, {
            httpOnly: true,
            sameSite: 'lax',
            secure: isSecure,
            maxAge: 8 * 60 * 60 * 1000,
            path: '/'
        });

        await recordSecurityLog({
            tenantId: user.tenant_id,
            userId: user.id,
            email: user.email,
            action: 'AUTH_LOGIN_SUCCESS',
            targetType: 'usuario',
            targetId: user.id,
            description: 'Login efetuado com sucesso.',
            level: 'info',
            scope: cargo === 'USUARIO' ? 'Escola' : 'Secretaria',
            ip: req.ip,
            userAgent: req.headers['user-agent'] || null,
            metadata: { cargo, profiles: security.profiles.map((item) => item.codigo) }
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
                profiles: security.profiles,
                permissions: security.permissions,
            },
            redirectUrl,
            tenant_codigo: resolvedTenantCode || null,
            tenant_host: tenantFromHost?.host || null,
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
