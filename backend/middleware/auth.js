// backend/middleware/auth.js
import jwt from 'jsonwebtoken';

function getJwtSecret() {
    const secret = process.env.JWT_SECRET;
    if (!secret) throw new Error('JWT_SECRET não definido no .env');
    return secret;
}

function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    const parts = String(cookieHeader).split(';');
    for (const part of parts) {
        const idx = part.indexOf('=');
        if (idx === -1) continue;
        const key = part.slice(0, idx).trim();
        const val = part.slice(idx + 1).trim();
        if (!key) continue;
        try {
            cookies[key] = decodeURIComponent(val);
        } catch {
            cookies[key] = val;
        }
    }
    return cookies;
}

function getTokenFromRequest(req) {
    // 1) Authorization: Bearer <token>
    const auth = req.headers.authorization || '';
    const parts = auth.split(' ');
    const type = parts[0];
    const token = parts[1];
    if (type === 'Bearer' && token) return token;

    // 2) Cookie-based token (funciona mesmo se HttpOnly)
    const cookies = parseCookies(req.headers.cookie);
    return (
        cookies.token ||
        cookies.authToken ||
        cookies.access_token ||
        cookies.jwt ||
        cookies.accessToken ||
        cookies['setrane_token'] ||
        ''
    );
}

function withNext(loginPath, originalUrl) {
    const joiner = loginPath.includes('?') ? '&' : '?';
    return `${loginPath}${joiner}next=${encodeURIComponent(originalUrl)}`;
}

/**
 * ==========================
 *  AUTH PARA API (JSON)
 * ==========================
 * - Se não tiver token: 401
 * - Se token inválido/expirado: 401
 * - Se válido: injeta req.user e req.tenantId
 */
export default function authMiddleware(req, res, next) {
    try {
        // BYPASS: rotas públicas não exigem token
        const url = req.originalUrl || req.url || '';
        if (url.startsWith('/api/public/')) return next();

        const token = getTokenFromRequest(req);
        if (!token) return res.status(401).json({ error: 'Unauthorized' });

        const payload = jwt.verify(token, getJwtSecret());
        req.user = payload;

        // tenant_id costuma vir no payload
        if (payload?.tenant_id != null) {
            req.tenantId = String(payload.tenant_id);
        }

        return next();
    } catch {
        return res.status(401).json({ error: 'Unauthorized' });
    }
}

/**
 * ==========================
 *  AUTH PARA PÁGINAS (HTML)
 * ==========================
 * - Se não tiver token, ou token inválido/expirado: redireciona para login
 * - Se válido: injeta req.user e req.tenantId e segue
 */
export function makePageAuth({ loginPath = '/' } = {}) {
    return function pageAuthMiddleware(req, res, next) {
        try {
            const token = getTokenFromRequest(req);
            if (!token) return res.redirect(withNext(loginPath, req.originalUrl));

            const payload = jwt.verify(token, getJwtSecret());
            req.user = payload;

            if (payload?.tenant_id != null) {
                req.tenantId = String(payload.tenant_id);
            }

            return next();
        } catch {
            return res.redirect(withNext(loginPath, req.originalUrl));
        }
    };
}

// Helpers prontos para uso (opcionais)
export const pageAuth = makePageAuth({ loginPath: '/' });
export const adminPageAuth = makePageAuth({ loginPath: '/admin-login' });

// Também exporta utilitários se você quiser reutilizar em outros módulos
export { getTokenFromRequest, parseCookies };


/**
 * ==========================
 *  AUTORIZAÇÃO POR CARGO
 * ==========================
 * Uso (API):
 *   router.get('/x', authMiddleware, requireRole('ADMIN','GESTOR'), handler)
 *
 * Uso (Páginas):
 *   app.get('/pagina', pageAuth, requirePageRole('ADMIN','GESTOR'), (req,res)=>...)
 */
export function requireRole(...allowed) {
    const allow = allowed.map(s => String(s).toUpperCase());
    return function roleMiddleware(req, res, next) {
        const cargo = String(req.user?.cargo || '').toUpperCase();
        if (!cargo || !allow.includes(cargo)) {
            return res.status(403).json({ error: 'Forbidden', message: 'Sem permissão' });
        }
        return next();
    };
}

export function requirePageRole(...allowed) {
    const allow = allowed.map(s => String(s).toUpperCase());
    return function pageRoleMiddleware(req, res, next) {
        const cargo = String(req.user?.cargo || '').toUpperCase();
        if (!cargo || !allow.includes(cargo)) {
            // Redireciona para dashboard padrão (ou login), sem expor detalhes
            return res.redirect('/dashboard');
        }
        return next();
    };
}

export const requireAdmin = requireRole('ADMIN');
export const requireAdminOrGestor = requireRole('ADMIN', 'GESTOR');
export const requireEscolarFornecedorOrAdminGestor = requireRole('ADMIN', 'GESTOR', 'FORNECEDOR_ESCOLAR');