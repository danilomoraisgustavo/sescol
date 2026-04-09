// backend/routes/password-reset.js
import express from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'crypto';
import pool from '../db.js';
import { sendPasswordResetEmail } from '../utils/mailer.js';
import { createRateLimit, buildTenantScopedKey } from '../middleware/rateLimit.js';
import { resolveTenantFromHost, isLocalhostRequest } from '../services/tenantHost.js';
import { ensureTenantSecurityDefaults, getTenantSecurityPolicy, recordSecurityLog } from '../services/security.js';

const router = express.Router();

const passwordResetRateLimit = createRateLimit({
  namespace: 'password-reset',
  windowMs: 15 * 60 * 1000,
  max: 8,
  key: (req) => buildTenantScopedKey(req, req.path || 'password-reset'),
  message: 'Muitas tentativas de redefinição. Aguarde alguns minutos e tente novamente.'
});

/**
 * Endpoints:
 *  POST /api/password-reset/request  { email, tenant_id? }
 *  POST /api/password-reset/verify   { email, code, tenant_id? }
 *  POST /api/password-reset/confirm  { email, code, novaSenha, tenant_id? }
 *
 * IMPORTANT:
 * - This file does NOT attempt to CREATE TABLE at runtime (production-safe).
 * - You MUST create table `public.password_resets` once using an admin user (see SQL in this package).
 */

const CODE_TTL_MIN = Number(process.env.PASSWORD_RESET_CODE_TTL_MIN || 15);
const BCRYPT_ROUNDS = Number(process.env.BCRYPT_ROUNDS || 10);
const MAX_ATTEMPTS = Number(process.env.PASSWORD_RESET_MAX_ATTEMPTS || 6);

function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase();
}

function normalizeTenantId(v) {
  if (v === undefined || v === null || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function normalizeTenantCode(value) {
  const digits = String(value || '').replace(/\D/g, '').trim();
  return digits.length === 7 ? digits : null;
}

function gen6Digits() {
  const n = crypto.randomInt(0, 1000000);
  return String(n).padStart(6, '0');
}

async function getUserSchema() {
  // Your schema defaults
  const table = (process.env.AUTH_USERS_TABLE || '').trim() || 'usuarios';
  const emailCol = (process.env.AUTH_USERS_EMAIL_COL || '').trim() || 'email';
  const idCol = (process.env.AUTH_USERS_ID_COL || '').trim() || 'id';
  const passCol = (process.env.AUTH_USERS_PASSWORD_COL || '').trim() || 'senha_hash';
  const tenantCol = (process.env.AUTH_USERS_TENANT_COL || '').trim() || 'tenant_id';
  return { table, emailCol, idCol, passCol, tenantCol };
}

async function findUserByEmail(email, tenantId) {
  const s = await getUserSchema();

  if (tenantId !== null) {
    const q = `SELECT ${s.idCol} AS id, ${s.emailCol} AS email, ${s.tenantCol} AS tenant_id
               FROM public.${s.table}
               WHERE ${s.emailCol} = $1 AND ${s.tenantCol} = $2
               LIMIT 1`;
    const { rows } = await pool.query(q, [email, tenantId]);
    return rows[0] || null;
  }

  // Fallback (less safe in multi-tenant): pick most recent
  const q = `SELECT ${s.idCol} AS id, ${s.emailCol} AS email, ${s.tenantCol} AS tenant_id
             FROM public.${s.table}
             WHERE ${s.emailCol} = $1
             ORDER BY ${s.idCol} DESC
             LIMIT 1`;
  const { rows } = await pool.query(q, [email]);
  return rows[0] || null;
}

async function resolveTenantIdForReset(email, tenantCode) {
  if (tenantCode) {
    const { rows } = await pool.query(
      `
      SELECT t.id
      FROM tenants t
      JOIN usuarios u ON u.tenant_id = t.id
      WHERE lower(u.email) = lower($1)
        AND t.codigo = $2
      LIMIT 1
      `,
      [email, tenantCode]
    );
    return rows[0]?.id ?? null;
  }

  const { rows } = await pool.query(
    `
    SELECT DISTINCT tenant_id
    FROM usuarios
    WHERE lower(email) = lower($1)
    ORDER BY tenant_id ASC
    `,
    [email]
  );

  if (rows.length === 1) return rows[0].tenant_id;
  return null;
}

async function updateUserPassword(email, tenantId, passwordHash) {
  const s = await getUserSchema();

  if (tenantId === null) {
    throw new Error('tenant_id é obrigatório para redefinir senha em ambiente multi-tenant');
  }

  const q = `UPDATE public.${s.table} SET ${s.passCol} = $1 WHERE ${s.emailCol} = $2 AND ${s.tenantCol} = $3`;
  await pool.query(q, [passwordHash, email, tenantId]);
}

async function getActiveReset(email, tenantId) {
  if (tenantId !== null) {
    const { rows } = await pool.query(
      `
      SELECT *
      FROM public.password_resets
      WHERE email = $1
        AND tenant_id = $2
        AND used_at IS NULL
        AND expires_at > NOW()
      ORDER BY created_at DESC
      LIMIT 1
      `,
      [email, tenantId]
    );
    return rows[0] || null;
  }

  const { rows } = await pool.query(
    `
    SELECT *
    FROM public.password_resets
    WHERE email = $1
      AND used_at IS NULL
      AND expires_at > NOW()
    ORDER BY created_at DESC
    LIMIT 1
    `,
    [email]
  );
  return rows[0] || null;
}

async function invalidateResets(email, tenantId) {
  if (tenantId !== null) {
    await pool.query(
      `UPDATE public.password_resets SET used_at = NOW() WHERE email = $1 AND tenant_id = $2 AND used_at IS NULL`,
      [email, tenantId]
    );
    return;
  }
  await pool.query(
    `UPDATE public.password_resets SET used_at = NOW() WHERE email = $1 AND used_at IS NULL`,
    [email]
  );
}

function pgHint(err) {
  // Helpful hint for common DB problems
  const msg = String(err?.message || '');
  if (msg.includes('relation') && msg.includes('password_resets') && msg.includes('does not exist')) {
    return 'Tabela password_resets não existe. Rode o SQL de criação (sql/password_resets.sql) com um usuário admin.';
  }
  if (msg.includes('permission denied')) {
    return 'Permissão insuficiente no Postgres. Crie a tabela como admin e conceda GRANTs ao usuário do app.';
  }
  return null;
}

/**
 * POST /api/password-reset/request
 * body: { email, tenant_id? }
 */
router.post('/password-reset/request', passwordResetRateLimit, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const requestedTenantId = normalizeTenantId(req.body?.tenant_id);
    const tenantCode = normalizeTenantCode(req.body?.tenant_codigo);
    const tenantFromHost = await resolveTenantFromHost(req);
    const tenantId = requestedTenantId ?? tenantFromHost?.id ?? await resolveTenantIdForReset(email, tenantCode);

    if (!email) return res.status(400).json({ success: false, message: 'Informe um e-mail válido.' });
    if (tenantId) await ensureTenantSecurityDefaults(tenantId);
    const policy = tenantId ? await getTenantSecurityPolicy(tenantId) : null;
    const ttlMinutes = Math.max(5, Number(policy?.reset_link_minutes || CODE_TTL_MIN));

    // Always invalidate previous active resets for this email(/tenant)
    await invalidateResets(email, tenantId);

    // Find user; but never reveal existence (avoid enumeration)
    const user = await findUserByEmail(email, tenantId).catch((e) => {
      console.error(e);
      return null;
    });

    if (user) {
      const code = gen6Digits();
      const codeHash = await bcrypt.hash(code, BCRYPT_ROUNDS);
      const expiresAt = new Date(Date.now() + ttlMinutes * 60 * 1000);

      await pool.query(
        `
        INSERT INTO public.password_resets (tenant_id, user_id, email, code_hash, expires_at)
        VALUES ($1, $2, $3, $4, $5)
        `,
        [user.tenant_id ?? tenantId, user.id, email, codeHash, expiresAt]
      );

      // Send email (premium template)
      try {
        await sendPasswordResetEmail({
          to: email,
          code,
          expiresMinutes: ttlMinutes,
          appName: process.env.APP_NAME || 'PyDenTech',
          appUrl: process.env.APP_URL || '',
          logoUrl: process.env.MAIL_LOGO_URL || 'https://pydentech.com/img/logo.png',
          supportText: process.env.MAIL_SUPPORT_TEXT || 'Se você não solicitou, pode ignorar este e-mail com segurança.'
        });
      } catch (mailErr) {
        console.error('Erro ao enviar e-mail de reset:', mailErr);
        // still respond success to avoid enumeration
      }

      await recordSecurityLog({
        tenantId: user.tenant_id ?? tenantId,
        userId: user.id,
        email,
        action: 'AUTH_PASSWORD_RESET_REQUEST',
        targetType: 'usuario',
        targetId: user.id,
        description: 'Solicitação de redefinição de senha.',
        level: 'warn',
        scope: 'Usuário',
        ip: req.ip,
        userAgent: req.headers['user-agent'] || null,
        metadata: { expires_minutes: ttlMinutes }
      });
    }

    return res.json({
      success: true,
      message: 'Se o e-mail existir no sistema, enviamos um código para redefinição.'
    });
  } catch (err) {
    console.error(err);
    const hint = pgHint(err);
    return res.status(500).json({
      success: false,
      message: hint || 'Erro interno ao processar a solicitação.'
    });
  }
});

/**
 * POST /api/password-reset/verify
 * body: { email, code, tenant_id? }
 */
router.post('/password-reset/verify', passwordResetRateLimit, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    const requestedTenantId = normalizeTenantId(req.body?.tenant_id);
    const tenantCode = normalizeTenantCode(req.body?.tenant_codigo);
    const tenantFromHost = await resolveTenantFromHost(req);
    const tenantId = requestedTenantId ?? tenantFromHost?.id ?? await resolveTenantIdForReset(email, tenantCode);

    if (!email || !code) return res.status(400).json({ valid: false, message: 'Informe e-mail e código.' });
    if (tenantId === null) {
      return res.json({
        valid: false,
        message: isLocalhostRequest(req)
          ? 'Informe o código do tenant para validar a redefinição em ambiente local.'
          : 'Não foi possível determinar o tenant pelo domínio acessado.'
      });
    }

    const reset = await getActiveReset(email, tenantId);
    if (!reset) return res.json({ valid: false, message: 'Código inválido ou expirado.' });

    if (Number(reset.attempts || 0) >= MAX_ATTEMPTS) {
      await pool.query(`UPDATE public.password_resets SET used_at = NOW() WHERE id = $1`, [reset.id]);
      return res.json({ valid: false, message: 'Muitas tentativas. Solicite um novo código.' });
    }

    const ok = await bcrypt.compare(code, reset.code_hash);
    await pool.query(`UPDATE public.password_resets SET attempts = attempts + 1 WHERE id = $1`, [reset.id]);

    if (!ok) return res.json({ valid: false, message: 'Código inválido ou expirado.' });

    await recordSecurityLog({
      tenantId,
      userId: reset.user_id || null,
      email,
      action: 'AUTH_PASSWORD_RESET_CODE_VERIFIED',
      targetType: 'usuario',
      targetId: reset.user_id || email,
      description: 'Código de redefinição validado.',
      level: 'info',
      scope: 'Usuário',
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return res.json({ valid: true });
  } catch (err) {
    console.error(err);
    const hint = pgHint(err);
    return res.status(500).json({ valid: false, message: hint || 'Erro interno ao validar o código.' });
  }
});

/**
 * POST /api/password-reset/confirm
 * body: { email, code, novaSenha, tenant_id? }
 */
router.post('/password-reset/confirm', passwordResetRateLimit, async (req, res) => {
  try {
    const email = normalizeEmail(req.body?.email);
    const code = String(req.body?.code || '').trim();
    const novaSenha = String(req.body?.novaSenha || '');
    const requestedTenantId = normalizeTenantId(req.body?.tenant_id);
    const tenantCode = normalizeTenantCode(req.body?.tenant_codigo);
    const tenantFromHost = await resolveTenantFromHost(req);
    const tenantId = requestedTenantId ?? tenantFromHost?.id ?? await resolveTenantIdForReset(email, tenantCode);

    if (!email || !code || !novaSenha) {
      return res.status(400).json({ success: false, message: 'Informe e-mail, código e nova senha.' });
    }
    if (tenantId === null) {
      return res.status(400).json({
        success: false,
        message: isLocalhostRequest(req)
          ? 'Informe o código do tenant para redefinir a senha em ambiente local.'
          : 'Não foi possível determinar o tenant pelo domínio acessado.'
      });
    }

    await ensureTenantSecurityDefaults(tenantId);
    const policy = await getTenantSecurityPolicy(tenantId);
    const minPasswordLength = Math.max(6, Number(policy?.password_min_length || 8));
    if (novaSenha.length < minPasswordLength) {
      return res.status(400).json({ success: false, message: `A senha deve ter pelo menos ${minPasswordLength} caracteres.` });
    }

    const reset = await getActiveReset(email, tenantId);
    if (!reset) return res.json({ success: false, message: 'Código inválido ou expirado.' });

    if (Number(reset.attempts || 0) >= MAX_ATTEMPTS) {
      await pool.query(`UPDATE public.password_resets SET used_at = NOW() WHERE id = $1`, [reset.id]);
      return res.json({ success: false, message: 'Muitas tentativas. Solicite um novo código.' });
    }

    const ok = await bcrypt.compare(code, reset.code_hash);
    await pool.query(`UPDATE public.password_resets SET attempts = attempts + 1 WHERE id = $1`, [reset.id]);

    if (!ok) return res.json({ success: false, message: 'Código inválido ou expirado.' });

    const passwordHash = await bcrypt.hash(novaSenha, BCRYPT_ROUNDS);

    await updateUserPassword(email, reset.tenant_id ?? tenantId, passwordHash);

    await pool.query(`UPDATE public.password_resets SET used_at = NOW() WHERE id = $1`, [reset.id]);

    await recordSecurityLog({
      tenantId: reset.tenant_id ?? tenantId,
      userId: reset.user_id || null,
      email,
      action: 'AUTH_PASSWORD_RESET_CONFIRMED',
      targetType: 'usuario',
      targetId: reset.user_id || email,
      description: 'Senha redefinida com sucesso.',
      level: 'warn',
      scope: 'Usuário',
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
    });

    return res.json({ success: true });
  } catch (err) {
    console.error(err);
    const hint = pgHint(err);
    return res.status(500).json({ success: false, message: hint || 'Erro interno ao redefinir a senha.' });
  }
});

export default router;
