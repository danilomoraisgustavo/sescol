// backend/routes/admin.js
import express from 'express';
import bcrypt from 'bcryptjs';
import pool from '../db.js';
import {
  assignUserProfiles,
  ensureTenantSecurityDefaults,
  getEffectiveUserSecurity,
  getTenantSecurityPolicy,
  listSecurityLogs,
  listSecurityPermissions,
  listSecurityProfiles,
  listSecurityUsers,
  recordSecurityLog,
  saveSecurityProfile,
  setProfilePermissions,
  updateTenantSecurityPolicy,
} from '../services/security.js';

const router = express.Router();

/**
 * Painel ADMIN por-tenant.
 * Observação importante:
 * - Se a coluna usuarios.cargo for ENUM (ex: cargo_usuario), NÃO use UPPER(cargo) no SQL.
 *   Compare com o ENUM diretamente: cargo = 'ADMIN'::cargo_usuario
 */

function requireAdmin(req, res, next) {
  const cargo = String(req.user?.cargo || '').toUpperCase();
  if (cargo !== 'ADMIN') return res.status(403).json({ message: 'Acesso negado: requer ADMIN.' });
  return next();
}

function requireAdminOrGestor(req, res, next) {
  const cargo = String(req.user?.cargo || '').toUpperCase();
  if (!['ADMIN', 'GESTOR'].includes(cargo)) {
    return res.status(403).json({ message: 'Acesso negado.' });
  }
  return next();
}


function userIdFromReq(req) {
  const uid = req.user?.user_id ?? req.user?.id ?? req.user?.userId;
  const n = Number(uid);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function tenantIdFromReq(req) {
  const tid = req.tenantId ?? req.user?.tenant_id ?? req.user?.tenantId;
  const n = Number(tid);
  return Number.isFinite(n) && n > 0 ? n : null;
}

function pick(obj, keys) {
  const out = {};
  for (const k of keys) if (obj && Object.prototype.hasOwnProperty.call(obj, k)) out[k] = obj[k];
  return out;
}

let userColumnsCache = null;

async function getUserColumns() {
  if (userColumnsCache) return userColumnsCache;
  const { rows } = await pool.query(`
    SELECT column_name
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'usuarios'
  `);
  userColumnsCache = new Set((rows || []).map((row) => row.column_name));
  return userColumnsCache;
}

router.use(requireAdminOrGestor);

// GET /api/admin/me
router.get('/me', async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = userIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });
  if (!userId) return res.status(401).json({ message: 'Usuário inválido no token.' });

  const q = `
    SELECT id, tenant_id, nome, email, cargo::text AS cargo, init, ativo
    FROM usuarios
    WHERE id = $1 AND tenant_id = $2
    LIMIT 1
  `;
  const { rows } = await pool.query(q, [userId, tenantId]);
  if (!rows[0]) return res.status(401).json({ message: 'Usuário inválido.' });
  return res.json(rows[0]);
});

// GET /api/admin/stats
router.get('/stats', async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = userIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });
  if (!userId) return res.status(401).json({ message: 'Usuário inválido no token.' });

  // Não use UPPER(cargo) se cargo for ENUM. Compare direto no ENUM:
  // cargo = 'ADMIN'::cargo_usuario
  const { rows: urows } = await pool.query(
    `SELECT
        COUNT(*)::int AS total,
        SUM(CASE WHEN ativo THEN 1 ELSE 0 END)::int AS ativos,
        SUM(CASE WHEN cargo = 'ADMIN'::cargo_usuario THEN 1 ELSE 0 END)::int AS admins
     FROM usuarios
     WHERE tenant_id = $1`,
    [tenantId]
  );

  await ensureTenantSecurityDefaults(tenantId);
  const [logsRows, bloqueiosRows] = await Promise.all([
    pool.query(
      `SELECT
          COUNT(*)::int AS total,
          SUM(CASE WHEN lower(nivel) = 'danger' THEN 1 ELSE 0 END)::int AS falhas
       FROM security_logs
       WHERE tenant_id = $1
         AND created_at >= NOW() - INTERVAL '30 days'`,
      [tenantId]
    ),
    pool.query(
      `SELECT COUNT(*)::int AS total
         FROM security_login_lockouts
        WHERE tenant_id = $1
          AND locked_until IS NOT NULL
          AND locked_until > NOW()`,
      [tenantId]
    )
  ]);

  return res.json({
    usuarios_total: urows[0]?.total ?? 0,
    usuarios_ativos: urows[0]?.ativos ?? 0,
    usuarios_admins: urows[0]?.admins ?? 0,
    tenants_total: 1,
    tenants_ativos: 1,
    tenants_inativos: 0,
    logins_total: logsRows[0]?.total ?? 0,
    logins_falha: logsRows[0]?.falhas ?? 0,
    bloqueios_total: bloqueiosRows[0]?.total ?? 0,
    acoes_total: logsRows[0]?.total ?? 0,
    acoes_criacao: 0,
    acoes_edicao: 0,
    tem_notificacoes: false,
    notificacao_texto: 'Sem notificações no momento.'
  });
});

// =========================
// USUÁRIOS (somente do tenant)
// =========================

router.get('/users', async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = userIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });
  if (!userId) return res.status(401).json({ message: 'Usuário inválido no token.' });

  const rows = await listSecurityUsers(tenantId);
  return res.json({ items: rows });
});

router.post('/users', requireAdmin, async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = userIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });
  if (!userId) return res.status(401).json({ message: 'Usuário inválido no token.' });

  const userCols = await getUserColumns();
  const body = req.body || {};
  const nome = String(body.nome || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const telefone = body.telefone ? String(body.telefone).trim() : null;
  const cargo = String(body.cargo || 'USUARIO').toUpperCase();
  const init = !!body.init;
  const ativo = body.ativo !== false;
  const senha = body.senha ? String(body.senha) : null;
  const fornecedorId = body.fornecedor_id != null && String(body.fornecedor_id).trim() !== '' ? Number(body.fornecedor_id) : null;

  if (!nome) return res.status(400).json({ message: 'Informe o nome.' });
  if (!email || !email.includes('@')) return res.status(400).json({ message: 'Informe um email válido.' });
  if (!['ADMIN', 'GESTOR', 'USUARIO', 'FORNECEDOR_ESCOLAR'].includes(cargo)) return res.status(400).json({ message: 'Cargo inválido.' });
  if (cargo === 'FORNECEDOR_ESCOLAR' && !(Number.isFinite(fornecedorId) && fornecedorId > 0)) {
    return res.status(400).json({ message: 'Para cargo FORNECEDOR_ESCOLAR, informe fornecedor_id válido.' });
  }
  if (cargo !== 'FORNECEDOR_ESCOLAR') {
    // garante consistência (no banco também existe CHECK)
    // eslint-disable-next-line no-unused-vars
  }


  let senha_hash;
  if (senha) {
    if (senha.length < 6) return res.status(400).json({ message: 'Senha deve ter no mínimo 6 caracteres.' });
    senha_hash = await bcrypt.hash(senha, 12);
  } else {
    senha_hash = await bcrypt.hash('bloqueado_' + Math.random().toString(36).slice(2), 12);
  }

  try {
    const insertCols = ['tenant_id', 'nome', 'email', 'telefone', 'senha_hash', 'cargo', 'init', 'ativo'];
    const insertValues = ['$1','$2','$3','$4','$5','$6::cargo_usuario','$7','$8'];
    const params = [tenantId, nome, email, telefone, senha_hash, cargo, init, ativo];
    if (userCols.has('fornecedor_id')) {
      insertCols.splice(6, 0, 'fornecedor_id');
      insertValues.splice(6, 0, `$${params.length + 1}`);
      params.push(cargo === 'FORNECEDOR_ESCOLAR' ? fornecedorId : null);
    }
    const returningFornecedor = userCols.has('fornecedor_id') ? 'fornecedor_id' : 'NULL::bigint AS fornecedor_id';
    const { rows } = await pool.query(
      `INSERT INTO usuarios (${insertCols.join(', ')})
       VALUES (${insertValues.join(', ')})
       RETURNING id, tenant_id, nome, email, cargo::text AS cargo, ${returningFornecedor}, init, ativo, telefone`,
      params
    );
    await ensureTenantSecurityDefaults(tenantId);
    const effective = await getEffectiveUserSecurity(rows[0].id, tenantId);
    await recordSecurityLog({
      tenantId,
      userId,
      email: req.user?.email || null,
      action: 'SECURITY_USER_CREATED',
      targetType: 'usuario',
      targetId: rows[0].id,
      description: `Usuário ${rows[0].nome} criado.`,
      level: 'warn',
      scope: 'Secretaria',
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
      metadata: { cargo, profiles: effective.profiles.map((item) => item.codigo) }
    });
    return res.status(201).json(rows[0]);
  } catch (e) {
    if (String(e?.code) === '23505') return res.status(409).json({ message: 'Email já cadastrado.' });
    console.error(e);
    return res.status(500).json({ message: 'Erro ao criar usuário.' });
  }
});

router.put('/users/:id', requireAdmin, async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = userIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });
  if (!userId) return res.status(401).json({ message: 'Usuário inválido no token.' });

  const id = Number(req.params.id);
  if (!id) return res.status(400).json({ message: 'ID inválido.' });

  const userCols = await getUserColumns();
  const body = req.body || {};
  const nome = String(body.nome || '').trim();
  const email = String(body.email || '').trim().toLowerCase();
  const telefone = body.telefone ? String(body.telefone).trim() : null;
  const cargo = String(body.cargo || 'USUARIO').toUpperCase();
  const fornecedorId = body.fornecedor_id != null && String(body.fornecedor_id).trim() !== '' ? Number(body.fornecedor_id) : null;
  const init = !!body.init;
  const ativo = body.ativo !== false;
  const senha = body.senha ? String(body.senha) : null;

  if (!nome) return res.status(400).json({ message: 'Informe o nome.' });
  if (!email || !email.includes('@')) return res.status(400).json({ message: 'Informe um email válido.' });
  if (!['ADMIN', 'GESTOR', 'USUARIO', 'FORNECEDOR_ESCOLAR'].includes(cargo)) return res.status(400).json({ message: 'Cargo inválido.' });
  if (cargo === 'FORNECEDOR_ESCOLAR' && !(Number.isFinite(fornecedorId) && fornecedorId > 0)) {
    return res.status(400).json({ message: 'Para cargo FORNECEDOR_ESCOLAR, informe fornecedor_id válido.' });
  }

  const { rows: existingRows } = await pool.query(
    `SELECT id FROM usuarios WHERE id = $1 AND tenant_id = $2 LIMIT 1`,
    [id, tenantId]
  );
  if (!existingRows[0]) return res.status(404).json({ message: 'Usuário não encontrado.' });

  // monta update dinâmico (senha opcional)
  const setParts = [
    "nome=$1",
    "email=$2",
    "telefone=$3",
    "cargo=$4::cargo_usuario",
    "init=$5",
    "ativo=$6"
  ];

  const params = [
    nome,
    email,
    telefone,
    cargo,
    init,
    ativo
  ];

  if (userCols.has('fornecedor_id')) {
    setParts.splice(4, 0, `fornecedor_id=$${params.length + 1}`);
    params.splice(4, 0, (cargo === 'FORNECEDOR_ESCOLAR' ? fornecedorId : null));
  }

  let senhaIdx = null;
  if (senha) {
    if (senha.length < 6) return res.status(400).json({ message: 'Senha deve ter no mínimo 6 caracteres.' });
    const senha_hash = await bcrypt.hash(senha, 12);
    senhaIdx = params.length + 1;
    setParts.push(`senha_hash=$${senhaIdx}`);
    params.push(senha_hash);
  }

  // where
  params.push(id);
  params.push(tenantId);
  const idIdx = params.length - 1;      // not used
  const tenantIdx = params.length;      // not used

  try {
    const { rows } = await pool.query(
      `UPDATE usuarios
       SET ${setParts.join(', ')}
       WHERE id=$${params.length - 1} AND tenant_id=$${params.length}
       RETURNING id, tenant_id, nome, email, cargo::text AS cargo, ${userCols.has('fornecedor_id') ? 'fornecedor_id' : 'NULL::bigint AS fornecedor_id'}, init, ativo, telefone`,
      params
    );
    await ensureTenantSecurityDefaults(tenantId);
    await recordSecurityLog({
      tenantId,
      userId,
      email: req.user?.email || null,
      action: 'SECURITY_USER_UPDATED',
      targetType: 'usuario',
      targetId: rows[0]?.id,
      description: `Usuário ${rows[0]?.nome || id} atualizado.`,
      level: 'warn',
      scope: 'Secretaria',
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
      metadata: { cargo, ativo, init }
    });
    return res.json(rows[0]);
  } catch (e) {
    if (String(e?.code) === '23505') return res.status(409).json({ message: 'Email já cadastrado.' });
    console.error(e);
    return res.status(500).json({ message: 'Erro ao atualizar usuário.' });
  }
});

async function __getTenantColumns() {
  const { rows } = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = 'tenants'`
  );
  const cols = new Set((rows || []).map(r => r.column_name));
  // always include id
  const pick = ['id'];

  // nome
  if (cols.has('nome')) pick.push('nome');
  else if (cols.has('name')) pick.push('name AS nome');

  // ativo
  if (cols.has('ativo')) pick.push('ativo');
  else if (cols.has('active')) pick.push('active AS ativo');

  if (cols.has('codigo')) pick.push('codigo');
  if (cols.has('subdominio')) pick.push('subdominio');
  if (cols.has('subdomain')) pick.push('subdomain AS subdominio');
  if (cols.has('slug') && !pick.some((c) => c.includes('subdominio'))) pick.push('slug AS subdominio');
  if (cols.has('dominio')) pick.push('dominio');
  if (cols.has('domain')) pick.push('domain AS dominio');
  if (cols.has('custom_domain') && !pick.some((c) => c.includes('dominio'))) pick.push('custom_domain AS dominio');

  // timestamps (use whichever exists)
  if (cols.has('created_at')) pick.push('created_at');
  else if (cols.has('criado_em')) pick.push('criado_em');
  if (cols.has('updated_at')) pick.push('updated_at');
  else if (cols.has('atualizado_em')) pick.push('atualizado_em');

  // if nothing but id, still ok
  return pick;
}

// GET /api/admin/tenant
// Retorna dados básicos do tenant para o painel admin (configurações).
router.get('/tenant', async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });

  try {
    const cols = await __getTenantColumns();
    const sql = `SELECT ${cols.join(', ')} FROM tenants WHERE id = $1 LIMIT 1`;
    const { rows } = await pool.query(sql, [tenantId]);
    if (!rows[0]) return res.status(404).json({ message: 'Tenant não encontrado.' });
    return res.json(rows[0]);
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erro ao buscar tenant.' });
  }
});


router.put('/tenant', requireAdmin, async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = userIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });
  if (!userId) return res.status(401).json({ message: 'Usuário inválido no token.' });

  const body = req.body || {};
  const nome = String(body.nome || '').trim();
  const documento = body.documento ? String(body.documento).trim() : null;
  const email = body.email ? String(body.email).trim() : null;
  const telefone = body.telefone ? String(body.telefone).trim() : null;
  const ativo = body.ativo !== false;
  const subdominio = body.subdominio ? String(body.subdominio).trim().toLowerCase() : null;
  const dominio = body.dominio ? String(body.dominio).trim().toLowerCase() : null;

  if (!nome) return res.status(400).json({ message: 'Informe o nome do tenant.' });
  const cols = await __getTenantColumns();
  const setParts = ['nome=$1', 'documento=$2', 'email=$3', 'telefone=$4', 'ativo=$5'];
  const params = [nome, documento, email, telefone, ativo];

  const tenantColumns = new Set(cols.map((c) => c.split(/\s+AS\s+/i)[0].trim()));
  if (tenantColumns.has('subdominio')) {
    params.push(subdominio);
    setParts.push(`subdominio=$${params.length}`);
  } else if (tenantColumns.has('subdomain')) {
    params.push(subdominio);
    setParts.push(`subdomain=$${params.length}`);
  } else if (tenantColumns.has('slug')) {
    params.push(subdominio);
    setParts.push(`slug=$${params.length}`);
  }

  if (tenantColumns.has('dominio')) {
    params.push(dominio);
    setParts.push(`dominio=$${params.length}`);
  } else if (tenantColumns.has('domain')) {
    params.push(dominio);
    setParts.push(`domain=$${params.length}`);
  } else if (tenantColumns.has('custom_domain')) {
    params.push(dominio);
    setParts.push(`custom_domain=$${params.length}`);
  }

  params.push(tenantId);

  const { rows } = await pool.query(
    `UPDATE tenants
     SET ${setParts.join(', ')}
     WHERE id=$${params.length}
     RETURNING *`,
    params
  );

  return res.json(rows[0]);
});

// =========================
// BRANDING (somente o seu)
// =========================

router.get('/branding', async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = userIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });
  if (!userId) return res.status(401).json({ message: 'Usuário inválido no token.' });

  const { rows } = await pool.query(
    `SELECT * FROM sistema_branding WHERE tenant_id = $1 LIMIT 1`,
    [tenantId]
  );
  return res.json(rows[0] || { tenant_id: tenantId });
});

router.put('/branding', requireAdmin, async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = userIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });
  if (!userId) return res.status(401).json({ message: 'Usuário inválido no token.' });

  const allowed = [
    'nome_sistema', 'telefone_contato', 'email_contato', 'site_oficial',
    'doc_separador_ativo', 'cidade_uf', 'termo_paragrafo_extra', 'carteirinha_exibir_qr_verso'
  ];
  const b = pick(req.body || {}, allowed);

  const { rows } = await pool.query(
    `INSERT INTO sistema_branding (tenant_id, nome_sistema, telefone_contato, email_contato, site_oficial, doc_separador_ativo, cidade_uf, termo_paragrafo_extra, carteirinha_exibir_qr_verso)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (tenant_id) DO UPDATE SET
       nome_sistema=EXCLUDED.nome_sistema,
       telefone_contato=EXCLUDED.telefone_contato,
       email_contato=EXCLUDED.email_contato,
       site_oficial=EXCLUDED.site_oficial,
       doc_separador_ativo=EXCLUDED.doc_separador_ativo,
       cidade_uf=EXCLUDED.cidade_uf,
       termo_paragrafo_extra=EXCLUDED.termo_paragrafo_extra,
       carteirinha_exibir_qr_verso=EXCLUDED.carteirinha_exibir_qr_verso
     RETURNING *`,
    [
      tenantId,
      b.nome_sistema ?? null,
      b.telefone_contato ?? null,
      b.email_contato ?? null,
      b.site_oficial ?? null,
      b.doc_separador_ativo ?? true,
      b.cidade_uf ?? null,
      b.termo_paragrafo_extra ?? null,
      b.carteirinha_exibir_qr_verso ?? false
    ]
  );

  return res.json(rows[0]);
});




// GET /api/admin/fornecedores
// Retorna fornecedores do tenant para associar usuário FORNECEDOR_ESCOLAR.
// Implementação robusta: detecta a tabela e colunas existentes.
async function __resolveFornecedorTable() {
  const candidates = [
    'public.fornecedores',
    'public.fornecedores_escolares',
    'public.fornecedores_escolar',
    'public.fornecedores_transporte',
    'public.fornecedores_terceirizados'
  ];
  for (const t of candidates) {
    const r = await pool.query("SELECT to_regclass($1) AS reg", [t]);
    if (r.rows?.[0]?.reg) return t;
  }
  return null;
}

async function __getFornecedorNameExpr(tableName) {
  // tableName vem no formato schema.table
  const parts = String(tableName).split('.');
  const table = parts[1] || parts[0];

  const { rows } = await pool.query(
    `SELECT column_name
       FROM information_schema.columns
      WHERE table_schema = 'public'
        AND table_name = $1`,
    [table]
  );

  const cols = new Set((rows || []).map(r => r.column_name));

  // Preferência: razao_social / nome_fantasia (seu schema), depois alternativas
  if (cols.has('razao_social') && cols.has('nome_fantasia')) {
    return "COALESCE(nome_fantasia, razao_social)";
  }
  if (cols.has('nome_fantasia')) return "nome_fantasia";
  if (cols.has('razao_social')) return "razao_social";
  if (cols.has('fantasia')) return "fantasia";
  if (cols.has('nome')) return "nome";
  if (cols.has('descricao')) return "descricao";
  return "'Fornecedor '||id";
}

router.get('/fornecedores', async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });

  try {
    const table = await __resolveFornecedorTable();
    if (!table) return res.json({ items: [], table: null });

    const nameExpr = await __getFornecedorNameExpr(table);

    const q = `
      SELECT id::bigint AS id,
             ${nameExpr} AS nome
      FROM ${table}
      WHERE tenant_id = $1
      ORDER BY nome ASC
    `;

    const { rows } = await pool.query(q, [tenantId]);
    return res.json({ items: rows, table });
  } catch (e) {
    console.error(e);
    return res.status(500).json({ message: 'Erro ao listar fornecedores.' });
  }
});

router.get('/security/permissions', async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });
  const items = await listSecurityPermissions();
  return res.json({ items });
});

router.get('/security/profiles', async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });
  const items = await listSecurityProfiles(tenantId);
  return res.json({ items });
});

router.post('/security/profiles', requireAdmin, async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = userIdFromReq(req);
  if (!tenantId || !userId) return res.status(401).json({ message: 'Sessão inválida.' });
  try {
    const profileId = await saveSecurityProfile(tenantId, req.body || {});
    await recordSecurityLog({
      tenantId,
      userId,
      email: req.user?.email || null,
      action: 'SECURITY_PROFILE_SAVED',
      targetType: 'perfil',
      targetId: profileId,
      description: 'Perfil salvo.',
      level: 'warn',
      scope: 'Secretaria',
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
      metadata: req.body || {},
    });
    const items = await listSecurityProfiles(tenantId);
    return res.status(201).json({ items });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Erro ao salvar perfil.' });
  }
});

router.put('/security/profiles/:id/permissions', requireAdmin, async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = userIdFromReq(req);
  const profileId = Number(req.params.id);
  if (!tenantId || !userId) return res.status(401).json({ message: 'Sessão inválida.' });
  if (!Number.isFinite(profileId) || profileId <= 0) return res.status(400).json({ message: 'Perfil inválido.' });
  try {
    await setProfilePermissions(tenantId, profileId, req.body?.permission_codes || []);
    await recordSecurityLog({
      tenantId,
      userId,
      email: req.user?.email || null,
      action: 'SECURITY_PROFILE_PERMISSIONS_UPDATED',
      targetType: 'perfil',
      targetId: profileId,
      description: 'Permissões do perfil atualizadas.',
      level: 'warn',
      scope: 'Secretaria',
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
      metadata: { permission_codes: req.body?.permission_codes || [] },
    });
    const items = await listSecurityProfiles(tenantId);
    return res.json({ items });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Erro ao atualizar permissões.' });
  }
});

router.put('/users/:id/profiles', requireAdmin, async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = userIdFromReq(req);
  const targetId = Number(req.params.id);
  if (!tenantId || !userId) return res.status(401).json({ message: 'Sessão inválida.' });
  if (!Number.isFinite(targetId) || targetId <= 0) return res.status(400).json({ message: 'Usuário inválido.' });
  try {
    await assignUserProfiles(tenantId, targetId, req.body?.profile_ids || []);
    const effective = await getEffectiveUserSecurity(targetId, tenantId);
    await recordSecurityLog({
      tenantId,
      userId,
      email: req.user?.email || null,
      action: 'SECURITY_USER_PROFILES_UPDATED',
      targetType: 'usuario',
      targetId,
      description: 'Perfis do usuário atualizados.',
      level: 'warn',
      scope: 'Secretaria',
      ip: req.ip,
      userAgent: req.headers['user-agent'] || null,
      metadata: { profiles: effective.profiles.map((item) => item.codigo) },
    });
    const items = await listSecurityUsers(tenantId);
    return res.json({ items });
  } catch (error) {
    return res.status(400).json({ message: error.message || 'Erro ao atualizar perfis do usuário.' });
  }
});

router.get('/security/policies', async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });
  const item = await getTenantSecurityPolicy(tenantId);
  return res.json(item || {});
});

router.put('/security/policies', requireAdmin, async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  const userId = userIdFromReq(req);
  if (!tenantId || !userId) return res.status(401).json({ message: 'Sessão inválida.' });
  const item = await updateTenantSecurityPolicy(tenantId, req.body || {});
  await recordSecurityLog({
    tenantId,
    userId,
    email: req.user?.email || null,
    action: 'SECURITY_POLICY_UPDATED',
    targetType: 'tenant',
    targetId: tenantId,
    description: 'Política de segurança atualizada.',
    level: 'warn',
    scope: 'Secretaria',
    ip: req.ip,
    userAgent: req.headers['user-agent'] || null,
    metadata: item,
  });
  return res.json(item);
});

router.get('/security/logs', async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });
  const items = await listSecurityLogs(tenantId, {
    search: req.query?.search || '',
    level: req.query?.level || '',
    scope: req.query?.scope || '',
    limit: req.query?.limit || 200,
  });
  return res.json({ items });
});

router.get('/audit', async (req, res) => {
  const tenantId = tenantIdFromReq(req);
  if (!tenantId) return res.status(401).json({ message: 'Tenant inválido no token.' });
  const items = await listSecurityLogs(tenantId, { limit: 100 });
  return res.json({ items });
});

export default router;
