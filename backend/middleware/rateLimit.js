const buckets = new Map();

function nowMs() {
    return Date.now();
}

function getClientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.trim()) {
        return forwarded.split(',')[0].trim();
    }
    return (
        req.ip ||
        req.socket?.remoteAddress ||
        req.connection?.remoteAddress ||
        'unknown'
    );
}

function cleanupExpiredEntries(maxEntries = 10000) {
    if (buckets.size < maxEntries) return;
    const now = nowMs();
    for (const [key, entry] of buckets.entries()) {
        if (!entry || entry.resetAt <= now) {
            buckets.delete(key);
        }
    }
}

export function createRateLimit({
    namespace = 'default',
    windowMs = 15 * 60 * 1000,
    max = 10,
    key = (req) => getClientIp(req),
    message = 'Muitas tentativas. Tente novamente mais tarde.',
    statusCode = 429,
}) {
    return function rateLimitMiddleware(req, res, next) {
        cleanupExpiredEntries();

        const bucketKey = `${namespace}:${key(req)}`;
        const now = nowMs();
        const current = buckets.get(bucketKey);

        if (!current || current.resetAt <= now) {
            buckets.set(bucketKey, {
                count: 1,
                resetAt: now + windowMs,
            });
            return next();
        }

        current.count += 1;
        buckets.set(bucketKey, current);

        if (current.count > max) {
            const retryAfterSec = Math.max(1, Math.ceil((current.resetAt - now) / 1000));
            res.setHeader('Retry-After', String(retryAfterSec));
            return res.status(statusCode).json({ error: message, message });
        }

        return next();
    };
}

export function buildTenantScopedKey(req, extra = '') {
    const ip = getClientIp(req);
    const email = String(req.body?.email || '').trim().toLowerCase();
    const tenantCodigo = String(req.body?.tenant_codigo || req.query?.tenant_codigo || '')
        .replace(/\D/g, '')
        .trim();
    return [ip, email, tenantCodigo, extra].filter(Boolean).join('|');
}
