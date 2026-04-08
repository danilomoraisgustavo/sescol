import express from "express";
import multer from "multer";
import xlsx from "xlsx";
import pool from "../db.js";

import authMiddleware from "../middleware/auth.js";
import tenantMiddleware from "../middleware/tenant.js";

import PDFDocument from "pdfkit";
import { getBranding, drawCabecalho, drawRodape } from "../services/brandingConfig.js";

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const router = express.Router();
let alunosColumnSupportCache = null;
let alunosColumnSupportCacheAt = 0;
const ALUNOS_COLUMN_CACHE_TTL_MS = 5 * 60 * 1000;

// Multi-tenant security: tenantId MUST come from validated JWT/cookie.
router.use(authMiddleware, tenantMiddleware);

// socket.io removido neste módulo (mantido setAlunosIO como no-op para compatibilidade)
export function setAlunosIO(io) { /* no-op */ }

// Sinal simples de versão por tenant (para auto-refresh leve no front)
const __tenantVersion = new Map();
function __bumpVersion(tenantId) {
    __tenantVersion.set(Number(tenantId), Date.now());
}
function __getVersion(tenantId) {
    return __tenantVersion.get(Number(tenantId)) || 0;
}

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 50 * 1024 * 1024 }
});

const ESCOLA_PREFIXES = ["EMEF", "EMEB", "EMEIF", "EEEM", "NEI", "CMEJA"];

function normalize(str) {
    if (!str) return "";
    return String(str)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toUpperCase();
}


// Normalização leve para buscas (sem acento, sem pontuação, espaço único, minúsculo)
function normalizeForSearch(str) {
    if (!str) return "";
    return String(str)
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/[^\w\s]/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .toLowerCase();
}

// SQL expression para busca "accent-insensitive" sem depender de extensão unaccent.
// Obs.: faz translate dos acentos mais comuns + limpa pontuação e espaços repetidos.
function sqlNormalizeExpr(sqlExpr) {
    // IMPORTANTE: sqlExpr deve ser um trecho SQL (ex.: 'a.pessoa_nome'), NÃO um valor do usuário.
    // Remove acentos via TRANSLATE (sem depender de extensão unaccent), limpa pontuação, colapsa espaços e faz TRIM.
    // Usa classes POSIX para evitar problemas de escape ([:space:]) no JS -> SQL.
    const from = "ÁÀÂÃÄáàâãäÉÈÊËéèêëÍÌÎÏíìîïÓÒÔÕÖóòôõöÚÙÛÜúùûüÇçÑñ";
    const to = "AAAAAaaaaaEEEEeeeeIIIIiiiiOOOOOoooooUUUUuuuuCcNn";

    return `TRIM(REGEXP_REPLACE(REGEXP_REPLACE(LOWER(TRANSLATE(COALESCE(${sqlExpr}, ''), '${from}', '${to}')), '[^a-z0-9[:space:]]', ' ', 'g'), '[[:space:]]+', ' ', 'g'))`;
}


function requireTenantId(req) {
    const n = Number(req.tenantId ?? req.user?.tenant_id);
    if (!Number.isFinite(n) || n <= 0) {
        const err = new Error("tenant_id ausente no contexto autenticado");
        err.statusCode = 401;
        throw err;
    }
    return n;
}

// Exec a query (strict): no fallback without tenant filter.
async function queryStrict(clientOrPool, sql, params) {
    return await clientOrPool.query(sql, params);
}

// Exec a query with tenant filter when possible; fallback for legacy tables without tenant_id.
async function queryWithOptionalTenant(clientOrPool, sqlTenant, paramsTenant, sqlNoTenant, paramsNoTenant) {
    try {
        return await clientOrPool.query(sqlTenant, paramsTenant);
    } catch (err) {
        const code = err?.code;
        const msg = String(err?.message || "").toLowerCase();

        const tenantMissing =
            code === "42703" || // undefined_column
            code === "42P01" || // undefined_table
            msg.includes("tenant_id") ||
            msg.includes("undefined column") ||
            msg.includes("does not exist");

        if (!tenantMissing) throw err;
        const statement = String(sqlTenant || '').trim().split(/\s+/)[0]?.toUpperCase();
        if (statement && statement !== 'SELECT') {
            const blocked = new Error('Operação bloqueada por segurança: a tabela/coluna tenant_id é obrigatória para escrita.');
            blocked.statusCode = 500;
            throw blocked;
        }
        return await clientOrPool.query(sqlNoTenant, paramsNoTenant);
    }
}

async function getAlunosColumnSupport() {
    const now = Date.now();
    if (alunosColumnSupportCache && (now - alunosColumnSupportCacheAt) < ALUNOS_COLUMN_CACHE_TTL_MS) {
        return alunosColumnSupportCache;
    }

    const tables = ['alunos_municipais', 'alunos_escolas', 'escolas'];
    const { rows } = await pool.query(
        `
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        `,
        [tables]
    );

    const grouped = {};
    for (const row of rows || []) {
        grouped[row.table_name] = grouped[row.table_name] || new Set();
        grouped[row.table_name].add(row.column_name);
    }

    alunosColumnSupportCache = {
        alunosMunicipaisTenantId: grouped.alunos_municipais?.has('tenant_id') || false,
        alunosMunicipaisRotaExclusiva: grouped.alunos_municipais?.has('rota_exclusiva') || false,
        alunosMunicipaisCarroAdaptado: grouped.alunos_municipais?.has('carro_adaptado') || false,
        alunosMunicipaisTurnoSimplificado: grouped.alunos_municipais?.has('turno_simplificado') || false,
        alunosMunicipaisLocalizacao: grouped.alunos_municipais?.has('localizacao') || false,
        alunosEscolasTenantId: grouped.alunos_escolas?.has('tenant_id') || false,
        escolasTenantId: grouped.escolas?.has('tenant_id') || false,
    };
    alunosColumnSupportCacheAt = now;
    return alunosColumnSupportCache;
}


function normalizeCpf(cpf) {
    if (!cpf) return null;
    const digits = String(cpf).replace(/\D/g, "");
    return digits || null;
}

// Query helper: interpreta booleanos em querystring
function parseBoolQuery(v) {
    if (v === undefined || v === null) return false;
    if (typeof v === "boolean") return v;
    const s = String(v).trim().toLowerCase();
    return ["1", "true", "t", "yes", "y", "sim", "s"].includes(s);
}

function canViewSensitive(req) {
    // Default deny. Allow only for privileged roles.
    const role = String(req.user?.role || req.user?.papel || "").toLowerCase();
    if (role.includes("admin") || role.includes("gestor") || role.includes("owner")) return true;

    // Optional: explicit permission flags, if your auth middleware provides them
    const perms = req.user?.permissions || req.user?.permissoes || [];
    if (Array.isArray(perms) && perms.map(String).some(p => p.toLowerCase().includes("sensitive") || p.toLowerCase().includes("cpf"))) {
        return true;
    }
    return false;
}

function shiftSqlPlaceholders(sql, offset) {
    if (!offset) return sql;
    return String(sql).replace(/\$(\d+)/g, (_, num) => `$${Math.max(1, Number(num) - offset)}`);
}

function maskCpf(cpf) {
    const digits = normalizeCpf(cpf);
    if (!digits || digits.length !== 11) return null;
    return `***.***.***-${digits.slice(-2)}`;
}

function last2Cpf(cpf) {
    const digits = normalizeCpf(cpf);
    if (!digits || digits.length < 2) return null;
    return digits.slice(-2);
}

function formatHistoricoTipo(tipo) {
    const raw = String(tipo || '').trim().toUpperCase();
    const mapa = {
        MATRICULA: 'Matrícula',
        ATUALIZACAO_MATRICULA: 'Atualização de matrícula',
        TRANSFERENCIA_SAIDA: 'Transferência de saída',
        TRANSFERENCIA_ENTRADA: 'Transferência de entrada'
    };
    return mapa[raw] || raw || 'Movimentação';
}

function levenshtein(a, b) {
    if (a === b) return 0;
    if (!a) return b.length;
    if (!b) return a.length;

    const m = a.length;
    const n = b.length;
    const dp = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));

    for (let i = 0; i <= m; i++) dp[i][0] = i;
    for (let j = 0; j <= n; j++) dp[0][j] = j;

    for (let i = 1; i <= m; i++) {
        for (let j = 1; j <= n; j++) {
            const cost = a[i - 1] === b[j - 1] ? 0 : 1;
            dp[i][j] = Math.min(
                dp[i - 1][j] + 1,         // delete
                dp[i][j - 1] + 1,         // insert
                dp[i - 1][j - 1] + cost   // replace
            );
        }
    }
    return dp[m][n];
}

/**
 * Compara duas strings de escola/unidade de ensino de forma robusta:
 * - remove acentos/pontuação e normaliza espaços (normalize())
 * - tolera pequenas diferenças (typos leves) via Levenshtein
 * Retorna true se considerar que "mudou de escola" de fato.
 */
function escolaMudou(unidadeAtual, unidadeNova) {
    const a = normalize(unidadeAtual);
    const b = normalize(unidadeNova);

    if (!a && !b) return false;
    if (!a || !b) return true;

    if (a === b) return false;

    const dist = levenshtein(a, b);
    const maxLen = Math.max(a.length, b.length);
    const ratio = maxLen ? dist / maxLen : 1;

    // Até ~12% de diferença ainda consideramos "mesma escola" (ajuste fino).
    return ratio > 0.12;
}


function sanitizeField(value) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    if (!s) return null;
    return s;
}


function parseDateFlexible(value) {
    // Accepts: JS Date, Excel serial number, 'DD/MM/YYYY', 'YYYY-MM-DD', 'DD-MM-YYYY', 'YYYY/MM/DD'
    if (value === undefined || value === null) return null;

    // If already a Date
    if (value instanceof Date && !Number.isNaN(value.valueOf())) {
        return value;
    }

    // Excel serial date (number)
    if (typeof value === "number" && Number.isFinite(value)) {
        // Excel's epoch starts 1899-12-30 in practice for JS conversions (accounts for Excel leap-year bug)
        const excelEpoch = new Date(Date.UTC(1899, 11, 30));
        const ms = value * 86400 * 1000;
        const d = new Date(excelEpoch.getTime() + ms);
        return Number.isNaN(d.valueOf()) ? null : d;
    }

    const s = String(value).trim();
    if (!s) return null;

    // Try ISO first
    const iso = new Date(s);
    if (!Number.isNaN(iso.valueOf()) && /\d{4}-\d{2}-\d{2}/.test(s)) {
        return iso;
    }

    // dd/mm/yyyy or dd-mm-yyyy
    const m1 = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
    if (m1) {
        const dd = Number(m1[1]);
        const mm = Number(m1[2]);
        const yyyy = Number(m1[3]);
        if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
            const d = new Date(Date.UTC(yyyy, mm - 1, dd));
            return Number.isNaN(d.valueOf()) ? null : d;
        }
    }

    // yyyy/mm/dd
    const m2 = s.match(/^(\d{4})[\/\-](\d{1,2})[\/\-](\d{1,2})$/);
    if (m2) {
        const yyyy = Number(m2[1]);
        const mm = Number(m2[2]);
        const dd = Number(m2[3]);
        if (dd >= 1 && dd <= 31 && mm >= 1 && mm <= 12) {
            const d = new Date(Date.UTC(yyyy, mm - 1, dd));
            return Number.isNaN(d.valueOf()) ? null : d;
        }
    }

    return null;
}


function parseBigIntFlexible(value) {
    if (value === undefined || value === null) return null;
    if (typeof value === "number") {
        if (!Number.isFinite(value)) return null;
        const n = Math.trunc(value);
        return Number.isFinite(n) ? n : null;
    }
    const s = String(value).trim();
    if (!s) return null;

    // Keep digits only (handles values like "12.345", "12,345", "INEP: 123")
    const digits = s.replace(/\D+/g, "");
    if (!digits) return null;

    const n = Number(digits);
    if (!Number.isFinite(n)) return null;
    return Math.trunc(n);
}


function normalizeDigits(value, maxLen) {
    if (value === undefined || value === null) return null;
    const s = String(value).trim();
    if (!s) return null;
    const digits = s.replace(/\D+/g, "");
    if (!digits) return null;
    if (maxLen && digits.length > maxLen) return digits.slice(0, maxLen);
    return digits;
}




async function carregarEscolasCache(tenantId) {
    const sqlTenant = `
        SELECT id, nome
        FROM escolas
        WHERE tenant_id = $1;
    `;
    const sqlNoTenant = `
        SELECT id, nome
        FROM escolas;
    `;

    const result = await queryWithOptionalTenant(
        pool,
        sqlTenant,
        [tenantId],
        sqlNoTenant,
        []
    );

    const escolas = result.rows || [];
    const map = new Map();

    escolas.forEach((e) => {
        const key = normalize(e.nome);
        if (key) {
            map.set(key, e);
        }
    });

    return map;
}


async function carregarAlunosCache(tenantId) {
    const sqlTenant = `
        SELECT id, cpf, id_pessoa, unidade_ensino, tenant_id
        FROM alunos_municipais
        WHERE tenant_id = $1;
    `;
    const sqlNoTenant = `
        SELECT id, cpf, id_pessoa, unidade_ensino
        FROM alunos_municipais;
    `;

    const result = await queryWithOptionalTenant(
        pool,
        sqlTenant,
        [tenantId],
        sqlNoTenant,
        []
    );

    const alunos = result.rows || [];

    const byCpf = new Map();
    const byIdPessoa = new Map();
    const all = [];

    alunos.forEach((a) => {
        const cpfNorm = normalizeCpf(a.cpf);
        const idPessoaNorm =
            a.id_pessoa !== null && a.id_pessoa !== undefined
                ? String(a.id_pessoa).trim()
                : null;

        const payload = {
            id: a.id,
            cpf: a.cpf,
            id_pessoa: a.id_pessoa,
            unidade_ensino: a.unidade_ensino,
            tenant_id: a.tenant_id ?? null
        };

        all.push(payload);

        if (cpfNorm) byCpf.set(cpfNorm, payload);
        if (idPessoaNorm) byIdPessoa.set(idPessoaNorm, payload);
    });

    return { byCpf, byIdPessoa, all };
}


function encontrarEscolaPorUnidade(unidadePlanilha, escolasMap) {
    const base = normalize(unidadePlanilha);
    if (!base) return null;

    for (const prefix of ESCOLA_PREFIXES) {
        const candidato = `${prefix} ${base}`;
        const key = normalize(candidato);
        if (escolasMap.has(key)) {
            return escolasMap.get(key);
        }
    }

    if (escolasMap.has(base)) {
        return escolasMap.get(base);
    }

    return null;
}

/**
 * GET /api/alunos
 * Lista paginada de alunos com busca.
 */
router.get("/", async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const columnSupport = await getAlunosColumnSupport();

        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limitReq = parseInt(req.query.limit, 10) || 20;
        const limit = Math.min(Math.max(limitReq, 1), 100);
        const offset = (page - 1) * limit;

        const qRaw = (req.query.q || "").trim();

        // Busca por CPF deve funcionar mesmo com CPF mascarado no front.
        // Também aceitamos busca por nome/escola/turma ignorando acentuação (ex.: "Joao" encontra "João", "c" encontra "ç").
        const qLikeRaw = qRaw ? `%${qRaw}%` : null;
        const qNorm = qRaw ? normalizeForSearch(qRaw) : "";
        const qLikeNorm = qNorm ? `%${qNorm}%` : null;
        const qDigits = qRaw ? String(qRaw).replace(/\D/g, "") : "";
        const qLikeDigits = qDigits ? `%${qDigits}%` : null;

        const params = [];
        let idx = 1;
        const whereParts = [];

        if (columnSupport.alunosMunicipaisTenantId) {
            whereParts.push("a.tenant_id = $1");
            params.push(tenantId);
            idx = 2;
        }

        // Filtros extras: somente alunos com transporte exclusivo / carro adaptado
        // (booleanos na query) ?only_exclusivo=1  ?only_adaptado=1
        const onlyExclusivo = parseBoolQuery(req.query.only_exclusivo);
        const onlyAdaptado = parseBoolQuery(req.query.only_adaptado);
        if (onlyExclusivo) {
            if (columnSupport.alunosMunicipaisRotaExclusiva) {
                whereParts.push("COALESCE(a.rota_exclusiva, false) = true");
            } else {
                whereParts.push("false");
            }
        }
        if (onlyAdaptado) {
            if (columnSupport.alunosMunicipaisCarroAdaptado) {
                whereParts.push("COALESCE(a.carro_adaptado, false) = true");
            } else {
                whereParts.push("false");
            }
        }

        if (qLikeRaw || qLikeNorm || qLikeDigits) {
            const parts = [];

            // Busca clássica (rápida) - mantém comportamento antigo
            if (qLikeRaw) {
                parts.push(`
            (
              a.pessoa_nome ILIKE $${idx}
              OR a.cpf ILIKE $${idx}
              OR a.unidade_ensino ILIKE $${idx}
              OR a.turma ILIKE $${idx}
              OR a.ano ILIKE $${idx}
              OR a.status ILIKE $${idx}
              OR e.nome ILIKE $${idx}
            )
        `);
                params.push(qLikeRaw);
                idx++;
            }

            // Busca sem acentos/pontuação (robusta)
            if (qLikeNorm) {
                const nPessoa = sqlNormalizeExpr("a.pessoa_nome");
                const nCpf = sqlNormalizeExpr("a.cpf");
                const nUnidade = sqlNormalizeExpr("a.unidade_ensino");
                const nTurma = sqlNormalizeExpr("a.turma");
                const nAno = sqlNormalizeExpr("a.ano");
                const nStatus = sqlNormalizeExpr("a.status");
                const nEscola = sqlNormalizeExpr("e.nome");

                parts.push(`
            (
              ${nPessoa} LIKE $${idx}
              OR ${nCpf} LIKE $${idx}
              OR ${nUnidade} LIKE $${idx}
              OR ${nTurma} LIKE $${idx}
              OR ${nAno} LIKE $${idx}
              OR ${nStatus} LIKE $${idx}
              OR ${nEscola} LIKE $${idx}
            )
        `);
                params.push(qLikeNorm);
                idx++;
            }

            // Busca por CPF digitado (apenas números), independente de pontuação/mascara
            if (qLikeDigits && qDigits.length >= 3) {
                parts.push(`(REGEXP_REPLACE(COALESCE(a.cpf,''), '[^0-9]', '', 'g') LIKE $${idx})`);
                params.push(qLikeDigits);
                idx++;
            }

            whereParts.push(`(${parts.join(" OR ")})`);
        }

        const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

        // Pega apenas 1 vínculo escola/ano por aluno (o mais recente), evitando duplicar alunos na listagem
        // LISTAGEM PADRÃO = alunos municipais
        const baseFrom = `
		    FROM alunos_municipais a
            LEFT JOIN LATERAL (
                SELECT ae.escola_id, ae.ano_letivo, ae.turma, ae.atualizado_em
                FROM alunos_escolas ae
                WHERE ae.aluno_id = a.id
                  ${columnSupport.alunosEscolasTenantId && columnSupport.alunosMunicipaisTenantId ? 'AND ae.tenant_id = a.tenant_id' : ''}
                ORDER BY ae.ano_letivo DESC NULLS LAST, ae.atualizado_em DESC NULLS LAST, ae.id DESC
                LIMIT 1
            ) ae ON TRUE
            LEFT JOIN escolas e
              ON e.id = ae.escola_id
              ${columnSupport.escolasTenantId && columnSupport.alunosMunicipaisTenantId ? 'AND e.tenant_id = a.tenant_id' : ''}
        `;

        // COUNT correto (1 por aluno)
        const countSql = `SELECT COUNT(*)::int AS total ${baseFrom} ${whereSql};`;
        const countResult = await pool.query(countSql, params);
        const total = Number(countResult.rows?.[0]?.total || 0);
        const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

        const selectSql = `
            SELECT
              a.id,
              a.pessoa_nome,
              a.cpf,
              a.sexo,
              a.ano,
              a.turma,
              a.status,
              a.unidade_ensino,
              a.transporte_escolar_publico_utiliza,
              a.transporte_apto,
              a.cep,
              a.rua,
              a.bairro,
              a.numero_pessoa_endereco,
              a.zona,
              a.id_pessoa,
              a.data_nascimento,
              a.filiacao_1,
              a.telefone_filiacao_1,
              a.filiacao_2,
              a.telefone_filiacao_2,
              a.responsavel,
              a.telefone_responsavel,
              a.deficiencia,
              ${columnSupport.alunosMunicipaisRotaExclusiva ? 'a.rota_exclusiva' : 'false AS rota_exclusiva'},
              ${columnSupport.alunosMunicipaisCarroAdaptado ? 'a.carro_adaptado' : 'false AS carro_adaptado'},
              ${columnSupport.alunosMunicipaisLocalizacao ? 'ST_AsGeoJSON(a.localizacao)::json AS localizacao_geojson' : 'NULL::json AS localizacao_geojson'},
              a.codigo_inep,
              ae.ano_letivo,
              ae.turma AS turma_escola,
              e.id AS escola_id,
              e.nome AS escola_nome
            ${baseFrom}
            ${whereSql}
            ORDER BY a.pessoa_nome ASC, a.id ASC
            LIMIT $${idx} OFFSET $${idx + 1};
        `;

        params.push(limit, offset);

        const result = await pool.query(selectSql, params);

        // LGPD: por padrão, não enviar CPF completo para o front.
        // Envia apenas cpf_masked/cpf_last2. CPF completo só sai se o usuário for privilegiado
        // e pedir explicitamente via ?include_sensitive=1
        const includeSensitive = String(req.query.include_sensitive || "") === "1" && canViewSensitive(req);

        const data = (result.rows || []).map((row) => {
            const r = { ...row };
            r.cpf_masked = maskCpf(r.cpf);
            r.cpf_last2 = last2Cpf(r.cpf);
            if (!includeSensitive) delete r.cpf;
            return r;
        });

        __bumpVersion(tenantId);
        return res.json({
            page,
            limit,
            total,
            total_pages: totalPages,
            data
        });
    } catch (err) {
        console.error("Erro ao listar alunos:", err);
        return res.status(500).json({ error: "Erro ao listar alunos" });
    }
});

/**
 * GET /api/alunos/estaduais
 * Lista alunos cadastrados manualmente para solicitação estadual.
 * (tabela alunos_municipais)
 */
router.get("/estaduais", async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const columnSupport = await getAlunosColumnSupport();

        const page = Math.max(parseInt(req.query.page, 10) || 1, 1);
        const limitReq = parseInt(req.query.limit, 10) || 20;
        const limit = Math.min(Math.max(limitReq, 1), 100);
        const offset = (page - 1) * limit;

        const qRaw = (req.query.q || "").trim();

        const qLikeRaw = qRaw ? `%${qRaw}%` : null;
        const qNorm = qRaw ? normalizeForSearch(qRaw) : "";
        const qLikeNorm = qNorm ? `%${qNorm}%` : null;
        const qDigits = qRaw ? String(qRaw).replace(/\D/g, "") : "";
        const qLikeDigits = qDigits ? `%${qDigits}%` : null;

        const params = [];
        let idx = 1;
        const whereParts = [];

        if (columnSupport.alunosMunicipaisTenantId) {
            whereParts.push("a.tenant_id = $1");
            params.push(tenantId);
            idx = 2;
        }

        if (qLikeRaw || qLikeNorm || qLikeDigits) {
            const parts = [];

            if (qLikeRaw) {
                parts.push(`(
            a.pessoa_nome ILIKE $${idx}
            OR a.cpf ILIKE $${idx}
            OR a.rua ILIKE $${idx}
            OR a.bairro ILIKE $${idx}
            OR a.cep ILIKE $${idx}
        )`);
                params.push(qLikeRaw);
                idx++;
            }

            if (qLikeNorm) {
                const nPessoa = sqlNormalizeExpr("a.pessoa_nome");
                const nCpf = sqlNormalizeExpr("a.cpf");
                const nRua = sqlNormalizeExpr("a.rua");
                const nBairro = sqlNormalizeExpr("a.bairro");
                const nCep = sqlNormalizeExpr("a.cep");

                parts.push(`(
            ${nPessoa} LIKE $${idx}
            OR ${nCpf} LIKE $${idx}
            OR ${nRua} LIKE $${idx}
            OR ${nBairro} LIKE $${idx}
            OR ${nCep} LIKE $${idx}
        )`);
                params.push(qLikeNorm);
                idx++;
            }

            if (qLikeDigits && qDigits.length >= 3) {
                parts.push(`(REGEXP_REPLACE(COALESCE(a.cpf,''), '\\D', '', 'g') LIKE $${idx})`);
                params.push(qLikeDigits);
                idx++;
            }

            whereParts.push(`(${parts.join(" OR ")})`);
        }

        const whereSql = whereParts.length ? `WHERE ${whereParts.join(" AND ")}` : "";

        const baseFrom = `FROM alunos_municipais a`;

        const countSql = `SELECT COUNT(*)::int AS total ${baseFrom} ${whereSql};`;
        const countResult = await pool.query(countSql, params);
        const total = Number(countResult.rows?.[0]?.total || 0);
        const totalPages = total > 0 ? Math.ceil(total / limit) : 1;

        const selectSql = `
            SELECT
              a.id,
              a.pessoa_nome,
              a.cpf,
              a.sexo,
              a.data_nascimento,
              a.cep,
              a.rua,
              a.bairro,
              a.numero_pessoa_endereco,
              a.referencia,
              a.telefone_responsavel,
              a.filiacao_1,
              a.filiacao_2,
              a.responsavel,
              a.deficiencia,
              ${columnSupport.alunosMunicipaisCarroAdaptado ? 'a.carro_adaptado' : 'false AS carro_adaptado'},
              a.transporte_escolar_publico_utiliza,
              a.transporte_apto,
              ${columnSupport.alunosMunicipaisLocalizacao ? 'ST_AsGeoJSON(a.localizacao)::json AS localizacao_geojson' : 'NULL::json AS localizacao_geojson'}
            ${baseFrom}
            ${whereSql}
            ORDER BY a.pessoa_nome ASC, a.id ASC
            LIMIT $${idx} OFFSET $${idx + 1};
        `;

        params.push(limit, offset);
        const result = await pool.query(selectSql, params);

        const includeSensitive = String(req.query.include_sensitive || "") === "1" && canViewSensitive(req);

        const data = (result.rows || []).map((row) => {
            const r = { ...row };
            r.cpf_masked = maskCpf(r.cpf);
            r.cpf_last2 = last2Cpf(r.cpf);
            if (!includeSensitive) delete r.cpf;
            return r;
        });

        __bumpVersion(tenantId);
        return res.json({
            page,
            limit,
            total,
            total_pages: totalPages,
            data
        });
    } catch (err) {
        console.error("Erro ao listar alunos estaduais:", err);
        return res.status(500).json({ error: "Erro ao listar alunos estaduais" });
    }
});

/**
 * GET /api/alunos/version
 * Sinal leve para auto-refresh (sem socket.io).
 * Retorna um número monotônico (ms desde epoch) por tenant.
 */
router.get("/version", async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        return res.json({ tenant_id: tenantId, version: __getVersion(tenantId) });
    } catch (err) {
        return res.status(500).json({ error: "Erro ao obter versão" });
    }
});


/**
 * POST /api/alunos/import-xlsx
 * Importação de planilha XLSX de alunos.
 */
/**
 * POST /api/alunos/import-xlsx
 * Importação de planilha XLSX de alunos.
 *
 * Regras:
 * 1) Se o aluno não existe no banco -> salva (insere).
 * 2) Se o aluno existe e mudou de escola -> zera localização e marca transporte_apto = false.
 * 3) Se o aluno existe e a escola é a mesma -> mantém a localização e atualiza os demais dados.
 * 4) (Opcional) Se habilitado, pode remover alunos que não estão na planilha (sincronização).
 */

router.post("/import-xlsx", upload.single("arquivo"), async (req, res) => {
    if (!req.file) {
        return res
            .status(400)
            .json({ error: "Arquivo XLSX é obrigatório (campo 'arquivo')." });
    }

    const tenantId = requireTenantId(req);

    // Por padrão, a importação NÃO exclui alunos que não vieram na planilha.
    // Para habilitar a sincronização com exclusão, use ?sync_delete=1 (ou campo sync_delete=true no form).
    const syncDelete = ["1", "true", "yes", "sim"].includes(String((req.query?.sync_delete ?? req.body?.sync_delete ?? "")).toLowerCase());

    try {
        const workbook = xlsx.read(req.file.buffer, { type: "buffer", cellDates: true });
        const sheetName = workbook.SheetNames[0];
        const sheet = workbook.Sheets[sheetName];
        const rows = xlsx.utils.sheet_to_json(sheet, { defval: null });

        if (!rows.length) {
            return res.status(400).json({ error: "Planilha vazia." });
        }

        // Caches (1 vez) - sempre por tenant
        const escolasMap = await carregarEscolasCache(tenantId);
        const { byCpf, byIdPessoa, all: alunosDb } = await carregarAlunosCache(tenantId);

        // Normaliza e prepara staging em memória (sem tocar no banco por linha)
        const staging = [];
        const chavesVistas = new Set();

        let total = 0;
        let inseridosNovos = 0; // preenchido após SQL
        let atualizados = 0;    // preenchido após SQL
        let mudaramEscola = 0;
        let alunosIgnoradosSemEscola = 0;
        let erros = 0;
        let alunosExcluidos = 0;

        for (const row of rows) {
            total += 1;

            const pessoa_nome = row["pessoa_nome"];
            if (!pessoa_nome) continue;

            const unidade_ensino = row["UNIDADE_ENSINO"];
            const escola = encontrarEscolaPorUnidade(unidade_ensino, escolasMap);
            if (!escola) {
                alunosIgnoradosSemEscola += 1;
                continue;
            }

            const cpfRaw = row["cpf"];
            const cpfNorm = normalizeCpf(cpfRaw);
            const id_pessoa = row["id_pessoa"];
            const idPessoaNorm =
                id_pessoa !== null && id_pessoa !== undefined
                    ? String(id_pessoa).trim()
                    : null;

            if (idPessoaNorm) chavesVistas.add(`IDP:${idPessoaNorm}`);
            else if (cpfNorm) chavesVistas.add(`CPF:${cpfNorm}`);

            // Identifica aluno existente (por id_pessoa, depois cpf)
            let alunoExistente = null;
            if (idPessoaNorm && byIdPessoa.has(idPessoaNorm)) {
                alunoExistente = byIdPessoa.get(idPessoaNorm);
            } else if (cpfNorm && byCpf.has(cpfNorm)) {
                alunoExistente = byCpf.get(cpfNorm);
            }

            const mudouEscola = alunoExistente
                ? escolaMudou(alunoExistente.unidade_ensino, unidade_ensino)
                : false;

            if (mudouEscola) mudaramEscola += 1;

            const data_nascimento = parseDateFlexible(row["data_nascimento"]);
            const data_matricula = parseDateFlexible(row["data_matricula"]);

            // Se vier data inválida em string estranha, parseDateFlexible retorna null.
            // Isso evita abortar transação.
            const transporte_escolar_publico_utiliza = row["transporte_escolar_publico_utiliza"];

            staging.push({
                tenant_id: tenantId,
                aluno_id: alunoExistente ? Number(alunoExistente.id) : null,
                mudou_escola: mudouEscola,

                escola_id: Number(escola.id),
                unidade_ensino: unidade_ensino || null,

                ano: row["ANO"] || null,
                turma: row["TURMA"] || null,
                modalidade: row["MODALIDADE"] || null,
                formato_letivo: row["FORMATO_LETIVO"] || null,
                etapa: row["ETAPA"] || null,
                status: row["STATUS"] || null,

                cpf: cpfRaw || null,
                cpf_norm: cpfNorm || null,
                pessoa_nome: pessoa_nome || null,
                data_nascimento,
                sexo: row["sexo"] || null,
                codigo_inep: normalizeDigits(row["CODIGO_INEP"], 15),
                data_matricula,
                id_pessoa: parseBigIntFlexible(id_pessoa),
                id_pessoa_norm: idPessoaNorm || null,

                cep: row["cep"] || null,
                numero_pessoa_endereco: row["numero_pessoa_endereco"] || null,
                bairro: row["bairro"] || null,
                zona: row["zona"] || null,

                filiacao_1: row["filiacao_1"] || null,
                telefone_filiacao_1: row["telefone_filiacao_1"] || null,
                filiacao_2: row["filiacao_2"] || null,
                telefone_filiacao_2: row["telefone_filiicao_2"] || row["telefone_filiacao_2"] || null,

                responsavel: row["responsavel"] || null,
                telefone_responsavel: row["telefone_responsavel"] || null,

                deficiencia: row["deficiencia"] || null,
                transporte_escolar_publico_utiliza: transporte_escolar_publico_utiliza ?? null
            });
        }

        if (!staging.length) {
            return res.status(400).json({
                error: "Nenhuma linha válida para importar (verifique escola/unidade e colunas obrigatórias)."
            });
        }

        const client = await pool.connect();
        try {
            await client.query("BEGIN");

            // 1) Cria tabela temporária de staging (rápida) - isolada da sessão
            await client.query(`
                CREATE TEMP TABLE tmp_import_alunos (
                    tenant_id bigint NOT NULL,
                    aluno_id int NULL,
                    mudou_escola boolean NOT NULL DEFAULT false,

                    escola_id int NOT NULL,
                    unidade_ensino text NULL,

                    ano text NULL,
                    turma text NULL,
                    modalidade text NULL,
                    formato_letivo text NULL,
                    etapa text NULL,
                    status text NULL,

                    cpf text NULL,
                    cpf_norm text NULL,
                    pessoa_nome text NULL,
                    data_nascimento date NULL,
                    sexo text NULL,
                    codigo_inep varchar(15) NULL,
                    data_matricula date NULL,
                    id_pessoa bigint NULL,
                    id_pessoa_norm text NULL,

                    cep text NULL,
                    numero_pessoa_endereco text NULL,
                    bairro text NULL,
                    zona text NULL,

                    filiacao_1 text NULL,
                    telefone_filiacao_1 text NULL,
                    filiacao_2 text NULL,
                    telefone_filiacao_2 text NULL,

                    responsavel text NULL,
                    telefone_responsavel text NULL,

                    deficiencia text NULL,
                    transporte_escolar_publico_utiliza text NULL
                ) ON COMMIT DROP;
            `);

            // 2) Insere em lote no staging
            const cols = [
                "tenant_id", "aluno_id", "mudou_escola",
                "escola_id", "unidade_ensino",
                "ano", "turma", "modalidade", "formato_letivo", "etapa", "status",
                "cpf", "cpf_norm", "pessoa_nome", "data_nascimento", "sexo", "codigo_inep", "data_matricula", "id_pessoa", "id_pessoa_norm",
                "cep", "numero_pessoa_endereco", "bairro", "zona",
                "filiacao_1", "telefone_filiacao_1", "filiacao_2", "telefone_filiacao_2",
                "responsavel", "telefone_responsavel",
                "deficiencia", "transporte_escolar_publico_utiliza"
            ];

            const chunkSize = 750; // bom equilíbrio para PG
            for (let i = 0; i < staging.length; i += chunkSize) {
                const chunk = staging.slice(i, i + chunkSize);
                const values = [];
                const placeholders = [];

                let p = 1;
                for (const r of chunk) {
                    const rowVals = [
                        r.tenant_id, r.aluno_id, r.mudou_escola,
                        r.escola_id, r.unidade_ensino,
                        r.ano, r.turma, r.modalidade, r.formato_letivo, r.etapa, r.status,
                        r.cpf, r.cpf_norm, r.pessoa_nome, r.data_nascimento, r.sexo, r.codigo_inep, r.data_matricula, r.id_pessoa, r.id_pessoa_norm,
                        r.cep, r.numero_pessoa_endereco, r.bairro, r.zona,
                        r.filiacao_1, r.telefone_filiacao_1, r.filiacao_2, r.telefone_filiacao_2,
                        r.responsavel, r.telefone_responsavel,
                        r.deficiencia, r.transporte_escolar_publico_utiliza
                    ];
                    values.push(...rowVals);

                    const ph = rowVals.map(() => `$${p++}`);
                    placeholders.push(`(${ph.join(",")})`);
                }

                await client.query(
                    `INSERT INTO tmp_import_alunos (${cols.join(",")}) VALUES ${placeholders.join(",")};`,
                    values
                );
            }

            // 3) Atualiza existentes em lote (inclui regra de mudança de escola usando flag do staging)
            const upd = await client.query(`
                UPDATE alunos_municipais a
                SET
                    tenant_id = s.tenant_id,
                    unidade_ensino = COALESCE(s.unidade_ensino, a.unidade_ensino),
                    ano = COALESCE(s.ano, a.ano),
                    turma = COALESCE(s.turma, a.turma),
                    modalidade = COALESCE(s.modalidade, a.modalidade),
                    formato_letivo = COALESCE(s.formato_letivo, a.formato_letivo),
                    etapa = COALESCE(s.etapa, a.etapa),
                    status = COALESCE(s.status, a.status),
                    cpf = COALESCE(s.cpf, a.cpf),
                    pessoa_nome = COALESCE(s.pessoa_nome, a.pessoa_nome),
                    data_nascimento = COALESCE(s.data_nascimento, a.data_nascimento),
                    sexo = COALESCE(s.sexo, a.sexo),
                    codigo_inep = COALESCE(s.codigo_inep, a.codigo_inep),
                    data_matricula = COALESCE(s.data_matricula, a.data_matricula),
                    id_pessoa = COALESCE(s.id_pessoa, a.id_pessoa),
                    cep = COALESCE(s.cep, a.cep),
                    numero_pessoa_endereco = COALESCE(s.numero_pessoa_endereco, a.numero_pessoa_endereco),
                    bairro = COALESCE(s.bairro, a.bairro),
                    zona = COALESCE(s.zona, a.zona),
                    filiacao_1 = COALESCE(s.filiacao_1, a.filiacao_1),
                    telefone_filiacao_1 = COALESCE(s.telefone_filiacao_1, a.telefone_filiacao_1),
                    filiacao_2 = COALESCE(s.filiacao_2, a.filiacao_2),
                    telefone_filiacao_2 = COALESCE(s.telefone_filiacao_2, a.telefone_filiacao_2),
                    responsavel = COALESCE(s.responsavel, a.responsavel),
                    telefone_responsavel = COALESCE(s.telefone_responsavel, a.telefone_responsavel),
                    deficiencia = COALESCE(s.deficiencia, a.deficiencia),
                    transporte_escolar_publico_utiliza = COALESCE(s.transporte_escolar_publico_utiliza, a.transporte_escolar_publico_utiliza),
                    localizacao = a.localizacao,
                    transporte_apto = CASE WHEN s.mudou_escola THEN FALSE ELSE a.transporte_apto END,
                    atualizado_em = NOW()
                FROM tmp_import_alunos s
                WHERE s.aluno_id IS NOT NULL
                  AND a.id = s.aluno_id
                  AND a.tenant_id = s.tenant_id
                ;
            `);
            atualizados = upd.rowCount || 0;

            // 4) Insere novos em lote
            const ins = await client.query(`
                INSERT INTO alunos_municipais (
                    tenant_id,
                    unidade_ensino,
                    ano,
                    turma,
                    modalidade,
                    formato_letivo,
                    etapa,
                    status,
                    cpf,
                    pessoa_nome,
                    data_nascimento,
                    sexo,
                    codigo_inep,
                    data_matricula,
                    id_pessoa,
                    cep,
                    numero_pessoa_endereco,
                    bairro,
                    zona,
                    filiacao_1,
                    telefone_filiacao_1,
                    filiacao_2,
                    telefone_filiacao_2,
                    responsavel,
                    telefone_responsavel,
                    deficiencia,
                    transporte_escolar_publico_utiliza,
                    transporte_apto
                )
                SELECT
                    s.tenant_id,
                    s.unidade_ensino,
                    s.ano,
                    s.turma,
                    s.modalidade,
                    s.formato_letivo,
                    s.etapa,
                    s.status,
                    s.cpf,
                    s.pessoa_nome,
                    s.data_nascimento,
                    s.sexo,
                    s.codigo_inep,
                    s.data_matricula,
                    s.id_pessoa,
                    s.cep,
                    s.numero_pessoa_endereco,
                    s.bairro,
                    s.zona,
                    s.filiacao_1,
                    s.telefone_filiacao_1,
                    s.filiacao_2,
                    s.telefone_filiacao_2,
                    s.responsavel,
                    s.telefone_responsavel,
                    s.deficiencia,
                    s.transporte_escolar_publico_utiliza,
                    FALSE
                FROM tmp_import_alunos s
                WHERE s.aluno_id IS NULL
                  AND s.tenant_id = $1
                ;
            `, [tenantId]);
            inseridosNovos = ins.rowCount || 0;

            // 5) Monta um mapa (no banco) de aluno_id final para cada linha importada (por preferência id_pessoa, senão cpf_norm)
            await client.query(`
                CREATE TEMP TABLE tmp_import_ids (
                    tenant_id bigint NOT NULL,
                    aluno_id int NOT NULL,
                    id_pessoa_norm text NULL,
                    cpf_norm text NULL,
                    ano_letivo int NULL,
                    turma text NULL,
                    escola_id int NOT NULL
                ) ON COMMIT DROP;
            `);

            // Preenche: tenta casar por id_pessoa_norm; se vazio, casa por cpf_norm
            await client.query(`
                INSERT INTO tmp_import_ids (tenant_id, aluno_id, id_pessoa_norm, cpf_norm, ano_letivo, turma, escola_id)
                SELECT
                    s.tenant_id,
                    a.id AS aluno_id,
                    s.id_pessoa_norm,
                    s.cpf_norm,
                    NULLIF(regexp_replace(COALESCE(s.ano,''), '\\D', '', 'g'), '')::int AS ano_letivo,
                    s.turma,
                    s.escola_id
                FROM tmp_import_alunos s
                JOIN alunos_municipais a
                  ON a.tenant_id = s.tenant_id
                 AND (
                      (s.id_pessoa_norm IS NOT NULL AND a.id_pessoa::text = s.id_pessoa_norm)
                      OR
                      (s.id_pessoa_norm IS NULL AND s.cpf_norm IS NOT NULL AND regexp_replace(COALESCE(a.cpf,''), '\\D', '', 'g') = s.cpf_norm)
                 )
                WHERE s.tenant_id = $1;
            `, [tenantId]);

            // 6) Atualiza relação aluno x escola em lote (apenas quando ano_letivo válido)
            // Remove qualquer vínculo do ano letivo e reinsere
            await queryWithOptionalTenant(
                client,
                `
                DELETE FROM alunos_escolas ae
                USING tmp_import_ids t
                WHERE ae.tenant_id = t.tenant_id
                  AND ae.aluno_id = t.aluno_id
                  AND ae.ano_letivo = t.ano_letivo
                  AND t.ano_letivo IS NOT NULL
                  AND t.tenant_id = $1
                `,
                [tenantId],
                `
                DELETE FROM alunos_escolas ae
                USING tmp_import_ids t
                WHERE ae.aluno_id = t.aluno_id
                  AND ae.ano_letivo = t.ano_letivo
                  AND t.ano_letivo IS NOT NULL
                `,
                []
            );

            await queryWithOptionalTenant(
                client,
                `
                INSERT INTO alunos_escolas (tenant_id, aluno_id, escola_id, ano_letivo, turma)
                SELECT tenant_id, aluno_id, escola_id, ano_letivo, turma
                FROM tmp_import_ids
                WHERE ano_letivo IS NOT NULL
                  AND tenant_id = $1
                ON CONFLICT DO NOTHING
                `,
                [tenantId],
                `
                INSERT INTO alunos_escolas (aluno_id, escola_id, ano_letivo, turma)
                SELECT aluno_id, escola_id, ano_letivo, turma
                FROM tmp_import_ids
                WHERE ano_letivo IS NOT NULL
                ON CONFLICT DO NOTHING
                `,
                []
            );

            // 7) (Opcional) sincronização com exclusão: remover do banco do tenant quem não veio na planilha
            // (usa o cache pré-carregado - já filtrado por tenant)
            if (syncDelete && chavesVistas.size > 0 && alunosDb.length > 0) {
                const idsParaExcluir = [];

                for (const a of alunosDb) {
                    const cpfNormDb = normalizeCpf(a.cpf);
                    const idPessoaNormDb =
                        a.id_pessoa !== null && a.id_pessoa !== undefined
                            ? String(a.id_pessoa).trim()
                            : null;

                    const key = idPessoaNormDb
                        ? `IDP:${idPessoaNormDb}`
                        : (cpfNormDb ? `CPF:${cpfNormDb}` : null);

                    if (key && !chavesVistas.has(key)) {
                        idsParaExcluir.push(a.id);
                    }
                }

                if (idsParaExcluir.length > 0) {
                    await queryWithOptionalTenant(
                        client,
                        `DELETE FROM alunos_escolas WHERE aluno_id = ANY($1::int[]) AND tenant_id = $2`,
                        [idsParaExcluir, tenantId],
                        `DELETE FROM alunos_escolas WHERE aluno_id = ANY($1::int[])`,
                        [idsParaExcluir]
                    );
                    await queryWithOptionalTenant(
                        client,
                        `DELETE FROM alunos_pontos WHERE aluno_id = ANY($1::int[]) AND tenant_id = $2`,
                        [idsParaExcluir, tenantId],
                        `DELETE FROM alunos_pontos WHERE aluno_id = ANY($1::int[])`,
                        [idsParaExcluir]
                    );

                    const delResp = await queryWithOptionalTenant(
                        client,
                        `DELETE FROM alunos_municipais WHERE id = ANY($1::int[]) AND tenant_id = $2`,
                        [idsParaExcluir, tenantId],
                        `DELETE FROM alunos_municipais WHERE id = ANY($1::int[])`,
                        [idsParaExcluir]
                    );
                    alunosExcluidos = delResp.rowCount || 0;
                }
            }

            await client.query("COMMIT");

            const payload = {
                mensagem: "Importação concluída.",
                total_linhas_lidas: total,
                linhas_validas_para_importacao: staging.length,
                alunos_novos_inseridos: inseridosNovos,
                alunos_atualizados: atualizados,
                alunos_com_mudanca_escola: mudaramEscola,
                alunos_ignorados_sem_escola: alunosIgnoradosSemEscola,
                alunos_excluidos: alunosExcluidos,
                erros
            };
            __bumpVersion(tenantId);
            return res.json(payload);
        } catch (errTx) {
            await client.query("ROLLBACK");
            console.error("Erro na transação de importação de alunos:", errTx);
            return res.status(500).json({ error: "Erro ao importar alunos." });
        } finally {
            client.release();
        }
    } catch (err) {
        console.error("Erro geral ao importar alunos:", err);
        return res.status(500).json({ error: "Erro ao importar alunos." });
    }
});


/**
 * GET /api/alunos/localizacoes
 * Lista apenas alunos com localização cadastrada (formato "tabela").
 */


/**
 * POST /api/alunos/estadual-manual
 * Cadastro manual do aluno para fluxo de "solicitar rota estadual".
 * - Cria o aluno em alunos_municipais
 * - Vincula a escola em alunos_escolas
 * - Retorna o aluno já com escola_id/escola_nome/codigo_inep preenchidos
 */
router.post("/estadual-manual", async (req, res) => {
    const tenantId = requireTenantId(req);

    const body = req.body || {};

    // Obrigatórios
    const escolaId = Number.parseInt(String(body.escola_id || ""), 10);
    const anoLetivo = body.ano_letivo !== undefined && body.ano_letivo !== null
        ? Number.parseInt(String(body.ano_letivo || ""), 10)
        : null;

    const turmaEscola = (body.turma_escola !== undefined && body.turma_escola !== null && String(body.turma_escola).trim() !== '')
        ? String(body.turma_escola).trim()
        : null;

    const pessoaNome = String(body.pessoa_nome || "").trim();
    const cpf = String(body.cpf || "").trim();
    const dataNascimento = String(body.data_nascimento || "").trim();
    const sexo = String(body.sexo || "").trim();

    const ano = String(body.ano || "").trim();
    const turma = String(body.turma || "").trim();
    const modalidade = (body.modalidade !== undefined && body.modalidade !== null && String(body.modalidade).trim() !== '')
        ? String(body.modalidade).trim()
        : null;

    const formatoLetivo = (body.formato_letivo !== undefined && body.formato_letivo !== null && String(body.formato_letivo).trim() !== '')
        ? String(body.formato_letivo).trim()
        : null;

    const etapa = (body.etapa !== undefined && body.etapa !== null && String(body.etapa).trim() !== '')
        ? String(body.etapa).trim()
        : null;
    const status = String(body.status || "").trim() || "ativo";

    const transporteUtiliza = null; // definido pelo sistema no fluxo posterior

    const cep = String(body.cep || "").trim();
    const rua = String(body.rua || "").trim();
    const bairro = String(body.bairro || "").trim();
    const numeroPessoaEndereco = String(body.numero_pessoa_endereco || "").trim();
    const zona = String(body.zona || "").trim();

    const filiacao1 = String(body.filiacao_1 || "").trim();
    const telFiliacao1 = String(body.telefone_filiacao_1 || "").trim();
    const filiacao2 = String(body.filiacao_2 || "").trim();
    const telFiliacao2 = String(body.telefone_filiacao_2 || "").trim();

    const responsavel = String(body.responsavel || "").trim();
    const telResponsavel = String(body.telefone_responsavel || "").trim();

    const deficiencia = String(body.deficiencia || "").trim();
    const carroAdaptado = !!body.carro_adaptado;

    // Validações básicas
    if (!Number.isInteger(escolaId) || escolaId <= 0) {
        return res.status(400).json({ error: "escola_id obrigatório" });
    }
    if (!Number.isInteger(anoLetivo) || anoLetivo <= 0) {
        return res.status(400).json({ error: "ano_letivo obrigatório" });
    }

    const obrig = [
        ["pessoa_nome", pessoaNome],
        ["cpf", cpf],
        ["data_nascimento", dataNascimento],
        ["sexo", sexo],
        ["ano", ano],
        ["turma", turma],
        // modalidade/formato_letivo/etapa podem ficar null neste cadastro inicial
        ["status", status],
        // transporte_escolar_publico_utiliza é definido pelo sistema posteriormente
        ["cep", cep],
        ["rua", rua],
        ["bairro", bairro],
        ["numero_pessoa_endereco", numeroPessoaEndereco],
        // zona pode ficar em branco
        ["responsavel", responsavel],
        ["telefone_responsavel", telResponsavel]
    ];

    const faltando = obrig.filter(it => !it[1] || String(it[1]).trim() === "").map(it => it[0]);
    if (faltando.length) {
        return res.status(400).json({ error: "Campos obrigatórios ausentes: " + faltando.join(", ") });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // Confere escola no tenant
        const escolaRes = await client.query(
            `
            SELECT id, nome, codigo_inep
            FROM escolas
            WHERE tenant_id = $1 AND id = $2
            `,
            [tenantId, escolaId]
        );
        if (!escolaRes.rowCount) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Escola não encontrada no tenant." });
        }

        const escola = escolaRes.rows[0];

        // Insere aluno (com escola textual e codigo_inep preenchidos)
        const insertAluno = await client.query(
            `
            INSERT INTO alunos_municipais (
                tenant_id,
                unidade_ensino,
                ano,
                turma,
                modalidade,
                formato_letivo,
                etapa,
                status,
                cpf,
                pessoa_nome,
                data_nascimento,
                sexo,
                codigo_inep,
                data_matricula,
                id_pessoa,
                cep,
                rua,
                numero_pessoa_endereco,
                bairro,
                zona,
                filiacao_1,
                telefone_filiacao_1,
                filiacao_2,
                telefone_filiacao_2,
                responsavel,
                telefone_responsavel,
                deficiencia,
                transporte_escolar_publico_utiliza,
                transporte_apto,
                carro_adaptado,
                rota_exclusiva
            )
            VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, now(), NULL,
                $14, $15, $16, $17, $18,
                $19, $20, $21, $22,
                $23, $24, $25,
                NULL, FALSE,
                $26, FALSE
            )
            RETURNING id
            `,
            [
                tenantId,
                escola.nome,
                ano,
                turma,
                modalidade,
                formatoLetivo,
                etapa,
                status,
                cpf,
                pessoaNome,
                dataNascimento,
                sexo,
                escola.codigo_inep,
                cep,
                rua,
                numeroPessoaEndereco,
                bairro,
                zona,
                filiacao1,
                telFiliacao1,
                filiacao2,
                telFiliacao2,
                responsavel,
                telResponsavel,
                deficiencia,
                carroAdaptado
            ]
        );

        const alunoId = insertAluno.rows[0].id;

        // ID matrícula (id_pessoa) pode ser o mesmo ID do aluno (único)
        await client.query(
            `UPDATE alunos_municipais SET id_pessoa = id WHERE tenant_id = $1 AND id = $2`,
            [tenantId, alunoId]
        );

        // Vincula escola no ano letivo informado
        await client.query(
            `
            INSERT INTO alunos_escolas (tenant_id, aluno_id, escola_id, ano_letivo, turma)
            VALUES ($1, $2, $3, $4, $5)
            ON CONFLICT (aluno_id, escola_id, ano_letivo) DO UPDATE
            SET turma = EXCLUDED.turma,
                atualizado_em = now()
            `,
            [tenantId, alunoId, escolaId, anoLetivo, (turmaEscola || turma)]
        );

        await client.query("COMMIT");
        __bumpVersion(tenantId);

        // Retorna o aluno "completo" no mesmo formato do front
        const alunoFull = await pool.query(
            `
            SELECT
                a.*,
                e.id AS escola_id,
                e.nome AS escola_nome,
                e.codigo_inep AS escola_codigo_inep
            FROM alunos_municipais a
            LEFT JOIN alunos_escolas ae
                   ON ae.aluno_id = a.id
                  AND (ae.tenant_id = $1 OR ae.tenant_id IS NULL)
            LEFT JOIN escolas e
                   ON e.id = ae.escola_id
                  AND e.tenant_id = $1
            WHERE a.tenant_id = $1 AND a.id = $2
            ORDER BY ae.id DESC
            LIMIT 1
            `,
            [tenantId, alunoId]
        );

        return res.status(201).json(alunoFull.rows[0] || { id: alunoId, escola_id: escolaId, escola_nome: escola.nome });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro no cadastro manual estadual:", err);
        return res.status(500).json({ error: "Erro ao salvar aluno (cadastro manual estadual)." });
    } finally {
        client.release();
    }
});

router.get("/localizacoes", async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const sqlTenant = `
            SELECT
              a.id,
              a.pessoa_nome,
              a.unidade_ensino,
              e.nome AS escola_nome,
              ST_AsGeoJSON(a.localizacao)::json AS localizacao_geojson
            FROM alunos_municipais a
            LEFT JOIN alunos_escolas ae
              ON ae.aluno_id = a.id
             AND ae.tenant_id = a.tenant_id
            LEFT JOIN escolas e
              ON e.id = ae.escola_id
             AND e.tenant_id = a.tenant_id
            WHERE a.localizacao IS NOT NULL
              AND a.tenant_id = $1;
        `;
        const sqlNoTenant = `
            SELECT
              a.id,
              a.pessoa_nome,
              a.unidade_ensino,
              e.nome AS escola_nome,
              ST_AsGeoJSON(a.localizacao)::json AS localizacao_geojson
            FROM alunos_municipais a
            LEFT JOIN alunos_escolas ae
              ON ae.aluno_id = a.id
            LEFT JOIN escolas e
              ON e.id = ae.escola_id
            WHERE a.localizacao IS NOT NULL;
        `;
        const result = await queryWithOptionalTenant(pool, sqlTenant, [tenantId], sqlNoTenant, []);
        return res.json(result.rows || []);
    } catch (err) {
        console.error("Erro ao listar localizações de alunos:", err);
        return res
            .status(500)
            .json({ error: "Erro ao listar localizações de alunos." });
    }
});


/**
 * GET /api/alunos/mapa
 * Lista alunos para o mapa (array simples), com filtros usados no modal.
 *
 * Query params (todos opcionais):
 * - escola_id: int
 * - transporte: 'apto' | 'nao_apto'
 * - ponto: 'com_ponto' | 'sem_ponto'
 * - so_com_localizacao: '1' | 'true'
 * - deficiencia: 'tem' | 'nao_tem'
 */
router.get("/mapa", async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const columnSupport = await getAlunosColumnSupport();

        const escolaIdRaw = req.query.escola_id;
        const transporte = String(req.query.transporte || "").trim();
        const ponto = String(req.query.ponto || "").trim();
        const rota = String(req.query.rota || "").trim();
        const includeStats = String(req.query.include_stats || "").trim();
        const soComLocalizacao = String(req.query.so_com_localizacao || "").trim();
        const deficiencia = String(req.query.deficiencia || "").trim();
        const turnoRaw = req.query.turno;
        const turno = String(turnoRaw || "").trim();

        // Filtros extras (checkboxes no modal):
        // ?only_exclusivo=1 => apenas alunos com rota_exclusiva=true
        // ?only_adaptado=1  => apenas alunos com carro_adaptado=true
        const onlyExclusivo = parseBoolQuery(req.query.only_exclusivo);
        const onlyAdaptado = parseBoolQuery(req.query.only_adaptado);

        const escolaId = escolaIdRaw !== undefined && escolaIdRaw !== null && String(escolaIdRaw).trim() !== ""
            ? Number(String(escolaIdRaw).trim())
            : null;

        const where = [];
        const params = [];
        let idx = 1;

        if (columnSupport.alunosMunicipaisTenantId) {
            where.push("a.tenant_id = $1");
            params.push(tenantId);
            idx = 2;
        }

        if (onlyExclusivo) {
            if (columnSupport.alunosMunicipaisRotaExclusiva) {
                where.push("COALESCE(a.rota_exclusiva, false) = true");
            } else {
                where.push("false");
            }
        }
        if (onlyAdaptado) {
            if (columnSupport.alunosMunicipaisCarroAdaptado) {
                where.push("COALESCE(a.carro_adaptado, false) = true");
            } else {
                where.push("false");
            }
        }

        // localização
        if (soComLocalizacao === "1" || soComLocalizacao.toLowerCase() === "true") {
            where.push("a.localizacao IS NOT NULL");
        }

        // escola
        if (Number.isFinite(escolaId) && escolaId > 0) {
            where.push(`ae.escola_id = $${idx}`);
            params.push(escolaId);
            idx += 1;
        }

        // transporte
        if (transporte === "apto") {
            where.push("COALESCE(a.transporte_apto, false) = true");
        } else if (transporte === "nao_apto") {
            where.push("COALESCE(a.transporte_apto, false) = false");
        }

        // deficiência (o campo é texto; consideramos "tem" se não for vazio/nulo)
        if (deficiencia === "tem") {
            where.push("NULLIF(TRIM(COALESCE(a.deficiencia, '')), '') IS NOT NULL");
        } else if (deficiencia === "nao_tem") {
            where.push("NULLIF(TRIM(COALESCE(a.deficiencia, '')), '') IS NULL");
        }

        // filtros extras
        // turno (usa turno_simplificado: MAT | VESP | NOT | INT)
        if (turno && columnSupport.alunosMunicipaisTurnoSimplificado) {
            const t = String(turno).trim().toUpperCase();
            const mapa = { 'MANHA': 'MAT', 'MANHÃ': 'MAT', 'TARDE': 'VESP', 'NOITE': 'NOT', 'INTEGRAL': 'INT' };
            const code = mapa[t] || t;
            if (['MAT', 'VESP', 'NOT', 'INT'].includes(code)) {
                where.push(`a.turno_simplificado = $${idx}`);
                params.push(code);
                idx += 1;
            }
        }

        // ponto de parada (sem duplicar linhas: EXISTS)
        if (ponto === "com_ponto") {
            where.push(`EXISTS (
                SELECT 1
                FROM alunos_pontos ap
                WHERE ap.aluno_id = a.id
                  ${columnSupport.alunosMunicipaisTenantId ? 'AND ap.tenant_id = a.tenant_id' : ''}
            )`);
        } else if (ponto === "sem_ponto") {
            where.push(`NOT EXISTS (
                SELECT 1
                FROM alunos_pontos ap
                WHERE ap.aluno_id = a.id
                  ${columnSupport.alunosMunicipaisTenantId ? 'AND ap.tenant_id = a.tenant_id' : ''}
            )`);
        }



        // rota escolar (associação em rotas_escolares_alunos)
        if (rota === "com_rota") {
            where.push(`EXISTS (
                SELECT 1
                FROM rotas_escolares_alunos rea
                WHERE rea.aluno_id = a.id
                  ${columnSupport.alunosMunicipaisTenantId ? 'AND rea.tenant_id = a.tenant_id' : ''}
            )`);
        } else if (rota === "sem_rota") {
            where.push(`NOT EXISTS (
                SELECT 1
                FROM rotas_escolares_alunos rea
                WHERE rea.aluno_id = a.id
                  ${columnSupport.alunosMunicipaisTenantId ? 'AND rea.tenant_id = a.tenant_id' : ''}
            )`);
        }
        const sqlTenant = `
            SELECT
              a.id,
              a.pessoa_nome,
              a.unidade_ensino,
              a.transporte_apto,
              a.deficiencia,
              ${columnSupport.alunosMunicipaisRotaExclusiva ? 'a.rota_exclusiva' : 'false AS rota_exclusiva'},
              ${columnSupport.alunosMunicipaisCarroAdaptado ? 'a.carro_adaptado' : 'false AS carro_adaptado'},
              EXISTS (
                SELECT 1
                FROM rotas_escolares_alunos rea
                WHERE rea.aluno_id = a.id
                  ${columnSupport.alunosMunicipaisTenantId ? 'AND rea.tenant_id = a.tenant_id' : ''}
              ) AS tem_rota,
              e.id AS escola_id,
              e.nome AS escola_nome,
              ST_AsGeoJSON(a.localizacao)::json AS localizacao_geojson,
              ${columnSupport.alunosMunicipaisTurnoSimplificado ? 'MAX(a.turno_simplificado)' : 'NULL::text'} AS turno_simplificado,
              MAX(ap.ponto_id) AS ponto_id,
              MAX(ap.associado_em) AS ponto_associado_em,
              COALESCE(array_remove(array_agg(DISTINCT ap.ponto_id), NULL), '{}'::int[]) AS ponto_ids
            FROM alunos_municipais a
            LEFT JOIN alunos_escolas ae
              ON ae.aluno_id = a.id
             AND ae.tenant_id = a.tenant_id
            LEFT JOIN escolas e
              ON e.id = ae.escola_id
             AND e.tenant_id = a.tenant_id
            LEFT JOIN alunos_pontos ap
              ON ap.aluno_id = a.id
             AND ap.tenant_id = a.tenant_id
            ${where.length ? `WHERE ${where.join(" AND ")}` : ''}
            GROUP BY
              a.id,
              a.pessoa_nome,
              a.unidade_ensino,
              a.transporte_apto,
              a.deficiencia,
              ${columnSupport.alunosMunicipaisRotaExclusiva ? 'a.rota_exclusiva,' : ''}
              ${columnSupport.alunosMunicipaisCarroAdaptado ? 'a.carro_adaptado,' : ''}
              e.id,
              e.nome,
              a.localizacao
            ORDER BY a.pessoa_nome ASC, a.id ASC;
        `;
        const whereNoTenant = where.map((clause) => clause
            .replaceAll('a.tenant_id = $1', '1=1')
            .replaceAll('AND ap.tenant_id = a.tenant_id', '')
            .replaceAll('AND rea.tenant_id = a.tenant_id', '')
        ).filter((clause) => clause && clause !== '1=1');
        const needsShift = columnSupport.alunosMunicipaisTenantId ? 1 : 0;
        const whereNoTenantShifted = whereNoTenant.map((clause) => shiftSqlPlaceholders(clause, needsShift));
        const paramsNoTenant = needsShift ? params.slice(1) : params.slice();
        const sqlNoTenant = `
            SELECT
              a.id,
              a.pessoa_nome,
              a.unidade_ensino,
              a.transporte_apto,
              a.deficiencia,
              ${columnSupport.alunosMunicipaisRotaExclusiva ? 'a.rota_exclusiva' : 'false AS rota_exclusiva'},
              ${columnSupport.alunosMunicipaisCarroAdaptado ? 'a.carro_adaptado' : 'false AS carro_adaptado'},
              EXISTS (
                SELECT 1
                FROM rotas_escolares_alunos rea
                WHERE rea.aluno_id = a.id
              ) AS tem_rota,
              e.id AS escola_id,
              e.nome AS escola_nome,
              ST_AsGeoJSON(a.localizacao)::json AS localizacao_geojson,
              ${columnSupport.alunosMunicipaisTurnoSimplificado ? 'MAX(a.turno_simplificado)' : 'NULL::text'} AS turno_simplificado,
              MAX(ap.ponto_id) AS ponto_id,
              MAX(ap.associado_em) AS ponto_associado_em,
              COALESCE(array_remove(array_agg(DISTINCT ap.ponto_id), NULL), '{}'::int[]) AS ponto_ids
            FROM alunos_municipais a
            LEFT JOIN alunos_escolas ae
              ON ae.aluno_id = a.id
            LEFT JOIN escolas e
              ON e.id = ae.escola_id
            LEFT JOIN alunos_pontos ap
              ON ap.aluno_id = a.id
            ${whereNoTenantShifted.length ? `WHERE ${whereNoTenantShifted.join(" AND ")}` : ''}
            GROUP BY
              a.id,
              a.pessoa_nome,
              a.unidade_ensino,
              a.transporte_apto,
              a.deficiencia,
              ${columnSupport.alunosMunicipaisRotaExclusiva ? 'a.rota_exclusiva,' : ''}
              ${columnSupport.alunosMunicipaisCarroAdaptado ? 'a.carro_adaptado,' : ''}
              e.id,
              e.nome,
              a.localizacao
            ORDER BY a.pessoa_nome ASC, a.id ASC;
        `;

        const result = await queryWithOptionalTenant(pool, sqlTenant, params, sqlNoTenant, paramsNoTenant);
        const rows = result.rows || [];

        // compat: se front solicitar, devolve stats junto (sem quebrar quem espera array)
        const wantsStats = (includeStats === "1" || includeStats.toLowerCase() === "true");
        if (wantsStats) {
            let total = rows.length;
            let comRota = 0;
            let comPonto = 0;
            let comDef = 0;

            rows.forEach(r => {
                if (r && (r.tem_rota === true || r.tem_rota === 1 || r.tem_rota === "t")) comRota += 1;
                if (r && Array.isArray(r.ponto_ids) && r.ponto_ids.length) comPonto += 1;
                if (r && r.deficiencia && String(r.deficiencia).trim() !== "") comDef += 1;
            });

            return res.json({
                data: rows,
                stats: {
                    total,
                    com_rota: comRota,
                    sem_rota: total - comRota,
                    com_ponto: comPonto,
                    sem_ponto: total - comPonto,
                    com_deficiencia: comDef,
                    sem_deficiencia: total - comDef
                }
            });
        }

        return res.json(rows);
    } catch (err) {
        console.error("Erro ao listar alunos para o mapa:", err);
        return res.status(500).json({ error: "Erro ao carregar alunos no mapa." });
    }
});



/**
 * GET /api/alunos/geo/localizacoes
 * Retorna alunos com localização em formato GeoJSON (FeatureCollection).
 */
router.get("/geo/localizacoes", async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const sqlTenant = `
            SELECT
              a.id,
              a.pessoa_nome,
              a.unidade_ensino,
              a.id_pessoa,
              a.transporte_escolar_publico_utiliza,
              a.transporte_apto,
              a.status,
              a.zona,
              a.bairro,
              a.rua,
              a.numero_pessoa_endereco,
              ST_AsGeoJSON(a.localizacao)::json AS geom,
              a.dentro_municipio
            FROM alunos_municipais a
            WHERE a.localizacao IS NOT NULL
              AND a.tenant_id = $1;
        `;
        const sqlNoTenant = `
            SELECT
              a.id,
              a.pessoa_nome,
              a.unidade_ensino,
              a.id_pessoa,
              a.transporte_escolar_publico_utiliza,
              a.transporte_apto,
              a.status,
              a.zona,
              a.bairro,
              a.rua,
              a.numero_pessoa_endereco,
              ST_AsGeoJSON(a.localizacao)::json AS geom,
              a.dentro_municipio
            FROM alunos_municipais a
            WHERE a.localizacao IS NOT NULL;
        `;
        const result = await queryWithOptionalTenant(pool, sqlTenant, [tenantId], sqlNoTenant, []);
        const rows = result.rows || [];

        const features = rows.map((row) => ({
            type: "Feature",
            properties: {
                id: row.id,
                pessoa_nome: row.pessoa_nome,
                unidade_ensino: row.unidade_ensino,
                id_pessoa: row.id_pessoa,
                transporte_escolar_publico_utiliza: row.transporte_escolar_publico_utiliza,
                transporte_apto: row.transporte_apto,
                status: row.status,
                zona: row.zona,
                bairro: row.bairro,
                rua: row.rua,
                numero_pessoa_endereco: row.numero_pessoa_endereco,
                dentro_municipio: row.dentro_municipio
            },
            geometry: row.geom
        }));

        return res.json({
            type: "FeatureCollection",
            features
        });
    } catch (err) {
        console.error("Erro ao listar localizações GeoJSON de alunos:", err);
        return res
            .status(500)
            .json({ error: "Erro ao listar localizações GeoJSON de alunos." });
    }
});


/**
 * GET /api/alunos/geo/municipio
 * Retorna o limite territorial do município a partir da tabela territorios_municipios.
 * Usa o registro de id = 1 (padrão do tenant atual).
 */
router.get("/geo/municipio", async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const sql = `
            SELECT
              id,
              nome,
              ST_AsGeoJSON(geom) AS geom
            FROM territorios_municipios
            WHERE tenant_id = $1
            LIMIT 1;
        `;

        let rows;
        try {
            ({ rows } = await pool.query(sql, [tenantId]));
        } catch (err) {
            if (err && err.code === "42P01") {
                return res.status(404).json({
                    error: "Território municipal ainda não cadastrado."
                });
            }
            // Se a tabela ainda não é multi-tenant, NÃO fazemos fallback para evitar vazamento.
            if (err && err.code === "42703") {
                return res.status(404).json({
                    error: "Território municipal ainda não cadastrado."
                });
            }
            throw err;
        }

        if (!rows.length || !rows[0].geom) {
            return res
                .status(404)
                .json({ error: "Território municipal não cadastrado para este tenant." });
        }

        const row = rows[0];

        let geometry;
        try {
            geometry = JSON.parse(row.geom);
        } catch (parseErr) {
            console.error(
                "GeoJSON inválido no banco (territorios_municipios):",
                parseErr
            );
            return res
                .status(500)
                .json({ error: "GeoJSON inválido armazenado para o território municipal." });
        }

        // Retorna como Feature, que o Leaflet aceita normalmente em L.geoJSON(...)
        const feature = {
            type: "Feature",
            properties: {
                id: row.id,
                nome: row.nome || "Território municipal"
            },
            geometry
        };

        return res.json(feature);
    } catch (err) {
        console.error("Erro ao carregar território municipal (alunos):", err);
        return res
            .status(500)
            .json({ error: "Erro ao carregar limite municipal." });
    }
});


/**
 * PUT /api/alunos/:id/dados-transporte
 * Atualiza dados de endereço e responsáveis.
 */
router.put("/:id/dados-transporte", async (req, res) => {
    const { id } = req.params;
    const tenantId = requireTenantId(req);

    // Por padrão, a importação NÃO exclui alunos que não vieram na planilha.
    // Para habilitar a sincronização com exclusão, use ?sync_delete=1 (ou campo sync_delete=true no form).
    const syncDelete = ["1", "true", "yes", "sim"].includes(String((req.query?.sync_delete ?? req.body?.sync_delete ?? "")).toLowerCase());

    try {
        const {
            cep,
            rua,
            bairro,
            numero_endereco,
            telefone,
            filiacao_1,
            filiacao_2,
            responsavel,
            deficiencia,
            rota_exclusiva,
            carro_adaptado
        } = req.body || {};

        const vCep = sanitizeField(cep);
        const vRua = sanitizeField(rua);
        const vBairro = sanitizeField(bairro);
        const vNumero = sanitizeField(numero_endereco);
        const vTelefone = sanitizeField(telefone);
        const vFiliacao1 = sanitizeField(filiacao_1);
        const vFiliacao2 = sanitizeField(filiacao_2);
        const vResponsavel = sanitizeField(responsavel);

        const vDeficiencia = sanitizeField(deficiencia);
        const rotaExclusiva = (typeof rota_exclusiva === "boolean")
            ? rota_exclusiva
            : (typeof rota_exclusiva === "string"
                ? ["true", "1", "sim", "s", "yes"].includes(rota_exclusiva.trim().toLowerCase())
                : (rota_exclusiva === null ? null : undefined));
        const vRotaExclusiva = rotaExclusiva === undefined ? null : rotaExclusiva;

        const carroAdaptado = (typeof carro_adaptado === "boolean")
            ? carro_adaptado
            : (typeof carro_adaptado === "string"
                ? ["true", "1", "sim", "s", "yes"].includes(carro_adaptado.trim().toLowerCase())
                : (carro_adaptado === null ? null : undefined));
        const vCarroAdaptado = carroAdaptado === undefined ? null : carroAdaptado;

        const sql = `
            UPDATE alunos_municipais
            SET
              cep = COALESCE($1, cep),
              rua = COALESCE($2, rua),
              bairro = COALESCE($3, bairro),
              numero_pessoa_endereco = COALESCE($4, numero_pessoa_endereco),
              telefone_responsavel = COALESCE($5, telefone_responsavel),
              filiacao_1 = COALESCE($6, filiacao_1),
              filiacao_2 = COALESCE($7, filiacao_2),
              responsavel = COALESCE($8, responsavel),
              deficiencia = COALESCE($9, deficiencia),
              rota_exclusiva = COALESCE($10, rota_exclusiva),
	              carro_adaptado = COALESCE($11, carro_adaptado),
              atualizado_em = NOW()
	            WHERE id = $12 AND tenant_id = $13
            RETURNING *;
        `;

        const result = await pool.query(sql, [
            vCep,
            vRua,
            vBairro,
            vNumero,
            vTelefone,
            vFiliacao1,
            vFiliacao2,
            vResponsavel,
            vDeficiencia,
            vRotaExclusiva,
            vCarroAdaptado,
            id,
            tenantId
        ]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Aluno não encontrado." });
        }

        const alunoAtualizado = result.rows[0];
        __bumpVersion(tenantId);
        return res.json(alunoAtualizado);
    } catch (err) {
        console.error(
            "Erro ao atualizar dados de transporte do aluno:",
            err
        );
        return res.status(500).json({
            error: "Erro ao atualizar dados de transporte do aluno."
        });
    }
});

// POST /api/alunos/:id/associar-ponto
// Associa (ou troca) o ponto de parada do aluno.
// Body aceito: { ponto_id } ou { ponto_parada_id } ou { pontoId }
router.post("/:id/associar-ponto", async (req, res) => {
    const tenantId = requireTenantId(req);

    const alunoId = parseInt(req.params.id, 10);
    const rawPonto =
        (req.body && (req.body.ponto_id ?? req.body.ponto_parada_id ?? req.body.pontoId)) ?? null;
    const pontoId = parseInt(rawPonto, 10);

    if (!Number.isInteger(alunoId) || alunoId <= 0) {
        return res.status(400).json({ error: "ID do aluno inválido." });
    }
    if (!Number.isInteger(pontoId) || pontoId <= 0) {
        return res.status(400).json({ error: "ID do ponto de parada inválido." });
    }

    const client = await pool.connect();
    try {
        await client.query("BEGIN");

        // garante aluno existe
        const aRes = await client.query(
            "SELECT id FROM alunos_municipais WHERE id = $1 AND tenant_id = $2",
            [alunoId, tenantId]
        );
        if (aRes.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Aluno não encontrado." });
        }

        // garante ponto existe
        const pRes = await client.query(
            "SELECT id FROM pontos_parada WHERE id = $1 AND tenant_id = $2",
            [pontoId, tenantId]
        );
        if (pRes.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Ponto de parada não encontrado." });
        }

        // remove associação anterior e insere a nova
        await client.query(
            "DELETE FROM alunos_pontos WHERE aluno_id = $1 AND tenant_id = $2",
            [alunoId, tenantId]
        );
        await client.query(
            "INSERT INTO alunos_pontos (aluno_id, ponto_id, tenant_id, associado_em) VALUES ($1, $2, $3, now())",
            [alunoId, pontoId, tenantId]
        );

        await client.query("COMMIT");
        __bumpVersion(tenantId);
        return res.json({ ok: true, aluno_id: alunoId, ponto_id: pontoId });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro ao associar ponto ao aluno:", err);
        return res.status(500).json({ error: "Erro ao associar ponto de parada." });
    } finally {
        client.release();
    }
});

// GET /api/alunos/:id/pontos-parada-por-escola
// Retorna pontos de parada FILTRADOS pelos zoneamentos vinculados à escola do aluno.
// - Se informado ?escola_id=123, usa esse valor (útil no cadastro quando aluno ainda não foi salvo).
// - Caso contrário, tenta descobrir a escola via alunos_escolas.
router.get("/:id/pontos-parada-por-escola", async (req, res) => {
    const alunoId = parseInt(req.params.id, 10);
    const tenantId = requireTenantId(req);

    // Por padrão, a importação NÃO exclui alunos que não vieram na planilha.
    // Para habilitar a sincronização com exclusão, use ?sync_delete=1 (ou campo sync_delete=true no form).
    const syncDelete = ["1", "true", "yes", "sim"].includes(String((req.query?.sync_delete ?? req.body?.sync_delete ?? "")).toLowerCase());

    try {
        let escolaId = Number.parseInt(String(req.query.escola_id || ""), 10);
        if (!Number.isInteger(escolaId) || escolaId <= 0) {
            escolaId = null;
        }

        // Se não veio escola_id, tenta descobrir pela associação do aluno
        if (!escolaId && Number.isInteger(alunoId) && alunoId > 0) {
            const escolaRes = await pool.query(
                `
                SELECT ae.escola_id
                FROM alunos_escolas ae
                WHERE ae.aluno_id = $1
                  AND (ae.tenant_id = $2 OR ae.tenant_id IS NULL)
                ORDER BY ae.id DESC
                LIMIT 1
                `,
                [alunoId, tenantId]
            );
            escolaId = escolaRes.rows?.[0]?.escola_id ? Number(escolaRes.rows[0].escola_id) : null;
        }

        // Sem escola => não há como filtrar
        if (!escolaId) {
            return res.status(200).json([]);
        }

        // Zoneamentos vinculados à escola
        const zonasRes = await pool.query(
            `
            SELECT DISTINCT zoneamento_id
            FROM escola_zoneamento
            WHERE escola_id = $1
              AND tenant_id = $2
              AND zoneamento_id IS NOT NULL
            `,
            [escolaId, tenantId]
        );
        const zoneamentoIds = (zonasRes.rows || [])
            .map(r => Number(r.zoneamento_id))
            .filter(n => Number.isInteger(n) && n > 0);

        if (!zoneamentoIds.length) {
            return res.status(200).json([]);
        }

        // Pontos vinculados aos mesmos zoneamentos da escola:
        // - p.zoneamento_id direto
        // - ou vínculo via pontos_zoneamentos
        const pontosRes = await pool.query(
            `
            WITH z AS (
                SELECT UNNEST($1::int[]) AS zoneamento_id
            ),
            pontos_zona AS (
                SELECT DISTINCT p.id
                FROM pontos_parada p
                JOIN z ON z.zoneamento_id = p.zoneamento_id
                WHERE p.tenant_id = $2
                  AND p.status = 'ativo'

                UNION

                SELECT DISTINCT pz.ponto_id
                FROM pontos_zoneamentos pz
                JOIN pontos_parada p ON p.id = pz.ponto_id
                JOIN z ON z.zoneamento_id = pz.zoneamento_id
                WHERE pz.tenant_id = $2
                  AND p.tenant_id = $2
                  AND p.status = 'ativo'
            )
            SELECT
                p.id,
                p.area,
                p.logradouro,
                p.numero,
                p.complemento,
                p.referencia,
                p.bairro,
                p.cep,
                p.status,
                p.zoneamento_id,
                ST_Y(p.localizacao::geometry) AS latitude,
                ST_X(p.localizacao::geometry) AS longitude
            FROM pontos_parada p
            JOIN pontos_zona px ON px.id = p.id
            WHERE p.tenant_id = $2
            ORDER BY p.bairro ASC, p.logradouro ASC, p.numero ASC
            `,
            [zoneamentoIds, tenantId]
        );

        return res.json(pontosRes.rows || []);
    } catch (err) {
        console.error("Erro ao carregar pontos de parada por escola/zoneamento:", err);
        return res.status(500).json({ error: "Erro ao carregar pontos de parada." });
    }
});


/**
 * PUT /api/alunos/:id
 * Atualiza os principais campos do aluno (edição completa via modal da tela).
 *
 * Importante:
 * - Este endpoint NÃO recalcula elegibilidade automaticamente.
 * - Localização/elegibilidade e dados do fluxo de solicitação de transporte
 *   possuem endpoints dedicados (/localizacao, /dados-transporte, etc.).
 */
router.put("/:id", async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    const tenantId = requireTenantId(req);

    // Por padrão, a importação NÃO exclui alunos que não vieram na planilha.
    // Para habilitar a sincronização com exclusão, use ?sync_delete=1 (ou campo sync_delete=true no form).
    const syncDelete = ["1", "true", "yes", "sim"].includes(String((req.query?.sync_delete ?? req.body?.sync_delete ?? "")).toLowerCase());

    try {
        const columnSupport = await getAlunosColumnSupport();

        // Datas (aceita string vazia/undefined -> null)
        const dataNascimento = body.data_nascimento ? new Date(body.data_nascimento) : null;
        const dataMatricula = body.data_matricula ? new Date(body.data_matricula) : null;
        const dn = dataNascimento instanceof Date && !Number.isNaN(dataNascimento.valueOf())
            ? body.data_nascimento
            : null;
        const dm = dataMatricula instanceof Date && !Number.isNaN(dataMatricula.valueOf())
            ? body.data_matricula
            : null;

        const rotaExclusiva = typeof body.rota_exclusiva === "boolean"
            ? body.rota_exclusiva
            : (typeof body.rota_exclusiva === "string"
                ? ["true", "1", "sim", "s", "yes"].includes(body.rota_exclusiva.toLowerCase())
                : null);

        const carroAdaptado = typeof body.carro_adaptado === "boolean"
            ? body.carro_adaptado
            : (typeof body.carro_adaptado === "string"
                ? ["true", "1", "sim", "s", "yes"].includes(body.carro_adaptado.toLowerCase())
                : null);

        const transporteApto = typeof body.transporte_apto === "boolean"
            ? body.transporte_apto
            : (typeof body.transporte_apto === "string"
                ? ["true", "1", "sim", "apto"].includes(body.transporte_apto.toLowerCase())
                : null);

        const params = [
            sanitizeField(body.pessoa_nome),
            sanitizeField(body.cpf),
            dn,
            sanitizeField(body.sexo),
            sanitizeField(body.codigo_inep),
            dm,
            sanitizeField(body.status),

            sanitizeField(body.unidade_ensino),
            sanitizeField(body.ano),
            sanitizeField(body.turma),
            sanitizeField(body.modalidade),
            sanitizeField(body.formato_letivo),
            sanitizeField(body.etapa),

            sanitizeField(body.cep),
            sanitizeField(body.bairro),
            sanitizeField(body.numero_pessoa_endereco),
            sanitizeField(body.zona),

            sanitizeField(body.filiacao_1),
            sanitizeField(body.telefone_filiacao_1),
            sanitizeField(body.filiacao_2),
            sanitizeField(body.telefone_filiacao_2),
            sanitizeField(body.responsavel),
            sanitizeField(body.telefone_responsavel),
            sanitizeField(body.deficiencia),
            sanitizeField(body.transporte_escolar_publico_utiliza)
        ];
        const setParts = [
            'pessoa_nome = $1',
            'cpf = $2',
            'data_nascimento = $3',
            'sexo = $4',
            'codigo_inep = $5',
            'data_matricula = $6',
            'status = $7',
            'unidade_ensino = $8',
            'ano = $9',
            'turma = $10',
            'modalidade = $11',
            'formato_letivo = $12',
            'etapa = $13',
            'cep = $14',
            'bairro = $15',
            'numero_pessoa_endereco = $16',
            'zona = $17',
            'filiacao_1 = $18',
            'telefone_filiacao_1 = $19',
            'filiacao_2 = $20',
            'telefone_filiacao_2 = $21',
            'responsavel = $22',
            'telefone_responsavel = $23',
            'deficiencia = $24',
            'transporte_escolar_publico_utiliza = $25'
        ];
        if (columnSupport.alunosMunicipaisRotaExclusiva) {
            params.push(rotaExclusiva);
            setParts.push(`rota_exclusiva = COALESCE($${params.length}, rota_exclusiva)`);
        }
        if (columnSupport.alunosMunicipaisCarroAdaptado) {
            params.push(carroAdaptado);
            setParts.push(`carro_adaptado = COALESCE($${params.length}, carro_adaptado)`);
        }
        params.push(transporteApto);
        setParts.push(`transporte_apto = COALESCE($${params.length}, transporte_apto)`);
        setParts.push('atualizado_em = NOW()');
        params.push(id);
        const idIdx = params.length;
        let tenantWhere = '';
        if (columnSupport.alunosMunicipaisTenantId) {
            params.push(tenantId);
            tenantWhere = ` AND tenant_id = $${params.length}`;
        }
        const localizacaoExpr = columnSupport.alunosMunicipaisLocalizacao
            ? 'ST_AsGeoJSON(localizacao)::json AS localizacao_geojson'
            : 'NULL::json AS localizacao_geojson';
        const sql = `
            UPDATE alunos_municipais
            SET
                ${setParts.join(',\n                ')}
            WHERE id = $${idIdx}${tenantWhere}
            RETURNING
                id,
                pessoa_nome,
                cpf,
                data_nascimento,
                sexo,
                codigo_inep,
                data_matricula,
                status,
                unidade_ensino,
                ano,
                turma,
                modalidade,
                formato_letivo,
                etapa,
                cep,
                bairro,
                numero_pessoa_endereco,
                zona,
                filiacao_1,
                telefone_filiacao_1,
                filiacao_2,
                telefone_filiacao_2,
                responsavel,
                telefone_responsavel,
                deficiencia,
                transporte_escolar_publico_utiliza,
                transporte_apto,
                ${columnSupport.alunosMunicipaisRotaExclusiva ? 'rota_exclusiva' : 'false AS rota_exclusiva'},
                ${columnSupport.alunosMunicipaisCarroAdaptado ? 'carro_adaptado' : 'false AS carro_adaptado'},
                ${localizacaoExpr},
                atualizado_em;
        `;

        const result = await pool.query(sql, params);
        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Aluno não encontrado." });
        }

        const alunoAtualizado = result.rows[0];
        __bumpVersion(tenantId);
        return res.json(alunoAtualizado);
    } catch (err) {
        console.error("Erro ao atualizar aluno:", err);
        return res.status(500).json({ error: "Erro ao salvar aluno." });
    }
});

router.get("/:id/historico", async (req, res) => {
    try {
        const alunoId = parseInt(req.params.id, 10);
        if (Number.isNaN(alunoId)) {
            return res.status(400).json({ error: "ID de aluno inválido." });
        }

        const tenantId = requireTenantId(req);
        const columnSupport = await getAlunosColumnSupport();

        const alunoParams = [alunoId];
        let alunoTenantWhere = '';
        if (columnSupport.alunosMunicipaisTenantId) {
            alunoParams.push(tenantId);
            alunoTenantWhere = 'AND a.tenant_id = $2';
        }

        const alunoSql = `
            SELECT
                a.id,
                a.id_pessoa,
                a.pessoa_nome,
                a.cpf,
                a.status,
                a.unidade_ensino,
                a.turma,
                a.ano,
                a.modalidade,
                a.etapa,
                a.data_matricula,
                a.responsavel,
                a.telefone_responsavel
            FROM alunos_municipais a
            WHERE a.id = $1
            ${alunoTenantWhere}
            LIMIT 1
        `;

        const alunoResult = await pool.query(alunoSql, alunoParams);
        if (!alunoResult.rowCount) {
            return res.status(404).json({ error: "Aluno não encontrado." });
        }

        const vinculosTenantJoin = columnSupport.alunosEscolasTenantId && columnSupport.escolasTenantId
            ? 'AND e.tenant_id = ae.tenant_id'
            : '';
        const vinculosWhereTenant = columnSupport.alunosEscolasTenantId
            ? 'AND ae.tenant_id = $2'
            : '';
        const vinculosParams = columnSupport.alunosEscolasTenantId ? [alunoId, tenantId] : [alunoId];
        const vinculosSql = `
            SELECT
                ae.id,
                ae.escola_id,
                e.nome AS escola_nome,
                ae.ano_letivo,
                ae.turma,
                ae.atualizado_em
            FROM alunos_escolas ae
            LEFT JOIN escolas e
              ON e.id = ae.escola_id
             ${vinculosTenantJoin}
            WHERE ae.aluno_id = $1
            ${vinculosWhereTenant}
            ORDER BY ae.ano_letivo DESC NULLS LAST, ae.atualizado_em DESC NULLS LAST, ae.id DESC
        `;
        const vinculosResult = await pool.query(vinculosSql, vinculosParams);
        const vinculos = vinculosResult.rows || [];

        let historicoRows = [];
        try {
            const historicoParams = [alunoId];
            let historicoTenantWhere = '';
            if (columnSupport.alunosMunicipaisTenantId) {
                historicoParams.push(tenantId);
                historicoTenantWhere = 'AND h.tenant_id = $2';
            }
            const historicoSql = `
                SELECT
                    h.id,
                    h.tipo_evento,
                    h.ano_letivo,
                    h.turma,
                    h.turma_destino,
                    h.status_aluno,
                    h.criado_em,
                    h.detalhes,
                    eo.nome AS escola_nome,
                    ed.nome AS escola_destino_nome
                FROM alunos_escolas_historico h
                LEFT JOIN escolas eo ON eo.id = h.escola_id
                LEFT JOIN escolas ed ON ed.id = h.escola_destino_id
                WHERE h.aluno_id = $1
                ${historicoTenantWhere}
                ORDER BY h.criado_em DESC, h.id DESC
            `;
            const historicoResult = await pool.query(historicoSql, historicoParams);
            historicoRows = historicoResult.rows || [];
        } catch (err) {
            if (String(err?.code) !== '42P01') throw err;
            historicoRows = [];
        }

        const timeline = [];
        const seenSynthetic = new Set();

        historicoRows.forEach((item) => {
            timeline.push({
                id: item.id,
                origem: 'historico',
                tipo_evento: item.tipo_evento,
                tipo_label: formatHistoricoTipo(item.tipo_evento),
                ano_letivo: item.ano_letivo,
                escola_nome: item.escola_nome,
                escola_destino_nome: item.escola_destino_nome,
                turma: item.turma,
                turma_destino: item.turma_destino,
                status_aluno: item.status_aluno,
                criado_em: item.criado_em,
                detalhes: item.detalhes || {}
            });
            const key = `${item.ano_letivo || ''}::${item.escola_destino_nome || item.escola_nome || ''}::${item.turma_destino || item.turma || ''}`;
            seenSynthetic.add(key);
        });

        vinculos.forEach((item) => {
            const key = `${item.ano_letivo || ''}::${item.escola_nome || ''}::${item.turma || ''}`;
            if (seenSynthetic.has(key)) return;
            timeline.push({
                id: `v-${item.id}`,
                origem: 'vinculo_atual',
                tipo_evento: 'VINCULO_REGISTRADO',
                tipo_label: 'Vínculo escolar registrado',
                ano_letivo: item.ano_letivo,
                escola_nome: item.escola_nome,
                escola_destino_nome: item.escola_nome,
                turma: item.turma,
                turma_destino: item.turma,
                status_aluno: alunoResult.rows[0].status,
                criado_em: item.atualizado_em,
                detalhes: {}
            });
        });

        timeline.sort((a, b) => {
            const dateA = new Date(a?.criado_em || 0).valueOf();
            const dateB = new Date(b?.criado_em || 0).valueOf();
            if (dateA !== dateB) return dateB - dateA;
            return Number(b?.ano_letivo || 0) - Number(a?.ano_letivo || 0);
        });

        const vinculoAtual = vinculos[0] || null;
        const anos = Array.from(new Set(vinculos.map((item) => item.ano_letivo).filter(Boolean))).sort((a, b) => b - a);

        return res.json({
            aluno: alunoResult.rows[0],
            resumo: {
                status_atual: alunoResult.rows[0].status || null,
                escola_atual: vinculoAtual?.escola_nome || alunoResult.rows[0].unidade_ensino || null,
                turma_atual: vinculoAtual?.turma || alunoResult.rows[0].turma || null,
                ano_letivo_atual: vinculoAtual?.ano_letivo || null,
                total_vinculos: vinculos.length,
                total_movimentacoes: timeline.length,
                anos_letivos: anos
            },
            vinculos,
            historico: timeline
        });
    } catch (err) {
        console.error("Erro ao carregar histórico do aluno:", err);
        return res.status(500).json({ error: "Erro ao carregar histórico do aluno." });
    }
});


/**
 * DELETE /api/alunos/:id
 * Remove aluno e vinculações com escolas.
 */
router.delete("/:id", async (req, res) => {
    const { id } = req.params;
    const tenantId = requireTenantId(req);

    // Por padrão, a importação NÃO exclui alunos que não vieram na planilha.
    // Para habilitar a sincronização com exclusão, use ?sync_delete=1 (ou campo sync_delete=true no form).
    const syncDelete = ["1", "true", "yes", "sim"].includes(String((req.query?.sync_delete ?? req.body?.sync_delete ?? "")).toLowerCase());

    try {
        await pool.query(
            "DELETE FROM alunos_escolas ae USING alunos_municipais a WHERE ae.aluno_id = a.id AND a.id = $1 AND a.tenant_id = $2",
            [id, tenantId]
        );
        await pool.query(
            "DELETE FROM alunos_pontos ap USING alunos_municipais a WHERE ap.aluno_id = a.id AND a.id = $1 AND a.tenant_id = $2",
            [id, tenantId]
        );

        const result = await pool.query(
            "DELETE FROM alunos_municipais WHERE id = $1 AND tenant_id = $2",
            [id, tenantId]
        );

        if (result.rowCount === 0) {
            __bumpVersion(tenantId);
            return res.status(404).json({ error: "Aluno não encontrado." });
        }
        __bumpVersion(tenantId);
        return res.status(204).send();
    } catch (err) {
        console.error("Erro ao excluir aluno:", err);
        return res.status(500).json({ error: "Erro ao excluir aluno." });
    }
});


/**
 * PUT /api/alunos/:id/localizacao
 * Atualiza localização e flags de transporte.
 */
router.put("/:id/localizacao", async (req, res) => {
    const { id } = req.params;
    const tenantId = requireTenantId(req);
    const {
        latitude,
        longitude,
        transporte_apto,
        transporte_escolar_publico_utiliza
    } = req.body || {};

    try {
        const lat = parseFloat(latitude);
        const lng = parseFloat(longitude);

        if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
            return res
                .status(400)
                .json({ error: "Latitude e longitude inválidas." });
        }

        let flagApto = null;
        if (typeof transporte_apto === "boolean") {
            flagApto = transporte_apto;
        } else if (typeof transporte_apto === "string") {
            const t = transporte_apto.toLowerCase();
            if (t === "true" || t === "1" || t === "apto") flagApto = true;
            else if (t === "false" || t === "0" || t === "nao") flagApto = false;
        }

        const vTransporteUtiliza = sanitizeField(
            transporte_escolar_publico_utiliza
        );

        const sql = `
            UPDATE alunos_municipais
            SET
              localizacao = ST_SetSRID(ST_MakePoint($1, $2), 4326),
              transporte_apto = COALESCE($3, transporte_apto),
              transporte_escolar_publico_utiliza = COALESCE($4, transporte_escolar_publico_utiliza),
              atualizado_em = NOW()
            WHERE id = $5 AND tenant_id = $6
            RETURNING
              id,
              pessoa_nome,
              unidade_ensino,
              transporte_apto,
              transporte_escolar_publico_utiliza,
              ST_AsGeoJSON(localizacao)::json AS localizacao_geojson;
        `;

        const result = await pool.query(sql, [
            lng,
            lat,
            flagApto,
            vTransporteUtiliza,
            id,
            tenantId
        ]);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Aluno não encontrado." });
        }

        const alunoAtualizado = result.rows[0];
        __bumpVersion(tenantId);
        return res.json(alunoAtualizado);
    } catch (err) {
        console.error(
            "Erro ao atualizar localização do aluno:",
            err
        );
        return res.status(500).json({
            error: "Erro ao atualizar localização do aluno."
        });
    }
});


/**

/**
 * GET /api/alunos/:id/termo-cadastro-pdf?signer=filiacao1|filiacao2|responsavel
 * Gera o "Termo de confirmação de critérios" em PDF.
 * Suporta alunos municipais (alunos_municipais) e estaduais (alunos_municipais).
 */
router.get("/:id/termo-cadastro-pdf", async (req, res) => {
    const tenantId = requireTenantId(req);
    const id = Number.parseInt(String(req.params.id || ""), 10);
    const signerOpt = String(req.query.signer || "filiacao1").trim();
    const tipo = String(req.query.tipo || "").trim().toLowerCase();

    if (!Number.isInteger(id) || id <= 0) {
        return res.status(400).json({ error: "ID inválido." });
    }

    try {
        // Busca aluno com preferência por tipo (evita conflito de IDs entre tabelas)
        let aluno = null;

        async function buscarMunicipal() {
            const r = await pool.query(
                `SELECT * FROM alunos_municipais WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
                [tenantId, id]
            );
            return r.rows[0] || null;
        }

        async function buscarEstadual() {
            const r = await pool.query(
                `SELECT * FROM alunos_municipais WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
                [tenantId, id]
            );
            return r.rows[0] || null;
        }

        if (tipo === "estadual") {
            aluno = await buscarEstadual();
            if (!aluno) aluno = await buscarMunicipal();
        } else if (tipo === "municipal") {
            aluno = await buscarMunicipal();
            if (!aluno) aluno = await buscarEstadual();
        } else {
            // fallback compatível
            aluno = await buscarMunicipal();
            if (!aluno) aluno = await buscarEstadual();
        }

        if (!aluno) {
            return res.status(404).json({ error: "Aluno não encontrado." });
        }

        // Escola (tenta via relação; se não houver, cai no campo textual unidade_ensino)
        const escolaRes = await pool.query(
            `
            SELECT e.id, e.nome, e.codigo_inep
            FROM escolas e
            JOIN alunos_escolas ae ON ae.escola_id = e.id
            WHERE ae.tenant_id = $1 AND ae.aluno_id = $2
            ORDER BY ae.id DESC
            LIMIT 1
            `,
            [tenantId, id]
        );
        const escolaNome = (escolaRes.rowCount ? escolaRes.rows[0].nome : null) || (aluno.unidade_ensino || "Não informado");
        const codigoInep = (escolaRes.rowCount ? escolaRes.rows[0].codigo_inep : null) || (aluno.codigo_inep || "");

        // Resolve nome do assinante conforme opção (não é obrigatório ter filiação)
        const f1 = (aluno.filiacao_1 || "").toString().trim();
        const f2 = (aluno.filiacao_2 || "").toString().trim();
        const respNome = (aluno.responsavel || "").toString().trim();

        let signerName = f1;
        if (signerOpt === "filiacao2") signerName = f2 || f1 || respNome;
        else if (signerOpt === "responsavel") signerName = respNome || f1 || f2;
        signerName = (signerName || "Não informado").toString().trim();

        // Branding
        const branding = await getBranding(tenantId);

        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", 'inline; filename="termo-confirmacao-criterios.pdf"');

        const doc = new PDFDocument({ size: "A4", margin: 50 });
        doc.pipe(res);

        drawCabecalho(doc, branding);

        doc.moveDown(1);
        doc.fontSize(14).text("TERMO DE CONFIRMAÇÃO DE CRITÉRIOS - TRANSPORTE ESCOLAR", { align: "center" });
        doc.moveDown(1);

        const linhas = [
            ["Aluno", aluno.pessoa_nome || "Não informado"],
            ["CPF", aluno.cpf || "Não informado"],
            ["Data de nascimento", aluno.data_nascimento ? String(aluno.data_nascimento).slice(0, 10) : "Não informado"],
            ["Escola (unidade de ensino)", escolaNome],
            ["Código INEP", codigoInep || "—"],
            ["Endereço", [aluno.rua, aluno.numero_pessoa_endereco, aluno.bairro].filter(Boolean).join(", ") || "Não informado"],
            ["CEP", aluno.cep || "Não informado"],
            ["Zona", aluno.zona || "Não informado"],
            ["Carro adaptado", aluno.carro_adaptado ? "Sim" : "Não"]
        ];

        doc.fontSize(11);
        linhas.forEach(([k, v]) => {
            doc.font("Helvetica-Bold").text(k + ":", { continued: true });
            doc.font("Helvetica").text(" " + String(v || "—"));
        });

        doc.moveDown(1);
        doc.font("Helvetica").fontSize(11).text(
            "Declaro que as informações acima são verdadeiras e que estou ciente dos critérios e regras do transporte escolar, incluindo atualizações de endereço, zoneamento e condições de elegibilidade.",
            { align: "justify" }
        );

        doc.moveDown(2);
        doc.text(`Assinante (selecionado): ${signerName}`, { align: "left" });

        doc.moveDown(3);
        doc.text("_____________________________________________", { align: "center" });
        doc.text(signerName, { align: "center" });
        doc.moveDown(1);
        doc.text("Data: ____/____/________", { align: "center" });

        drawRodape(doc, branding);
        doc.end();
    } catch (err) {
        console.error(err);
        return res.status(500).json({ error: "Erro ao gerar PDF." });
    }
});

/**
 * GET /api/alunos/:id/termo-desembarque-pdf
 * Gera o Termo de Responsabilidade para autorização de desembarque sem acompanhante
 * (aplicável para alunos entre 8 anos completos e menores de 18 anos).
 *
 * Query:
 *  - signer: Nome do responsável que irá assinar o termo (obrigatório)
 *
 * Observação:
 *  - Este termo não altera, por si só, o status do aluno. Ele é um documento para impressão/assinatura.
 */

/**
 * GET /api/alunos/:id
 * Retorna os dados completos de um aluno por ID (necessário para edição via mapa quando o aluno não está na página atual).
 */
router.get("/:id", async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const id = Number(req.params.id);
        if (!Number.isFinite(id) || id <= 0) {
            return res.status(400).json({ error: "ID inválido." });
        }

        const sql = `
            SELECT
              a.id,
              a.pessoa_nome,
              a.cpf,
              a.sexo,
              a.ano,
              a.turma,
              a.status,
              a.unidade_ensino,
              a.transporte_escolar_publico_utiliza,
              a.transporte_apto,
              a.cep,
              a.rua,
              a.bairro,
              a.numero_pessoa_endereco,
              a.zona,
              a.id_pessoa,
              a.data_nascimento,
              a.filiacao_1,
              a.telefone_filiacao_1,
              a.filiacao_2,
              a.telefone_filiacao_2,
              a.responsavel,
              a.telefone_responsavel,
              a.deficiencia,
              a.rota_exclusiva,
              a.carro_adaptado,
              ST_AsGeoJSON(a.localizacao)::json AS localizacao_geojson,
              a.codigo_inep,
              ae.ano_letivo,
              ae.turma AS turma_escola,
              e.id AS escola_id,
              e.nome AS escola_nome
            FROM alunos_municipais a
            LEFT JOIN LATERAL (
                SELECT ae.escola_id, ae.ano_letivo, ae.turma, ae.atualizado_em, ae.id
                FROM alunos_escolas ae
                WHERE ae.aluno_id = a.id
                  AND ae.tenant_id = a.tenant_id
                ORDER BY ae.ano_letivo DESC NULLS LAST, ae.atualizado_em DESC NULLS LAST, ae.id DESC
                LIMIT 1
            ) ae ON TRUE
            LEFT JOIN escolas e
              ON e.id = ae.escola_id
            WHERE a.tenant_id = $1
              AND a.id = $2
            LIMIT 1;
        `;

        const result = await pool.query(sql, [tenantId, id]);
        const aluno = result.rows?.[0] || null;

        if (!aluno) return res.status(404).json({ error: "Aluno não encontrado." });

        __bumpVersion(tenantId);
        // LGPD: por padrão, não enviar CPF completo para o front.
        const includeSensitive = String(req.query.include_sensitive || "") === "1" && canViewSensitive(req);

        const payload = { ...aluno };
        payload.cpf_masked = maskCpf(payload.cpf);
        payload.cpf_last2 = last2Cpf(payload.cpf);
        if (!includeSensitive) delete payload.cpf;

        return res.json(payload);
    } catch (err) {
        console.error("Erro ao buscar aluno por id:", err);
        return res.status(500).json({ error: "Erro ao buscar aluno." });
    }
});

router.get("/:id/termo-desembarque-pdf", async (req, res) => {
    const { id } = req.params;
    const signerRaw = (req.query.signer || "").toString().trim();

    if (!signerRaw) {
        return res.status(400).json({ error: "Parâmetro 'signer' é obrigatório." });
    }

    try {
        const tenantId = requireTenantId(req);
        const tipo = String(req.query.tipo || "").trim().toLowerCase();

        async function buscarAlunoSql(tabela) {
            const sql = `
                SELECT
                    a.id,
                    a.pessoa_nome,
                    a.cpf,
                    a.data_nascimento,
                    a.rua,
                    a.bairro,
                    a.numero_pessoa_endereco,
                    a.cep,
                    a.filiacao_1,
                    a.filiacao_2,
                    a.responsavel,
                    a.telefone_responsavel,
                    e.nome AS escola_nome
                FROM ${tabela} a
                LEFT JOIN alunos_escolas ae ON ae.aluno_id = a.id AND ae.tenant_id = a.tenant_id
                LEFT JOIN escolas e ON e.id = ae.escola_id AND e.tenant_id = a.tenant_id
                WHERE a.tenant_id = $1 AND a.id = $2
                LIMIT 1;
            `;
            const r = await pool.query(sql, [tenantId, id]);
            return r.rows[0] || null;
        }

        let aluno = null;
        if (tipo === "estadual") {
            aluno = await buscarAlunoSql("alunos_municipais");
            if (!aluno) aluno = await buscarAlunoSql("alunos_municipais");
        } else if (tipo === "municipal") {
            aluno = await buscarAlunoSql("alunos_municipais");
            if (!aluno) aluno = await buscarAlunoSql("alunos_municipais");
        } else {
            aluno = await buscarAlunoSql("alunos_municipais");
            if (!aluno) aluno = await buscarAlunoSql("alunos_municipais");
        }

        if (!aluno) {
            return res.status(404).json({ error: "Aluno não encontrado." });
        }


        // Validação de faixa etária: 8 anos completos e menor de 18 anos
        const hoje = new Date();
        const dn = aluno.data_nascimento ? new Date(aluno.data_nascimento) : null;

        if (!dn || Number.isNaN(dn.valueOf())) {
            return res.status(400).json({
                error: "Aluno sem data de nascimento válida. Não é possível gerar o termo."
            });
        }

        function idadeEmAnos(birth, ref) {
            let age = ref.getFullYear() - birth.getFullYear();
            const m = ref.getMonth() - birth.getMonth();
            if (m < 0 || (m === 0 && ref.getDate() < birth.getDate())) age--;
            return age;
        }

        const idade = idadeEmAnos(dn, hoje);

        if (idade < 8) {
            return res.status(400).json({
                error: "Para alunos com menos de 8 anos, não é permitido desembarque sem responsável."
            });
        }
        if (idade >= 18) {
            return res.status(400).json({
                error: "Para alunos maiores de idade, este termo não se aplica."
            });
        }

        const branding = await getBranding(tenantId);

        const doc = new PDFDocument({ size: "A4", margin: 50 });

        res.setHeader(
            "Content-Disposition",
            `inline; filename=termo_desembarque_sem_acompanhante_${id}.pdf`
        );
        res.setHeader("Content-Type", "application/pdf");

        doc.pipe(res);

        // Cabeçalho dinâmico
        drawCabecalho(doc, branding);

        // Corpo
        doc.y = 130;
        doc.x = 50;

        doc
            .fontSize(14)
            .font("Helvetica-Bold")
            .text("TERMO DE RESPONSABILIDADE", { align: "center" })
            .moveDown(0.2)
            .fontSize(12)
            .text("AUTORIZAÇÃO DE DESEMBARQUE SEM ACOMPANHANTE NO PONTO DE PARADA", {
                align: "center"
            });

        doc.moveDown(1);

        const enderecoParts = [
            aluno.rua,
            aluno.numero_pessoa_endereco ? `nº ${aluno.numero_pessoa_endereco}` : null,
            aluno.bairro ? `Bairro ${aluno.bairro}` : null,
            aluno.cep ? `CEP ${aluno.cep}` : null
        ].filter(Boolean);

        const endereco = enderecoParts.length ? enderecoParts.join(", ") : "Não informado";
        const escolaNome = aluno.escola_nome || "Não informada";

        const dataHoje = hoje.toLocaleDateString("pt-BR");

        doc.font("Helvetica").fontSize(11);

        doc.text(
            `Pelo presente instrumento, o(a) Sr.(a) ${signerRaw}, doravante denominado(a) RESPONSÁVEL LEGAL, ` +
            `declara, para os devidos fins, que está ciente das normas e procedimentos do Transporte Escolar Municipal ` +
            `e, de forma livre e consciente, assume a responsabilidade pela autorização de desembarque do(a) aluno(a) ` +
            `${aluno.pessoa_nome || ""} (ID ${aluno.id}), CPF ${aluno.cpf || "não informado"}, ` +
            `matriculado(a) na unidade escolar ${escolaNome}, com residência em ${endereco}.`,
            { align: "justify" }
        );

        doc.moveDown(1);

        doc.font("Helvetica").text(
            "1.1. O presente Termo tem por objeto a autorização para que o(a) aluno(a) acima identificado(a), " +
            "por se encontrar na faixa etária entre 8 (oito) e 17 (dezessete) anos, possa desembarcar do veículo do " +
            "transporte escolar no ponto de parada designado, sem a presença imediata de responsável no momento do desembarque, " +
            "desde que respeitados os demais critérios e regras do serviço.",
            { align: "justify" }
        );

        doc.moveDown(0.8);

        doc.font("Helvetica").text(
            "2.1. O(A) RESPONSÁVEL LEGAL declara estar ciente de que a autorização aqui concedida implica a assunção " +
            "integral da responsabilidade por quaisquer eventos que ocorram após o desembarque do(a) aluno(a) no ponto de parada, " +
            "incluindo o trajeto até a residência ou local de destino. " +
            "2.2. O(A) RESPONSÁVEL LEGAL compromete-se a orientar o(a) aluno(a) quanto a condutas seguras e a manter atualizados " +
            "seus dados de contato junto à Secretaria Municipal de Educação e/ou unidade gestora do transporte escolar.",
            { align: "justify" }
        );

        doc.moveDown(0.8);

        doc.font("Helvetica").text(
            "4.1. Este Termo passa a produzir efeitos a partir de sua assinatura e poderá ser revogado a qualquer tempo pelo(a) RESPONSÁVEL LEGAL, " +
            "mediante solicitação formal, ou pela Administração Pública, em razão de descumprimento de regras, alteração de situação do(a) aluno(a) " +
            "ou necessidade de segurança. " +
            "4.2. Alterações de endereço, telefone, escola, ponto de parada ou responsável devem ser comunicadas imediatamente para atualização cadastral.",
            { align: "justify" }
        );

        doc.moveDown(0.8);

        doc.font("Helvetica").text(
            "5.1. Os dados pessoais constantes deste Termo serão tratados exclusivamente para fins de gestão do transporte escolar e cumprimento de obrigações legais e administrativas.",
            { align: "justify" }
        );

        doc.moveDown(1);

        doc.text(
            `Por estar de pleno acordo, firmo o presente Termo em ${dataHoje}.`,
            { align: "justify" }
        );

        doc.moveDown(8);

        // Assinaturas
        doc.text("_____________________________________________", { align: "center" });
        doc.font("Helvetica-Bold").text("ASSINATURA DO(A) RESPONSÁVEL LEGAL", { align: "center" });
        doc.font("Helvetica").text(`Nome: ${signerRaw}`, { align: "center" });


        // Rodapé dinâmico
        drawRodape(doc, branding);

        doc.end();
    } catch (err) {
        console.error("Erro ao gerar termo de desembarque (PDF):", err);
        return res.status(500).json({ error: "Erro ao gerar termo de desembarque." });
    }
});


router.post('/:id/reavaliacoes', async (req, res) => {
    const { id } = req.params;
    const tenantId = requireTenantId(req);

    const {
        distancia_km,
        resultado_primario,
        detalhe_primario,
        latitude,
        longitude,
        riscos,
        zoneamento_status,
        observacao_extra
    } = req.body || {};

    if (
        distancia_km === undefined ||
        resultado_primario === undefined ||
        detalhe_primario === undefined ||
        latitude === undefined ||
        longitude === undefined
    ) {
        return res.status(400).json({
            error: 'Parâmetros obrigatórios ausentes: distancia_km, resultado_primario, detalhe_primario, latitude, longitude.'
        });
    }

    try {
        const alunoId = parseInt(id, 10);
        if (isNaN(alunoId)) {
            return res.status(400).json({ error: 'ID de aluno inválido.' });
        }

        const sqlTenant = `
            INSERT INTO alunos_reavaliacoes (
                tenant_id,
                aluno_id,
                distancia_km,
                resultado_primario,
                detalhe_primario,
                latitude,
                longitude,
                riscos,
                zoneamento_status,
                observacao_extra
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
            RETURNING *
        `;

        const sqlNoTenant = `
            INSERT INTO alunos_reavaliacoes (
                aluno_id,
                distancia_km,
                resultado_primario,
                detalhe_primario,
                latitude,
                longitude,
                riscos,
                zoneamento_status,
                observacao_extra
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
            RETURNING *
        `;

        const valuesTenant = [
            tenantId,
            alunoId,
            Number(distancia_km),
            String(resultado_primario),
            String(detalhe_primario),
            Number(latitude),
            Number(longitude),
            Array.isArray(riscos) ? riscos : [],
            zoneamento_status || null,
            observacao_extra || null
        ];

        const valuesNoTenant = valuesTenant.slice(1);

        const result = await queryWithOptionalTenant(
            pool,
            sqlTenant,
            valuesTenant,
            sqlNoTenant,
            valuesNoTenant
        );

        if (!result.rows.length) {
            return res.status(500).json({ error: 'Falha ao registrar reavaliação.' });
        }

        return res.json(result.rows[0]);
    } catch (err) {
        console.error('Erro ao inserir reavaliação:', err);
        return res.status(500).json({ error: 'Erro interno ao salvar reavaliação.' });
    }
});

router.get('/:alunoId/reavaliacoes/:reavaliacaoId/comprovante-pdf', async (req, res) => {
    const { alunoId, reavaliacaoId } = req.params;

    try {
        const tenantId = requireTenantId(req);

        const sqlTenant = `
      SELECT
        r.id,
        r.aluno_id,
        r.distancia_km,
        r.resultado_primario,
        r.detalhe_primario,
        r.latitude,
        r.longitude,
        r.riscos,
        r.zoneamento_status,
        r.observacao_extra,
        r.criado_em,
        a.pessoa_nome AS aluno_nome,
        a.cpf,
        a.rua,
        a.bairro,
        a.numero_pessoa_endereco,
        a.deficiencia,
        e.nome AS escola_nome,
        a.turma
      FROM alunos_reavaliacoes r
      JOIN alunos_municipais a ON a.id = r.aluno_id
      LEFT JOIN alunos_escolas ae ON ae.aluno_id = a.id
      LEFT JOIN escolas e ON e.id = ae.escola_id
      WHERE r.id = $1 AND r.aluno_id = $2 AND r.tenant_id = $3
      LIMIT 1
    `;
        const sqlNoTenant = `
      SELECT
        r.id,
        r.aluno_id,
        r.distancia_km,
        r.resultado_primario,
        r.detalhe_primario,
        r.latitude,
        r.longitude,
        r.riscos,
        r.zoneamento_status,
        r.observacao_extra,
        r.criado_em,
        a.pessoa_nome AS aluno_nome,
        a.cpf,
        a.rua,
        a.bairro,
        a.numero_pessoa_endereco,
        a.deficiencia,
        e.nome AS escola_nome,
        a.turma
      FROM alunos_reavaliacoes r
      JOIN alunos_municipais a ON a.id = r.aluno_id
      LEFT JOIN alunos_escolas ae ON ae.aluno_id = a.id
      LEFT JOIN escolas e ON e.id = ae.escola_id
      WHERE r.id = $1 AND r.aluno_id = $2
      LIMIT 1
    `;

        const result = await queryWithOptionalTenant(
            pool,
            sqlTenant,
            [reavaliacaoId, alunoId, tenantId],
            sqlNoTenant,
            [reavaliacaoId, alunoId]
        );

        if (result.rows.length === 0) {
            return res.status(404).json({
                success: false,
                message: 'Reavaliação não encontrada para este aluno.'
            });
        }

        const dados = result.rows[0];

        // Branding do tenant
        const branding = await getBranding(tenantId);

        const doc = new PDFDocument({ size: 'A4', margin: 50 });

        res.setHeader(
            'Content-Disposition',
            `inline; filename=comprovante_reavaliacao_${alunoId}_${reavaliacaoId}.pdf`
        );
        res.setHeader('Content-Type', 'application/pdf');

        doc.pipe(res);

        // Cabeçalho dinâmico
        drawCabecalho(doc, branding);

        doc.y = 130;
        doc.x = 50;

        doc
            .fontSize(14)
            .font('Helvetica-Bold')
            .text('COMPROVANTE DE REAVALIAÇÃO DE ELEGIBILIDADE', {
                align: 'center'
            });

        doc.moveDown(1);

        const dataReav = dados.criado_em
            ? new Date(dados.criado_em).toLocaleString('pt-BR')
            : '';

        const endereco = `${dados.rua || ''}, nº ${dados.numero_pessoa_endereco || ''}, Bairro ${dados.bairro || ''}`;

        doc
            .fontSize(12)
            .font('Helvetica')
            .text(`Aluno(a): ${dados.aluno_nome || ''}`, { align: 'justify' })
            .moveDown(0.3)
            .text(`CPF: ${dados.cpf || ''}`)
            .moveDown(0.3)
            .text(`Escola: ${dados.escola_nome || 'Não informada'}`)
            .moveDown(0.3)
            .text(`Turma: ${dados.turma || 'Não informada'}`)
            .moveDown(0.3)
            .text(`Endereço: ${endereco}`, { align: 'justify' })
            .moveDown(0.3)
            .text(`Data/hora da reavaliação: ${dataReav || 'Não informada'}`);

        doc.moveDown(1);

        doc
            .font('Helvetica-Bold')
            .text('RESULTADO DA REAVALIAÇÃO:', { align: 'left' });

        doc.moveDown(0.3);

        doc
            .font('Helvetica')
            .text(`Resultado primário: ${dados.resultado_primario || ''}`, { align: 'justify' })
            .moveDown(0.3)
            .text(
                `Distância considerada: ${typeof dados.distancia_km === 'number'
                    ? dados.distancia_km.toFixed(2) + ' km'
                    : 'Não informada'
                }`
            )
            .moveDown(0.3)
            .text(`Detalhamento: ${dados.detalhe_primario || ''}`, { align: 'justify' });

        doc.moveDown(1);

        doc.font('Helvetica-Bold').text('RISCOS IDENTIFICADOS:', { align: 'left' });
        doc.moveDown(0.3);

        if (Array.isArray(dados.riscos) && dados.riscos.length) {
            doc.font('Helvetica').list(dados.riscos, { align: 'justify' });
        } else {
            doc.font('Helvetica').text('Nenhum risco específico registrado.', { align: 'justify' });
        }

        doc.moveDown(1);

        doc.font('Helvetica-Bold').text('SITUAÇÃO NO ZONEAMENTO:', { align: 'left' });
        doc.moveDown(0.3);

        let textoZoneamento = 'Não informado.';
        if (dados.zoneamento_status === 'dentro') {
            textoZoneamento = 'Residência localizada DENTRO do zoneamento da escola.';
        } else if (dados.zoneamento_status === 'fora') {
            textoZoneamento = 'Residência localizada FORA do zoneamento da escola.';
        }

        doc.font('Helvetica').text(textoZoneamento, { align: 'justify' });

        doc.moveDown(1);

        if (dados.observacao_extra) {
            doc.font('Helvetica-Bold').text('OBSERVAÇÕES COMPLEMENTARES:', { align: 'left' });
            doc.moveDown(0.3);
            doc.font('Helvetica').text(dados.observacao_extra, { align: 'justify' });
            doc.moveDown(1);
        }

        doc
            .font('Helvetica')
            .text(
                'Este comprovante registra o resultado da reavaliação de elegibilidade ao transporte escolar, ' +
                'considerando a distância entre residência e escola, as condições de acesso e os riscos identificados ' +
                'no percurso do aluno.'
            );

        doc.moveDown(2);
        doc.text('_____________________________________________', { align: 'center' });
        doc.font('Helvetica-Bold').text('Responsável pela análise / equipe técnica', { align: 'center' });
        doc.moveDown(2);

        // Rodapé dinâmico
        drawRodape(doc, branding);

        doc.end();
    } catch (err) {
        console.error('Erro ao gerar comprovante de reavaliação:', err);
        return res.status(500).json({
            success: false,
            message: 'Erro ao gerar comprovante de reavaliação.'
        });
    }
});

export default router;
