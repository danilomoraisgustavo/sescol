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

const useSSL = (process.env.PGSSL || '').toLowerCase() === 'true';

const pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: useSSL ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
    console.error('🔴 Erro inesperado no PostgreSQL', err);
    process.exit(1);
});

export default pool;
