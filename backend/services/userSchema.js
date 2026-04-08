import pool from '../db.js';

let cachedColumns = null;
let cachedAt = 0;

const CACHE_TTL_MS = 5 * 60 * 1000;

async function getUsuarioColumns() {
    const now = Date.now();
    if (cachedColumns && (now - cachedAt) < CACHE_TTL_MS) {
        return cachedColumns;
    }

    const { rows } = await pool.query(
        `
        SELECT column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'usuarios'
        `
    );

    cachedColumns = new Set((rows || []).map((row) => String(row.column_name || '').toLowerCase()));
    cachedAt = now;
    return cachedColumns;
}

export async function getUsuarioSelectFields(alias = 'u') {
    const cols = await getUsuarioColumns();
    const base = [
        `${alias}.id`,
        `${alias}.tenant_id`,
        `${alias}.nome`,
        `${alias}.email`,
        `${alias}.senha_hash`,
        `${alias}.cargo::text AS cargo`,
        `${alias}.init`,
        `${alias}.ativo`,
    ];

    if (cols.has('fornecedor_id')) {
        base.push(`${alias}.fornecedor_id`);
    } else {
        base.push(`NULL::bigint AS fornecedor_id`);
    }

    return base.join(', ');
}
