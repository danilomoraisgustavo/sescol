// backend/db.js
import dotenv from 'dotenv';
import path from 'path';
import { fileURLToPath } from 'url';
import pkg from 'pg';

const { Pool } = pkg;

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Carrega o .env do backend
dotenv.config({
    path: path.join(__dirname, '.env'),
});

// Validação mínima (falha rápido se algo estiver errado)
if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL não definida no .env');
}

function shouldUseSSL() {
    const pgssl = String(process.env.PGSSL || '').toLowerCase();
    const dbssl = String(process.env.DATABASE_SSL || '').toLowerCase();
    const mode = String(process.env.PGSSLMODE || '').toLowerCase();
    const cs = String(process.env.DATABASE_URL || '');

    if (pgssl === 'true' || pgssl === '1') return true;
    if (dbssl === 'true' || dbssl === '1') return true;
    if (['require', 'verify-ca', 'verify-full'].includes(mode)) return true;
    if (cs.toLowerCase().includes('sslmode=require')) return true;

    const host = String(process.env.PGHOST || '');
    if (host && host !== 'localhost' && host !== '127.0.0.1') return true;

    return false;
}

const useSSL = shouldUseSSL();

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
    console.error('🔴 Erro inesperado no PostgreSQL', err);
    process.exit(1);
});

export default pool;
