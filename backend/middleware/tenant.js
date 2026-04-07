// backend/middleware/tenant.js

/**
 * Middleware de tenant.
 *
 * Regra de segurança:
 * - O tenant SEMPRE vem do JWT validado (req.user.tenant_id)
 * - Não aceitamos tenant via header/query/body para evitar spoofing
 */
export default function tenantMiddleware(req, res, next) {
    const tenantId = req?.tenantId ?? req?.user?.tenant_id;

    if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id não informado no token' });
    }

    req.tenantId = String(tenantId);
    return next();
}