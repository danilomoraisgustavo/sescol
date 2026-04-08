import express from "express";
import PDFDocument from "pdfkit";
import pool from "../db.js";
import { getBranding, drawCabecalho, drawRodape } from "../services/brandingConfig.js";

const router = express.Router();
let tenantColumnCache = null;
let tenantColumnCacheAt = 0;
const TENANT_CACHE_TTL_MS = 5 * 60 * 1000;
let columnCache = null;
let columnCacheAt = 0;
let escolaTurmasTableEnsured = false;
let alunoComplementosTableEnsured = false;

function buildPoint(lat, lng) {
    return `ST_SetSRID(ST_Point(${lng}, ${lat}), 4326)`;
}

async function getTenantColumnSupport() {
    const now = Date.now();
    if (tenantColumnCache && (now - tenantColumnCacheAt) < TENANT_CACHE_TTL_MS) {
        return tenantColumnCache;
    }

    const tables = ['escolas', 'escola_zoneamento', 'zoneamentos', 'alunos_escolas', 'alunos_municipais'];
    const { rows } = await pool.query(
        `
        SELECT table_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
          AND column_name = 'tenant_id'
        `,
        [tables],
    );

    const support = new Set((rows || []).map((row) => row.table_name));
    tenantColumnCache = Object.fromEntries(tables.map((table) => [table, support.has(table)]));
    tenantColumnCacheAt = now;
    return tenantColumnCache;
}

async function getColumnSupport() {
    const now = Date.now();
    if (columnCache && (now - columnCacheAt) < TENANT_CACHE_TTL_MS) {
        return columnCache;
    }

    const tables = ['alunos_municipais'];
    const { rows } = await pool.query(
        `
        SELECT table_name, column_name
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = ANY($1::text[])
        `,
        [tables],
    );

    const grouped = {};
    for (const row of rows || []) {
        grouped[row.table_name] = grouped[row.table_name] || new Set();
        grouped[row.table_name].add(row.column_name);
    }

    columnCache = {
        alunosMunicipaisNome: grouped.alunos_municipais?.has('nome') || false,
        alunosMunicipaisPessoaNome: grouped.alunos_municipais?.has('pessoa_nome') || false,
        alunosMunicipaisTurno: grouped.alunos_municipais?.has('turno') || false,
        alunosMunicipaisFormatoLetivo: grouped.alunos_municipais?.has('formato_letivo') || false,
        alunosMunicipaisTenantId: grouped.alunos_municipais?.has('tenant_id') || false,
        alunosMunicipaisRotaExclusiva: grouped.alunos_municipais?.has('rota_exclusiva') || false,
        alunosMunicipaisCarroAdaptado: grouped.alunos_municipais?.has('carro_adaptado') || false,
        alunosMunicipaisTurnoSimplificado: grouped.alunos_municipais?.has('turno_simplificado') || false,
    };
    columnCacheAt = now;
    return columnCache;
}

async function ensureEscolaTurmasTable() {
    if (escolaTurmasTableEnsured) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS escola_turmas (
            id SERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            escola_id INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
            nome TEXT NOT NULL,
            ano_letivo INTEGER NULL,
            turno TEXT NULL,
            tipo_turma TEXT NULL,
            organizacao_pedagogica TEXT NULL,
            etapa TEXT NULL,
            modalidade TEXT NULL,
            multisseriada BOOLEAN NOT NULL DEFAULT FALSE,
            series_abrangidas TEXT[] NULL,
            dias_semana TEXT[] NULL,
            horario_inicio TEXT NULL,
            horario_fim TEXT NULL,
            capacidade INTEGER NULL,
            limite_planejado_alunos INTEGER NULL,
            total_estudantes_publico_ee INTEGER NULL,
            limite_estudantes_publico_ee INTEGER NULL,
            professor_referencia TEXT NULL,
            auxiliar_apoio BOOLEAN NOT NULL DEFAULT FALSE,
            interprete_libras BOOLEAN NOT NULL DEFAULT FALSE,
            atendimento_educacional_especializado BOOLEAN NOT NULL DEFAULT FALSE,
            sala TEXT NULL,
            observacoes TEXT NULL,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            criado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_escola_turmas_escola
        ON escola_turmas (escola_id)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_escola_turmas_tenant
        ON escola_turmas (tenant_id, escola_id)
    `);

    await pool.query(`
        ALTER TABLE escola_turmas
        ADD COLUMN IF NOT EXISTS tipo_turma TEXT NULL,
        ADD COLUMN IF NOT EXISTS organizacao_pedagogica TEXT NULL,
        ADD COLUMN IF NOT EXISTS multisseriada BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS series_abrangidas TEXT[] NULL,
        ADD COLUMN IF NOT EXISTS dias_semana TEXT[] NULL,
        ADD COLUMN IF NOT EXISTS horario_inicio TEXT NULL,
        ADD COLUMN IF NOT EXISTS horario_fim TEXT NULL,
        ADD COLUMN IF NOT EXISTS limite_planejado_alunos INTEGER NULL,
        ADD COLUMN IF NOT EXISTS total_estudantes_publico_ee INTEGER NULL,
        ADD COLUMN IF NOT EXISTS limite_estudantes_publico_ee INTEGER NULL,
        ADD COLUMN IF NOT EXISTS professor_referencia TEXT NULL,
        ADD COLUMN IF NOT EXISTS auxiliar_apoio BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS interprete_libras BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS atendimento_educacional_especializado BOOLEAN NOT NULL DEFAULT FALSE
    `);

    escolaTurmasTableEnsured = true;
}

async function ensureAlunoComplementosTable() {
    if (alunoComplementosTableEnsured) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS aluno_cadastros_complementares (
            id SERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            aluno_id INTEGER NOT NULL,
            foto_url TEXT NULL,
            nome_social TEXT NULL,
            nis TEXT NULL,
            cartao_sus TEXT NULL,
            rg TEXT NULL,
            certidao_nascimento TEXT NULL,
            naturalidade TEXT NULL,
            nacionalidade TEXT NULL,
            cor_raca TEXT NULL,
            email_responsavel TEXT NULL,
            telefone_emergencia TEXT NULL,
            contato_emergencia_nome TEXT NULL,
            contato_emergencia_parentesco TEXT NULL,
            complemento_endereco TEXT NULL,
            ponto_referencia TEXT NULL,
            diagnosticos TEXT NULL,
            medicacoes TEXT NULL,
            restricoes_saude TEXT NULL,
            alergias TEXT NULL,
            observacoes_gerais TEXT NULL,
            dados_complementares JSONB NOT NULL DEFAULT '{}'::jsonb,
            criado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            CONSTRAINT uq_aluno_cadastros_complementares UNIQUE (aluno_id, tenant_id)
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_aluno_cadastros_complementares_aluno
        ON aluno_cadastros_complementares (aluno_id)
    `);

    alunoComplementosTableEnsured = true;
}

async function generateNextNetworkEnrollmentId(client, tenantId) {
    const tenantSupport = await getTenantColumnSupport();
    await client.query('SELECT pg_advisory_xact_lock($1)', [Number(tenantId) > 0 ? Number(tenantId) : 987654]);
    const params = [];
    let tenantWhere = '';

    if (tenantSupport.alunos_municipais && tenantId) {
        params.push(tenantId);
        tenantWhere = `WHERE tenant_id = $1`;
    }

    const result = await client.query(
        `
        SELECT COALESCE(MAX((id_pessoa::text)::bigint), 0) + 1 AS next_id
        FROM alunos_municipais
        ${tenantWhere}
          ${tenantWhere ? 'AND' : 'WHERE'} id_pessoa::text ~ '^[0-9]+$'
        `,
        params,
    );

    return String(result.rows?.[0]?.next_id || 1);
}

function normalizeTurmaKey(nome, anoLetivo) {
    return `${String(nome || '').trim().toLowerCase()}::${anoLetivo || ''}`;
}

function countDistinctAnosLetivos(turmas) {
    const anos = new Set(
        (Array.isArray(turmas) ? turmas : [])
            .map((turma) => parseOptionalInt(turma?.ano_letivo))
            .filter((ano) => ano !== null),
    );
    return anos.size;
}

function decodeGooglePolyline(encoded) {
    if (!encoded) return [];
    let index = 0;
    let lat = 0;
    let lng = 0;
    const coordinates = [];

    while (index < encoded.length) {
        let result = 0;
        let shift = 0;
        let byte = null;

        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        const deltaLat = (result & 1) ? ~(result >> 1) : (result >> 1);
        lat += deltaLat;

        result = 0;
        shift = 0;
        do {
            byte = encoded.charCodeAt(index++) - 63;
            result |= (byte & 0x1f) << shift;
            shift += 5;
        } while (byte >= 0x20);

        const deltaLng = (result & 1) ? ~(result >> 1) : (result >> 1);
        lng += deltaLng;

        coordinates.push([lat / 1e5, lng / 1e5]);
    }

    return coordinates;
}

function haversineMeters(a, b) {
    if (!a || !b) return 0;
    const R = 6371000;
    const toRad = (x) => (x * Math.PI) / 180;
    const dLat = toRad(b.lat - a.lat);
    const dLng = toRad(b.lng - a.lng);
    const lat1 = toRad(a.lat);
    const lat2 = toRad(b.lat);
    const s =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.atan2(Math.sqrt(s), Math.sqrt(1 - s));
}

async function calcularTrajetoPedestre({ origem, destino }) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_KEY;
    if (!apiKey) {
        const distanciaMetros = Math.round(haversineMeters(origem, destino) * 1.25);
        const duracaoSegundos = Math.round((distanciaMetros / 1000) / 4.5 * 3600);
        return {
            provider: 'estimado',
            distance_meters: distanciaMetros,
            duration_seconds: duracaoSegundos,
            distance_text: `${(distanciaMetros / 1000).toFixed(1)} km`,
            duration_text: `${Math.max(1, Math.round(duracaoSegundos / 60))} min`,
            path: [
                [origem.lat, origem.lng],
                [destino.lat, destino.lng],
            ],
        };
    }

    const params = new URLSearchParams();
    params.set('origin', `${origem.lat},${origem.lng}`);
    params.set('destination', `${destino.lat},${destino.lng}`);
    params.set('mode', 'walking');
    params.set('language', 'pt-BR');
    params.set('key', apiKey);

    const resp = await fetch(`https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`);
    if (!resp.ok) {
        throw new Error(`Erro ao chamar Google Directions (${resp.status})`);
    }

    const data = await resp.json();
    if (!data || data.status !== 'OK' || !data.routes || !data.routes.length) {
        const msg = data && data.error_message ? data.error_message : (data && data.status ? data.status : 'Falha ao gerar rota');
        throw new Error(`Google Directions: ${msg}`);
    }

    const route = data.routes[0];
    const legs = route.legs || [];
    const distanceMeters = legs.reduce((sum, leg) => sum + (Number(leg?.distance?.value) || 0), 0);
    const durationSeconds = legs.reduce((sum, leg) => sum + (Number(leg?.duration?.value) || 0), 0);
    const path = decodeGooglePolyline(route.overview_polyline?.points || '');

    return {
        provider: 'google',
        distance_meters: distanceMeters,
        duration_seconds: durationSeconds,
        distance_text: legs[0]?.distance?.text || `${(distanceMeters / 1000).toFixed(1)} km`,
        duration_text: legs[0]?.duration?.text || `${Math.max(1, Math.round(durationSeconds / 60))} min`,
        path,
    };
}

function parseOptionalInt(value) {
    if (value === undefined || value === null || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseOptionalText(value) {
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text ? text : null;
}

function parseOptionalTextArray(value) {
    if (!Array.isArray(value)) return null;
    const arr = value
        .map((item) => String(item || '').trim())
        .filter(Boolean);
    return arr.length ? arr : null;
}

function parseOptionalBoolean(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    if (['1', 'true', 't', 'sim', 's', 'yes', 'y'].includes(normalized)) return true;
    if (['0', 'false', 'f', 'nao', 'não', 'n', 'no'].includes(normalized)) return false;
    return null;
}

function parseOptionalDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.valueOf()) ? null : String(value);
}

function parseOptionalCoordinate(value) {
    if (value === undefined || value === null || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
}

function sanitizeComplementarValue(value) {
    if (value === undefined || value === null || value === '') return null;
    if (typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (Array.isArray(value)) {
        const arr = value
            .map((item) => sanitizeComplementarValue(item))
            .filter((item) => item !== null);
        return arr.length ? arr : null;
    }
    if (typeof value === 'object') {
        const entries = Object.entries(value)
            .map(([key, item]) => [key, sanitizeComplementarValue(item)])
            .filter(([, item]) => item !== null);
        return entries.length ? Object.fromEntries(entries) : null;
    }
    const text = String(value).trim();
    return text ? text : null;
}

function formatDatePtBr(value) {
    if (!value) return "Não informado";
    const date = new Date(value);
    if (Number.isNaN(date.valueOf())) return "Não informado";
    return date.toLocaleDateString("pt-BR");
}

function formatEnderecoAluno(aluno) {
    return [
        aluno?.rua,
        aluno?.numero_pessoa_endereco,
        aluno?.bairro,
        aluno?.cep,
    ].filter(Boolean).join(", ") || "Não informado";
}

/**
 * Tenta resolver o tenant_id do request de forma compatível com diferentes middlewares.
 * - Preferência: req.user.tenant_id / req.user.tenantId
 * - Alternativas: req.tenant_id / req.tenantId
 * - Fallback: header x-tenant-id (string numérica)
 */
function getTenantId(req) {
    const candidates = [
        req?.user?.tenant_id,
        req?.user?.tenantId,
        req?.tenant_id,
        req?.tenantId,
        req?.headers?.["x-tenant-id"],
        req?.headers?.["X-Tenant-Id"],
        req?.headers?.["x-tenantid"],
        req?.headers?.["x-tenant"],
    ];

    for (const c of candidates) {
        if (c === undefined || c === null) continue;
        const n = typeof c === "string" ? Number(c) : Number(c);
        if (Number.isFinite(n) && n > 0) return n;
    }
    return null;
}

async function getTenantIdByEscolaId(client, escolaId) {
    const tenantSupport = await getTenantColumnSupport();
    if (!tenantSupport.escolas) return null;
    const r = await client.query(`SELECT tenant_id FROM escolas WHERE id=$1 LIMIT 1`, [escolaId]);
    return r.rowCount ? Number(r.rows[0].tenant_id) : null;
}

async function loadEscolaDashboardData(escolaId, tenantId, options = {}) {
    const tenantSupport = await getTenantColumnSupport();
    const columnSupport = await getColumnSupport();
    await ensureAlunoComplementosTable();
    const limitAlunos = Number.isFinite(options.limitAlunos) ? Number(options.limitAlunos) : 25;
    const turmaFiltro = parseOptionalText(options.turma);
    const anoLetivoFiltro = parseOptionalInt(options.anoLetivo);
    const alunoNomeExpr = columnSupport.alunosMunicipaisNome
        ? 'a.nome'
        : (columnSupport.alunosMunicipaisPessoaNome ? 'a.pessoa_nome' : "('Aluno #' || a.id::text)");
    const alunoTurnoExpr = columnSupport.alunosMunicipaisTurno
        ? 'a.turno'
        : (columnSupport.alunosMunicipaisFormatoLetivo ? 'a.formato_letivo' : 'NULL');

    const escolaParams = [escolaId];
    const escolaTenantWhere = tenantSupport.escolas && tenantId ? `AND e.tenant_id = $2` : "";
    if (tenantSupport.escolas && tenantId) escolaParams.push(tenantId);

    const escolaZoneamentoTenantClause = tenantSupport.escola_zoneamento && tenantSupport.escolas && tenantId
        ? "AND ez.tenant_id = e.tenant_id"
        : "";

    const escolaSql = `
        SELECT 
            e.*,
            ST_AsGeoJSON(e.localizacao)::json AS localizacao_geojson,
            COALESCE(
                (
                    SELECT json_agg(
                        json_build_object(
                            'id', z.id,
                            'nome', z.nome,
                            'tipo_zona', z.tipo_zona
                        )
                        ORDER BY z.nome
                    )
                    FROM escola_zoneamento ez
                    JOIN zoneamentos z ON z.id = ez.zoneamento_id
                    WHERE ez.escola_id = e.id
                      ${escolaZoneamentoTenantClause}
                ),
            '[]') AS zoneamentos
        FROM escolas e
        WHERE e.id = $1
        ${escolaTenantWhere}
        LIMIT 1
    `;

    const escolaResult = await pool.query(escolaSql, escolaParams);
    if (escolaResult.rowCount === 0) {
        return null;
    }

    const alunosEscolasTenantJoin = tenantSupport.alunos_escolas && tenantId ? "AND ae.tenant_id = $2" : "";
    const alunosMunicipaisTenantJoin = tenantSupport.alunos_municipais && tenantId ? "AND a.tenant_id = $2" : "";
    const usesTenantParam = Boolean(alunosEscolasTenantJoin || alunosMunicipaisTenantJoin);
    const alunoComplementoJoin = tenantId && usesTenantParam
        ? "LEFT JOIN aluno_cadastros_complementares ac ON ac.aluno_id = a.id AND ac.tenant_id = $2"
        : "LEFT JOIN aluno_cadastros_complementares ac ON ac.aluno_id = a.id";
    const metricParams = usesTenantParam ? [escolaId, tenantId] : [escolaId];
    const alunosParams = [...metricParams];
    let alunosFiltrosSql = "";

    if (turmaFiltro) {
        alunosParams.push(turmaFiltro);
        alunosFiltrosSql += ` AND COALESCE(ae.turma, a.turma) = $${alunosParams.length}`;
    }

    if (anoLetivoFiltro !== null) {
        alunosParams.push(anoLetivoFiltro);
        alunosFiltrosSql += ` AND ae.ano_letivo = $${alunosParams.length}`;
    }

    const overviewSql = `
        SELECT
            COUNT(DISTINCT ae.aluno_id)::int AS total_matriculas,
            COUNT(DISTINCT NULLIF(TRIM(COALESCE(ae.turma, '')), ''))::int AS total_turmas,
            COUNT(DISTINCT ae.ano_letivo)::int AS total_anos_letivos,
            COUNT(DISTINCT ae.aluno_id) FILTER (WHERE a.transporte_apto IS TRUE)::int AS total_alunos_apto_transporte
        FROM alunos_escolas ae
        LEFT JOIN alunos_municipais a
          ON a.id = ae.aluno_id
         ${alunosMunicipaisTenantJoin}
        WHERE ae.escola_id = $1
        ${alunosEscolasTenantJoin}
    `;

    const turmasSql = `
        SELECT
            COALESCE(NULLIF(TRIM(COALESCE(ae.turma, '')), ''), 'Sem turma informada') AS turma,
            ae.ano_letivo,
            COUNT(DISTINCT ae.aluno_id)::int AS total_alunos,
            COUNT(DISTINCT ae.aluno_id) FILTER (WHERE a.transporte_apto IS TRUE)::int AS total_apto_transporte
        FROM alunos_escolas ae
        LEFT JOIN alunos_municipais a
          ON a.id = ae.aluno_id
         ${alunosMunicipaisTenantJoin}
        WHERE ae.escola_id = $1
        ${alunosEscolasTenantJoin}
        GROUP BY 1, 2
        ORDER BY ae.ano_letivo DESC NULLS LAST, turma ASC
    `;

    const alunosSql = `
        SELECT
            a.id,
            ${alunoNomeExpr} AS nome,
            a.cpf,
            a.turma,
            ${alunoTurnoExpr} AS turno,
            a.etapa,
            a.modalidade,
            a.status,
            a.deficiencia,
            a.responsavel,
            a.telefone_responsavel,
            a.data_nascimento,
            a.bairro,
            a.transporte_apto,
            ST_AsGeoJSON(a.localizacao)::json AS localizacao_geojson,
            ae.ano_letivo,
            ae.turma AS turma_escola,
            ae.atualizado_em,
            ac.foto_url
        FROM alunos_escolas ae
        JOIN alunos_municipais a
          ON a.id = ae.aluno_id
         ${alunosMunicipaisTenantJoin}
        ${alunoComplementoJoin}
        WHERE ae.escola_id = $1
        ${alunosEscolasTenantJoin}
        ${alunosFiltrosSql}
        ORDER BY ae.atualizado_em DESC NULLS LAST, nome ASC
        LIMIT ${limitAlunos}
    `;

    const [overviewResult, turmasResult, alunosResult] = await Promise.all([
        pool.query(overviewSql, metricParams),
        pool.query(turmasSql, metricParams),
        pool.query(alunosSql, alunosParams),
    ]);

    return {
        escola: escolaResult.rows[0],
        resumo: overviewResult.rows[0] || {
            total_matriculas: 0,
            total_turmas: 0,
            total_anos_letivos: 0,
            total_alunos_apto_transporte: 0,
        },
        turmas: turmasResult.rows || [],
        alunos: alunosResult.rows || [],
    };
}

async function loadEscolaTurmasData(escolaId, tenantId) {
    await ensureEscolaTurmasTable();

    const dashboardData = await loadEscolaDashboardData(escolaId, tenantId, { limitAlunos: 10 });
    if (!dashboardData) return null;

    const params = [escolaId];
    const tenantClause = tenantId ? `AND (t.tenant_id = $2 OR t.tenant_id IS NULL)` : '';
    if (tenantId) params.push(tenantId);

        const turmasCadastradasSql = `
        SELECT
            t.id,
            t.nome,
            t.ano_letivo,
            t.turno,
            t.tipo_turma,
            t.organizacao_pedagogica,
            t.etapa,
            t.modalidade,
            t.multisseriada,
            t.series_abrangidas,
            t.dias_semana,
            t.horario_inicio,
            t.horario_fim,
            t.capacidade,
            t.limite_planejado_alunos,
            t.total_estudantes_publico_ee,
            t.limite_estudantes_publico_ee,
            t.professor_referencia,
            t.auxiliar_apoio,
            t.interprete_libras,
            t.atendimento_educacional_especializado,
            t.sala,
            t.observacoes,
            t.ativo,
            t.criado_em,
            t.atualizado_em
        FROM escola_turmas t
        WHERE t.escola_id = $1
        ${tenantClause}
        ORDER BY t.ano_letivo DESC NULLS LAST, t.nome ASC
    `;

    const turmasCadastradasResult = await pool.query(turmasCadastradasSql, params);
    const mergeMap = new Map();

    for (const turma of turmasCadastradasResult.rows || []) {
        const key = normalizeTurmaKey(turma.nome, turma.ano_letivo);
        mergeMap.set(key, {
            id: turma.id,
            nome: turma.nome,
            turma: turma.nome,
            ano_letivo: turma.ano_letivo,
            turno: turma.turno,
            tipo_turma: turma.tipo_turma,
            organizacao_pedagogica: turma.organizacao_pedagogica,
            etapa: turma.etapa,
            modalidade: turma.modalidade,
            multisseriada: turma.multisseriada,
            series_abrangidas: turma.series_abrangidas,
            dias_semana: turma.dias_semana,
            horario_inicio: turma.horario_inicio,
            horario_fim: turma.horario_fim,
            capacidade: turma.capacidade,
            limite_planejado_alunos: turma.limite_planejado_alunos,
            total_estudantes_publico_ee: turma.total_estudantes_publico_ee,
            limite_estudantes_publico_ee: turma.limite_estudantes_publico_ee,
            professor_referencia: turma.professor_referencia,
            auxiliar_apoio: turma.auxiliar_apoio,
            interprete_libras: turma.interprete_libras,
            atendimento_educacional_especializado: turma.atendimento_educacional_especializado,
            sala: turma.sala,
            observacoes: turma.observacoes,
            ativo: turma.ativo,
            total_alunos: 0,
            total_apto_transporte: 0,
            cadastro_status: 'cadastrada',
        });
    }

    for (const turma of dashboardData.turmas || []) {
        const nomeTurma = turma.turma || 'Sem turma informada';
        const key = normalizeTurmaKey(nomeTurma, turma.ano_letivo);
        const existente = mergeMap.get(key);

        if (existente) {
            existente.total_alunos = turma.total_alunos || 0;
            existente.total_apto_transporte = turma.total_apto_transporte || 0;
        } else {
            mergeMap.set(key, {
                id: null,
                nome: nomeTurma,
                turma: nomeTurma,
                ano_letivo: turma.ano_letivo,
                turno: null,
                tipo_turma: null,
                organizacao_pedagogica: null,
                etapa: null,
                modalidade: null,
                multisseriada: false,
                series_abrangidas: null,
                dias_semana: null,
                horario_inicio: null,
                horario_fim: null,
                capacidade: null,
                limite_planejado_alunos: null,
                total_estudantes_publico_ee: null,
                limite_estudantes_publico_ee: null,
                professor_referencia: null,
                auxiliar_apoio: false,
                interprete_libras: false,
                atendimento_educacional_especializado: false,
                sala: null,
                observacoes: null,
                ativo: true,
                total_alunos: turma.total_alunos || 0,
                total_apto_transporte: turma.total_apto_transporte || 0,
                cadastro_status: 'somente_matriculas',
            });
        }
    }

    const turmas = Array.from(mergeMap.values()).sort((a, b) => {
        const anoA = a.ano_letivo || 0;
        const anoB = b.ano_letivo || 0;
        if (anoA !== anoB) return anoB - anoA;
        return String(a.nome || '').localeCompare(String(b.nome || ''), 'pt-BR');
    });

    return {
        escola: dashboardData.escola,
        resumo: {
            ...dashboardData.resumo,
            total_turmas: turmas.length,
            total_anos_letivos: countDistinctAnosLetivos(turmas),
        },
        turmas,
    };
}

async function loadAlunoMatriculaDetalhes({ escolaId, alunoId, tenantId }) {
    await ensureAlunoComplementosTable();
    const tenantSupport = await getTenantColumnSupport();
    const columnSupport = await getColumnSupport();

    const params = [alunoId];
    const alunoTenantWhere = tenantSupport.alunos_municipais && tenantId ? 'AND a.tenant_id = $2' : '';
    const escolaTenantJoin = tenantSupport.escolas && tenantId ? 'AND e.tenant_id = $2' : '';
    const vinculoTenantJoin = tenantSupport.alunos_escolas && tenantId ? 'AND ae.tenant_id = $2' : '';
    if (tenantId) params.push(tenantId);

    const result = await pool.query(
        `
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
            a.data_matricula,
            a.filiacao_1,
            a.telefone_filiacao_1,
            a.filiacao_2,
            a.telefone_filiacao_2,
            a.responsavel,
            a.telefone_responsavel,
            a.deficiencia,
            ${columnSupport.alunosMunicipaisRotaExclusiva ? 'a.rota_exclusiva' : 'false AS rota_exclusiva'},
            ${columnSupport.alunosMunicipaisCarroAdaptado ? 'a.carro_adaptado' : 'false AS carro_adaptado'},
            a.modalidade,
            a.formato_letivo,
            a.etapa,
            a.codigo_inep,
            ${columnSupport.alunosMunicipaisTurnoSimplificado ? 'a.turno_simplificado' : 'NULL::text AS turno_simplificado'},
            ST_AsGeoJSON(a.localizacao)::json AS localizacao_geojson,
            ae.ano_letivo,
            ae.turma AS turma_escola,
            ae.escola_id,
            e.nome AS escola_nome,
            ac.foto_url,
            ac.nome_social,
            ac.nis,
            ac.cartao_sus,
            ac.rg,
            ac.certidao_nascimento,
            ac.naturalidade,
            ac.nacionalidade,
            ac.cor_raca,
            ac.email_responsavel,
            ac.telefone_emergencia,
            ac.contato_emergencia_nome,
            ac.contato_emergencia_parentesco,
            ac.complemento_endereco,
            ac.ponto_referencia,
            ac.diagnosticos,
            ac.medicacoes,
            ac.restricoes_saude,
            ac.alergias,
            ac.observacoes_gerais,
            ac.dados_complementares
        FROM alunos_municipais a
        LEFT JOIN LATERAL (
            SELECT ae.escola_id, ae.ano_letivo, ae.turma, ae.atualizado_em, ae.id
            FROM alunos_escolas ae
            WHERE ae.aluno_id = a.id
              ${vinculoTenantJoin ? ` ${vinculoTenantJoin}` : ''}
            ORDER BY
              CASE WHEN ae.escola_id = ${Number.isFinite(escolaId) ? Number(escolaId) : 0} THEN 0 ELSE 1 END,
              ae.ano_letivo DESC NULLS LAST,
              ae.atualizado_em DESC NULLS LAST,
              ae.id DESC
            LIMIT 1
        ) ae ON TRUE
        LEFT JOIN escolas e
          ON e.id = ae.escola_id
         ${escolaTenantJoin}
        LEFT JOIN aluno_cadastros_complementares ac
          ON ac.aluno_id = a.id
         ${tenantId ? 'AND ac.tenant_id = $2' : ''}
        WHERE a.id = $1
        ${alunoTenantWhere}
        LIMIT 1
        `,
        params,
    );

    if (!result.rowCount) return null;
    return result.rows[0];
}

async function saveAlunoComplementos(client, tenantId, alunoId, complementar = {}) {
    await ensureAlunoComplementosTable();
    const reservedKeys = new Set([
        'foto_url',
        'nome_social',
        'nis',
        'cartao_sus',
        'rg',
        'certidao_nascimento',
        'naturalidade',
        'nacionalidade',
        'cor_raca',
        'email_responsavel',
        'telefone_emergencia',
        'contato_emergencia_nome',
        'contato_emergencia_parentesco',
        'complemento_endereco',
        'ponto_referencia',
        'diagnosticos',
        'medicacoes',
        'restricoes_saude',
        'alergias',
        'observacoes_gerais',
    ]);
    const dadosComplementares = Object.fromEntries(
        Object.entries(complementar || {})
            .filter(([key]) => !reservedKeys.has(key))
            .map(([key, value]) => [key, sanitizeComplementarValue(value)])
            .filter(([, value]) => value !== null)
    );

    await client.query(
        `
        INSERT INTO aluno_cadastros_complementares (
            tenant_id,
            aluno_id,
            foto_url,
            nome_social,
            nis,
            cartao_sus,
            rg,
            certidao_nascimento,
            naturalidade,
            nacionalidade,
            cor_raca,
            email_responsavel,
            telefone_emergencia,
            contato_emergencia_nome,
            contato_emergencia_parentesco,
            complemento_endereco,
            ponto_referencia,
            diagnosticos,
            medicacoes,
            restricoes_saude,
            alergias,
            observacoes_gerais,
            dados_complementares,
            atualizado_em
        )
        VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
            $13, $14, $15, $16, $17, $18, $19, $20, $21, $22, $23::jsonb, NOW()
        )
        ON CONFLICT (aluno_id, tenant_id) DO UPDATE
        SET
            foto_url = EXCLUDED.foto_url,
            nome_social = EXCLUDED.nome_social,
            nis = EXCLUDED.nis,
            cartao_sus = EXCLUDED.cartao_sus,
            rg = EXCLUDED.rg,
            certidao_nascimento = EXCLUDED.certidao_nascimento,
            naturalidade = EXCLUDED.naturalidade,
            nacionalidade = EXCLUDED.nacionalidade,
            cor_raca = EXCLUDED.cor_raca,
            email_responsavel = EXCLUDED.email_responsavel,
            telefone_emergencia = EXCLUDED.telefone_emergencia,
            contato_emergencia_nome = EXCLUDED.contato_emergencia_nome,
            contato_emergencia_parentesco = EXCLUDED.contato_emergencia_parentesco,
            complemento_endereco = EXCLUDED.complemento_endereco,
            ponto_referencia = EXCLUDED.ponto_referencia,
            diagnosticos = EXCLUDED.diagnosticos,
            medicacoes = EXCLUDED.medicacoes,
            restricoes_saude = EXCLUDED.restricoes_saude,
            alergias = EXCLUDED.alergias,
            observacoes_gerais = EXCLUDED.observacoes_gerais,
            dados_complementares = EXCLUDED.dados_complementares,
            atualizado_em = NOW()
        `,
        [
            tenantId,
            alunoId,
            parseOptionalText(complementar.foto_url),
            parseOptionalText(complementar.nome_social),
            parseOptionalText(complementar.nis),
            parseOptionalText(complementar.cartao_sus),
            parseOptionalText(complementar.rg),
            parseOptionalText(complementar.certidao_nascimento),
            parseOptionalText(complementar.naturalidade),
            parseOptionalText(complementar.nacionalidade),
            parseOptionalText(complementar.cor_raca),
            parseOptionalText(complementar.email_responsavel),
            parseOptionalText(complementar.telefone_emergencia),
            parseOptionalText(complementar.contato_emergencia_nome),
            parseOptionalText(complementar.contato_emergencia_parentesco),
            parseOptionalText(complementar.complemento_endereco),
            parseOptionalText(complementar.ponto_referencia),
            parseOptionalText(complementar.diagnosticos),
            parseOptionalText(complementar.medicacoes),
            parseOptionalText(complementar.restricoes_saude),
            parseOptionalText(complementar.alergias),
            parseOptionalText(complementar.observacoes_gerais),
            JSON.stringify(dadosComplementares),
        ],
    );
}

router.get("/", async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const tenantSupport = await getTenantColumnSupport();

        const params = [];
        let whereTenant = "";
        if (tenantSupport.escolas && tenantId) {
            params.push(tenantId);
            whereTenant = `WHERE e.tenant_id = $${params.length}`;
        }
        const zoneamentoTenantClause = tenantSupport.escola_zoneamento && tenantSupport.escolas && tenantId
            ? "AND ez.tenant_id = e.tenant_id"
            : "";

        const sql = `
            SELECT 
                e.*,
                ST_AsGeoJSON(e.localizacao)::json AS localizacao,
                COALESCE(
                    (
                        SELECT json_agg(z.id)
                        FROM escola_zoneamento ez
                        JOIN zoneamentos z ON z.id = ez.zoneamento_id
                        WHERE ez.escola_id = e.id
                          ${zoneamentoTenantClause}
                    ), 
                '[]') AS zoneamento_ids
            FROM escolas e
            ${whereTenant}
            ORDER BY e.id ASC
        `;
        const result = await pool.query(sql, params);
        return res.json(result.rows);
    } catch (err) {
        console.error("Erro ao listar escolas:", err);
        return res.status(500).json({ error: "Erro ao listar escolas" });
    }
});

router.get("/zoneamentos", async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const tenantSupport = await getTenantColumnSupport();
        const { escolas } = req.query;

        if (!escolas) {
            return res.status(400).json({ error: 'Parâmetro "escolas" é obrigatório.' });
        }

        const ids = String(escolas)
            .split(",")
            .map((id) => parseInt(id, 10))
            .filter((n) => !isNaN(n));

        if (!ids.length) {
            return res.status(400).json({ error: 'Nenhum ID de escola válido informado em "escolas".' });
        }

        const params = [ids];
        let tenantClause = "";
        if (tenantSupport.escola_zoneamento && tenantId) {
            params.push(tenantId);
            tenantClause = `AND ez.tenant_id = $${params.length}`;
        }

        const sql = `
            SELECT DISTINCT z.*
            FROM zoneamentos z
            JOIN escola_zoneamento ez ON ez.zoneamento_id = z.id
            WHERE ez.escola_id = ANY($1)
            ${tenantClause}
            ORDER BY z.nome
        `;
        const result = await pool.query(sql, params);
        return res.json(result.rows);
    } catch (err) {
        console.error("Erro ao buscar zoneamentos por escolas:", err);
        return res.status(500).json({ error: "Erro ao buscar zoneamentos relacionados às escolas" });
    }
});

router.get("/:id/dashboard", async (req, res) => {
    try {
        const idRaw = req.params.id;
        const id = parseInt(idRaw, 10);

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de escola inválido." });
        }

        const tenantId = getTenantId(req);
        const [dashboardData, turmasData] = await Promise.all([
            loadEscolaDashboardData(id, tenantId, { limitAlunos: 500 }),
            loadEscolaTurmasData(id, tenantId),
        ]);

        if (!dashboardData || !turmasData) {
            return res.status(404).json({ error: "Escola não encontrada" });
        }

        const alunos = Array.isArray(dashboardData.alunos) ? dashboardData.alunos : [];
        const turmas = Array.isArray(turmasData.turmas) ? turmasData.turmas : [];
        const alunosRecentes = alunos
            .slice()
            .sort((a, b) => new Date(b?.atualizado_em || 0).valueOf() - new Date(a?.atualizado_em || 0).valueOf())
            .slice(0, 12);

        const pendenciasSecretaria = {
            sem_turma: alunos.filter((aluno) => !parseOptionalText(aluno?.turma_escola) && !parseOptionalText(aluno?.turma)).length,
            sem_turno: alunos.filter((aluno) => !parseOptionalText(aluno?.turno)).length,
            sem_responsavel: alunos.filter((aluno) => !parseOptionalText(aluno?.responsavel)).length,
            sem_contato: alunos.filter((aluno) => !parseOptionalText(aluno?.telefone_responsavel)).length,
            sem_cpf: alunos.filter((aluno) => !parseOptionalText(aluno?.cpf)).length,
            sem_geolocalizacao: alunos.filter((aluno) => !aluno?.localizacao_geojson?.coordinates).length,
        };

        const metricasPedagogicas = {
            turmas_sem_alunos: turmas.filter((turma) => Number(turma?.total_alunos || 0) === 0).length,
            turmas_multisseriadas: turmas.filter((turma) => turma?.multisseriada === true).length,
            turmas_com_transporte: turmas.filter((turma) => Number(turma?.total_apto_transporte || 0) > 0).length,
            alunos_com_deficiencia: alunos.filter((aluno) => parseOptionalText(aluno?.deficiencia)).length,
        };

        const distribuicoes = {
            etapas: Object.entries(
                alunos.reduce((acc, aluno) => {
                    const key = parseOptionalText(aluno?.etapa) || 'nao_informada';
                    acc[key] = (acc[key] || 0) + 1;
                    return acc;
                }, {})
            ).map(([chave, total]) => ({ chave, total })).sort((a, b) => b.total - a.total),
            turnos: Object.entries(
                alunos.reduce((acc, aluno) => {
                    const key = parseOptionalText(aluno?.turno) || 'nao_informado';
                    acc[key] = (acc[key] || 0) + 1;
                    return acc;
                }, {})
            ).map(([chave, total]) => ({ chave, total })).sort((a, b) => b.total - a.total),
            modalidades: Object.entries(
                alunos.reduce((acc, aluno) => {
                    const key = parseOptionalText(aluno?.modalidade) || 'nao_informada';
                    acc[key] = (acc[key] || 0) + 1;
                    return acc;
                }, {})
            ).map(([chave, total]) => ({ chave, total })).sort((a, b) => b.total - a.total),
        };

        const alertas = [
            pendenciasSecretaria.sem_turma ? { tipo: 'warning', titulo: 'Alunos sem turma definida', detalhe: `${pendenciasSecretaria.sem_turma} cadastro(s) exigem enturmação.` } : null,
            pendenciasSecretaria.sem_geolocalizacao ? { tipo: 'warning', titulo: 'Alunos sem geolocalização', detalhe: `${pendenciasSecretaria.sem_geolocalizacao} cadastro(s) ainda sem ponto no mapa.` } : null,
            pendenciasSecretaria.sem_responsavel ? { tipo: 'danger', titulo: 'Cadastros sem responsável', detalhe: `${pendenciasSecretaria.sem_responsavel} aluno(s) sem responsável principal informado.` } : null,
            metricasPedagogicas.turmas_sem_alunos ? { tipo: 'info', titulo: 'Turmas sem alunos', detalhe: `${metricasPedagogicas.turmas_sem_alunos} turma(s) cadastradas ainda sem matrícula.` } : null,
            metricasPedagogicas.alunos_com_deficiencia ? { tipo: 'primary', titulo: 'Acompanhamento inclusivo', detalhe: `${metricasPedagogicas.alunos_com_deficiencia} aluno(s) com deficiência/condição registrada.` } : null,
        ].filter(Boolean);

        return res.json({
            escola: dashboardData.escola,
            resumo: {
                ...dashboardData.resumo,
                ...turmasData.resumo,
            },
            turmas: turmasData.turmas,
            alunos,
            alunos_recentes: alunosRecentes,
            indicadores: {
                pendencias_secretaria: pendenciasSecretaria,
                metricas_pedagogicas: metricasPedagogicas,
                distribuicoes,
                alertas,
            },
        });
    } catch (err) {
        console.error("Erro ao carregar dashboard da escola:", err);
        return res.status(500).json({ error: "Erro ao carregar dashboard da escola" });
    }
});

router.get("/:id/turmas", async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de escola inválido." });
        }

        const tenantId = getTenantId(req);
        const data = await loadEscolaTurmasData(id, tenantId);
        if (!data) {
            return res.status(404).json({ error: "Escola não encontrada" });
        }

        return res.json({
            escola: data.escola,
            resumo: data.resumo,
            turmas: data.turmas,
        });
    } catch (err) {
        console.error("Erro ao carregar turmas da escola:", err);
        return res.status(500).json({ error: "Erro ao carregar turmas da escola" });
    }
});

router.post("/:id/turmas", async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        if (isNaN(escolaId)) {
            return res.status(400).json({ error: "ID de escola inválido." });
        }

        const tenantId = getTenantId(req);
        const escolaData = await loadEscolaDashboardData(escolaId, tenantId, { limitAlunos: 1 });
        if (!escolaData) {
            return res.status(404).json({ error: "Escola não encontrada" });
        }

        await ensureEscolaTurmasTable();

        const nome = String(req.body?.nome || req.body?.turma || '').trim();
        if (!nome) {
            return res.status(400).json({ error: "Nome da turma é obrigatório." });
        }

        const anoLetivo = parseOptionalInt(req.body?.ano_letivo);
        const turno = parseOptionalText(req.body?.turno);
        const tipoTurma = parseOptionalText(req.body?.tipo_turma);
        const organizacaoPedagogica = parseOptionalText(req.body?.organizacao_pedagogica);
        const etapa = parseOptionalText(req.body?.etapa);
        const modalidade = parseOptionalText(req.body?.modalidade);
        const multisseriada = Boolean(req.body?.multisseriada);
        const seriesAbrangidas = parseOptionalTextArray(req.body?.series_abrangidas);
        const diasSemana = parseOptionalTextArray(req.body?.dias_semana);
        const horarioInicio = parseOptionalText(req.body?.horario_inicio);
        const horarioFim = parseOptionalText(req.body?.horario_fim);
        const capacidade = parseOptionalInt(req.body?.capacidade);
        const limitePlanejadoAlunos = parseOptionalInt(req.body?.limite_planejado_alunos);
        const totalEstudantesPublicoEe = parseOptionalInt(req.body?.total_estudantes_publico_ee);
        const limiteEstudantesPublicoEe = parseOptionalInt(req.body?.limite_estudantes_publico_ee);
        const professorReferencia = parseOptionalText(req.body?.professor_referencia);
        const auxiliarApoio = Boolean(req.body?.auxiliar_apoio);
        const interpreteLibras = Boolean(req.body?.interprete_libras);
        const atendimentoEducacionalEspecializado = Boolean(req.body?.atendimento_educacional_especializado);
        const sala = parseOptionalText(req.body?.sala);
        const observacoes = parseOptionalText(req.body?.observacoes);
        const ativo = req.body?.ativo === undefined ? true : Boolean(req.body.ativo);

        const result = await pool.query(
            `
            INSERT INTO escola_turmas (
                tenant_id, escola_id, nome, ano_letivo, turno, tipo_turma, organizacao_pedagogica,
                etapa, modalidade, multisseriada, series_abrangidas, dias_semana, horario_inicio, horario_fim,
                capacidade, limite_planejado_alunos, total_estudantes_publico_ee, limite_estudantes_publico_ee,
                professor_referencia, auxiliar_apoio, interprete_libras, atendimento_educacional_especializado,
                sala, observacoes, ativo
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7,
                $8, $9, $10, $11, $12, $13, $14,
                $15, $16, $17, $18,
                $19, $20, $21, $22,
                $23, $24, $25
            )
            RETURNING *
            `,
            [
                tenantId, escolaId, nome, anoLetivo, turno, tipoTurma, organizacaoPedagogica,
                etapa, modalidade, multisseriada, seriesAbrangidas, diasSemana, horarioInicio, horarioFim,
                capacidade, limitePlanejadoAlunos, totalEstudantesPublicoEe, limiteEstudantesPublicoEe,
                professorReferencia, auxiliarApoio, interpreteLibras, atendimentoEducacionalEspecializado,
                sala, observacoes, ativo
            ]
        );

        return res.status(201).json({
            message: "Turma cadastrada com sucesso",
            turma: result.rows[0],
        });
    } catch (err) {
        console.error("Erro ao cadastrar turma da escola:", err);
        return res.status(500).json({ error: "Erro ao cadastrar turma da escola" });
    }
});

router.put("/:id/turmas/:turmaId", async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const turmaId = parseInt(req.params.turmaId, 10);
        if (isNaN(escolaId) || isNaN(turmaId)) {
            return res.status(400).json({ error: "Identificador inválido." });
        }

        const tenantId = getTenantId(req);
        await ensureEscolaTurmasTable();

        const nome = String(req.body?.nome || req.body?.turma || '').trim();
        if (!nome) {
            return res.status(400).json({ error: "Nome da turma é obrigatório." });
        }

        const anoLetivo = parseOptionalInt(req.body?.ano_letivo);
        const turno = parseOptionalText(req.body?.turno);
        const tipoTurma = parseOptionalText(req.body?.tipo_turma);
        const organizacaoPedagogica = parseOptionalText(req.body?.organizacao_pedagogica);
        const etapa = parseOptionalText(req.body?.etapa);
        const modalidade = parseOptionalText(req.body?.modalidade);
        const multisseriada = Boolean(req.body?.multisseriada);
        const seriesAbrangidas = parseOptionalTextArray(req.body?.series_abrangidas);
        const diasSemana = parseOptionalTextArray(req.body?.dias_semana);
        const horarioInicio = parseOptionalText(req.body?.horario_inicio);
        const horarioFim = parseOptionalText(req.body?.horario_fim);
        const capacidade = parseOptionalInt(req.body?.capacidade);
        const limitePlanejadoAlunos = parseOptionalInt(req.body?.limite_planejado_alunos);
        const totalEstudantesPublicoEe = parseOptionalInt(req.body?.total_estudantes_publico_ee);
        const limiteEstudantesPublicoEe = parseOptionalInt(req.body?.limite_estudantes_publico_ee);
        const professorReferencia = parseOptionalText(req.body?.professor_referencia);
        const auxiliarApoio = Boolean(req.body?.auxiliar_apoio);
        const interpreteLibras = Boolean(req.body?.interprete_libras);
        const atendimentoEducacionalEspecializado = Boolean(req.body?.atendimento_educacional_especializado);
        const sala = parseOptionalText(req.body?.sala);
        const observacoes = parseOptionalText(req.body?.observacoes);
        const ativo = req.body?.ativo === undefined ? true : Boolean(req.body.ativo);

        const params = [
            nome, anoLetivo, turno, tipoTurma, organizacaoPedagogica,
            etapa, modalidade, multisseriada, seriesAbrangidas, diasSemana, horarioInicio, horarioFim,
            capacidade, limitePlanejadoAlunos, totalEstudantesPublicoEe, limiteEstudantesPublicoEe,
            professorReferencia, auxiliarApoio, interpreteLibras, atendimentoEducacionalEspecializado,
            sala, observacoes, ativo, turmaId, escolaId
        ];
        let tenantWhere = '';
        if (tenantId) {
            params.push(tenantId);
            tenantWhere = `AND (tenant_id = $26 OR tenant_id IS NULL)`;
        }

        const result = await pool.query(
            `
            UPDATE escola_turmas
            SET
                nome = $1,
                ano_letivo = $2,
                turno = $3,
                tipo_turma = $4,
                organizacao_pedagogica = $5,
                etapa = $6,
                modalidade = $7,
                multisseriada = $8,
                series_abrangidas = $9,
                dias_semana = $10,
                horario_inicio = $11,
                horario_fim = $12,
                capacidade = $13,
                limite_planejado_alunos = $14,
                total_estudantes_publico_ee = $15,
                limite_estudantes_publico_ee = $16,
                professor_referencia = $17,
                auxiliar_apoio = $18,
                interprete_libras = $19,
                atendimento_educacional_especializado = $20,
                sala = $21,
                observacoes = $22,
                ativo = $23,
                atualizado_em = NOW()
            WHERE id = $24
              AND escola_id = $25
              ${tenantWhere}
            RETURNING *
            `,
            params
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Turma não encontrada." });
        }

        return res.json({
            message: "Turma atualizada com sucesso",
            turma: result.rows[0],
        });
    } catch (err) {
        console.error("Erro ao atualizar turma da escola:", err);
        return res.status(500).json({ error: "Erro ao atualizar turma da escola" });
    }
});

router.delete("/:id/turmas/:turmaId", async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const turmaId = parseInt(req.params.turmaId, 10);
        if (isNaN(escolaId) || isNaN(turmaId)) {
            return res.status(400).json({ error: "Identificador inválido." });
        }

        const tenantId = getTenantId(req);
        await ensureEscolaTurmasTable();

        const params = [turmaId, escolaId];
        let tenantWhere = '';
        if (tenantId) {
            params.push(tenantId);
            tenantWhere = `AND (tenant_id = $3 OR tenant_id IS NULL)`;
        }

        const result = await pool.query(
            `
            DELETE FROM escola_turmas
            WHERE id = $1
              AND escola_id = $2
              ${tenantWhere}
            RETURNING id
            `,
            params
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Turma não encontrada." });
        }

        return res.json({ message: "Turma excluída com sucesso" });
    } catch (err) {
        console.error("Erro ao excluir turma da escola:", err);
        return res.status(500).json({ error: "Erro ao excluir turma da escola" });
    }
});

router.post("/:id/matriculas", async (req, res) => {
    const client = await pool.connect();
    try {
        const escolaId = parseInt(req.params.id, 10);
        if (isNaN(escolaId)) {
            return res.status(400).json({ error: "ID de escola inválido." });
        }

        const tenantId = getTenantId(req);
        const tenantSupport = await getTenantColumnSupport();
        const columnSupport = await getColumnSupport();
        const alunoPayload = req.body?.aluno || {};
        const complementarPayload = req.body?.complementar || {};
        const localizacaoPayload = req.body?.localizacao || {};
        let alunoId = parseInt(req.body?.aluno_id, 10);
        const anoLetivo = parseOptionalInt(req.body?.ano_letivo);
        const turma = parseOptionalText(req.body?.turma);
        const pessoaNome = parseOptionalText(alunoPayload.pessoa_nome);
        const latitude = parseOptionalCoordinate(localizacaoPayload.latitude ?? req.body?.latitude);
        const longitude = parseOptionalCoordinate(localizacaoPayload.longitude ?? req.body?.longitude);

        if ((!Number.isFinite(alunoId) || alunoId <= 0) && !pessoaNome) {
            return res.status(400).json({ error: "Selecione um aluno existente ou informe o nome para novo cadastro." });
        }
        if (!anoLetivo) {
            return res.status(400).json({ error: "ano_letivo obrigatório." });
        }
        if (!turma) {
            return res.status(400).json({ error: "turma obrigatória." });
        }

        await client.query("BEGIN");

        const escolaParams = [escolaId];
        let escolaTenantWhere = '';
        if (tenantSupport.escolas && tenantId) {
            escolaParams.push(tenantId);
            escolaTenantWhere = 'AND tenant_id = $2';
        }

        const escolaResult = await client.query(
            `
            SELECT id, nome, codigo_inep
            FROM escolas
            WHERE id = $1
            ${escolaTenantWhere}
            LIMIT 1
            `,
            escolaParams
        );

        if (!escolaResult.rowCount) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Escola não encontrada." });
        }

        let generatedIdPessoa = parseOptionalText(alunoPayload.id_pessoa);

        if (Number.isFinite(alunoId) && alunoId > 0) {
            const alunoParams = [alunoId];
            let alunoTenantWhere = '';
            if (tenantSupport.alunos_municipais && tenantId) {
                alunoParams.push(tenantId);
                alunoTenantWhere = 'AND tenant_id = $2';
            }

            const alunoResult = await client.query(
                `
                SELECT id, pessoa_nome
                FROM alunos_municipais
                WHERE id = $1
                ${alunoTenantWhere}
                LIMIT 1
                `,
                alunoParams
            );

            if (!alunoResult.rowCount) {
                await client.query("ROLLBACK");
                return res.status(404).json({ error: "Aluno não encontrado." });
            }

            if (!generatedIdPessoa) {
                generatedIdPessoa = await generateNextNetworkEnrollmentId(client, tenantId);
            }
        } else {
            if (!generatedIdPessoa) {
                generatedIdPessoa = await generateNextNetworkEnrollmentId(client, tenantId);
            }

            const insertColumns = [];
            const insertParams = [];

            function pushInsert(column, value) {
                insertColumns.push(column);
                insertParams.push(value);
            }

            if (columnSupport.alunosMunicipaisTenantId) pushInsert('tenant_id', tenantId);
            pushInsert('pessoa_nome', pessoaNome);
            pushInsert('cpf', parseOptionalText(alunoPayload.cpf));
            pushInsert('data_nascimento', parseOptionalDate(alunoPayload.data_nascimento));
            pushInsert('sexo', parseOptionalText(alunoPayload.sexo));
            pushInsert('codigo_inep', parseOptionalText(escolaResult.rows[0].codigo_inep));
            pushInsert('data_matricula', parseOptionalDate(alunoPayload.data_matricula) || new Date().toISOString().slice(0, 10));
            pushInsert('status', parseOptionalText(alunoPayload.status) || 'ativo');
            pushInsert('unidade_ensino', parseOptionalText(escolaResult.rows[0].nome));
            pushInsert('ano', parseOptionalText(alunoPayload.ano));
            pushInsert('turma', turma);
            pushInsert('modalidade', parseOptionalText(alunoPayload.modalidade));
            pushInsert('formato_letivo', parseOptionalText(alunoPayload.formato_letivo));
            pushInsert('etapa', parseOptionalText(alunoPayload.etapa));
            pushInsert('cep', parseOptionalText(alunoPayload.cep));
            pushInsert('rua', parseOptionalText(alunoPayload.rua));
            pushInsert('bairro', parseOptionalText(alunoPayload.bairro));
            pushInsert('numero_pessoa_endereco', parseOptionalText(alunoPayload.numero_pessoa_endereco));
            pushInsert('zona', parseOptionalText(alunoPayload.zona));
            pushInsert('filiacao_1', parseOptionalText(alunoPayload.filiacao_1));
            pushInsert('telefone_filiacao_1', parseOptionalText(alunoPayload.telefone_filiacao_1));
            pushInsert('filiacao_2', parseOptionalText(alunoPayload.filiacao_2));
            pushInsert('telefone_filiacao_2', parseOptionalText(alunoPayload.telefone_filiacao_2));
            pushInsert('responsavel', parseOptionalText(alunoPayload.responsavel));
            pushInsert('telefone_responsavel', parseOptionalText(alunoPayload.telefone_responsavel));
            pushInsert('deficiencia', parseOptionalText(alunoPayload.deficiencia));
            if (columnSupport.alunosMunicipaisRotaExclusiva) pushInsert('rota_exclusiva', parseOptionalBoolean(alunoPayload.rota_exclusiva) ?? false);
            if (columnSupport.alunosMunicipaisCarroAdaptado) pushInsert('carro_adaptado', parseOptionalBoolean(alunoPayload.carro_adaptado) ?? false);
            pushInsert('transporte_escolar_publico_utiliza', parseOptionalText(alunoPayload.transporte_escolar_publico_utiliza));
            pushInsert('transporte_apto', parseOptionalBoolean(alunoPayload.transporte_apto) ?? false);
            pushInsert('id_pessoa', generatedIdPessoa);
            if (columnSupport.alunosMunicipaisTurnoSimplificado) pushInsert('turno_simplificado', parseOptionalText(alunoPayload.turno_simplificado));

            insertColumns.push('localizacao');
            let localizacaoValueSql = 'NULL';
            if (latitude !== null && longitude !== null) {
                const latParam = insertParams.length + 1;
                const lngParam = insertParams.length + 2;
                insertParams.push(latitude, longitude);
                localizacaoValueSql = `ST_SetSRID(ST_MakePoint($${lngParam}, $${latParam}), 4326)`;
            }

            const columnList = insertColumns.join(', ');
            const valueList = insertColumns.map(function (column, index) {
                if (column === 'localizacao') return localizacaoValueSql;
                return `$${index + 1}`;
            }).join(', ');

            const insertResult = await client.query(
                `
                INSERT INTO alunos_municipais (${columnList})
                VALUES (${valueList})
                RETURNING id
                `,
                insertParams,
            );

            alunoId = Number(insertResult.rows[0].id);
        }

        if (tenantSupport.alunos_escolas) {
            await client.query(
                `
                DELETE FROM alunos_escolas
                WHERE aluno_id = $1
                  AND ano_letivo = $2
                  AND tenant_id = $3
                  AND escola_id <> $4
                `,
                [alunoId, anoLetivo, tenantId, escolaId]
            );

            await client.query(
                `
                INSERT INTO alunos_escolas (tenant_id, aluno_id, escola_id, ano_letivo, turma)
                VALUES ($1, $2, $3, $4, $5)
                ON CONFLICT (aluno_id, escola_id, ano_letivo) DO UPDATE
                SET turma = EXCLUDED.turma,
                    atualizado_em = NOW()
                `,
                [tenantId, alunoId, escolaId, anoLetivo, turma]
            );
        } else {
            await client.query(
                `
                DELETE FROM alunos_escolas
                WHERE aluno_id = $1
                  AND ano_letivo = $2
                  AND escola_id <> $3
                `,
                [alunoId, anoLetivo, escolaId]
            );

            await client.query(
                `
                DELETE FROM alunos_escolas
                WHERE aluno_id = $1
                  AND escola_id = $2
                  AND ano_letivo = $3
                `,
                [alunoId, escolaId, anoLetivo]
            );

            await client.query(
                `
                INSERT INTO alunos_escolas (aluno_id, escola_id, ano_letivo, turma)
                VALUES ($1, $2, $3, $4)
                `,
                [alunoId, escolaId, anoLetivo, turma]
            );
        }

        const escola = escolaResult.rows[0];
        const updateSets = [];
        const updateParams = [];

        function pushUpdate(column, value) {
            updateParams.push(value);
            updateSets.push(`${column} = COALESCE($${updateParams.length}, ${column})`);
        }

        pushUpdate('pessoa_nome', pessoaNome);
        pushUpdate('cpf', parseOptionalText(alunoPayload.cpf));
        pushUpdate('data_nascimento', parseOptionalDate(alunoPayload.data_nascimento));
        pushUpdate('sexo', parseOptionalText(alunoPayload.sexo));
        pushUpdate('codigo_inep', escola.codigo_inep);
        pushUpdate('data_matricula', parseOptionalDate(alunoPayload.data_matricula));
        pushUpdate('status', parseOptionalText(alunoPayload.status) || 'ativo');
        pushUpdate('unidade_ensino', escola.nome);
        pushUpdate('ano', parseOptionalText(alunoPayload.ano));
        pushUpdate('turma', turma);
        pushUpdate('modalidade', parseOptionalText(alunoPayload.modalidade));
        pushUpdate('formato_letivo', parseOptionalText(alunoPayload.formato_letivo));
        pushUpdate('etapa', parseOptionalText(alunoPayload.etapa));
        pushUpdate('cep', parseOptionalText(alunoPayload.cep));
        pushUpdate('rua', parseOptionalText(alunoPayload.rua));
        pushUpdate('bairro', parseOptionalText(alunoPayload.bairro));
        pushUpdate('numero_pessoa_endereco', parseOptionalText(alunoPayload.numero_pessoa_endereco));
        pushUpdate('zona', parseOptionalText(alunoPayload.zona));
        pushUpdate('filiacao_1', parseOptionalText(alunoPayload.filiacao_1));
        pushUpdate('telefone_filiacao_1', parseOptionalText(alunoPayload.telefone_filiacao_1));
        pushUpdate('filiacao_2', parseOptionalText(alunoPayload.filiacao_2));
        pushUpdate('telefone_filiacao_2', parseOptionalText(alunoPayload.telefone_filiacao_2));
        pushUpdate('responsavel', parseOptionalText(alunoPayload.responsavel));
        pushUpdate('telefone_responsavel', parseOptionalText(alunoPayload.telefone_responsavel));
        pushUpdate('deficiencia', parseOptionalText(alunoPayload.deficiencia));
        if (columnSupport.alunosMunicipaisRotaExclusiva) pushUpdate('rota_exclusiva', parseOptionalBoolean(alunoPayload.rota_exclusiva));
        if (columnSupport.alunosMunicipaisCarroAdaptado) pushUpdate('carro_adaptado', parseOptionalBoolean(alunoPayload.carro_adaptado));
        pushUpdate('transporte_escolar_publico_utiliza', parseOptionalText(alunoPayload.transporte_escolar_publico_utiliza));
        pushUpdate('transporte_apto', parseOptionalBoolean(alunoPayload.transporte_apto));
        pushUpdate('id_pessoa', generatedIdPessoa);
        if (columnSupport.alunosMunicipaisTurnoSimplificado) pushUpdate('turno_simplificado', parseOptionalText(alunoPayload.turno_simplificado));

        if (latitude !== null && longitude !== null) {
            updateParams.push(latitude, longitude);
            const latParam = updateParams.length - 1;
            const lngParam = updateParams.length;
            updateSets.push(`localizacao = COALESCE(ST_SetSRID(ST_MakePoint($${lngParam}, $${latParam}), 4326), localizacao)`);
        }

        updateSets.push('atualizado_em = NOW()');

        updateParams.push(alunoId);
        let updateWhere = `WHERE id = $${updateParams.length}`;
        if (columnSupport.alunosMunicipaisTenantId && tenantId) {
            updateParams.push(tenantId);
            updateWhere += ` AND tenant_id = $${updateParams.length}`;
        }

        await client.query(
            `
            UPDATE alunos_municipais
            SET ${updateSets.join(', ')}
            ${updateWhere}
            `,
            updateParams
        );

        await saveAlunoComplementos(client, tenantId, alunoId, complementarPayload);

        await client.query("COMMIT");
        return res.status(201).json({
            message: "Aluno matriculado com sucesso",
            aluno_id: alunoId,
            escola_id: escolaId,
            ano_letivo: anoLetivo,
            turma,
            id_pessoa: generatedIdPessoa,
        });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro ao matricular aluno na escola:", err);
        return res.status(500).json({ error: "Erro ao matricular aluno na escola" });
    } finally {
        client.release();
    }
});

router.get("/:id/alunos", async (req, res) => {
    try {
        const id = parseInt(req.params.id, 10);
        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de escola inválido." });
        }

        const tenantId = getTenantId(req);
        const data = await loadEscolaDashboardData(id, tenantId, {
            limitAlunos: 500,
            turma: req.query?.turma,
            anoLetivo: req.query?.ano_letivo,
        });
        if (!data) {
            return res.status(404).json({ error: "Escola não encontrada" });
        }

        return res.json({
            escola: data.escola,
            resumo: data.resumo,
            alunos: data.alunos,
            filtros: {
                turma: parseOptionalText(req.query?.turma),
                ano_letivo: parseOptionalInt(req.query?.ano_letivo),
            },
        });
    } catch (err) {
        console.error("Erro ao carregar alunos da escola:", err);
        return res.status(500).json({ error: "Erro ao carregar alunos da escola" });
    }
});

router.get("/:id/alunos/:alunoId/matricula", async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const alunoId = parseInt(req.params.alunoId, 10);
        if (isNaN(escolaId) || isNaN(alunoId)) {
            return res.status(400).json({ error: "Identificador inválido." });
        }

        const tenantId = getTenantId(req);
        const aluno = await loadAlunoMatriculaDetalhes({ escolaId, alunoId, tenantId });
        if (!aluno) {
            return res.status(404).json({ error: "Aluno não encontrado." });
        }

        return res.json(aluno);
    } catch (err) {
        console.error("Erro ao carregar ficha de matrícula do aluno:", err);
        return res.status(500).json({ error: "Erro ao carregar ficha de matrícula do aluno" });
    }
});

router.get("/:id/alunos/:alunoId/atestado-matricula-pdf", async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const alunoId = parseInt(req.params.alunoId, 10);
        if (isNaN(escolaId) || isNaN(alunoId)) {
            return res.status(400).json({ error: "Identificador inválido." });
        }

        const tenantId = getTenantId(req);
        const aluno = await loadAlunoMatriculaDetalhes({ escolaId, alunoId, tenantId });
        if (!aluno) {
            return res.status(404).json({ error: "Aluno não encontrado." });
        }

        const branding = await getBranding(tenantId);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="atestado_matricula_${alunoId}.pdf"`);

        const doc = new PDFDocument({ size: "A4", margin: 50 });
        doc.pipe(res);

        drawCabecalho(doc, branding);
        doc.y = 130;
        doc.font("Helvetica-Bold").fontSize(15).text("ATESTADO DE MATRÍCULA", { align: "center" });
        doc.moveDown(2);
        doc.font("Helvetica").fontSize(12);
        doc.text(`Atestamos, para os devidos fins, que o(a) estudante ${aluno.pessoa_nome || "Não informado"}, CPF ${aluno.cpf || "não informado"}, encontra-se regularmente matriculado(a) nesta unidade escolar.`);
        doc.moveDown(1);
        doc.text(`Escola: ${aluno.escola_nome || aluno.unidade_ensino || "Não informada"}`);
        doc.text(`Código INEP: ${aluno.codigo_inep || "Não informado"}`);
        doc.text(`Ano letivo: ${aluno.ano_letivo || "Não informado"}`);
        doc.text(`Turma: ${aluno.turma_escola || aluno.turma || "Não informada"}`);
        doc.text(`Etapa/modalidade: ${[aluno.etapa, aluno.modalidade].filter(Boolean).join(" • ") || "Não informada"}`);
        doc.text(`Data da matrícula: ${formatDatePtBr(aluno.data_matricula)}`);
        doc.moveDown(1.5);
        doc.text("O presente atestado é emitido a pedido do interessado para fins de comprovação junto aos órgãos e instituições que se fizerem necessários.", { align: "justify" });
        doc.moveDown(3);
        doc.text(`${branding?.cidade_uf || ""}, ${new Date().toLocaleDateString("pt-BR")}.`, { align: "right" });
        doc.moveDown(4);
        doc.text("__________________________________________", { align: "center" });
        doc.font("Helvetica-Bold").text("Secretaria Escolar", { align: "center" });
        drawRodape(doc, branding);
        doc.end();
    } catch (err) {
        console.error("Erro ao gerar atestado de matrícula:", err);
        return res.status(500).json({ error: "Erro ao gerar atestado de matrícula" });
    }
});

router.get("/:id/alunos/:alunoId/ficha-matricula-pdf", async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const alunoId = parseInt(req.params.alunoId, 10);
        if (isNaN(escolaId) || isNaN(alunoId)) {
            return res.status(400).json({ error: "Identificador inválido." });
        }

        const tenantId = getTenantId(req);
        const aluno = await loadAlunoMatriculaDetalhes({ escolaId, alunoId, tenantId });
        if (!aluno) {
            return res.status(404).json({ error: "Aluno não encontrado." });
        }

        const extras = aluno.dados_complementares || {};
        const branding = await getBranding(tenantId);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="ficha_matricula_${alunoId}.pdf"`);

        const doc = new PDFDocument({ size: "A4", margin: 45 });
        doc.pipe(res);
        drawCabecalho(doc, branding);
        doc.y = 120;
        doc.font("Helvetica-Bold").fontSize(15).text("FICHA DE MATRÍCULA DO ESTUDANTE", { align: "center" });
        doc.moveDown(1.4);

        function section(title) {
            doc.moveDown(0.8);
            doc.font("Helvetica-Bold").fontSize(11).text(title);
            doc.moveDown(0.25);
            doc.font("Helvetica").fontSize(10.5);
        }
        function line(label, value) {
            doc.font("Helvetica-Bold").text(label + ": ", { continued: true });
            doc.font("Helvetica").text(value || "Não informado");
        }

        section("1. Identificação do estudante");
        line("Nome completo", aluno.pessoa_nome);
        line("Nome social", aluno.nome_social);
        line("CPF", aluno.cpf);
        line("ID/Matrícula na rede", aluno.id_pessoa ? String(aluno.id_pessoa) : null);
        line("Data de nascimento", formatDatePtBr(aluno.data_nascimento));
        line("Sexo", aluno.sexo);
        line("RG", aluno.rg);
        line("Certidão de nascimento", aluno.certidao_nascimento);
        line("NIS", aluno.nis);
        line("Cartão SUS", aluno.cartao_sus);

        section("2. Dados escolares");
        line("Escola", aluno.escola_nome || aluno.unidade_ensino);
        line("Código INEP", aluno.codigo_inep);
        line("Ano letivo", aluno.ano_letivo ? String(aluno.ano_letivo) : null);
        line("Turma", aluno.turma_escola || aluno.turma);
        line("Ano/Série", aluno.ano);
        line("Etapa", aluno.etapa);
        line("Modalidade", aluno.modalidade);
        line("Formato letivo", aluno.formato_letivo);
        line("Data da matrícula", formatDatePtBr(aluno.data_matricula));
        line("Status", aluno.status);

        section("3. Filiação e responsáveis");
        line("Filiação 1", aluno.filiacao_1);
        line("Telefone filiação 1", aluno.telefone_filiacao_1);
        line("Filiação 2", aluno.filiacao_2);
        line("Telefone filiação 2", aluno.telefone_filiacao_2);
        line("Responsável principal", aluno.responsavel);
        line("Telefone do responsável", aluno.telefone_responsavel);
        line("E-mail do responsável", aluno.email_responsavel);
        line("Contato de emergência", aluno.contato_emergencia_nome);
        line("Telefone de emergência", aluno.telefone_emergencia);

        section("4. Endereço e localização");
        line("Endereço", formatEnderecoAluno(aluno));
        line("Complemento", aluno.complemento_endereco);
        line("Ponto de referência", aluno.ponto_referencia);
        line("Zona", aluno.zona);

        section("5. Saúde, inclusão e transporte");
        line("Deficiência/condição", aluno.deficiencia);
        line("Diagnósticos", aluno.diagnosticos);
        line("Medicações", aluno.medicacoes);
        line("Restrições de saúde", aluno.restricoes_saude);
        line("Alergias", aluno.alergias);
        line("Transporte escolar público utiliza", aluno.transporte_escolar_publico_utiliza);
        line("Apto ao transporte", aluno.transporte_apto ? "Sim" : "Não");

        section("6. Informações complementares");
        line("Benefício social", extras.beneficio_social);
        line("Escola de origem", extras.escola_origem);
        line("Rede de origem", extras.rede_origem);
        line("Situação escolar", extras.situacao_escolar);
        line("Matriculante", extras.matriculante_nome);
        line("CPF do matriculante", extras.matriculante_cpf);
        line("Vínculo do matriculante", extras.matriculante_parentesco);
        line("Observações gerais", aluno.observacoes_gerais || extras.observacoes_convivencia);

        drawRodape(doc, branding);
        doc.end();
    } catch (err) {
        console.error("Erro ao gerar ficha de matrícula:", err);
        return res.status(500).json({ error: "Erro ao gerar ficha de matrícula" });
    }
});

router.post("/:id/transporte/rota-pedestre", async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        if (isNaN(escolaId)) {
            return res.status(400).json({ error: "ID de escola inválido." });
        }

        const tenantId = getTenantId(req);
        const tenantSupport = await getTenantColumnSupport();
        const escolaParams = [escolaId];
        let escolaTenantWhere = '';
        if (tenantSupport.escolas && tenantId) {
            escolaParams.push(tenantId);
            escolaTenantWhere = 'AND tenant_id = $2';
        }

        const escolaResult = await pool.query(
            `
            SELECT
                id,
                nome,
                ST_Y(localizacao::geometry) AS latitude,
                ST_X(localizacao::geometry) AS longitude
            FROM escolas
            WHERE id = $1
            ${escolaTenantWhere}
            LIMIT 1
            `,
            escolaParams,
        );

        if (!escolaResult.rowCount) {
            return res.status(404).json({ error: "Escola não encontrada." });
        }

        const escola = escolaResult.rows[0];
        const origem = {
            lat: parseOptionalCoordinate(req.body?.latitude),
            lng: parseOptionalCoordinate(req.body?.longitude),
        };
        const destino = {
            lat: parseOptionalCoordinate(escola.latitude),
            lng: parseOptionalCoordinate(escola.longitude),
        };

        if (!Number.isFinite(origem.lat) || !Number.isFinite(origem.lng)) {
            return res.status(400).json({ error: "Informe a localização do aluno para calcular o trajeto." });
        }
        if (!Number.isFinite(destino.lat) || !Number.isFinite(destino.lng)) {
            return res.status(400).json({ error: "A escola não possui localização geográfica cadastrada." });
        }

        const trajeto = await calcularTrajetoPedestre({ origem, destino });
        return res.json({
            escola: {
                id: escola.id,
                nome: escola.nome,
                latitude: destino.lat,
                longitude: destino.lng,
            },
            origem,
            destino,
            trajeto,
        });
    } catch (err) {
        console.error("Erro ao calcular trajeto pedestre da matrícula:", err);
        return res.status(500).json({ error: "Erro ao calcular trajeto pedestre da matrícula" });
    }
});

router.get("/geocode/reverse", async (req, res) => {
    try {
        const { lat, lng } = req.query;

        if (!lat || !lng) {
            return res.status(400).json({ error: "Parâmetros lat e lng são obrigatórios." });
        }

        const GOOGLE_API_KEY = process.env.GOOGLE_MAPS_API_KEY;
        if (!GOOGLE_API_KEY) {
            console.error("GOOGLE_MAPS_API_KEY não configurada.");
            return res.status(500).json({ error: "Serviço de geocodificação não configurado." });
        }

        const url = `https://maps.googleapis.com/maps/api/geocode/json?latlng=${lat},${lng}&language=pt-BR&key=${GOOGLE_API_KEY}`;

        const resp = await fetch(url);
        if (!resp.ok) {
            return res.status(500).json({ error: "Falha ao consultar o serviço de geocodificação." });
        }

        const data = await resp.json();
        if (!data.results || !data.results.length) {
            return res.status(404).json({ error: "Nenhum endereço encontrado para estas coordenadas." });
        }

        const result = data.results[0];
        const components = result.address_components || [];

        const getComp = (type) =>
            components.find((c) => c.types && c.types.includes(type)) || {};

        const route = getComp("route").long_name || "";
        const streetNumber = getComp("street_number").long_name || "";
        const neighborhood =
            getComp("sublocality_level_1").long_name ||
            getComp("sublocality").long_name ||
            getComp("political").long_name ||
            "";
        const postalCode = getComp("postal_code").long_name || "";
        const city = getComp("administrative_area_level_2").long_name || "";
        const state = getComp("administrative_area_level_1").short_name || "";

        const endereco = {
            logradouro: route,
            numero: streetNumber,
            bairro: neighborhood,
            cep: postalCode,
            cidade: city,
            uf: state,
            referencia: result.formatted_address
        };

        return res.json(endereco);
    } catch (err) {
        console.error("Erro na geocodificação reversa:", err);
        return res.status(500).json({ error: "Erro interno ao processar a geocodificação." });
    }
});

router.get("/:id", async (req, res) => {
    try {
        const idRaw = req.params.id;
        const id = parseInt(idRaw, 10);

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de escola inválido." });
        }

        const tenantId = getTenantId(req);
        const tenantSupport = await getTenantColumnSupport();

        const params = [id];
        const tenantWhere = tenantSupport.escolas && tenantId ? `AND e.tenant_id = $2` : "";

        if (tenantSupport.escolas && tenantId) params.push(tenantId);
        const zoneamentoTenantClause = tenantSupport.escola_zoneamento && tenantSupport.escolas && tenantId
            ? "AND ez.tenant_id = e.tenant_id"
            : "";

        const sql = `
            SELECT 
                e.*,
                ST_AsGeoJSON(e.localizacao)::json AS localizacao_geojson,
                COALESCE(
                    (
                        SELECT json_agg(z.id)
                        FROM escola_zoneamento ez
                        JOIN zoneamentos z ON z.id = ez.zoneamento_id
                        WHERE ez.escola_id = e.id
                          ${zoneamentoTenantClause}
                    ),
                '[]') AS zoneamento_ids
            FROM escolas e
            WHERE e.id = $1
            ${tenantWhere}
            LIMIT 1
        `;
        const result = await pool.query(sql, params);

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Escola não encontrada" });
        }

        return res.json(result.rows[0]);
    } catch (err) {
        console.error("Erro ao buscar escola:", err);
        return res.status(500).json({ error: "Erro ao buscar escola" });
    }
});

router.post("/", async (req, res) => {
    const client = await pool.connect();
    try {
        const tenantSupport = await getTenantColumnSupport();
        const tenantId = getTenantId(req);
        if (tenantSupport.escolas && !tenantId) {
            return res.status(400).json({ error: "tenant_id não identificado (req.user/req.tenant_id ou header x-tenant-id)." });
        }

        const {
            nome,
            codigo_inep,
            logradouro,
            numero,
            complemento,
            referencia,
            bairro,
            cep,
            localizacao,
            ensino_regime,
            ensino_nivel,
            ensino_horario,
            zoneamento_ids
        } = req.body;

        if (!localizacao || !localizacao.coordinates) {
            return res.status(400).json({ error: "Localização obrigatória" });
        }

        const [lng, lat] = localizacao.coordinates;

        await client.query("BEGIN");

        const escolaColumns = [
            nome,
            codigo_inep,
            logradouro,
            numero,
            complemento,
            referencia,
            bairro,
            cep,
            ensino_regime ?? [],
            ensino_nivel ?? [],
            ensino_horario ?? [],
        ];

        let insertEscola = `
            INSERT INTO escolas (
                nome, codigo_inep, logradouro, numero, complemento, referencia,
                bairro, cep, localizacao, ensino_regime, ensino_nivel, ensino_horario
            ) VALUES (
                $1, $2, $3, $4, $5, $6,
                $7, $8, ${buildPoint(lat, lng)}, $9, $10, $11
            )
            RETURNING id
        `;

        if (tenantSupport.escolas) {
            escolaColumns.push(tenantId);
            insertEscola = `
                INSERT INTO escolas (
                    nome, codigo_inep, logradouro, numero, complemento, referencia,
                    bairro, cep, localizacao, ensino_regime, ensino_nivel, ensino_horario, tenant_id
                ) VALUES (
                    $1, $2, $3, $4, $5, $6,
                    $7, $8, ${buildPoint(lat, lng)}, $9, $10, $11, $12
                )
                RETURNING id
            `;
        }

        const result = await client.query(insertEscola, escolaColumns);

        const escolaId = result.rows[0].id;

        if (Array.isArray(zoneamento_ids)) {
            for (const zid of zoneamento_ids) {
                if (tenantSupport.escola_zoneamento) {
                    await client.query(
                        `INSERT INTO escola_zoneamento (escola_id, zoneamento_id, tenant_id)
                         VALUES ($1, $2, $3)`,
                        [escolaId, zid, tenantId]
                    );
                } else {
                    await client.query(
                        `INSERT INTO escola_zoneamento (escola_id, zoneamento_id)
                         VALUES ($1, $2)`,
                        [escolaId, zid]
                    );
                }
            }
        }

        await client.query("COMMIT");
        return res.json({ id: escolaId, message: "Escola criada com sucesso" });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro ao criar escola:", err);
        return res.status(500).json({ error: "Erro ao criar escola" });
    } finally {
        client.release();
    }
});

router.put("/:id", async (req, res) => {
    const client = await pool.connect();
    try {
        const tenantSupport = await getTenantColumnSupport();
        const idRaw = req.params.id;
        const id = parseInt(idRaw, 10);

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de escola inválido." });
        }

        let tenantId = getTenantId(req);

        if (tenantSupport.escolas && !tenantId) {
            tenantId = await getTenantIdByEscolaId(client, id);
        }
        if (tenantSupport.escolas && !tenantId) {
            return res.status(404).json({ error: "Escola não encontrada (tenant_id não resolvido)." });
        }

        const {
            nome,
            codigo_inep,
            logradouro,
            numero,
            complemento,
            referencia,
            bairro,
            cep,
            localizacao,
            ensino_regime,
            ensino_nivel,
            ensino_horario,
            zoneamento_ids
        } = req.body;

        if (!localizacao || !localizacao.coordinates) {
            return res.status(400).json({ error: "Localização obrigatória" });
        }

        const [lng, lat] = localizacao.coordinates;

        await client.query("BEGIN");

        let sql = `
            UPDATE escolas SET
                nome=$1,
                codigo_inep=$2,
                logradouro=$3,
                numero=$4,
                complemento=$5,
                referencia=$6,
                bairro=$7,
                cep=$8,
                localizacao=${buildPoint(lat, lng)},
                ensino_regime=$9,
                ensino_nivel=$10,
                ensino_horario=$11,
                atualizado_em=NOW()
            WHERE id=$12
        `;

        const updateParams = [
            nome,
            codigo_inep,
            logradouro,
            numero,
            complemento,
            referencia,
            bairro,
            cep,
            ensino_regime ?? [],
            ensino_nivel ?? [],
            ensino_horario ?? [],
            id,
        ];

        if (tenantSupport.escolas) {
            updateParams.push(tenantId);
            sql += ` AND tenant_id=$13`;
        }

        const upd = await client.query(sql, updateParams);

        if (upd.rowCount === 0) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Escola não encontrada" });
        }

        if (tenantSupport.escola_zoneamento) {
            await client.query(`DELETE FROM escola_zoneamento WHERE escola_id=$1 AND tenant_id=$2`, [id, tenantId]);
        } else {
            await client.query(`DELETE FROM escola_zoneamento WHERE escola_id=$1`, [id]);
        }

        if (Array.isArray(zoneamento_ids)) {
            for (const zid of zoneamento_ids) {
                if (tenantSupport.escola_zoneamento) {
                    await client.query(
                        `INSERT INTO escola_zoneamento (escola_id, zoneamento_id, tenant_id)
                         VALUES ($1, $2, $3)`,
                        [id, zid, tenantId]
                    );
                } else {
                    await client.query(
                        `INSERT INTO escola_zoneamento (escola_id, zoneamento_id)
                         VALUES ($1, $2)`,
                        [id, zid]
                    );
                }
            }
        }

        await client.query("COMMIT");
        return res.json({ message: "Escola atualizada com sucesso" });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro ao atualizar escola:", err);
        return res.status(500).json({ error: "Erro ao atualizar escola" });
    } finally {
        client.release();
    }
});

router.delete("/:id", async (req, res) => {
    const client = await pool.connect();
    try {
        const tenantSupport = await getTenantColumnSupport();
        const idRaw = req.params.id;
        const id = parseInt(idRaw, 10);

        if (isNaN(id)) {
            return res.status(400).json({ error: "ID de escola inválido." });
        }

        let tenantId = getTenantId(req);
        if (tenantSupport.escolas && !tenantId) tenantId = await getTenantIdByEscolaId(client, id);
        if (tenantSupport.escolas && !tenantId) {
            return res.status(404).json({ error: "Escola não encontrada" });
        }

        await client.query("BEGIN");

        if (tenantSupport.escola_zoneamento) {
            await client.query(`DELETE FROM escola_zoneamento WHERE escola_id=$1 AND tenant_id=$2`, [id, tenantId]);
        } else {
            await client.query(`DELETE FROM escola_zoneamento WHERE escola_id=$1`, [id]);
        }

        if (tenantSupport.escolas) {
            await client.query(`DELETE FROM escolas WHERE id=$1 AND tenant_id=$2`, [id, tenantId]);
        } else {
            await client.query(`DELETE FROM escolas WHERE id=$1`, [id]);
        }

        await client.query("COMMIT");
        return res.json({ message: "Escola excluída com sucesso" });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro ao excluir escola:", err);
        return res.status(500).json({ error: "Erro ao excluir escola" });
    } finally {
        client.release();
    }
});

export default router;
