import pool from '../db.js';

let cachedColumns = null;
let cachedAt = 0;

const COLUMN_CACHE_TTL_MS = 5 * 60 * 1000;
const CANDIDATE_COLUMNS = [
    'subdominio',
    'subdomain',
    'slug',
    'dominio',
    'domain',
    'host',
    'hostname',
    'custom_domain',
    'custom_hostname',
];

function normalizeHostLike(value) {
    return String(value || '')
        .trim()
        .toLowerCase()
        .replace(/^https?:\/\//, '')
        .replace(/:\d+$/, '')
        .replace(/\.$/, '');
}

export function getRequestHost(req) {
    const forwarded = req.headers['x-forwarded-host'];
    const raw = Array.isArray(forwarded) ? forwarded[0] : (forwarded || req.headers.host || '');
    return normalizeHostLike(String(raw).split(',')[0]);
}

export function extractTenantSlugFromHost(host) {
    const normalized = normalizeHostLike(host);
    if (!normalized) return null;
    if (normalized === 'localhost' || /^\d+\.\d+\.\d+\.\d+$/.test(normalized)) return null;

    const parts = normalized.split('.');
    if (parts.length < 3) return null;

    const first = parts[0];
    if (!first || ['www', 'app', 'admin', 'api'].includes(first)) return null;
    return first;
}

async function getTenantColumns() {
    const now = Date.now();
    if (cachedColumns && (now - cachedAt) < COLUMN_CACHE_TTL_MS) {
        return cachedColumns;
    }

    const { rows } = await pool.query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'tenants'
        `
    );

    cachedColumns = new Set((rows || []).map((row) => String(row.column_name || '').toLowerCase()));
    cachedAt = now;
    return cachedColumns;
}

function buildTenantLookupQuery(column) {
    return `
        SELECT id, nome, codigo
        FROM tenants
        WHERE ativo = TRUE
          AND lower(${column}) = lower($1)
        LIMIT 1
    `;
}

export async function resolveTenantFromHost(req) {
    const host = getRequestHost(req);
    if (!host) return null;

    const columns = await getTenantColumns();
    const available = CANDIDATE_COLUMNS.filter((column) => columns.has(column));

    for (const column of available) {
        const direct = await pool.query(buildTenantLookupQuery(column), [host]);
        if (direct.rows[0]) {
            return { ...direct.rows[0], matchedBy: column, host };
        }
    }

    const slug = extractTenantSlugFromHost(host);
    if (!slug) return null;

    for (const column of available) {
        const bySlug = await pool.query(buildTenantLookupQuery(column), [slug]);
        if (bySlug.rows[0]) {
            return { ...bySlug.rows[0], matchedBy: column, host };
        }
    }

    return null;
}

export async function resolveTenantIdForRequest(req) {
    const tenant = await resolveTenantFromHost(req);
    return tenant?.id ?? null;
}

export function isLocalhostRequest(req) {
    const host = getRequestHost(req);
    return !host || host === 'localhost' || host.endsWith('.localhost') || /^\d+\.\d+\.\d+\.\d+$/.test(host);
}
