import pool from '../db.js';

let ensured = false;
let permissionCache = null;

const DEFAULT_PERMISSIONS = [
  ['auth.login', 'Autenticação web', 'Login e sessão do sistema', 'Autenticação'],
  ['auth.password_reset', 'Redefinição de senha', 'Solicitar e confirmar redefinição de senha', 'Autenticação'],
  ['security.users.view', 'Consultar usuários', 'Visualizar usuários do tenant', 'Segurança'],
  ['security.users.manage', 'Gerir usuários', 'Criar, editar, bloquear e reativar usuários', 'Segurança'],
  ['security.roles.view', 'Consultar perfis', 'Visualizar perfis e permissões', 'Segurança'],
  ['security.roles.manage', 'Gerir perfis', 'Criar e editar perfis e permissões', 'Segurança'],
  ['security.logs.view', 'Consultar logs', 'Visualizar logs de acesso e auditoria', 'Segurança'],
  ['security.settings.manage', 'Gerir políticas', 'Alterar políticas de segurança do tenant', 'Segurança'],
  ['institution.master.view', 'Consultar cadastro mestre', 'Visualizar escolas institucionais, servidores, disciplinas, séries, turnos, calendários e parâmetros', 'Institucional'],
  ['institution.master.manage', 'Gerir cadastro mestre', 'Criar e alterar cadastros mestres institucionais da rede', 'Institucional'],
  ['school.dashboard.view', 'Consultar dashboards', 'Visualizar dashboards escolares', 'Escolar'],
  ['school.students.view', 'Consultar alunos', 'Visualizar alunos e históricos', 'Escolar'],
  ['school.students.manage', 'Gerir alunos', 'Editar alunos e matrículas', 'Escolar'],
  ['school.transport.manage', 'Gerir transporte escolar', 'Solicitar transporte e pontos', 'Escolar'],
  ['school.documents.emit', 'Emitir documentos', 'Gerar documentos escolares em PDF', 'Escolar'],
  ['school.transfer.manage', 'Gerir transferências', 'Solicitar e concluir transferências internas', 'Escolar'],
];

const DEFAULT_PROFILE_DEFS = [
  {
    codigo: 'ADMIN',
    nome: 'Administrador',
    descricao: 'Controle total do tenant, autenticação, usuários, perfis, políticas e auditoria.',
    escopo: 'TENANT',
    sistema: true,
    permissions: DEFAULT_PERMISSIONS.map((item) => item[0]),
  },
  {
    codigo: 'GESTOR',
    nome: 'Gestor',
    descricao: 'Supervisão operacional, leitura de auditoria e gestão escolar.',
    escopo: 'SECRETARIA',
    sistema: true,
    permissions: [
      'auth.login',
      'auth.password_reset',
      'security.users.view',
      'security.roles.view',
      'security.logs.view',
      'institution.master.view',
      'institution.master.manage',
      'school.dashboard.view',
      'school.students.view',
      'school.students.manage',
      'school.transport.manage',
      'school.documents.emit',
      'school.transfer.manage',
    ],
  },
  {
    codigo: 'USUARIO',
    nome: 'Secretaria escolar',
    descricao: 'Operação escolar por unidade, matrícula, alunos, turmas e documentos.',
    escopo: 'ESCOLA',
    sistema: true,
    permissions: [
      'auth.login',
      'auth.password_reset',
      'school.dashboard.view',
      'school.students.view',
      'school.students.manage',
      'school.transport.manage',
      'school.documents.emit',
      'school.transfer.manage',
    ],
  },
  {
    codigo: 'FORNECEDOR_ESCOLAR',
    nome: 'Fornecedor escolar',
    descricao: 'Acesso operacional restrito ao escopo de fornecedor vinculado.',
    escopo: 'FORNECEDOR',
    sistema: true,
    permissions: [
      'auth.login',
      'auth.password_reset',
      'school.dashboard.view',
      'school.students.view',
    ],
  },
];

function normalizeCargoToProfileCode(cargo) {
  const code = String(cargo || '').trim().toUpperCase();
  if (code === 'FORNECEDOR') return 'FORNECEDOR_ESCOLAR';
  return code || 'USUARIO';
}

export async function ensureSecuritySchema() {
  if (ensured) return;

  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_permissoes (
      id BIGSERIAL PRIMARY KEY,
      codigo TEXT NOT NULL UNIQUE,
      nome TEXT NOT NULL,
      descricao TEXT,
      modulo TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_perfis (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
      codigo TEXT NOT NULL,
      nome TEXT NOT NULL,
      descricao TEXT,
      escopo TEXT NOT NULL DEFAULT 'TENANT',
      sistema BOOLEAN NOT NULL DEFAULT FALSE,
      ativo BOOLEAN NOT NULL DEFAULT TRUE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, codigo)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_perfil_permissoes (
      perfil_id BIGINT NOT NULL REFERENCES security_perfis(id) ON DELETE CASCADE,
      permissao_id BIGINT NOT NULL REFERENCES security_permissoes(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (perfil_id, permissao_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_usuario_perfis (
      usuario_id BIGINT NOT NULL REFERENCES usuarios(id) ON DELETE CASCADE,
      perfil_id BIGINT NOT NULL REFERENCES security_perfis(id) ON DELETE CASCADE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      PRIMARY KEY (usuario_id, perfil_id)
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_logs (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT REFERENCES tenants(id) ON DELETE CASCADE,
      usuario_id BIGINT REFERENCES usuarios(id) ON DELETE SET NULL,
      email TEXT,
      acao TEXT NOT NULL,
      alvo_tipo TEXT,
      alvo_id TEXT,
      descricao TEXT,
      nivel TEXT NOT NULL DEFAULT 'info',
      escopo TEXT NOT NULL DEFAULT 'Secretaria',
      ip TEXT,
      user_agent TEXT,
      metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_policies (
      tenant_id BIGINT PRIMARY KEY REFERENCES tenants(id) ON DELETE CASCADE,
      lockout_enabled BOOLEAN NOT NULL DEFAULT TRUE,
      lockout_attempts INT NOT NULL DEFAULT 5,
      lockout_minutes INT NOT NULL DEFAULT 30,
      password_min_length INT NOT NULL DEFAULT 8,
      password_uppercase BOOLEAN NOT NULL DEFAULT TRUE,
      password_numbers BOOLEAN NOT NULL DEFAULT TRUE,
      password_symbols BOOLEAN NOT NULL DEFAULT TRUE,
      password_rotation_days INT NOT NULL DEFAULT 180,
      reset_link_minutes INT NOT NULL DEFAULT 20,
      session_minutes INT NOT NULL DEFAULT 480,
      enforce_2fa_admins BOOLEAN NOT NULL DEFAULT FALSE,
      audit_retention_days INT NOT NULL DEFAULT 365,
      geo_segregation BOOLEAN NOT NULL DEFAULT TRUE,
      unit_selection_required BOOLEAN NOT NULL DEFAULT FALSE,
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )
  `);

  await pool.query(`
    CREATE TABLE IF NOT EXISTS security_login_lockouts (
      id BIGSERIAL PRIMARY KEY,
      tenant_id BIGINT REFERENCES tenants(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      ip TEXT,
      failed_attempts INT NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      last_failed_at TIMESTAMPTZ,
      last_success_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      UNIQUE (tenant_id, email)
    )
  `);

  await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_logs_tenant_created_at ON security_logs (tenant_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_logs_usuario_created_at ON security_logs (usuario_id, created_at DESC)`);
  await pool.query(`CREATE INDEX IF NOT EXISTS idx_security_login_lockouts_tenant_email ON security_login_lockouts (tenant_id, email)`);

  for (const [codigo, nome, descricao, modulo] of DEFAULT_PERMISSIONS) {
    await pool.query(
      `
      INSERT INTO security_permissoes (codigo, nome, descricao, modulo)
      VALUES ($1, $2, $3, $4)
      ON CONFLICT (codigo) DO UPDATE SET
        nome = EXCLUDED.nome,
        descricao = EXCLUDED.descricao,
        modulo = EXCLUDED.modulo
      `,
      [codigo, nome, descricao, modulo]
    );
  }

  permissionCache = null;
  ensured = true;
}

async function getPermissionMap() {
  if (permissionCache) return permissionCache;
  await ensureSecuritySchema();
  const { rows } = await pool.query(`SELECT id, codigo, nome, descricao, modulo FROM security_permissoes ORDER BY modulo, nome`);
  permissionCache = new Map(rows.map((row) => [row.codigo, row]));
  return permissionCache;
}

export async function ensureTenantSecurityDefaults(tenantId) {
  await ensureSecuritySchema();
  const permissionMap = await getPermissionMap();

  for (const profile of DEFAULT_PROFILE_DEFS) {
    const { rows } = await pool.query(
      `
      INSERT INTO security_perfis (tenant_id, codigo, nome, descricao, escopo, sistema, ativo, updated_at)
      VALUES ($1, $2, $3, $4, $5, TRUE, TRUE, NOW())
      ON CONFLICT (tenant_id, codigo) DO UPDATE SET
        nome = EXCLUDED.nome,
        descricao = EXCLUDED.descricao,
        escopo = EXCLUDED.escopo,
        sistema = TRUE,
        ativo = TRUE,
        updated_at = NOW()
      RETURNING id
      `,
      [tenantId, profile.codigo, profile.nome, profile.descricao, profile.escopo]
    );
    const perfilId = rows[0]?.id;
    if (!perfilId) continue;

    await pool.query(`DELETE FROM security_perfil_permissoes WHERE perfil_id = $1`, [perfilId]);
    for (const permissionCode of profile.permissions) {
      const permission = permissionMap.get(permissionCode);
      if (!permission) continue;
      await pool.query(
        `INSERT INTO security_perfil_permissoes (perfil_id, permissao_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
        [perfilId, permission.id]
      );
    }
  }

  await pool.query(
    `
    INSERT INTO security_policies (tenant_id)
    VALUES ($1)
    ON CONFLICT (tenant_id) DO NOTHING
    `,
    [tenantId]
  );

  await syncTenantUsersWithDefaultProfiles(tenantId);
}

export async function syncTenantUsersWithDefaultProfiles(tenantId) {
  await ensureSecuritySchema();
  const { rows } = await pool.query(
    `
    SELECT u.id AS usuario_id, u.cargo::text AS cargo, p.id AS perfil_id
    FROM usuarios u
    JOIN security_perfis p
      ON p.tenant_id = u.tenant_id
     AND p.codigo = CASE
       WHEN upper(u.cargo::text) = 'FORNECEDOR' THEN 'FORNECEDOR_ESCOLAR'
       ELSE upper(u.cargo::text)
     END
    WHERE u.tenant_id = $1
    `,
    [tenantId]
  );

  for (const row of rows) {
    await pool.query(
      `INSERT INTO security_usuario_perfis (usuario_id, perfil_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [row.usuario_id, row.perfil_id]
    );
  }
}

export async function getTenantSecurityPolicy(tenantId) {
  await ensureTenantSecurityDefaults(tenantId);
  const { rows } = await pool.query(`SELECT * FROM security_policies WHERE tenant_id = $1 LIMIT 1`, [tenantId]);
  return rows[0] || null;
}

export async function updateTenantSecurityPolicy(tenantId, payload = {}) {
  await ensureTenantSecurityDefaults(tenantId);
  const current = await getTenantSecurityPolicy(tenantId);
  const next = {
    lockout_enabled: payload.lockout_enabled ?? current.lockout_enabled,
    lockout_attempts: Number(payload.lockout_attempts ?? current.lockout_attempts),
    lockout_minutes: Number(payload.lockout_minutes ?? current.lockout_minutes),
    password_min_length: Number(payload.password_min_length ?? current.password_min_length),
    password_uppercase: payload.password_uppercase ?? current.password_uppercase,
    password_numbers: payload.password_numbers ?? current.password_numbers,
    password_symbols: payload.password_symbols ?? current.password_symbols,
    password_rotation_days: Number(payload.password_rotation_days ?? current.password_rotation_days),
    reset_link_minutes: Number(payload.reset_link_minutes ?? current.reset_link_minutes),
    session_minutes: Number(payload.session_minutes ?? current.session_minutes),
    enforce_2fa_admins: payload.enforce_2fa_admins ?? current.enforce_2fa_admins,
    audit_retention_days: Number(payload.audit_retention_days ?? current.audit_retention_days),
    geo_segregation: payload.geo_segregation ?? current.geo_segregation,
    unit_selection_required: payload.unit_selection_required ?? current.unit_selection_required,
  };

  const { rows } = await pool.query(
    `
    UPDATE security_policies
       SET lockout_enabled = $2,
           lockout_attempts = $3,
           lockout_minutes = $4,
           password_min_length = $5,
           password_uppercase = $6,
           password_numbers = $7,
           password_symbols = $8,
           password_rotation_days = $9,
           reset_link_minutes = $10,
           session_minutes = $11,
           enforce_2fa_admins = $12,
           audit_retention_days = $13,
           geo_segregation = $14,
           unit_selection_required = $15,
           updated_at = NOW()
     WHERE tenant_id = $1
     RETURNING *
    `,
    [
      tenantId,
      next.lockout_enabled,
      next.lockout_attempts,
      next.lockout_minutes,
      next.password_min_length,
      next.password_uppercase,
      next.password_numbers,
      next.password_symbols,
      next.password_rotation_days,
      next.reset_link_minutes,
      next.session_minutes,
      next.enforce_2fa_admins,
      next.audit_retention_days,
      next.geo_segregation,
      next.unit_selection_required,
    ]
  );
  return rows[0] || null;
}

export async function recordSecurityLog({
  tenantId = null,
  userId = null,
  email = null,
  action,
  targetType = null,
  targetId = null,
  description = null,
  level = 'info',
  scope = 'Secretaria',
  ip = null,
  userAgent = null,
  metadata = {},
}) {
  await ensureSecuritySchema();
  await pool.query(
    `
    INSERT INTO security_logs (
      tenant_id, usuario_id, email, acao, alvo_tipo, alvo_id, descricao, nivel, escopo, ip, user_agent, metadata
    ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12::jsonb)
    `,
    [
      tenantId,
      userId,
      email,
      action,
      targetType,
      targetId == null ? null : String(targetId),
      description,
      level,
      scope,
      ip,
      userAgent,
      JSON.stringify(metadata || {}),
    ]
  );
}

export async function registerFailedLoginAttempt({ tenantId = null, email, ip = null, lockoutPolicy = null, metadata = {} }) {
  await ensureSecuritySchema();
  if (!tenantId || !email) return { failed_attempts: 0, locked_until: null };
  const policy = lockoutPolicy || await getTenantSecurityPolicy(tenantId);
  const attemptsLimit = Math.max(1, Number(policy?.lockout_attempts || 5));
  const lockoutMinutes = Math.max(1, Number(policy?.lockout_minutes || 30));

  const { rows } = await pool.query(
    `
    INSERT INTO security_login_lockouts (tenant_id, email, ip, failed_attempts, last_failed_at, updated_at)
    VALUES ($1, lower($2), $3, 1, NOW(), NOW())
    ON CONFLICT (tenant_id, email) DO UPDATE SET
      ip = EXCLUDED.ip,
      failed_attempts = security_login_lockouts.failed_attempts + 1,
      last_failed_at = NOW(),
      updated_at = NOW()
    RETURNING *
    `,
    [tenantId, email, ip]
  );
  const row = rows[0];
  if ((policy?.lockout_enabled ?? true) && Number(row.failed_attempts) >= attemptsLimit) {
    const { rows: lockedRows } = await pool.query(
      `
      UPDATE security_login_lockouts
         SET locked_until = NOW() + make_interval(mins => $3),
             updated_at = NOW()
       WHERE tenant_id = $1 AND email = lower($2)
       RETURNING *
      `,
      [tenantId, email, lockoutMinutes]
    );
    const locked = lockedRows[0] || row;
    await recordSecurityLog({
      tenantId,
      email,
      action: 'AUTH_LOGIN_LOCKED',
      targetType: 'usuario',
      targetId: email,
      description: 'Conta bloqueada temporariamente por excesso de tentativas inválidas.',
      level: 'danger',
      scope: 'Usuário',
      ip,
      metadata: { ...metadata, failed_attempts: locked.failed_attempts, locked_until: locked.locked_until },
    });
    return locked;
  }
  return row;
}

export async function clearLoginFailures({ tenantId = null, email, ip = null }) {
  await ensureSecuritySchema();
  if (!tenantId || !email) return;
  await pool.query(
    `
    INSERT INTO security_login_lockouts (tenant_id, email, ip, failed_attempts, locked_until, last_success_at, updated_at)
    VALUES ($1, lower($2), $3, 0, NULL, NOW(), NOW())
    ON CONFLICT (tenant_id, email) DO UPDATE SET
      ip = EXCLUDED.ip,
      failed_attempts = 0,
      locked_until = NULL,
      last_success_at = NOW(),
      updated_at = NOW()
    `,
    [tenantId, email, ip]
  );
}

export async function getLoginLockoutStatus({ tenantId = null, email }) {
  await ensureSecuritySchema();
  if (!tenantId || !email) return null;
  const { rows } = await pool.query(
    `
    SELECT *,
           CASE WHEN locked_until IS NOT NULL AND locked_until > NOW() THEN TRUE ELSE FALSE END AS is_locked
      FROM security_login_lockouts
     WHERE tenant_id = $1 AND email = lower($2)
     LIMIT 1
    `,
    [tenantId, email]
  );
  return rows[0] || null;
}

export async function getEffectiveUserSecurity(userId, tenantId) {
  await ensureTenantSecurityDefaults(tenantId);
  const { rows } = await pool.query(
    `
    SELECT DISTINCT p.codigo AS perfil_codigo,
           p.nome AS perfil_nome,
           p.escopo,
           perm.codigo AS permissao_codigo
      FROM security_usuario_perfis sup
      JOIN security_perfis p ON p.id = sup.perfil_id
      LEFT JOIN security_perfil_permissoes spp ON spp.perfil_id = p.id
      LEFT JOIN security_permissoes perm ON perm.id = spp.permissao_id
     WHERE sup.usuario_id = $1
       AND p.tenant_id = $2
       AND p.ativo = TRUE
     ORDER BY p.codigo, perm.codigo
    `,
    [userId, tenantId]
  );

  const profiles = [];
  const profileMap = new Map();
  const permissions = new Set();

  for (const row of rows) {
    if (!profileMap.has(row.perfil_codigo)) {
      const profile = {
        codigo: row.perfil_codigo,
        nome: row.perfil_nome,
        escopo: row.escopo,
      };
      profileMap.set(row.perfil_codigo, profile);
      profiles.push(profile);
    }
    if (row.permissao_codigo) permissions.add(row.permissao_codigo);
  }

  return {
    profiles,
    permissions: [...permissions],
  };
}

export async function listSecurityProfiles(tenantId) {
  await ensureTenantSecurityDefaults(tenantId);
  const { rows } = await pool.query(
    `
    SELECT p.id, p.codigo, p.nome, p.descricao, p.escopo, p.sistema, p.ativo,
           COALESCE(
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', perm.id,
                 'codigo', perm.codigo,
                 'nome', perm.nome,
                 'descricao', perm.descricao,
                 'modulo', perm.modulo
               )
             ) FILTER (WHERE perm.id IS NOT NULL),
             '[]'::json
           ) AS permissions
      FROM security_perfis p
      LEFT JOIN security_perfil_permissoes spp ON spp.perfil_id = p.id
      LEFT JOIN security_permissoes perm ON perm.id = spp.permissao_id
     WHERE p.tenant_id = $1
     GROUP BY p.id
     ORDER BY p.sistema DESC, p.nome ASC
    `,
    [tenantId]
  );
  return rows;
}

export async function listSecurityPermissions() {
  await ensureSecuritySchema();
  const { rows } = await pool.query(`SELECT id, codigo, nome, descricao, modulo FROM security_permissoes ORDER BY modulo, nome`);
  return rows;
}

export async function saveSecurityProfile(tenantId, payload = {}) {
  await ensureTenantSecurityDefaults(tenantId);
  const codigo = String(payload.codigo || '').trim().toUpperCase().replace(/\s+/g, '_');
  const nome = String(payload.nome || '').trim();
  if (!codigo || !nome) throw new Error('Perfil inválido');
  const descricao = payload.descricao ? String(payload.descricao).trim() : null;
  const escopo = String(payload.escopo || 'TENANT').trim().toUpperCase();
  const ativo = payload.ativo !== false;
  const permissionCodes = Array.isArray(payload.permission_codes) ? payload.permission_codes : [];

  const { rows } = await pool.query(
    `
    INSERT INTO security_perfis (tenant_id, codigo, nome, descricao, escopo, sistema, ativo, updated_at)
    VALUES ($1,$2,$3,$4,$5,FALSE,$6,NOW())
    ON CONFLICT (tenant_id, codigo) DO UPDATE SET
      nome = EXCLUDED.nome,
      descricao = EXCLUDED.descricao,
      escopo = EXCLUDED.escopo,
      ativo = EXCLUDED.ativo,
      updated_at = NOW()
    RETURNING id
    `,
    [tenantId, codigo, nome, descricao, escopo, ativo]
  );
  const profileId = rows[0]?.id;
  await setProfilePermissions(tenantId, profileId, permissionCodes);
  return profileId;
}

export async function setProfilePermissions(tenantId, profileId, permissionCodes = []) {
  await ensureTenantSecurityDefaults(tenantId);
  const { rows: profileRows } = await pool.query(
    `SELECT id FROM security_perfis WHERE tenant_id = $1 AND id = $2 LIMIT 1`,
    [tenantId, profileId]
  );
  if (!profileRows[0]) throw new Error('Perfil não encontrado');
  const permissionMap = await getPermissionMap();
  await pool.query(`DELETE FROM security_perfil_permissoes WHERE perfil_id = $1`, [profileId]);
  for (const code of permissionCodes) {
    const permission = permissionMap.get(code);
    if (!permission) continue;
    await pool.query(`INSERT INTO security_perfil_permissoes (perfil_id, permissao_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [profileId, permission.id]);
  }
}

export async function assignUserProfiles(tenantId, userId, profileIds = []) {
  await ensureTenantSecurityDefaults(tenantId);
  const { rows } = await pool.query(`SELECT id FROM usuarios WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, userId]);
  if (!rows[0]) throw new Error('Usuário não encontrado');
  const uniqueIds = [...new Set((profileIds || []).map((id) => Number(id)).filter((id) => Number.isFinite(id) && id > 0))];
  await pool.query(`DELETE FROM security_usuario_perfis WHERE usuario_id = $1`, [userId]);
  for (const profileId of uniqueIds) {
    const { rows: profileRows } = await pool.query(`SELECT id FROM security_perfis WHERE tenant_id = $1 AND id = $2 LIMIT 1`, [tenantId, profileId]);
    if (!profileRows[0]) continue;
    await pool.query(`INSERT INTO security_usuario_perfis (usuario_id, perfil_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [userId, profileId]);
  }
}

export async function listSecurityUsers(tenantId) {
  await ensureTenantSecurityDefaults(tenantId);
  const { rows } = await pool.query(
    `
    SELECT u.id, u.tenant_id, u.nome, u.email, u.telefone, u.cargo::text AS cargo, u.init, u.ativo,
           COALESCE(
             json_agg(
               DISTINCT jsonb_build_object(
                 'id', p.id,
                 'codigo', p.codigo,
                 'nome', p.nome,
                 'escopo', p.escopo
               )
             ) FILTER (WHERE p.id IS NOT NULL),
             '[]'::json
           ) AS profiles
      FROM usuarios u
      LEFT JOIN security_usuario_perfis sup ON sup.usuario_id = u.id
      LEFT JOIN security_perfis p ON p.id = sup.perfil_id
     WHERE u.tenant_id = $1
     GROUP BY u.id
     ORDER BY u.nome ASC
    `,
    [tenantId]
  );
  return rows;
}

export async function listSecurityLogs(tenantId, filters = {}) {
  await ensureTenantSecurityDefaults(tenantId);
  const params = [tenantId];
  const clauses = ['tenant_id = $1'];

  if (filters.level) {
    params.push(String(filters.level).toLowerCase());
    clauses.push(`lower(nivel) = $${params.length}`);
  }
  if (filters.scope) {
    params.push(String(filters.scope));
    clauses.push(`escopo = $${params.length}`);
  }
  if (filters.search) {
    params.push(`%${String(filters.search).trim().toLowerCase()}%`);
    clauses.push(`lower(coalesce(email,'') || ' ' || coalesce(acao,'') || ' ' || coalesce(descricao,'') || ' ' || coalesce(alvo_tipo,'') || ' ' || coalesce(alvo_id,'')) LIKE $${params.length}`);
  }

  const limit = Math.min(500, Math.max(20, Number(filters.limit || 100)));
  params.push(limit);

  const { rows } = await pool.query(
    `
    SELECT id, tenant_id, usuario_id, email, acao, alvo_tipo, alvo_id, descricao, nivel, escopo, ip, user_agent, metadata, created_at
      FROM security_logs
     WHERE ${clauses.join(' AND ')}
     ORDER BY created_at DESC
     LIMIT $${params.length}
    `,
    params
  );
  return rows;
}
