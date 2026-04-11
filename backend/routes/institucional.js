import express from "express";
import pool from "../db.js";
import { requirePermission } from "../middleware/auth.js";
import { recordSecurityLog } from "../services/security.js";

const router = express.Router();

let ensured = false;
let ensurePromise = null;
let supportCache = null;
let supportCacheAt = 0;
const SUPPORT_CACHE_TTL_MS = 5 * 60 * 1000;

function parseOptionalInt(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? Math.trunc(n) : null;
}

function parseOptionalText(value) {
    if (value === null || value === undefined) return null;
    const normalized = String(value).trim();
    return normalized ? normalized : null;
}

function parseOptionalTextArray(value) {
    if (Array.isArray(value)) {
        const items = value.map((item) => parseOptionalText(item)).filter(Boolean);
        return items.length ? items : null;
    }
    if (value === null || value === undefined) return null;
    const normalized = String(value)
        .split(',')
        .map((item) => parseOptionalText(item))
        .filter(Boolean);
    return normalized.length ? normalized : null;
}

function parseOptionalDecimal(value) {
    if (value === null || value === undefined || value === '') return null;
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
}

function parseBoolean(value, fallback = false) {
    if (value === null || value === undefined || value === '') return fallback;
    if (typeof value === 'boolean') return value;
    const normalized = String(value).trim().toLowerCase();
    return ['1', 'true', 'sim', 'yes', 'on'].includes(normalized);
}

function validationError(message) {
    const error = new Error(message);
    error.statusCode = 400;
    return error;
}

function requireTenantId(req) {
    const tenantId = Number(req.tenantId ?? req.user?.tenant_id);
    if (!Number.isFinite(tenantId) || tenantId <= 0) {
        const error = new Error('tenant_id ausente no contexto autenticado.');
        error.statusCode = 401;
        throw error;
    }
    return tenantId;
}

async function registrarAuditoriaInstitucional(req, payload = {}) {
    try {
        await recordSecurityLog({
            tenantId: payload.tenantId || req.tenantId || req.user?.tenant_id || null,
            userId: req.user?.id || null,
            email: req.user?.email || null,
            action: payload.action || 'INSTITUTIONAL_OPERATION',
            targetType: payload.targetType || 'cadastro_mestre',
            targetId: payload.targetId || null,
            description: payload.description || null,
            level: payload.level || 'info',
            scope: payload.scope || 'Secretaria',
            ip: req.ip,
            userAgent: req.headers['user-agent'] || null,
            metadata: payload.metadata || {},
        });
    } catch (error) {
        console.error('Falha ao registrar auditoria institucional:', error);
    }
}

async function getSupport() {
    const now = Date.now();
    if (supportCache && (now - supportCacheAt) < SUPPORT_CACHE_TTL_MS) {
        return supportCache;
    }

    const tables = [
        'escolas',
        'alunos_escolas',
        'alunos_municipais',
        'escola_turmas',
    ];
    const { rows } = await pool.query(
        `
        SELECT table_name, column_name
          FROM information_schema.columns
         WHERE table_schema = 'public'
           AND table_name = ANY($1::text[])
        `,
        [tables]
    );

    const byTable = new Map();
    for (const row of rows || []) {
        if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Set());
        byTable.get(row.table_name).add(row.column_name);
    }

    supportCache = {
        escolasTenantId: byTable.get('escolas')?.has('tenant_id') || false,
        alunosEscolasTenantId: byTable.get('alunos_escolas')?.has('tenant_id') || false,
        alunosMunicipaisNome: byTable.get('alunos_municipais')?.has('nome') || false,
        alunosMunicipaisPessoaNome: byTable.get('alunos_municipais')?.has('pessoa_nome') || false,
        alunosMunicipaisTurno: byTable.get('alunos_municipais')?.has('turno') || false,
        alunosMunicipaisFormatoLetivo: byTable.get('alunos_municipais')?.has('formato_letivo') || false,
        escolaTurmasExists: byTable.has('escola_turmas'),
        escolaTurmasTenantId: byTable.get('escola_turmas')?.has('tenant_id') || false,
    };
    supportCacheAt = now;
    return supportCache;
}

async function ensureInstitutionalSchema() {
    if (ensured) return;
    if (ensurePromise) return ensurePromise;

    ensurePromise = (async () => {
    await pool.query(`
        CREATE TABLE IF NOT EXISTS institucional_servidores (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            nome TEXT NOT NULL,
            cpf TEXT NULL,
            matricula_rede TEXT NULL,
            cargo TEXT NULL,
            funcao_principal TEXT NULL,
            vinculo_tipo TEXT NULL,
            email TEXT NULL,
            telefone TEXT NULL,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            observacoes TEXT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (tenant_id, matricula_rede)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS institucional_servidor_lotacoes (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            servidor_id BIGINT NOT NULL REFERENCES institucional_servidores(id) ON DELETE CASCADE,
            escola_id BIGINT NULL REFERENCES escolas(id) ON DELETE SET NULL,
            funcao TEXT NULL,
            carga_horaria INT NULL,
            principal BOOLEAN NOT NULL DEFAULT FALSE,
            inicio_vigencia DATE NULL,
            fim_vigencia DATE NULL,
            observacoes TEXT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS institucional_disciplinas (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            codigo TEXT NOT NULL,
            nome TEXT NOT NULL,
            abreviacao TEXT NULL,
            area_conhecimento TEXT NULL,
            carga_horaria_padrao INT NULL,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (tenant_id, codigo)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS institucional_series (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            codigo TEXT NOT NULL,
            nome TEXT NOT NULL,
            etapa TEXT NOT NULL,
            ordem INT NOT NULL DEFAULT 0,
            idade_minima INT NULL,
            idade_maxima INT NULL,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (tenant_id, codigo)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS institucional_turnos (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            codigo TEXT NOT NULL,
            nome TEXT NOT NULL,
            hora_inicio TEXT NULL,
            hora_fim TEXT NULL,
            carga_horaria_minutos INT NULL,
            ativo BOOLEAN NOT NULL DEFAULT TRUE,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            UNIQUE (tenant_id, codigo)
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS institucional_calendarios_letivos (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            escola_id BIGINT NULL REFERENCES escolas(id) ON DELETE SET NULL,
            nome TEXT NOT NULL,
            ano_letivo INT NOT NULL,
            data_inicio DATE NULL,
            data_fim DATE NULL,
            dias_letivos_previstos INT NULL,
            status TEXT NOT NULL DEFAULT 'PLANEJADO',
            observacoes TEXT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS institucional_periodos_letivos (
            id BIGSERIAL PRIMARY KEY,
            tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
            calendario_id BIGINT NOT NULL REFERENCES institucional_calendarios_letivos(id) ON DELETE CASCADE,
            nome TEXT NOT NULL,
            tipo TEXT NOT NULL,
            ordem INT NOT NULL DEFAULT 1,
            data_inicio DATE NULL,
            data_fim DATE NULL,
            data_fechamento DATE NULL,
            status TEXT NOT NULL DEFAULT 'ABERTO',
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS institucional_parametros_gerais (
            tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
            frequencia_minima NUMERIC(5,2) NOT NULL DEFAULT 75,
            nota_minima NUMERIC(5,2) NOT NULL DEFAULT 6,
            dias_letivos_minimos INT NOT NULL DEFAULT 200,
            carga_horaria_anual_horas INT NOT NULL DEFAULT 800,
            idade_corte_infantil INT NOT NULL DEFAULT 4,
            idade_corte_fundamental INT NOT NULL DEFAULT 6,
            permite_multisseriada BOOLEAN NOT NULL DEFAULT TRUE,
            max_estudantes_publico_ee_por_turma INT NOT NULL DEFAULT 2,
            tamanho_padrao_turma INT NOT NULL DEFAULT 30,
            turno_padrao TEXT NULL,
            tipo_avaliacao TEXT NULL,
            usa_recuperacao_paralela BOOLEAN NOT NULL DEFAULT TRUE,
            conselho_classe_obrigatorio BOOLEAN NOT NULL DEFAULT TRUE,
            observacoes_rede TEXT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS frequencia_minima NUMERIC(5,2) NOT NULL DEFAULT 75`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS nota_minima NUMERIC(5,2) NOT NULL DEFAULT 6`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS dias_letivos_minimos INT NOT NULL DEFAULT 200`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS carga_horaria_anual_horas INT NOT NULL DEFAULT 800`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS idade_corte_infantil INT NOT NULL DEFAULT 4`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS idade_corte_fundamental INT NOT NULL DEFAULT 6`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS permite_multisseriada BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS max_estudantes_publico_ee_por_turma INT NOT NULL DEFAULT 2`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS tamanho_padrao_turma INT NOT NULL DEFAULT 30`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS turno_padrao TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS tipo_avaliacao TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS usa_recuperacao_paralela BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS conselho_classe_obrigatorio BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS observacoes_rede TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS id BIGSERIAL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS nome_rede TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS secretaria_nome TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS municipio_uf TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS ano_letivo_padrao INT NULL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS regra_avaliacao TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS emite_documentos_com_logomarca BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS rematricula_automatica BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS exige_documentacao_completa_matricula BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS permite_transferencia_com_pendencia BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS exige_validacao_transferencia_interna BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS distancia_minima_transporte_km NUMERIC(6,2) NULL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS limite_faltas_alerta INT NULL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS tamanho_maximo_turma_infantil INT NULL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS tamanho_maximo_turma_fundamental INT NULL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS tamanho_maximo_turma_medio INT NULL`);
    await pool.query(`ALTER TABLE institucional_parametros_gerais ADD COLUMN IF NOT EXISTS observacoes_normativas TEXT NULL`);

    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS matricula_rede TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS matricula_funcional TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS funcao_principal TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS vinculo_tipo TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS rg TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS orgao_emissor_rg TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS data_nascimento DATE NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS sexo TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS telefone_secundario TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS cep TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS logradouro TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS numero TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS complemento TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS bairro TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS cidade TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS uf TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS escolaridade TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS formacao_principal TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS area_atuacao TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS data_admissao DATE NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS data_desligamento DATE NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS carga_horaria_semanal INT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS jornada_descricao TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);
    await pool.query(`ALTER TABLE institucional_servidores ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()`);

    await pool.query(`ALTER TABLE institucional_disciplinas ADD COLUMN IF NOT EXISTS bncc_area TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_disciplinas ADD COLUMN IF NOT EXISTS eixo_formativo TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_disciplinas ADD COLUMN IF NOT EXISTS etapa_recomendada TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_disciplinas ADD COLUMN IF NOT EXISTS sigla_censo TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_disciplinas ADD COLUMN IF NOT EXISTS ordem_curricular INT NULL`);
    await pool.query(`ALTER TABLE institucional_disciplinas ADD COLUMN IF NOT EXISTS componente_obrigatorio BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`ALTER TABLE institucional_disciplinas ADD COLUMN IF NOT EXISTS usa_nota BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`ALTER TABLE institucional_disciplinas ADD COLUMN IF NOT EXISTS observacoes TEXT NULL`);

    await pool.query(`ALTER TABLE institucional_series ADD COLUMN IF NOT EXISTS segmento TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_series ADD COLUMN IF NOT EXISTS nomenclatura_censo TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_series ADD COLUMN IF NOT EXISTS etapa_modalidade TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_series ADD COLUMN IF NOT EXISTS idade_referencia INT NULL`);
    await pool.query(`ALTER TABLE institucional_series ADD COLUMN IF NOT EXISTS carga_horaria_anual_horas INT NULL`);
    await pool.query(`ALTER TABLE institucional_series ADD COLUMN IF NOT EXISTS permite_distorcao_idade BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`ALTER TABLE institucional_series ADD COLUMN IF NOT EXISTS usa_progressao_parcial BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE institucional_series ADD COLUMN IF NOT EXISTS observacoes TEXT NULL`);

    await pool.query(`ALTER TABLE institucional_turnos ADD COLUMN IF NOT EXISTS tolerancia_entrada_min INT NULL`);
    await pool.query(`ALTER TABLE institucional_turnos ADD COLUMN IF NOT EXISTS tolerancia_saida_min INT NULL`);
    await pool.query(`ALTER TABLE institucional_turnos ADD COLUMN IF NOT EXISTS intervalo_minutos INT NULL`);
    await pool.query(`ALTER TABLE institucional_turnos ADD COLUMN IF NOT EXISTS dias_semana TEXT[] NULL`);
    await pool.query(`ALTER TABLE institucional_turnos ADD COLUMN IF NOT EXISTS atendimento_sabado BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE institucional_turnos ADD COLUMN IF NOT EXISTS observacoes TEXT NULL`);

    await pool.query(`ALTER TABLE institucional_calendarios_letivos ADD COLUMN IF NOT EXISTS modelo_calendario TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_calendarios_letivos ADD COLUMN IF NOT EXISTS referencia_normativa TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_calendarios_letivos ADD COLUMN IF NOT EXISTS etapa_alcance TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_calendarios_letivos ADD COLUMN IF NOT EXISTS usa_sabado_letivo BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE institucional_calendarios_letivos ADD COLUMN IF NOT EXISTS dias_planejamento INT NULL`);
    await pool.query(`ALTER TABLE institucional_calendarios_letivos ADD COLUMN IF NOT EXISTS dias_recesso INT NULL`);
    await pool.query(`ALTER TABLE institucional_calendarios_letivos ADD COLUMN IF NOT EXISTS dias_avaliacao INT NULL`);
    await pool.query(`ALTER TABLE institucional_calendarios_letivos ADD COLUMN IF NOT EXISTS dias_nao_letivos INT NULL`);
    await pool.query(`ALTER TABLE institucional_calendarios_letivos ADD COLUMN IF NOT EXISTS aplica_transporte_escolar BOOLEAN NOT NULL DEFAULT TRUE`);

    await pool.query(`ALTER TABLE institucional_periodos_letivos ADD COLUMN IF NOT EXISTS referencia_codigo TEXT NULL`);
    await pool.query(`ALTER TABLE institucional_periodos_letivos ADD COLUMN IF NOT EXISTS peso_avaliativo NUMERIC(6,2) NULL`);
    await pool.query(`ALTER TABLE institucional_periodos_letivos ADD COLUMN IF NOT EXISTS exige_fechamento BOOLEAN NOT NULL DEFAULT TRUE`);
    await pool.query(`ALTER TABLE institucional_periodos_letivos ADD COLUMN IF NOT EXISTS permite_lancamento_fora_periodo BOOLEAN NOT NULL DEFAULT FALSE`);
    await pool.query(`ALTER TABLE institucional_periodos_letivos ADD COLUMN IF NOT EXISTS observacoes TEXT NULL`);

    await pool.query(`UPDATE institucional_servidores SET matricula_rede = COALESCE(matricula_rede, matricula) WHERE matricula_rede IS NULL AND matricula IS NOT NULL`);
    await pool.query(`UPDATE institucional_servidores SET funcao_principal = COALESCE(funcao_principal, funcao) WHERE funcao_principal IS NULL AND funcao IS NOT NULL`);
    await pool.query(`UPDATE institucional_servidores SET vinculo_tipo = COALESCE(vinculo_tipo, vinculo) WHERE vinculo_tipo IS NULL AND vinculo IS NOT NULL`);
    await pool.query(`UPDATE institucional_servidores SET created_at = COALESCE(created_at, criado_em, NOW()) WHERE created_at IS NULL`);
    await pool.query(`UPDATE institucional_servidores SET updated_at = COALESCE(updated_at, atualizado_em, NOW()) WHERE updated_at IS NULL`);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_institucional_servidores_tenant_nome ON institucional_servidores (tenant_id, nome)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_institucional_lotacoes_tenant_servidor ON institucional_servidor_lotacoes (tenant_id, servidor_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_institucional_disciplinas_tenant_nome ON institucional_disciplinas (tenant_id, nome)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_institucional_series_tenant_ordem ON institucional_series (tenant_id, ordem, nome)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_institucional_turnos_tenant_nome ON institucional_turnos (tenant_id, nome)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_institucional_calendarios_tenant_ano ON institucional_calendarios_letivos (tenant_id, ano_letivo DESC, escola_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_institucional_periodos_tenant_calendario ON institucional_periodos_letivos (tenant_id, calendario_id, ordem)`);

    ensured = true;
    })()
        .finally(() => {
            ensurePromise = null;
        });

    return ensurePromise;
}

router.use(async (req, res, next) => {
    try {
        await ensureInstitutionalSchema();
        next();
    } catch (error) {
        console.error('Erro ao preparar schema institucional:', error);
        res.status(500).json({ error: 'Falha ao preparar o módulo institucional.' });
    }
});

async function listEscolasByTenant(tenantId) {
    const support = await getSupport();
    const sql = support.escolasTenantId
        ? `
            SELECT id, nome, codigo_inep, logradouro, numero, bairro, cep
              FROM escolas
             WHERE tenant_id = $1
             ORDER BY nome ASC
          `
        : `
            SELECT id, nome, codigo_inep, logradouro, numero, bairro, cep
              FROM escolas
             ORDER BY nome ASC
          `;
    const params = support.escolasTenantId ? [tenantId] : [];
    const { rows } = await pool.query(sql, params);
    return rows.map((row) => ({
        id: row.id,
        nome: row.nome,
        codigo_inep: row.codigo_inep,
        endereco: [row.logradouro, row.numero].filter(Boolean).join(', ') || null,
        bairro: row.bairro || null,
        cep: row.cep || null,
    }));
}

async function getParametrosGerais(tenantId) {
    await pool.query(
        `
        INSERT INTO institucional_parametros_gerais (tenant_id)
        SELECT $1
         WHERE NOT EXISTS (
            SELECT 1
              FROM institucional_parametros_gerais
             WHERE tenant_id = $1
         )
        `,
        [tenantId]
    );
    const { rows } = await pool.query(
        `SELECT * FROM institucional_parametros_gerais WHERE tenant_id = $1 ORDER BY id NULLS LAST LIMIT 1`,
        [tenantId]
    );
    return rows[0] || null;
}

router.get('/overview', requirePermission('institution.master.view'), async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const [servidores, disciplinas, series, turnos, calendarios, periodos] = await Promise.all([
            pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ativo = TRUE)::int AS ativos FROM institucional_servidores WHERE tenant_id = $1`, [tenantId]),
            pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ativo = TRUE)::int AS ativos FROM institucional_disciplinas WHERE tenant_id = $1`, [tenantId]),
            pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ativo = TRUE)::int AS ativos FROM institucional_series WHERE tenant_id = $1`, [tenantId]),
            pool.query(`SELECT COUNT(*)::int AS total, COUNT(*) FILTER (WHERE ativo = TRUE)::int AS ativos FROM institucional_turnos WHERE tenant_id = $1`, [tenantId]),
            pool.query(`SELECT COUNT(*)::int AS total FROM institucional_calendarios_letivos WHERE tenant_id = $1`, [tenantId]),
            pool.query(`SELECT COUNT(*)::int AS total FROM institucional_periodos_letivos WHERE tenant_id = $1`, [tenantId]),
        ]);

        return res.json({
            servidores: servidores.rows[0] || { total: 0, ativos: 0 },
            disciplinas: disciplinas.rows[0] || { total: 0, ativos: 0 },
            series: series.rows[0] || { total: 0, ativos: 0 },
            turnos: turnos.rows[0] || { total: 0, ativos: 0 },
            calendarios: calendarios.rows[0] || { total: 0 },
            periodos: periodos.rows[0] || { total: 0 },
        });
    } catch (error) {
        console.error('Erro ao carregar overview institucional:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Falha ao carregar overview institucional.' });
    }
});

router.get('/meta/escolas', requirePermission('institution.master.view'), async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const escolas = await listEscolasByTenant(tenantId);
        res.json(escolas);
    } catch (error) {
        console.error('Erro ao listar escolas institucionais:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Falha ao listar escolas.' });
    }
});

router.get('/meta/calendarios', requirePermission('institution.master.view'), async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const { rows } = await pool.query(
            `
            SELECT c.id, c.nome, c.ano_letivo, c.escola_id, e.nome AS escola_nome
              FROM institucional_calendarios_letivos c
              LEFT JOIN escolas e ON e.id = c.escola_id
             WHERE c.tenant_id = $1
             ORDER BY c.ano_letivo DESC, c.nome ASC
            `,
            [tenantId]
        );
        res.json(rows);
    } catch (error) {
        console.error('Erro ao listar calendários institucionais:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Falha ao listar calendários.' });
    }
});

router.get('/servidores', requirePermission('institution.master.view'), async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const { rows } = await pool.query(
            `
            SELECT s.*,
                   COALESCE(s.matricula_rede, s.matricula) AS matricula_rede,
                   COALESCE(s.funcao_principal, s.funcao) AS funcao_principal,
                   COALESCE(s.vinculo_tipo, s.vinculo) AS vinculo_tipo,
                   COALESCE(
                     json_agg(
                       DISTINCT jsonb_build_object(
                         'id', l.id,
                         'escola_id', l.escola_id,
                         'escola_nome', e.nome,
                         'funcao', l.funcao,
                         'carga_horaria', l.carga_horaria,
                         'principal', l.principal,
                         'inicio_vigencia', l.inicio_vigencia,
                         'fim_vigencia', l.fim_vigencia,
                         'observacoes', l.observacoes
                       )
                     ) FILTER (WHERE l.id IS NOT NULL),
                     '[]'::json
                   ) AS lotacoes
              FROM institucional_servidores s
              LEFT JOIN institucional_servidor_lotacoes l
                ON l.servidor_id = s.id
               AND l.tenant_id = s.tenant_id
              LEFT JOIN escolas e
                ON e.id = l.escola_id
             WHERE s.tenant_id = $1
             GROUP BY s.id
             ORDER BY s.nome ASC
            `,
            [tenantId]
        );
        res.json(rows);
    } catch (error) {
        console.error('Erro ao listar servidores:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Falha ao listar servidores.' });
    }
});

router.post('/servidores', requirePermission('institution.master.manage'), async (req, res) => {
    const client = await pool.connect();
    try {
        const tenantId = requireTenantId(req);
        const nome = parseOptionalText(req.body?.nome);
        if (!nome) return res.status(400).json({ error: 'nome é obrigatório.' });

        await client.query('BEGIN');
        const lotacoes = Array.isArray(req.body?.lotacoes) ? req.body.lotacoes : [];
        const lotacaoPrincipal = lotacoes.find((lotacao) => parseBoolean(lotacao?.principal, false)) || lotacoes[0] || null;
        const { rows } = await client.query(
            `
            INSERT INTO institucional_servidores (
                tenant_id, escola_id, nome, cpf, matricula, matricula_rede, matricula_funcional,
                cargo, funcao, funcao_principal, vinculo, vinculo_tipo,
                email, telefone, telefone_secundario, rg, orgao_emissor_rg,
                data_nascimento, sexo, cep, logradouro, numero, complemento, bairro, cidade, uf,
                escolaridade, formacao_principal, area_atuacao,
                data_admissao, data_desligamento, carga_horaria_semanal, jornada_descricao,
                ativo, observacoes, updated_at
            ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26,$27,$28,$29,$30,$31,$32,$33,$34,$35,$36,NOW())
            RETURNING *
            `,
            [
                tenantId,
                parseOptionalInt(lotacaoPrincipal?.escola_id),
                nome,
                parseOptionalText(req.body?.cpf),
                parseOptionalText(req.body?.matricula_rede),
                parseOptionalText(req.body?.matricula_rede),
                parseOptionalText(req.body?.matricula_funcional),
                parseOptionalText(req.body?.cargo),
                parseOptionalText(req.body?.funcao_principal),
                parseOptionalText(req.body?.funcao_principal),
                parseOptionalText(req.body?.vinculo_tipo),
                parseOptionalText(req.body?.vinculo_tipo),
                parseOptionalText(req.body?.email),
                parseOptionalText(req.body?.telefone),
                parseOptionalText(req.body?.telefone_secundario),
                parseOptionalText(req.body?.rg),
                parseOptionalText(req.body?.orgao_emissor_rg),
                parseOptionalText(req.body?.data_nascimento),
                parseOptionalText(req.body?.sexo),
                parseOptionalText(req.body?.cep),
                parseOptionalText(req.body?.logradouro),
                parseOptionalText(req.body?.numero),
                parseOptionalText(req.body?.complemento),
                parseOptionalText(req.body?.bairro),
                parseOptionalText(req.body?.cidade),
                parseOptionalText(req.body?.uf),
                parseOptionalText(req.body?.escolaridade),
                parseOptionalText(req.body?.formacao_principal),
                parseOptionalText(req.body?.area_atuacao),
                parseOptionalText(req.body?.data_admissao),
                parseOptionalText(req.body?.data_desligamento),
                parseOptionalInt(req.body?.carga_horaria_semanal),
                parseOptionalText(req.body?.jornada_descricao),
                parseBoolean(req.body?.ativo, true),
                parseOptionalText(req.body?.observacoes),
            ]
        );
        const servidor = rows[0];
        for (const lotacao of lotacoes) {
            await client.query(
                `
                INSERT INTO institucional_servidor_lotacoes (
                    tenant_id, servidor_id, escola_id, funcao, carga_horaria, principal,
                    inicio_vigencia, fim_vigencia, observacoes, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
                `,
                [
                    tenantId,
                    servidor.id,
                    parseOptionalInt(lotacao?.escola_id),
                    parseOptionalText(lotacao?.funcao),
                    parseOptionalInt(lotacao?.carga_horaria),
                    parseBoolean(lotacao?.principal, false),
                    parseOptionalText(lotacao?.inicio_vigencia),
                    parseOptionalText(lotacao?.fim_vigencia),
                    parseOptionalText(lotacao?.observacoes),
                ]
            );
        }
        await client.query('COMMIT');
        await registrarAuditoriaInstitucional(req, {
            tenantId,
            action: 'INSTITUTIONAL_STAFF_CREATED',
            targetType: 'servidor',
            targetId: servidor.id,
            description: `Servidor institucional ${nome} cadastrado.`,
            metadata: { servidor_id: servidor.id, lotacoes: lotacoes.length },
        });
        res.status(201).json(servidor);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao criar servidor:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Falha ao criar servidor.' });
    } finally {
        client.release();
    }
});

router.put('/servidores/:id', requirePermission('institution.master.manage'), async (req, res) => {
    const client = await pool.connect();
    try {
        const tenantId = requireTenantId(req);
        const id = parseOptionalInt(req.params.id);
        const nome = parseOptionalText(req.body?.nome);
        if (!id) return res.status(400).json({ error: 'id inválido.' });
        if (!nome) return res.status(400).json({ error: 'nome é obrigatório.' });

        await client.query('BEGIN');
        const lotacoes = Array.isArray(req.body?.lotacoes) ? req.body.lotacoes : [];
        const lotacaoPrincipal = lotacoes.find((lotacao) => parseBoolean(lotacao?.principal, false)) || lotacoes[0] || null;
        const { rows } = await client.query(
            `
            UPDATE institucional_servidores
               SET escola_id = $3,
                   nome = $4,
                   cpf = $5,
                   matricula = $6,
                   matricula_rede = $7,
                   matricula_funcional = $8,
                   cargo = $9,
                   funcao = $10,
                   funcao_principal = $11,
                   vinculo = $12,
                   vinculo_tipo = $13,
                   email = $14,
                   telefone = $15,
                   telefone_secundario = $16,
                   rg = $17,
                   orgao_emissor_rg = $18,
                   data_nascimento = $19,
                   sexo = $20,
                   cep = $21,
                   logradouro = $22,
                   numero = $23,
                   complemento = $24,
                   bairro = $25,
                   cidade = $26,
                   uf = $27,
                   escolaridade = $28,
                   formacao_principal = $29,
                   area_atuacao = $30,
                   data_admissao = $31,
                   data_desligamento = $32,
                   carga_horaria_semanal = $33,
                   jornada_descricao = $34,
                   ativo = $35,
                   observacoes = $36,
                   updated_at = NOW()
             WHERE tenant_id = $1
               AND id = $2
             RETURNING *
            `,
            [
                tenantId,
                id,
                parseOptionalInt(lotacaoPrincipal?.escola_id),
                nome,
                parseOptionalText(req.body?.cpf),
                parseOptionalText(req.body?.matricula_rede),
                parseOptionalText(req.body?.matricula_rede),
                parseOptionalText(req.body?.matricula_funcional),
                parseOptionalText(req.body?.cargo),
                parseOptionalText(req.body?.funcao_principal),
                parseOptionalText(req.body?.funcao_principal),
                parseOptionalText(req.body?.vinculo_tipo),
                parseOptionalText(req.body?.vinculo_tipo),
                parseOptionalText(req.body?.email),
                parseOptionalText(req.body?.telefone),
                parseOptionalText(req.body?.telefone_secundario),
                parseOptionalText(req.body?.rg),
                parseOptionalText(req.body?.orgao_emissor_rg),
                parseOptionalText(req.body?.data_nascimento),
                parseOptionalText(req.body?.sexo),
                parseOptionalText(req.body?.cep),
                parseOptionalText(req.body?.logradouro),
                parseOptionalText(req.body?.numero),
                parseOptionalText(req.body?.complemento),
                parseOptionalText(req.body?.bairro),
                parseOptionalText(req.body?.cidade),
                parseOptionalText(req.body?.uf),
                parseOptionalText(req.body?.escolaridade),
                parseOptionalText(req.body?.formacao_principal),
                parseOptionalText(req.body?.area_atuacao),
                parseOptionalText(req.body?.data_admissao),
                parseOptionalText(req.body?.data_desligamento),
                parseOptionalInt(req.body?.carga_horaria_semanal),
                parseOptionalText(req.body?.jornada_descricao),
                parseBoolean(req.body?.ativo, true),
                parseOptionalText(req.body?.observacoes),
            ]
        );
        const servidor = rows[0];
        if (!servidor) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Servidor não encontrado.' });
        }
        await client.query(`DELETE FROM institucional_servidor_lotacoes WHERE tenant_id = $1 AND servidor_id = $2`, [tenantId, id]);
        for (const lotacao of lotacoes) {
            await client.query(
                `
                INSERT INTO institucional_servidor_lotacoes (
                    tenant_id, servidor_id, escola_id, funcao, carga_horaria, principal,
                    inicio_vigencia, fim_vigencia, observacoes, updated_at
                ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
                `,
                [
                    tenantId,
                    id,
                    parseOptionalInt(lotacao?.escola_id),
                    parseOptionalText(lotacao?.funcao),
                    parseOptionalInt(lotacao?.carga_horaria),
                    parseBoolean(lotacao?.principal, false),
                    parseOptionalText(lotacao?.inicio_vigencia),
                    parseOptionalText(lotacao?.fim_vigencia),
                    parseOptionalText(lotacao?.observacoes),
                ]
            );
        }
        await client.query('COMMIT');
        await registrarAuditoriaInstitucional(req, {
            tenantId,
            action: 'INSTITUTIONAL_STAFF_UPDATED',
            targetType: 'servidor',
            targetId: id,
            description: `Servidor institucional ${nome} atualizado.`,
            metadata: { servidor_id: id, lotacoes: lotacoes.length },
        });
        res.json(servidor);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Erro ao atualizar servidor:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Falha ao atualizar servidor.' });
    } finally {
        client.release();
    }
});

router.delete('/servidores/:id', requirePermission('institution.master.manage'), async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const id = parseOptionalInt(req.params.id);
        const { rows } = await pool.query(
            `DELETE FROM institucional_servidores WHERE tenant_id = $1 AND id = $2 RETURNING id, nome`,
            [tenantId, id]
        );
        if (!rows[0]) return res.status(404).json({ error: 'Servidor não encontrado.' });
        await registrarAuditoriaInstitucional(req, {
            tenantId,
            action: 'INSTITUTIONAL_STAFF_DELETED',
            targetType: 'servidor',
            targetId: id,
            description: `Servidor institucional ${rows[0].nome} removido.`,
        });
        res.json({ success: true });
    } catch (error) {
        console.error('Erro ao excluir servidor:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Falha ao excluir servidor.' });
    }
});

async function listSimpleResource(table, tenantId, orderBy = 'nome ASC') {
    const { rows } = await pool.query(`SELECT * FROM ${table} WHERE tenant_id = $1 ORDER BY ${orderBy}`, [tenantId]);
    return rows;
}

function mountSimpleCrud(resourceName, table, logPrefix, orderBy = 'nome ASC', validator = null) {
    router.get(`/${resourceName}`, requirePermission('institution.master.view'), async (req, res) => {
        try {
            const tenantId = requireTenantId(req);
            res.json(await listSimpleResource(table, tenantId, orderBy));
        } catch (error) {
            console.error(`Erro ao listar ${resourceName}:`, error);
            res.status(error.statusCode || 500).json({ error: error.message || `Falha ao listar ${resourceName}.` });
        }
    });

    router.post(`/${resourceName}`, requirePermission('institution.master.manage'), async (req, res) => {
        try {
            const tenantId = requireTenantId(req);
            const payload = validator ? validator(req.body || {}) : req.body || {};
            const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
            const columns = ['tenant_id', ...entries.map(([key]) => key), 'updated_at'];
            const params = [tenantId, ...entries.map(([, value]) => value), new Date()];
            const placeholders = columns.map((_, idx) => `$${idx + 1}`);
            const { rows } = await pool.query(
                `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${placeholders.join(', ')}) RETURNING *`,
                params
            );
            await registrarAuditoriaInstitucional(req, {
                tenantId,
                action: `${logPrefix}_CREATED`,
                targetType: resourceName,
                targetId: rows[0]?.id,
                description: `${resourceName} criado.`,
                metadata: rows[0] || {},
            });
            res.status(201).json(rows[0]);
        } catch (error) {
            console.error(`Erro ao criar ${resourceName}:`, error);
            res.status(error.statusCode || 500).json({ error: error.message || `Falha ao criar ${resourceName}.` });
        }
    });

    router.put(`/${resourceName}/:id`, requirePermission('institution.master.manage'), async (req, res) => {
        try {
            const tenantId = requireTenantId(req);
            const id = parseOptionalInt(req.params.id);
            const payload = validator ? validator(req.body || {}) : req.body || {};
            const entries = Object.entries(payload).filter(([, value]) => value !== undefined);
            if (!entries.length) return res.status(400).json({ error: 'Nenhum dado para atualizar.' });
            const sets = entries.map(([key], idx) => `${key} = $${idx + 3}`);
            const params = [tenantId, id, ...entries.map(([, value]) => value)];
            const { rows } = await pool.query(
                `
                UPDATE ${table}
                   SET ${sets.join(', ')},
                       updated_at = NOW()
                 WHERE tenant_id = $1
                   AND id = $2
                 RETURNING *
                `,
                params
            );
            if (!rows[0]) return res.status(404).json({ error: 'Registro não encontrado.' });
            await registrarAuditoriaInstitucional(req, {
                tenantId,
                action: `${logPrefix}_UPDATED`,
                targetType: resourceName,
                targetId: id,
                description: `${resourceName} atualizado.`,
                metadata: rows[0] || {},
            });
            res.json(rows[0]);
        } catch (error) {
            console.error(`Erro ao atualizar ${resourceName}:`, error);
            res.status(error.statusCode || 500).json({ error: error.message || `Falha ao atualizar ${resourceName}.` });
        }
    });

    router.delete(`/${resourceName}/:id`, requirePermission('institution.master.manage'), async (req, res) => {
        try {
            const tenantId = requireTenantId(req);
            const id = parseOptionalInt(req.params.id);
            const { rows } = await pool.query(
                `DELETE FROM ${table} WHERE tenant_id = $1 AND id = $2 RETURNING id`,
                [tenantId, id]
            );
            if (!rows[0]) return res.status(404).json({ error: 'Registro não encontrado.' });
            await registrarAuditoriaInstitucional(req, {
                tenantId,
                action: `${logPrefix}_DELETED`,
                targetType: resourceName,
                targetId: id,
                description: `${resourceName} removido.`,
            });
            res.json({ success: true });
        } catch (error) {
            console.error(`Erro ao excluir ${resourceName}:`, error);
            res.status(error.statusCode || 500).json({ error: error.message || `Falha ao excluir ${resourceName}.` });
        }
    });
}

mountSimpleCrud('disciplinas', 'institucional_disciplinas', 'INSTITUTIONAL_DISCIPLINE', 'nome ASC', (body) => {
    const codigo = parseOptionalText(body.codigo);
    const nome = parseOptionalText(body.nome);
    if (!codigo || !nome) throw validationError('codigo e nome são obrigatórios.');
    return {
        codigo,
        nome,
        abreviacao: parseOptionalText(body.abreviacao),
        area_conhecimento: parseOptionalText(body.area_conhecimento),
        carga_horaria_padrao: parseOptionalInt(body.carga_horaria_padrao),
        bncc_area: parseOptionalText(body.bncc_area),
        eixo_formativo: parseOptionalText(body.eixo_formativo),
        etapa_recomendada: parseOptionalText(body.etapa_recomendada),
        sigla_censo: parseOptionalText(body.sigla_censo),
        ordem_curricular: parseOptionalInt(body.ordem_curricular),
        componente_obrigatorio: parseBoolean(body.componente_obrigatorio, true),
        usa_nota: parseBoolean(body.usa_nota, true),
        observacoes: parseOptionalText(body.observacoes),
        ativo: parseBoolean(body.ativo, true),
    };
});

mountSimpleCrud('series', 'institucional_series', 'INSTITUTIONAL_SERIES', 'ordem ASC, nome ASC', (body) => {
    const codigo = parseOptionalText(body.codigo);
    const nome = parseOptionalText(body.nome);
    const etapa = parseOptionalText(body.etapa);
    if (!codigo || !nome || !etapa) throw validationError('codigo, nome e etapa são obrigatórios.');
    return {
        codigo,
        nome,
        etapa,
        ordem: parseOptionalInt(body.ordem) ?? 0,
        segmento: parseOptionalText(body.segmento),
        nomenclatura_censo: parseOptionalText(body.nomenclatura_censo),
        etapa_modalidade: parseOptionalText(body.etapa_modalidade),
        idade_minima: parseOptionalInt(body.idade_minima),
        idade_maxima: parseOptionalInt(body.idade_maxima),
        idade_referencia: parseOptionalInt(body.idade_referencia),
        carga_horaria_anual_horas: parseOptionalInt(body.carga_horaria_anual_horas),
        permite_distorcao_idade: parseBoolean(body.permite_distorcao_idade, true),
        usa_progressao_parcial: parseBoolean(body.usa_progressao_parcial, false),
        observacoes: parseOptionalText(body.observacoes),
        ativo: parseBoolean(body.ativo, true),
    };
});

mountSimpleCrud('turnos', 'institucional_turnos', 'INSTITUTIONAL_SHIFT', 'nome ASC', (body) => {
    const codigo = parseOptionalText(body.codigo);
    const nome = parseOptionalText(body.nome);
    if (!codigo || !nome) throw validationError('codigo e nome são obrigatórios.');
    return {
        codigo,
        nome,
        hora_inicio: parseOptionalText(body.hora_inicio),
        hora_fim: parseOptionalText(body.hora_fim),
        carga_horaria_minutos: parseOptionalInt(body.carga_horaria_minutos),
        tolerancia_entrada_min: parseOptionalInt(body.tolerancia_entrada_min),
        tolerancia_saida_min: parseOptionalInt(body.tolerancia_saida_min),
        intervalo_minutos: parseOptionalInt(body.intervalo_minutos),
        dias_semana: parseOptionalTextArray(body.dias_semana),
        atendimento_sabado: parseBoolean(body.atendimento_sabado, false),
        observacoes: parseOptionalText(body.observacoes),
        ativo: parseBoolean(body.ativo, true),
    };
});

mountSimpleCrud('calendarios', 'institucional_calendarios_letivos', 'INSTITUTIONAL_CALENDAR', 'ano_letivo DESC, nome ASC', (body) => {
    const nome = parseOptionalText(body.nome);
    const anoLetivo = parseOptionalInt(body.ano_letivo);
    if (!nome || !anoLetivo) throw validationError('nome e ano_letivo são obrigatórios.');
    return {
        escola_id: parseOptionalInt(body.escola_id),
        nome,
        ano_letivo: anoLetivo,
        data_inicio: parseOptionalText(body.data_inicio),
        data_fim: parseOptionalText(body.data_fim),
        dias_letivos_previstos: parseOptionalInt(body.dias_letivos_previstos),
        modelo_calendario: parseOptionalText(body.modelo_calendario),
        referencia_normativa: parseOptionalText(body.referencia_normativa),
        etapa_alcance: parseOptionalText(body.etapa_alcance),
        usa_sabado_letivo: parseBoolean(body.usa_sabado_letivo, false),
        dias_planejamento: parseOptionalInt(body.dias_planejamento),
        dias_recesso: parseOptionalInt(body.dias_recesso),
        dias_avaliacao: parseOptionalInt(body.dias_avaliacao),
        dias_nao_letivos: parseOptionalInt(body.dias_nao_letivos),
        aplica_transporte_escolar: parseBoolean(body.aplica_transporte_escolar, true),
        status: parseOptionalText(body.status) || 'PLANEJADO',
        observacoes: parseOptionalText(body.observacoes),
    };
});

mountSimpleCrud('periodos', 'institucional_periodos_letivos', 'INSTITUTIONAL_PERIOD', 'ordem ASC, nome ASC', (body) => {
    const calendarioId = parseOptionalInt(body.calendario_id);
    const nome = parseOptionalText(body.nome);
    const tipo = parseOptionalText(body.tipo);
    if (!calendarioId || !nome || !tipo) throw validationError('calendario_id, nome e tipo são obrigatórios.');
    return {
        calendario_id: calendarioId,
        nome,
        tipo,
        ordem: parseOptionalInt(body.ordem) ?? 1,
        referencia_codigo: parseOptionalText(body.referencia_codigo),
        peso_avaliativo: parseOptionalDecimal(body.peso_avaliativo),
        exige_fechamento: parseBoolean(body.exige_fechamento, true),
        permite_lancamento_fora_periodo: parseBoolean(body.permite_lancamento_fora_periodo, false),
        data_inicio: parseOptionalText(body.data_inicio),
        data_fim: parseOptionalText(body.data_fim),
        data_fechamento: parseOptionalText(body.data_fechamento),
        status: parseOptionalText(body.status) || 'ABERTO',
        observacoes: parseOptionalText(body.observacoes),
    };
});

router.get('/parametros', requirePermission('institution.master.view'), async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        res.json(await getParametrosGerais(tenantId));
    } catch (error) {
        console.error('Erro ao obter parâmetros gerais:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Falha ao obter parâmetros gerais.' });
    }
});

router.put('/parametros', requirePermission('institution.master.manage'), async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const current = await getParametrosGerais(tenantId);
        const next = {
            nome_rede: req.body?.nome_rede ?? current.nome_rede,
            secretaria_nome: req.body?.secretaria_nome ?? current.secretaria_nome,
            municipio_uf: req.body?.municipio_uf ?? current.municipio_uf,
            ano_letivo_padrao: req.body?.ano_letivo_padrao ?? current.ano_letivo_padrao,
            frequencia_minima: req.body?.frequencia_minima ?? current.frequencia_minima,
            nota_minima: req.body?.nota_minima ?? current.nota_minima,
            dias_letivos_minimos: req.body?.dias_letivos_minimos ?? current.dias_letivos_minimos,
            carga_horaria_anual_horas: req.body?.carga_horaria_anual_horas ?? current.carga_horaria_anual_horas,
            regra_avaliacao: req.body?.regra_avaliacao ?? current.regra_avaliacao,
            idade_corte_infantil: req.body?.idade_corte_infantil ?? current.idade_corte_infantil,
            idade_corte_fundamental: req.body?.idade_corte_fundamental ?? current.idade_corte_fundamental,
            permite_multisseriada: req.body?.permite_multisseriada ?? current.permite_multisseriada,
            max_estudantes_publico_ee_por_turma: req.body?.max_estudantes_publico_ee_por_turma ?? current.max_estudantes_publico_ee_por_turma,
            tamanho_padrao_turma: req.body?.tamanho_padrao_turma ?? current.tamanho_padrao_turma,
            turno_padrao: req.body?.turno_padrao ?? current.turno_padrao,
            tipo_avaliacao: req.body?.tipo_avaliacao ?? current.tipo_avaliacao,
            usa_recuperacao_paralela: req.body?.usa_recuperacao_paralela ?? current.usa_recuperacao_paralela,
            conselho_classe_obrigatorio: req.body?.conselho_classe_obrigatorio ?? current.conselho_classe_obrigatorio,
            emite_documentos_com_logomarca: req.body?.emite_documentos_com_logomarca ?? current.emite_documentos_com_logomarca,
            rematricula_automatica: req.body?.rematricula_automatica ?? current.rematricula_automatica,
            exige_documentacao_completa_matricula: req.body?.exige_documentacao_completa_matricula ?? current.exige_documentacao_completa_matricula,
            permite_transferencia_com_pendencia: req.body?.permite_transferencia_com_pendencia ?? current.permite_transferencia_com_pendencia,
            exige_validacao_transferencia_interna: req.body?.exige_validacao_transferencia_interna ?? current.exige_validacao_transferencia_interna,
            distancia_minima_transporte_km: req.body?.distancia_minima_transporte_km ?? current.distancia_minima_transporte_km,
            limite_faltas_alerta: req.body?.limite_faltas_alerta ?? current.limite_faltas_alerta,
            tamanho_maximo_turma_infantil: req.body?.tamanho_maximo_turma_infantil ?? current.tamanho_maximo_turma_infantil,
            tamanho_maximo_turma_fundamental: req.body?.tamanho_maximo_turma_fundamental ?? current.tamanho_maximo_turma_fundamental,
            tamanho_maximo_turma_medio: req.body?.tamanho_maximo_turma_medio ?? current.tamanho_maximo_turma_medio,
            observacoes_rede: req.body?.observacoes_rede ?? current.observacoes_rede,
            observacoes_normativas: req.body?.observacoes_normativas ?? current.observacoes_normativas,
        };
        const { rows } = await pool.query(
            `
            UPDATE institucional_parametros_gerais
               SET nome_rede = $2,
                   secretaria_nome = $3,
                   municipio_uf = $4,
                   ano_letivo_padrao = $5,
                   frequencia_minima = $6,
                   nota_minima = $7,
                   dias_letivos_minimos = $8,
                   carga_horaria_anual_horas = $9,
                   regra_avaliacao = $10,
                   idade_corte_infantil = $11,
                   idade_corte_fundamental = $12,
                   permite_multisseriada = $13,
                   max_estudantes_publico_ee_por_turma = $14,
                   tamanho_padrao_turma = $15,
                   turno_padrao = $16,
                   tipo_avaliacao = $17,
                   usa_recuperacao_paralela = $18,
                   conselho_classe_obrigatorio = $19,
                   emite_documentos_com_logomarca = $20,
                   rematricula_automatica = $21,
                   exige_documentacao_completa_matricula = $22,
                   permite_transferencia_com_pendencia = $23,
                   exige_validacao_transferencia_interna = $24,
                   distancia_minima_transporte_km = $25,
                   limite_faltas_alerta = $26,
                   tamanho_maximo_turma_infantil = $27,
                   tamanho_maximo_turma_fundamental = $28,
                   tamanho_maximo_turma_medio = $29,
                   observacoes_rede = $30,
                   observacoes_normativas = $31,
                   updated_at = NOW()
             WHERE tenant_id = $1
             RETURNING *
            `,
            [
                tenantId,
                parseOptionalText(next.nome_rede),
                parseOptionalText(next.secretaria_nome),
                parseOptionalText(next.municipio_uf),
                parseOptionalInt(next.ano_letivo_padrao),
                Number(next.frequencia_minima),
                Number(next.nota_minima),
                Number(next.dias_letivos_minimos),
                Number(next.carga_horaria_anual_horas),
                parseOptionalText(next.regra_avaliacao),
                Number(next.idade_corte_infantil),
                Number(next.idade_corte_fundamental),
                parseBoolean(next.permite_multisseriada, true),
                Number(next.max_estudantes_publico_ee_por_turma),
                Number(next.tamanho_padrao_turma),
                parseOptionalText(next.turno_padrao),
                parseOptionalText(next.tipo_avaliacao),
                parseBoolean(next.usa_recuperacao_paralela, true),
                parseBoolean(next.conselho_classe_obrigatorio, true),
                parseBoolean(next.emite_documentos_com_logomarca, true),
                parseBoolean(next.rematricula_automatica, false),
                parseBoolean(next.exige_documentacao_completa_matricula, false),
                parseBoolean(next.permite_transferencia_com_pendencia, false),
                parseBoolean(next.exige_validacao_transferencia_interna, true),
                parseOptionalDecimal(next.distancia_minima_transporte_km),
                parseOptionalInt(next.limite_faltas_alerta),
                parseOptionalInt(next.tamanho_maximo_turma_infantil),
                parseOptionalInt(next.tamanho_maximo_turma_fundamental),
                parseOptionalInt(next.tamanho_maximo_turma_medio),
                parseOptionalText(next.observacoes_rede),
                parseOptionalText(next.observacoes_normativas),
            ]
        );
        await registrarAuditoriaInstitucional(req, {
            tenantId,
            action: 'INSTITUTIONAL_PARAMETERS_UPDATED',
            targetType: 'parametros_gerais',
            targetId: tenantId,
            description: 'Parâmetros gerais da rede atualizados.',
            metadata: rows[0] || {},
        });
        res.json(rows[0] || null);
    } catch (error) {
        console.error('Erro ao atualizar parâmetros gerais:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Falha ao atualizar parâmetros gerais.' });
    }
});

router.get('/turmas', requirePermission('institution.master.view'), async (req, res) => {
    try {
        const tenantId = requireTenantId(req);
        const support = await getSupport();
        const enrollmentTenantClause = support.alunosEscolasTenantId ? 'AND ae.tenant_id = $1' : '';
        const alunoTurnoExpr = support.alunosMunicipaisTurno ? 'a.turno' : (support.alunosMunicipaisFormatoLetivo ? 'a.formato_letivo' : 'NULL');

        let rows = [];
        if (support.escolaTurmasExists) {
            const whereClauses = [];
            if (support.escolaTurmasTenantId) whereClauses.push('t.tenant_id = $1');
            if (support.escolasTenantId) whereClauses.push('e.tenant_id = $1');
            const query = `
                SELECT
                    t.id,
                    t.escola_id,
                    e.nome AS escola_nome,
                    t.nome AS turma,
                    t.ano_letivo,
                    COALESCE(NULLIF(t.turno, ''), 'Não informado') AS turno,
                    COALESCE(NULLIF(t.etapa, ''), 'Não informada') AS etapa,
                    COALESCE(NULLIF(t.modalidade, ''), 'Não informada') AS modalidade,
                    COALESCE(cnt.total_alunos, 0)::int AS total_alunos,
                    t.ativo
                FROM escola_turmas t
                JOIN escolas e
                  ON e.id = t.escola_id
                LEFT JOIN (
                    SELECT ae.escola_id, ae.ano_letivo, ae.turma, COUNT(DISTINCT ae.aluno_id)::int AS total_alunos
                      FROM alunos_escolas ae
                     WHERE 1 = 1
                       ${enrollmentTenantClause}
                     GROUP BY ae.escola_id, ae.ano_letivo, ae.turma
                ) cnt
                  ON cnt.escola_id = t.escola_id
                 AND cnt.ano_letivo = t.ano_letivo
                 AND cnt.turma = t.nome
                ${whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : ''}
                ORDER BY t.ano_letivo DESC NULLS LAST, e.nome ASC, t.nome ASC
            `;
            const params = support.escolaTurmasTenantId || support.escolasTenantId || support.alunosEscolasTenantId ? [tenantId] : [];
            const result = await pool.query(query, params);
            rows = result.rows || [];
        }

        if (!rows.length) {
            const fallbackSchoolClause = support.escolasTenantId ? 'AND e.tenant_id = $1' : '';
            const query = `
                SELECT
                    NULL::bigint AS id,
                    ae.escola_id,
                    e.nome AS escola_nome,
                    COALESCE(NULLIF(ae.turma, ''), 'Sem turma') AS turma,
                    ae.ano_letivo,
                    COALESCE(NULLIF(${alunoTurnoExpr}, ''), 'Não informado') AS turno,
                    COALESCE(NULLIF(a.etapa, ''), 'Não informada') AS etapa,
                    COALESCE(NULLIF(a.modalidade, ''), 'Não informada') AS modalidade,
                    COUNT(DISTINCT ae.aluno_id)::int AS total_alunos,
                    TRUE AS ativo
                  FROM alunos_escolas ae
                  JOIN escolas e ON e.id = ae.escola_id
                 LEFT JOIN alunos_municipais a ON a.id = ae.aluno_id
                 WHERE 1 = 1
                   ${enrollmentTenantClause}
                   ${fallbackSchoolClause}
                 GROUP BY ae.escola_id, e.nome, ae.turma, ae.ano_letivo, ${alunoTurnoExpr}, a.etapa, a.modalidade
                 ORDER BY ae.ano_letivo DESC NULLS LAST, e.nome ASC, turma ASC
            `;
            const params = support.alunosEscolasTenantId || support.escolasTenantId ? [tenantId] : [];
            const result = await pool.query(query, params);
            rows = result.rows || [];
        }

        res.json(rows);
    } catch (error) {
        console.error('Erro ao listar turmas institucionais:', error);
        res.status(error.statusCode || 500).json({ error: error.message || 'Falha ao listar turmas.' });
    }
});

export default router;
