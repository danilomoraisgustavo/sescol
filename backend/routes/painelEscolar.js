// routes/painelEscolar.js
import express from 'express';
import pool from '../db.js';

import authMiddleware from '../middleware/auth.js';
import tenantMiddleware from '../middleware/tenant.js';

const router = express.Router();

// Protege todas as rotas abaixo: token obrigatório e tenant resolvido via JWT
router.use(authMiddleware, tenantMiddleware);


/**
 * GET /api/dashboard-escolar
 * Filtros opcionais de período:
 *   ?inicio=YYYY-MM-DD&fim=YYYY-MM-DD
 * O período é aplicado sobre alunos_municipais.criado_em (alias "a").
 */
router.get('/dashboard-escolar', async (req, res) => {
  const { inicio, fim } = req.query;

  const tenantId = Number(req.tenantId);
  if (!Number.isFinite(tenantId)) return res.status(400).json({ error: 'tenant_id inválido no token' });

  // -----------------------------------
  // Filtros de data para alunos
  // -----------------------------------
  const filtrosAlunos = [];

  // IMPORTANTE: usamos sempre o tenant como 1º parâmetro.
  // A partir daqui, os demais parâmetros (datas) começam em $2, $3, ...
  const values = [tenantId];
  const valuesTenantOnly = [tenantId];

  filtrosAlunos.push(`a.tenant_id = $1`);

  if (inicio) {
    values.push(`${inicio} 00:00:00`);
    filtrosAlunos.push(`a.criado_em >= $${values.length}`);
  }
  if (fim) {
    values.push(`${fim} 23:59:59`);
    filtrosAlunos.push(`a.criado_em <= $${values.length}`);
  }

  const whereAlunos = filtrosAlunos.length
    ? `WHERE ${filtrosAlunos.join(' AND ')}`
    : '';

  let client;

  try {
    client = await pool.connect();

    const [
      resumoResult,
      zonaRotaResult,
      alunosAnoResult,
      frotaDemandaResult,
      escolasDemandaResult,
      rotasResumoResult,
      percursosResumoResult,
      rotasAlertasResult,
    ] = await Promise.all([
      // ==========================
      // 1. RESUMO GERAL
      // ==========================
      client.query({
        text: `
          SELECT
            COUNT(*)::int                                            AS total_alunos,
            COUNT(*) FILTER (WHERE a.transporte_apto)::int           AS total_alunos_apto,
            COUNT(*) FILTER (
              WHERE a.transporte_apto
                AND lower(coalesce(a.zona, '')) = 'urbana'
            )::int                                                  AS total_alunos_apto_urbano,
            COUNT(*) FILTER (
              WHERE a.transporte_apto
                AND lower(coalesce(a.zona, '')) = 'rural'
            )::int                                                  AS total_alunos_apto_rural,

            -- Escolas / pontos
            (SELECT COUNT(*) FROM escolas e WHERE e.tenant_id = $1)::int AS total_escolas,
            (SELECT COUNT(*) FROM pontos_parada p
                WHERE p.tenant_id = $1 AND p.status = 'ativo')::int  AS total_pontos_ativos,

            -- Zoneamentos
            (SELECT COUNT(*) FROM zoneamentos z0 WHERE z0.tenant_id = $1)::int AS total_zoneamentos,
            (SELECT COUNT(*) FROM zoneamentos z
                WHERE z.tenant_id = $1 AND z.tipo_zona = 'urbana')::int AS total_zoneamentos_urbana,
            (SELECT COUNT(*) FROM zoneamentos z
                WHERE z.tenant_id = $1 AND z.tipo_zona = 'rural')::int  AS total_zoneamentos_rural,

            -- Operação (recursos humanos / frota)
            (SELECT COUNT(*) FROM motoristas m
                WHERE m.tenant_id = $1 AND m.status = 'ativo')::int  AS total_motoristas_ativos,
            (SELECT COUNT(*) FROM monitores mo
                WHERE mo.tenant_id = $1 AND mo.status = 'ativo')::int AS total_monitores_ativos,
            (SELECT COUNT(*) FROM veiculos v
                WHERE v.tenant_id = $1 AND v.status = 'ativo')::int  AS total_veiculos_ativos,
            (SELECT COALESCE(SUM(v.capacidade_lotacao),0)
                FROM veiculos v
                WHERE v.tenant_id = $1 AND v.status = 'ativo')::int  AS capacidade_frota_total,

            (SELECT COUNT(*) FROM fornecedores f
                WHERE f.tenant_id = $1 AND f.status = 'ativo')::int  AS total_fornecedores_ativos,
            (SELECT COUNT(*) FROM fornecedores f
                WHERE f.tenant_id = $1 AND f.garagem_localizacao IS NOT NULL)::int AS total_garagens_georreferenciadas,

            -- Itinerários / rotas (total simples)
            (SELECT COUNT(*) FROM itinerarios i WHERE i.tenant_id = $1)::int AS total_itinerarios,
            (SELECT COUNT(*) FROM rotas_escolares r WHERE r.tenant_id = $1)::int AS total_rotas
          FROM alunos_municipais a
          ${whereAlunos};
        `,
        values,
      }),

      // ==========================
      // 2. ALUNOS APTOS POR ZONA x SITUAÇÃO DE ROTA (COM / SEM ROTA)
      // ==========================
      client.query({
        text: `
          SELECT
            CASE
              WHEN lower(coalesce(a.zona, '')) IN ('urbana','rural')
                THEN initcap(lower(a.zona))
              ELSE 'N/D'
            END AS zona,
            CASE
              WHEN ra.rota_id IS NULL THEN 'Sem rota'
              ELSE 'Com rota'
            END AS situacao_rota,
            COUNT(DISTINCT a.id)::int AS total
          FROM alunos_municipais a
          JOIN alunos_escolas ae ON ae.aluno_id = a.id AND ae.tenant_id = $1
          JOIN escolas e ON e.id = ae.escola_id AND e.tenant_id = $1
          LEFT JOIN rotas_escolares_alunos ra
            ON ra.aluno_id = a.id AND ra.tenant_id = $1
          ${whereAlunos ? whereAlunos + ' AND' : 'WHERE'} a.transporte_apto = TRUE
          GROUP BY zona, situacao_rota
          ORDER BY zona, situacao_rota;
        `,
        values,
      }),

      // ==========================
      // 3. ALUNOS POR ANO LETIVO
      // ==========================
      client.query({
        text: `
          SELECT
            ae.ano_letivo AS ano,
            COUNT(DISTINCT ae.aluno_id)::int AS total_matriculados,
            COUNT(DISTINCT ae.aluno_id)
              FILTER (WHERE a.transporte_apto)::int AS total_apto_transporte
          FROM alunos_escolas ae
          JOIN alunos_municipais a ON a.id = ae.aluno_id AND a.tenant_id = $1
          ${whereAlunos ? whereAlunos + ' AND' : 'WHERE'} ae.tenant_id = $1
          GROUP BY ae.ano_letivo
          ORDER BY ae.ano_letivo;
        `,
        values,
      }),

      // ==========================
      // 4. FROTA x DEMANDA + alunos com rota
      // ==========================
      client.query({
        text: `
          SELECT
            COALESCE(SUM(v.capacidade_lotacao),0)::int AS capacidade_total,

            -- alunos aptos no período
            (
              SELECT COUNT(*)
              FROM alunos_municipais a
              ${whereAlunos ? whereAlunos + ' AND' : 'WHERE'} a.transporte_apto = TRUE
            )::int AS alunos_apto,

            -- alunos aptos que já estão vinculados a alguma rota
            (
              SELECT COUNT(DISTINCT a.id)
              FROM alunos_municipais a
              JOIN rotas_escolares_alunos ra ON ra.aluno_id = a.id AND ra.tenant_id = $1
              ${whereAlunos ? whereAlunos + ' AND' : 'WHERE'} a.transporte_apto = TRUE
            )::int AS alunos_com_rota

          FROM veiculos v
          WHERE v.tenant_id = $1 AND v.status = 'ativo';
        `,
        values,
      }),

      // ==========================
      // 5. ESCOLAS COM MAIOR DEMANDA
      // ==========================
      client.query({
        text: `
          SELECT
            e.id   AS escola_id,
            e.nome AS escola_nome,

            COUNT(DISTINCT a.id)
              FILTER (WHERE a.transporte_apto)::int AS total_apto,

            COUNT(DISTINCT a.id)
              FILTER (
                WHERE a.transporte_apto
                  AND lower(coalesce(a.zona,'')) = 'urbana'
              )::int AS apto_urbano,

            COUNT(DISTINCT a.id)
              FILTER (
                WHERE a.transporte_apto
                  AND lower(coalesce(a.zona,'')) = 'rural'
              )::int AS apto_rural,

            COUNT(DISTINCT p.id)::int              AS total_pontos,
            COUNT(DISTINCT ez.zoneamento_id)::int  AS total_zoneamentos

          FROM escolas e
          JOIN alunos_escolas ae ON ae.escola_id = e.id AND ae.tenant_id = $1
          JOIN alunos_municipais a ON a.id = ae.aluno_id AND a.tenant_id = $1
          LEFT JOIN alunos_pontos ap ON ap.aluno_id = a.id
          LEFT JOIN pontos_parada p ON p.id = ap.ponto_id
                                     AND p.status = 'ativo'
          LEFT JOIN escola_zoneamento ez ON ez.escola_id = e.id

          ${whereAlunos ? whereAlunos + ' AND' : 'WHERE'} a.transporte_apto = TRUE

          GROUP BY e.id, e.nome
          HAVING COUNT(DISTINCT a.id)
                   FILTER (WHERE a.transporte_apto) > 0
          ORDER BY total_apto DESC, e.nome
          LIMIT 50;
        `,
        values,
      }),

      // ==========================
      // 6. RESUMO DE ROTAS
      // ==========================
      client.query({
        text: `
          SELECT
            COUNT(*)::int AS total_rotas,
            COUNT(*) FILTER (WHERE status = 'ativo')::int   AS total_rotas_ativas,
            COUNT(*) FILTER (WHERE status = 'inativo')::int AS total_rotas_inativas,
            COUNT(*) FILTER (WHERE veiculo_id IS NULL)::int AS total_rotas_sem_veiculo,

            COUNT(*) FILTER (
              WHERE capacidade IS NOT NULL
                AND (
                  qtd_alunos_manha    > capacidade OR
                  qtd_alunos_tarde    > capacidade OR
                  qtd_alunos_noite    > capacidade OR
                  qtd_alunos_integral > capacidade
                )
            )::int AS total_rotas_superlotadas,

            COALESCE(SUM(qtd_paradas),0)::int AS total_paradas_rotas,

            COALESCE(SUM(
              qtd_alunos_manha
              + qtd_alunos_tarde
              + qtd_alunos_noite
              + qtd_alunos_integral
            ),0)::int AS total_alunos_rotas

          FROM rotas_escolares
          WHERE tenant_id = $1;
        `,
        values: valuesTenantOnly,
      }),
      // ==========================
      // 7. COBERTURA DE PERCURSOS (rotas_percursos)
      // ==========================
      client.query({
        text: `
          SELECT
            COUNT(*) FILTER (WHERE rp.rota_id IS NULL)::int AS rotas_sem_registro_percurso,
            COUNT(*) FILTER (
              WHERE rp.rota_id IS NOT NULL
                AND rp.trajeto IS NULL
                AND COALESCE(rp.overview_polyline,'') = ''
            )::int AS rotas_com_registro_sem_trajeto,
            COUNT(*) FILTER (
              WHERE rp.trajeto IS NOT NULL
                 OR COALESCE(rp.overview_polyline,'') <> ''
            )::int AS rotas_com_trajeto_ok
          FROM rotas_escolares r
          LEFT JOIN rotas_percursos rp ON rp.rota_id = r.id AND rp.tenant_id = $1
          WHERE r.tenant_id = $1;
        `,
        values: valuesTenantOnly,
      }),

      // ==========================
      // 8. ALERTAS DE ROTAS (top problemas)
      // ==========================
      client.query({
        text: `
          WITH base AS (
            SELECT
              r.id,
              r.nome,
              r.status,
              r.capacidade,
              r.veiculo_id,
              (COALESCE(r.qtd_alunos_manha,0)
                + COALESCE(r.qtd_alunos_tarde,0)
                + COALESCE(r.qtd_alunos_noite,0)
                + COALESCE(r.qtd_alunos_integral,0))::int AS total_alunos,
              COALESCE(r.qtd_paradas, 0)::int AS qtd_paradas,
              (rp.rota_id IS NULL)::boolean AS sem_registro_percurso,
              (
                rp.rota_id IS NOT NULL
                AND rp.trajeto IS NULL
                AND COALESCE(rp.overview_polyline,'') = ''
              )::boolean AS com_registro_sem_trajeto,
              (
                rp.trajeto IS NOT NULL
                OR COALESCE(rp.overview_polyline,'') <> ''
              )::boolean AS com_trajeto_ok,
              COALESCE(r.qtd_alunos_manha,0)::int    AS alunos_manha,
              COALESCE(r.qtd_alunos_tarde,0)::int    AS alunos_tarde,
              COALESCE(r.qtd_alunos_noite,0)::int    AS alunos_noite,
              COALESCE(r.qtd_alunos_integral,0)::int AS alunos_integral,

              GREATEST(
                COALESCE(r.qtd_alunos_manha,0),
                COALESCE(r.qtd_alunos_tarde,0),
                COALESCE(r.qtd_alunos_noite,0),
                COALESCE(r.qtd_alunos_integral,0)
              )::int AS pico_por_turno,

              (
                r.capacidade IS NOT NULL
                AND GREATEST(
                  COALESCE(r.qtd_alunos_manha,0),
                  COALESCE(r.qtd_alunos_tarde,0),
                  COALESCE(r.qtd_alunos_noite,0),
                  COALESCE(r.qtd_alunos_integral,0)
                ) > r.capacidade
              )::boolean AS superlotada,

              array_to_string(
                array_remove(ARRAY[
                  CASE WHEN r.capacidade IS NOT NULL AND COALESCE(r.qtd_alunos_manha,0) > r.capacidade THEN 'Manhã' END,
                  CASE WHEN r.capacidade IS NOT NULL AND COALESCE(r.qtd_alunos_tarde,0) > r.capacidade THEN 'Tarde' END,
                  CASE WHEN r.capacidade IS NOT NULL AND COALESCE(r.qtd_alunos_noite,0) > r.capacidade THEN 'Noite' END,
                  CASE WHEN r.capacidade IS NOT NULL AND COALESCE(r.qtd_alunos_integral,0) > r.capacidade THEN 'Integral' END
                ], NULL),
                ', '
              ) AS superlotada_turnos
            FROM rotas_escolares r
            LEFT JOIN rotas_percursos rp ON rp.rota_id = r.id AND rp.tenant_id = $1
            WHERE r.tenant_id = $1
          ),
          zona AS (
            SELECT
              rep.rota_id,
              CASE
                WHEN COUNT(DISTINCT pt.area) = 1 THEN MIN(pt.area)
                WHEN COUNT(DISTINCT pt.area) = 0 THEN 'nd'
                ELSE 'mista'
              END AS zona
            FROM rotas_escolares_pontos rep
            JOIN pontos_parada pt ON pt.id = rep.ponto_id
            WHERE rep.tenant_id = $1 AND pt.tenant_id = $1
            GROUP BY rep.rota_id
          )
          SELECT
            b.*,
            COALESCE(z.zona, 'nd') AS zona
          FROM base b
          LEFT JOIN zona z ON z.rota_id = b.id
          WHERE
            b.sem_registro_percurso
            OR b.com_registro_sem_trajeto
            OR b.veiculo_id IS NULL
            OR b.superlotada
          ORDER BY
            b.sem_registro_percurso DESC,
            b.com_registro_sem_trajeto DESC,
            (b.veiculo_id IS NULL) DESC,
            b.superlotada DESC,
            b.total_alunos DESC
          LIMIT 50;
        `,
        values: valuesTenantOnly,
      }),

    ]);

    const resumoBase = resumoResult.rows[0] || {};

    const frota_demanda = frotaDemandaResult.rows[0] || {
      capacidade_total: 0,
      alunos_apto: 0,
      alunos_com_rota: 0,
    };

    const rotasResumo = rotasResumoResult.rows[0] || {
      total_rotas: 0,
      total_rotas_ativas: 0,
      total_rotas_inativas: 0,
      total_rotas_sem_veiculo: 0,
      total_rotas_superlotadas: 0,
      total_paradas_rotas: 0,
      total_alunos_rotas: 0,
    };

    const percursosResumo = percursosResumoResult.rows[0] || {
      rotas_sem_registro_percurso: 0,
      rotas_com_registro_sem_trajeto: 0,
      rotas_com_trajeto_ok: 0,
    };

    const rotas_alertas = rotasAlertasResult.rows || [];

    const capacidadeTotal = frota_demanda.capacidade_total || 0;
    const alunosApto = frota_demanda.alunos_apto || 0;
    const alunosComRota = frota_demanda.alunos_com_rota || 0;
    const alunosSemRota = Math.max(alunosApto - alunosComRota, 0);

    const taxaOcupacaoFrota =
      capacidadeTotal > 0
        ? Number(((alunosApto / capacidadeTotal) * 100).toFixed(1))
        : 0;

    // Resumo enriquecido, bem focado em transporte
    const resumo = {
      ...resumoBase,

      // transporte escolar – visão de alunos
      alunos_sem_rota: alunosSemRota,

      // transporte escolar – rotas
      total_rotas: rotasResumo.total_rotas ?? resumoBase.total_rotas ?? 0,
      total_rotas_ativas: rotasResumo.total_rotas_ativas ?? 0,
      total_rotas_inativas: rotasResumo.total_rotas_inativas ?? 0,
      total_rotas_sem_veiculo: rotasResumo.total_rotas_sem_veiculo ?? 0,
      total_rotas_superlotadas: rotasResumo.total_rotas_superlotadas ?? 0,
      total_paradas_rotas: rotasResumo.total_paradas_rotas ?? 0,
      total_alunos_rotas: rotasResumo.total_alunos_rotas ?? 0,

      // transporte escolar – percursos (qualidade do mapa)
      rotas_com_trajeto_ok: percursosResumo.rotas_com_trajeto_ok ?? 0,
      rotas_sem_registro_percurso: percursosResumo.rotas_sem_registro_percurso ?? 0,
      rotas_com_registro_sem_trajeto: percursosResumo.rotas_com_registro_sem_trajeto ?? 0,

      // transporte escolar – frota
      taxa_ocupacao_frota: taxaOcupacaoFrota,
    };

    const alunos_por_zona_rota = zonaRotaResult.rows;

    const alunos_por_ano = {
      anos: alunosAnoResult.rows.map((r) => r.ano),
      total_matriculados: alunosAnoResult.rows.map((r) => r.total_matriculados),
      total_apto_transporte: alunosAnoResult.rows.map((r) => r.total_apto_transporte),
    };

    return res.json({
      resumo,
      alunos_por_zona_rota,
      alunos_por_ano,
      frota_demanda,
      escolas_demanda: escolasDemandaResult.rows,
      rotas_alertas,
    });
  } catch (err) {
    console.error('Erro ao carregar painel escolar:', err);
    return res
      .status(500)
      .json({ error: 'Erro ao carregar painel escolar', detail: err.message });
  } finally {
    if (client) client.release();
  }
});

/**
 * GET /api/dashboard-escolar/rotas-mapa
 * Retorna FeatureCollection GeoJSON das rotas escolares
 * com propriedades usadas no mapa (cor, zona, capacidade etc.).
 */
router.get('/dashboard-escolar/rotas-mapa', async (req, res) => {
  const tenantId = Number(req.tenantId);
  if (!Number.isFinite(tenantId)) return res.status(400).json({ error: 'tenant_id inválido no token' });
  let client;

  try {
    client = await pool.connect();

    const { rows } = await client.query({
      text: `
WITH percurso AS (
  SELECT
    r.id,
    r.nome,
    r.status,
    r.capacidade,
    r.qtd_alunos_manha,
    r.qtd_alunos_tarde,
    r.qtd_alunos_noite,
    r.qtd_alunos_integral,

    rp.distancia_m,
    rp.duracao_seg,
    rp.turno_label,
    rp.fonte,

    -- Trajeto priorizado:
    -- 1) geometry já salva (rotas_percursos.trajeto)
    -- 2) fallback: overview_polyline (se existir e PostGIS suportar)
    COALESCE(
      CASE
        WHEN rp.trajeto IS NOT NULL THEN
          ST_Force2D(
            CASE
              WHEN ST_SRID(rp.trajeto) = 4326 THEN rp.trajeto
              WHEN ST_SRID(rp.trajeto) = 0    THEN ST_SetSRID(rp.trajeto, 4326)
              ELSE ST_Transform(rp.trajeto, 4326)
            END
          )
        ELSE NULL
      END,
      CASE
        WHEN rp.overview_polyline IS NOT NULL
             AND rp.overview_polyline <> '' THEN
          ST_SetSRID(ST_LineFromEncodedPolyline(rp.overview_polyline), 4326)
        ELSE NULL
      END
    ) AS trajeto_4326,

    -- Origem/Destino (opcionais) como Point 4326
    CASE
      WHEN rp.origem IS NULL THEN NULL
      ELSE ST_Force2D(
        CASE
          WHEN ST_SRID(rp.origem) = 4326 THEN rp.origem
          WHEN ST_SRID(rp.origem) = 0    THEN ST_SetSRID(rp.origem, 4326)
          ELSE ST_Transform(rp.origem, 4326)
        END
      )
    END AS origem_4326,

    CASE
      WHEN rp.destino IS NULL THEN NULL
      ELSE ST_Force2D(
        CASE
          WHEN ST_SRID(rp.destino) = 4326 THEN rp.destino
          WHEN ST_SRID(rp.destino) = 0    THEN ST_SetSRID(rp.destino, 4326)
          ELSE ST_Transform(rp.destino, 4326)
        END
      )
    END AS destino_4326

  FROM rotas_escolares r
  LEFT JOIN rotas_percursos rp
    ON rp.rota_id = r.id AND rp.tenant_id = $1
  WHERE r.tenant_id = $1
)

SELECT
  p.id,
  p.nome,
  p.status,
  p.capacidade,
  COALESCE(
    p.qtd_alunos_manha
    + p.qtd_alunos_tarde
    + p.qtd_alunos_noite
    + p.qtd_alunos_integral,
    0
  )::int AS total_alunos_dia,

  GREATEST(
    COALESCE(p.qtd_alunos_manha,0),
    COALESCE(p.qtd_alunos_tarde,0),
    COALESCE(p.qtd_alunos_noite,0),
    COALESCE(p.qtd_alunos_integral,0)
  )::int AS pico_por_turno,

  -- compat: o painel usa "total_alunos" no popup; aqui faz sentido ser o pico por viagem/turno
  GREATEST(
    COALESCE(p.qtd_alunos_manha,0),
    COALESCE(p.qtd_alunos_tarde,0),
    COALESCE(p.qtd_alunos_noite,0),
    COALESCE(p.qtd_alunos_integral,0)
  )::int AS total_alunos,

  p.qtd_alunos_manha::int    AS alunos_manha,
  p.qtd_alunos_tarde::int    AS alunos_tarde,
  p.qtd_alunos_noite::int    AS alunos_noite,
  p.qtd_alunos_integral::int AS alunos_integral,

  -- zona inferida pelos pontos vinculados (urbana / rural / mista / nd)
  CASE
    WHEN COUNT(DISTINCT pt.area) = 1 THEN MIN(pt.area)
    WHEN COUNT(DISTINCT pt.area) = 0 THEN 'nd'
    ELSE 'mista'
  END AS zona,

  MAX(p.distancia_m)::int AS distancia_m,
  MAX(p.duracao_seg)::int AS duracao_seg,
  MAX(p.turno_label)      AS turno_label,
  MAX(p.fonte)            AS fonte,

  -- geometria da rota (road-following) — só usa fallback "linha reta" se NÃO existir trajeto salvo
  ST_AsGeoJSON(
    p.trajeto_4326
  )::json AS geometry,

  ST_AsGeoJSON(MAX(p.origem_4326))::json  AS origem,
  ST_AsGeoJSON(MAX(p.destino_4326))::json AS destino

FROM percurso p
LEFT JOIN rotas_escolares_pontos rp2
  ON rp2.rota_id = p.id AND rp2.tenant_id = $1
LEFT JOIN pontos_parada pt
  ON pt.id = rp2.ponto_id
 AND pt.tenant_id = $1
 AND pt.localizacao IS NOT NULL

-- IMPORTANTÍSSIMO: para o mapa geral, NÃO desenhar "linha reta" quando não houver
-- trajeto calculado (isso vira a "maçaroca"). Rotas sem trajeto devem ser
-- geradas via Google e salvas em rotas_percursos antes de aparecerem aqui.
WHERE p.trajeto_4326 IS NOT NULL

GROUP BY
  p.id,
  p.nome,
  p.status,
  p.capacidade,
  p.qtd_alunos_manha,
  p.qtd_alunos_tarde,
  p.qtd_alunos_noite,
  p.qtd_alunos_integral,
  p.trajeto_4326;
`,
      values: [tenantId],
    });

    // Paleta fixa para ter cores consistentes
    const palette = [
      '#ff6b6b', // vermelho
      '#feca57', // amarelo
      '#48dbfb', // azul claro
      '#1dd1a1', // verde
      '#5f27cd', // roxo
      '#ff9ff3', // rosa
      '#00d2d3', // turquesa
      '#576574', // cinza
    ];

    const features = rows.map((r, index) => {
      const color = palette[index % palette.length];

      return {
        type: 'Feature',
        geometry: r.geometry,
        properties: {
          id: r.id,
          nome: r.nome,
          status: r.status,
          zona: r.zona,                // 'urbana', 'rural', 'mista' ou 'nd'
          capacidade: r.capacidade,
          total_alunos: r.total_alunos,
          distancia_m: r.distancia_m,
          duracao_seg: r.duracao_seg,
          color,                       // cor sugerida da rota
        },
      };
    });

    return res.json({
      type: 'FeatureCollection',
      features,
    });
  } catch (err) {
    console.error('Erro ao carregar rotas para o mapa:', err);
    return res.status(500).json({
      error: 'Erro ao carregar rotas para o mapa',
      detail: err.message,
    });
  } finally {
    if (client) client.release();
  }
});

export default router;