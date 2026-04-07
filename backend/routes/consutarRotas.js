// backend/routes/consutarRotas.js
// Rotas públicas (sem auth) para consulta de rota por PLACA, CPF, NOME (e também por ?q=).
// Suporta filtro de TURNO via querystring:
//   GET /api/public/consultar-rota?q=...&turno=manha|tarde|noite|integral|outros|todos
//
// Montagem no server.js:
//   app.use('/api/public', consutarRotasPublicas);

import express from 'express';

let __pool = null;
async function getPool() {
  if (__pool) return __pool;

  try {
    const mod = await import('../db.js');
    if (mod && mod.pool) {
      __pool = mod.pool;
      return __pool;
    }
    if (mod && mod.default) {
      __pool = mod.default;
      return __pool;
    }
  } catch (_) { }

  const pg = await import('pg');
  const { Pool } = pg;

  const connStr = process.env.DATABASE_URL;
  __pool = new Pool(
    connStr
      ? {
        connectionString: connStr,
        ssl: process.env.PGSSLMODE === 'require' ? { rejectUnauthorized: false } : undefined,
      }
      : {
        host: process.env.PGHOST || 'localhost',
        port: Number(process.env.PGPORT || 5432),
        user: process.env.PGUSER || 'postgres',
        password: process.env.PGPASSWORD || '',
        database: process.env.PGDATABASE || 'postgres',
      }
  );

  return __pool;
}

function onlyDigits(s) {
  return String(s || '').replace(/\D/g, '');
}
function normPlaca(s) {
  return String(s || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
}
function cleanNome(s) {
  return String(s || '').trim().replace(/\s+/g, ' ');
}

function detectKindFromQ(qRaw) {
  const q = String(qRaw || '').trim();
  if (!q) return { kind: null, value: '' };

  const digits = onlyDigits(q);
  const placa = normPlaca(q);

  // CPF: 11 dígitos
  if (digits.length === 11) return { kind: 'cpf', value: digits };

  // Placa: 7..10 alfanum (ex: OQW1A23 / ABC1234 / MERCOSUL)
  if (placa.length >= 7 && placa.length <= 10 && /[A-Z]/.test(placa) && /\d/.test(placa)) {
    return { kind: 'placa', value: placa };
  }

  // Nome
  return { kind: 'nome', value: cleanNome(q) };
}

function detectTurnoFromTurma(turmaTxt) {
  const t = String(turmaTxt || '').toUpperCase();
  if (t.includes('INT') || t.includes('INTEGRAL')) return 'integral';
  if (t.includes('NOT') || t.includes('NOTUR')) return 'noite';
  if (t.includes('VESP') || t.includes('VESPERT')) return 'tarde';
  if (t.includes('MAT') || t.includes('MATUT')) return 'manha';
  return 'outros';
}

function buildEnderecoPonto(row) {
  const logradouro = row?.logradouro || '';
  const numero = row?.numero || '';
  const complemento = row?.complemento || '';
  const bairro = row?.bairro || '';
  const cep = row?.cep || '';
  return (
    [logradouro, numero ? `, ${numero}` : ''].join('') +
    (complemento ? ` - ${complemento}` : '') +
    (bairro ? ` - ${bairro}` : '') +
    (cep ? ` - CEP ${cep}` : '')
  ).trim();
}

function buildEnderecoCasa(row) {
  const rua = row?.rua || '';
  const numero = row?.numero_pessoa_endereco || '';
  const bairro = row?.bairro || '';
  const cep = row?.cep || '';
  return (
    [rua, numero ? `, ${numero}` : ''].join('') +
    (bairro ? ` - ${bairro}` : '') +
    (cep ? ` - CEP ${cep}` : '')
  ).trim();
}

function normalizeTurnoParam(t) {
  t = String(t || '').trim().toLowerCase();
  if (!t || t === 'auto') return null;
  if (['manha', 'tarde', 'noite', 'integral', 'outros', 'todos'].includes(t)) return t;
  return null;
}

const router = express.Router();

/**
 * GET /api/public/consultar-rota?q=...
 * GET /api/public/consultar-rota?placa=ABC1D23
 * GET /api/public/consultar-rota?cpf=123.456.789-00
 * GET /api/public/consultar-rota?nome=Fulano de Tal
 * GET /api/public/consultar-rota?rota_id=123
 * Opcional: &turno=manha|tarde|noite|integral|outros|todos
 */
router.get('/consultar-rota', async (req, res) => {
  const rotaIdParam = req.query.rota_id ? String(req.query.rota_id).trim() : '';

  // compat
  let placa = normPlaca(req.query.placa);
  let cpf = onlyDigits(req.query.cpf);
  let nome = cleanNome(req.query.nome);

  // modo único
  const qRaw = req.query.q ? String(req.query.q) : '';
  if (!rotaIdParam && qRaw && !placa && !cpf && !nome) {
    const d = detectKindFromQ(qRaw);
    if (d.kind === 'placa') placa = d.value;
    else if (d.kind === 'cpf') cpf = d.value;
    else if (d.kind === 'nome') nome = d.value;
  }

  const turnoParam = normalizeTurnoParam(req.query.turno);

  if (!rotaIdParam && !placa && !cpf && !nome) {
    return res.status(400).json({ error: 'Informe placa, cpf, nome ou q para consultar.' });
  }

  try {
    const pool = await getPool();
    const q = (text, params) => pool.query(text, params);

    // 1) Descobrir a rota (id + tenant_id) por prioridade: rota_id -> placa -> cpf -> nome
    let rotaRef = null;

    if (rotaIdParam) {
      const rid = Number(rotaIdParam);
      if (!Number.isFinite(rid) || rid <= 0) {
        return res.status(400).json({ error: 'rota_id inválido.' });
      }
      const r0 = await q(
        `
        SELECT id, tenant_id
        FROM rotas_escolares
        WHERE id = $1
        LIMIT 1
        `,
        [rid]
      );
      rotaRef = r0.rows[0] || null;
    }

    if (!rotaRef && placa) {
      const r1 = await q(
        `
        SELECT r.id, r.tenant_id
        FROM rotas_escolares r
        JOIN veiculos v ON v.id = r.veiculo_id
        WHERE r.status = 'ativo'
          AND regexp_replace(upper(v.placa), '[^A-Z0-9]', '', 'g') = $1
        ORDER BY r.updated_at DESC
        LIMIT 1
        `,
        [placa]
      );
      rotaRef = r1.rows[0] || null;
    }

    if (!rotaRef && cpf) {
      const r2 = await q(
        `
        SELECT r.id, r.tenant_id
        FROM rotas_escolares r
        JOIN rotas_escolares_alunos ra ON ra.rota_id = r.id
        JOIN alunos_municipais a ON a.id = ra.aluno_id
        WHERE r.status = 'ativo'
          AND regexp_replace(coalesce(a.cpf,''), '\\D', '', 'g') = $1
        ORDER BY r.updated_at DESC
        LIMIT 1
        `,
        [cpf]
      );
      rotaRef = r2.rows[0] || null;
    }

    if (!rotaRef && nome) {
      const r3 = await q(
        `
        SELECT r.id, r.tenant_id
        FROM rotas_escolares r
        JOIN rotas_escolares_alunos ra ON ra.rota_id = r.id
        JOIN alunos_municipais a ON a.id = ra.aluno_id
        WHERE r.status = 'ativo'
          AND a.pessoa_nome ILIKE $1
        ORDER BY r.updated_at DESC
        LIMIT 1
        `,
        [`%${nome}%`]
      );
      rotaRef = r3.rows[0] || null;
    }

    if (!rotaRef) {
      return res.status(404).json({ error: 'Nenhuma rota ativa encontrada para os dados informados.' });
    }

    const rotaId = rotaRef.id;
    const tenantId = rotaRef.tenant_id;


    // 1.5) Identifica o "alvo" da busca (para destacar ponto no mapa quando a busca for por aluno)
    // - placa/rota_id: sem destaque específico
    // - cpf/nome: retorna aluno_id e ponto_id (quando existir)
    let match = null;

    if (cpf) {
      const mcpf = await q(
        `
        SELECT ra.aluno_id, ra.ponto_id
        FROM rotas_escolares_alunos ra
        JOIN alunos_municipais a ON a.id = ra.aluno_id
        WHERE ra.rota_id = $1
          AND regexp_replace(coalesce(a.cpf,''), '\\D', '', 'g') = $2
        LIMIT 1
        `,
        [rotaId, cpf]
      );
      if (mcpf.rows[0]) match = { kind: 'cpf', aluno_id: mcpf.rows[0].aluno_id, ponto_id: mcpf.rows[0].ponto_id };
    } else if (nome) {
      const mn = await q(
        `
        SELECT ra.aluno_id, ra.ponto_id
        FROM rotas_escolares_alunos ra
        JOIN alunos_municipais a ON a.id = ra.aluno_id
        WHERE ra.rota_id = $1
          AND a.pessoa_nome ILIKE $2
        ORDER BY a.pessoa_nome ASC
        LIMIT 1
        `,
        [rotaId, `%${nome}%`]
      );
      if (mn.rows[0]) match = { kind: 'nome', aluno_id: mn.rows[0].aluno_id, ponto_id: mn.rows[0].ponto_id };
    }

    // 2) Cabeçalho da rota + veículo + fornecedor
    const rotaHead = await q(
      `
      SELECT
        r.id,
        r.nome,
        r.tipo,
        r.status,
        r.capacidade,
        r.qtd_paradas,
        r.qtd_alunos_manha,
        r.qtd_alunos_tarde,
        r.qtd_alunos_noite,
        r.qtd_alunos_integral,
        r.veiculo_id,
        r.fornecedor_id,
        r.tenant_id,

        v.placa,
        v.prefixo,
        v.marca,
        v.modelo,
        v.capacidade_lotacao,
        v.possui_adaptacao,
        v.possui_plataforma,
        v.adaptacao_descricao,

        f.razao_social,
        f.nome_fantasia,
        f.telefone AS fornecedor_telefone,

        f.logradouro_garagem,
        f.numero_garagem,
        f.complemento_garagem,
        f.bairro_garagem,
        f.cidade_garagem,
        f.cep_garagem,
        f.referencia_garagem,
        ST_Y(f.garagem_localizacao)::float AS garagem_lat,
        ST_X(f.garagem_localizacao)::float AS garagem_lng
      FROM rotas_escolares r
      LEFT JOIN veiculos v ON v.id = r.veiculo_id
      LEFT JOIN fornecedores f ON f.id = r.fornecedor_id
      WHERE r.id = $1
      LIMIT 1
      `,
      [rotaId]
    );

    const rota = rotaHead.rows[0];
    if (!rota) return res.status(404).json({ error: 'Rota não encontrada.' });


    // 2.5) Motoristas e Monitores associados (N:N)
    const motoristasRes = await q(
      `
      SELECT DISTINCT m.id, m.nome
      FROM motoristas_rotas mr
      JOIN motoristas m ON m.id = mr.motorista_id
      WHERE mr.tenant_id = $2
        AND mr.rota_escolar_id = $1
      ORDER BY m.nome ASC
      `,
      [rotaId, tenantId]
    );

    const monitoresRes = await q(
      `
      SELECT DISTINCT mo.id, mo.nome, mo.telefone
      FROM monitores_rotas mro
      JOIN monitores mo ON mo.id = mro.monitor_id
      WHERE mro.tenant_id = $2
        AND mro.rota_escolar_id = $1
      ORDER BY mo.nome ASC
      `,
      [rotaId, tenantId]
    );

    const motoristas = motoristasRes.rows || [];
    const monitores = (monitoresRes.rows || []).map(x => ({
      id: x.id,
      nome: x.nome,
      telefone: x.telefone || null
    }));
    // 3) Alunos da rota (com ponto_id + dados do ponto para gerar lista/contagem por turno)
    const alunosRes = await q(
      `
      SELECT
        a.id AS aluno_id,
        a.pessoa_nome,
        a.cpf,
        a.turma,
        a.unidade_ensino,
        a.deficiencia,
        a.codigo_inep,

        a.cep,
        a.rua,
        a.numero_pessoa_endereco,
        a.bairro,
        a.filiacao_1,
        a.telefone_filiacao_1,
        a.filiacao_2,
        a.telefone_filiacao_2,
        a.responsavel,
        a.telefone_responsavel,
        ST_Y(a.localizacao)::float AS casa_lat,
        ST_X(a.localizacao)::float AS casa_lng,

        ra.ponto_id,

        p.logradouro,
        p.numero,
        p.complemento,
        p.bairro AS ponto_bairro,
        p.cep AS ponto_cep,
        ST_Y(p.localizacao)::float AS ponto_lat,
        ST_X(p.localizacao)::float AS ponto_lng
      FROM rotas_escolares_alunos ra
      JOIN alunos_municipais a ON a.id = ra.aluno_id
      LEFT JOIN pontos_parada p ON p.id = ra.ponto_id
      WHERE ra.rota_id = $1
      ORDER BY a.pessoa_nome ASC
      `,
      [rotaId]
    );

    const tipo = String(rota.tipo || '').toLowerCase();
    let alunos = alunosRes.rows.map((row) => {
      const isExclusiva = tipo === 'exclusiva';

      const ponto_endereco = row.logradouro
        ? buildEnderecoPonto({
          logradouro: row.logradouro,
          numero: row.numero,
          complemento: row.complemento,
          bairro: row.ponto_bairro,
          cep: row.ponto_cep,
        })
        : '';

      const casa_endereco = buildEnderecoCasa(row);

      return {
        aluno_id: row.aluno_id,
        pessoa_nome: row.pessoa_nome,
        cpf: row.cpf,
        turma: row.turma,
        unidade_ensino: row.unidade_ensino,
        escola_nome: row.unidade_ensino,
        deficiencia: row.deficiencia,
        turno: detectTurnoFromTurma(row.turma),

        filiacao_1: row.filiacao_1,
        telefone_filiacao_1: row.telefone_filiacao_1,
        filiacao_2: row.filiacao_2,
        telefone_filiacao_2: row.telefone_filiacao_2,
        responsavel: row.responsavel,
        telefone_responsavel: row.telefone_responsavel,

        // no front: sempre "ponto_*"; em exclusiva vira a casa
        ponto_id: isExclusiva ? row.aluno_id : row.ponto_id,
        ponto_endereco: isExclusiva
          ? casa_endereco || 'Endereço não informado'
          : ponto_endereco || 'Endereço não informado',
        ponto_lat: isExclusiva ? row.casa_lat : row.ponto_lat,
        ponto_lng: isExclusiva ? row.casa_lng : row.ponto_lng,
      };
    });

    // Aplica filtro por turno, quando solicitado (todos = sem filtro)
    if (turnoParam && turnoParam !== 'todos') {
      alunos = alunos.filter(a => a.turno === turnoParam);
    }

    // 4) Pontos p/ mapa (preservando ordem da rota, filtrando pelos pontos usados no turno)
    let pontos = [];

    if (tipo === 'exclusiva') {
      // exclusiva: cada aluno é um "ponto" (casa)
      pontos = alunos
        .filter((a) => a.ponto_lat != null && a.ponto_lng != null)
        .map((a) => ({
          id: a.aluno_id,
          is_casa: true,
          nome: `Casa - ${a.pessoa_nome || `Aluno #${a.aluno_id}`}`,
          endereco: a.ponto_endereco,
          lat: a.ponto_lat,
          lng: a.ponto_lng,
          qtd_alunos: 1,
        }));
    } else {
      // pontos da rota em ordem (rp.id), depois filtra por pontos realmente usados no turno
      const pontosRotaRes = await q(
        `
        SELECT
          rp.ponto_id,
          rp.qtd_alunos,
          p.logradouro,
          p.numero,
          p.complemento,
          p.bairro,
          p.cep,
          ST_Y(p.localizacao)::float AS lat,
          ST_X(p.localizacao)::float AS lng
        FROM rotas_escolares_pontos rp
        JOIN pontos_parada p ON p.id = rp.ponto_id
        WHERE rp.rota_id = $1
        ORDER BY rp.id ASC
        `,
        [rotaId]
      );

      // contagem real por ponto (no turno filtrado)
      const countByPonto = new Map();
      for (const a of alunos) {
        if (a.ponto_id == null) continue;
        const key = String(a.ponto_id);
        countByPonto.set(key, (countByPonto.get(key) || 0) + 1);
      }

      pontos = pontosRotaRes.rows
        .filter(row => {
          if (!turnoParam || turnoParam === 'todos') return true; // sem filtro => todos
          return countByPonto.has(String(row.ponto_id));
        })
        .map((row) => ({
          id: row.ponto_id,
          is_casa: false,
          nome: 'Ponto de parada',
          endereco: buildEnderecoPonto(row),
          lat: row.lat,
          lng: row.lng,
          qtd_alunos:
            (!turnoParam || turnoParam === 'todos')
              ? (row.qtd_alunos || 0)
              : (countByPonto.get(String(row.ponto_id)) || 0),
        }));
    }

    // 5) Escolas do itinerário associado à rota (itinerario_rotas -> itinerario_escola -> escolas)
    // - Uma rota pode ter 1+ escolas no itinerário
    // - Mantém a lista completa; o front pode filtrar por turno se necessário
    const escolasRes = await q(
      `
      SELECT DISTINCT
        e.id,
        e.nome,
        e.codigo_inep,
        e.logradouro,
        e.numero,
        e.bairro,
        e.cep,
        ST_Y(e.localizacao)::float AS lat,
        ST_X(e.localizacao)::float AS lng
      FROM itinerario_rotas ir
      JOIN itinerario_escola ie ON ie.itinerario_id = ir.itinerario_id
      JOIN escolas e ON e.id = ie.escola_id
      WHERE ir.rota_id = $1
        AND ir.tenant_id = $2
        AND ie.tenant_id = $2
        AND e.tenant_id = $2
      ORDER BY e.nome ASC
      `,
      [rotaId, tenantId]
    );

    const escolas = (escolasRes.rows || []).map((e) => ({
      id: e.id,
      nome: e.nome,
      codigo_inep: e.codigo_inep,
      logradouro: e.logradouro,
      numero: e.numero,
      bairro: e.bairro,
      cep: e.cep,
      lat: e.lat,
      lng: e.lng,
    }));

    const garagem = (rota.garagem_lat != null && rota.garagem_lng != null) ? {
      id: rota.fornecedor_id || null,
      nome: rota.nome_fantasia || rota.razao_social || 'Garagem',
      lat: rota.garagem_lat,
      lng: rota.garagem_lng,
      endereco: [rota.logradouro_garagem, rota.numero_garagem].filter(Boolean).join(', ') || null
    } : null;

    return res.json({
      rota: {
        ...rota,
        motoristas_nomes: (motoristas || []).map(x => x.nome).filter(Boolean).join(' • '),
        monitores_telefones: (monitores || []).map(x => x.telefone).filter(Boolean).join(' • '),
      },
      garagem,
      motoristas,
      monitores,
      alunos,
      pontos,
      escolas,
      meta: {
        rota_id: rotaId,
        tenant_id: tenantId, // debug
        turno: turnoParam || 'auto/todos',
        match: match,
      },
    });
  } catch (err) {
    console.error('consultar-rota error:', err);
    return res.status(500).json({ error: 'Erro ao consultar rota.', details: String(err?.message || err) });
  }
});

export default router;
