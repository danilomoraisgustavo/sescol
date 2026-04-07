-- =========================================================
-- 1. EXTENSÕES
-- =========================================================

-- Ativar PostGIS (se ainda não estiver ativo)
CREATE EXTENSION IF NOT EXISTS postgis;

-- =========================================================
-- TENANTS (EMPRESAS / INSTITUIÇÕES)
-- =========================================================

CREATE TABLE IF NOT EXISTS tenants (
    id              BIGSERIAL PRIMARY KEY,
    nome            TEXT NOT NULL,
    documento       VARCHAR(20), -- CNPJ/CPF (opcional)
    email           TEXT,
    telefone        TEXT,
    ativo           BOOLEAN NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (documento)
);


-- =========================================================
-- USUÁRIOS
-- =========================================================
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'cargo_usuario') THEN
        CREATE TYPE cargo_usuario AS ENUM ('ADMIN', 'GESTOR', 'USUARIO');
    END IF;
END $$;

CREATE TABLE IF NOT EXISTS usuarios (
    id              BIGSERIAL PRIMARY KEY,
    tenant_id       BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,

    nome            TEXT NOT NULL,
    email           TEXT NOT NULL,
    telefone        TEXT,

    -- senha hash (bcrypt/argon2) - nunca salvar senha em texto puro
    senha_hash      TEXT NOT NULL,

    cargo           cargo_usuario NOT NULL DEFAULT 'USUARIO',
    init            BOOLEAN NOT NULL DEFAULT FALSE,
    ativo           BOOLEAN NOT NULL DEFAULT TRUE,

    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    UNIQUE (tenant_id, email)
);

CREATE INDEX IF NOT EXISTS idx_usuarios_tenant
    ON usuarios (tenant_id);

CREATE INDEX IF NOT EXISTS idx_usuarios_email
    ON usuarios (email);
-- =========================================================
-- 2. ZONEAMENTOS E GEOMETRIAS BÁSICAS
-- =========================================================

CREATE TABLE zoneamentos (
    id              SERIAL PRIMARY KEY,
    nome            TEXT NOT NULL,
    tipo_zona       VARCHAR(10) NOT NULL
        CHECK (tipo_zona IN ('urbana', 'rural')),
    tipo_geometria  VARCHAR(10) NOT NULL
        CHECK (tipo_geometria IN ('polygon', 'line')),
    geom            geometry(GEOMETRY, 4326) NOT NULL,
    created_at      TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    updated_at      TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Índice espacial de zoneamentos
CREATE INDEX idx_zoneamentos_geom
    ON zoneamentos
    USING GIST (geom);


-- =========================================================
-- 3. ESCOLAS E RELAÇÃO COM ZONEAMENTOS
-- =========================================================

CREATE TABLE escolas (
    id              SERIAL PRIMARY KEY,
    nome            TEXT NOT NULL,
    codigo_inep     VARCHAR(15) NOT NULL,
    logradouro      TEXT NOT NULL,
    numero          TEXT NOT NULL,
    complemento     TEXT,
    referencia      TEXT,
    bairro          TEXT NOT NULL,
    cep             VARCHAR(9) NOT NULL,

    -- Localização geográfica
    localizacao     GEOMETRY(Point, 4326) NOT NULL,

    -- Regime de ensino (Regular, EJA, Profissionalizante, Especial)
    ensino_regime   TEXT[] DEFAULT '{}',

    -- Nível de ensino (Infantil, Fundamental, Médio, Superior)
    ensino_nivel    TEXT[] DEFAULT '{}',

    -- Horários (Manhã, Tarde, Noite)
    ensino_horario  TEXT[] DEFAULT '{}',

    -- Datas
    criado_em       TIMESTAMP DEFAULT NOW(),
    atualizado_em   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_escolas_localizacao_gist
    ON escolas
    USING GIST (localizacao);


CREATE TABLE escola_zoneamento (
    id             SERIAL PRIMARY KEY,
    escola_id      INT REFERENCES escolas(id) ON DELETE CASCADE,
    zoneamento_id  INT REFERENCES zoneamentos(id) ON DELETE CASCADE
);

CREATE INDEX idx_escola_zoneamento_escola
    ON escola_zoneamento (escola_id);

CREATE INDEX idx_escola_zoneamento_zoneamento
    ON escola_zoneamento (zoneamento_id);


-- =========================================================
-- 4. PONTOS DE PARADA E RELAÇÃO COM ZONEAMENTOS
-- =========================================================

CREATE TABLE pontos_parada (
    id              SERIAL PRIMARY KEY,

    -- Urbana ou rural
    area            VARCHAR(10)
        CHECK (area IN ('urbana', 'rural')),

    -- Endereço
    logradouro      TEXT NOT NULL,
    numero          TEXT NOT NULL,
    complemento     TEXT,
    referencia      TEXT,
    bairro          TEXT NOT NULL,
    cep             VARCHAR(9) NOT NULL,

    -- Geolocalização
    localizacao     GEOMETRY(Point, 4326) NOT NULL,

    -- Zoneamento associado
    zoneamento_id   INT REFERENCES zoneamentos(id),

    -- Status do ponto
    status          VARCHAR(10) NOT NULL DEFAULT 'ativo'
        CHECK (status IN ('ativo', 'inativo')),

    -- Auditoria
    criado_em       TIMESTAMP DEFAULT NOW(),
    atualizado_em   TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_pontos_parada_localizacao_gist
    ON pontos_parada
    USING GIST (localizacao);


-- Tabela de associação pontos-zoneamentos (histórico/relacionamentos ricos)
CREATE TABLE IF NOT EXISTS pontos_zoneamentos (
    id            BIGSERIAL PRIMARY KEY,
    ponto_id      BIGINT NOT NULL REFERENCES pontos_parada(id) ON DELETE CASCADE,
    zoneamento_id BIGINT NOT NULL REFERENCES zoneamentos(id) ON DELETE CASCADE,
    tipo_relacao  VARCHAR(30) NOT NULL,      -- 'poligono', 'linha_proxima', etc.
    distancia_m   DOUBLE PRECISION DEFAULT 0,
    criado_em     TIMESTAMPTZ DEFAULT NOW()
);

-- Opcional: garante que não haja duplicidade da mesma relação
CREATE UNIQUE INDEX IF NOT EXISTS ux_pontos_zoneamentos_ponto_zoneamento_tipo
    ON pontos_zoneamentos (ponto_id, zoneamento_id, tipo_relacao);


-- =========================================================
-- 5. ALUNOS (REDE MUNICIPAL, PONTOS E REAVALIAÇÕES)
-- =========================================================

-- Tabela principal de alunos importados da rede municipal
CREATE TABLE alunos_municipais (
    id                          SERIAL PRIMARY KEY,

    unidade_ensino              TEXT,
    ano                         TEXT,
    turma                       TEXT,
    modalidade                  TEXT,
    formato_letivo              TEXT,
    etapa                       TEXT,
    status                      TEXT,

    cpf                         VARCHAR(14),
    pessoa_nome                 TEXT NOT NULL,
    data_nascimento             DATE,
    sexo                        VARCHAR(10),

    codigo_inep                 VARCHAR(15),
    data_matricula              DATE,
    id_pessoa                   BIGINT,

    cep                         VARCHAR(9),
    rua                         TEXT,
    numero_pessoa_endereco      TEXT,
    bairro                      TEXT,
    zona                        TEXT,

    filiacao_1                  TEXT,
    telefone_filiacao_1         TEXT,
    filiacao_2                  TEXT,
    telefone_filiacao_2         TEXT,

    responsavel                 TEXT,
    telefone_responsavel        TEXT,

    deficiencia                 TEXT,
    transporte_escolar_publico_utiliza TEXT,

    transporte_apto             BOOLEAN NOT NULL DEFAULT FALSE,
    localizacao                 GEOMETRY(Point, 4326),

    criado_em                   TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    atualizado_em               TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);


-- Tabela de relação aluno-escola
CREATE TABLE alunos_escolas (
    id              SERIAL PRIMARY KEY,
    aluno_id        INTEGER NOT NULL REFERENCES alunos_municipais(id) ON DELETE CASCADE,
    escola_id       INTEGER NOT NULL REFERENCES escolas(id) ON DELETE RESTRICT,

    ano_letivo      INTEGER,
    turma           TEXT,

    criado_em       TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    atualizado_em   TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),

    UNIQUE (aluno_id, escola_id, ano_letivo)
);


-- Associação aluno-ponto de parada principal
CREATE TABLE alunos_pontos (
    aluno_id      INTEGER PRIMARY KEY,
    ponto_id      INTEGER NOT NULL,
    associado_em  TIMESTAMP DEFAULT NOW(),
    FOREIGN KEY (aluno_id) REFERENCES alunos_municipais(id) ON DELETE CASCADE,
    FOREIGN KEY (ponto_id) REFERENCES pontos_parada(id) ON DELETE CASCADE
);


-- Registro de reavaliações de distância / risco para alunos
CREATE TABLE IF NOT EXISTS alunos_reavaliacoes (
    id                BIGSERIAL PRIMARY KEY,
    aluno_id          INTEGER NOT NULL REFERENCES alunos_municipais(id) ON DELETE CASCADE,
    distancia_km      NUMERIC(10,4) NOT NULL,
    resultado_primario TEXT NOT NULL,
    detalhe_primario   TEXT NOT NULL,
    latitude          DOUBLE PRECISION NOT NULL,
    longitude         DOUBLE PRECISION NOT NULL,
    riscos            TEXT[] DEFAULT '{}',
    zoneamento_status VARCHAR(20),
    observacao_extra  TEXT,
    criado_em         TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_alunos_reavaliacoes_aluno
    ON alunos_reavaliacoes (aluno_id, criado_em DESC);


-- =========================================================
-- 6. MOTORISTAS E CURSOS OBRIGATÓRIOS
-- =========================================================

-- Tabela principal de motoristas
CREATE TABLE motoristas (
    id                  SERIAL PRIMARY KEY,
    nome                VARCHAR(150) NOT NULL,
    cpf                 VARCHAR(14)  NOT NULL UNIQUE,  -- definir padrão (com máscara ou só dígitos)
    rg                  VARCHAR(20),
    data_nascimento     DATE,
    telefone            VARCHAR(20),
    email               VARCHAR(150),

    endereco            VARCHAR(255),
    bairro              VARCHAR(100),
    cidade              VARCHAR(100),
    uf                  CHAR(2),
    cep                 VARCHAR(9),

    numero_cnh          VARCHAR(20) NOT NULL UNIQUE,
    categoria_cnh       VARCHAR(5)  NOT NULL,
    validade_cnh        DATE        NOT NULL,
    orgao_emissor_cnh   VARCHAR(20),
    arquivo_cnh_path    TEXT,

    status              VARCHAR(10) NOT NULL DEFAULT 'ativo'
        CHECK (status IN ('ativo', 'inativo')),

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- Tabela de cursos obrigatórios / complementares do motorista
CREATE TABLE motoristas_cursos (
    id               SERIAL PRIMARY KEY,
    motorista_id     INTEGER NOT NULL REFERENCES motoristas(id) ON DELETE CASCADE,
    tipo             VARCHAR(50) NOT NULL,  -- transporte_escolar, direcao_defensiva, etc.
    data_conclusao   DATE,
    validade         DATE,
    observacoes      TEXT,
    arquivo_path     TEXT,                  -- caminho do arquivo salvo no servidor (certificado)

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_motoristas_cursos_motorista_id
    ON motoristas_cursos (motorista_id);


-- =========================================================
-- 6. MONITORES E CURSOS OBRIGATÓRIOS
-- =========================================================

-- Tabela principal de monitores
CREATE TABLE monitores (
    id                   SERIAL PRIMARY KEY,
    nome                 VARCHAR(200) NOT NULL,
    cpf                  VARCHAR(20)  NOT NULL,
    rg                   VARCHAR(50),
    data_nascimento      DATE,
    telefone             VARCHAR(50),
    email                VARCHAR(200),
    endereco             VARCHAR(255),
    bairro               VARCHAR(120),
    cidade               VARCHAR(120),
    uf                   VARCHAR(2),
    cep                  VARCHAR(20),

    status               VARCHAR(20) NOT NULL DEFAULT 'ativo',

    documento_pessoal_path TEXT,  -- caminho do documento (RG/CPF, etc.)

    created_at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Cursos dos monitores (curso obrigatório de "monitor escolar")
CREATE TABLE monitores_cursos (
    id               SERIAL PRIMARY KEY,
    monitor_id       INTEGER NOT NULL REFERENCES monitores(id) ON DELETE CASCADE,
    tipo             VARCHAR(50) NOT NULL,  -- monitor_escolar, outro
    data_conclusao   DATE,
    validade         DATE,
    observacoes      TEXT,
    arquivo_path     TEXT,                  -- caminho do certificado

    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);


-- =========================================================
-- 6. VEÍCULOS E DOCUMENTOS OBRIGATÓRIOS
-- =========================================================
-- Tabela de veículos
CREATE TABLE veiculos (
    id                  SERIAL PRIMARY KEY,
    placa               VARCHAR(10)  NOT NULL UNIQUE,
    prefixo             VARCHAR(50),          -- código interno, ex: "ONIBUS 01"
    renavam             VARCHAR(20),
    marca               VARCHAR(120),
    modelo              VARCHAR(120),
    ano_fabricacao      INTEGER,
    ano_modelo          INTEGER,
    capacidade_lotacao  INTEGER      NOT NULL,  -- lotação principal

    tipo_combustivel    VARCHAR(50),           -- diesel, gasolina, flex, etc.
    status              VARCHAR(20) NOT NULL DEFAULT 'ativo',

    -- Documento do veículo (CRLV ou similar)
    documento_path      TEXT,
    documento_validade  DATE,

    -- Alvará de transporte (validade típica de 6 meses)
    alvara_path         TEXT,
    alvara_validade     DATE,

    created_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- =========================================================
-- 6. FORNECEDORES
-- =========================================================

CREATE TABLE fornecedores (
    id                      BIGSERIAL PRIMARY KEY,
    razao_social            TEXT        NOT NULL,
    nome_fantasia           TEXT,
    cnpj                    VARCHAR(18) NOT NULL, -- 00.000.000/0000-00
    telefone                VARCHAR(20),
    email                   TEXT,
    responsavel             TEXT,
    status                  VARCHAR(20) NOT NULL DEFAULT 'ativo',
    inscricao_municipal     TEXT,

    -- endereço da garagem
    logradouro_garagem      TEXT        NOT NULL,
    numero_garagem          TEXT        NOT NULL,
    complemento_garagem     TEXT,
    bairro_garagem          TEXT        NOT NULL,
    cidade_garagem          TEXT        NOT NULL,
    cep_garagem             VARCHAR(9)  NOT NULL,
    referencia_garagem      TEXT,

    -- localização geográfica da garagem (WGS84)
    garagem_localizacao     geometry(Point, 4326) NOT NULL,

    created_at              TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at              TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- CNPJ único (ajuste se tiver casos especiais)
CREATE UNIQUE INDEX fornecedores_cnpj_uk
    ON public.fornecedores (cnpj);

-- Índice espacial da garagem
CREATE INDEX fornecedores_garagem_localizacao_gix
    ON public.fornecedores
    USING GIST (garagem_localizacao);


CREATE TABLE public.motorista_fornecedor (
    id            BIGSERIAL PRIMARY KEY,
    motorista_id  BIGINT NOT NULL REFERENCES public.motoristas(id) ON DELETE CASCADE,
    fornecedor_id BIGINT NOT NULL REFERENCES public.fornecedores(id),
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (motorista_id)
);



CREATE TABLE veiculo_fornecedor (
    id            BIGSERIAL PRIMARY KEY,
    veiculo_id    INTEGER   NOT NULL
        REFERENCES veiculos (id)
        ON DELETE CASCADE,
    fornecedor_id BIGINT    NOT NULL
        REFERENCES fornecedores (id)
        ON DELETE RESTRICT,
    ativo         BOOLEAN   NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_veiculo_fornecedor_veiculo_id
    ON veiculo_fornecedor (veiculo_id);

CREATE INDEX idx_veiculo_fornecedor_fornecedor_id
    ON veiculo_fornecedor (fornecedor_id);


CREATE TABLE IF NOT EXISTS sistema_branding (
    tenant_id BIGINT REFERENCES tenants(id),

    -- Dados básicos
    nome_sistema               TEXT,
    telefone_contato           TEXT,
    email_contato              TEXT,
    site_oficial               TEXT,

    -- Caminhos de imagens (logos e foto padrão)
    logo_principal_path        TEXT,
    logo_secundaria_path       TEXT,
    logo_extra_path            TEXT,
    foto_padrao_aluno_path     TEXT,

    -- Separador padrão (cabeçalho / rodapé)
    doc_separador_ativo        BOOLEAN DEFAULT TRUE,
    doc_separador_imagem_path  TEXT,

    -- Cabeçalho de documentos (ofícios etc.)
    doc_cabecalho_linha1               TEXT,
    doc_cabecalho_linha2               TEXT,
    doc_cabecalho_linha3               TEXT,
    doc_cabecalho_alinhamento          TEXT,   -- 'left' | 'center' | 'right'

    doc_cabecalho_logo_esquerda_ativo  BOOLEAN,
    doc_cabecalho_logo_direita_ativo   BOOLEAN,
    doc_cabecalho_logo_esquerda_tipo   TEXT,   -- 'principal' | 'secundaria' | 'extra'
    doc_cabecalho_logo_direita_tipo    TEXT,   -- 'principal' | 'secundaria' | 'extra'

    -- Rodapé: texto
    doc_rodape_linha1          TEXT,
    doc_rodape_linha2          TEXT,
    doc_rodape_linha3          TEXT,

    -- Rodapé: imagens
    rodape_logo_esquerda_ativo BOOLEAN,
    rodape_logo_centro_ativo   BOOLEAN,
    rodape_logo_direita_ativo  BOOLEAN,
    rodape_logo_esquerda_tipo  TEXT,           -- 'principal' | 'secundaria' | 'extra'
    rodape_logo_centro_tipo    TEXT,           -- 'principal' | 'secundaria' | 'extra'
    rodape_logo_direita_tipo   TEXT,           -- 'principal' | 'secundaria' | 'extra'

    -- Carteirinhas
    carteirinha_logo_esquerda_ativo BOOLEAN,
    carteirinha_logo_direita_ativo  BOOLEAN,
    carteirinha_logo_esquerda_tipo  TEXT,      -- 'principal' | 'secundaria' | 'extra'
    carteirinha_logo_direita_tipo   TEXT,      -- 'principal' | 'secundaria' | 'extra'
    carteirinha_exibir_qr_verso     BOOLEAN,

    -- Extras
    cidade_uf               TEXT,
    termo_paragrafo_extra   TEXT
);


CREATE TABLE IF NOT EXISTS territorios_municipio (
    id              SERIAL PRIMARY KEY,
    tenant_id       TEXT NOT NULL,                  -- ou UUID, conforme seu tenant
    nome            TEXT NOT NULL,
    geom            GEOMETRY(MultiPolygon, 4326) NOT NULL,
    criado_em       TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW(),
    atualizado_em   TIMESTAMP WITHOUT TIME ZONE DEFAULT NOW()
);

-- Cada tenant tem, no máximo, 1 território ativo
CREATE UNIQUE INDEX IF NOT EXISTS territorios_municipio_tenant_uk
    ON territorios_municipio (tenant_id);



-- =========================================================
-- TABELAS DE ITINERÁRIOS / ASSOCIAÇÕES
-- =========================================================

-- Tabela principal de itinerários
CREATE TABLE itinerarios (
    id            SERIAL PRIMARY KEY,
    nome          TEXT,              -- opcional, para identificar o itinerário (ex: "Itinerário 01 - Zona Norte")
    descricao     TEXT,              -- opcional, para observações internas
    criado_em     TIMESTAMP DEFAULT NOW(),
    atualizado_em TIMESTAMP DEFAULT NOW()
);

-- Associação N:N entre itinerários e escolas
CREATE TABLE itinerario_escola (
    id             SERIAL PRIMARY KEY,
    itinerario_id  INT NOT NULL REFERENCES itinerarios(id) ON DELETE CASCADE,
    escola_id      INT NOT NULL REFERENCES escolas(id) ON DELETE CASCADE,

    UNIQUE (itinerario_id, escola_id)
);

CREATE INDEX idx_itinerario_escola_itinerario
    ON itinerario_escola (itinerario_id);

CREATE INDEX idx_itinerario_escola_escola
    ON itinerario_escola (escola_id);

-- Associação N:N entre itinerários e zoneamentos
CREATE TABLE itinerario_zoneamento (
    id             SERIAL PRIMARY KEY,
    itinerario_id  INT NOT NULL REFERENCES itinerarios(id) ON DELETE CASCADE,
    zoneamento_id  INT NOT NULL REFERENCES zoneamentos(id) ON DELETE CASCADE,

    UNIQUE (itinerario_id, zoneamento_id)
);

CREATE INDEX idx_itinerario_zoneamento_itinerario
    ON itinerario_zoneamento (itinerario_id);

CREATE INDEX idx_itinerario_zoneamento_zoneamento
    ON itinerario_zoneamento (zoneamento_id);


-- NOVAS TABELAS PARA ROTAS

CREATE TABLE rotas_escolares (
    id                   BIGSERIAL PRIMARY KEY,
    nome                 TEXT NOT NULL,              -- ex: "1-A", "1-B"
    veiculo_id           INTEGER REFERENCES veiculos (id),
    fornecedor_id        BIGINT  REFERENCES fornecedores (id),
    capacidade           INTEGER,                    -- capacidade do veículo usado

    qtd_alunos_manha     INTEGER NOT NULL DEFAULT 0,
    qtd_alunos_tarde     INTEGER NOT NULL DEFAULT 0,
    qtd_alunos_noite     INTEGER NOT NULL DEFAULT 0,
    qtd_alunos_integral  INTEGER NOT NULL DEFAULT 0,

    qtd_paradas          INTEGER NOT NULL DEFAULT 0,

    status               VARCHAR(20) NOT NULL DEFAULT 'ativo'
        CHECK (status IN ('ativo','inativo')),

    created_at           TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at           TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE itinerario_rotas (
    id             BIGSERIAL PRIMARY KEY,
    itinerario_id  INTEGER NOT NULL
        REFERENCES itinerarios (id) ON DELETE CASCADE,
    rota_id        BIGINT  NOT NULL
        REFERENCES rotas_escolares (id) ON DELETE CASCADE,
    UNIQUE (itinerario_id, rota_id)
);

CREATE TABLE rotas_escolares_pontos (
    id          BIGSERIAL PRIMARY KEY,
    rota_id     BIGINT NOT NULL
        REFERENCES rotas_escolares (id) ON DELETE CASCADE,
    ponto_id    BIGINT NOT NULL
        REFERENCES pontos_parada (id) ON DELETE RESTRICT,
    qtd_alunos  INTEGER NOT NULL DEFAULT 0,
    UNIQUE (rota_id, ponto_id)
);

CREATE TABLE rotas_escolares_alunos (
    rota_id   BIGINT  NOT NULL
        REFERENCES rotas_escolares (id) ON DELETE CASCADE,
    aluno_id  INTEGER NOT NULL
        REFERENCES alunos_municipais (id) ON DELETE CASCADE,
    ponto_id  INTEGER REFERENCES pontos_parada (id),
    PRIMARY KEY (rota_id, aluno_id)
);


CREATE TABLE rotas_percursos (
    id               BIGSERIAL PRIMARY KEY,
    rota_id          BIGINT NOT NULL
        REFERENCES rotas_escolares (id)
        ON DELETE CASCADE,
    trajeto          geometry(LineString, 4326) NOT NULL,
    origem           geometry(Point, 4326),
    destino          geometry(Point, 4326),
    distancia_m      INTEGER,
    duracao_seg      INTEGER,
    overview_polyline TEXT,
    turno_label      VARCHAR(20),
    fonte            VARCHAR(20) DEFAULT 'google_maps',
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (rota_id)
);

CREATE INDEX rotas_percursos_trajeto_gix
    ON rotas_percursos
    USING GIST (trajeto);
