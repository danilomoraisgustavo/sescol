import express from "express";
import PDFDocument from "pdfkit";
import pool from "../db.js";
import { getBranding, drawCabecalho, drawRodape } from "../services/brandingConfig.js";
import { requirePermission } from "../middleware/auth.js";
import { recordSecurityLog } from "../services/security.js";

const router = express.Router();
let tenantColumnCache = null;
let tenantColumnCacheAt = 0;
const TENANT_CACHE_TTL_MS = 5 * 60 * 1000;
let columnCache = null;
let columnCacheAt = 0;
let escolaTurmasTableEnsured = false;
let alunoComplementosTableEnsured = false;
let matriculasHistoricoTableEnsured = false;
let auditoriaEscolarTableEnsured = false;
let transferenciasInternasTableEnsured = false;
let alunosEscolasWorkflowEnsured = false;
let ocorrenciasEscolaresTableEnsured = false;
let transferenciasExternasTableEnsured = false;
let academicMaturityTablesEnsured = false;
let institutionalSupportCache = null;
let institutionalSupportCacheAt = 0;

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

async function getInstitutionalSupport() {
    const now = Date.now();
    if (institutionalSupportCache && (now - institutionalSupportCacheAt) < TENANT_CACHE_TTL_MS) {
        return institutionalSupportCache;
    }

    const tables = [
        'institucional_servidores',
        'institucional_servidor_lotacoes',
        'institucional_calendarios_letivos',
        'institucional_periodos_letivos',
        'institucional_parametros_gerais',
    ];

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

    institutionalSupportCache = {
        institucional_servidores: !!grouped.institucional_servidores,
        institucional_servidor_lotacoes: !!grouped.institucional_servidor_lotacoes,
        institucional_calendarios_letivos: !!grouped.institucional_calendarios_letivos,
        institucional_periodos_letivos: !!grouped.institucional_periodos_letivos,
        institucional_parametros_gerais: !!grouped.institucional_parametros_gerais,
        servidorFuncaoPrincipal: grouped.institucional_servidores?.has('funcao_principal') || false,
        servidorFuncao: grouped.institucional_servidores?.has('funcao') || false,
        servidorMatriculaRede: grouped.institucional_servidores?.has('matricula_rede') || false,
        servidorMatricula: grouped.institucional_servidores?.has('matricula') || false,
        periodosStatus: grouped.institucional_periodos_letivos?.has('status') || false,
        periodosAtivo: grouped.institucional_periodos_letivos?.has('ativo') || false,
        periodosUpdatedAt: grouped.institucional_periodos_letivos?.has('updated_at') || false,
        periodosAtualizadoEm: grouped.institucional_periodos_letivos?.has('atualizado_em') || false,
        parametrosFrequenciaMinima: grouped.institucional_parametros_gerais?.has('frequencia_minima') || false,
        parametrosNotaMinima: grouped.institucional_parametros_gerais?.has('nota_minima') || false,
        parametrosTurnoPadrao: grouped.institucional_parametros_gerais?.has('turno_padrao') || false,
        parametrosUsaRecuperacaoParalela: grouped.institucional_parametros_gerais?.has('usa_recuperacao_paralela') || false,
        parametrosPermiteMultisseriada: grouped.institucional_parametros_gerais?.has('permite_multisseriada') || false,
        parametrosDiasLetivosMinimos: grouped.institucional_parametros_gerais?.has('dias_letivos_minimos') || false,
    };
    institutionalSupportCacheAt = now;
    return institutionalSupportCache;
}

async function loadEscolaInstitutionalData({ escolaId, tenantId, escolaNome }) {
    const support = await getInstitutionalSupport();
    const empty = {
        calendario: null,
        periodos: [],
        equipe: { total: 0, principais: [], funcoes: [] },
        parametros: null,
        alertas: [],
    };

    if (!support.institucional_parametros_gerais &&
        !support.institucional_calendarios_letivos &&
        !support.institucional_servidor_lotacoes) {
        return empty;
    }

    const response = { ...empty };

    if (support.institucional_calendarios_letivos) {
        const { rows } = await pool.query(
            `
            SELECT c.*,
                   CASE WHEN c.escola_id = $2 THEN 0 WHEN c.escola_id IS NULL THEN 1 ELSE 2 END AS prioridade
              FROM institucional_calendarios_letivos c
             WHERE c.tenant_id = $1
               AND (c.escola_id = $2 OR c.escola_id IS NULL)
             ORDER BY prioridade ASC,
                      CASE WHEN upper(coalesce(c.status,'')) = 'EM_EXECUCAO' THEN 0 WHEN upper(coalesce(c.status,'')) = 'PLANEJADO' THEN 1 ELSE 2 END,
                      c.ano_letivo DESC NULLS LAST,
                      c.updated_at DESC NULLS LAST
             LIMIT 1
            `,
            [tenantId, escolaId],
        );
        response.calendario = rows[0] || null;

        if (response.calendario && support.institucional_periodos_letivos) {
            const periodStatusExpr = support.periodosStatus
                ? 'status'
                : (support.periodosAtivo ? "CASE WHEN ativo IS TRUE THEN 'ATIVO' ELSE 'INATIVO' END AS status" : "'ABERTO'::text AS status");
            const periodOrderExpr = support.periodosUpdatedAt ? 'updated_at' : (support.periodosAtualizadoEm ? 'atualizado_em' : 'data_inicio');
            const { rows: periodRows } = await pool.query(
                `
                SELECT *, ${periodStatusExpr}
                  FROM institucional_periodos_letivos
                 WHERE tenant_id = $1
                   AND calendario_id = $2
                 ORDER BY ordem ASC, ${periodOrderExpr} DESC NULLS LAST, data_inicio ASC NULLS LAST
                `,
                [tenantId, response.calendario.id],
            );
            response.periodos = periodRows || [];
        }
    }

    if (support.institucional_servidor_lotacoes && support.institucional_servidores) {
        const servidorFuncaoPrincipalExpr = support.servidorFuncaoPrincipal
            ? 's.funcao_principal'
            : (support.servidorFuncao ? 's.funcao AS funcao_principal' : 'NULL::text AS funcao_principal');
        const { rows } = await pool.query(
            `
            SELECT s.id, s.nome, s.cargo, ${servidorFuncaoPrincipalExpr}, s.ativo,
                   l.funcao, l.carga_horaria, l.principal, l.inicio_vigencia, l.fim_vigencia
              FROM institucional_servidor_lotacoes l
              JOIN institucional_servidores s
                ON s.id = l.servidor_id
               AND s.tenant_id = l.tenant_id
             WHERE l.tenant_id = $1
               AND l.escola_id = $2
             ORDER BY l.principal DESC, s.nome ASC
            `,
            [tenantId, escolaId],
        );
        response.equipe.total = rows.length;
        response.equipe.principais = rows.filter((row) => row.principal).slice(0, 4);
        response.equipe.funcoes = Object.entries(
            rows.reduce((acc, row) => {
                const key = parseOptionalText(row.funcao || row.funcao_principal || row.cargo) || 'Nao informada';
                acc[key] = (acc[key] || 0) + 1;
                return acc;
            }, {})
        ).map(([funcao, total]) => ({ funcao, total })).sort((a, b) => b.total - a.total);
    }

    if (support.institucional_parametros_gerais) {
        const { rows } = await pool.query(
            `
            SELECT *
              FROM institucional_parametros_gerais
             WHERE tenant_id = $1
             ORDER BY id NULLS LAST
             LIMIT 1
            `,
            [tenantId],
        );
        response.parametros = rows[0] || null;
        if (response.parametros) {
            if (!support.parametrosFrequenciaMinima && response.parametros.regra_avaliacao && !response.parametros.frequencia_minima) {
                response.parametros.frequencia_minima = null;
            }
            if (!support.parametrosNotaMinima) {
                response.parametros.nota_minima = response.parametros.nota_minima ?? null;
            }
            if (!support.parametrosTurnoPadrao) {
                response.parametros.turno_padrao = response.parametros.turno_padrao ?? null;
            }
            if (!support.parametrosUsaRecuperacaoParalela) {
                response.parametros.usa_recuperacao_paralela = response.parametros.usa_recuperacao_paralela ?? null;
            }
            if (!support.parametrosPermiteMultisseriada && Object.prototype.hasOwnProperty.call(response.parametros, 'permite_multisseriacao')) {
                response.parametros.permite_multisseriada = response.parametros.permite_multisseriacao;
            }
            if (!support.parametrosDiasLetivosMinimos && Object.prototype.hasOwnProperty.call(response.parametros, 'dias_letivos_minimos')) {
                response.parametros.dias_letivos_minimos = response.parametros.dias_letivos_minimos;
            }
        }
    }

    if (!response.calendario) {
        response.alertas.push({
            tipo: 'warning',
            titulo: 'Unidade sem calendário institucional',
            detalhe: `A escola ${escolaNome || ''} ainda não possui calendário letivo vinculado ou de rede aplicável.`,
        });
    }

    if (!response.equipe.total) {
        response.alertas.push({
            tipo: 'warning',
            titulo: 'Escola sem equipe lotada',
            detalhe: 'Não há servidores vinculados à unidade no cadastro mestre institucional.',
        });
    }

    if (response.equipe.total && !response.equipe.principais.length) {
        response.alertas.push({
            tipo: 'info',
            titulo: 'Sem lotação principal definida',
            detalhe: 'Há equipe vinculada, mas nenhuma lotação principal marcada para a unidade.',
        });
    }

    return response;
}

async function ensureEscolaTurmasTable() {
    if (escolaTurmasTableEnsured) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS escola_turmas (
            id SERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            escola_id INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
            nome TEXT NOT NULL,
            codigo_turma TEXT NULL,
            ano_letivo INTEGER NULL,
            turno TEXT NULL,
            tipo_turma TEXT NULL,
            organizacao_pedagogica TEXT NULL,
            etapa TEXT NULL,
            modalidade TEXT NULL,
            regime_letivo TEXT NULL,
            multisseriada BOOLEAN NOT NULL DEFAULT FALSE,
            series_abrangidas TEXT[] NULL,
            dias_semana TEXT[] NULL,
            horario_inicio TEXT NULL,
            horario_fim TEXT NULL,
            capacidade INTEGER NULL,
            limite_planejado_alunos INTEGER NULL,
            vagas_transporte_planejadas INTEGER NULL,
            vagas_inclusao_planejadas INTEGER NULL,
            total_estudantes_publico_ee INTEGER NULL,
            limite_estudantes_publico_ee INTEGER NULL,
            professor_referencia TEXT NULL,
            monitor_referencia TEXT NULL,
            auxiliar_apoio BOOLEAN NOT NULL DEFAULT FALSE,
            interprete_libras BOOLEAN NOT NULL DEFAULT FALSE,
            atendimento_educacional_especializado BOOLEAN NOT NULL DEFAULT FALSE,
            sala TEXT NULL,
            sala_acessivel BOOLEAN NOT NULL DEFAULT FALSE,
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
        ADD COLUMN IF NOT EXISTS codigo_turma TEXT NULL,
        ADD COLUMN IF NOT EXISTS tipo_turma TEXT NULL,
        ADD COLUMN IF NOT EXISTS organizacao_pedagogica TEXT NULL,
        ADD COLUMN IF NOT EXISTS regime_letivo TEXT NULL,
        ADD COLUMN IF NOT EXISTS multisseriada BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS series_abrangidas TEXT[] NULL,
        ADD COLUMN IF NOT EXISTS dias_semana TEXT[] NULL,
        ADD COLUMN IF NOT EXISTS horario_inicio TEXT NULL,
        ADD COLUMN IF NOT EXISTS horario_fim TEXT NULL,
        ADD COLUMN IF NOT EXISTS limite_planejado_alunos INTEGER NULL,
        ADD COLUMN IF NOT EXISTS vagas_transporte_planejadas INTEGER NULL,
        ADD COLUMN IF NOT EXISTS vagas_inclusao_planejadas INTEGER NULL,
        ADD COLUMN IF NOT EXISTS total_estudantes_publico_ee INTEGER NULL,
        ADD COLUMN IF NOT EXISTS limite_estudantes_publico_ee INTEGER NULL,
        ADD COLUMN IF NOT EXISTS professor_referencia TEXT NULL,
        ADD COLUMN IF NOT EXISTS monitor_referencia TEXT NULL,
        ADD COLUMN IF NOT EXISTS auxiliar_apoio BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS interprete_libras BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS atendimento_educacional_especializado BOOLEAN NOT NULL DEFAULT FALSE,
        ADD COLUMN IF NOT EXISTS sala_acessivel BOOLEAN NOT NULL DEFAULT FALSE
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

async function ensureMatriculasHistoricoTable() {
    if (matriculasHistoricoTableEnsured) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS alunos_escolas_historico (
            id SERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            aluno_id INTEGER NOT NULL,
            escola_id INTEGER NULL,
            escola_destino_id INTEGER NULL,
            ano_letivo INTEGER NULL,
            turma TEXT NULL,
            turma_destino TEXT NULL,
            tipo_evento TEXT NOT NULL,
            status_aluno TEXT NULL,
            detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
            criado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_alunos_escolas_historico_aluno
        ON alunos_escolas_historico (aluno_id, ano_letivo, criado_em DESC)
    `);

    matriculasHistoricoTableEnsured = true;
}

async function ensureAuditoriaEscolarTable() {
    if (auditoriaEscolarTableEnsured) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS auditoria_operacoes_escolares (
            id SERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            usuario_id BIGINT NULL,
            usuario_nome TEXT NULL,
            usuario_email TEXT NULL,
            modulo TEXT NOT NULL,
            entidade TEXT NOT NULL,
            entidade_id TEXT NULL,
            acao TEXT NOT NULL,
            origem TEXT NULL,
            detalhes JSONB NOT NULL DEFAULT '{}'::jsonb,
            criado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_auditoria_operacoes_escolares_entidade
        ON auditoria_operacoes_escolares (entidade, entidade_id, criado_em DESC)
    `);

    auditoriaEscolarTableEnsured = true;
}

async function ensureTransferenciasInternasTable() {
    if (transferenciasInternasTableEnsured) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS alunos_transferencias_internas (
            id SERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            aluno_id INTEGER NOT NULL,
            escola_origem_id INTEGER NOT NULL,
            escola_destino_id INTEGER NOT NULL,
            ano_letivo INTEGER NULL,
            turma_origem TEXT NULL,
            turma_destino TEXT NULL,
            status TEXT NOT NULL DEFAULT 'PENDENTE_AUTORIZACAO',
            motivo TEXT NULL,
            observacoes TEXT NULL,
            protocolo TEXT NULL,
            codigo_validacao TEXT NULL,
            responsavel_nome TEXT NULL,
            responsavel_documento TEXT NULL,
            responsavel_parentesco TEXT NULL,
            responsavel_telefone TEXT NULL,
            responsavel_email TEXT NULL,
            autorizacao_assinada BOOLEAN NOT NULL DEFAULT FALSE,
            solicitado_por_usuario_id BIGINT NULL,
            concluido_por_usuario_id BIGINT NULL,
            autorizado_em TIMESTAMP WITHOUT TIME ZONE NULL,
            concluido_em TIMESTAMP WITHOUT TIME ZONE NULL,
            criado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_alunos_transferencias_internas_aluno
        ON alunos_transferencias_internas (aluno_id, criado_em DESC)
    `);

    await pool.query(`ALTER TABLE alunos_transferencias_internas ADD COLUMN IF NOT EXISTS codigo_validacao TEXT NULL`);

    transferenciasInternasTableEnsured = true;
}

async function ensureOcorrenciasEscolaresTable() {
    if (ocorrenciasEscolaresTableEnsured) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS aluno_ocorrencias_escolares (
            id SERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            escola_id INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
            aluno_id INTEGER NOT NULL,
            turma TEXT NULL,
            ano_letivo INTEGER NULL,
            categoria TEXT NOT NULL,
            subcategoria TEXT NULL,
            gravidade TEXT NOT NULL DEFAULT 'MEDIA',
            status TEXT NOT NULL DEFAULT 'ABERTA',
            titulo TEXT NOT NULL,
            descricao TEXT NULL,
            providencias TEXT NULL,
            encaminhamento TEXT NULL,
            data_ocorrencia TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            data_fechamento TIMESTAMP WITHOUT TIME ZONE NULL,
            responsavel_registro_id BIGINT NULL,
            responsavel_registro_nome TEXT NULL,
            sigilosa BOOLEAN NOT NULL DEFAULT FALSE,
            criado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_aluno_ocorrencias_escolares_aluno
        ON aluno_ocorrencias_escolares (aluno_id, data_ocorrencia DESC)
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_aluno_ocorrencias_escolares_escola
        ON aluno_ocorrencias_escolares (escola_id, ano_letivo, status)
    `);

    ocorrenciasEscolaresTableEnsured = true;
}

async function ensureTransferenciasExternasTable() {
    if (transferenciasExternasTableEnsured) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS alunos_transferencias_externas (
            id SERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            aluno_id INTEGER NOT NULL,
            escola_origem_id INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
            escola_destino_nome TEXT NOT NULL,
            rede_destino TEXT NULL,
            municipio_destino TEXT NULL,
            uf_destino TEXT NULL,
            ano_letivo INTEGER NULL,
            turma_origem TEXT NULL,
            status TEXT NOT NULL DEFAULT 'SOLICITADA',
            motivo TEXT NULL,
            observacoes TEXT NULL,
            protocolo TEXT NULL,
            codigo_validacao TEXT NULL,
            responsavel_nome TEXT NULL,
            responsavel_documento TEXT NULL,
            responsavel_parentesco TEXT NULL,
            responsavel_telefone TEXT NULL,
            responsavel_email TEXT NULL,
            autorizacao_assinada BOOLEAN NOT NULL DEFAULT FALSE,
            documento_recebido BOOLEAN NOT NULL DEFAULT FALSE,
            solicitado_por_usuario_id BIGINT NULL,
            concluido_por_usuario_id BIGINT NULL,
            autorizado_em TIMESTAMP WITHOUT TIME ZONE NULL,
            concluido_em TIMESTAMP WITHOUT TIME ZONE NULL,
            criado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE INDEX IF NOT EXISTS idx_alunos_transferencias_externas_aluno
        ON alunos_transferencias_externas (aluno_id, criado_em DESC)
    `);

    transferenciasExternasTableEnsured = true;
}

async function ensureAlunosEscolasWorkflowColumns() {
    if (alunosEscolasWorkflowEnsured) return;

    await pool.query(`
        ALTER TABLE alunos_escolas
        ADD COLUMN IF NOT EXISTS status_matricula TEXT NULL,
        ADD COLUMN IF NOT EXISTS transferencia_id INTEGER NULL,
        ADD COLUMN IF NOT EXISTS motivo_status TEXT NULL,
        ADD COLUMN IF NOT EXISTS data_entrada TIMESTAMP WITHOUT TIME ZONE NULL,
        ADD COLUMN IF NOT EXISTS data_saida TIMESTAMP WITHOUT TIME ZONE NULL
    `);

    await pool.query(`
        UPDATE alunos_escolas
           SET status_matricula = COALESCE(status_matricula, 'ATIVO'),
               data_entrada = COALESCE(data_entrada, atualizado_em, NOW())
         WHERE status_matricula IS NULL
            OR data_entrada IS NULL
    `);

    alunosEscolasWorkflowEnsured = true;
}

async function ensureAcademicMaturityTables() {
    if (academicMaturityTablesEnsured) return;

    await pool.query(`
        CREATE TABLE IF NOT EXISTS escola_diario_classe (
            id SERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            escola_id INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
            turma TEXT NOT NULL,
            ano_letivo INTEGER NOT NULL,
            data_aula DATE NOT NULL,
            periodo_letivo TEXT NULL,
            disciplina_id BIGINT NULL,
            disciplina_nome TEXT NOT NULL,
            professor_nome TEXT NULL,
            conteudo TEXT NULL,
            metodologia TEXT NULL,
            atividade_prevista TEXT NULL,
            observacoes TEXT NULL,
            total_previsto INTEGER NOT NULL DEFAULT 0,
            presentes INTEGER NOT NULL DEFAULT 0,
            ausentes INTEGER NOT NULL DEFAULT 0,
            justificados INTEGER NOT NULL DEFAULT 0,
            status TEXT NOT NULL DEFAULT 'LANÇADO',
            criado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS escola_avaliacoes_componentes (
            id SERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            escola_id INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
            aluno_id INTEGER NOT NULL,
            turma TEXT NULL,
            ano_letivo INTEGER NOT NULL,
            periodo_letivo TEXT NOT NULL,
            disciplina_id BIGINT NULL,
            disciplina_nome TEXT NOT NULL,
            tipo_avaliacao TEXT NOT NULL DEFAULT 'REGULAR',
            nota NUMERIC(5,2) NULL,
            frequencia NUMERIC(5,2) NULL,
            faltas INTEGER NOT NULL DEFAULT 0,
            recuperacao BOOLEAN NOT NULL DEFAULT FALSE,
            parecer_descritivo TEXT NULL,
            status TEXT NOT NULL DEFAULT 'LANÇADO',
            criado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS escola_conselho_classe (
            id SERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            escola_id INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
            turma TEXT NOT NULL,
            ano_letivo INTEGER NOT NULL,
            periodo_letivo TEXT NOT NULL,
            data_reuniao DATE NULL,
            status TEXT NOT NULL DEFAULT 'PLANEJADO',
            coordenador_nome TEXT NULL,
            pauta TEXT NULL,
            deliberacoes TEXT NULL,
            encaminhamentos TEXT NULL,
            alunos_em_atencao JSONB NULL,
            participantes JSONB NULL,
            criado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`
        CREATE TABLE IF NOT EXISTS escola_fechamentos_periodo (
            id SERIAL PRIMARY KEY,
            tenant_id BIGINT NULL,
            escola_id INTEGER NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,
            turma TEXT NULL,
            ano_letivo INTEGER NOT NULL,
            periodo_letivo TEXT NOT NULL,
            data_inicio DATE NULL,
            data_fechamento DATE NULL,
            status TEXT NOT NULL DEFAULT 'ABERTO',
            frequencia_minima NUMERIC(5,2) NULL,
            nota_minima NUMERIC(5,2) NULL,
            total_alunos INTEGER NOT NULL DEFAULT 0,
            total_aprovados INTEGER NOT NULL DEFAULT 0,
            total_reprovados INTEGER NOT NULL DEFAULT 0,
            total_transferidos INTEGER NOT NULL DEFAULT 0,
            total_abandono INTEGER NOT NULL DEFAULT 0,
            observacoes TEXT NULL,
            criado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW(),
            atualizado_em TIMESTAMP WITHOUT TIME ZONE NOT NULL DEFAULT NOW()
        )
    `);

    await pool.query(`CREATE INDEX IF NOT EXISTS idx_escola_diario_classe_escola ON escola_diario_classe (escola_id, ano_letivo, turma, data_aula DESC)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_escola_avaliacoes_componentes_escola ON escola_avaliacoes_componentes (escola_id, ano_letivo, turma, aluno_id)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_escola_conselho_classe_escola ON escola_conselho_classe (escola_id, ano_letivo, turma, periodo_letivo)`);
    await pool.query(`CREATE INDEX IF NOT EXISTS idx_escola_fechamentos_periodo_escola ON escola_fechamentos_periodo (escola_id, ano_letivo, periodo_letivo, turma)`);

    academicMaturityTablesEnsured = true;
}

function randomCode(prefix, length = 6) {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let output = prefix ? String(prefix).toUpperCase() + '-' : '';
    for (let i = 0; i < length; i += 1) {
        output += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return output;
}

function academicLabel(value, fallback = 'Não informado') {
    return parseOptionalText(value) || fallback;
}

function parseOptionalJsonArray(value) {
    if (Array.isArray(value)) return value;
    if (value === undefined || value === null || value === '') return null;
    try {
        const parsed = typeof value === 'string' ? JSON.parse(value) : value;
        return Array.isArray(parsed) ? parsed : null;
    } catch (_) {
        return null;
    }
}

function formatDecimal(value, fallback = 'N/I') {
    if (value === undefined || value === null || value === '') return fallback;
    const num = Number(value);
    return Number.isFinite(num) ? num.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : fallback;
}

async function loadDisciplinasContexto(tenantId) {
    await ensureAcademicMaturityTables();
    try {
        const result = await pool.query(
            `
            SELECT id, codigo, nome, area_conhecimento, usa_nota, carga_horaria_padrao
            FROM institucional_disciplinas
            WHERE tenant_id = $1
              AND COALESCE(ativo, TRUE) = TRUE
            ORDER BY COALESCE(ordem_curricular, 9999), nome ASC
            `,
            [tenantId]
        );
        return result.rows || [];
    } catch (_) {
        return [];
    }
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

function normalizeCpf(value) {
    if (value === undefined || value === null) return null;
    const digits = String(value).replace(/\D/g, "");
    return digits.length === 11 ? digits : null;
}

function maskCpf(value) {
    const digits = normalizeCpf(value);
    if (!digits) return "N/I";
    return `***.***.***-${digits.slice(-2)}`;
}

function formatEnderecoAluno(aluno) {
    return [
        aluno?.rua,
        aluno?.numero_pessoa_endereco,
        aluno?.bairro,
        aluno?.cep,
    ].filter(Boolean).join(", ") || "Não informado";
}

function sortAnosDesc(values) {
    return Array.from(new Set((values || [])
        .map((value) => parseOptionalInt(value))
        .filter((value) => value !== null)))
        .sort((a, b) => b - a);
}

async function registrarHistoricoMatricula(client, tenantId, payload = {}) {
    await ensureMatriculasHistoricoTable();
    await client.query(
        `
        INSERT INTO alunos_escolas_historico (
            tenant_id, aluno_id, escola_id, escola_destino_id, ano_letivo,
            turma, turma_destino, tipo_evento, status_aluno, detalhes
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
        `,
        [
            tenantId || null,
            payload.aluno_id || null,
            payload.escola_id || null,
            payload.escola_destino_id || null,
            parseOptionalInt(payload.ano_letivo),
            parseOptionalText(payload.turma),
            parseOptionalText(payload.turma_destino),
            parseOptionalText(payload.tipo_evento) || 'MATRICULA',
            parseOptionalText(payload.status_aluno),
            JSON.stringify(payload.detalhes || {}),
        ],
    );
}

function getActorFromRequest(req) {
    return {
        id: req?.user?.id ? Number(req.user.id) : null,
        nome: parseOptionalText(req?.user?.nome),
        email: parseOptionalText(req?.user?.email),
        cargo: parseOptionalText(req?.user?.cargo),
    };
}

async function registrarAuditoriaEscolar(client, req, payload = {}) {
    await ensureAuditoriaEscolarTable();
    const actor = getActorFromRequest(req);
    await client.query(
        `
        INSERT INTO auditoria_operacoes_escolares (
            tenant_id, usuario_id, usuario_nome, usuario_email,
            modulo, entidade, entidade_id, acao, origem, detalhes
        )
        VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
        `,
        [
            payload.tenant_id || getTenantId(req) || null,
            actor.id,
            actor.nome,
            actor.email,
            parseOptionalText(payload.modulo) || 'escolar',
            parseOptionalText(payload.entidade) || 'aluno',
            payload.entidade_id == null ? null : String(payload.entidade_id),
            parseOptionalText(payload.acao) || 'OPERACAO',
            parseOptionalText(payload.origem) || 'web',
            JSON.stringify({
                actor,
                ...((payload && payload.detalhes) || {}),
            }),
        ],
    );
}

async function registrarSegurancaEscolar(req, payload = {}) {
    try {
        await recordSecurityLog({
            tenantId: payload.tenantId || getTenantId(req) || null,
            userId: req?.user?.id || null,
            email: req?.user?.email || null,
            action: payload.action || 'SCHOOL_OPERATION',
            targetType: payload.targetType || 'escolar',
            targetId: payload.targetId || null,
            description: payload.description || null,
            level: payload.level || 'warn',
            scope: payload.scope || 'Escola',
            ip: req.ip,
            userAgent: req.headers['user-agent'] || null,
            metadata: payload.metadata || {},
        });
    } catch (error) {
        console.error('Falha ao registrar log de segurança escolar:', error);
    }
}

async function loadEscolaById(client, escolaId, tenantId) {
    const tenantSupport = await getTenantColumnSupport();
    const params = [escolaId];
    let tenantWhere = '';
    if (tenantSupport.escolas && tenantId) {
        params.push(tenantId);
        tenantWhere = `AND tenant_id = $2`;
    }
    const result = await client.query(
        `
        SELECT id, nome, codigo_inep, logradouro, numero, complemento, referencia, bairro, cep
        FROM escolas
        WHERE id = $1
        ${tenantWhere}
        LIMIT 1
        `,
        params,
    );
    return result.rows[0] || null;
}

function formatProtocoloTransferencia(transferId, anoLetivo) {
    const ano = parseOptionalInt(anoLetivo) || new Date().getFullYear();
    return `TRI-${ano}-${String(transferId).padStart(6, '0')}`;
}

function generateTransferValidationCode() {
    return String(Math.floor(100000 + Math.random() * 900000));
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
    await ensureAlunosEscolasWorkflowColumns();
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
          AND COALESCE(ae.status_matricula, 'ATIVO') = 'ATIVO'
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
          AND COALESCE(ae.status_matricula, 'ATIVO') = 'ATIVO'
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
          AND COALESCE(ae.status_matricula, 'ATIVO') = 'ATIVO'
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
        anos_disponiveis: sortAnosDesc([
            ...(turmasResult.rows || []).map((item) => item.ano_letivo),
            ...(alunosResult.rows || []).map((item) => item.ano_letivo),
        ]),
        filtro_ano_letivo: anoLetivoFiltro,
    };
}

async function loadEscolaTurmasData(escolaId, tenantId, options = {}) {
    await ensureEscolaTurmasTable();

    const anoLetivoFiltro = parseOptionalInt(options.anoLetivo);
    const dashboardData = await loadEscolaDashboardData(escolaId, tenantId, { limitAlunos: 10, anoLetivo: anoLetivoFiltro });
    if (!dashboardData) return null;

    const params = [escolaId];
    const tenantClause = tenantId ? `AND (t.tenant_id = $2 OR t.tenant_id IS NULL)` : '';
    if (tenantId) params.push(tenantId);
    let anoClause = '';
    if (anoLetivoFiltro !== null) {
        params.push(anoLetivoFiltro);
        anoClause = `AND t.ano_letivo = $${params.length}`;
    }

        const turmasCadastradasSql = `
        SELECT
            t.id,
            t.nome,
            t.codigo_turma,
            t.ano_letivo,
            t.turno,
            t.tipo_turma,
            t.organizacao_pedagogica,
            t.etapa,
            t.modalidade,
            t.regime_letivo,
            t.multisseriada,
            t.series_abrangidas,
            t.dias_semana,
            t.horario_inicio,
            t.horario_fim,
            t.capacidade,
            t.limite_planejado_alunos,
            t.vagas_transporte_planejadas,
            t.vagas_inclusao_planejadas,
            t.total_estudantes_publico_ee,
            t.limite_estudantes_publico_ee,
            t.professor_referencia,
            t.monitor_referencia,
            t.auxiliar_apoio,
            t.interprete_libras,
            t.atendimento_educacional_especializado,
            t.sala,
            t.sala_acessivel,
            t.observacoes,
            t.ativo,
            t.criado_em,
            t.atualizado_em
        FROM escola_turmas t
        WHERE t.escola_id = $1
        ${tenantClause}
        ${anoClause}
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
            codigo_turma: turma.codigo_turma,
            ano_letivo: turma.ano_letivo,
            turno: turma.turno,
            tipo_turma: turma.tipo_turma,
            organizacao_pedagogica: turma.organizacao_pedagogica,
            etapa: turma.etapa,
            modalidade: turma.modalidade,
            regime_letivo: turma.regime_letivo,
            multisseriada: turma.multisseriada,
            series_abrangidas: turma.series_abrangidas,
            dias_semana: turma.dias_semana,
            horario_inicio: turma.horario_inicio,
            horario_fim: turma.horario_fim,
            capacidade: turma.capacidade,
            limite_planejado_alunos: turma.limite_planejado_alunos,
            vagas_transporte_planejadas: turma.vagas_transporte_planejadas,
            vagas_inclusao_planejadas: turma.vagas_inclusao_planejadas,
            total_estudantes_publico_ee: turma.total_estudantes_publico_ee,
            limite_estudantes_publico_ee: turma.limite_estudantes_publico_ee,
            professor_referencia: turma.professor_referencia,
            monitor_referencia: turma.monitor_referencia,
            auxiliar_apoio: turma.auxiliar_apoio,
            interprete_libras: turma.interprete_libras,
            atendimento_educacional_especializado: turma.atendimento_educacional_especializado,
            sala: turma.sala,
            sala_acessivel: turma.sala_acessivel,
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
                codigo_turma: null,
                ano_letivo: turma.ano_letivo,
                turno: null,
                tipo_turma: null,
                organizacao_pedagogica: null,
                etapa: null,
                modalidade: null,
                regime_letivo: null,
                multisseriada: false,
                series_abrangidas: null,
                dias_semana: null,
                horario_inicio: null,
                horario_fim: null,
                capacidade: null,
                limite_planejado_alunos: null,
                vagas_transporte_planejadas: null,
                vagas_inclusao_planejadas: null,
                total_estudantes_publico_ee: null,
                limite_estudantes_publico_ee: null,
                professor_referencia: null,
                monitor_referencia: null,
                auxiliar_apoio: false,
                interprete_libras: false,
                atendimento_educacional_especializado: false,
                sala: null,
                sala_acessivel: false,
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

    turmas.forEach((turma) => {
        const referenciaCapacidade = Number.isFinite(Number(turma.capacidade)) && Number(turma.capacidade) > 0
            ? Number(turma.capacidade)
            : (Number.isFinite(Number(turma.limite_planejado_alunos)) && Number(turma.limite_planejado_alunos) > 0 ? Number(turma.limite_planejado_alunos) : null);
        const totalAlunos = Number(turma.total_alunos || 0);
        const vagasLivres = referenciaCapacidade != null ? Math.max(referenciaCapacidade - totalAlunos, 0) : null;
        const percentualOcupacao = referenciaCapacidade != null && referenciaCapacidade > 0
            ? Math.min(Math.round((totalAlunos / referenciaCapacidade) * 100), 999)
            : null;
        turma.capacidade_referencia = referenciaCapacidade;
        turma.vagas_livres = vagasLivres;
        turma.percentual_ocupacao = percentualOcupacao;
        turma.ocupacao_status = percentualOcupacao == null
            ? 'sem_referencia'
            : percentualOcupacao >= 100
                ? 'lotada'
                : percentualOcupacao >= 85
                    ? 'atencao'
                    : 'saudavel';
    });

    return {
        escola: dashboardData.escola,
        resumo: {
            ...dashboardData.resumo,
            total_turmas: turmas.length,
            total_anos_letivos: countDistinctAnosLetivos(turmas),
            total_vagas_livres: turmas.reduce((acc, turma) => acc + Number(turma.vagas_livres || 0), 0),
            ocupacao_media: turmas.filter((turma) => turma.percentual_ocupacao != null).length
                ? Math.round(turmas.filter((turma) => turma.percentual_ocupacao != null).reduce((acc, turma) => acc + Number(turma.percentual_ocupacao || 0), 0) / turmas.filter((turma) => turma.percentual_ocupacao != null).length)
                : null,
        },
        turmas,
        anos_disponiveis: sortAnosDesc([
            ...(dashboardData.anos_disponiveis || []),
            ...(turmasCadastradasResult.rows || []).map((item) => item.ano_letivo),
        ]),
        filtro_ano_letivo: anoLetivoFiltro,
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

async function loadAcademicOverview(escolaId, tenantId, anoLetivo = null) {
    await ensureOcorrenciasEscolaresTable();
    await ensureTransferenciasInternasTable();
    await ensureTransferenciasExternasTable();
    await ensureAlunosEscolasWorkflowColumns();
    await ensureAcademicMaturityTables();
    const tenantSupport = await getTenantColumnSupport();

    const useAlunosEscolasTenant = !!(tenantSupport.alunos_escolas && tenantId);
    const escolaBaseParams = [];
    let escolaWhere = '';
    if (useAlunosEscolasTenant) {
        escolaBaseParams.push(tenantId);
        escolaWhere += `ae.tenant_id = $${escolaBaseParams.length} AND `;
    }
    escolaBaseParams.push(escolaId);
    escolaWhere += `ae.escola_id = $${escolaBaseParams.length}`;
    const yearFilterSql = anoLetivo ? ` AND ae.ano_letivo = $${escolaBaseParams.length + 1}` : '';
    const yearParams = anoLetivo ? [...escolaBaseParams, anoLetivo] : [...escolaBaseParams];
    const tenantYearParams = anoLetivo ? [tenantId ?? null, escolaId, anoLetivo] : [tenantId ?? null, escolaId];
    const currentYear = Number(anoLetivo || new Date().getFullYear());
    const nextYear = currentYear + 1;
    const rematriculasBaseParams = [...escolaBaseParams, currentYear, nextYear];
    const currentYearParamIndex = escolaBaseParams.length + 1;
    const nextYearParamIndex = escolaBaseParams.length + 2;
    const proxTenantClause = useAlunosEscolasTenant ? `AND prox.tenant_id = ae.tenant_id` : '';

    const tenantBaseParams = [tenantId ?? null, escolaId];
    const tenantYearBaseParams = anoLetivo ? [tenantId ?? null, escolaId, anoLetivo] : [tenantId ?? null, escolaId];
    const [matriculas, ocorrencias, internas, externas, rematriculas, diario, avaliacoes, conselho, fechamentos] = await Promise.all([
        pool.query(
            `
            SELECT
                COUNT(*) FILTER (WHERE COALESCE(ae.status_matricula, 'ATIVO') = 'ATIVO')::int AS ativas,
                COUNT(*) FILTER (WHERE COALESCE(ae.status_matricula, 'ATIVO') <> 'ATIVO')::int AS inativas,
                COUNT(DISTINCT ae.turma)::int AS turmas
            FROM alunos_escolas ae
            WHERE ${escolaWhere}
              ${yearFilterSql}
            `,
            yearParams
        ),
        pool.query(
            `
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status IN ('ABERTA','EM_ANDAMENTO'))::int AS abertas,
                COUNT(*) FILTER (WHERE gravidade = 'ALTA')::int AS altas
            FROM aluno_ocorrencias_escolares
            WHERE tenant_id = $1
              AND escola_id = $2
              ${anoLetivo ? 'AND ano_letivo = $3' : ''}
            `,
            tenantYearParams
        ),
        pool.query(
            `
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status <> 'CONCLUIDA')::int AS pendentes
            FROM alunos_transferencias_internas
            WHERE tenant_id = $1
              AND (escola_origem_id = $2 OR escola_destino_id = $2)
              ${anoLetivo ? 'AND ano_letivo = $3' : ''}
            `,
            tenantYearParams
        ),
        pool.query(
            `
            SELECT
                COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE status <> 'CONCLUIDA')::int AS pendentes
            FROM alunos_transferencias_externas
            WHERE tenant_id = $1
              AND escola_origem_id = $2
              ${anoLetivo ? 'AND ano_letivo = $3' : ''}
            `,
            tenantYearParams
        ),
        pool.query(
            `
            SELECT COUNT(*)::int AS previstas
            FROM alunos_escolas ae
            WHERE ${escolaWhere}
              AND ae.ano_letivo = $${currentYearParamIndex}
              AND COALESCE(ae.status_matricula, 'ATIVO') = 'ATIVO'
              AND EXISTS (
                    SELECT 1
                    FROM alunos_escolas prox
                    WHERE prox.aluno_id = ae.aluno_id
                      AND prox.escola_id = ae.escola_id
                      ${proxTenantClause}
                      AND prox.ano_letivo = $${nextYearParamIndex}
              ) = FALSE
            `,
            rematriculasBaseParams
        ),
        pool.query(
            `
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE status = 'FECHADO')::int AS fechados
            FROM escola_diario_classe
            WHERE tenant_id = $1
              AND escola_id = $2
              ${anoLetivo ? 'AND ano_letivo = $3' : ''}
            `,
            tenantYearBaseParams
        ),
        pool.query(
            `
            SELECT COUNT(*)::int AS lancamentos,
                   ROUND(AVG(nota)::numeric, 2) AS media_geral,
                   ROUND(AVG(frequencia)::numeric, 2) AS frequencia_media
            FROM escola_avaliacoes_componentes
            WHERE tenant_id = $1
              AND escola_id = $2
              ${anoLetivo ? 'AND ano_letivo = $3' : ''}
            `,
            tenantYearBaseParams
        ),
        pool.query(
            `
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE status IN ('REALIZADO','FECHADO'))::int AS concluidos
            FROM escola_conselho_classe
            WHERE tenant_id = $1
              AND escola_id = $2
              ${anoLetivo ? 'AND ano_letivo = $3' : ''}
            `,
            tenantYearBaseParams
        ),
        pool.query(
            `
            SELECT COUNT(*)::int AS total,
                   COUNT(*) FILTER (WHERE status = 'FECHADO')::int AS fechados
            FROM escola_fechamentos_periodo
            WHERE tenant_id = $1
              AND escola_id = $2
              ${anoLetivo ? 'AND ano_letivo = $3' : ''}
            `,
            tenantYearBaseParams
        ),
    ]);

    return {
        matriculas: matriculas.rows[0] || { ativas: 0, inativas: 0, turmas: 0 },
        ocorrencias: ocorrencias.rows[0] || { total: 0, abertas: 0, altas: 0 },
        transferencias_internas: internas.rows[0] || { total: 0, pendentes: 0 },
        transferencias_externas: externas.rows[0] || { total: 0, pendentes: 0 },
        diario_classe: diario.rows[0] || { total: 0, fechados: 0 },
        avaliacoes: avaliacoes.rows[0] || { lancamentos: 0, media_geral: null, frequencia_media: null },
        conselho_classe: conselho.rows[0] || { total: 0, concluidos: 0 },
        fechamentos: fechamentos.rows[0] || { total: 0, fechados: 0 },
        rematriculas: {
            ano_atual: currentYear,
            ano_destino: nextYear,
            previstas: rematriculas.rows[0]?.previstas || 0,
        },
    };
}

async function loadHistoricoEscolarData({ escolaId, alunoId, tenantId }) {
    await ensureMatriculasHistoricoTable();
    await ensureOcorrenciasEscolaresTable();
    await ensureTransferenciasInternasTable();
    await ensureTransferenciasExternasTable();
    await ensureAlunosEscolasWorkflowColumns();
    await ensureAcademicMaturityTables();
    const tenantSupport = await getTenantColumnSupport();
    const useAlunosEscolasTenant = !!(tenantSupport.alunos_escolas && tenantId);

    const aluno = await loadAlunoMatriculaDetalhes({ escolaId, alunoId, tenantId });
    if (!aluno) return null;

    const vinculosParams = [alunoId];
    let vinculosTenantWhere = '';
    if (useAlunosEscolasTenant) {
        vinculosParams.push(tenantId);
        vinculosTenantWhere = 'AND ae.tenant_id = $2';
    }

    const [vinculosResult, historicoResult, ocorrenciasResult, transferenciasInternasResult, transferenciasExternasResult, notasResult] = await Promise.all([
        pool.query(
            `
            SELECT ae.*,
                   e.nome AS escola_nome
            FROM alunos_escolas ae
            LEFT JOIN escolas e ON e.id = ae.escola_id
            WHERE ae.aluno_id = $1
              ${vinculosTenantWhere}
            ORDER BY ae.ano_letivo DESC NULLS LAST, ae.data_entrada DESC NULLS LAST, ae.id DESC
            `,
            vinculosParams
        ),
        pool.query(
            `
            SELECT h.*,
                   eo.nome AS escola_nome,
                   ed.nome AS escola_destino_nome
            FROM alunos_escolas_historico h
            LEFT JOIN escolas eo ON eo.id = h.escola_id
            LEFT JOIN escolas ed ON ed.id = h.escola_destino_id
            WHERE h.aluno_id = $1
              AND h.tenant_id = $2
            ORDER BY h.criado_em DESC, h.id DESC
            `,
            [alunoId, tenantId]
        ),
        pool.query(
            `
            SELECT id, categoria, subcategoria, gravidade, status, titulo, data_ocorrencia, data_fechamento
            FROM aluno_ocorrencias_escolares
            WHERE aluno_id = $1
              AND tenant_id = $2
            ORDER BY data_ocorrencia DESC, id DESC
            `,
            [alunoId, tenantId]
        ),
        pool.query(
            `
            SELECT id, escola_origem_id, escola_destino_id, ano_letivo, turma_origem, turma_destino, status, protocolo, criado_em, concluido_em
            FROM alunos_transferencias_internas
            WHERE aluno_id = $1
              AND tenant_id = $2
            ORDER BY criado_em DESC, id DESC
            `,
            [alunoId, tenantId]
        ),
        pool.query(
            `
            SELECT id, escola_origem_id, escola_destino_nome, rede_destino, municipio_destino, uf_destino, ano_letivo, turma_origem, status, protocolo, criado_em, concluido_em
            FROM alunos_transferencias_externas
            WHERE aluno_id = $1
              AND tenant_id = $2
            ORDER BY criado_em DESC, id DESC
            `,
            [alunoId, tenantId]
        ),
        pool.query(
            `
            SELECT periodo_letivo, disciplina_id, disciplina_nome, tipo_avaliacao, nota, frequencia, faltas, recuperacao, parecer_descritivo, status, ano_letivo, criado_em
            FROM escola_avaliacoes_componentes
            WHERE tenant_id = $1
              AND escola_id = $2
              AND aluno_id = $3
            ORDER BY ano_letivo DESC, periodo_letivo ASC, disciplina_nome ASC, criado_em DESC
            `,
            [tenantId, escolaId, alunoId]
        ),
    ]);

    const vinculos = vinculosResult.rows || [];
    const historico = historicoResult.rows || [];
    const ocorrencias = ocorrenciasResult.rows || [];
    const transferenciasInternas = transferenciasInternasResult.rows || [];
    const transferenciasExternas = transferenciasExternasResult.rows || [];
    const notas = notasResult.rows || [];
    const rendimentoPorDisciplina = Object.values(notas.reduce((acc, item) => {
        const key = [item.ano_letivo, item.periodo_letivo, item.disciplina_nome].join('|');
        if (!acc[key]) {
            acc[key] = {
                ano_letivo: item.ano_letivo,
                periodo_letivo: item.periodo_letivo,
                disciplina_nome: item.disciplina_nome,
                media: [],
                frequencia: [],
                faltas: 0,
                pareceres: [],
                recuperacao: false,
                status: item.status,
            };
        }
        if (item.nota !== null && item.nota !== undefined) acc[key].media.push(Number(item.nota));
        if (item.frequencia !== null && item.frequencia !== undefined) acc[key].frequencia.push(Number(item.frequencia));
        acc[key].faltas += Number(item.faltas || 0);
        if (item.parecer_descritivo) acc[key].pareceres.push(item.parecer_descritivo);
        if (item.recuperacao) acc[key].recuperacao = true;
        return acc;
    }, {})).map((item) => ({
        ano_letivo: item.ano_letivo,
        periodo_letivo: item.periodo_letivo,
        disciplina_nome: item.disciplina_nome,
        media: item.media.length ? Number((item.media.reduce((a, b) => a + b, 0) / item.media.length).toFixed(2)) : null,
        frequencia: item.frequencia.length ? Number((item.frequencia.reduce((a, b) => a + b, 0) / item.frequencia.length).toFixed(2)) : null,
        faltas: item.faltas,
        pareceres: item.pareceres,
        recuperacao: item.recuperacao,
        status: item.status,
    }));

    const linhaDoTempo = [
        ...historico.map((item) => ({
            tipo: item.tipo_evento,
            titulo: item.tipo_evento,
            descricao: [item.escola_nome, item.escola_destino_nome, item.turma, item.turma_destino].filter(Boolean).join(' • '),
            ano_letivo: item.ano_letivo,
            criado_em: item.criado_em,
            origem: 'historico',
        })),
        ...ocorrencias.map((item) => ({
            tipo: 'OCORRENCIA',
            titulo: item.titulo,
            descricao: [item.categoria, item.subcategoria, item.gravidade, item.status].filter(Boolean).join(' • '),
            ano_letivo: null,
            criado_em: item.data_ocorrencia,
            origem: 'ocorrencia',
        })),
        ...transferenciasInternas.map((item) => ({
            tipo: 'TRANSFERENCIA_INTERNA',
            titulo: 'Transferência interna',
            descricao: [item.turma_origem, item.turma_destino, item.status, item.protocolo].filter(Boolean).join(' • '),
            ano_letivo: item.ano_letivo,
            criado_em: item.criado_em,
            origem: 'transferencia_interna',
        })),
        ...transferenciasExternas.map((item) => ({
            tipo: 'TRANSFERENCIA_EXTERNA',
            titulo: 'Transferência externa',
            descricao: [item.escola_destino_nome, item.rede_destino, item.municipio_destino, item.uf_destino, item.status].filter(Boolean).join(' • '),
            ano_letivo: item.ano_letivo,
            criado_em: item.criado_em,
            origem: 'transferencia_externa',
        })),
    ].sort((a, b) => new Date(b.criado_em || 0).valueOf() - new Date(a.criado_em || 0).valueOf());

    const resumoAcademico = {
        total_vinculos: vinculos.length,
        anos_letivos: sortAnosDesc(vinculos.map((item) => item.ano_letivo)),
        ocorrencias_abertas: ocorrencias.filter((item) => ['ABERTA', 'EM_ANDAMENTO'].includes(String(item.status || '').toUpperCase())).length,
        transferencias_pendentes: transferenciasInternas.filter((item) => item.status !== 'CONCLUIDA').length + transferenciasExternas.filter((item) => item.status !== 'CONCLUIDA').length,
        componentes_lancados: rendimentoPorDisciplina.length,
    };

    return {
        aluno,
        resumo: resumoAcademico,
        vinculos,
        historico,
        ocorrencias,
        transferencias_internas: transferenciasInternas,
        transferencias_externas: transferenciasExternas,
        rendimento_disciplinas: rendimentoPorDisciplina,
        linha_do_tempo: linhaDoTempo,
    };
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
        const anoLetivoFiltro = parseOptionalInt(req.query?.ano_letivo);
        const [dashboardData, turmasData] = await Promise.all([
            loadEscolaDashboardData(id, tenantId, { limitAlunos: 500, anoLetivo: anoLetivoFiltro }),
            loadEscolaTurmasData(id, tenantId, { anoLetivo: anoLetivoFiltro }),
        ]);

        if (!dashboardData || !turmasData) {
            return res.status(404).json({ error: "Escola não encontrada" });
        }

        const includeSensitive = String(req.query.include_sensitive || "") === "1";
        const alunos = (Array.isArray(dashboardData.alunos) ? dashboardData.alunos : []).map((aluno) => {
            const payload = { ...aluno, cpf_masked: maskCpf(aluno?.cpf) };
            if (!includeSensitive) delete payload.cpf;
            return payload;
        });
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

        const institutionalPermissions = Array.isArray(req.user?.permissions) ? req.user.permissions : [];
        const institutionalData = await loadEscolaInstitutionalData({
            escolaId: id,
            tenantId,
            escolaNome: dashboardData.escola?.nome,
        });
        const canManageInstitutional = institutionalPermissions.includes('institution.master.manage');
        const canViewInstitutional = institutionalPermissions.includes('institution.master.view')
            || institutionalPermissions.includes('school.dashboard.view')
            || canManageInstitutional;

        if (institutionalData?.parametros?.turno_padrao) {
            const turnoPadrao = String(institutionalData.parametros.turno_padrao || '').trim().toLowerCase();
            const turmasForaPadrao = turmas.filter((turma) => {
                const turno = String(turma?.turno || '').trim().toLowerCase();
                return turno && turnoPadrao && turno !== turnoPadrao;
            }).length;
            if (turmasForaPadrao) {
                institutionalData.alertas.push({
                    tipo: 'info',
                    titulo: 'Turnos fora do padrão institucional',
                    detalhe: `${turmasForaPadrao} turma(s) operam com turno diferente do padrão definido pela rede.`,
                });
            }
        }

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

        const institutionPayload = canViewInstitutional ? {
            ...institutionalData,
            can_view: true,
            can_manage: canManageInstitutional,
        } : {
            can_view: false,
            can_manage: false,
            calendario: null,
            periodos: [],
            equipe: { total: 0, principais: [], funcoes: [] },
            parametros: null,
            alertas: [],
        };

        return res.json({
            escola: dashboardData.escola,
            resumo: {
                ...dashboardData.resumo,
                ...turmasData.resumo,
            },
            turmas: turmasData.turmas,
            alunos,
            alunos_recentes: alunosRecentes,
            anos_disponiveis: sortAnosDesc([
                ...(dashboardData.anos_disponiveis || []),
                ...(turmasData.anos_disponiveis || []),
            ]),
            filtros: {
                ano_letivo: anoLetivoFiltro,
            },
            indicadores: {
                pendencias_secretaria: pendenciasSecretaria,
                metricas_pedagogicas: metricasPedagogicas,
                distribuicoes,
                alertas,
            },
            institucional: institutionPayload,
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
        const data = await loadEscolaTurmasData(id, tenantId, { anoLetivo: req.query?.ano_letivo });
        if (!data) {
            return res.status(404).json({ error: "Escola não encontrada" });
        }

        return res.json({
            escola: data.escola,
            resumo: data.resumo,
            turmas: data.turmas,
            anos_disponiveis: data.anos_disponiveis || [],
            filtros: {
                ano_letivo: parseOptionalInt(req.query?.ano_letivo),
            },
        });
    } catch (err) {
        console.error("Erro ao carregar turmas da escola:", err);
        return res.status(500).json({ error: "Erro ao carregar turmas da escola" });
    }
});

router.post("/:id/turmas", requirePermission('school.students.manage'), async (req, res) => {
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
        const codigoTurma = parseOptionalText(req.body?.codigo_turma);
        const tipoTurma = parseOptionalText(req.body?.tipo_turma);
        const organizacaoPedagogica = parseOptionalText(req.body?.organizacao_pedagogica);
        const etapa = parseOptionalText(req.body?.etapa);
        const modalidade = parseOptionalText(req.body?.modalidade);
        const regimeLetivo = parseOptionalText(req.body?.regime_letivo);
        const multisseriada = Boolean(req.body?.multisseriada);
        const seriesAbrangidas = parseOptionalTextArray(req.body?.series_abrangidas);
        const diasSemana = parseOptionalTextArray(req.body?.dias_semana);
        const horarioInicio = parseOptionalText(req.body?.horario_inicio);
        const horarioFim = parseOptionalText(req.body?.horario_fim);
        const capacidade = parseOptionalInt(req.body?.capacidade);
        const limitePlanejadoAlunos = parseOptionalInt(req.body?.limite_planejado_alunos);
        const vagasTransportePlanejadas = parseOptionalInt(req.body?.vagas_transporte_planejadas);
        const vagasInclusaoPlanejadas = parseOptionalInt(req.body?.vagas_inclusao_planejadas);
        const totalEstudantesPublicoEe = parseOptionalInt(req.body?.total_estudantes_publico_ee);
        const limiteEstudantesPublicoEe = parseOptionalInt(req.body?.limite_estudantes_publico_ee);
        const professorReferencia = parseOptionalText(req.body?.professor_referencia);
        const monitorReferencia = parseOptionalText(req.body?.monitor_referencia);
        const auxiliarApoio = Boolean(req.body?.auxiliar_apoio);
        const interpreteLibras = Boolean(req.body?.interprete_libras);
        const atendimentoEducacionalEspecializado = Boolean(req.body?.atendimento_educacional_especializado);
        const sala = parseOptionalText(req.body?.sala);
        const salaAcessivel = Boolean(req.body?.sala_acessivel);
        const observacoes = parseOptionalText(req.body?.observacoes);
        const ativo = req.body?.ativo === undefined ? true : Boolean(req.body.ativo);

        const result = await pool.query(
            `
            INSERT INTO escola_turmas (
                tenant_id, escola_id, nome, codigo_turma, ano_letivo, turno, tipo_turma, organizacao_pedagogica,
                etapa, modalidade, regime_letivo, multisseriada, series_abrangidas, dias_semana, horario_inicio, horario_fim,
                capacidade, limite_planejado_alunos, vagas_transporte_planejadas, vagas_inclusao_planejadas,
                total_estudantes_publico_ee, limite_estudantes_publico_ee,
                professor_referencia, monitor_referencia, auxiliar_apoio, interprete_libras, atendimento_educacional_especializado,
                sala, sala_acessivel, observacoes, ativo
            ) VALUES (
                $1, $2, $3, $4, $5, $6, $7, $8,
                $9, $10, $11, $12, $13, $14, $15, $16,
                $17, $18, $19, $20,
                $21, $22,
                $23, $24, $25, $26, $27,
                $28, $29, $30, $31
            )
            RETURNING *
            `,
            [
                tenantId, escolaId, nome, codigoTurma, anoLetivo, turno, tipoTurma, organizacaoPedagogica,
                etapa, modalidade, regimeLetivo, multisseriada, seriesAbrangidas, diasSemana, horarioInicio, horarioFim,
                capacidade, limitePlanejadoAlunos, vagasTransportePlanejadas, vagasInclusaoPlanejadas,
                totalEstudantesPublicoEe, limiteEstudantesPublicoEe,
                professorReferencia, monitorReferencia, auxiliarApoio, interpreteLibras, atendimentoEducacionalEspecializado,
                sala, salaAcessivel, observacoes, ativo
            ]
        );

        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_TURMA_CREATED',
            targetType: 'turma',
            targetId: result.rows[0]?.id,
            description: 'Turma cadastrada na escola.',
            metadata: { escola_id: escolaId, turma: nome, ano_letivo: anoLetivo }
        });
        return res.status(201).json({
            message: "Turma cadastrada com sucesso",
            turma: result.rows[0],
        });
    } catch (err) {
        console.error("Erro ao cadastrar turma da escola:", err);
        return res.status(500).json({ error: "Erro ao cadastrar turma da escola" });
    }
});

router.put("/:id/turmas/:turmaId", requirePermission('school.students.manage'), async (req, res) => {
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
        const codigoTurma = parseOptionalText(req.body?.codigo_turma);
        const tipoTurma = parseOptionalText(req.body?.tipo_turma);
        const organizacaoPedagogica = parseOptionalText(req.body?.organizacao_pedagogica);
        const etapa = parseOptionalText(req.body?.etapa);
        const modalidade = parseOptionalText(req.body?.modalidade);
        const regimeLetivo = parseOptionalText(req.body?.regime_letivo);
        const multisseriada = Boolean(req.body?.multisseriada);
        const seriesAbrangidas = parseOptionalTextArray(req.body?.series_abrangidas);
        const diasSemana = parseOptionalTextArray(req.body?.dias_semana);
        const horarioInicio = parseOptionalText(req.body?.horario_inicio);
        const horarioFim = parseOptionalText(req.body?.horario_fim);
        const capacidade = parseOptionalInt(req.body?.capacidade);
        const limitePlanejadoAlunos = parseOptionalInt(req.body?.limite_planejado_alunos);
        const vagasTransportePlanejadas = parseOptionalInt(req.body?.vagas_transporte_planejadas);
        const vagasInclusaoPlanejadas = parseOptionalInt(req.body?.vagas_inclusao_planejadas);
        const totalEstudantesPublicoEe = parseOptionalInt(req.body?.total_estudantes_publico_ee);
        const limiteEstudantesPublicoEe = parseOptionalInt(req.body?.limite_estudantes_publico_ee);
        const professorReferencia = parseOptionalText(req.body?.professor_referencia);
        const monitorReferencia = parseOptionalText(req.body?.monitor_referencia);
        const auxiliarApoio = Boolean(req.body?.auxiliar_apoio);
        const interpreteLibras = Boolean(req.body?.interprete_libras);
        const atendimentoEducacionalEspecializado = Boolean(req.body?.atendimento_educacional_especializado);
        const sala = parseOptionalText(req.body?.sala);
        const salaAcessivel = Boolean(req.body?.sala_acessivel);
        const observacoes = parseOptionalText(req.body?.observacoes);
        const ativo = req.body?.ativo === undefined ? true : Boolean(req.body.ativo);

        const params = [
            nome, codigoTurma, anoLetivo, turno, tipoTurma, organizacaoPedagogica,
            etapa, modalidade, regimeLetivo, multisseriada, seriesAbrangidas, diasSemana, horarioInicio, horarioFim,
            capacidade, limitePlanejadoAlunos, vagasTransportePlanejadas, vagasInclusaoPlanejadas,
            totalEstudantesPublicoEe, limiteEstudantesPublicoEe,
            professorReferencia, monitorReferencia, auxiliarApoio, interpreteLibras, atendimentoEducacionalEspecializado,
            sala, salaAcessivel, observacoes, ativo, turmaId, escolaId
        ];
        let tenantWhere = '';
        if (tenantId) {
            params.push(tenantId);
            tenantWhere = `AND (tenant_id = $32 OR tenant_id IS NULL)`;
        }

        const result = await pool.query(
            `
            UPDATE escola_turmas
            SET
                nome = $1,
                codigo_turma = $2,
                ano_letivo = $3,
                turno = $4,
                tipo_turma = $5,
                organizacao_pedagogica = $6,
                etapa = $7,
                modalidade = $8,
                regime_letivo = $9,
                multisseriada = $10,
                series_abrangidas = $11,
                dias_semana = $12,
                horario_inicio = $13,
                horario_fim = $14,
                capacidade = $15,
                limite_planejado_alunos = $16,
                vagas_transporte_planejadas = $17,
                vagas_inclusao_planejadas = $18,
                total_estudantes_publico_ee = $19,
                limite_estudantes_publico_ee = $20,
                professor_referencia = $21,
                monitor_referencia = $22,
                auxiliar_apoio = $23,
                interprete_libras = $24,
                atendimento_educacional_especializado = $25,
                sala = $26,
                sala_acessivel = $27,
                observacoes = $28,
                ativo = $29,
                atualizado_em = NOW()
            WHERE id = $30
              AND escola_id = $31
              ${tenantWhere}
            RETURNING *
            `,
            params
        );

        if (result.rowCount === 0) {
            return res.status(404).json({ error: "Turma não encontrada." });
        }

        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_TURMA_UPDATED',
            targetType: 'turma',
            targetId: turmaId,
            description: 'Turma atualizada.',
            metadata: { escola_id: escolaId, turma: nome, ano_letivo: anoLetivo }
        });
        return res.json({
            message: "Turma atualizada com sucesso",
            turma: result.rows[0],
        });
    } catch (err) {
        console.error("Erro ao atualizar turma da escola:", err);
        return res.status(500).json({ error: "Erro ao atualizar turma da escola" });
    }
});

router.delete("/:id/turmas/:turmaId", requirePermission('school.students.manage'), async (req, res) => {
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

        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_TURMA_DELETED',
            targetType: 'turma',
            targetId: turmaId,
            description: 'Turma excluída.',
            metadata: { escola_id: escolaId }
        });
        return res.json({ message: "Turma excluída com sucesso" });
    } catch (err) {
        console.error("Erro ao excluir turma da escola:", err);
        return res.status(500).json({ error: "Erro ao excluir turma da escola" });
    }
});

router.post("/:id/matriculas", requirePermission('school.students.manage'), async (req, res) => {
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
        await ensureMatriculasHistoricoTable();
        await ensureAlunosEscolasWorkflowColumns();

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

        const vinculosExistentesParams = [alunoId, anoLetivo];
        let vinculosExistentesSql = `
            SELECT id, escola_id, ano_letivo, turma, atualizado_em
            FROM alunos_escolas
            WHERE aluno_id = $1
              AND ano_letivo = $2
        `;
        if (tenantSupport.alunos_escolas && tenantId) {
            vinculosExistentesParams.push(tenantId);
            vinculosExistentesSql += ` AND tenant_id = $3`;
        }
        const vinculosExistentes = Number.isFinite(alunoId) && alunoId > 0
            ? (await client.query(vinculosExistentesSql, vinculosExistentesParams)).rows
            : [];

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
            const removidosMesmoAno = vinculosExistentes.filter((row) => Number(row.escola_id) !== escolaId);
            for (const vinculo of removidosMesmoAno) {
                await registrarHistoricoMatricula(client, tenantId, {
                    aluno_id: alunoId,
                    escola_id: vinculo.escola_id,
                    escola_destino_id: escolaId,
                    ano_letivo: anoLetivo,
                    turma: vinculo.turma,
                    turma_destino: turma,
                    tipo_evento: 'TRANSFERENCIA_SAIDA',
                    status_aluno: parseOptionalText(alunoPayload.status) || 'ativo',
                    detalhes: {
                        origem: 'matricula_escola',
                        atualizado_em_vinculo: vinculo.atualizado_em || null,
                    },
                });
            }
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
                INSERT INTO alunos_escolas (tenant_id, aluno_id, escola_id, ano_letivo, turma, status_matricula, transferencia_id, motivo_status, data_entrada, data_saida)
                VALUES ($1, $2, $3, $4, $5, 'ATIVO', NULL, NULL, NOW(), NULL)
                ON CONFLICT (aluno_id, escola_id, ano_letivo) DO UPDATE
                SET turma = EXCLUDED.turma,
                    status_matricula = 'ATIVO',
                    transferencia_id = NULL,
                    motivo_status = NULL,
                    data_saida = NULL,
                    atualizado_em = NOW()
                `,
                [tenantId, alunoId, escolaId, anoLetivo, turma]
            );
        } else {
            const removidosMesmoAno = vinculosExistentes.filter((row) => Number(row.escola_id) !== escolaId);
            for (const vinculo of removidosMesmoAno) {
                await registrarHistoricoMatricula(client, tenantId, {
                    aluno_id: alunoId,
                    escola_id: vinculo.escola_id,
                    escola_destino_id: escolaId,
                    ano_letivo: anoLetivo,
                    turma: vinculo.turma,
                    turma_destino: turma,
                    tipo_evento: 'TRANSFERENCIA_SAIDA',
                    status_aluno: parseOptionalText(alunoPayload.status) || 'ativo',
                    detalhes: {
                        origem: 'matricula_escola',
                        atualizado_em_vinculo: vinculo.atualizado_em || null,
                    },
                });
            }
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
                INSERT INTO alunos_escolas (aluno_id, escola_id, ano_letivo, turma, status_matricula, transferencia_id, motivo_status, data_entrada, data_saida)
                VALUES ($1, $2, $3, $4, 'ATIVO', NULL, NULL, NOW(), NULL)
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

        const vinculoMesmoAno = vinculosExistentes.find((row) => Number(row.escola_id) === escolaId) || null;
        const houveTransferencia = vinculosExistentes.some((row) => Number(row.escola_id) !== escolaId);
        await registrarHistoricoMatricula(client, tenantId, {
            aluno_id: alunoId,
            escola_id: vinculoMesmoAno ? escolaId : null,
            escola_destino_id: escolaId,
            ano_letivo: anoLetivo,
            turma: vinculoMesmoAno?.turma || null,
            turma_destino: turma,
            tipo_evento: houveTransferencia
                ? 'TRANSFERENCIA_ENTRADA'
                : (vinculoMesmoAno ? 'ATUALIZACAO_MATRICULA' : 'MATRICULA'),
            status_aluno: parseOptionalText(alunoPayload.status) || 'ativo',
            detalhes: {
                unidade_ensino: escola.nome,
                payload_aluno: alunoPayload,
                payload_complementar: complementarPayload,
                payload_localizacao: localizacaoPayload,
            },
        });

        await saveAlunoComplementos(client, tenantId, alunoId, complementarPayload);

        await client.query("COMMIT");
        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_ENROLLMENT_SAVED',
            targetType: 'aluno_matricula',
            targetId: alunoId,
            description: 'Matrícula escolar salva.',
            metadata: { escola_id: escolaId, aluno_id: alunoId, ano_letivo: anoLetivo, turma }
        });
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

        const includeSensitive = String(req.query.include_sensitive || "") === "1";
        const alunos = (Array.isArray(data.alunos) ? data.alunos : []).map((aluno) => {
            const payload = { ...aluno, cpf_masked: maskCpf(aluno?.cpf) };
            if (!includeSensitive) delete payload.cpf;
            return payload;
        });

        return res.json({
            escola: data.escola,
            resumo: data.resumo,
            alunos,
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

router.post("/:id/alunos/:alunoId/transferencias-internas", requirePermission('school.transfer.manage'), async (req, res) => {
    const client = await pool.connect();
    try {
        const escolaOrigemId = parseInt(req.params.id, 10);
        const alunoId = parseInt(req.params.alunoId, 10);
        const escolaDestinoId = parseInt(req.body?.escola_destino_id, 10);
        const anoLetivo = parseOptionalInt(req.body?.ano_letivo);
        const turmaDestino = parseOptionalText(req.body?.turma_destino);

        if ([escolaOrigemId, alunoId, escolaDestinoId].some((value) => Number.isNaN(value))) {
            return res.status(400).json({ error: "Identificadores inválidos para transferência." });
        }
        if (escolaOrigemId === escolaDestinoId) {
            return res.status(400).json({ error: "A escola de destino deve ser diferente da escola de origem." });
        }
        if (!anoLetivo) {
            return res.status(400).json({ error: "Informe o ano letivo da transferência." });
        }
        if (!turmaDestino) {
            return res.status(400).json({ error: "Informe a turma de destino." });
        }

        const tenantId = getTenantId(req);
        const tenantSupport = await getTenantColumnSupport();
        const columnSupport = await getColumnSupport();
        await ensureTransferenciasInternasTable();
        await ensureMatriculasHistoricoTable();
        await ensureAlunosEscolasWorkflowColumns();

        const [aluno, escolaOrigem, escolaDestino] = await Promise.all([
            loadAlunoMatriculaDetalhes({ escolaId: escolaOrigemId, alunoId, tenantId }),
            loadEscolaById(client, escolaOrigemId, tenantId),
            loadEscolaById(client, escolaDestinoId, tenantId),
        ]);

        if (!aluno) return res.status(404).json({ error: "Aluno não encontrado." });
        if (!escolaOrigem) return res.status(404).json({ error: "Escola de origem não encontrada." });
        if (!escolaDestino) return res.status(404).json({ error: "Escola de destino não encontrada." });

        await client.query("BEGIN");

        const codigoValidacao = generateTransferValidationCode();

        const insertResult = await client.query(
            `
            INSERT INTO alunos_transferencias_internas (
                tenant_id, aluno_id, escola_origem_id, escola_destino_id, ano_letivo,
                turma_origem, turma_destino, status, motivo, observacoes,
                codigo_validacao,
                responsavel_nome, responsavel_documento, responsavel_parentesco,
                responsavel_telefone, responsavel_email, solicitado_por_usuario_id,
                autorizacao_assinada, atualizado_em
            )
            VALUES ($1,$2,$3,$4,$5,$6,$7,'AGUARDANDO_RECEBIMENTO_DESTINO',$8,$9,$10,$11,$12,$13,$14,$15,$16,false,NOW())
            RETURNING id, criado_em
            `,
            [
                tenantId || null,
                alunoId,
                escolaOrigemId,
                escolaDestinoId,
                anoLetivo,
                parseOptionalText(aluno.turma_escola || aluno.turma),
                turmaDestino,
                parseOptionalText(req.body?.motivo),
                parseOptionalText(req.body?.observacoes),
                codigoValidacao,
                parseOptionalText(req.body?.responsavel_nome) || parseOptionalText(aluno.responsavel),
                parseOptionalText(req.body?.responsavel_documento),
                parseOptionalText(req.body?.responsavel_parentesco),
                parseOptionalText(req.body?.responsavel_telefone) || parseOptionalText(aluno.telefone_responsavel),
                parseOptionalText(req.body?.responsavel_email),
                req?.user?.id ? Number(req.user.id) : null,
            ],
        );

        const transferenciaId = Number(insertResult.rows[0].id);
        const protocolo = formatProtocoloTransferencia(transferenciaId, anoLetivo);

        await client.query(
            `UPDATE alunos_transferencias_internas SET protocolo = $2 WHERE id = $1`,
            [transferenciaId, protocolo],
        );

        const origemParams = [alunoId, anoLetivo, escolaOrigemId, transferenciaId];
        let origemTenantWhere = '';
        if (tenantSupport.alunos_escolas && tenantId) {
            origemParams.push(tenantId);
            origemTenantWhere = 'AND tenant_id = $5';
        }
        await client.query(
            `
            UPDATE alunos_escolas
               SET status_matricula = 'EM_TRANSFERENCIA',
                   transferencia_id = $4,
                   motivo_status = 'Transferência interna aguardando validação da escola de destino',
                   data_saida = NOW(),
                   atualizado_em = NOW()
             WHERE aluno_id = $1
               AND ano_letivo = $2
               AND escola_id = $3
               ${origemTenantWhere}
            `,
            origemParams,
        );

        const updateAlunoParams = [alunoId];
        let updateAlunoWhere = 'WHERE id = $1';
        if (columnSupport.alunosMunicipaisTenantId && tenantId) {
            updateAlunoParams.push(tenantId);
            updateAlunoWhere += ' AND tenant_id = $2';
        }
        await client.query(
            `
            UPDATE alunos_municipais
               SET status = 'em_transferencia',
                   atualizado_em = NOW()
             ${updateAlunoWhere}
            `,
            updateAlunoParams,
        );

        await registrarHistoricoMatricula(client, tenantId, {
            aluno_id: alunoId,
            escola_id: escolaOrigemId,
            escola_destino_id: escolaDestinoId,
            ano_letivo: anoLetivo,
            turma: aluno.turma_escola || aluno.turma,
            turma_destino: turmaDestino,
            tipo_evento: "TRANSFERENCIA_INTERNA_SOLICITADA",
            status_aluno: "em_transferencia",
            detalhes: {
                transferencia_id: transferenciaId,
                protocolo,
                codigo_validacao: codigoValidacao,
                motivo: parseOptionalText(req.body?.motivo),
                observacoes: parseOptionalText(req.body?.observacoes),
                escola_origem_nome: escolaOrigem.nome,
                escola_destino_nome: escolaDestino.nome,
                responsavel_nome: parseOptionalText(req.body?.responsavel_nome) || parseOptionalText(aluno.responsavel),
                responsavel_documento: parseOptionalText(req.body?.responsavel_documento),
            },
        });

        await registrarAuditoriaEscolar(client, req, {
            tenant_id: tenantId,
            modulo: "escola",
            entidade: "aluno_transferencia_interna",
            entidade_id: transferenciaId,
            acao: "TRANSFERENCIA_INTERNA_SOLICITADA",
            detalhes: {
                aluno_id: alunoId,
                escola_origem_id: escolaOrigemId,
                escola_destino_id: escolaDestinoId,
                ano_letivo: anoLetivo,
                turma_origem: aluno.turma_escola || aluno.turma || null,
                turma_destino: turmaDestino,
                protocolo,
                codigo_validacao: codigoValidacao,
            },
        });

        await client.query("COMMIT");
        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_TRANSFER_REQUESTED',
            targetType: 'aluno_transferencia',
            targetId: transferenciaId,
            description: 'Transferência interna solicitada.',
            metadata: { aluno_id: alunoId, escola_origem_id: escolaOrigemId, escola_destino_id: escolaDestinoId, ano_letivo: anoLetivo, turma_destino: turmaDestino }
        });
        return res.status(201).json({
            message: "Solicitação de transferência interna registrada.",
            transferencia_id: transferenciaId,
            protocolo,
            status: "AGUARDANDO_RECEBIMENTO_DESTINO",
            pdf_url: `/api/escolas/${escolaOrigemId}/alunos/${alunoId}/transferencias-internas/${transferenciaId}/autorizacao-pdf`,
        });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro ao solicitar transferência interna do aluno:", err);
        return res.status(500).json({ error: "Erro ao solicitar transferência interna do aluno." });
    } finally {
        client.release();
    }
});

router.post("/:id/alunos/:alunoId/transferencias-internas/:transferenciaId/concluir", requirePermission('school.transfer.manage'), async (req, res) => {
    return res.status(400).json({ error: "A conclusão da transferência deve ser feita pela escola de destino, com o código de validação do documento." });
});

router.get("/:id/transferencias-internas/recebidas", requirePermission('school.transfer.manage'), async (req, res) => {
    try {
        const escolaDestinoId = parseInt(req.params.id, 10);
        if (Number.isNaN(escolaDestinoId)) {
            return res.status(400).json({ error: "ID de escola inválido." });
        }

        const tenantId = getTenantId(req);
        await ensureTransferenciasInternasTable();

        const params = [escolaDestinoId];
        let tenantWhere = '';
        if (tenantId) {
            params.push(tenantId);
            tenantWhere = 'AND t.tenant_id = $2';
        }

        const result = await pool.query(
            `
            SELECT
                t.id,
                t.aluno_id,
                t.escola_origem_id,
                t.escola_destino_id,
                t.ano_letivo,
                t.turma_origem,
                t.turma_destino,
                t.status,
                t.protocolo,
                t.criado_em,
                t.responsavel_nome,
                ao.pessoa_nome,
                eo.nome AS escola_origem_nome
            FROM alunos_transferencias_internas t
            JOIN alunos_municipais ao ON ao.id = t.aluno_id
            JOIN escolas eo ON eo.id = t.escola_origem_id
            WHERE t.escola_destino_id = $1
              ${tenantWhere}
              AND COALESCE(t.status, 'AGUARDANDO_RECEBIMENTO_DESTINO') = 'AGUARDANDO_RECEBIMENTO_DESTINO'
            ORDER BY t.criado_em DESC, t.id DESC
            `,
            params,
        );

        return res.json(result.rows || []);
    } catch (err) {
        console.error("Erro ao listar transferências internas recebidas:", err);
        return res.status(500).json({ error: "Erro ao listar transferências internas recebidas." });
    }
});

router.post("/:id/transferencias-internas/:transferenciaId/aceitar", requirePermission('school.transfer.manage'), async (req, res) => {
    const client = await pool.connect();
    try {
        const escolaDestinoId = parseInt(req.params.id, 10);
        const transferenciaId = parseInt(req.params.transferenciaId, 10);
        const codigoValidacao = parseOptionalText(req.body?.codigo_validacao);
        if ([escolaDestinoId, transferenciaId].some((value) => Number.isNaN(value))) {
            return res.status(400).json({ error: "Identificadores inválidos para concluir a transferência." });
        }
        if (!codigoValidacao) {
            return res.status(400).json({ error: "Informe o código de validação da autorização." });
        }
        if (req.body?.autorizacao_assinada !== true) {
            return res.status(400).json({ error: "Confirme que a autorização assinada foi apresentada pela família." });
        }

        const tenantId = getTenantId(req);
        const tenantSupport = await getTenantColumnSupport();
        const columnSupport = await getColumnSupport();
        await ensureTransferenciasInternasTable();
        await ensureMatriculasHistoricoTable();
        await ensureAlunosEscolasWorkflowColumns();

        await client.query("BEGIN");

        const transferenciaParams = [transferenciaId, escolaDestinoId];
        let tenantWhereTransfer = "";
        if (tenantId) {
            transferenciaParams.push(tenantId);
            tenantWhereTransfer = `AND tenant_id = $3`;
        }

        const transferenciaResult = await client.query(
            `
            SELECT *
            FROM alunos_transferencias_internas
            WHERE id = $1
              AND escola_destino_id = $2
              ${tenantWhereTransfer}
            LIMIT 1
            `,
            transferenciaParams,
        );
        const transferencia = transferenciaResult.rows[0];
        if (!transferencia) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Solicitação de transferência não encontrada." });
        }
        if (String(transferencia.status || "").toUpperCase() === "CONCLUIDA") {
            await client.query("ROLLBACK");
            return res.status(409).json({ error: "Esta transferência interna já foi concluída." });
        }
        if (String(transferencia.codigo_validacao || '') !== String(codigoValidacao)) {
            await client.query("ROLLBACK");
            return res.status(400).json({ error: "Código de validação inválido." });
        }
        const alunoId = Number(transferencia.aluno_id);

        const escolaDestino = await loadEscolaById(client, escolaDestinoId, tenantId);
        if (!escolaDestino) {
            await client.query("ROLLBACK");
            return res.status(404).json({ error: "Escola de destino não encontrada." });
        }

        const anoLetivo = parseOptionalInt(transferencia.ano_letivo);
        const turmaDestino = parseOptionalText(transferencia.turma_destino);

        const vinculosParams = [alunoId, anoLetivo];
        let vinculosTenantWhere = '';
        if (tenantSupport.alunos_escolas && tenantId) {
            vinculosParams.push(tenantId);
            vinculosTenantWhere = 'AND tenant_id = $3';
        }

        const vinculosResult = await client.query(
            `
            SELECT id, escola_id, turma, ano_letivo, atualizado_em
            FROM alunos_escolas
            WHERE aluno_id = $1
              AND ano_letivo = $2
              ${vinculosTenantWhere}
            `,
            vinculosParams,
        );
        const vinculosExistentes = vinculosResult.rows || [];
        const vinculoOrigem = vinculosExistentes.find((row) => Number(row.escola_id) === Number(transferencia.escola_origem_id)) || null;

        const origemParams = [alunoId, anoLetivo, Number(transferencia.escola_origem_id), transferenciaId];
        let origemTenantWhere = '';
        if (tenantSupport.alunos_escolas && tenantId) {
            origemParams.push(tenantId);
            origemTenantWhere = 'AND tenant_id = $5';
        }
        await client.query(
            `
            UPDATE alunos_escolas
               SET status_matricula = 'TRANSFERIDO',
                   transferencia_id = $4,
                   motivo_status = 'Transferência interna concluída para outra unidade',
                   data_saida = COALESCE(data_saida, NOW()),
                   atualizado_em = NOW()
             WHERE aluno_id = $1
               AND ano_letivo = $2
               AND escola_id = $3
               ${origemTenantWhere}
            `,
            origemParams,
        );

        await registrarHistoricoMatricula(client, tenantId, {
            aluno_id: alunoId,
            escola_id: Number(transferencia.escola_origem_id),
            escola_destino_id: Number(transferencia.escola_destino_id),
            ano_letivo: anoLetivo,
            turma: vinculoOrigem?.turma || transferencia.turma_origem,
            turma_destino: turmaDestino,
            tipo_evento: "TRANSFERENCIA_SAIDA",
            status_aluno: "transferido",
            detalhes: {
                origem: "transferencia_interna",
                transferencia_id: transferenciaId,
                protocolo: transferencia.protocolo,
                autorizacao_assinada: true,
            },
        });

        await registrarHistoricoMatricula(client, tenantId, {
            aluno_id: alunoId,
            escola_id: Number(transferencia.escola_origem_id),
            escola_destino_id: Number(transferencia.escola_destino_id),
            ano_letivo: anoLetivo,
            turma: vinculoOrigem?.turma || transferencia.turma_origem,
            turma_destino: turmaDestino,
            tipo_evento: "TRANSFERENCIA_ENTRADA",
            status_aluno: "ativo",
            detalhes: {
                origem: "transferencia_interna",
                transferencia_id: transferenciaId,
                protocolo: transferencia.protocolo,
                autorizacao_assinada: true,
            },
        });

        if (tenantSupport.alunos_escolas) {
            await client.query(
                `
                INSERT INTO alunos_escolas (tenant_id, aluno_id, escola_id, ano_letivo, turma, status_matricula, transferencia_id, motivo_status, data_entrada, data_saida)
                VALUES ($1, $2, $3, $4, $5, 'ATIVO', $6, NULL, NOW(), NULL)
                ON CONFLICT (aluno_id, escola_id, ano_letivo) DO UPDATE
                SET turma = EXCLUDED.turma,
                    status_matricula = 'ATIVO',
                    transferencia_id = $6,
                    motivo_status = NULL,
                    data_entrada = COALESCE(alunos_escolas.data_entrada, NOW()),
                    data_saida = NULL,
                    atualizado_em = NOW()
                `,
                [tenantId, alunoId, Number(transferencia.escola_destino_id), anoLetivo, turmaDestino, transferenciaId],
            );
        } else {
            await client.query(
                `
                INSERT INTO alunos_escolas (aluno_id, escola_id, ano_letivo, turma, status_matricula, transferencia_id, motivo_status, data_entrada, data_saida)
                VALUES ($1, $2, $3, $4, 'ATIVO', $5, NULL, NOW(), NULL)
                ON CONFLICT (aluno_id, escola_id, ano_letivo) DO UPDATE
                SET turma = EXCLUDED.turma,
                    status_matricula = 'ATIVO',
                    transferencia_id = $5,
                    motivo_status = NULL,
                    data_saida = NULL,
                    atualizado_em = NOW()
                `,
                [alunoId, Number(transferencia.escola_destino_id), anoLetivo, turmaDestino, transferenciaId],
            );
        }

        const updateAlunoParams = [
            escolaDestino.nome,
            turmaDestino,
            escolaDestino.codigo_inep,
            alunoId,
        ];
        const updateAlunoSets = [
            `unidade_ensino = COALESCE($1, unidade_ensino)`,
            `turma = COALESCE($2, turma)`,
            `codigo_inep = COALESCE($3, codigo_inep)`,
            `status = 'ativo'`,
            `transporte_apto = COALESCE(transporte_apto, false)`,
        ];
        let updateAlunoWhere = `WHERE id = $4`;
        if (columnSupport.alunosMunicipaisTenantId && tenantId) {
            updateAlunoParams.push(tenantId);
            updateAlunoWhere += ` AND tenant_id = $5`;
        }

        await client.query(
            `
            UPDATE alunos_municipais
            SET ${updateAlunoSets.join(", ")},
                atualizado_em = NOW()
            ${updateAlunoWhere}
            `,
            updateAlunoParams,
        );

        const conclusaoTime = new Date().toISOString();
        const updateTransferParams = [
            transferenciaId,
            req?.user?.id ? Number(req.user.id) : null,
            conclusaoTime,
        ];
        let updateTransferTenantWhere = '';
        if (tenantId) {
            updateTransferParams.push(tenantId);
            updateTransferTenantWhere = 'AND tenant_id = $4';
        }
        await client.query(
            `
            UPDATE alunos_transferencias_internas
            SET status = 'CONCLUIDA',
                autorizacao_assinada = true,
                autorizado_em = COALESCE(autorizado_em, $3::timestamp),
                concluido_em = $3::timestamp,
                concluido_por_usuario_id = $2,
                atualizado_em = NOW()
            WHERE id = $1
            ${updateTransferTenantWhere}
            `,
            updateTransferParams,
        );

        await registrarAuditoriaEscolar(client, req, {
            tenant_id: tenantId,
            modulo: "escola",
            entidade: "aluno_transferencia_interna",
            entidade_id: transferenciaId,
            acao: "TRANSFERENCIA_INTERNA_CONCLUIDA",
            detalhes: {
                aluno_id: alunoId,
                escola_origem_id: Number(transferencia.escola_origem_id),
                escola_destino_id: Number(transferencia.escola_destino_id),
                escola_destino_nome: escolaDestino.nome,
                ano_letivo: anoLetivo,
                turma_destino: turmaDestino,
                protocolo: transferencia.protocolo,
                codigo_validacao: codigoValidacao,
            },
        });

        await client.query("COMMIT");
        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_TRANSFER_COMPLETED',
            targetType: 'aluno_transferencia',
            targetId: transferenciaId,
            description: 'Transferência interna concluída.',
            metadata: { aluno_id: alunoId, escola_origem_id: Number(transferencia.escola_origem_id), escola_destino_id: Number(transferencia.escola_destino_id), ano_letivo: anoLetivo, turma_destino: turmaDestino }
        });
        return res.json({
            message: "Transferência interna concluída com sucesso.",
            transferencia_id: transferenciaId,
            protocolo: transferencia.protocolo,
            escola_destino_id: Number(transferencia.escola_destino_id),
            escola_destino_nome: escolaDestino.nome,
            ano_letivo: anoLetivo,
            turma_destino: turmaDestino,
        });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro ao concluir transferência interna do aluno:", err);
        return res.status(500).json({ error: "Erro ao concluir transferência interna do aluno." });
    } finally {
        client.release();
    }
});

router.get("/:id/alunos/:alunoId/transferencias-internas/:transferenciaId/autorizacao-pdf", requirePermission('school.documents.emit'), async (req, res) => {
    try {
        const escolaOrigemId = parseInt(req.params.id, 10);
        const alunoId = parseInt(req.params.alunoId, 10);
        const transferenciaId = parseInt(req.params.transferenciaId, 10);
        if ([escolaOrigemId, alunoId, transferenciaId].some((value) => Number.isNaN(value))) {
            return res.status(400).json({ error: "Identificadores inválidos para gerar a autorização." });
        }

        const tenantId = getTenantId(req);
        await ensureTransferenciasInternasTable();
        const params = [transferenciaId, alunoId, escolaOrigemId];
        let tenantWhere = '';
        if (tenantId) {
            params.push(tenantId);
            tenantWhere = 'AND t.tenant_id = $4';
        }
        const result = await pool.query(
            `
            SELECT
                t.*,
                ao.pessoa_nome,
                ao.cpf,
                ao.id_pessoa,
                ao.data_nascimento,
                ao.responsavel,
                ao.telefone_responsavel,
                eo.nome AS escola_origem_nome,
                eo.codigo_inep AS escola_origem_inep,
                ed.nome AS escola_destino_nome,
                ed.codigo_inep AS escola_destino_inep
            FROM alunos_transferencias_internas t
            JOIN alunos_municipais ao ON ao.id = t.aluno_id
            JOIN escolas eo ON eo.id = t.escola_origem_id
            JOIN escolas ed ON ed.id = t.escola_destino_id
            WHERE t.id = $1
              AND t.aluno_id = $2
              AND t.escola_origem_id = $3
              ${tenantWhere}
            LIMIT 1
            `,
            params,
        );
        const transferencia = result.rows[0];
        if (!transferencia) {
            return res.status(404).json({ error: "Solicitação de transferência não encontrada." });
        }
        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_TRANSFER_AUTHORIZATION_EMITTED',
            targetType: 'documento',
            targetId: transferenciaId,
            description: 'Autorização de transferência interna emitida.',
            metadata: { escola_id: escolaOrigemId, aluno_id: alunoId, transferencia_id: transferenciaId }
        });

        const branding = await getBranding(tenantId);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="autorizacao_transferencia_${transferenciaId}.pdf"`);

        const doc = new PDFDocument({ size: "A4", margin: 45 });
        doc.pipe(res);
        drawCabecalho(doc, branding);
        doc.y = 120;
        doc.font("Helvetica-Bold").fontSize(15).text("AUTORIZAÇÃO DE TRANSFERÊNCIA INTERNA", { align: "center" });
        doc.moveDown(1.4);
        doc.font("Helvetica").fontSize(11);
        doc.text(`Protocolo: ${transferencia.protocolo || "Não informado"}`);
        doc.text(`Código de validação: ${transferencia.codigo_validacao || "Não informado"}`);
        doc.text(`Data da solicitação: ${formatDatePtBr(transferencia.criado_em)}`);
        doc.moveDown(1);
        doc.text(
            `Eu, ${transferencia.responsavel_nome || transferencia.responsavel || "__________________________________"}, ` +
            `documento ${transferencia.responsavel_documento || "__________________________________"}, ` +
            `na qualidade de ${transferencia.responsavel_parentesco || "responsável legal"}, autorizo a transferência interna do(a) estudante ` +
            `${transferencia.pessoa_nome || "Não informado"} (ID rede ${transferencia.id_pessoa || "N/I"}) ` +
            `da unidade ${transferencia.escola_origem_nome || "Não informada"} para a unidade ${transferencia.escola_destino_nome || "Não informada"}, ` +
            `no ano letivo de ${transferencia.ano_letivo || "N/I"}, turma destino ${transferencia.turma_destino || "Não informada"}.`,
            { align: "justify" },
        );
        doc.moveDown(1);
        doc.text(`Motivo informado: ${transferencia.motivo || "Não informado"}`, { align: "justify" });
        if (transferencia.observacoes) {
            doc.moveDown(0.5);
            doc.text(`Observações: ${transferencia.observacoes}`, { align: "justify" });
        }
        doc.moveDown(1.5);
        doc.text("Este documento deve acompanhar o estudante até a escola de destino para formalização definitiva da transferência. O código de validação acima deverá ser informado pela escola receptora no momento do aceite.", { align: "justify" });
        doc.moveDown(2.5);
        doc.text("__________________________________________", { align: "center" });
        doc.font("Helvetica-Bold").text(transferencia.responsavel_nome || "Responsável legal", { align: "center" });
        doc.font("Helvetica").text(`Documento: ${transferencia.responsavel_documento || "Não informado"}`, { align: "center" });
        doc.moveDown(2.5);
        doc.text("__________________________________________", { align: "center" });
        doc.font("Helvetica-Bold").text("Secretaria escolar - escola de origem", { align: "center" });
        doc.moveDown(2);
        doc.text("__________________________________________", { align: "center" });
        doc.font("Helvetica-Bold").text("Recebimento - escola de destino", { align: "center" });
        drawRodape(doc, branding);
        doc.end();
    } catch (err) {
        console.error("Erro ao gerar autorização de transferência interna:", err);
        return res.status(500).json({ error: "Erro ao gerar autorização de transferência interna." });
    }
});

router.get("/:id/alunos/:alunoId/atestado-matricula-pdf", requirePermission('school.documents.emit'), async (req, res) => {
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
        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_DOCUMENT_ATTESTATION_EMITTED',
            targetType: 'documento',
            targetId: alunoId,
            description: 'Atestado de matrícula emitido.',
            metadata: { escola_id: escolaId, aluno_id: alunoId, documento: 'atestado_matricula' }
        });

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

router.get("/:id/alunos/:alunoId/ficha-matricula-pdf", requirePermission('school.documents.emit'), async (req, res) => {
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
        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_DOCUMENT_ENROLLMENT_FORM_EMITTED',
            targetType: 'documento',
            targetId: alunoId,
            description: 'Ficha de matrícula emitida.',
            metadata: { escola_id: escolaId, aluno_id: alunoId, documento: 'ficha_matricula' }
        });

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

router.get("/:id/academico/overview", requirePermission('school.dashboard.view'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const tenantId = getTenantId(req);
        const anoLetivo = parseOptionalInt(req.query?.ano_letivo);
        const overview = await loadAcademicOverview(escolaId, tenantId, anoLetivo);
        return res.json(overview);
    } catch (err) {
        console.error("Erro ao carregar overview acadêmico:", err);
        return res.status(500).json({ error: "Erro ao carregar overview acadêmico." });
    }
});

router.get("/:id/diario-classe", requirePermission('school.dashboard.view'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const tenantId = getTenantId(req);
        await ensureAcademicMaturityTables();
        const anoLetivo = parseOptionalInt(req.query?.ano_letivo);
        const turma = parseOptionalText(req.query?.turma);
        const params = [tenantId, escolaId];
        const filtros = ['tenant_id = $1', 'escola_id = $2'];
        if (anoLetivo) {
            params.push(anoLetivo);
            filtros.push(`ano_letivo = $${params.length}`);
        }
        if (turma) {
            params.push(turma);
            filtros.push(`turma = $${params.length}`);
        }
        const result = await pool.query(
            `
            SELECT *
            FROM escola_diario_classe
            WHERE ${filtros.join(' AND ')}
            ORDER BY data_aula DESC, turma ASC, disciplina_nome ASC, id DESC
            `,
            params
        );
        const disciplinas = await loadDisciplinasContexto(tenantId);
        return res.json({ registros: result.rows || [], disciplinas });
    } catch (err) {
        console.error("Erro ao listar diário de classe:", err);
        return res.status(500).json({ error: "Erro ao listar diário de classe." });
    }
});

router.post("/:id/diario-classe", requirePermission('school.students.manage'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const tenantId = getTenantId(req);
        await ensureAcademicMaturityTables();
        const result = await pool.query(
            `
            INSERT INTO escola_diario_classe (
                tenant_id, escola_id, turma, ano_letivo, data_aula, periodo_letivo, disciplina_id, disciplina_nome,
                professor_nome, conteudo, metodologia, atividade_prevista, observacoes,
                total_previsto, presentes, ausentes, justificados, status
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,
                $9,$10,$11,$12,$13,
                $14,$15,$16,$17,$18
            )
            RETURNING *
            `,
            [
                tenantId, escolaId, parseOptionalText(req.body?.turma), parseOptionalInt(req.body?.ano_letivo) || new Date().getFullYear(),
                parseOptionalDate(req.body?.data_aula) || new Date().toISOString().slice(0, 10), parseOptionalText(req.body?.periodo_letivo),
                parseOptionalInt(req.body?.disciplina_id), parseOptionalText(req.body?.disciplina_nome),
                parseOptionalText(req.body?.professor_nome), parseOptionalText(req.body?.conteudo), parseOptionalText(req.body?.metodologia),
                parseOptionalText(req.body?.atividade_prevista), parseOptionalText(req.body?.observacoes),
                parseOptionalInt(req.body?.total_previsto) || 0, parseOptionalInt(req.body?.presentes) || 0,
                parseOptionalInt(req.body?.ausentes) || 0, parseOptionalInt(req.body?.justificados) || 0,
                parseOptionalText(req.body?.status) || 'LANÇADO',
            ]
        );
        await registrarAuditoriaEscolar(pool, req, {
            tenant_id: tenantId,
            modulo: "academico",
            entidade: "diario_classe",
            entidade_id: result.rows[0]?.id,
            acao: "DIARIO_CLASSE_LANCADO",
            detalhes: result.rows[0] || {},
        });
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Erro ao lançar diário de classe:", err);
        return res.status(500).json({ error: "Erro ao lançar diário de classe." });
    }
});

router.put("/:id/diario-classe/:registroId", requirePermission('school.students.manage'), async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const escolaId = parseInt(req.params.id, 10);
        const registroId = parseInt(req.params.registroId, 10);
        await ensureAcademicMaturityTables();
        const result = await pool.query(
            `
            UPDATE escola_diario_classe
            SET turma = $3,
                ano_letivo = $4,
                data_aula = $5,
                periodo_letivo = $6,
                disciplina_id = $7,
                disciplina_nome = $8,
                professor_nome = $9,
                conteudo = $10,
                metodologia = $11,
                atividade_prevista = $12,
                observacoes = $13,
                total_previsto = $14,
                presentes = $15,
                ausentes = $16,
                justificados = $17,
                status = $18,
                atualizado_em = NOW()
            WHERE tenant_id = $1
              AND escola_id = $2
              AND id = $19
            RETURNING *
            `,
            [
                tenantId, escolaId, parseOptionalText(req.body?.turma), parseOptionalInt(req.body?.ano_letivo),
                parseOptionalDate(req.body?.data_aula), parseOptionalText(req.body?.periodo_letivo),
                parseOptionalInt(req.body?.disciplina_id), parseOptionalText(req.body?.disciplina_nome),
                parseOptionalText(req.body?.professor_nome), parseOptionalText(req.body?.conteudo), parseOptionalText(req.body?.metodologia),
                parseOptionalText(req.body?.atividade_prevista), parseOptionalText(req.body?.observacoes),
                parseOptionalInt(req.body?.total_previsto) || 0, parseOptionalInt(req.body?.presentes) || 0,
                parseOptionalInt(req.body?.ausentes) || 0, parseOptionalInt(req.body?.justificados) || 0,
                parseOptionalText(req.body?.status) || 'LANÇADO', registroId,
            ]
        );
        if (!result.rowCount) return res.status(404).json({ error: "Registro de diário não encontrado." });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error("Erro ao atualizar diário de classe:", err);
        return res.status(500).json({ error: "Erro ao atualizar diário de classe." });
    }
});

router.get("/:id/notas-componentes", requirePermission('school.dashboard.view'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const tenantId = getTenantId(req);
        await ensureAcademicMaturityTables();
        const anoLetivo = parseOptionalInt(req.query?.ano_letivo);
        const turma = parseOptionalText(req.query?.turma);
        const alunoId = parseOptionalInt(req.query?.aluno_id);
        const params = [tenantId, escolaId];
        const filtros = ['n.tenant_id = $1', 'n.escola_id = $2'];
        if (anoLetivo) { params.push(anoLetivo); filtros.push(`n.ano_letivo = $${params.length}`); }
        if (turma) { params.push(turma); filtros.push(`n.turma = $${params.length}`); }
        if (alunoId) { params.push(alunoId); filtros.push(`n.aluno_id = $${params.length}`); }
        const result = await pool.query(
            `
            SELECT n.*, a.pessoa_nome, a.id_pessoa
            FROM escola_avaliacoes_componentes n
            LEFT JOIN alunos_municipais a ON a.id = n.aluno_id
            WHERE ${filtros.join(' AND ')}
            ORDER BY n.ano_letivo DESC, n.periodo_letivo ASC, n.disciplina_nome ASC, a.pessoa_nome ASC
            `,
            params
        );
        const disciplinas = await loadDisciplinasContexto(tenantId);
        return res.json({ lancamentos: result.rows || [], disciplinas });
    } catch (err) {
        console.error("Erro ao listar notas por componente:", err);
        return res.status(500).json({ error: "Erro ao listar notas por componente." });
    }
});

router.post("/:id/notas-componentes", requirePermission('school.students.manage'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const tenantId = getTenantId(req);
        await ensureAcademicMaturityTables();
        const result = await pool.query(
            `
            INSERT INTO escola_avaliacoes_componentes (
                tenant_id, escola_id, aluno_id, turma, ano_letivo, periodo_letivo, disciplina_id, disciplina_nome,
                tipo_avaliacao, nota, frequencia, faltas, recuperacao, parecer_descritivo, status
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,
                $9,$10,$11,$12,$13,$14,$15
            )
            RETURNING *
            `,
            [
                tenantId, escolaId, parseOptionalInt(req.body?.aluno_id), parseOptionalText(req.body?.turma),
                parseOptionalInt(req.body?.ano_letivo) || new Date().getFullYear(), parseOptionalText(req.body?.periodo_letivo),
                parseOptionalInt(req.body?.disciplina_id), parseOptionalText(req.body?.disciplina_nome), parseOptionalText(req.body?.tipo_avaliacao) || 'REGULAR',
                req.body?.nota === '' ? null : Number(req.body?.nota), req.body?.frequencia === '' ? null : Number(req.body?.frequencia),
                parseOptionalInt(req.body?.faltas) || 0, Boolean(req.body?.recuperacao), parseOptionalText(req.body?.parecer_descritivo),
                parseOptionalText(req.body?.status) || 'LANÇADO',
            ]
        );
        await registrarAuditoriaEscolar(pool, req, {
            tenant_id: tenantId,
            modulo: "academico",
            entidade: "avaliacao_componente",
            entidade_id: result.rows[0]?.id,
            acao: "NOTA_COMPONENTE_LANCADA",
            detalhes: result.rows[0] || {},
        });
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Erro ao lançar notas por componente:", err);
        return res.status(500).json({ error: "Erro ao lançar notas por componente." });
    }
});

router.put("/:id/notas-componentes/:lancamentoId", requirePermission('school.students.manage'), async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const escolaId = parseInt(req.params.id, 10);
        const lancamentoId = parseInt(req.params.lancamentoId, 10);
        await ensureAcademicMaturityTables();
        const result = await pool.query(
            `
            UPDATE escola_avaliacoes_componentes
            SET aluno_id = $3,
                turma = $4,
                ano_letivo = $5,
                periodo_letivo = $6,
                disciplina_id = $7,
                disciplina_nome = $8,
                tipo_avaliacao = $9,
                nota = $10,
                frequencia = $11,
                faltas = $12,
                recuperacao = $13,
                parecer_descritivo = $14,
                status = $15,
                atualizado_em = NOW()
            WHERE tenant_id = $1
              AND escola_id = $2
              AND id = $16
            RETURNING *
            `,
            [
                tenantId, escolaId, parseOptionalInt(req.body?.aluno_id), parseOptionalText(req.body?.turma),
                parseOptionalInt(req.body?.ano_letivo), parseOptionalText(req.body?.periodo_letivo),
                parseOptionalInt(req.body?.disciplina_id), parseOptionalText(req.body?.disciplina_nome), parseOptionalText(req.body?.tipo_avaliacao),
                req.body?.nota === '' ? null : Number(req.body?.nota), req.body?.frequencia === '' ? null : Number(req.body?.frequencia),
                parseOptionalInt(req.body?.faltas) || 0, Boolean(req.body?.recuperacao), parseOptionalText(req.body?.parecer_descritivo),
                parseOptionalText(req.body?.status) || 'LANÇADO', lancamentoId,
            ]
        );
        if (!result.rowCount) return res.status(404).json({ error: "Lançamento não encontrado." });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error("Erro ao atualizar notas por componente:", err);
        return res.status(500).json({ error: "Erro ao atualizar notas por componente." });
    }
});

router.get("/:id/conselho-classe", requirePermission('school.dashboard.view'), async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const escolaId = parseInt(req.params.id, 10);
        await ensureAcademicMaturityTables();
        const anoLetivo = parseOptionalInt(req.query?.ano_letivo);
        const turma = parseOptionalText(req.query?.turma);
        const params = [tenantId, escolaId];
        const filtros = ['tenant_id = $1', 'escola_id = $2'];
        if (anoLetivo) { params.push(anoLetivo); filtros.push(`ano_letivo = $${params.length}`); }
        if (turma) { params.push(turma); filtros.push(`turma = $${params.length}`); }
        const result = await pool.query(
            `
            SELECT *
            FROM escola_conselho_classe
            WHERE ${filtros.join(' AND ')}
            ORDER BY ano_letivo DESC, periodo_letivo ASC, data_reuniao DESC NULLS LAST, id DESC
            `,
            params
        );
        return res.json(result.rows || []);
    } catch (err) {
        console.error("Erro ao listar conselho de classe:", err);
        return res.status(500).json({ error: "Erro ao listar conselho de classe." });
    }
});

router.post("/:id/conselho-classe", requirePermission('school.students.manage'), async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const escolaId = parseInt(req.params.id, 10);
        await ensureAcademicMaturityTables();
        const result = await pool.query(
            `
            INSERT INTO escola_conselho_classe (
                tenant_id, escola_id, turma, ano_letivo, periodo_letivo, data_reuniao, status, coordenador_nome,
                pauta, deliberacoes, encaminhamentos, alunos_em_atencao, participantes
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,
                $9,$10,$11,$12::jsonb,$13::jsonb
            )
            RETURNING *
            `,
            [
                tenantId, escolaId, parseOptionalText(req.body?.turma), parseOptionalInt(req.body?.ano_letivo) || new Date().getFullYear(),
                parseOptionalText(req.body?.periodo_letivo), parseOptionalDate(req.body?.data_reuniao),
                parseOptionalText(req.body?.status) || 'PLANEJADO', parseOptionalText(req.body?.coordenador_nome),
                parseOptionalText(req.body?.pauta), parseOptionalText(req.body?.deliberacoes), parseOptionalText(req.body?.encaminhamentos),
                JSON.stringify(parseOptionalJsonArray(req.body?.alunos_em_atencao) || []),
                JSON.stringify(parseOptionalJsonArray(req.body?.participantes) || []),
            ]
        );
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Erro ao registrar conselho de classe:", err);
        return res.status(500).json({ error: "Erro ao registrar conselho de classe." });
    }
});

router.put("/:id/conselho-classe/:registroId", requirePermission('school.students.manage'), async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const escolaId = parseInt(req.params.id, 10);
        const registroId = parseInt(req.params.registroId, 10);
        await ensureAcademicMaturityTables();
        const result = await pool.query(
            `
            UPDATE escola_conselho_classe
            SET turma = $3,
                ano_letivo = $4,
                periodo_letivo = $5,
                data_reuniao = $6,
                status = $7,
                coordenador_nome = $8,
                pauta = $9,
                deliberacoes = $10,
                encaminhamentos = $11,
                alunos_em_atencao = $12::jsonb,
                participantes = $13::jsonb,
                atualizado_em = NOW()
            WHERE tenant_id = $1
              AND escola_id = $2
              AND id = $14
            RETURNING *
            `,
            [
                tenantId, escolaId, parseOptionalText(req.body?.turma), parseOptionalInt(req.body?.ano_letivo),
                parseOptionalText(req.body?.periodo_letivo), parseOptionalDate(req.body?.data_reuniao),
                parseOptionalText(req.body?.status) || 'PLANEJADO', parseOptionalText(req.body?.coordenador_nome),
                parseOptionalText(req.body?.pauta), parseOptionalText(req.body?.deliberacoes), parseOptionalText(req.body?.encaminhamentos),
                JSON.stringify(parseOptionalJsonArray(req.body?.alunos_em_atencao) || []),
                JSON.stringify(parseOptionalJsonArray(req.body?.participantes) || []),
                registroId,
            ]
        );
        if (!result.rowCount) return res.status(404).json({ error: "Conselho de classe não encontrado." });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error("Erro ao atualizar conselho de classe:", err);
        return res.status(500).json({ error: "Erro ao atualizar conselho de classe." });
    }
});

router.get("/:id/fechamentos", requirePermission('school.dashboard.view'), async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const escolaId = parseInt(req.params.id, 10);
        await ensureAcademicMaturityTables();
        const anoLetivo = parseOptionalInt(req.query?.ano_letivo);
        const params = [tenantId, escolaId];
        const filtros = ['tenant_id = $1', 'escola_id = $2'];
        if (anoLetivo) { params.push(anoLetivo); filtros.push(`ano_letivo = $${params.length}`); }
        const result = await pool.query(
            `
            SELECT *
            FROM escola_fechamentos_periodo
            WHERE ${filtros.join(' AND ')}
            ORDER BY ano_letivo DESC, periodo_letivo ASC, turma ASC NULLS FIRST, id DESC
            `,
            params
        );
        return res.json(result.rows || []);
    } catch (err) {
        console.error("Erro ao listar fechamentos:", err);
        return res.status(500).json({ error: "Erro ao listar fechamentos." });
    }
});

router.post("/:id/fechamentos", requirePermission('school.students.manage'), async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const escolaId = parseInt(req.params.id, 10);
        await ensureAcademicMaturityTables();
        const result = await pool.query(
            `
            INSERT INTO escola_fechamentos_periodo (
                tenant_id, escola_id, turma, ano_letivo, periodo_letivo, data_inicio, data_fechamento, status,
                frequencia_minima, nota_minima, total_alunos, total_aprovados, total_reprovados, total_transferidos, total_abandono, observacoes
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,
                $9,$10,$11,$12,$13,$14,$15,$16
            )
            RETURNING *
            `,
            [
                tenantId, escolaId, parseOptionalText(req.body?.turma), parseOptionalInt(req.body?.ano_letivo) || new Date().getFullYear(),
                parseOptionalText(req.body?.periodo_letivo), parseOptionalDate(req.body?.data_inicio), parseOptionalDate(req.body?.data_fechamento),
                parseOptionalText(req.body?.status) || 'ABERTO', req.body?.frequencia_minima === '' ? null : Number(req.body?.frequencia_minima),
                req.body?.nota_minima === '' ? null : Number(req.body?.nota_minima), parseOptionalInt(req.body?.total_alunos) || 0,
                parseOptionalInt(req.body?.total_aprovados) || 0, parseOptionalInt(req.body?.total_reprovados) || 0,
                parseOptionalInt(req.body?.total_transferidos) || 0, parseOptionalInt(req.body?.total_abandono) || 0,
                parseOptionalText(req.body?.observacoes),
            ]
        );
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Erro ao registrar fechamento de período:", err);
        return res.status(500).json({ error: "Erro ao registrar fechamento de período." });
    }
});

router.put("/:id/fechamentos/:fechamentoId", requirePermission('school.students.manage'), async (req, res) => {
    try {
        const tenantId = getTenantId(req);
        const escolaId = parseInt(req.params.id, 10);
        const fechamentoId = parseInt(req.params.fechamentoId, 10);
        await ensureAcademicMaturityTables();
        const result = await pool.query(
            `
            UPDATE escola_fechamentos_periodo
            SET turma = $3,
                ano_letivo = $4,
                periodo_letivo = $5,
                data_inicio = $6,
                data_fechamento = $7,
                status = $8,
                frequencia_minima = $9,
                nota_minima = $10,
                total_alunos = $11,
                total_aprovados = $12,
                total_reprovados = $13,
                total_transferidos = $14,
                total_abandono = $15,
                observacoes = $16,
                atualizado_em = NOW()
            WHERE tenant_id = $1
              AND escola_id = $2
              AND id = $17
            RETURNING *
            `,
            [
                tenantId, escolaId, parseOptionalText(req.body?.turma), parseOptionalInt(req.body?.ano_letivo),
                parseOptionalText(req.body?.periodo_letivo), parseOptionalDate(req.body?.data_inicio), parseOptionalDate(req.body?.data_fechamento),
                parseOptionalText(req.body?.status) || 'ABERTO', req.body?.frequencia_minima === '' ? null : Number(req.body?.frequencia_minima),
                req.body?.nota_minima === '' ? null : Number(req.body?.nota_minima), parseOptionalInt(req.body?.total_alunos) || 0,
                parseOptionalInt(req.body?.total_aprovados) || 0, parseOptionalInt(req.body?.total_reprovados) || 0,
                parseOptionalInt(req.body?.total_transferidos) || 0, parseOptionalInt(req.body?.total_abandono) || 0,
                parseOptionalText(req.body?.observacoes), fechamentoId,
            ]
        );
        if (!result.rowCount) return res.status(404).json({ error: "Fechamento não encontrado." });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error("Erro ao atualizar fechamento de período:", err);
        return res.status(500).json({ error: "Erro ao atualizar fechamento de período." });
    }
});

router.get("/:id/ocorrencias", requirePermission('school.dashboard.view'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const tenantId = getTenantId(req);
        const anoLetivo = parseOptionalInt(req.query?.ano_letivo);
        const status = parseOptionalText(req.query?.status);
        const alunoId = parseOptionalInt(req.query?.aluno_id);
        await ensureOcorrenciasEscolaresTable();

        const params = [tenantId, escolaId];
        const filtros = ['o.tenant_id = $1', 'o.escola_id = $2'];
        if (anoLetivo) {
            params.push(anoLetivo);
            filtros.push(`o.ano_letivo = $${params.length}`);
        }
        if (status) {
            params.push(status);
            filtros.push(`o.status = $${params.length}`);
        }
        if (alunoId) {
            params.push(alunoId);
            filtros.push(`o.aluno_id = $${params.length}`);
        }

        const rows = await pool.query(
            `
            SELECT o.*,
                   a.pessoa_nome,
                   a.id_pessoa,
                   a.turma,
                   a.status AS aluno_status
            FROM aluno_ocorrencias_escolares o
            LEFT JOIN alunos_municipais a ON a.id = o.aluno_id
            WHERE ${filtros.join(' AND ')}
            ORDER BY o.data_ocorrencia DESC, o.id DESC
            `,
            params
        );
        return res.json(rows.rows || []);
    } catch (err) {
        console.error("Erro ao listar ocorrências escolares:", err);
        return res.status(500).json({ error: "Erro ao listar ocorrências escolares." });
    }
});

router.post("/:id/ocorrencias", requirePermission('school.students.manage'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const tenantId = getTenantId(req);
        const alunoId = parseOptionalInt(req.body?.aluno_id);
        const titulo = parseOptionalText(req.body?.titulo);
        const categoria = parseOptionalText(req.body?.categoria);
        if (!alunoId || !titulo || !categoria) {
            return res.status(400).json({ error: "aluno_id, titulo e categoria são obrigatórios." });
        }
        await ensureOcorrenciasEscolaresTable();
        const result = await pool.query(
            `
            INSERT INTO aluno_ocorrencias_escolares (
                tenant_id, escola_id, aluno_id, turma, ano_letivo, categoria, subcategoria, gravidade, status,
                titulo, descricao, providencias, encaminhamento, data_ocorrencia,
                responsavel_registro_id, responsavel_registro_nome, sigilosa
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,$8,$9,
                $10,$11,$12,$13,$14,
                $15,$16,$17
            )
            RETURNING *
            `,
            [
                tenantId, escolaId, alunoId, parseOptionalText(req.body?.turma), parseOptionalInt(req.body?.ano_letivo),
                categoria, parseOptionalText(req.body?.subcategoria), parseOptionalText(req.body?.gravidade) || 'MEDIA',
                parseOptionalText(req.body?.status) || 'ABERTA',
                titulo, parseOptionalText(req.body?.descricao), parseOptionalText(req.body?.providencias),
                parseOptionalText(req.body?.encaminhamento), parseOptionalDate(req.body?.data_ocorrencia) || new Date().toISOString(),
                req?.user?.id ? Number(req.user.id) : null, parseOptionalText(req.user?.nome),
                Boolean(req.body?.sigilosa),
            ]
        );
        await registrarAuditoriaEscolar(pool, req, {
            tenant_id: tenantId,
            modulo: "academico",
            entidade: "ocorrencia",
            entidade_id: result.rows[0]?.id,
            acao: "OCORRENCIA_CRIADA",
            detalhes: result.rows[0] || {},
        });
        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_OCCURRENCE_CREATED',
            targetType: 'ocorrencia',
            targetId: result.rows[0]?.id,
            description: 'Ocorrência escolar registrada.',
            metadata: { escola_id: escolaId, aluno_id: alunoId, categoria }
        });
        return res.status(201).json(result.rows[0]);
    } catch (err) {
        console.error("Erro ao criar ocorrência escolar:", err);
        return res.status(500).json({ error: "Erro ao criar ocorrência escolar." });
    }
});

router.put("/:id/ocorrencias/:ocorrenciaId", requirePermission('school.students.manage'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const ocorrenciaId = parseInt(req.params.ocorrenciaId, 10);
        const tenantId = getTenantId(req);
        await ensureOcorrenciasEscolaresTable();
        const result = await pool.query(
            `
            UPDATE aluno_ocorrencias_escolares
            SET categoria = $3,
                subcategoria = $4,
                gravidade = $5,
                status = $6,
                titulo = $7,
                descricao = $8,
                providencias = $9,
                encaminhamento = $10,
                data_ocorrencia = COALESCE($11, data_ocorrencia),
                data_fechamento = $12,
                sigilosa = $13,
                atualizado_em = NOW()
            WHERE tenant_id = $1
              AND escola_id = $2
              AND id = $14
            RETURNING *
            `,
            [
                tenantId, escolaId,
                parseOptionalText(req.body?.categoria),
                parseOptionalText(req.body?.subcategoria),
                parseOptionalText(req.body?.gravidade) || 'MEDIA',
                parseOptionalText(req.body?.status) || 'ABERTA',
                parseOptionalText(req.body?.titulo),
                parseOptionalText(req.body?.descricao),
                parseOptionalText(req.body?.providencias),
                parseOptionalText(req.body?.encaminhamento),
                parseOptionalDate(req.body?.data_ocorrencia),
                parseOptionalDate(req.body?.data_fechamento),
                Boolean(req.body?.sigilosa),
                ocorrenciaId,
            ]
        );
        if (!result.rowCount) return res.status(404).json({ error: "Ocorrência não encontrada." });
        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_OCCURRENCE_UPDATED',
            targetType: 'ocorrencia',
            targetId: ocorrenciaId,
            description: 'Ocorrência escolar atualizada.',
            metadata: { escola_id: escolaId }
        });
        return res.json(result.rows[0]);
    } catch (err) {
        console.error("Erro ao atualizar ocorrência escolar:", err);
        return res.status(500).json({ error: "Erro ao atualizar ocorrência escolar." });
    }
});

router.delete("/:id/ocorrencias/:ocorrenciaId", requirePermission('school.students.manage'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const ocorrenciaId = parseInt(req.params.ocorrenciaId, 10);
        const tenantId = getTenantId(req);
        await ensureOcorrenciasEscolaresTable();
        const result = await pool.query(
            `DELETE FROM aluno_ocorrencias_escolares WHERE tenant_id = $1 AND escola_id = $2 AND id = $3 RETURNING id`,
            [tenantId, escolaId, ocorrenciaId]
        );
        if (!result.rowCount) return res.status(404).json({ error: "Ocorrência não encontrada." });
        return res.json({ success: true });
    } catch (err) {
        console.error("Erro ao excluir ocorrência escolar:", err);
        return res.status(500).json({ error: "Erro ao excluir ocorrência escolar." });
    }
});

router.get("/:id/transferencias-externas", requirePermission('school.dashboard.view'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const tenantId = getTenantId(req);
        await ensureTransferenciasExternasTable();
        const result = await pool.query(
            `
            SELECT t.*, a.pessoa_nome, a.id_pessoa
            FROM alunos_transferencias_externas t
            LEFT JOIN alunos_municipais a ON a.id = t.aluno_id
            WHERE t.tenant_id = $1
              AND t.escola_origem_id = $2
            ORDER BY t.criado_em DESC, t.id DESC
            `,
            [tenantId, escolaId]
        );
        return res.json(result.rows || []);
    } catch (err) {
        console.error("Erro ao listar transferências externas:", err);
        return res.status(500).json({ error: "Erro ao listar transferências externas." });
    }
});

router.post("/:id/alunos/:alunoId/transferencias-externas", requirePermission('school.students.manage'), async (req, res) => {
    const client = await pool.connect();
    try {
        const escolaId = parseInt(req.params.id, 10);
        const alunoId = parseInt(req.params.alunoId, 10);
        const tenantId = getTenantId(req);
        await ensureTransferenciasExternasTable();
        await ensureMatriculasHistoricoTable();
        await ensureAlunosEscolasWorkflowColumns();

        const aluno = await loadAlunoMatriculaDetalhes({ escolaId, alunoId, tenantId });
        if (!aluno) return res.status(404).json({ error: "Aluno não encontrado na unidade." });

        const escolaDestinoNome = parseOptionalText(req.body?.escola_destino_nome);
        if (!escolaDestinoNome) return res.status(400).json({ error: "Escola de destino é obrigatória." });

        const protocolo = `TE-${String(Date.now()).slice(-8)}`;
        const codigoValidacao = randomCode('EXT', 6);
        const anoLetivo = parseOptionalInt(req.body?.ano_letivo) || parseOptionalInt(aluno.ano_letivo) || new Date().getFullYear();

        await client.query('BEGIN');
        const transfer = await client.query(
            `
            INSERT INTO alunos_transferencias_externas (
                tenant_id, aluno_id, escola_origem_id, escola_destino_nome, rede_destino, municipio_destino, uf_destino,
                ano_letivo, turma_origem, status, motivo, observacoes, protocolo, codigo_validacao,
                responsavel_nome, responsavel_documento, responsavel_parentesco, responsavel_telefone, responsavel_email,
                solicitado_por_usuario_id
            ) VALUES (
                $1,$2,$3,$4,$5,$6,$7,
                $8,$9,'AGUARDANDO_DOCUMENTO',$10,$11,$12,$13,
                $14,$15,$16,$17,$18,$19
            )
            RETURNING *
            `,
            [
                tenantId, alunoId, escolaId, escolaDestinoNome, parseOptionalText(req.body?.rede_destino),
                parseOptionalText(req.body?.municipio_destino), parseOptionalText(req.body?.uf_destino),
                anoLetivo, parseOptionalText(aluno.turma_escola || aluno.turma), parseOptionalText(req.body?.motivo),
                parseOptionalText(req.body?.observacoes), protocolo, codigoValidacao,
                parseOptionalText(req.body?.responsavel_nome || aluno.responsavel),
                parseOptionalText(req.body?.responsavel_documento),
                parseOptionalText(req.body?.responsavel_parentesco),
                parseOptionalText(req.body?.responsavel_telefone || aluno.telefone_responsavel),
                parseOptionalText(req.body?.responsavel_email || aluno.email_responsavel),
                req?.user?.id ? Number(req.user.id) : null,
            ]
        );
        const transferencia = transfer.rows[0];

        await client.query(
            `
            UPDATE alunos_escolas
            SET status_matricula = 'TRANSFERENCIA_EXTERNA',
                transferencia_id = $4,
                motivo_status = COALESCE($3, motivo_status),
                data_saida = COALESCE(data_saida, NOW()),
                atualizado_em = NOW()
            WHERE tenant_id = $1
              AND aluno_id = $2
              AND escola_id = $5
              AND ano_letivo = $6
              AND COALESCE(status_matricula, 'ATIVO') = 'ATIVO'
            `,
            [tenantId, alunoId, parseOptionalText(req.body?.motivo), transferencia.id, escolaId, anoLetivo]
        );

        const columnSupport = await getColumnSupport();
        const alunoParams = [alunoId];
        let alunoWhere = 'WHERE id = $1';
        if (columnSupport.alunosMunicipaisTenantId) {
            alunoParams.push(tenantId);
            alunoWhere += ' AND tenant_id = $2';
        }
        await client.query(
            `
            UPDATE alunos_municipais
            SET status = 'transferido',
                atualizado_em = NOW()
            ${alunoWhere}
            `,
            alunoParams
        );

        await client.query(
            `
            INSERT INTO alunos_escolas_historico (
                tenant_id, aluno_id, escola_id, ano_letivo, turma, tipo_evento, status_aluno, detalhes
            ) VALUES ($1,$2,$3,$4,$5,'TRANSFERENCIA_EXTERNA_SOLICITADA','transferido',$6::jsonb)
            `,
            [tenantId, alunoId, escolaId, anoLetivo, parseOptionalText(aluno.turma_escola || aluno.turma), JSON.stringify({
                escola_destino_nome: escolaDestinoNome,
                protocolo,
                codigo_validacao: codigoValidacao,
                rede_destino: parseOptionalText(req.body?.rede_destino),
            })]
        );
        await client.query('COMMIT');

        return res.status(201).json({
            transferencia_id: transferencia.id,
            protocolo,
            codigo_validacao: codigoValidacao,
            pdf_url: `/api/escolas/${escolaId}/alunos/${alunoId}/transferencias-externas/${transferencia.id}/autorizacao-pdf`,
        });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error("Erro ao solicitar transferência externa:", err);
        return res.status(500).json({ error: "Erro ao solicitar transferência externa." });
    } finally {
        client.release();
    }
});

router.post("/:id/transferencias-externas/:transferenciaId/concluir", requirePermission('school.students.manage'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const transferenciaId = parseInt(req.params.transferenciaId, 10);
        const tenantId = getTenantId(req);
        await ensureTransferenciasExternasTable();
        const codigo = parseOptionalText(req.body?.codigo_validacao);
        if (!codigo) return res.status(400).json({ error: "Código de validação é obrigatório." });

        const result = await pool.query(
            `
            UPDATE alunos_transferencias_externas
            SET status = 'CONCLUIDA',
                autorizacao_assinada = TRUE,
                documento_recebido = TRUE,
                concluido_em = NOW(),
                atualizado_em = NOW(),
                concluido_por_usuario_id = $4
            WHERE tenant_id = $1
              AND escola_origem_id = $2
              AND id = $3
              AND codigo_validacao = $5
            RETURNING *
            `,
            [tenantId, escolaId, transferenciaId, req?.user?.id ? Number(req.user.id) : null, codigo]
        );
        if (!result.rowCount) return res.status(404).json({ error: "Transferência externa não encontrada ou código inválido." });
        return res.json({ success: true, transferencia: result.rows[0] });
    } catch (err) {
        console.error("Erro ao concluir transferência externa:", err);
        return res.status(500).json({ error: "Erro ao concluir transferência externa." });
    }
});

router.get("/:id/alunos/:alunoId/transferencias-externas/:transferenciaId/autorizacao-pdf", requirePermission('school.documents.emit'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const alunoId = parseInt(req.params.alunoId, 10);
        const transferenciaId = parseInt(req.params.transferenciaId, 10);
        const tenantId = getTenantId(req);
        await ensureTransferenciasExternasTable();
        const result = await pool.query(
            `
            SELECT t.*, a.pessoa_nome, a.id_pessoa, eo.nome AS escola_origem_nome
            FROM alunos_transferencias_externas t
            JOIN alunos_municipais a ON a.id = t.aluno_id
            JOIN escolas eo ON eo.id = t.escola_origem_id
            WHERE t.tenant_id = $1 AND t.escola_origem_id = $2 AND t.aluno_id = $3 AND t.id = $4
            LIMIT 1
            `,
            [tenantId, escolaId, alunoId, transferenciaId]
        );
        const transferencia = result.rows[0];
        if (!transferencia) return res.status(404).json({ error: "Transferência não encontrada." });

        const branding = await getBranding(tenantId);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="autorizacao_transferencia_externa_${transferenciaId}.pdf"`);
        const doc = new PDFDocument({ size: "A4", margin: 45 });
        doc.pipe(res);
        drawCabecalho(doc, branding);
        doc.y = 120;
        doc.font("Helvetica-Bold").fontSize(15).text("AUTORIZAÇÃO DE TRANSFERÊNCIA EXTERNA", { align: "center" });
        doc.moveDown(1.4);
        doc.font("Helvetica").fontSize(11);
        doc.text(`Protocolo: ${transferencia.protocolo}`);
        doc.text(`Código de validação: ${transferencia.codigo_validacao}`);
        doc.text(`Aluno: ${transferencia.pessoa_nome} • Matrícula na rede: ${transferencia.id_pessoa || 'N/I'}`);
        doc.text(`Escola de origem: ${transferencia.escola_origem_nome}`);
        doc.text(`Destino: ${transferencia.escola_destino_nome} • ${[transferencia.rede_destino, transferencia.municipio_destino, transferencia.uf_destino].filter(Boolean).join(' / ')}`);
        doc.moveDown(1);
        doc.text(`Responsável: ${transferencia.responsavel_nome || 'Não informado'} • Documento: ${transferencia.responsavel_documento || 'Não informado'}`);
        doc.text(`Motivo: ${transferencia.motivo || 'Não informado'}`, { align: "justify" });
        if (transferencia.observacoes) doc.text(`Observações: ${transferencia.observacoes}`, { align: "justify" });
        doc.moveDown(2);
        doc.text("A transferência somente poderá ser concluída após apresentação deste documento assinado pelo responsável legal, com o código de validação acima.", { align: "justify" });
        doc.moveDown(3);
        doc.text("__________________________________________", { align: "center" });
        doc.text("Responsável legal", { align: "center" });
        drawRodape(doc, branding);
        doc.end();
    } catch (err) {
        console.error("Erro ao gerar autorização de transferência externa:", err);
        return res.status(500).json({ error: "Erro ao gerar autorização de transferência externa." });
    }
});

router.get("/:id/rematriculas/preview", requirePermission('school.dashboard.view'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const tenantId = getTenantId(req);
        const tenantSupport = await getTenantColumnSupport();
        const anoOrigem = parseOptionalInt(req.query?.ano_origem) || new Date().getFullYear();
        const anoDestino = parseOptionalInt(req.query?.ano_destino) || (anoOrigem + 1);
        const useAlunosEscolasTenant = !!(tenantSupport.alunos_escolas && tenantId);
        const params = [];
        let where = '';
        if (useAlunosEscolasTenant) {
            params.push(tenantId);
            where += `ae.tenant_id = $${params.length} AND `;
        }
        params.push(escolaId);
        where += `ae.escola_id = $${params.length}`;
        params.push(anoOrigem);
        const anoOrigemParam = params.length;
        params.push(anoDestino);
        const anoDestinoParam = params.length;
        const proxTenantClause = useAlunosEscolasTenant ? 'AND prox.tenant_id = ae.tenant_id' : '';
        const result = await pool.query(
            `
            SELECT a.id, a.pessoa_nome, a.id_pessoa, ae.turma, ae.ano_letivo
            FROM alunos_escolas ae
            JOIN alunos_municipais a ON a.id = ae.aluno_id
            WHERE ${where}
              AND ae.ano_letivo = $${anoOrigemParam}
              AND COALESCE(ae.status_matricula, 'ATIVO') = 'ATIVO'
              AND NOT EXISTS (
                SELECT 1
                FROM alunos_escolas prox
                WHERE prox.aluno_id = ae.aluno_id
                  AND prox.escola_id = ae.escola_id
                  ${proxTenantClause}
                  AND prox.ano_letivo = $${anoDestinoParam}
              )
            ORDER BY a.pessoa_nome ASC
            `,
            params
        );
        return res.json({ ano_origem: anoOrigem, ano_destino: anoDestino, alunos: result.rows || [] });
    } catch (err) {
        console.error("Erro ao simular rematrículas:", err);
        return res.status(500).json({ error: "Erro ao simular rematrículas." });
    }
});

router.post("/:id/rematriculas/processar", requirePermission('school.students.manage'), async (req, res) => {
    const client = await pool.connect();
    try {
        const escolaId = parseInt(req.params.id, 10);
        const tenantId = getTenantId(req);
        const tenantSupport = await getTenantColumnSupport();
        const anoOrigem = parseOptionalInt(req.body?.ano_origem) || new Date().getFullYear();
        const anoDestino = parseOptionalInt(req.body?.ano_destino) || (anoOrigem + 1);
        const alunoIds = Array.isArray(req.body?.aluno_ids) ? req.body.aluno_ids.map((item) => Number(item)).filter(Number.isFinite) : null;
        await ensureMatriculasHistoricoTable();
        await ensureAlunosEscolasWorkflowColumns();
        const useAlunosEscolasTenant = !!(tenantSupport.alunos_escolas && tenantId);

        await client.query('BEGIN');
        const rowsParams = [];
        let rowsWhere = '';
        if (useAlunosEscolasTenant) {
            rowsParams.push(tenantId);
            rowsWhere += `ae.tenant_id = $${rowsParams.length} AND `;
        }
        rowsParams.push(escolaId);
        rowsWhere += `ae.escola_id = $${rowsParams.length}`;
        rowsParams.push(anoOrigem);
        const anoOrigemParam = rowsParams.length;
        const alunoIdsClause = alunoIds && alunoIds.length ? `AND ae.aluno_id = ANY($${rowsParams.length + 1}::int[])` : '';
        if (alunoIds && alunoIds.length) rowsParams.push(alunoIds);
        const rows = await client.query(
            `
            SELECT ae.aluno_id, ae.turma, a.pessoa_nome
            FROM alunos_escolas ae
            JOIN alunos_municipais a ON a.id = ae.aluno_id
            WHERE ${rowsWhere}
              AND ae.ano_letivo = $${anoOrigemParam}
              AND COALESCE(ae.status_matricula, 'ATIVO') = 'ATIVO'
              ${alunoIdsClause}
            `,
            rowsParams
        );
        let processados = 0;
        for (const row of rows.rows || []) {
            const exists = useAlunosEscolasTenant
                ? await client.query(
                    `SELECT 1 FROM alunos_escolas WHERE tenant_id = $1 AND aluno_id = $2 AND escola_id = $3 AND ano_letivo = $4 LIMIT 1`,
                    [tenantId, row.aluno_id, escolaId, anoDestino]
                )
                : await client.query(
                    `SELECT 1 FROM alunos_escolas WHERE aluno_id = $1 AND escola_id = $2 AND ano_letivo = $3 LIMIT 1`,
                    [row.aluno_id, escolaId, anoDestino]
                );
            if (exists.rowCount) continue;
            if (useAlunosEscolasTenant) {
                await client.query(
                    `
                    INSERT INTO alunos_escolas (tenant_id, aluno_id, escola_id, ano_letivo, turma, status_matricula, data_entrada)
                    VALUES ($1,$2,$3,$4,$5,'ATIVO',NOW())
                    `,
                    [tenantId, row.aluno_id, escolaId, anoDestino, row.turma]
                );
            } else {
                await client.query(
                    `
                    INSERT INTO alunos_escolas (aluno_id, escola_id, ano_letivo, turma, status_matricula, data_entrada)
                    VALUES ($1,$2,$3,$4,'ATIVO',NOW())
                    `,
                    [row.aluno_id, escolaId, anoDestino, row.turma]
                );
            }
            await client.query(
                `
                INSERT INTO alunos_escolas_historico (tenant_id, aluno_id, escola_id, ano_letivo, turma, tipo_evento, status_aluno, detalhes)
                VALUES ($1,$2,$3,$4,$5,'REMATRICULA','ativo',$6::jsonb)
                `,
                [tenantId, row.aluno_id, escolaId, anoDestino, row.turma, JSON.stringify({ ano_origem: anoOrigem, ano_destino: anoDestino })]
            );
            processados += 1;
        }
        await client.query('COMMIT');
        return res.json({ success: true, processados, ano_destino: anoDestino });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error("Erro ao processar rematrículas:", err);
        return res.status(500).json({ error: "Erro ao processar rematrículas." });
    } finally {
        client.release();
    }
});

router.post("/:id/enturmacao/processar", requirePermission('school.students.manage'), async (req, res) => {
    const client = await pool.connect();
    try {
        const escolaId = parseInt(req.params.id, 10);
        const tenantId = getTenantId(req);
        const tenantSupport = await getTenantColumnSupport();
        const anoLetivo = parseOptionalInt(req.body?.ano_letivo);
        const turmaDestino = parseOptionalText(req.body?.turma_destino);
        const alunoIds = Array.isArray(req.body?.aluno_ids) ? req.body.aluno_ids.map((item) => Number(item)).filter(Number.isFinite) : [];
        if (!anoLetivo || !turmaDestino || !alunoIds.length) {
            return res.status(400).json({ error: "ano_letivo, turma_destino e aluno_ids são obrigatórios." });
        }
        await ensureMatriculasHistoricoTable();
        const useAlunosEscolasTenant = !!(tenantSupport.alunos_escolas && tenantId);
        await client.query('BEGIN');
        if (useAlunosEscolasTenant) {
            await client.query(
                `
                UPDATE alunos_escolas
                SET turma = $4,
                    atualizado_em = NOW()
                WHERE tenant_id = $1
                  AND escola_id = $2
                  AND ano_letivo = $3
                  AND aluno_id = ANY($5::int[])
                `,
                [tenantId, escolaId, anoLetivo, turmaDestino, alunoIds]
            );
        } else {
            await client.query(
                `
                UPDATE alunos_escolas
                SET turma = $3,
                    atualizado_em = NOW()
                WHERE escola_id = $1
                  AND ano_letivo = $2
                  AND aluno_id = ANY($4::int[])
                `,
                [escolaId, anoLetivo, turmaDestino, alunoIds]
            );
        }
        await client.query(
            `
            UPDATE alunos_municipais
            SET turma = $2,
                atualizado_em = NOW()
            WHERE id = ANY($1::int[])
              AND ${ (await getColumnSupport()).alunosMunicipaisTenantId ? 'tenant_id = $3' : '1=1' }
            `,
            (await getColumnSupport()).alunosMunicipaisTenantId ? [alunoIds, turmaDestino, tenantId] : [alunoIds, turmaDestino]
        );
        for (const alunoId of alunoIds) {
            await client.query(
                `
                INSERT INTO alunos_escolas_historico (tenant_id, aluno_id, escola_id, ano_letivo, turma, tipo_evento, status_aluno, detalhes)
                VALUES ($1,$2,$3,$4,$5,'ENTURMACAO','ativo',$6::jsonb)
                `,
                [tenantId, alunoId, escolaId, anoLetivo, turmaDestino, JSON.stringify({ turma_destino: turmaDestino })]
            );
        }
        await client.query('COMMIT');
        return res.json({ success: true, enturmados: alunoIds.length, turma_destino: turmaDestino });
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) {}
        console.error("Erro ao processar enturmação:", err);
        return res.status(500).json({ error: "Erro ao processar enturmação." });
    } finally {
        client.release();
    }
});

router.get("/:id/alunos/:alunoId/historico-escolar", requirePermission('school.dashboard.view'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const alunoId = parseInt(req.params.alunoId, 10);
        const tenantId = getTenantId(req);
        const data = await loadHistoricoEscolarData({ escolaId, alunoId, tenantId });
        if (!data) return res.status(404).json({ error: "Aluno não encontrado." });
        return res.json(data);
    } catch (err) {
        console.error("Erro ao carregar histórico escolar:", err);
        return res.status(500).json({ error: "Erro ao carregar histórico escolar." });
    }
});

router.get("/:id/alunos/:alunoId/historico-escolar-pdf", requirePermission('school.documents.emit'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const alunoId = parseInt(req.params.alunoId, 10);
        const tenantId = getTenantId(req);
        const data = await loadHistoricoEscolarData({ escolaId, alunoId, tenantId });
        if (!data) return res.status(404).json({ error: "Aluno não encontrado." });
        const branding = await getBranding(tenantId);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="historico_escolar_${alunoId}.pdf"`);
        const doc = new PDFDocument({ size: "A4", margin: 45 });
        doc.pipe(res);
        drawCabecalho(doc, branding);
        doc.y = 120;
        doc.font("Helvetica-Bold").fontSize(15).text("HISTÓRICO ESCOLAR E MOVIMENTAÇÃO", { align: "center" });
        doc.moveDown();
        doc.font("Helvetica").fontSize(11);
        doc.text(`Aluno: ${data.aluno.pessoa_nome || 'Não informado'}`);
        doc.text(`Matrícula na rede: ${data.aluno.id_pessoa || 'N/I'}`);
        doc.text(`CPF: ${maskCpf(data.aluno.cpf)}`);
        doc.moveDown();
        doc.font("Helvetica-Bold").text("Vínculos escolares");
        doc.font("Helvetica");
        (data.vinculos || []).forEach((item) => {
            doc.text(`• ${item.ano_letivo || 'N/I'} • ${item.escola_nome || 'Escola'} • ${item.turma || 'Sem turma'} • ${item.status_matricula || 'ATIVO'}`);
        });
        doc.moveDown();
        doc.font("Helvetica-Bold").text("Rendimento por disciplina");
        doc.font("Helvetica");
        if ((data.rendimento_disciplinas || []).length) {
            (data.rendimento_disciplinas || []).slice(0, 30).forEach((item) => {
                doc.text(`• ${item.ano_letivo || 'N/I'} • ${item.periodo_letivo || 'Período'} • ${item.disciplina_nome || 'Disciplina'} • Nota ${formatDecimal(item.media)} • Freq. ${formatDecimal(item.frequencia)}% • Faltas ${item.faltas || 0}`);
            });
        } else {
            doc.text('Nenhum lançamento de nota/frequência por disciplina disponível.');
        }
        doc.moveDown();
        doc.font("Helvetica-Bold").text("Linha do tempo");
        doc.font("Helvetica");
        (data.linha_do_tempo || []).slice(0, 18).forEach((item) => {
            doc.text(`• ${formatDatePtBr(item.criado_em)} • ${item.titulo} • ${item.descricao || 'Sem detalhes'}`);
        });
        drawRodape(doc, branding);
        doc.end();
    } catch (err) {
        console.error("Erro ao gerar histórico escolar em PDF:", err);
        return res.status(500).json({ error: "Erro ao gerar histórico escolar em PDF." });
    }
});

router.get("/:id/alunos/:alunoId/declaracao-escolar-pdf", requirePermission('school.documents.emit'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const alunoId = parseInt(req.params.alunoId, 10);
        const tenantId = getTenantId(req);
        const aluno = await loadAlunoMatriculaDetalhes({ escolaId, alunoId, tenantId });
        if (!aluno) return res.status(404).json({ error: "Aluno não encontrado." });
        const branding = await getBranding(tenantId);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="declaracao_escolar_${alunoId}.pdf"`);
        const doc = new PDFDocument({ size: "A4", margin: 45 });
        doc.pipe(res);
        drawCabecalho(doc, branding);
        doc.y = 120;
        doc.font("Helvetica-Bold").fontSize(15).text("DECLARAÇÃO ESCOLAR", { align: "center" });
        doc.moveDown(2);
        doc.font("Helvetica").fontSize(12).text(`Declaramos que ${aluno.pessoa_nome || 'o(a) estudante'}, matrícula ${aluno.id_pessoa || 'N/I'}, está vinculado(a) à unidade ${aluno.escola_nome || aluno.unidade_ensino || 'Não informada'}, no ano letivo ${aluno.ano_letivo || 'N/I'}, turma ${aluno.turma_escola || aluno.turma || 'Não informada'}.`, { align: "justify" });
        doc.moveDown();
        doc.text("A presente declaração é emitida para fins escolares e administrativos.", { align: "justify" });
        drawRodape(doc, branding);
        doc.end();
    } catch (err) {
        console.error("Erro ao gerar declaração escolar:", err);
        return res.status(500).json({ error: "Erro ao gerar declaração escolar." });
    }
});

router.get("/:id/alunos/:alunoId/boletim-pdf", requirePermission('school.documents.emit'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const alunoId = parseInt(req.params.alunoId, 10);
        const tenantId = getTenantId(req);
        const data = await loadHistoricoEscolarData({ escolaId, alunoId, tenantId });
        if (!data) return res.status(404).json({ error: "Aluno não encontrado." });
        const branding = await getBranding(tenantId);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="boletim_${alunoId}.pdf"`);
        const doc = new PDFDocument({ size: "A4", margin: 45 });
        doc.pipe(res);
        drawCabecalho(doc, branding);
        doc.y = 120;
        doc.font("Helvetica-Bold").fontSize(15).text("BOLETIM ESCOLAR", { align: "center" });
        doc.moveDown();
        doc.font("Helvetica").fontSize(11);
        doc.text(`Aluno: ${data.aluno.pessoa_nome || 'Não informado'}`);
        doc.text(`Turma: ${data.aluno.turma_escola || data.aluno.turma || 'Não informada'} • Ano letivo: ${data.aluno.ano_letivo || 'N/I'}`);
        doc.moveDown();
        const rendimento = data.rendimento_disciplinas || [];
        if (rendimento.length) {
            rendimento.slice(0, 30).forEach((item) => {
                doc.text(`${item.periodo_letivo || 'Período'}  |  ${item.disciplina_nome || 'Disciplina'}  |  Nota: ${formatDecimal(item.media)}  |  Frequência: ${formatDecimal(item.frequencia)}%  |  Faltas: ${item.faltas || 0}`);
            });
        } else {
            doc.text('Nenhum lançamento de boletim por disciplina disponível.');
        }
        doc.moveDown();
        doc.text(`Situação atual: ${academicLabel(data.aluno.status, 'Em acompanhamento')}`);
        drawRodape(doc, branding);
        doc.end();
    } catch (err) {
        console.error("Erro ao gerar boletim:", err);
        return res.status(500).json({ error: "Erro ao gerar boletim." });
    }
});

router.get("/:id/documentos/ata-turma-pdf", requirePermission('school.documents.emit'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const tenantId = getTenantId(req);
        const tenantSupport = await getTenantColumnSupport();
        const turma = parseOptionalText(req.query?.turma);
        const anoLetivo = parseOptionalInt(req.query?.ano_letivo);
        if (!turma || !anoLetivo) return res.status(400).json({ error: "turma e ano_letivo são obrigatórios." });
        const useAlunosEscolasTenant = !!(tenantSupport.alunos_escolas && tenantId);
        const ataParams = [];
        let ataWhere = '';
        if (useAlunosEscolasTenant) {
            ataParams.push(tenantId);
            ataWhere += `ae.tenant_id = $${ataParams.length} AND `;
        }
        ataParams.push(escolaId, anoLetivo, turma);
        ataWhere += `ae.escola_id = $${useAlunosEscolasTenant ? 2 : 1}
              AND ae.ano_letivo = $${useAlunosEscolasTenant ? 3 : 2}
              AND ae.turma = $${useAlunosEscolasTenant ? 4 : 3}`;
        const result = await pool.query(
            `
            SELECT a.pessoa_nome, a.id_pessoa, ae.turma, ae.ano_letivo, e.nome AS escola_nome
            FROM alunos_escolas ae
            JOIN alunos_municipais a ON a.id = ae.aluno_id
            JOIN escolas e ON e.id = ae.escola_id
            WHERE ${ataWhere}
              AND COALESCE(ae.status_matricula, 'ATIVO') = 'ATIVO'
            ORDER BY a.pessoa_nome ASC
            `,
            ataParams
        );
        const branding = await getBranding(tenantId);
        res.setHeader("Content-Type", "application/pdf");
        res.setHeader("Content-Disposition", `inline; filename="ata_turma_${anoLetivo}_${turma}.pdf"`);
        const doc = new PDFDocument({ size: "A4", margin: 45 });
        doc.pipe(res);
        drawCabecalho(doc, branding);
        doc.y = 120;
        doc.font("Helvetica-Bold").fontSize(15).text("ATA DA TURMA", { align: "center" });
        doc.moveDown();
        doc.font("Helvetica").fontSize(11);
        doc.text(`Turma: ${turma} • Ano letivo: ${anoLetivo}`);
        doc.text(`Total de estudantes: ${result.rowCount}`);
        doc.moveDown();
        (result.rows || []).forEach((row, index) => {
            doc.text(`${index + 1}. ${row.pessoa_nome || 'Sem nome'} • Matrícula ${row.id_pessoa || 'N/I'}`);
        });
        drawRodape(doc, branding);
        doc.end();
    } catch (err) {
        console.error("Erro ao gerar ata de turma:", err);
        return res.status(500).json({ error: "Erro ao gerar ata de turma." });
    }
});

router.get("/:id/relatorios-academicos", requirePermission('school.dashboard.view'), async (req, res) => {
    try {
        const escolaId = parseInt(req.params.id, 10);
        const tenantId = getTenantId(req);
        const anoLetivo = parseOptionalInt(req.query?.ano_letivo);
        const dashboard = await loadEscolaDashboardData(escolaId, tenantId, { limitAlunos: 1000, anoLetivo });
        const overview = await loadAcademicOverview(escolaId, tenantId, anoLetivo);
        if (!dashboard) return res.status(404).json({ error: "Escola não encontrada." });
        await ensureAcademicMaturityTables();
        const alunos = Array.isArray(dashboard.alunos) ? dashboard.alunos : [];
        const [notas, conselhos, fechamentos] = await Promise.all([
            pool.query(
                `
                SELECT periodo_letivo, disciplina_nome, nota, frequencia, faltas, turma
                FROM escola_avaliacoes_componentes
                WHERE tenant_id = $1
                  AND escola_id = $2
                  ${anoLetivo ? 'AND ano_letivo = $3' : ''}
                `,
                anoLetivo ? [tenantId, escolaId, anoLetivo] : [tenantId, escolaId]
            ),
            pool.query(
                `
                SELECT turma, periodo_letivo, status, data_reuniao
                FROM escola_conselho_classe
                WHERE tenant_id = $1
                  AND escola_id = $2
                  ${anoLetivo ? 'AND ano_letivo = $3' : ''}
                ORDER BY data_reuniao DESC NULLS LAST
                `,
                anoLetivo ? [tenantId, escolaId, anoLetivo] : [tenantId, escolaId]
            ),
            pool.query(
                `
                SELECT turma, periodo_letivo, status, total_alunos, total_aprovados, total_reprovados, total_transferidos, total_abandono
                FROM escola_fechamentos_periodo
                WHERE tenant_id = $1
                  AND escola_id = $2
                  ${anoLetivo ? 'AND ano_letivo = $3' : ''}
                ORDER BY periodo_letivo ASC
                `,
                anoLetivo ? [tenantId, escolaId, anoLetivo] : [tenantId, escolaId]
            ),
        ]);
        const porTurma = Object.entries(alunos.reduce((acc, aluno) => {
            const key = academicLabel(aluno.turma_escola || aluno.turma);
            acc[key] = acc[key] || { turma: key, total: 0, transporte: 0, deficiencia: 0 };
            acc[key].total += 1;
            if (aluno.transporte_apto) acc[key].transporte += 1;
            if (parseOptionalText(aluno.deficiencia)) acc[key].deficiencia += 1;
            return acc;
        }, {})).map(([, value]) => value).sort((a, b) => b.total - a.total);
        const rendimentoPorDisciplina = Object.values((notas.rows || []).reduce((acc, item) => {
            const key = academicLabel(item.disciplina_nome);
            acc[key] = acc[key] || { disciplina: key, total_lancamentos: 0, media_notas: [], media_frequencia: [], faltas: 0 };
            acc[key].total_lancamentos += 1;
            if (item.nota !== null && item.nota !== undefined) acc[key].media_notas.push(Number(item.nota));
            if (item.frequencia !== null && item.frequencia !== undefined) acc[key].media_frequencia.push(Number(item.frequencia));
            acc[key].faltas += Number(item.faltas || 0);
            return acc;
        }, {})).map((item) => ({
            disciplina: item.disciplina,
            total_lancamentos: item.total_lancamentos,
            media_nota: item.media_notas.length ? Number((item.media_notas.reduce((a, b) => a + b, 0) / item.media_notas.length).toFixed(2)) : null,
            media_frequencia: item.media_frequencia.length ? Number((item.media_frequencia.reduce((a, b) => a + b, 0) / item.media_frequencia.length).toFixed(2)) : null,
            faltas: item.faltas,
        })).sort((a, b) => (b.total_lancamentos - a.total_lancamentos));
        return res.json({
            escola: dashboard.escola,
            filtros: { ano_letivo: anoLetivo },
            overview,
            por_turma: porTurma,
            rendimento_por_disciplina: rendimentoPorDisciplina,
            conselhos: conselhos.rows || [],
            fechamentos: fechamentos.rows || [],
            distribuicoes: {
                etapas: alunos.reduce((acc, aluno) => {
                    const key = academicLabel(aluno.etapa);
                    acc[key] = (acc[key] || 0) + 1;
                    return acc;
                }, {}),
                status: alunos.reduce((acc, aluno) => {
                    const key = academicLabel(aluno.status);
                    acc[key] = (acc[key] || 0) + 1;
                    return acc;
                }, {}),
            },
        });
    } catch (err) {
        console.error("Erro ao gerar relatórios acadêmicos:", err);
        return res.status(500).json({ error: "Erro ao gerar relatórios acadêmicos." });
    }
});

router.post("/:id/transporte/rota-pedestre", requirePermission('school.transport.manage'), async (req, res) => {
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
        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_TRANSPORT_ROUTE_SIMULATED',
            targetType: 'transporte',
            targetId: escolaId,
            description: 'Trajeto pedestre calculado para transporte escolar.',
            metadata: { escola_id: escolaId, origem, destino, distancia_metros: trajeto?.distanceMeters || null }
        });
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

router.post("/", requirePermission('school.students.manage'), async (req, res) => {
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
        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_CREATED',
            targetType: 'escola',
            targetId: escolaId,
            description: 'Escola criada.',
            metadata: { escola_id: escolaId, nome, codigo_inep }
        });
        return res.json({ id: escolaId, message: "Escola criada com sucesso" });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro ao criar escola:", err);
        return res.status(500).json({ error: "Erro ao criar escola" });
    } finally {
        client.release();
    }
});

router.put("/:id", requirePermission('school.students.manage'), async (req, res) => {
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
        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_UPDATED',
            targetType: 'escola',
            targetId: id,
            description: 'Escola atualizada.',
            metadata: { escola_id: id, nome, codigo_inep }
        });
        return res.json({ message: "Escola atualizada com sucesso" });
    } catch (err) {
        try { await client.query("ROLLBACK"); } catch (_) { }
        console.error("Erro ao atualizar escola:", err);
        return res.status(500).json({ error: "Erro ao atualizar escola" });
    } finally {
        client.release();
    }
});

router.delete("/:id", requirePermission('school.students.manage'), async (req, res) => {
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
        await registrarSegurancaEscolar(req, {
            action: 'SCHOOL_DELETED',
            targetType: 'escola',
            targetId: id,
            description: 'Escola excluída.',
            metadata: { escola_id: id }
        });
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
