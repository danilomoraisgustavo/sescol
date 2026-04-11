// server.js
import 'dotenv/config';
import jwt from 'jsonwebtoken';
import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import pool from './db.js';

import zoneamentosRouter from './routes/zoneamentos.js';
import escolasRoutes from './routes/escolas.js';
import pontosParadaRoutes from './routes/pontosParada.js';
import alunosRoutes, { setAlunosIO } from './routes/alunos.js';
import termoCadastroRoutes from './routes/termos.js';
import carteirinhasRoutes from './routes/carteirinhas.js';
import motoristasRoutes from './routes/motorista.js';
import motoristasInternosRoutes from './routes/motoristas-internos.js';
import veiculosInternosRoutes from './routes/veiculos-internos.js';
import monitoresRouter from './routes/monitores.js';
import veiculosRouter from './routes/veiculos.js';
import fornecedoresRoutes from './routes/fornecedores.js';
import brandingRoutes from './routes/branding.js';
import institucionalRoutes from './routes/institucional.js';
import itinerariosRoutes from './routes/itinerarios.js';
import rotasEscolaresRouter from './routes/rotas-escolares.js';
import rotasExclusivasRouter from './routes/rotas-exclusivas.js';
import painelEscolarRouter from './routes/painelEscolar.js';
import adminLoginRoutes from './routes/adminLogin.js';
import loginRoutes from './routes/login.js';
import adminRoutes from './routes/admin.js';
import passwordResetRoutes from './routes/password-reset.js';
import consutarRotasPublicas from './routes/consutarRotas.js';

// IMPORTES NOVOS (middlewares)
import authMiddleware from './middleware/auth.js';
import tenantMiddleware from './middleware/tenant.js';

const app = express();
app.set('trust proxy', 1);

// HTTP server envolvendo o Express (necessário para o socket.io)
const httpServer = createServer(app);

// socket.io
const io = new SocketIOServer(httpServer, {
    cors: {
        origin: process.env.FRONTEND_ORIGIN || '*'
    }
});

// log básico de conexões
io.on('connection', (socket) => {
    console.log('Cliente conectado ao socket.io:', socket.id);
});

// injeta o io dentro do módulo de alunos
setAlunosIO(io);

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Diretórios principais
const PUBLIC_DIR = path.join(__dirname, '..', 'frontend');
const UPLOADS_DIR = path.join(__dirname, 'uploads');

const corsOptions = {
    origin: process.env.FRONTEND_ORIGIN || '*'
};

app.use(cors(corsOptions));
app.use(express.json({ limit: '100mb' }));
app.use(express.urlencoded({ limit: '100mb', extended: true }));

/**
 * ==========================
 *  GUARD DE PÁGINAS (HTML)
 * ==========================
 * Redireciona para login quando:
 * - não há token (Authorization Bearer ou Cookie)
 * - token é inválido/expirado
 *
 * Mantém `?next=` para voltar após login.
 */
function parseCookies(cookieHeader) {
    const cookies = {};
    if (!cookieHeader) return cookies;
    const parts = String(cookieHeader).split(';');
    for (const part of parts) {
        const [k, ...v] = part.trim().split('=');
        if (!k) continue;
        cookies[k] = decodeURIComponent(v.join('=') || '');
    }
    return cookies;
}

function getTokenFromRequest(req) {
    // 1) Authorization: Bearer <token>
    const auth = req.headers.authorization || '';
    const parts = auth.split(' ');
    if (parts[0] === 'Bearer' && parts[1]) return parts[1];

    // 2) Cookie token (funciona mesmo sendo HttpOnly)
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

function requireAuthPage(options = {}) {
    const loginPath = options.loginPath || '/';
    return (req, res, next) => {
        const token = getTokenFromRequest(req);

        const redirectToLogin = () => {
            // tenta limpar cookie do token (se existir)
            try {
                res.clearCookie('setrane_token', { path: '/' });
                res.clearCookie('token', { path: '/' });
                res.clearCookie('authToken', { path: '/' });
                res.clearCookie('access_token', { path: '/' });
                res.clearCookie('jwt', { path: '/' });
                res.clearCookie('accessToken', { path: '/' });
            } catch (_) { }

            const nextUrl = encodeURIComponent(req.originalUrl || '/');
            return res.redirect(`${loginPath}?next=${nextUrl}`);
        };

        if (!token) return redirectToLogin();

        try {
            const secret = process.env.JWT_SECRET;
            if (!secret) throw new Error('JWT_SECRET não definido no .env');
            jwt.verify(token, secret);
            return next();
        } catch (err) {
            return redirectToLogin();
        }
    };
}

function requireRolePage(allowed = [], options = {}) {
    const allow = (allowed || []).map(s => String(s).toUpperCase());
    const loginPath = options.loginPath || '/';
    return (req, res, next) => {
        const token = getTokenFromRequest(req);

        const redirectToLogin = () => {
            try {
                res.clearCookie('setrane_token', { path: '/' });
                res.clearCookie('token', { path: '/' });
                res.clearCookie('authToken', { path: '/' });
                res.clearCookie('access_token', { path: '/' });
                res.clearCookie('jwt', { path: '/' });
                res.clearCookie('accessToken', { path: '/' });
            } catch (_) { }
            const nextUrl = encodeURIComponent(req.originalUrl || '/');
            return res.redirect(`${loginPath}?next=${nextUrl}`);
        };

        if (!token) return redirectToLogin();

        try {
            const secret = process.env.JWT_SECRET;
            if (!secret) throw new Error('JWT_SECRET não definido no .env');
            const payload = jwt.verify(token, secret);
            let cargo = String(payload?.cargo || '').toUpperCase();
            if (!cargo) return redirectToLogin();

            // Normalização: em alguns bancos/cadastros o cargo vem como "FORNECEDOR".
            // Tratamos como equivalente a "FORNECEDOR_ESCOLAR" para compatibilidade.
            if (cargo === 'FORNECEDOR') cargo = 'FORNECEDOR_ESCOLAR';

            if (allow.length && !allow.includes(cargo)) {
                // se é fornecedor tentando acessar página fora do escopo, joga para dashboard
                return res.redirect('/dashboard');
            }
            // expõe cargo/fornecedor para o frontend (opcional)
            res.locals.user = payload;
            return next();
        } catch (err) {
            return redirectToLogin();
        }
    };
}


/**
 * ==========================
 *  LOGOUT (API + PAGE)
 * ==========================
 * - POST /api/logout: encerra "sessão" limpando cookies de token
 * - GET /auth-logout.html: usado pelo menu "Sair" -> limpa cookies e volta para login
 *
 * Observação: JWT é stateless. Para invalidar tokens emitidos antes do expiry,
 * seria preciso blacklist (Redis/DB). Aqui o logout funciona removendo o cookie/token do browser.
 */
app.post('/api/logout', (req, res) => {
    try {
        res.clearCookie('setrane_token', { path: '/' });
        res.clearCookie('token', { path: '/' });
        res.clearCookie('authToken', { path: '/' });
        res.clearCookie('access_token', { path: '/' });
        res.clearCookie('jwt', { path: '/' });
        res.clearCookie('accessToken', { path: '/' });
    } catch (_) { }
    return res.json({ success: true });
});

app.get('/auth-logout.html', (req, res) => {
    try {
        res.clearCookie('setrane_token', { path: '/' });
        res.clearCookie('token', { path: '/' });
        res.clearCookie('authToken', { path: '/' });
        res.clearCookie('access_token', { path: '/' });
        res.clearCookie('jwt', { path: '/' });
        res.clearCookie('accessToken', { path: '/' });
    } catch (_) { }
    return res.redirect('/');
});

app.get('/api/public-config.js', (req, res) => {
    const mapsKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_KEY || '';
    res.type('application/javascript');
    res.setHeader('Cache-Control', 'no-store');
    return res.send(
        `window.APP_PUBLIC_CONFIG = Object.assign({}, window.APP_PUBLIC_CONFIG || {}, ${JSON.stringify({
            googleMapsApiKey: mapsKey,
        })});
window.GOOGLE_MAPS_API_KEY = window.APP_PUBLIC_CONFIG.googleMapsApiKey || '';
window.GMAPS_KEY = window.APP_PUBLIC_CONFIG.googleMapsApiKey || '';`
    );
});

/**
 * ==========================
 *  ARQUIVOS ESTÁTICOS
 * ==========================
 */

// Arquivos estáticos do frontend (HTML, CSS, JS, imagens da UI)
app.use(express.static(PUBLIC_DIR));

// Pasta específica para uploads de branding (logos, brasões etc.)
app.use(
    '/uploads/branding',
    express.static(path.join(UPLOADS_DIR, 'branding'))
);

// Compatibilidade para branding legado
app.use(
    '/arquivos/branding',
    express.static(path.join(UPLOADS_DIR, 'branding'))
);

/**
 * Fallback: alguns registros antigos salvaram apenas o nome do arquivo (sem subpasta),
 * ex.: /arquivos/1746622537662-714782508.pdf
 * Nesse caso, procuramos o arquivo dentro das subpastas de uploads e servimos se existir.
 */
function sanitizeRelativeUploadPath(value) {
    const raw = String(value || '').replace(/^\/+/, '').trim();
    if (!raw || raw.includes('\0')) return null;

    const normalized = path.posix.normalize(raw.replace(/\\/g, '/'));
    if (!normalized || normalized === '.' || normalized.startsWith('../') || normalized.includes('/../')) {
        return null;
    }

    return normalized;
}

function buildUploadCandidates(relativePath) {
    const normalized = sanitizeRelativeUploadPath(relativePath);
    if (!normalized) return [];

    const basename = path.posix.basename(normalized);
    const explicit = path.join(UPLOADS_DIR, normalized);
    const candidates = [explicit];

    if (normalized === basename) {
        const commonDirs = [
            'cnh',
            'certificados_motoristas',
            'certificados_monitores',
            'motoristas_documentos',
            'monitores_documentos',
            'veiculos_documentos',
            'veiculos_alvaras',
            'motoristas_internos',
            'veiculos_internos',
        ];
        for (const dir of commonDirs) {
            candidates.push(path.join(UPLOADS_DIR, dir, basename));
        }
    }

    return [...new Set(candidates)];
}

async function canAccessUploadForTenant(tenantId, relativePath) {
    const normalized = sanitizeRelativeUploadPath(relativePath);
    if (!normalized) return false;

    const normalizedLike = `%${normalized}`;
    const basenameLike = `%/${path.posix.basename(normalized)}`;
    const checks = [
        `SELECT 1 FROM motoristas WHERE tenant_id = $1 AND regexp_replace(COALESCE(arquivo_cnh_path,''), '\\\\', '/', 'g') LIKE $2 LIMIT 1`,
        `SELECT 1 FROM motoristas_cursos WHERE tenant_id = $1 AND regexp_replace(COALESCE(arquivo_path,''), '\\\\', '/', 'g') LIKE $2 LIMIT 1`,
        `SELECT 1 FROM monitores WHERE tenant_id = $1 AND regexp_replace(COALESCE(documento_pessoal_path,''), '\\\\', '/', 'g') LIKE $2 LIMIT 1`,
        `SELECT 1 FROM monitores_cursos WHERE tenant_id = $1 AND regexp_replace(COALESCE(arquivo_path,''), '\\\\', '/', 'g') LIKE $2 LIMIT 1`,
        `SELECT 1 FROM veiculos WHERE tenant_id = $1 AND (regexp_replace(COALESCE(documento_path,''), '\\\\', '/', 'g') LIKE $2 OR regexp_replace(COALESCE(alvara_path,''), '\\\\', '/', 'g') LIKE $2) LIMIT 1`,
        `SELECT 1 FROM motoristas_internos_documentos WHERE tenant_id = $1 AND regexp_replace(COALESCE(caminho_arquivo,''), '\\\\', '/', 'g') LIKE $2 LIMIT 1`,
        `SELECT 1 FROM veiculos_internos_documentos WHERE tenant_id = $1 AND regexp_replace(COALESCE(caminho_arquivo,''), '\\\\', '/', 'g') LIKE $2 LIMIT 1`,
    ];

    for (const sql of checks) {
        try {
            const direct = await pool.query(sql, [tenantId, normalizedLike]);
            if (direct.rowCount) return true;

            const byBasename = await pool.query(sql, [tenantId, basenameLike]);
            if (byBasename.rowCount) return true;
        } catch (err) {
            const code = String(err?.code || '');
            if (code === '42P01' || code === '42703') {
                continue;
            }
            throw err;
        }
    }

    return false;
}

async function serveProtectedUpload(req, res, next) {
    try {
        const tenantId = Number(req.tenantId ?? req.user?.tenant_id);
        if (!Number.isFinite(tenantId) || tenantId <= 0) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        const wildcardPart = String(req.params[0] || req.params.filename || '');
        const relativePath = sanitizeRelativeUploadPath(wildcardPart);
        if (!relativePath) {
            return res.status(400).send('Arquivo inválido');
        }

        const authorized = await canAccessUploadForTenant(tenantId, relativePath);
        if (!authorized) {
            return res.status(404).send('Arquivo não encontrado');
        }

        const candidates = buildUploadCandidates(relativePath);
        for (const full of candidates) {
            if (!full.startsWith(UPLOADS_DIR)) continue;
            if (fs.existsSync(full) && fs.statSync(full).isFile()) {
                return res.sendFile(full);
            }
        }

        return res.status(404).send('Arquivo não encontrado');
    } catch (e) {
        console.error('Erro ao servir upload protegido:', e);
        return next();
    }
}

app.get('/uploads/*', authMiddleware, tenantMiddleware, serveProtectedUpload);
app.get('/arquivos/*', authMiddleware, tenantMiddleware, serveProtectedUpload);
app.get('/arquivos/:filename', authMiddleware, tenantMiddleware, serveProtectedUpload);
/**
 * ==========================
 *  ROTAS DE API (JSON)
 * ==========================
 */

// Rotas públicas (SEM auth) – deve vir ANTES de qualquer app.use('/api', ...) que tenha catch-all
app.use('/api/public', consutarRotasPublicas);
// Rotas de login
app.use('/api', adminLoginRoutes);
app.use('/api', loginRoutes);


// Quem sou eu (para o frontend ajustar o menu/aside)
app.get('/api/me', authMiddleware, tenantMiddleware, (req, res) => {
    const u = req.user || {};
    return res.json({
        id: u.id ?? null,
        tenant_id: u.tenant_id ?? null,
        nome: u.nome ?? null,
        email: u.email ?? null,
        cargo: u.cargo ?? null,
        fornecedor_id: u.fornecedor_id ?? null,
        profiles: Array.isArray(u.profiles) ? u.profiles : [],
        permissions: Array.isArray(u.permissions) ? u.permissions : []
    });
});

// Proxy para consulta de CEP (ViaCEP)
// Motivo: chamadas diretas do browser para https://viacep.com.br sofrem CORS e/ou 502.
// Com o proxy, o frontend chama o mesmo domínio (/api/cep/:cep) e não é bloqueado pelo CORS do navegador.
app.get('/api/cep/:cep', authMiddleware, tenantMiddleware, async (req, res) => {
    const cep = String(req.params.cep || '').replace(/\D/g, '');
    if (!cep || cep.length !== 8) {
        return res.status(400).json({ error: 'CEP inválido' });
    }

    const url = `https://viacep.com.br/ws/${cep}/json/`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 6000);

    try {
        const r = await fetch(url, {
            signal: controller.signal,
            headers: {
                'Accept': 'application/json'
            }
        });

        if (!r.ok) {
            return res.status(502).json({ error: 'ViaCEP indisponível', status: r.status });
        }

        const data = await r.json();
        res.setHeader('Cache-Control', 'public, max-age=300');
        return res.json(data);
    } catch (err) {
        const msg = (err && err.name === 'AbortError') ? 'Timeout ao consultar ViaCEP' : 'Falha ao consultar ViaCEP';
        return res.status(502).json({ error: msg });
    } finally {
        clearTimeout(timeout);
    }
});

// Rotas ADMIN (protegidas)
app.use('/api/admin', authMiddleware, tenantMiddleware, adminRoutes);

// Rotas "normais" de negócio
app.use('/api/zoneamentos', authMiddleware, tenantMiddleware, zoneamentosRouter);
app.use('/api/escolas', authMiddleware, tenantMiddleware, escolasRoutes);
app.use('/api/pontos-parada', authMiddleware, tenantMiddleware, pontosParadaRoutes);
app.use('/api/alunos', authMiddleware, tenantMiddleware, alunosRoutes);
app.use('/api/termo-cadastro', authMiddleware, tenantMiddleware, termoCadastroRoutes);
app.use('/api/carteirinhas', authMiddleware, tenantMiddleware, carteirinhasRoutes);
app.use('/api/motoristas', authMiddleware, tenantMiddleware, motoristasRoutes);
app.use('/api/interno/motoristas', authMiddleware, tenantMiddleware, motoristasInternosRoutes);
app.use('/api/interno/veiculos', authMiddleware, tenantMiddleware, veiculosInternosRoutes);
app.use('/api/monitores', authMiddleware, tenantMiddleware, monitoresRouter);
app.use('/api/veiculos', authMiddleware, tenantMiddleware, veiculosRouter);
app.use('/api/fornecedores', authMiddleware, tenantMiddleware, fornecedoresRoutes);
app.use('/api/itinerarios', authMiddleware, tenantMiddleware, itinerariosRoutes);
app.use('/api/institucional', authMiddleware, tenantMiddleware, institucionalRoutes);
app.use('/api/rotas-escolares', authMiddleware, tenantMiddleware, rotasEscolaresRouter);
app.use('/api/rotas-exclusivas', authMiddleware, tenantMiddleware, rotasExclusivasRouter);
app.use('/api', painelEscolarRouter);
app.use('/api', passwordResetRoutes);
// Configuração de branding (protegia por auth + tenant)
app.use('/api/config/branding', authMiddleware, tenantMiddleware, brandingRoutes);

/**
 * ==========================
 *  ROTAS DE PÁGINAS (HTML)
 * ==========================
 */

app.get('/', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'login-cadastro.html'));
});

app.get('/login', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'login-cadastro.html'));
});

app.get('/recuperacao-senha', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'redefinir-senha.html'));
});

// Login administrativo
app.get('/admin-login', (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'admin-login.html'));
});

// Painel administrativo
app.get('/admin/painel', requireAuthPage({ loginPath: '/admin-login' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'admin', 'painel-admin.html'));
});

// Painel principal escolar
app.get('/dashboard', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO', 'FORNECEDOR_ESCOLAR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'painel.html'));
});

// Cadastros escolares
app.get('/zoneamentos', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'zoneamentos.html'));
});

app.get('/escolas', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escolas.html'));
});

app.get('/institucional/servidores', requireRolePage(['ADMIN', 'GESTOR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'institucional', 'servidores.html'));
});

app.get('/institucional/disciplinas', requireRolePage(['ADMIN', 'GESTOR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'institucional', 'disciplinas.html'));
});

app.get('/institucional/series', requireRolePage(['ADMIN', 'GESTOR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'institucional', 'series.html'));
});

app.get('/institucional/turnos', requireRolePage(['ADMIN', 'GESTOR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'institucional', 'turnos.html'));
});

app.get('/institucional/calendarios-letivos', requireRolePage(['ADMIN', 'GESTOR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'institucional', 'calendarios-letivos.html'));
});

app.get('/institucional/periodos-letivos', requireRolePage(['ADMIN', 'GESTOR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'institucional', 'periodos-letivos.html'));
});

app.get('/institucional/turmas', requireRolePage(['ADMIN', 'GESTOR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'institucional', 'turmas.html'));
});

app.get('/institucional/parametros-gerais', requireRolePage(['ADMIN', 'GESTOR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'institucional', 'parametros-gerais.html'));
});

app.get('/escolas/:id/dashboard', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    return res.redirect(`/escolar/escola/${req.params.id}/dashboard`);
});

app.get('/escolar/escola/:id/dashboard', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'dashboard.html'));
});

app.get('/escolar/escola/:id/turmas', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'turmas.html'));
});

app.get('/escolar/escola/:id/alunos', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'alunos.html'));
});

app.get('/escolar/escola/:id/matriculas', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'matriculas.html'));
});

app.get('/escolar/escola/:id/diario-classe', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'diario-classe.html'));
});

app.get('/escolar/escola/:id/notas-componentes', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'notas-componentes.html'));
});

app.get('/escolar/escola/:id/rematriculas', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'rematriculas.html'));
});

app.get('/escolar/escola/:id/enturmacao', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'enturmacao.html'));
});

app.get('/escolar/escola/:id/transferencias', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'transferencias.html'));
});

app.get('/escolar/escola/:id/conselho-classe', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'conselho-classe.html'));
});

app.get('/escolar/escola/:id/fechamentos', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'fechamentos.html'));
});

app.get('/escolar/escola/:id/historico-escolar', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'historico-escolar.html'));
});

app.get('/escolar/escola/:id/documentos', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'documentos.html'));
});

app.get('/escolar/escola/:id/ocorrencias', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'ocorrencias.html'));
});

app.get('/escolar/escola/:id/relatorios', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'escola', 'relatorios.html'));
});

app.get('/pontos-parada', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(
        path.join(PUBLIC_DIR, 'pages', 'escolar', 'pontos-parada.html')
    );
});

app.get('/alunos', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'alunos.html'));
});

app.get('/alunos-mapa', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'alunos-mapa.html'));
});

app.get('/selecao-unidade', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    return res.sendFile(path.join(PUBLIC_DIR, 'selecao-unidade.html'));
});

app.get('/seguranca', requireRolePage(['ADMIN', 'GESTOR'], { loginPath: '/' }), (req, res) => {
    return res.redirect('/sistema/configuracoes?aba=usuarios');
});

app.get('/seguranca/usuarios', requireRolePage(['ADMIN', 'GESTOR'], { loginPath: '/' }), (req, res) => {
    return res.redirect('/sistema/configuracoes?aba=usuarios');
});

app.get('/seguranca/perfis', requireRolePage(['ADMIN', 'GESTOR'], { loginPath: '/' }), (req, res) => {
    return res.redirect('/sistema/configuracoes?aba=perfis');
});

app.get('/seguranca/logs-acesso', requireRolePage(['ADMIN', 'GESTOR'], { loginPath: '/' }), (req, res) => {
    return res.redirect('/sistema/configuracoes?aba=logs');
});

app.get('/seguranca/configuracoes', requireRolePage(['ADMIN', 'GESTOR'], { loginPath: '/' }), (req, res) => {
    return res.redirect('/sistema/configuracoes?aba=seguranca');
});

// Operação: motoristas
app.get(
    '/motoristas',
    requireRolePage(['ADMIN', 'GESTOR', 'USUARIO', 'FORNECEDOR_ESCOLAR'], { loginPath: '/' }),
    (req, res) => {
        res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'motoristas.html'));
    }
);

// Operação: motoristas (interno)
app.get(
    '/interno/motoristas',
    requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }),
    (req, res) => {
        res.sendFile(path.join(PUBLIC_DIR, 'pages', 'interno', 'motoristas.html'));
    }
);

// Operação: veículos (interno)
app.get(
    '/interno/veiculos',
    requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }),
    (req, res) => {
        res.sendFile(path.join(PUBLIC_DIR, 'pages', 'interno', 'veiculos.html'));
    }
);

app.get('/monitores', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO', 'FORNECEDOR_ESCOLAR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'monitores.html'));
});

app.get('/veiculos', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO', 'FORNECEDOR_ESCOLAR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'veiculos.html'));
});

app.get('/fornecedores', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'fornecedores.html'));
});

// Rotas escolares (novas páginas)
// Mantém /rotas-escolares por compatibilidade, mas aponta para "Rotas Municipais"
app.get('/rotas-escolares', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO', 'FORNECEDOR_ESCOLAR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'rotas-municipais.html'));
});

app.get('/rotas-municipais', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO', 'FORNECEDOR_ESCOLAR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'rotas-municipais.html'));
});

app.get('/rotas-exclusivas', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO', 'FORNECEDOR_ESCOLAR'], { loginPath: '/' }), (req, res) => {
    res.sendFile(path.join(PUBLIC_DIR, 'pages', 'escolar', 'rotas-exclusivas.html'));
});

app.get('/rotas-estaduais', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO', 'FORNECEDOR_ESCOLAR'], { loginPath: '/' }), (req, res) => {
    return res.redirect('/rotas-municipais');
});

// NOVA PÁGINA: Configurações do sistema / branding
app.get('/sistema/configuracoes', requireRolePage(['ADMIN', 'GESTOR', 'USUARIO'], { loginPath: '/' }), (req, res) => {
    res.sendFile(
        path.join(PUBLIC_DIR, 'pages', 'sistema', 'configuracoes.html')
    );
});

const PORT = process.env.PORT || 3000;

httpServer.listen(PORT, () => {
    console.log(`API SETRANE Express rodando na porta ${PORT}`);
    console.log(`Frontend em: ${PUBLIC_DIR}`);
    console.log(`Uploads em:  ${UPLOADS_DIR}`);
});
