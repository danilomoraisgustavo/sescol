BEGIN;

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
);

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
);

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
);

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
);

DO $$
DECLARE
    v_tenant_id BIGINT := 1;
    v_next_id_pessoa BIGINT;
    v_school_ids INTEGER[] := ARRAY[]::INTEGER[];
    v_school_names TEXT[] := ARRAY[
        'EMEF DEMO RIO VERDE',
        'EMEF DEMO SERRA AZUL',
        'EMEF DEMO VALE DO SOL',
        'EMEF DEMO JARDIM DAS PALMEIRAS',
        'EMEF DEMO BOSQUE CENTRAL'
    ];
    v_school_inep TEXT[] := ARRAY[
        '440000101',
        '440000102',
        '440000103',
        '440000104',
        '440000105'
    ];
    v_school_bairros TEXT[] := ARRAY[
        'Centro Demo',
        'Setor Norte Demo',
        'Setor Sul Demo',
        'Jardim Escolar Demo',
        'Bosque Demo'
    ];
    v_school_lats NUMERIC[] := ARRAY[-6.02210, -6.02840, -6.01780, -6.01230, -6.03010];
    v_school_lngs NUMERIC[] := ARRAY[-49.90320, -49.89540, -49.88810, -49.91070, -49.88290];
    v_turmas TEXT[] := ARRAY['1 ANO A', '2 ANO A', '3 ANO A', '4 ANO A'];
    i INTEGER;
    j INTEGER;
    v_school_id INTEGER;
    v_aluno_id INTEGER;
    v_nome TEXT;
    v_cpf TEXT;
    v_turma TEXT;
    v_turno TEXT;
    v_etapa TEXT;
    v_modalidade TEXT;
    v_origin_school_id INTEGER;
    v_origin_school_name TEXT;
    v_current_school_name TEXT;
    v_transferiu BOOLEAN;
    v_lat NUMERIC;
    v_lng NUMERIC;
    v_protocol TEXT;
BEGIN
    DELETE FROM auditoria_operacoes_escolares
    WHERE detalhes::text ILIKE '%ALUNO DEMO %'
       OR detalhes::text ILIKE '%EMEF DEMO %';

    DELETE FROM alunos_transferencias_internas
    WHERE aluno_id IN (
        SELECT id FROM alunos_municipais WHERE pessoa_nome LIKE 'ALUNO DEMO %'
    );

    DELETE FROM alunos_escolas_historico
    WHERE aluno_id IN (
        SELECT id FROM alunos_municipais WHERE pessoa_nome LIKE 'ALUNO DEMO %'
    );

    DELETE FROM alunos_escolas
    WHERE aluno_id IN (
        SELECT id FROM alunos_municipais WHERE pessoa_nome LIKE 'ALUNO DEMO %'
    );

    DELETE FROM escola_turmas
    WHERE escola_id IN (
        SELECT id FROM escolas WHERE nome LIKE 'EMEF DEMO %'
    );

    DELETE FROM alunos_municipais
    WHERE pessoa_nome LIKE 'ALUNO DEMO %';

    DELETE FROM escolas
    WHERE nome LIKE 'EMEF DEMO %';

    FOR i IN 1..array_length(v_school_names, 1) LOOP
        INSERT INTO escolas (
            nome, codigo_inep, logradouro, numero, complemento, referencia, bairro, cep, localizacao,
            ensino_regime, ensino_nivel, ensino_horario, criado_em, atualizado_em
        ) VALUES (
            v_school_names[i],
            v_school_inep[i],
            'Avenida Escolar Demo ' || i,
            (100 + i)::TEXT,
            'Bloco ' || chr(64 + i),
            'Próximo à praça demo ' || i,
            v_school_bairros[i],
            '685' || lpad((10 + i)::TEXT, 5, '0'),
            ST_SetSRID(ST_MakePoint(v_school_lngs[i], v_school_lats[i]), 4326),
            ARRAY['regular'],
            ARRAY['fundamental','fundamental_anos_iniciais','fundamental_anos_finais'],
            ARRAY['manha','tarde'],
            NOW(),
            NOW()
        )
        RETURNING id INTO v_school_id;

        v_school_ids := array_append(v_school_ids, v_school_id);

        FOR j IN 1..array_length(v_turmas, 1) LOOP
            INSERT INTO escola_turmas (
                tenant_id, escola_id, nome, ano_letivo, turno, tipo_turma, organizacao_pedagogica,
                etapa, modalidade, multisseriada, series_abrangidas, dias_semana,
                horario_inicio, horario_fim, capacidade, limite_planejado_alunos,
                total_estudantes_publico_ee, limite_estudantes_publico_ee, professor_referencia,
                sala, observacoes, ativo, criado_em, atualizado_em
            ) VALUES (
                v_tenant_id,
                v_school_id,
                v_turmas[j],
                2026,
                CASE WHEN j % 2 = 0 THEN 'tarde' ELSE 'manha' END,
                'regular',
                'seriada',
                'Ensino Fundamental',
                'regular',
                FALSE,
                ARRAY[(j)::TEXT || 'º ano'],
                ARRAY['segunda','terca','quarta','quinta','sexta'],
                CASE WHEN j % 2 = 0 THEN '13:00' ELSE '07:00' END,
                CASE WHEN j % 2 = 0 THEN '17:00' ELSE '11:00' END,
                35,
                32,
                2,
                4,
                'Professor Demo ' || i || '-' || j,
                'Sala ' || j,
                'Turma gerada para demonstração.',
                TRUE,
                NOW(),
                NOW()
            );
        END LOOP;
    END LOOP;

    SELECT COALESCE(MAX(id_pessoa::BIGINT), 0) + 1
    INTO v_next_id_pessoa
    FROM alunos_municipais
    WHERE id_pessoa::TEXT ~ '^[0-9]+$';

    FOR i IN 1..array_length(v_school_ids, 1) LOOP
        v_current_school_name := v_school_names[i];

        FOR j IN 1..100 LOOP
            v_nome := format('ALUNO DEMO %s-%s', lpad(i::TEXT, 2, '0'), lpad(j::TEXT, 3, '0'));
            v_cpf := lpad((90000000000 + ((i - 1) * 100 + j))::TEXT, 11, '0');
            v_turma := v_turmas[((j - 1) % array_length(v_turmas, 1)) + 1];
            v_turno := CASE WHEN ((j - 1) % 2) = 0 THEN 'manha' ELSE 'tarde' END;
            v_etapa := 'Ensino Fundamental';
            v_modalidade := 'regular';
            v_transferiu := (j % 3 = 0 OR j % 5 = 0);

            IF v_transferiu THEN
                v_origin_school_id := v_school_ids[((i) % array_length(v_school_ids, 1)) + 1];
                v_origin_school_name := v_school_names[((i) % array_length(v_school_names, 1)) + 1];
            ELSE
                v_origin_school_id := v_school_ids[i];
                v_origin_school_name := v_school_names[i];
            END IF;

            v_lat := v_school_lats[i] + ((j % 10) * 0.00035);
            v_lng := v_school_lngs[i] + ((j % 7) * 0.00029);

            INSERT INTO alunos_municipais (
                unidade_ensino, ano, turma, modalidade, formato_letivo, etapa, status,
                cpf, pessoa_nome, data_nascimento, sexo, codigo_inep, data_matricula, id_pessoa,
                cep, rua, numero_pessoa_endereco, bairro, zona, filiacao_1, telefone_filiacao_1,
                filiacao_2, telefone_filiacao_2, responsavel, telefone_responsavel, deficiencia,
                transporte_escolar_publico_utiliza, transporte_apto, localizacao, criado_em, atualizado_em
            ) VALUES (
                v_current_school_name,
                (((j - 1) % 9) + 1)::TEXT || 'º ano',
                v_turma,
                v_modalidade,
                v_turno,
                v_etapa,
                'ativo',
                v_cpf,
                v_nome,
                DATE '2014-01-01' + (((i - 1) * 100 + j) % 2200),
                CASE WHEN (j % 2) = 0 THEN 'F' ELSE 'M' END,
                v_school_inep[i],
                DATE '2026-01-15' + (j % 20),
                v_next_id_pessoa,
                '685' || lpad((100 + j)::TEXT, 5, '0'),
                'Rua do Aluno Demo ' || j,
                (j)::TEXT,
                'Bairro Demo ' || ((j % 8) + 1),
                CASE WHEN (j % 4) = 0 THEN 'rural' ELSE 'urbana' END,
                'Responsável Demo ' || j,
                '(94) 991' || lpad((1000 + j)::TEXT, 4, '0'),
                'Filiação 2 Demo ' || j,
                '(94) 992' || lpad((1000 + j)::TEXT, 4, '0'),
                'Responsável Demo ' || j,
                '(94) 993' || lpad((1000 + j)::TEXT, 4, '0'),
                CASE WHEN (j % 12) = 0 THEN 'Deficiência intelectual leve' ELSE NULL END,
                CASE WHEN (j % 4) = 0 THEN 'municipal' ELSE NULL END,
                CASE WHEN (j % 4) = 0 THEN TRUE ELSE FALSE END,
                ST_SetSRID(ST_MakePoint(v_lng, v_lat), 4326),
                NOW() - ((100 - j) || ' days')::INTERVAL,
                NOW() - ((100 - j) || ' days')::INTERVAL
            )
            RETURNING id INTO v_aluno_id;

            INSERT INTO alunos_escolas (
                aluno_id, escola_id, ano_letivo, turma, criado_em, atualizado_em
            ) VALUES (
                v_aluno_id, v_school_ids[i], 2026, v_turma, NOW() - ((80 - j % 30) || ' days')::INTERVAL, NOW()
            );

            INSERT INTO alunos_escolas_historico (
                tenant_id, aluno_id, escola_id, escola_destino_id, ano_letivo,
                turma, turma_destino, tipo_evento, status_aluno, detalhes, criado_em
            ) VALUES (
                v_tenant_id,
                v_aluno_id,
                v_origin_school_id,
                CASE WHEN v_transferiu THEN v_school_ids[i] ELSE v_origin_school_id END,
                2025,
                v_turma,
                v_turma,
                'MATRICULA',
                'ativo',
                jsonb_build_object(
                    'origem', 'seed_demo',
                    'escola_origem_nome', v_origin_school_name,
                    'escola_destino_nome', CASE WHEN v_transferiu THEN v_current_school_name ELSE v_origin_school_name END
                ),
                NOW() - INTERVAL '360 days' - ((j % 15) || ' days')::INTERVAL
            );

            IF v_transferiu THEN
                INSERT INTO alunos_escolas_historico (
                    tenant_id, aluno_id, escola_id, escola_destino_id, ano_letivo,
                    turma, turma_destino, tipo_evento, status_aluno, detalhes, criado_em
                ) VALUES
                (
                    v_tenant_id,
                    v_aluno_id,
                    v_origin_school_id,
                    v_school_ids[i],
                    2026,
                    v_turma,
                    v_turma,
                    'TRANSFERENCIA_SAIDA',
                    'transferido',
                    jsonb_build_object(
                        'origem', 'seed_demo',
                        'motivo', 'Reorganização da rede escolar',
                        'escola_origem_nome', v_origin_school_name,
                        'escola_destino_nome', v_current_school_name
                    ),
                    NOW() - INTERVAL '60 days' - ((j % 10) || ' days')::INTERVAL
                ),
                (
                    v_tenant_id,
                    v_aluno_id,
                    v_origin_school_id,
                    v_school_ids[i],
                    2026,
                    v_turma,
                    v_turma,
                    'TRANSFERENCIA_ENTRADA',
                    'ativo',
                    jsonb_build_object(
                        'origem', 'seed_demo',
                        'motivo', 'Reorganização da rede escolar',
                        'escola_origem_nome', v_origin_school_name,
                        'escola_destino_nome', v_current_school_name
                    ),
                    NOW() - INTERVAL '58 days' - ((j % 10) || ' days')::INTERVAL
                );

                v_protocol := format('TRI-2026-%s', lpad(v_aluno_id::TEXT, 6, '0'));
                INSERT INTO alunos_transferencias_internas (
                    tenant_id, aluno_id, escola_origem_id, escola_destino_id, ano_letivo,
                    turma_origem, turma_destino, status, motivo, observacoes, protocolo,
                    responsavel_nome, responsavel_documento, responsavel_parentesco,
                    responsavel_telefone, responsavel_email, autorizacao_assinada,
                    solicitado_por_usuario_id, concluido_por_usuario_id, autorizado_em, concluido_em,
                    criado_em, atualizado_em
                ) VALUES (
                    v_tenant_id,
                    v_aluno_id,
                    v_origin_school_id,
                    v_school_ids[i],
                    2026,
                    v_turma,
                    v_turma,
                    'CONCLUIDA',
                    'Reorganização da rede escolar',
                    'Transferência interna criada para demonstração.',
                    v_protocol,
                    'Responsável Demo ' || j,
                    v_cpf,
                    'Responsável legal',
                    '(94) 993' || lpad((1000 + j)::TEXT, 4, '0'),
                    'responsavel' || v_aluno_id || '@demo.local',
                    TRUE,
                    1,
                    1,
                    NOW() - INTERVAL '61 days',
                    NOW() - INTERVAL '57 days',
                    NOW() - INTERVAL '62 days',
                    NOW() - INTERVAL '57 days'
                );

                INSERT INTO auditoria_operacoes_escolares (
                    tenant_id, usuario_id, usuario_nome, usuario_email, modulo, entidade,
                    entidade_id, acao, origem, detalhes, criado_em
                ) VALUES
                (
                    v_tenant_id,
                    1,
                    'Administrador Teste',
                    'admin@teste.setrane.com.br',
                    'escola',
                    'aluno_transferencia_interna',
                    v_aluno_id::TEXT,
                    'TRANSFERENCIA_INTERNA_SOLICITADA',
                    'seed_demo',
                    jsonb_build_object(
                        'aluno_id', v_aluno_id,
                        'aluno_nome', v_nome,
                        'escola_origem_id', v_origin_school_id,
                        'escola_destino_id', v_school_ids[i],
                        'protocolo', v_protocol
                    ),
                    NOW() - INTERVAL '62 days'
                ),
                (
                    v_tenant_id,
                    1,
                    'Administrador Teste',
                    'admin@teste.setrane.com.br',
                    'escola',
                    'aluno_transferencia_interna',
                    v_aluno_id::TEXT,
                    'TRANSFERENCIA_INTERNA_CONCLUIDA',
                    'seed_demo',
                    jsonb_build_object(
                        'aluno_id', v_aluno_id,
                        'aluno_nome', v_nome,
                        'escola_origem_id', v_origin_school_id,
                        'escola_destino_id', v_school_ids[i],
                        'protocolo', v_protocol
                    ),
                    NOW() - INTERVAL '57 days'
                );
            ELSE
                INSERT INTO alunos_escolas_historico (
                    tenant_id, aluno_id, escola_id, escola_destino_id, ano_letivo,
                    turma, turma_destino, tipo_evento, status_aluno, detalhes, criado_em
                ) VALUES (
                    v_tenant_id,
                    v_aluno_id,
                    v_school_ids[i],
                    v_school_ids[i],
                    2026,
                    v_turma,
                    v_turma,
                    'ATUALIZACAO_MATRICULA',
                    'ativo',
                    jsonb_build_object(
                        'origem', 'seed_demo',
                        'observacao', 'Matrícula mantida na mesma escola para demonstração'
                    ),
                    NOW() - INTERVAL '45 days' - ((j % 12) || ' days')::INTERVAL
                );
            END IF;

            v_next_id_pessoa := v_next_id_pessoa + 1;
        END LOOP;
    END LOOP;
END $$;

COMMIT;
