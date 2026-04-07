// routes/rotas-escolares.js
import express from 'express';
import pool from '../db.js';

const router = express.Router();

// Telefones: usar APENAS os campos reais da tabela alunos_municipais
// (conforme DDL enviado pelo usuário)
const _TELEFONE_COLS = ['telefone_filiacao_1', 'telefone_filiacao_2', 'telefone_responsavel'];

async function obterColunasTelefoneAlunosMunicipais() {
    return _TELEFONE_COLS;
}


function extrairTelefonesDoAlunoRow(row, cols) {
    if (!row || !Array.isArray(cols) || !cols.length) return [];

    const telefonesValidos = [];

    for (const col of cols) {
        let v = row[col];
        if (!v) continue;

        v = String(v).trim();

        // remove tudo que não for número
        const apenasNumeros = v.replace(/\D/g, '');

        // regra: telefone válido precisa ter pelo menos 8 dígitos
        // (ignora "__ ____-____", "", null, etc)
        if (apenasNumeros.length < 8) continue;

        telefonesValidos.push(v);
    }

    // remove duplicados mantendo a ordem
    const seen = new Set();
    return telefonesValidos.filter(t => {
        if (seen.has(t)) return false;
        seen.add(t);
        return true;
    });
}



function obterTenantId(req) {
    const candidates = [
        req?.tenant_id,
        req?.tenantId,
        req?.user?.tenant_id,
        req?.user?.tenantId,
        req?.auth?.tenant_id,
        req?.auth?.tenantId,
        req?.headers?.['x-tenant-id'],
        req?.headers?.['tenant-id'],
        req?.headers?.['x-tenantid'],
        req?.headers?.['x-tenant']
    ];
    for (const c of candidates) {
        const n = Number.parseInt(String(c ?? ''), 10);
        if (Number.isInteger(n) && n > 0) return n;
    }
    return null;
}

async function obterTenantIdDaRota(client, rotaId) {
    const r = await client.query('SELECT tenant_id FROM rotas_escolares WHERE id = $1', [rotaId]);
    return r.rowCount ? Number(r.rows[0].tenant_id) : null;
}


function getUserCargo(req) {
    const cargo = (req?.user?.cargo || req?.user?.role || req?.auth?.cargo || req?.auth?.role || '').toString();
    return cargo ? cargo.toUpperCase() : '';
}

function getUserFornecedorId(req) {
    const raw = (req?.user?.fornecedor_id ?? req?.user?.fornecedorId ?? req?.auth?.fornecedor_id ?? req?.auth?.fornecedorId ?? null);
    const n = Number.parseInt(String(raw ?? ''), 10);
    return Number.isInteger(n) && n > 0 ? n : null;
}

function isFornecedorEscolar(req) {
    return getUserCargo(req) === 'FORNECEDOR_ESCOLAR';
}

async function assertRotaAcessivel(req, res, rotaId, tenantId) {
    if (!isFornecedorEscolar(req)) return { ok: true };
    const fornecedorId = getUserFornecedorId(req);
    if (!fornecedorId) {
        res.status(403).json({ error: 'Usuário FORNECEDOR_ESCOLAR sem vínculo de fornecedor.' });
        return { ok: false };
    }
    const q = await pool.query(
        'SELECT 1 FROM rotas_escolares WHERE id = $1 AND tenant_id = $2 AND fornecedor_id = $3',
        [rotaId, tenantId, fornecedorId]
    );
    if (!q.rowCount) {
        // 404 para não vazar que existe rota de outro fornecedor
        res.status(404).json({ error: 'Rota não encontrada' });
        return { ok: false };
    }
    return { ok: true, fornecedorId };
}


/**
 * Mesmo helper de turno usado em itinerarios.js
 */
function inferirTurnoBackend(aluno) {
    let fonte = [
        aluno.turma || '',
        aluno.ano || '',
        aluno.modalidade || '',
        aluno.formato_letivo || '',
        aluno.etapa || ''
    ].join(' ').toUpperCase();

    fonte = fonte
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '');

    if (/\b(MAT|MANHA)\b/.test(fonte)) {
        return 'Manhã';
    }
    if (/\b(VESP|VESPERTINO|TARDE)\b/.test(fonte)) {
        return 'Tarde';
    }
    if (/\b(NOT|NOITE|NOTURNO)\b/.test(fonte)) {
        return 'Noite';
    }
    if (/\b(INT|INTEGRAL)\b/.test(fonte)) {
        return 'Integral';
    }
    return 'Não informado';
}

/**
 * Converte query ?turno=manha|tarde|noite|integral para rótulo usado internamente
 */
function parseTurnoFiltro(q) {
    if (!q) return null;
    const v = q.toString().trim().toLowerCase();

    if (['manha', 'manhã', 'man'].includes(v)) return 'Manhã';
    if (['tarde', 'vesp', 'vespertino'].includes(v)) return 'Tarde';
    if (['noite', 'not', 'noturno'].includes(v)) return 'Noite';
    if (['integral', 'int'].includes(v)) return 'Integral';

    return null;
}

/**
 * GET /api/rotas-escolares/:id/alunos?turno=manha|tarde|noite|integral
 *
 * Retorna:
 * {
 *   rota: { id, nome },
 *   turno: "manha",
 *   escola: { id, nome, lat, lng },
 *   fornecedor: { id, nome_fantasia, razao_social, garagem_lat, garagem_lng },
 *   alunos: [
 *     { id, pessoa_nome, ponto_lat, ponto_lng, ponto_bairro, ponto_logradouro }
 *   ]
 * }
 */
router.get('/:id/alunos', async (req, res) => {
    const rotaId = parseInt(req.params.id, 10);
    if (!Number.isInteger(rotaId)) {
        return res.status(400).json({ error: 'ID de rota inválido' });
    }

    const turnoFiltro = parseTurnoFiltro(req.query.turno);

    try {
        const tenantId = obterTenantId(req);
        if (!tenantId) {
            return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
        }
        const acc = await assertRotaAcessivel(req, res, rotaId, tenantId);
        if (!acc.ok) return;


        const tenantIdCtx = obterTenantId(req);
        if (tenantIdCtx) {
            const acc = await assertRotaAcessivel(req, res, rotaId, tenantIdCtx);
            if (!acc.ok) return;
        }

        // 1) Meta da rota + fornecedor + itinerário
        const rotaSql = `
      SELECT 
        r.id,
        r.nome,
        r.fornecedor_id,
        r.veiculo_id,
        ir.itinerario_id,
        f.nome_fantasia,
        f.razao_social,
        ST_Y(f.garagem_localizacao)::float AS garagem_lat,
        ST_X(f.garagem_localizacao)::float AS garagem_lng
      FROM rotas_escolares r
      LEFT JOIN itinerario_rotas ir ON ir.rota_id = r.id
      LEFT JOIN fornecedores f ON f.id = r.fornecedor_id
      WHERE r.id = $1
      LIMIT 1;
    `;
        const rotaRes = await pool.query(rotaSql, [rotaId]);
        if (!rotaRes.rowCount) {
            return res.status(404).json({ error: 'Rota não encontrada' });
        }
        const rotaRow = rotaRes.rows[0];

        // 2) Escolas: prioriza escolas realmente presentes nos alunos da rota.
        // Se não der para inferir via alunos, cai no fallback (todas as escolas do itinerário).
        let escolas = await carregarEscolasDaRota(pool, rotaId);

        if ((!escolas || !escolas.length) && rotaRow.itinerario_id) {
            const escolaSql = `
        SELECT 
          e.id,
          e.nome,
          ST_Y(e.localizacao)::float AS lat,
          ST_X(e.localizacao)::float AS lng,
          0::int AS total_alunos
        FROM itinerario_escola ie
        JOIN escolas e ON e.id = ie.escola_id
        WHERE ie.itinerario_id = $1
          AND e.localizacao IS NOT NULL
        ORDER BY e.id;
      `;
            const escolaRes = await pool.query(escolaSql, [rotaRow.itinerario_id]);
            escolas = (escolaRes.rows || []).map(e => ({
                id: Number(e.id),
                nome: e.nome,
                lat: Number(e.lat),
                lng: Number(e.lng),
                total_alunos: 0
            }));
        }

        // Compatibilidade: mantém campo singular `escola` (primeira da lista)
        const escolaObj = (Array.isArray(escolas) && escolas.length)
            ? { id: escolas[0].id, nome: escolas[0].nome, lat: escolas[0].lat, lng: escolas[0].lng }
            : null;

        // 3) Alunos associados à rota + ponto de parada
        const telefoneCols = await obterColunasTelefoneAlunosMunicipais();
        const telefonesSelectSql = telefoneCols.length
            ? telefoneCols.map((c) => `a.\"${c}\" AS \"${c}\"`).join(',\n        ') + ',\n'
            : '';

        const alunosSql = `      SELECT
        a.id AS aluno_id,
        a.pessoa_nome,
        a.turma,
        a.ano,
        a.modalidade,
        a.formato_letivo,
        a.etapa,
        a.deficiencia,
        ${telefonesSelectSql}        COALESCE(a.rota_exclusiva, false) AS rota_exclusiva,
        ra.ponto_id,
        p.bairro AS ponto_bairro,
        p.logradouro AS ponto_logradouro,
        ST_Y(p.localizacao)::float AS ponto_lat,
        ST_X(p.localizacao)::float AS ponto_lng,
        ae.escola_id,
        e.nome AS escola_nome
      FROM rotas_escolares_alunos ra
      JOIN alunos_municipais a ON a.id = ra.aluno_id AND a.tenant_id = ra.tenant_id
      LEFT JOIN pontos_parada p ON p.id = ra.ponto_id AND p.tenant_id = ra.tenant_id
      LEFT JOIN LATERAL (
        SELECT ae.escola_id, ae.ano_letivo, ae.atualizado_em, ae.id
        FROM alunos_escolas ae
        WHERE ae.aluno_id = a.id
          AND ae.tenant_id = a.tenant_id
        ORDER BY ae.ano_letivo DESC NULLS LAST, ae.atualizado_em DESC NULLS LAST, ae.id DESC
        LIMIT 1
      ) ae ON TRUE
      LEFT JOIN escolas e ON e.id = ae.escola_id
      WHERE ra.rota_id = $1
        AND ra.tenant_id = $2
      ORDER BY a.pessoa_nome;
    `;
        const alunosRes = await pool.query(alunosSql, [rotaId, tenantId]);
        const alunosBrutos = alunosRes.rows || [];

        // 4) Aplica inferência de turno e filtra se necessário
        const alunosTratados = alunosBrutos
            .map((row) => {
                const turno = inferirTurnoBackend(row);
                return {
                    id: row.aluno_id,
                    pessoa_nome: row.pessoa_nome,
                    turno,
                    telefones: extrairTelefonesDoAlunoRow(row, telefoneCols),
                    ponto_id: row.ponto_id,
                    ponto_bairro: row.ponto_bairro,
                    ponto_logradouro: row.ponto_logradouro,
                    ponto_lat: row.ponto_lat,
                    ponto_lng: row.ponto_lng,
                    escola_id: row.escola_id ? Number(row.escola_id) : null,
                    escola_nome: row.escola_nome || null,
                    deficiencia: row.deficiencia || null,
                    rota_exclusiva: !!row.rota_exclusiva
                };
            })
            .filter((aluno) => {
                if (!turnoFiltro) return true;
                return aluno.turno === turnoFiltro;
            });

        const pontosRotaSql = `
      SELECT
        rp.ponto_id,
        TRIM(CONCAT_WS(' - ',
          NULLIF(TRIM(COALESCE(p.logradouro, '')), ''),
          NULLIF(TRIM(COALESCE(p.numero, '')), ''),
          NULLIF(TRIM(COALESCE(p.bairro, '')), '')
        )) AS nome,
        p.referencia,
        p.bairro,
        p.logradouro,
        p.numero,
        rp.qtd_alunos,
        ST_Y(p.localizacao)::float AS lat,
        ST_X(p.localizacao)::float AS lng
      FROM rotas_escolares_pontos rp
      JOIN pontos_parada p
        ON p.id = rp.ponto_id
       AND p.tenant_id = rp.tenant_id
      WHERE rp.rota_id = $1
        AND rp.tenant_id = $2
        AND p.localizacao IS NOT NULL
      ORDER BY rp.id ASC, p.id ASC;
    `;
        const pontosRotaRes = await pool.query(pontosRotaSql, [rotaId, tenantId]);
        const pontosRota = (pontosRotaRes.rows || []).map(function (row) {
            return {
                ponto_id: row.ponto_id != null ? Number(row.ponto_id) : null,
                nome: row.nome || row.logradouro || row.referencia || row.bairro || null,
                referencia: row.referencia || null,
                bairro: row.bairro || null,
                logradouro: row.logradouro || null,
                numero: row.numero || null,
                qtd_alunos: row.qtd_alunos != null ? Number(row.qtd_alunos) : 0,
                lat: row.lat != null ? Number(row.lat) : null,
                lng: row.lng != null ? Number(row.lng) : null
            };
        }).filter(function (p) {
            return Number.isFinite(p.lat) && Number.isFinite(p.lng);
        });

        const fornecedorObj = rotaRow.fornecedor_id
            ? {
                id: rotaRow.fornecedor_id,
                nome_fantasia: rotaRow.nome_fantasia,
                razao_social: rotaRow.razao_social,
                garagem_lat: rotaRow.garagem_lat,
                garagem_lng: rotaRow.garagem_lng
            }
            : null;

        return res.json({
            rota: {
                id: rotaRow.id,
                nome: rotaRow.nome
            },
            // devolvemos o turno "chave" que veio na query (manha/tarde/noite/integral)
            turno: req.query.turno || null,
            escola: escolaObj,
            escolas: escolas || [],
            fornecedor: fornecedorObj,
            pontos: pontosRota,
            alunos: alunosTratados
        });
    } catch (err) {
        console.error('Erro ao carregar alunos da rota', err);
        return res.status(500).json({ error: 'Erro ao carregar alunos da rota' });
    }
});

router.post('/:id/percurso', async (req, res) => {
    const rotaId = parseInt(req.params.id, 10);
    if (!Number.isInteger(rotaId)) {
        return res.status(400).json({ error: 'ID de rota inválido' });
    }

    const tenantIdFromReq = obterTenantId(req);
    const tenantId = tenantIdFromReq || (await obterTenantIdDaRota(pool, rotaId));
    if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
    }

    const acc = await assertRotaAcessivel(req, res, rotaId, tenantId);
    if (!acc.ok) return;

    const {
        pontos,
        origem,
        destino,
        distancia_m,
        duracao_seg,
        turno
    } = req.body || {};

    if (!Array.isArray(pontos) || pontos.length < 2) {
        return res.status(400).json({
            error: 'Lista de pontos inválida. É necessário pelo menos 2 pontos para formar uma linha.'
        });
    }

    // Monta WKT da LINESTRING a partir dos pontos (lng lat)
    const coords = [];
    pontos.forEach((p) => {
        const lat = parseFloat(p.lat);
        const lng = parseFloat(p.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
        coords.push(`${lng} ${lat}`);
    });

    if (coords.length < 2) {
        return res.status(400).json({
            error: 'Não foi possível montar o trajeto com os pontos informados.'
        });
    }

    const wktLine = `LINESTRING(${coords.join(',')})`;

    // Origem / destino: se não vierem do front, usamos primeiro / último ponto
    const origemCoord = origem || pontos[0];
    const destinoCoord = destino || pontos[pontos.length - 1];

    const origemLat = origemCoord && Number.isFinite(parseFloat(origemCoord.lat))
        ? parseFloat(origemCoord.lat)
        : null;
    const origemLng = origemCoord && Number.isFinite(parseFloat(origemCoord.lng))
        ? parseFloat(origemCoord.lng)
        : null;

    const destinoLat = destinoCoord && Number.isFinite(parseFloat(destinoCoord.lat))
        ? parseFloat(destinoCoord.lat)
        : null;
    const destinoLng = destinoCoord && Number.isFinite(parseFloat(destinoCoord.lng))
        ? parseFloat(destinoCoord.lng)
        : null;

    const dist = Number.isFinite(parseInt(distancia_m, 10))
        ? parseInt(distancia_m, 10)
        : null;
    const dur = Number.isFinite(parseInt(duracao_seg, 10))
        ? parseInt(duracao_seg, 10)
        : null;

    const turnoLabel = turno ? String(turno).toLowerCase() : null;

    try {
        const sql = `
      INSERT INTO rotas_percursos (
        rota_id,
        trajeto,
        origem,
        destino,
        distancia_m,
        duracao_seg,
        overview_polyline,
        turno_label,
        fonte,
        created_at,
        updated_at,
        tenant_id
      )
      VALUES (
        $1,
        ST_SetSRID(ST_GeomFromText($2), 4326),
        CASE
          WHEN $3::double precision IS NOT NULL AND $4::double precision IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint($4::double precision, $3::double precision), 4326)
          ELSE NULL::geometry
        END,
        CASE
          WHEN $5::double precision IS NOT NULL AND $6::double precision IS NOT NULL
          THEN ST_SetSRID(ST_MakePoint($6::double precision, $5::double precision), 4326)
          ELSE NULL::geometry
        END,
        $7,
        $8,
        NULL,                -- overview_polyline (poderemos preencher futuramente)
        $9,
        'google_maps',
        NOW(),
        NOW(),
        $10
      )
      ON CONFLICT (rota_id) DO UPDATE
      SET
        trajeto           = EXCLUDED.trajeto,
        origem            = EXCLUDED.origem,
        destino           = EXCLUDED.destino,
        distancia_m       = EXCLUDED.distancia_m,
        duracao_seg       = EXCLUDED.duracao_seg,
        overview_polyline = EXCLUDED.overview_polyline,
        turno_label       = EXCLUDED.turno_label,
        fonte             = EXCLUDED.fonte,
        updated_at        = NOW()
      RETURNING id;
    `;

        const params = [
            rotaId,        // $1
            wktLine,       // $2
            origemLat,     // $3
            origemLng,     // $4
            destinoLat,    // $5
            destinoLng,    // $6
            dist,          // $7
            dur,           // $8
            turnoLabel,    // $9
            tenantId        // $10
        ];

        // Opcional: log para depuração
        // console.log('Salvar percurso rota:', { sql, params });

        const result = await pool.query(sql, params);

        return res.json({
            success: true,
            message: 'Percurso salvo com sucesso.',
            percurso_id: result.rows[0]?.id || null
        });
    } catch (err) {
        console.error('Erro ao salvar percurso da rota:', err);
        return res.status(500).json({
            error: 'Erro ao salvar percurso da rota.'
        });
    }
});

/* =======================================================================
   PERCURSO (GOOGLE DIRECTIONS) POR ROTA
   - Gera o trajeto “alinhado com as ruas” (snap-to-road implícito do Google Directions)
   - Salva em public.rotas_percursos (1 percurso por rota_id) preenchendo:
     trajeto (LineString), origem/destino (Point), distancia_m, duracao_seg, overview_polyline, turno_label, fonte
   ======================================================================= */


// =======================================================================
// AJUSTE DE EXIBIÇÃO (DISTÂNCIA)
// - A distância exibida no modal deve ser 40% maior do que a distância real.
// - IMPORTANTE: este ajuste é aplicado APENAS na resposta da API (não altera o valor armazenado no banco).
// =======================================================================
const DISTANCIA_EXIBICAO_FATOR = 1.5;

function ajustarPercursoParaExibicao(percurso) {
    if (!percurso || typeof percurso !== 'object') return percurso;
    const out = { ...percurso };
    const dm = Number(out.distancia_m);
    if (Number.isFinite(dm)) out.distancia_m = Math.round(dm * DISTANCIA_EXIBICAO_FATOR);
    return out;
}


const GOOGLE_MAX_WAYPOINTS = 20;

/**
 * Decodifica polyline do Google (encoded polyline) -> [{lat,lng}, ...]
 * Implementação leve (sem dependência externa).
 */
function decodeGooglePolyline(str) {
    if (!str || typeof str !== 'string') return [];
    let index = 0;
    const len = str.length;
    let lat = 0;
    let lng = 0;
    const coordinates = [];

    while (index < len) {
        let b, shift = 0, result = 0;
        do {
            b = str.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlat = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lat += dlat;

        shift = 0;
        result = 0;
        do {
            b = str.charCodeAt(index++) - 63;
            result |= (b & 0x1f) << shift;
            shift += 5;
        } while (b >= 0x20);
        const dlng = ((result & 1) ? ~(result >> 1) : (result >> 1));
        lng += dlng;

        coordinates.push({ lat: lat / 1e5, lng: lng / 1e5 });
    }
    return coordinates;
}

/**
 * [{lat,lng}] -> WKT LINESTRING(lng lat, lng lat, ...)
 */
function coordsToWktLineString(coords) {
    const pts = (Array.isArray(coords) ? coords : [])
        .filter(p => p && Number.isFinite(p.lat) && Number.isFinite(p.lng));

    if (pts.length < 2) return null;

    const pairs = pts.map(p => `${p.lng} ${p.lat}`).join(', ');
    return `LINESTRING(${pairs})`;
}

async function fetchGoogleDirectionsJson({ origin, destination, waypoints, optimize = true, mode = 'driving' }) {
    const apiKey = process.env.GOOGLE_MAPS_API_KEY || process.env.GOOGLE_MAPS_KEY;
    if (!apiKey) {
        const err = new Error('GOOGLE_MAPS_API_KEY não configurada no backend.');
        err.statusCode = 500;
        throw err;
    }

    const params = new URLSearchParams();
    params.set('origin', `${origin.lat},${origin.lng}`);
    params.set('destination', `${destination.lat},${destination.lng}`);
    params.set('mode', mode);
    params.set('language', 'pt-BR');
    params.set('key', apiKey);

    if (Array.isArray(waypoints) && waypoints.length) {
        // Waypoints: "optimize:true|lat,lng|lat,lng|..."
        const wpStr = (optimize ? 'optimize:true|' : '') + waypoints.map(p => `${p.lat},${p.lng}`).join('|');
        params.set('waypoints', wpStr);
    }

    const url = `https://maps.googleapis.com/maps/api/directions/json?${params.toString()}`;
    const resp = await fetch(url);
    if (!resp.ok) {
        throw new Error(`Erro ao chamar Google Directions (${resp.status})`);
    }

    const data = await resp.json();
    if (!data || data.status !== 'OK' || !data.routes || !data.routes.length) {
        const msg = data && data.error_message ? data.error_message : (data && data.status ? data.status : 'Falha ao gerar rota');
        const err = new Error(`Google Directions: ${msg}`);
        err.statusCode = 400;
        throw err;
    }
    return data;
}

function somarLegs(legs) {
    let metros = 0;
    let segundos = 0;
    (Array.isArray(legs) ? legs : []).forEach(l => {
        const dm = l?.distance?.value;
        const ds = l?.duration?.value;
        if (Number.isFinite(dm)) metros += dm;
        if (Number.isFinite(ds)) segundos += ds;
    });
    return { metros, segundos };
}

function normalizarCoord(lat, lng) {
    const la = Number.parseFloat(lat);
    const ln = Number.parseFloat(lng);
    if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
    return { lat: la, lng: ln };
}

function haversineKm(a, b) {
    if (!a || !b) return Number.POSITIVE_INFINITY;
    const R = 6371;
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

// Heurística simples e rápida para ordenar escolas (nearest-neighbor).
function ordenarCoordsNearest(coords, start) {
    const pend = (Array.isArray(coords) ? coords : []).slice();
    const out = [];
    let cur = start;
    while (pend.length) {
        let bestIdx = 0;
        let bestD = Number.POSITIVE_INFINITY;
        for (let i = 0; i < pend.length; i++) {
            const d = haversineKm(cur, pend[i]);
            if (d < bestD) {
                bestD = d;
                bestIdx = i;
            }
        }
        const next = pend.splice(bestIdx, 1)[0];
        out.push(next);
        cur = next;
    }
    return out;
}


/**
 * Inferir as escolas realmente atendidas por uma rota (via alunos vinculados à rota).
 * Retorna lista distinta com contagem de alunos por escola (desc).
 * Fallback: se não houver vínculo aluno->escola, o chamador pode usar itinerario_escola.
 */
async function carregarEscolasDaRota(client, rotaId) {
    // Tenta obter escolas pelos alunos da rota.
    // Preferimos COUNT(*) por escola para escolher destino principal com mais alunos.
    const sql = `
        SELECT
            e.id,
            e.nome,
            ST_Y(e.localizacao)::float AS lat,
            ST_X(e.localizacao)::float AS lng,
            COUNT(*)::int AS total_alunos
        FROM rotas_escolares_alunos ra
        JOIN alunos_escolas ae ON ae.aluno_id = ra.aluno_id
        JOIN escolas e ON e.id = ae.escola_id
        WHERE ra.rota_id = $1
          AND e.localizacao IS NOT NULL
        GROUP BY e.id, e.nome, e.localizacao
        ORDER BY total_alunos DESC, e.id ASC;
    `;

    try {
        const r = await client.query(sql, [rotaId]);
        return (r.rows || []).map(row => ({
            id: Number(row.id),
            nome: row.nome,
            lat: Number(row.lat),
            lng: Number(row.lng),
            total_alunos: Number(row.total_alunos || 0)
        }));
    } catch (e) {
        // Se a tabela alunos_escolas não existir no tenant/banco, não quebrar o fluxo.
        return [];
    }
}

async function carregarContextoRota(client, rotaId) {
    // Rota + garagem fornecedor + itinerário
    const rotaSql = `
        SELECT 
            r.id,
            r.nome,
            ir.itinerario_id,
            f.id AS fornecedor_id,
            COALESCE(f.nome_fantasia, f.razao_social) AS fornecedor_nome,
            ST_Y(f.garagem_localizacao)::float AS garagem_lat,
            ST_X(f.garagem_localizacao)::float AS garagem_lng
        FROM rotas_escolares r
        LEFT JOIN itinerario_rotas ir ON ir.rota_id = r.id
        LEFT JOIN fornecedores f ON f.id = r.fornecedor_id
        WHERE r.id = $1
        LIMIT 1;
    `;
    const rotaRes = await client.query(rotaSql, [rotaId]);
    if (!rotaRes.rowCount) return null;
    const rotaRow = rotaRes.rows[0];

    // Escolas: preferir as escolas realmente presentes nos alunos da rota.
    // Isso resolve o caso de itinerário com múltiplas escolas (não ignorar a 2ª escola).
    let escolas = await carregarEscolasDaRota(client, rotaId);

    // Fallback: se não deu para inferir via alunos, usa as escolas do itinerário.
    if ((!escolas || !escolas.length) && rotaRow.itinerario_id) {
        const escolaSql = `
            SELECT 
              e.id,
              e.nome,
              ST_Y(e.localizacao)::float AS lat,
              ST_X(e.localizacao)::float AS lng,
              0::int AS total_alunos
            FROM itinerario_escola ie
            JOIN escolas e ON e.id = ie.escola_id
            WHERE ie.itinerario_id = $1
              AND e.localizacao IS NOT NULL
            ORDER BY e.id;
        `;
        const escolaRes = await client.query(escolaSql, [rotaRow.itinerario_id]);
        escolas = (escolaRes.rows || []).map(e => ({
            id: Number(e.id),
            nome: e.nome,
            lat: Number(e.lat),
            lng: Number(e.lng),
            total_alunos: 0
        }));
    }

    // Compatibilidade: manter `escola` (primeira) para telas antigas.
    const escola = escolas && escolas.length ? {
        id: escolas[0].id,
        nome: escolas[0].nome,
        lat: escolas[0].lat,
        lng: escolas[0].lng
    } : null;

    // Pontos da rota
    const pontosSql = `
        SELECT
            p.id,
            ST_Y(p.localizacao)::float AS lat,
            ST_X(p.localizacao)::float AS lng
        FROM rotas_escolares_pontos rp
        JOIN pontos_parada p ON p.id = rp.ponto_id
        WHERE rp.rota_id = $1
          AND p.localizacao IS NOT NULL
        ORDER BY rp.id ASC;
    `;
    const pontosRes = await client.query(pontosSql, [rotaId]);
    const pontos = pontosRes.rows
        .map(r => normalizarCoord(r.lat, r.lng))
        .filter(Boolean);

    const garagem = normalizarCoord(rotaRow.garagem_lat, rotaRow.garagem_lng);
    // Se houver mais de uma escola, o destino "final" será a última da lista.
    // As demais escolas podem ser usadas como waypoints no cálculo do Google Directions.
    const escolaDestinoFinal = (escolas && escolas.length) ? escolas[escolas.length - 1] : null;
    const destino = normalizarCoord(escolaDestinoFinal?.lat, escolaDestinoFinal?.lng);

    return {
        rota: { id: rotaRow.id, nome: rotaRow.nome },
        fornecedor: {
            id: rotaRow.fornecedor_id,
            nome: rotaRow.fornecedor_nome,
            garagem
        },
        escola,
        escolas,
        pontos,
        destino
    };
}

/**
 * Gera e salva percurso (Google Directions) para UMA rota.
 * - Se houver garagem: origem = garagem. Senão: origem = primeiro ponto.
 * - destino = escola do itinerário (primeira escola)
 * - waypoints = pontos (sem o primeiro quando usado como origem)
 *
 * Query params:
 *   ?turno=manha|tarde|noite|integral  (opcional) -> gravado em turno_label
 *   ?force=1  (opcional) -> recalcula e sobrescreve
 */
router.post('/:id/percurso/google', async (req, res) => {
    const rotaId = parseInt(req.params.id, 10);
    if (!Number.isInteger(rotaId)) {
        return res.status(400).json({ error: 'ID de rota inválido' });
    }

    const tenantIdFromReq = obterTenantId(req);
    const tenantId = tenantIdFromReq || (await obterTenantIdDaRota(pool, rotaId));
    if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
    }

    const acc = await assertRotaAcessivel(req, res, rotaId, tenantId);
    if (!acc.ok) return;

    const turnoFiltro = parseTurnoFiltro(req.query.turno);
    const force = ['1', 'true', 'yes'].includes(String(req.query.force || '').toLowerCase());

    let client;
    try {
        client = await pool.connect();

        // Se não for force, tenta reaproveitar percurso existente
        if (!force) {
            const existRes = await client.query(
                `SELECT id, overview_polyline, distancia_m, duracao_seg
                   FROM rotas_percursos
                  WHERE rota_id = $1
                  LIMIT 1;`,
                [rotaId]
            );
            if (existRes.rowCount) {
                return res.json({
                    success: true,
                    message: 'Percurso já existe (reutilizado).',
                    reused: true,
                    percurso: ajustarPercursoParaExibicao(existRes.rows[0])
                });
            }
        }

        const ctx = await carregarContextoRota(client, rotaId);
        if (!ctx) return res.status(404).json({ error: 'Rota não encontrada' });

        if (!ctx.destino) {
            return res.status(400).json({ error: 'Não foi possível identificar a escola destino (itinerário sem escola ou escola sem geolocalização).' });
        }

        if (!ctx.pontos.length && !ctx.fornecedor?.garagem) {
            return res.status(400).json({ error: 'Rota sem pontos georreferenciados e sem garagem do fornecedor.' });
        }

        // Origem = garagem (se existir), senão primeiro ponto
        const garagem = ctx.fornecedor?.garagem || null;
        if (!garagem) {
            return res.status(400).json({
                error: 'Esta rota não possui fornecedor/garagem configurados. Vincule um fornecedor com garagem antes de gerar o percurso.'
            });
        }

        // Escolas associadas ao itinerário/rota (suporta multi-escolas)
        const escolasCoords = (Array.isArray(ctx.escolas) && ctx.escolas.length)
            ? ctx.escolas
                .map(e => normalizarCoord(e.lat, e.lng))
                .filter(Boolean)
            : (ctx.destino ? [ctx.destino] : []);

        if (!escolasCoords.length) {
            return res.status(400).json({ error: 'Não foi possível identificar escola(s) georreferenciadas para esta rota.' });
        }

        // Paradas (pontos de parada). As escolas serão visitadas AO FINAL (na melhor ordem),
        // evitando misturar "passar na escola" com "buscar aluno".
        const stops = ctx.pontos.slice();

        // Ordena escolas (nearest-neighbor a partir da garagem). Mantém TODAS as escolas.
        const escolasOrdenadas = ordenarCoordsNearest(escolasCoords, garagem);

        const calcularTrecho = async ({ origin, destination, waypoints, optimize }) => {
            let totalMetros = 0;
            let totalSegundos = 0;
            let overviewPolylineFinal = '';
            let coordsFinal = [];

            let currentOrigin = origin;
            const fila = (Array.isArray(waypoints) ? waypoints : []).slice();

            while (true) {
                const segmentWaypoints = fila.splice(0, GOOGLE_MAX_WAYPOINTS);

                // Se ainda restarem pontos depois deste segmento, usamos o último waypoint como destino intermediário
                let segmentDestination = destination;
                if (fila.length > 0) {
                    const last = segmentWaypoints.pop();
                    if (!last) break;
                    segmentDestination = last;
                }

                const data = await fetchGoogleDirectionsJson({
                    origin: currentOrigin,
                    destination: segmentDestination,
                    waypoints: segmentWaypoints,
                    optimize: Boolean(optimize)
                });

                const route0 = data.routes[0];
                const legs = route0.legs || [];
                const soma = somarLegs(legs);
                totalMetros += soma.metros;
                totalSegundos += soma.segundos;

                const poly = route0.overview_polyline?.points || '';
                const decoded = decodeGooglePolyline(poly);

                // Concatena coords (evita duplicar o primeiro ponto da sequência)
                if (decoded.length) {
                    if (coordsFinal.length) {
                        coordsFinal = coordsFinal.concat(decoded.slice(1));
                    } else {
                        coordsFinal = coordsFinal.concat(decoded);
                    }
                }

                // Guarda a última polyline (a final será a do último segmento)
                overviewPolylineFinal = poly || overviewPolylineFinal;

                // Próximo segmento
                if (fila.length === 0) break;
                currentOrigin = segmentDestination;
            }

            return { totalMetros, totalSegundos, overviewPolylineFinal, coordsFinal };
        };

        // 1) Garagem -> primeira escola (alunos/pontos como waypoints otimizados)
        const primeiraEscola = escolasOrdenadas[0];
        const leg1 = await calcularTrecho({
            origin: garagem,
            destination: primeiraEscola,
            waypoints: stops,
            optimize: true
        });

        // 2) Entre escolas (sem waypoints), na ordem calculada
        let legMetros = (leg1.totalMetros || 0);
        let legSegundos = (leg1.totalSegundos || 0);
        let overviewPolylineFinal = leg1.overviewPolylineFinal || '';
        let coordsFinal = (leg1.coordsFinal || []).slice();

        for (let i = 0; i < escolasOrdenadas.length - 1; i++) {
            const a = escolasOrdenadas[i];
            const b = escolasOrdenadas[i + 1];
            const leg = await calcularTrecho({
                origin: a,
                destination: b,
                waypoints: [],
                optimize: false
            });
            legMetros += (leg.totalMetros || 0);
            legSegundos += (leg.totalSegundos || 0);
            if (leg.overviewPolylineFinal) overviewPolylineFinal = leg.overviewPolylineFinal;
            if (Array.isArray(leg.coordsFinal) && leg.coordsFinal.length) {
                const seg = leg.coordsFinal.slice(1);
                coordsFinal = coordsFinal.concat(seg);
            }
        }

        // 3) Última escola -> garagem (retorno)
        const ultimaEscola = escolasOrdenadas[escolasOrdenadas.length - 1];
        const legBack = await calcularTrecho({
            origin: ultimaEscola,
            destination: garagem,
            waypoints: [],
            optimize: false
        });
        legMetros += (legBack.totalMetros || 0);
        legSegundos += (legBack.totalSegundos || 0);
        if (legBack.overviewPolylineFinal) overviewPolylineFinal = legBack.overviewPolylineFinal;
        if (Array.isArray(legBack.coordsFinal) && legBack.coordsFinal.length) {
            const seg = legBack.coordsFinal.slice(1);
            coordsFinal = coordsFinal.concat(seg);
        }

        const totalMetros = legMetros;
        const totalSegundos = legSegundos;


        // Coordenadas finais (trajeto completo)
        const wkt = coordsToWktLineString(coordsFinal);

        if (!wkt) {
            return res.status(400).json({ error: 'Não foi possível gerar LINESTRING do percurso (polyline vazia).' });
        }

        const origemLat = garagem?.lat ?? null;
        const origemLng = garagem?.lng ?? null;
        const destinoLat = garagem?.lat ?? null;
        const destinoLng = garagem?.lng ?? null;

        const turnoLabel = turnoFiltro ? turnoFiltro.toLowerCase() : null;

        const upsertSql = `
            INSERT INTO rotas_percursos (
                rota_id,
                trajeto,
                origem,
                destino,
                distancia_m,
                duracao_seg,
                overview_polyline,
                turno_label,
                fonte,
                created_at,
                updated_at,
                tenant_id
            )
            VALUES (
                $1,
                ST_SetSRID(ST_GeomFromText($2), 4326),
                CASE
                    WHEN $3::double precision IS NOT NULL AND $4::double precision IS NOT NULL
                    THEN ST_SetSRID(ST_MakePoint($4::double precision, $3::double precision), 4326)
                    ELSE NULL::geometry
                END,
                CASE
                    WHEN $5::double precision IS NOT NULL AND $6::double precision IS NOT NULL
                    THEN ST_SetSRID(ST_MakePoint($6::double precision, $5::double precision), 4326)
                    ELSE NULL::geometry
                END,
                $7,
                $8,
                $9,
                $10,
                'google_maps',
                NOW(),
                NOW(),
                $11
            )
            ON CONFLICT (rota_id) DO UPDATE
            SET
                trajeto           = EXCLUDED.trajeto,
                origem            = EXCLUDED.origem,
                destino           = EXCLUDED.destino,
                distancia_m       = EXCLUDED.distancia_m,
                duracao_seg       = EXCLUDED.duracao_seg,
                overview_polyline = EXCLUDED.overview_polyline,
                turno_label       = EXCLUDED.turno_label,
                fonte             = EXCLUDED.fonte,
                updated_at        = NOW()
            RETURNING id, distancia_m, duracao_seg, overview_polyline;
        `;

        const upsertParams = [
            rotaId,
            wkt,
            origemLat,
            origemLng,
            destinoLat,
            destinoLng,
            Math.round(totalMetros) || null,
            Math.round(totalSegundos) || null,
            overviewPolylineFinal || null,
            turnoLabel,
            tenantId
        ];

        const saved = await client.query(upsertSql, upsertParams);

        return res.json({
            success: true,
            message: 'Percurso gerado pelo Google e salvo com sucesso.',
            reused: false,
            rota: ctx.rota,
            escola: ctx.escola,
            fornecedor: ctx.fornecedor,
            percurso: ajustarPercursoParaExibicao(saved.rows[0])
        });
    } catch (err) {
        console.error('Erro ao gerar/salvar percurso Google:', err);
        const code = err.statusCode && Number.isInteger(err.statusCode) ? err.statusCode : 500;
        return res.status(code).json({ error: err.message || 'Erro ao gerar percurso pelo Google.' });
    } finally {
        if (client) client.release();
    }
});



// Trocar veículo da rota (Atribuir/Desatribuir)
// Suporta "transferir_conflitante": se o veículo já estiver em outra rota no mesmo turno,
// desatribui o veículo das rotas conflitantes (mantendo fornecedor/empresa) e atribui nesta rota.
router.patch('/:id/veiculo', async (req, res) => {
    const tenantId = obterTenantId(req);
    const rotaId = Number(req.params.id);

    const body = req.body || {};
    const veiculoId = (body.veiculo_id != null && body.veiculo_id !== '')
        ? Number(body.veiculo_id)
        : null;

    const transferirConflitante =
        body.transferir_conflitante === true ||
        body.transferirConflitante === true;

    if (!tenantId) {
        return res.status(400).json({ error: 'Tenant não identificado.' });
    }

    if (!rotaId || Number.isNaN(rotaId)) {
        return res.status(400).json({ error: 'Rota inválida.' });
    }

    if (veiculoId != null && Number.isNaN(veiculoId)) {
        return res.status(400).json({ error: 'Veículo inválido.' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // 1) Carrega rota alvo para entender turnos
        const rotaQ = await client.query(
            `SELECT
                id,
                nome,
                veiculo_id,
                fornecedor_id,
                qtd_alunos_manha,
                qtd_alunos_tarde,
                qtd_alunos_noite,
                qtd_alunos_integral
             FROM rotas_escolares
             WHERE id = $1
               AND tenant_id = $2`,
            [rotaId, tenantId]
        );

        if (!rotaQ.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Rota não encontrada.' });
        }

        const rotaAlvo = rotaQ.rows[0];

        const usaManha = Number(rotaAlvo.qtd_alunos_manha || 0) > 0;
        const usaTarde = Number(rotaAlvo.qtd_alunos_tarde || 0) > 0;
        const usaNoite = Number(rotaAlvo.qtd_alunos_noite || 0) > 0;
        const usaIntegral = Number(rotaAlvo.qtd_alunos_integral || 0) > 0;

        // 2) Valida veículo e busca fornecedor vinculado via tabela intermediária veiculo_fornecedor
        let veiculoRow = null;

        if (veiculoId != null) {
            const v = await client.query(
                `SELECT
                    v.id,
                    v.placa,
                    v.prefixo,
                    v.marca,
                    v.modelo,
                    v.capacidade_lotacao,
                    v.status,
                    vf.fornecedor_id,
                    COALESCE(f.nome_fantasia, f.razao_social) AS fornecedor_nome,
                    f.nome_fantasia AS fornecedor_nome_fantasia,
                    f.razao_social AS fornecedor_razao_social,
                    ST_Y(f.garagem_localizacao)::float AS garagem_lat,
                    ST_X(f.garagem_localizacao)::float AS garagem_lng
                 FROM veiculos v
                 LEFT JOIN veiculo_fornecedor vf
                   ON vf.veiculo_id = v.id
                  AND vf.tenant_id = v.tenant_id
                  AND vf.ativo = true
                 LEFT JOIN fornecedores f
                   ON f.id = vf.fornecedor_id
                  AND f.tenant_id = v.tenant_id
                 WHERE v.id = $1
                   AND v.tenant_id = $2
                 ORDER BY vf.updated_at DESC NULLS LAST, vf.id DESC NULLS LAST
                 LIMIT 1`,
                [veiculoId, tenantId]
            );

            if (!v.rowCount) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Veículo não encontrado.' });
            }

            veiculoRow = v.rows[0];
        }

        // 3) Se for atribuição, checa conflitos de turno
        let conflitos = [];

        if (veiculoId != null && (usaManha || usaTarde || usaNoite || usaIntegral)) {
            const conf = await client.query(
                `SELECT
                    id,
                    nome,
                    fornecedor_id,
                    veiculo_id
                 FROM rotas_escolares
                 WHERE tenant_id = $2
                   AND veiculo_id = $1
                   AND id <> $3
                   AND (
                        ($4::boolean AND COALESCE(qtd_alunos_manha, 0) > 0) OR
                        ($5::boolean AND COALESCE(qtd_alunos_tarde, 0) > 0) OR
                        ($6::boolean AND COALESCE(qtd_alunos_noite, 0) > 0) OR
                        ($7::boolean AND COALESCE(qtd_alunos_integral, 0) > 0)
                   )`,
                [veiculoId, tenantId, rotaId, usaManha, usaTarde, usaNoite, usaIntegral]
            );

            conflitos = conf.rows || [];

            if (conflitos.length && !transferirConflitante) {
                await client.query('ROLLBACK');
                return res.status(409).json({
                    error: 'Conflito: veículo já está em outra rota no mesmo turno.',
                    conflito: true,
                    veiculo_id: veiculoId,
                    rota_alvo_id: rotaId,
                    rotas_conflitantes: conflitos
                });
            }

            // Se transferir_conflitante=true, desatribui o veículo das rotas conflitantes
            // mantendo o fornecedor da rota antiga
            if (conflitos.length && transferirConflitante) {
                const ids = conflitos
                    .map((r) => Number(r.id))
                    .filter((n) => Number.isFinite(n));

                if (ids.length) {
                    await client.query(
                        `UPDATE rotas_escolares
                         SET veiculo_id = NULL,
                             capacidade = NULL,
                             updated_at = NOW()
                         WHERE tenant_id = $1
                           AND id = ANY($2::bigint[])`,
                        [tenantId, ids]
                    );
                }
            }
        }

        // 4) Atualiza a rota alvo
        const capacidadeNova =
            veiculoId != null &&
                veiculoRow &&
                veiculoRow.capacidade_lotacao != null
                ? Number(veiculoRow.capacidade_lotacao)
                : null;

        const fornecedorNovo =
            veiculoId != null &&
                veiculoRow &&
                veiculoRow.fornecedor_id != null
                ? Number(veiculoRow.fornecedor_id)
                : null;

        const upd = await client.query(
            `UPDATE rotas_escolares
             SET veiculo_id = $1,
                 capacidade = $2,
                 fornecedor_id = COALESCE($3, fornecedor_id),
                 updated_at = NOW()
             WHERE id = $4
               AND tenant_id = $5
             RETURNING id, veiculo_id, capacidade, fornecedor_id`,
            [veiculoId, capacidadeNova, fornecedorNovo, rotaId, tenantId]
        );

        const fornecedorPayload =
            veiculoId != null &&
                veiculoRow &&
                veiculoRow.fornecedor_id != null
                ? {
                    id: Number(veiculoRow.fornecedor_id),
                    nome:
                        veiculoRow.fornecedor_nome ||
                        veiculoRow.fornecedor_nome_fantasia ||
                        veiculoRow.fornecedor_razao_social ||
                        '',
                    nome_fantasia: veiculoRow.fornecedor_nome_fantasia || null,
                    razao_social: veiculoRow.fornecedor_razao_social || null,
                    garagem_lat:
                        veiculoRow.garagem_lat != null
                            ? Number(veiculoRow.garagem_lat)
                            : null,
                    garagem_lng:
                        veiculoRow.garagem_lng != null
                            ? Number(veiculoRow.garagem_lng)
                            : null
                }
                : null;

        await client.query('COMMIT');

        return res.json({
            success: true,
            rota_id: upd.rows[0].id,
            veiculo_id: upd.rows[0].veiculo_id,
            capacidade: upd.rows[0].capacidade,
            fornecedor_id: upd.rows[0].fornecedor_id,
            veiculo: veiculoRow,
            fornecedor: fornecedorPayload,
            transferiu: transferirConflitante && conflitos.length > 0,
            rotas_desatribuidas: transferirConflitante ? conflitos : []
        });
    } catch (err) {
        try {
            if (client) await client.query('ROLLBACK');
        } catch (e) { }

        if (err && (err.code === '23514' || err.code === 'P0001')) {
            return res.status(409).json({
                error: err.message || 'Conflito ao atribuir veículo (mesmo turno).',
                conflito: true,
                detalhe: err.message || null
            });
        }

        console.error('Erro ao trocar veículo da rota:', err);
        return res.status(500).json({ error: 'Erro ao trocar veículo da rota.' });
    } finally {
        if (client) client.release();
    }
});

// =======================================================================
// ASSOCIAÇÃO DE MOTORISTA / MONITOR À ROTA
// - Persistência: public.motoristas_rotas e public.monitores_rotas
// - Regra: esta API NÃO altera veículo nem recria rota; apenas gerencia as relações.
// - Observação: o schema permite múltiplos, mas a tela trabalha com 1 selecionado (último).
// =======================================================================

// Listar motoristas ativos do tenant (para preencher selects)
router.get('/lookup/motoristas', async (req, res) => {
    const tenantId = obterTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant não identificado.' });

    try {
        const r = await pool.query(
            `SELECT id, nome
             FROM motoristas
             WHERE tenant_id = $1
               AND COALESCE(status, 'ativo') = 'ativo'
             ORDER BY nome ASC`,
            [tenantId]
        );
        return res.json(r.rows || []);
    } catch (err) {
        console.error('Erro ao listar motoristas (lookup):', err);
        return res.status(500).json({ error: 'Erro ao listar motoristas.' });
    }
});

// Listar monitores ativos do tenant (para preencher selects)
router.get('/lookup/monitores', async (req, res) => {
    const tenantId = obterTenantId(req);
    if (!tenantId) return res.status(400).json({ error: 'Tenant não identificado.' });

    try {
        const r = await pool.query(
            `SELECT id, nome
             FROM monitores
             WHERE tenant_id = $1
               AND COALESCE(status, 'ativo') = 'ativo'
             ORDER BY nome ASC`,
            [tenantId]
        );
        return res.json(r.rows || []);
    } catch (err) {
        console.error('Erro ao listar monitores (lookup):', err);
        return res.status(500).json({ error: 'Erro ao listar monitores.' });
    }
});

// Retorna associações atuais (motorista + monitores) de uma rota
router.get('/:id/associacoes', async (req, res) => {
    const tenantId = obterTenantId(req);
    const rotaId = Number(req.params.id);

    if (!tenantId) return res.status(400).json({ error: 'Tenant não identificado.' });
    if (!rotaId || Number.isNaN(rotaId)) return res.status(400).json({ error: 'Rota inválida.' });

    try {
        const acc = await assertRotaAcessivel(req, res, rotaId, tenantId);
        if (!acc.ok) return;

        const motQ = await pool.query(
            `SELECT mr.motorista_id AS id, m.nome
             FROM motoristas_rotas mr
             JOIN motoristas m ON m.id = mr.motorista_id AND m.tenant_id = mr.tenant_id
             WHERE mr.tenant_id = $1 AND mr.rota_escolar_id = $2
             ORDER BY mr.created_at DESC NULLS LAST, mr.id DESC
             LIMIT 1`,
            [tenantId, rotaId]
        );

        const monQ = await pool.query(
            `SELECT DISTINCT r.monitor_id AS id, m.nome
             FROM monitores_rotas r
             JOIN monitores m ON m.id = r.monitor_id AND m.tenant_id = r.tenant_id
             WHERE r.tenant_id = $1 AND r.rota_escolar_id = $2
             ORDER BY m.nome ASC, r.monitor_id ASC`,
            [tenantId, rotaId]
        );

        const monitores = (monQ.rows || []).map(row => ({ id: Number(row.id), nome: row.nome }));

        return res.json({
            rota_id: rotaId,
            motorista: motQ.rowCount ? { id: Number(motQ.rows[0].id), nome: motQ.rows[0].nome } : null,
            monitor: monitores.length ? monitores[0] : null,
            monitores
        });
    } catch (err) {
        console.error('Erro ao carregar associações da rota:', err);
        return res.status(500).json({ error: 'Erro ao carregar associações da rota.' });
    }
});

// Define (substitui) motorista da rota
router.patch('/:id/motorista', async (req, res) => {
    const tenantId = obterTenantId(req);
    const rotaId = Number(req.params.id);
    const motoristaId = (req.body?.motorista_id != null && req.body.motorista_id !== '') ? Number(req.body.motorista_id) : null;

    if (!tenantId) return res.status(400).json({ error: 'Tenant não identificado.' });
    if (!rotaId || Number.isNaN(rotaId)) return res.status(400).json({ error: 'Rota inválida.' });
    if (motoristaId != null && Number.isNaN(motoristaId)) return res.status(400).json({ error: 'Motorista inválido.' });

    let client;
    try {
        const acc = await assertRotaAcessivel(req, res, rotaId, tenantId);
        if (!acc.ok) return;

        client = await pool.connect();
        await client.query('BEGIN');

        // valida motorista (quando informado)
        let motoristaRow = null;
        if (motoristaId != null) {
            const v = await client.query(
                `SELECT id, nome
                 FROM motoristas
                 WHERE id = $1 AND tenant_id = $2`,
                [motoristaId, tenantId]
            );
            if (!v.rowCount) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Motorista não encontrado.' });
            }
            motoristaRow = { id: Number(v.rows[0].id), nome: v.rows[0].nome };
        }

        // estratégia "1 por rota" na UI: remove vínculos atuais e cria o novo (se houver)
        await client.query(
            `DELETE FROM motoristas_rotas
             WHERE tenant_id = $1 AND rota_escolar_id = $2`,
            [tenantId, rotaId]
        );

        if (motoristaId != null) {
            await client.query(
                `INSERT INTO motoristas_rotas (tenant_id, motorista_id, rota_escolar_id, created_at)
                 VALUES ($1, $2, $3, NOW())
                 ON CONFLICT (tenant_id, motorista_id, rota_escolar_id) DO NOTHING`,
                [tenantId, motoristaId, rotaId]
            );
        }

        await client.query('COMMIT');
        return res.json({ success: true, rota_id: rotaId, motorista: motoristaRow });
    } catch (err) {
        try { if (client) await client.query('ROLLBACK'); } catch (e) { }
        console.error('Erro ao salvar motorista da rota:', err);
        return res.status(500).json({ error: 'Erro ao salvar motorista da rota.' });
    } finally {
        if (client) client.release();
    }
});

// Define (substitui) monitores da rota
router.patch('/:id/monitor', async (req, res) => {
    const tenantId = obterTenantId(req);
    const rotaId = Number(req.params.id);

    const monitorIdsRaw = Array.isArray(req.body?.monitor_ids)
        ? req.body.monitor_ids
        : ((req.body?.monitor_id != null && req.body.monitor_id !== '') ? [req.body.monitor_id] : []);

    const monitorIds = [...new Set(
        monitorIdsRaw
            .map((id) => Number(id))
            .filter((id) => Number.isInteger(id) && id > 0)
    )];

    if (!tenantId) return res.status(400).json({ error: 'Tenant não identificado.' });
    if (!rotaId || Number.isNaN(rotaId)) return res.status(400).json({ error: 'Rota inválida.' });

    let client;
    try {
        const acc = await assertRotaAcessivel(req, res, rotaId, tenantId);
        if (!acc.ok) return;

        client = await pool.connect();
        await client.query('BEGIN');

        let monitores = [];
        if (monitorIds.length) {
            const v = await client.query(
                `SELECT id, nome
                 FROM monitores
                 WHERE tenant_id = $1
                   AND id = ANY($2::int[])
                 ORDER BY nome ASC, id ASC`,
                [tenantId, monitorIds]
            );

            monitores = (v.rows || []).map((row) => ({ id: Number(row.id), nome: row.nome }));
            if (monitores.length !== monitorIds.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Um ou mais monitores não foram encontrados.' });
            }
        }

        await client.query(
            `DELETE FROM monitores_rotas
             WHERE tenant_id = $1 AND rota_escolar_id = $2`,
            [tenantId, rotaId]
        );

        for (const monitor of monitores) {
            await client.query(
                `INSERT INTO monitores_rotas (tenant_id, monitor_id, rota_escolar_id, created_at, updated_at)
                 VALUES ($1, $2, $3, NOW(), NOW())
                 ON CONFLICT (tenant_id, monitor_id, rota_escolar_id) DO UPDATE
                 SET updated_at = NOW()`,
                [tenantId, monitor.id, rotaId]
            );
        }

        await client.query('COMMIT');
        return res.json({
            success: true,
            rota_id: rotaId,
            monitor: monitores.length ? monitores[0] : null,
            monitores
        });
    } catch (err) {
        try { if (client) await client.query('ROLLBACK'); } catch (e) { }
        console.error('Erro ao salvar monitores da rota:', err);
        return res.status(500).json({ error: 'Erro ao salvar monitores da rota.' });
    } finally {
        if (client) client.release();
    }
});

// =========================
// Transferência manual de aluno entre rotas
// POST /api/rotas-*/transferir-aluno
// - Se houver vaga na rota destino (por turno), apenas transfere.
// - Se estiver lotada, exige aluno_troca_id para realizar a troca (swap) entre rotas.
// =========================

async function carregarTurnoDoAluno(client, tenantId, alunoId) {
    const r = await client.query(
        `
        SELECT id, turma, ano, modalidade, formato_letivo, etapa
        FROM alunos_municipais
        WHERE tenant_id = $1 AND id = $2
        `,
        [tenantId, alunoId]
    );
    if (!r.rows.length) return null;
    return inferirTurnoBackend(r.rows[0]);
}

function turnoToKey(turnoLabel) {
    if (turnoLabel === 'Manhã') return 'manha';
    if (turnoLabel === 'Tarde') return 'tarde';
    if (turnoLabel === 'Noite') return 'noite';
    if (turnoLabel === 'Integral') return 'integral';
    return null;
}



async function obterEscolaAtualDoAluno(client, tenantId, alunoId) {
    const r = await client.query(
        `
        SELECT ae.escola_id
        FROM alunos_escolas ae
        WHERE ae.aluno_id = $1 AND ae.tenant_id = $2
        ORDER BY ae.ano_letivo DESC NULLS LAST, ae.atualizado_em DESC NULLS LAST, ae.id DESC
        LIMIT 1
        `,
        [alunoId, tenantId]
    );
    return r.rowCount ? Number(r.rows[0].escola_id) : null;
}

async function obterEscolasAtendidasDaRota(client, tenantId, rotaId) {
    // 1) Preferência: escolas do itinerário vinculado à rota
    const q1 = await client.query(
        `
        SELECT DISTINCT ie.escola_id
        FROM itinerario_rotas ir
        JOIN itinerario_escola ie
          ON ie.itinerario_id = ir.itinerario_id
         AND ie.tenant_id = ir.tenant_id
        WHERE ir.rota_id = $1
          AND ir.tenant_id = $2
        `,
        [rotaId, tenantId]
    );
    if (q1.rowCount) return q1.rows.map(r => Number(r.escola_id)).filter(n => Number.isInteger(n) && n > 0);

    // 2) Fallback: escolas dos alunos atualmente associados à rota
    const q2 = await client.query(
        `
        SELECT DISTINCT ae.escola_id
        FROM rotas_escolares_alunos ra
        JOIN alunos_escolas ae
          ON ae.aluno_id = ra.aluno_id
         AND ae.tenant_id = ra.tenant_id
        WHERE ra.rota_id = $1
          AND ra.tenant_id = $2
        `,
        [rotaId, tenantId]
    );
    return q2.rows.map(r => Number(r.escola_id)).filter(n => Number.isInteger(n) && n > 0);
}

async function validarTransferenciaPorEscola(client, tenantId, alunoId, rotaOrigemId, rotaDestinoId) {
    const escolaAlunoId = await obterEscolaAtualDoAluno(client, tenantId, alunoId);
    if (!escolaAlunoId) {
        return { ok: false, status: 400, msg: 'Aluno sem escola vinculada (alunos_escolas).' };
    }

    const escolasOrigem = await obterEscolasAtendidasDaRota(client, tenantId, rotaOrigemId);
    if (escolasOrigem.length && !escolasOrigem.includes(escolaAlunoId)) {
        return { ok: false, status: 400, msg: 'O aluno não pertence a nenhuma escola atendida pela rota origem.' };
    }

    const escolasDestino = await obterEscolasAtendidasDaRota(client, tenantId, rotaDestinoId);
    if (!escolasDestino.includes(escolaAlunoId)) {
        return { ok: false, status: 400, msg: 'Não é possível transferir: a rota destino não atende a escola do aluno.' };
    }

    return { ok: true, escolaAlunoId };
}

async function atualizarMetaRota(client, tenantId, rotaId) {
    // Recalcula contadores por turno e (se aplicável) pontos
    const alunosRes = await client.query(
        `
        SELECT a.id, a.turma, a.ano, a.modalidade, a.formato_letivo, a.etapa, ra.ponto_id
        FROM rotas_escolares_alunos ra
        JOIN alunos_municipais a ON a.id = ra.aluno_id AND a.tenant_id = ra.tenant_id
        WHERE ra.tenant_id = $1 AND ra.rota_id = $2
        `,
        [tenantId, rotaId]
    );

    const cont = { manha: 0, tarde: 0, noite: 0, integral: 0 };
    const pontoMap = new Map(); // ponto_id -> qtd

    for (const row of (alunosRes.rows || [])) {
        const turno = inferirTurnoBackend(row);
        const k = turnoToKey(turno);
        if (k) cont[k] += 1;

        const pid = row.ponto_id != null ? Number(row.ponto_id) : null;
        if (pid && pid > 0) {
            pontoMap.set(pid, (pontoMap.get(pid) || 0) + 1);
        }
    }

    const qtdParadas = pontoMap.size;

    await client.query(
        `
        UPDATE rotas_escolares
           SET qtd_alunos_manha = $1,
               qtd_alunos_tarde = $2,
               qtd_alunos_noite = $3,
               qtd_alunos_integral = $4,
               qtd_paradas = $5,
               updated_at = NOW()
         WHERE tenant_id = $6 AND id = $7
        `,
        [cont.manha, cont.tarde, cont.noite, cont.integral, qtdParadas, tenantId, rotaId]
    );

    // Atualiza tabela de pontos (se existir/alunos tiverem ponto_id)
    // Para rotas exclusivas, ponto_id tende a ser NULL e a atualização vira no-op.
    await client.query(
        `DELETE FROM rotas_escolares_pontos WHERE tenant_id = $1 AND rota_id = $2`,
        [tenantId, rotaId]
    );

    for (const [pontoId, qtd] of pontoMap.entries()) {
        await client.query(
            `
            INSERT INTO rotas_escolares_pontos (rota_id, ponto_id, qtd_alunos, tenant_id)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (rota_id, ponto_id)
            DO UPDATE SET qtd_alunos = EXCLUDED.qtd_alunos
            `,
            [rotaId, pontoId, qtd, tenantId]
        );
    }
}


/*
 * GET /api/rotas-rotas-destino-transferencia?aluno_id=...&rota_origem_id=...
 * Lista rotas (inclusive de outros itinerários) elegíveis para receber o aluno,
 * exigindo que a rota atenda a escola do aluno.
 */
router.get('/rotas-destino-transferencia', async (req, res) => {
    try {
        const tenantId = obterTenantId(req);
        if (!tenantId) return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });

        const alunoId = Number(req.query?.aluno_id);
        const rotaOrigemId = Number(req.query?.rota_origem_id);

        if (!Number.isInteger(alunoId) || alunoId <= 0 || !Number.isInteger(rotaOrigemId) || rotaOrigemId <= 0) {
            return res.status(400).json({ error: 'Parâmetros inválidos.' });
        }

        const client = await pool.connect();
        try {
            const escolaAlunoId = await obterEscolaAtualDoAluno(client, tenantId, alunoId);
            if (!escolaAlunoId) return res.json([]);

            const sql = `
                SELECT
                    r.id,
                    r.nome,
                    r.capacidade,
                    r.qtd_alunos_manha,
                    r.qtd_alunos_tarde,
                    r.qtd_alunos_noite,
                    r.qtd_alunos_integral,
                    r.tipo,
                    ir.itinerario_id,
                    i.nome AS itinerario_nome
                FROM rotas_escolares r
                LEFT JOIN itinerario_rotas ir
                  ON ir.rota_id = r.id
                 AND ir.tenant_id = r.tenant_id
                LEFT JOIN itinerarios i
                  ON i.id = ir.itinerario_id
                 AND i.tenant_id = r.tenant_id
                WHERE r.tenant_id = $1
                  AND r.status = 'ativo'
                  AND r.tipo = $2
                  AND r.id <> $3
                  AND (
                      EXISTS (
                        SELECT 1
                          FROM itinerario_rotas ir2
                          JOIN itinerario_escola ie
                            ON ie.itinerario_id = ir2.itinerario_id
                           AND ie.tenant_id = ir2.tenant_id
                         WHERE ir2.rota_id = r.id
                           AND ir2.tenant_id = $1
                           AND ie.escola_id = $4
                      )
                      OR EXISTS (
                        SELECT 1
                          FROM rotas_escolares_alunos ra
                          JOIN alunos_escolas ae
                            ON ae.aluno_id = ra.aluno_id
                           AND ae.tenant_id = ra.tenant_id
                         WHERE ra.rota_id = r.id
                           AND ra.tenant_id = $1
                           AND ae.escola_id = $4
                      )
                  )
                ORDER BY ir.itinerario_id NULLS LAST, r.id;
            `;
            const { rows } = await client.query(sql, [tenantId, 'municipal', rotaOrigemId, escolaAlunoId]);
            return res.json(rows || []);
        } finally {
            client.release();
        }
    } catch (err) {
        console.error('Erro ao listar rotas destino para transferência:', err);
        return res.status(500).json({ error: 'Erro ao listar rotas destino para transferência.' });
    }
});

router.post('/transferir-aluno', async (req, res) => {
    if (typeof isFornecedorEscolar === 'function' && isFornecedorEscolar(req)) {
        return res.status(403).json({ error: 'Ação não permitida para perfil de fornecedor.' });
    }

    const tenantId = obterTenantId(req);

    const alunoId = Number(req.body?.aluno_id);
    const rotaOrigemId = Number(req.body?.rota_origem_id);
    const rotaDestinoId = Number(req.body?.rota_destino_id);
    const alunoTrocaId = req.body?.aluno_troca_id != null && req.body?.aluno_troca_id !== ''
        ? Number(req.body.aluno_troca_id)
        : null;

    if (!Number.isInteger(alunoId) || alunoId <= 0 ||
        !Number.isInteger(rotaOrigemId) || rotaOrigemId <= 0 ||
        !Number.isInteger(rotaDestinoId) || rotaDestinoId <= 0 ||
        rotaOrigemId === rotaDestinoId) {
        return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Garante que o aluno está na rota origem
        const origLink = await client.query(
            `
            SELECT rota_id, aluno_id, ponto_id
            FROM rotas_escolares_alunos
            WHERE tenant_id = $1 AND rota_id = $2 AND aluno_id = $3
            FOR UPDATE
            `,
            [tenantId, rotaOrigemId, alunoId]
        );
        if (!origLink.rows.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Aluno não encontrado na rota de origem.' });
        }


        // Validação: rota destino precisa atender a escola do aluno (inclusive para outros itinerários)
        const validSchool = await validarTransferenciaPorEscola(client, tenantId, alunoId, rotaOrigemId, rotaDestinoId);
        if (!validSchool.ok) {
            await client.query('ROLLBACK');
            return res.status(validSchool.status || 400).json({ error: validSchool.msg });
        }
        // Busca metadados das rotas (capacidade)
        const rotasRes = await client.query(
            `
            SELECT 
              r.id,
              r.nome,
              COALESCE(r.capacidade, (SELECT v.capacidade_lotacao FROM veiculos v WHERE v.id = r.veiculo_id AND v.tenant_id = r.tenant_id)) AS capacidade,
              COALESCE(r.qtd_alunos_manha,0)::int     AS qtd_alunos_manha,
              COALESCE(r.qtd_alunos_tarde,0)::int     AS qtd_alunos_tarde,
              COALESCE(r.qtd_alunos_noite,0)::int     AS qtd_alunos_noite,
              COALESCE(r.qtd_alunos_integral,0)::int  AS qtd_alunos_integral
            FROM rotas_escolares r
            WHERE r.tenant_id = $1
              AND r.id = ANY($2::bigint[])
            FOR UPDATE OF r
            `,
            [tenantId, [rotaOrigemId, rotaDestinoId]]
        );

        const rotaOrigem = (rotasRes.rows || []).find(r => Number(r.id) === rotaOrigemId);
        const rotaDestino = (rotasRes.rows || []).find(r => Number(r.id) === rotaDestinoId);

        if (!rotaOrigem || !rotaDestino) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Rota de origem/destino não encontrada.' });
        }

        const turnoAluno = await carregarTurnoDoAluno(client, tenantId, alunoId);
        const turnoKey = turnoToKey(turnoAluno);
        if (!turnoKey) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Não foi possível inferir o turno do aluno.' });
        }

        // Regra: Integral não mistura com outros turnos
        const destinoOutros = Number(rotaDestino.qtd_alunos_manha || 0) +
            Number(rotaDestino.qtd_alunos_tarde || 0) +
            Number(rotaDestino.qtd_alunos_noite || 0);
        const destinoIntegral = Number(rotaDestino.qtd_alunos_integral || 0);

        if (turnoAluno === 'Integral' && destinoOutros > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'A rota destino já possui alunos diurnos/noturnos. Integral não pode ser misturado.' });
        }
        if (turnoAluno !== 'Integral' && destinoIntegral > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'A rota destino é Integral. Não é permitido misturar alunos de outros turnos.' });
        }

        const capDestino = rotaDestino.capacidade != null ? Number(rotaDestino.capacidade) : null;
        const usadoDestinoTurno = Number(rotaDestino['qtd_alunos_' + turnoKey] || 0);

        // Se está lotada no turno -> exige troca
        if (capDestino && usadoDestinoTurno >= capDestino) {
            if (!alunoTrocaId || !Number.isInteger(alunoTrocaId) || alunoTrocaId <= 0) {
                // retorna lista de alunos do mesmo turno na rota destino para escolher troca
                const alunosDestinoRes = await client.query(
                    `
                    SELECT 
                      a.id,
                      a.pessoa_nome,
                      e.nome AS escola_nome,
                      a.turma,
                      a.ano,
                      a.modalidade,
                      a.formato_letivo,
                      a.etapa
                    FROM rotas_escolares_alunos ra
                    JOIN alunos_municipais a ON a.id = ra.aluno_id AND a.tenant_id = ra.tenant_id
                    LEFT JOIN alunos_escolas ae ON ae.aluno_id = a.id
                    LEFT JOIN escolas e ON e.id = ae.escola_id
                    WHERE ra.tenant_id = $1
                      AND ra.rota_id = $2
                    `,
                    [tenantId, rotaDestinoId]
                );

                const alunosMesmoTurno = (alunosDestinoRes.rows || [])
                    .filter(row => inferirTurnoBackend(row) === turnoAluno)
                    .map(row => ({ id: row.id, pessoa_nome: row.pessoa_nome, escola_nome: row.escola_nome }));

                await client.query('ROLLBACK');
                return res.status(409).json({
                    error: 'Rota destino lotada. Selecione um aluno para trocar.',
                    require_troca: true,
                    alunos_destino: alunosMesmoTurno
                });
            }

            // valida alunoTrocaId na rota destino
            const destLink = await client.query(
                `
                SELECT rota_id, aluno_id, ponto_id
                FROM rotas_escolares_alunos
                WHERE tenant_id = $1 AND rota_id = $2 AND aluno_id = $3
                FOR UPDATE
                `,
                [tenantId, rotaDestinoId, alunoTrocaId]
            );
            if (!destLink.rows.length) {
                await client.query('ROLLBACK');
                return res.status(404).json({ error: 'Aluno para troca não encontrado na rota destino.' });
            }

            const turnoTroca = await carregarTurnoDoAluno(client, tenantId, alunoTrocaId);
            if (turnoTroca !== turnoAluno) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'O aluno selecionado para troca precisa ser do mesmo turno.' });
            }

            // swap: alunoId -> destino ; alunoTrocaId -> origem
            const pontoOrigem = origLink.rows[0].ponto_id || null;
            const pontoDestino = destLink.rows[0].ponto_id || null;


            // swap sem apagar registro do aluno (somente UPDATE no vínculo rota<->aluno)
            await client.query(
                `
                UPDATE rotas_escolares_alunos
                   SET rota_id = $1,
                       ponto_id = $2
                 WHERE tenant_id = $3
                   AND rota_id = $4
                   AND aluno_id = $5
                `,
                [rotaDestinoId, pontoOrigem, tenantId, rotaOrigemId, alunoId]
            );

            await client.query(
                `
                UPDATE rotas_escolares_alunos
                   SET rota_id = $1,
                       ponto_id = $2
                 WHERE tenant_id = $3
                   AND rota_id = $4
                   AND aluno_id = $5
                `,
                [rotaOrigemId, pontoDestino, tenantId, rotaDestinoId, alunoTrocaId]
            );
            await atualizarMetaRota(client, tenantId, rotaOrigemId);
            await atualizarMetaRota(client, tenantId, rotaDestinoId);

            await client.query('COMMIT');
            return res.json({ success: true, modo: 'troca', rota_origem_id: rotaOrigemId, rota_destino_id: rotaDestinoId });
        }

        // Transferência simples
        const pontoOrigem = origLink.rows[0].ponto_id || null;

        await client.query(
            `DELETE FROM rotas_escolares_alunos WHERE tenant_id = $1 AND rota_id = $2 AND aluno_id = $3`,
            [tenantId, rotaOrigemId, alunoId]
        );
        await client.query(
            `
            INSERT INTO rotas_escolares_alunos (rota_id, aluno_id, ponto_id, tenant_id)
            VALUES ($1,$2,$3,$4)
            ON CONFLICT (rota_id, aluno_id) DO NOTHING
            `,
            [rotaDestinoId, alunoId, pontoOrigem, tenantId]
        );

        await atualizarMetaRota(client, tenantId, rotaOrigemId);
        await atualizarMetaRota(client, tenantId, rotaDestinoId);

        await client.query('COMMIT');
        return res.json({ success: true, modo: 'transferencia', rota_origem_id: rotaOrigemId, rota_destino_id: rotaDestinoId });
    } catch (err) {
        try { if (client) await client.query('ROLLBACK'); } catch (e) { }
        console.error('Erro ao transferir aluno:', err);
        return res.status(500).json({ error: 'Erro ao transferir aluno.' });
    } finally {
        if (client) client.release();
    }
});



// POST /api/rotas-*/transferir-alunos
// Transfere múltiplos alunos da rota origem para a rota destino (mesmo turno do vínculo atual do aluno).
// Observação: este endpoint NÃO faz troca automática (swap). Se a rota destino lotar, retorne erro e o usuário
// deve fazer em partes ou usar a transferência unitária com troca.
router.post('/transferir-alunos', async (req, res) => {
    if (typeof isFornecedorEscolar === 'function' && isFornecedorEscolar(req)) {
        return res.status(403).json({ error: 'Ação não permitida para perfil de fornecedor.' });
    }

    const tenantId = obterTenantId(req);

    const alunoIdsRaw = req.body?.aluno_ids;
    const rotaOrigemId = Number(req.body?.rota_origem_id);
    const rotaDestinoId = Number(req.body?.rota_destino_id);

    const alunoIds = Array.isArray(alunoIdsRaw)
        ? alunoIdsRaw.map(n => Number(n)).filter(n => Number.isInteger(n) && n > 0)
        : [];

    if (!alunoIds.length ||
        !Number.isInteger(rotaOrigemId) || rotaOrigemId <= 0 ||
        !Number.isInteger(rotaDestinoId) || rotaDestinoId <= 0 ||
        rotaOrigemId === rotaDestinoId) {
        return res.status(400).json({ error: 'Parâmetros inválidos.' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        // Lock rotas (capacidade e contagens)
        const rotasRes = await client.query(
            `
            SELECT 
              r.id,
              r.nome,
              COALESCE(r.capacidade, (SELECT v.capacidade_lotacao FROM veiculos v WHERE v.id = r.veiculo_id AND v.tenant_id = r.tenant_id)) AS capacidade,
              COALESCE(r.qtd_alunos_manha,0)::int     AS qtd_alunos_manha,
              COALESCE(r.qtd_alunos_tarde,0)::int     AS qtd_alunos_tarde,
              COALESCE(r.qtd_alunos_noite,0)::int     AS qtd_alunos_noite,
              COALESCE(r.qtd_alunos_integral,0)::int  AS qtd_alunos_integral
            FROM rotas_escolares r
            WHERE r.tenant_id = $1
              AND r.id = ANY($2::bigint[])
            FOR UPDATE OF r
            `,
            [tenantId, [rotaOrigemId, rotaDestinoId]]
        );

        const rotaOrigem = (rotasRes.rows || []).find(r => Number(r.id) === rotaOrigemId);
        const rotaDestino = (rotasRes.rows || []).find(r => Number(r.id) === rotaDestinoId);

        if (!rotaOrigem || !rotaDestino) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Rota de origem/destino não encontrada.' });
        }

        // Carrega vínculos na origem (FOR UPDATE), para pegar ponto_id e garantir que estão na origem
        const linksRes = await client.query(
            `
            SELECT rota_id, aluno_id, ponto_id
            FROM rotas_escolares_alunos
            WHERE tenant_id = $1
              AND rota_id = $2
              AND aluno_id = ANY($3::bigint[])
            FOR UPDATE
            `,
            [tenantId, rotaOrigemId, alunoIds]
        );

        const links = linksRes.rows || [];
        const foundIds = new Set(links.map(r => Number(r.aluno_id)));
        const missing = alunoIds.filter(id => !foundIds.has(id));
        if (missing.length) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Alguns alunos não foram encontrados na rota de origem.', missing_aluno_ids: missing });
        }

        // Determina turno de todos e valida (todos devem ser do mesmo turno)
        let turnoRef = null;
        for (const alunoId of alunoIds) {
            const turnoAluno = await carregarTurnoDoAluno(client, tenantId, alunoId);
            if (!turnoAluno) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Não foi possível inferir o turno de um dos alunos.', aluno_id: alunoId });
            }
            if (turnoRef == null) turnoRef = turnoAluno;
            if (turnoRef !== turnoAluno) {
                await client.query('ROLLBACK');
                return res.status(400).json({ error: 'Para transferência em lote, selecione alunos do mesmo turno.' });
            }

            // Validação por escola (rota destino deve atender)
            const validSchool = await validarTransferenciaPorEscola(client, tenantId, alunoId, rotaOrigemId, rotaDestinoId);
            if (!validSchool.ok) {
                await client.query('ROLLBACK');
                return res.status(validSchool.status || 400).json({ error: validSchool.msg, aluno_id: alunoId });
            }
        }

        const turnoKey = turnoToKey(turnoRef);
        if (!turnoKey) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Não foi possível inferir o turno do lote.' });
        }

        // Regra: Integral não mistura com outros turnos
        const destinoOutros = Number(rotaDestino.qtd_alunos_manha || 0) +
            Number(rotaDestino.qtd_alunos_tarde || 0) +
            Number(rotaDestino.qtd_alunos_noite || 0);
        const destinoIntegral = Number(rotaDestino.qtd_alunos_integral || 0);

        if (turnoRef === 'Integral' && destinoOutros > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'A rota destino já possui alunos diurnos/noturnos. Integral não pode ser misturado.' });
        }
        if (turnoRef !== 'Integral' && destinoIntegral > 0) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'A rota destino é Integral. Não é permitido misturar alunos de outros turnos.' });
        }

        const capDestino = rotaDestino.capacidade != null ? Number(rotaDestino.capacidade) : null;
        const usadoDestinoTurno = Number(rotaDestino['qtd_alunos_' + turnoKey] || 0);

        if (capDestino && (usadoDestinoTurno + alunoIds.length) > capDestino) {
            await client.query('ROLLBACK');
            return res.status(409).json({ error: 'Rota destino sem capacidade suficiente para todos os alunos selecionados.' });
        }

        // Executa transferências
        for (const link of links) {
            const alunoId = Number(link.aluno_id);
            const pontoOrigem = link.ponto_id || null;

            await client.query(
                `DELETE FROM rotas_escolares_alunos WHERE tenant_id = $1 AND rota_id = $2 AND aluno_id = $3`,
                [tenantId, rotaOrigemId, alunoId]
            );

            await client.query(
                `
                INSERT INTO rotas_escolares_alunos (rota_id, aluno_id, ponto_id, tenant_id)
                VALUES ($1,$2,$3,$4)
                ON CONFLICT (rota_id, aluno_id) DO NOTHING
                `,
                [rotaDestinoId, alunoId, pontoOrigem, tenantId]
            );
        }

        await atualizarMetaRota(client, tenantId, rotaOrigemId);
        await atualizarMetaRota(client, tenantId, rotaDestinoId);

        await client.query('COMMIT');
        return res.json({ success: true, modo: 'transferencia_lote', rota_origem_id: rotaOrigemId, rota_destino_id: rotaDestinoId, qtd: alunoIds.length, turno: turnoRef });
    } catch (err) {
        try { if (client) await client.query('ROLLBACK'); } catch (e) { }
        console.error('Erro ao transferir alunos (lote):', err);
        return res.status(500).json({ error: 'Erro ao transferir alunos.' });
    } finally {
        if (client) client.release();
    }
});


async function carregarDadosBaseDoItinerarioDaRota(client, tenantId, itinerarioId) {
    const itRes = await client.query(
        `SELECT id, COALESCE(tipo, 'municipal') AS tipo FROM itinerarios WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
        [itinerarioId, tenantId]
    );
    if (!itRes.rowCount) return null;

    const escolasRes = await client.query(
        `
        SELECT DISTINCT e.id, e.nome,
               ST_Y(e.localizacao)::float AS lat,
               ST_X(e.localizacao)::float AS lng
          FROM itinerario_escola ie
          JOIN escolas e ON e.id = ie.escola_id
         WHERE ie.itinerario_id = $1
           AND ie.tenant_id = $2
         ORDER BY e.nome
        `,
        [itinerarioId, tenantId]
    );
    const escolas = (escolasRes.rows || []).map(r => ({
        id: Number(r.id),
        nome: r.nome,
        lat: r.lat != null ? Number(r.lat) : null,
        lng: r.lng != null ? Number(r.lng) : null
    }));
    const escolaIds = escolas.map(e => e.id).filter(n => Number.isInteger(n) && n > 0);

    const zoneRes = await client.query(
        `SELECT DISTINCT zoneamento_id FROM itinerario_zoneamento WHERE itinerario_id = $1 AND tenant_id = $2`,
        [itinerarioId, tenantId]
    );
    const zoneamentoIds = (zoneRes.rows || []).map(r => Number(r.zoneamento_id)).filter(n => Number.isInteger(n) && n > 0);

    let pontos = [];
    let pontoIds = [];

    if (zoneamentoIds.length) {
        const pontosRes = await client.query(
            `
            WITH zona AS (
                SELECT UNNEST($1::int[]) AS zoneamento_id
            ),
            pontos_zona AS (
                SELECT DISTINCT p.id,
                       TRIM(CONCAT_WS(' - ',
                           NULLIF(TRIM(COALESCE(p.logradouro, '')), ''),
                           NULLIF(TRIM(COALESCE(p.numero, '')), ''),
                           NULLIF(TRIM(COALESCE(p.bairro, '')), '')
                       )) AS nome,
                       p.logradouro,
                       p.numero,
                       p.bairro,
                       p.referencia,
                       p.status,
                       ST_Y(p.localizacao)::float AS lat,
                       ST_X(p.localizacao)::float AS lng
                  FROM pontos_parada p
                  JOIN zona z ON z.zoneamento_id = p.zoneamento_id
                 WHERE p.tenant_id = $2
                UNION
                SELECT DISTINCT p.id,
                       TRIM(CONCAT_WS(' - ',
                           NULLIF(TRIM(COALESCE(p.logradouro, '')), ''),
                           NULLIF(TRIM(COALESCE(p.numero, '')), ''),
                           NULLIF(TRIM(COALESCE(p.bairro, '')), '')
                       )) AS nome,
                       p.logradouro,
                       p.numero,
                       p.bairro,
                       p.referencia,
                       p.status,
                       ST_Y(p.localizacao)::float AS lat,
                       ST_X(p.localizacao)::float AS lng
                  FROM pontos_zoneamentos pz
                  JOIN pontos_parada p ON p.id = pz.ponto_id AND p.tenant_id = $2
                  JOIN zona z ON z.zoneamento_id = pz.zoneamento_id
            )
            SELECT *
              FROM pontos_zona
             ORDER BY COALESCE(nome, logradouro, referencia, bairro, id::text)
            `,
            [zoneamentoIds, tenantId]
        );
        pontos = (pontosRes.rows || []).map(r => ({
            id: Number(r.id),
            nome: r.nome || null,
            logradouro: r.logradouro || null,
            numero: r.numero || null,
            referencia: r.referencia || null,
            bairro: r.bairro || null,
            status: r.status || null,
            lat: r.lat != null ? Number(r.lat) : null,
            lng: r.lng != null ? Number(r.lng) : null
        }));
        pontoIds = pontos.map(p => p.id).filter(n => Number.isInteger(n) && n > 0);
    }

    let alunos = [];
    if (escolaIds.length && pontoIds.length) {
        const alunosRes = await client.query(
            `
            SELECT
                a.id,
                a.pessoa_nome,
                a.turma,
                a.ano,
                a.modalidade,
                a.formato_letivo,
                a.etapa,
                ap.ponto_id,
                ST_Y(a.localizacao)::float AS lat,
                ST_X(a.localizacao)::float AS lng,
                ae.escola_id,
                e.nome AS escola_nome
            FROM alunos_municipais a
            JOIN alunos_pontos ap ON ap.aluno_id = a.id
            JOIN alunos_escolas ae ON ae.aluno_id = a.id AND ae.tenant_id = a.tenant_id
            LEFT JOIN escolas e ON e.id = ae.escola_id
            WHERE a.tenant_id = $3
              AND a.transporte_apto = TRUE
              AND COALESCE(a.rota_exclusiva, FALSE) = FALSE
              AND ae.escola_id = ANY($1::int[])
              AND ap.ponto_id = ANY($2::int[])
            ORDER BY a.pessoa_nome
            `,
            [escolaIds, pontoIds, tenantId]
        );

        const mapAlunos = new Map();
        for (const row of (alunosRes.rows || [])) {
            const id = Number(row.id);
            if (!mapAlunos.has(id)) {
                mapAlunos.set(id, {
                    id,
                    nome: row.pessoa_nome,
                    lat: row.lat != null ? Number(row.lat) : null,
                    lng: row.lng != null ? Number(row.lng) : null,
                    turno: inferirTurnoBackend(row),
                    escola_id: row.escola_id != null ? Number(row.escola_id) : null,
                    escola_nome: row.escola_nome || null,
                    ponto_ids: []
                });
            }
            const aluno = mapAlunos.get(id);
            const pid = Number(row.ponto_id);
            if (Number.isInteger(pid) && pid > 0 && !aluno.ponto_ids.includes(pid)) {
                aluno.ponto_ids.push(pid);
            }
        }
        alunos = Array.from(mapAlunos.values()).filter(a => a.turno !== 'Não informado');
    }

    return {
        tipo: (itRes.rows[0].tipo || 'municipal').toString().toLowerCase(),
        escolas,
        escola_ids: escolaIds,
        zoneamento_ids: zoneamentoIds,
        pontos,
        ponto_ids: pontoIds,
        alunos
    };
}

router.get('/:id/detalhes-edicao', async (req, res) => {
    const rotaId = parseInt(req.params.id, 10);
    if (!Number.isInteger(rotaId)) {
        return res.status(400).json({ error: 'ID de rota inválido.' });
    }

    let client;
    try {
        const tenantId = obterTenantId(req);
        if (!tenantId) {
            return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
        }
        const acc = await assertRotaAcessivel(req, res, rotaId, tenantId);
        if (!acc.ok) return;

        client = await pool.connect();
        const rotaRes = await client.query(
            `
            SELECT r.id, r.nome, r.tenant_id, ir.itinerario_id
              FROM rotas_escolares r
              LEFT JOIN itinerario_rotas ir ON ir.rota_id = r.id AND ir.tenant_id = r.tenant_id
             WHERE r.id = $1 AND r.tenant_id = $2
             LIMIT 1
            `,
            [rotaId, tenantId]
        );
        if (!rotaRes.rowCount) return res.status(404).json({ error: 'Rota não encontrada.' });
        const rota = rotaRes.rows[0];
        if (!rota.itinerario_id) return res.status(400).json({ error: 'Rota não vinculada a um itinerário.' });

        const base = await carregarDadosBaseDoItinerarioDaRota(client, tenantId, Number(rota.itinerario_id));
        if (!base) return res.status(404).json({ error: 'Itinerário da rota não encontrado.' });

        const pontosSelRes = await client.query(
            `
            SELECT ponto_id
              FROM rotas_escolares_pontos
             WHERE rota_id = $1
               AND tenant_id = $2
             ORDER BY id ASC
            `,
            [rotaId, tenantId]
        );
        const pontoIdsSelecionados = (pontosSelRes.rows || []).map(r => Number(r.ponto_id)).filter(n => Number.isInteger(n) && n > 0);

        return res.json({
            rota_id: Number(rota.id),
            rota_nome: rota.nome,
            itinerario_id: Number(rota.itinerario_id),
            nome_previsto: rota.nome,
            tipo: base.tipo,
            escolas: base.escolas,
            escola_ids: base.escola_ids,
            zoneamento_ids: base.zoneamento_ids,
            pontos: base.pontos,
            ponto_ids: pontoIdsSelecionados,
            alunos: base.alunos
        });
    } catch (err) {
        console.error('Erro ao carregar detalhes de edição da rota:', err);
        return res.status(500).json({ error: 'Erro ao carregar detalhes da rota.' });
    } finally {
        if (client) client.release();
    }
});

router.put('/:id', async (req, res) => {
    if (isFornecedorEscolar(req)) {
        return res.status(403).json({ error: 'Ação não permitida para FORNECEDOR_ESCOLAR.' });
    }

    const rotaId = parseInt(req.params.id, 10);
    if (!Number.isInteger(rotaId)) {
        return res.status(400).json({ error: 'ID de rota inválido.' });
    }

    const tenantId = obterTenantId(req);
    if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
    }

    const pontoIdsBody = Array.isArray(req.body?.ponto_ids) ? req.body.ponto_ids : [];
    const pontoIds = pontoIdsBody
        .map(v => Number.parseInt(String(v), 10))
        .filter((v, i, arr) => Number.isInteger(v) && v > 0 && arr.indexOf(v) === i);

    if (!pontoIds.length) {
        return res.status(400).json({ error: 'Selecione pelo menos um ponto de parada.' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const rotaRes = await client.query(
            `SELECT r.id, r.nome, ir.itinerario_id FROM rotas_escolares r LEFT JOIN itinerario_rotas ir ON ir.rota_id = r.id AND ir.tenant_id = r.tenant_id WHERE r.id = $1 AND r.tenant_id = $2 LIMIT 1`,
            [rotaId, tenantId]
        );
        if (!rotaRes.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Rota não encontrada.' });
        }
        const rota = rotaRes.rows[0];
        if (!rota.itinerario_id) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Rota não vinculada a um itinerário.' });
        }

        const dados = await carregarDadosBaseDoItinerarioDaRota(client, tenantId, Number(rota.itinerario_id));
        if (!dados) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Itinerário da rota não encontrado.' });
        }

        const pontosValidos = new Set((dados.pontos || []).map(p => Number(p.id)));
        const pontosInvalidos = pontoIds.filter(pid => !pontosValidos.has(pid));
        if (pontosInvalidos.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Há pontos selecionados que não pertencem a este itinerário.' });
        }

        const alunosSelecionados = (dados.alunos || []).filter(aluno =>
            Array.isArray(aluno.ponto_ids) && aluno.ponto_ids.some(pid => pontoIds.includes(Number(pid)))
        );

        if (!alunosSelecionados.length) {
            await client.query('ROLLBACK');
            return res.status(400).json({ error: 'Nenhum aluno elegível foi encontrado para os pontos selecionados.' });
        }

        const contPorPonto = new Map();
        for (const aluno of alunosSelecionados) {
            const pid = (aluno.ponto_ids || []).find(x => pontoIds.includes(Number(x)));
            if (pid) contPorPonto.set(Number(pid), (contPorPonto.get(Number(pid)) || 0) + 1);
        }

        await client.query(`DELETE FROM rotas_escolares_alunos WHERE rota_id = $1 AND tenant_id = $2`, [rotaId, tenantId]);
        await client.query(`DELETE FROM rotas_escolares_pontos WHERE rota_id = $1 AND tenant_id = $2`, [rotaId, tenantId]);

        for (const aluno of alunosSelecionados) {
            const pontoPrincipal = (aluno.ponto_ids || []).find(x => pontoIds.includes(Number(x))) || null;
            await client.query(
                `INSERT INTO rotas_escolares_alunos (rota_id, aluno_id, ponto_id, tenant_id) VALUES ($1, $2, $3, $4) ON CONFLICT (rota_id, aluno_id) DO NOTHING`,
                [rotaId, aluno.id, pontoPrincipal, tenantId]
            );
        }

        for (const pid of pontoIds) {
            await client.query(
                `INSERT INTO rotas_escolares_pontos (rota_id, ponto_id, qtd_alunos, tenant_id) VALUES ($1, $2, $3, $4) ON CONFLICT (rota_id, ponto_id) DO UPDATE SET qtd_alunos = EXCLUDED.qtd_alunos`,
                [rotaId, pid, Number(contPorPonto.get(Number(pid)) || 0), tenantId]
            );
        }

        await atualizarMetaRota(client, tenantId, rotaId);
        await client.query(`UPDATE rotas_escolares SET capacidade = $1, updated_at = NOW() WHERE id = $2 AND tenant_id = $3`, [alunosSelecionados.length, rotaId, tenantId]);

        await client.query('COMMIT');
        return res.json({ success: true, message: `Rota ${rota.nome} atualizada com sucesso.`, rota_id: rotaId });
    } catch (err) {
        try { if (client) await client.query('ROLLBACK'); } catch (e) { }
        console.error('Erro ao atualizar rota manual:', err);
        return res.status(500).json({ error: 'Erro ao atualizar rota.' });
    } finally {
        if (client) client.release();
    }
});

router.delete('/:id', async (req, res) => {
    if (isFornecedorEscolar(req)) {
        return res.status(403).json({ error: 'Ação não permitida para FORNECEDOR_ESCOLAR.' });
    }

    const rotaId = parseInt(req.params.id, 10);
    if (!Number.isInteger(rotaId)) {
        return res.status(400).json({ error: 'ID de rota inválido.' });
    }

    const tenantId = obterTenantId(req);
    if (!tenantId) {
        return res.status(400).json({ error: 'tenant_id não informado no contexto da requisição.' });
    }

    let client;
    try {
        client = await pool.connect();
        await client.query('BEGIN');

        const rotaRes = await client.query(
            `SELECT id, nome FROM rotas_escolares WHERE id = $1 AND tenant_id = $2 LIMIT 1 FOR UPDATE`,
            [rotaId, tenantId]
        );
        if (!rotaRes.rowCount) {
            await client.query('ROLLBACK');
            return res.status(404).json({ error: 'Rota não encontrada.' });
        }
        const rota = rotaRes.rows[0];

        await client.query(`DELETE FROM itinerario_rotas WHERE rota_id = $1 AND tenant_id = $2`, [rotaId, tenantId]);
        await client.query(`DELETE FROM rotas_escolares_alunos WHERE rota_id = $1 AND tenant_id = $2`, [rotaId, tenantId]);
        await client.query(`DELETE FROM rotas_escolares_pontos WHERE rota_id = $1 AND tenant_id = $2`, [rotaId, tenantId]);
        try {
            await client.query(`DELETE FROM rotas_percursos WHERE rota_id = $1 AND tenant_id = $2`, [rotaId, tenantId]);
        } catch (e) {
        }
        await client.query(`DELETE FROM rotas_escolares WHERE id = $1 AND tenant_id = $2`, [rotaId, tenantId]);

        await client.query('COMMIT');
        return res.json({ success: true, message: `Rota ${rota.nome} excluída com sucesso.`, rota_id: rotaId });
    } catch (err) {
        try { if (client) await client.query('ROLLBACK'); } catch (e) { }
        console.error('Erro ao excluir rota:', err);
        return res.status(500).json({ error: 'Erro ao excluir rota.' });
    } finally {
        if (client) client.release();
    }
});

export default router;
