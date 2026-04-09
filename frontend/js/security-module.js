(function () {
    const page = document.body?.dataset?.securityPage || '';
    const state = {
        me: null,
        users: [],
        profiles: [],
        permissions: [],
        logs: [],
        settings: null,
        schools: [],
    };

    function $(id) {
        return document.getElementById(id);
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function apiFetch(url, options = {}) {
        const response = await fetch(url, {
            credentials: 'include',
            headers: {
                'Content-Type': 'application/json',
                ...(options.headers || {})
            },
            ...options
        });
        let payload = null;
        try {
            payload = await response.json();
        } catch (_) {
            payload = null;
        }
        if (!response.ok) {
            throw new Error(payload?.message || payload?.error || 'Falha na requisição');
        }
        return payload;
    }

    function notify(title, html) {
        if (typeof window.mostrarMensagemSistema === 'function') {
            window.mostrarMensagemSistema(title, html);
            return;
        }
        window.alert(`${title}\n\n${String(html || '').replace(/<[^>]+>/g, ' ')}`);
    }

    async function confirmAction(title, html, actionLabel) {
        if (typeof window.confirmarAcaoSistema === 'function') {
            return window.confirmarAcaoSistema(title, html, actionLabel);
        }
        return window.confirm(`${title}\n\n${String(html || '').replace(/<[^>]+>/g, ' ')}`);
    }

    function setPageMeta(title, description, chips) {
        if ($('securityPageTitle')) $('securityPageTitle').textContent = title;
        if ($('securityPageDescription')) $('securityPageDescription').textContent = description;
        if ($('securityHeroChips')) {
            $('securityHeroChips').innerHTML = (chips || []).map((chip) => (
                `<span class="security-chip security-chip-soft">${escapeHtml(chip)}</span>`
            )).join('');
        }
    }

    function renderKpis(targetId, items) {
        const target = $(targetId);
        if (!target) return;
        target.innerHTML = items.map((item) => `
            <div class="col-12 col-md-6 col-xl-3 mb-3">
                <div class="card shadow security-kpi">
                    <div class="card-body">
                        <div class="kpi-label mb-2">${escapeHtml(item.label)}</div>
                        <div class="d-flex align-items-end justify-content-between">
                            <div class="kpi-value">${escapeHtml(item.value)}</div>
                            <span class="security-chip security-chip-soft">${escapeHtml(item.hint || '')}</span>
                        </div>
                    </div>
                </div>
            </div>
        `).join('');
    }

    async function loadUsers() {
        const payload = await apiFetch('/api/admin/users');
        state.users = Array.isArray(payload?.items) ? payload.items : [];
        return state.users;
    }

    async function loadMe() {
        state.me = await apiFetch('/api/me');
        return state.me;
    }

    function isAdmin() {
        return String(state.me?.cargo || '').toUpperCase() === 'ADMIN';
    }

    async function loadProfiles() {
        const payload = await apiFetch('/api/admin/security/profiles');
        state.profiles = Array.isArray(payload?.items) ? payload.items : [];
        return state.profiles;
    }

    async function loadPermissions() {
        const payload = await apiFetch('/api/admin/security/permissions');
        state.permissions = Array.isArray(payload?.items) ? payload.items : [];
        return state.permissions;
    }

    async function loadLogs(filters = {}) {
        const params = new URLSearchParams();
        if (filters.search) params.set('search', filters.search);
        if (filters.level) params.set('level', filters.level);
        if (filters.scope) params.set('scope', filters.scope);
        const payload = await apiFetch(`/api/admin/security/logs?${params.toString()}`);
        state.logs = Array.isArray(payload?.items) ? payload.items : [];
        return state.logs;
    }

    async function loadSettings() {
        state.settings = await apiFetch('/api/admin/security/policies');
        return state.settings;
    }

    async function loadSchools() {
        const payload = await apiFetch('/api/escolas');
        state.schools = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []);
        return state.schools;
    }

    function formatDateTime(value) {
        if (!value) return 'Não informado';
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return String(value);
        return date.toLocaleString('pt-BR');
    }

    function getScopeLabel(profile) {
        const value = String(profile?.escopo || '').toUpperCase();
        if (value === 'ESCOLA') return 'Escola';
        if (value === 'SECRETARIA') return 'Secretaria';
        if (value === 'FORNECEDOR') return 'Fornecedor';
        return 'Tenant';
    }

    function persistSchoolContext(context) {
        try {
            localStorage.setItem('setrane.currentSchoolContext', JSON.stringify(context || {}));
        } catch (_) { }
    }

    async function promptCreateUser() {
        const nome = window.prompt('Nome do usuário:');
        if (!nome) return;
        const email = window.prompt('E-mail do usuário:');
        if (!email) return;
        const cargo = (window.prompt('Cargo (ADMIN, GESTOR, USUARIO, FORNECEDOR_ESCOLAR):', 'USUARIO') || 'USUARIO').trim().toUpperCase();
        const telefone = window.prompt('Telefone:', '') || '';
        const senha = window.prompt('Senha inicial (mínimo 6 caracteres):', '') || '';
        await apiFetch('/api/admin/users', {
            method: 'POST',
            body: JSON.stringify({ nome, email, cargo, telefone, senha, ativo: true, init: true })
        });
        notify('Usuário criado', 'O usuário foi criado com sucesso.');
        await refreshUsers();
    }

    async function promptEditUser(user) {
        const nome = window.prompt('Nome do usuário:', user.nome || '');
        if (!nome) return;
        const email = window.prompt('E-mail do usuário:', user.email || '');
        if (!email) return;
        const cargo = (window.prompt('Cargo (ADMIN, GESTOR, USUARIO, FORNECEDOR_ESCOLAR):', user.cargo || 'USUARIO') || user.cargo || 'USUARIO').trim().toUpperCase();
        const telefone = window.prompt('Telefone:', user.telefone || '') || '';
        await apiFetch(`/api/admin/users/${user.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                nome,
                email,
                cargo,
                telefone,
                init: user.init !== false,
                ativo: user.ativo !== false
            })
        });
        notify('Usuário atualizado', 'Os dados do usuário foram atualizados.');
        await refreshUsers();
    }

    async function toggleUserStatus(user) {
        const confirmed = await confirmAction(
            user.ativo !== false ? 'Bloquear usuário' : 'Reativar usuário',
            `Deseja ${user.ativo !== false ? 'bloquear' : 'reativar'} <strong>${escapeHtml(user.nome)}</strong>?`,
            user.ativo !== false ? 'Bloquear' : 'Reativar'
        );
        if (!confirmed) return;
        await apiFetch(`/api/admin/users/${user.id}`, {
            method: 'PUT',
            body: JSON.stringify({
                nome: user.nome,
                email: user.email,
                cargo: user.cargo,
                telefone: user.telefone,
                init: user.init !== false,
                ativo: !(user.ativo !== false)
            })
        });
        await refreshUsers();
    }

    async function promptAssignProfiles(user) {
        await loadProfiles();
        const currentCodes = new Set((user.profiles || []).map((item) => item.codigo));
        const available = state.profiles.map((profile) => `${profile.codigo}${currentCodes.has(profile.codigo) ? ' [x]' : ''}`).join(', ');
        const value = window.prompt(`Informe os códigos dos perfis separados por vírgula.\nDisponíveis: ${available}`, [...currentCodes].join(', '));
        if (value == null) return;
        const wanted = String(value).split(',').map((item) => item.trim().toUpperCase()).filter(Boolean);
        const ids = state.profiles.filter((profile) => wanted.includes(String(profile.codigo).toUpperCase())).map((profile) => profile.id);
        await apiFetch(`/api/admin/users/${user.id}/profiles`, {
            method: 'PUT',
            body: JSON.stringify({ profile_ids: ids })
        });
        notify('Perfis atualizados', 'Os perfis do usuário foram atualizados.');
        await refreshUsers();
    }

    async function promptCreateProfile() {
        const codigo = (window.prompt('Código do perfil:', '') || '').trim().toUpperCase();
        if (!codigo) return;
        const nome = (window.prompt('Nome do perfil:', '') || '').trim();
        if (!nome) return;
        const escopo = (window.prompt('Escopo (TENANT, SECRETARIA, ESCOLA, FORNECEDOR):', 'ESCOLA') || 'ESCOLA').trim().toUpperCase();
        const descricao = (window.prompt('Descrição do perfil:', '') || '').trim();
        await loadPermissions();
        const allCodes = state.permissions.map((item) => item.codigo).join(', ');
        const selected = window.prompt(`Permissões (códigos separados por vírgula):\n${allCodes}`, '') || '';
        const permission_codes = selected.split(',').map((item) => item.trim()).filter(Boolean);
        await apiFetch('/api/admin/security/profiles', {
            method: 'POST',
            body: JSON.stringify({ codigo, nome, escopo, descricao, permission_codes })
        });
        notify('Perfil salvo', 'O perfil foi salvo com sucesso.');
        await refreshProfiles();
    }

    async function promptEditProfilePermissions(profile) {
        await loadPermissions();
        const currentCodes = new Set((profile.permissions || []).map((item) => item.codigo));
        const allCodes = state.permissions.map((item) => `${item.codigo}${currentCodes.has(item.codigo) ? ' [x]' : ''}`).join(', ');
        const selected = window.prompt(`Atualize as permissões do perfil ${profile.codigo}.\n${allCodes}`, [...currentCodes].join(', '));
        if (selected == null) return;
        const permission_codes = selected.split(',').map((item) => item.trim()).filter(Boolean);
        await apiFetch(`/api/admin/security/profiles/${profile.id}/permissions`, {
            method: 'PUT',
            body: JSON.stringify({ permission_codes })
        });
        notify('Permissões atualizadas', 'As permissões do perfil foram atualizadas.');
        await refreshProfiles();
    }

    async function saveSecuritySettings(containerId, feedbackId) {
        const container = $(containerId);
        if (!container) return;
        const body = {
            lockout_enabled: $(`${containerId}LockoutEnabled`)?.checked ?? true,
            lockout_attempts: Number(container.querySelector('[data-key="lockoutAttempts"]')?.value || 5),
            lockout_minutes: Number(container.querySelector('[data-key="lockoutMinutes"]')?.value || 30),
            password_min_length: Number(container.querySelector('[data-key="passwordMinLength"]')?.value || 8),
            password_rotation_days: Number(container.querySelector('[data-key="passwordRotation"]')?.value || 180),
            password_uppercase: $(`${containerId}Uppercase`)?.checked ?? true,
            password_numbers: $(`${containerId}Numbers`)?.checked ?? true,
            password_symbols: $(`${containerId}Symbols`)?.checked ?? true,
            session_minutes: Number(container.querySelector('[data-key="sessionMinutes"]')?.value || 480),
            reset_link_minutes: Number(container.querySelector('[data-key="resetLinkMinutes"]')?.value || 20),
            audit_retention_days: Number(container.querySelector('[data-key="auditRetentionDays"]')?.value || 365),
            geo_segregation: $(`${containerId}GeoSegregation`)?.checked ?? true,
            unit_selection_required: $(`${containerId}UnitRequired`)?.checked ?? false,
            enforce_2fa_admins: $(`${containerId}Enforce2faAdmins`)?.checked ?? false,
        };
        await apiFetch('/api/admin/security/policies', {
            method: 'PUT',
            body: JSON.stringify(body)
        });
        if ($(feedbackId)) $(feedbackId).textContent = 'Política salva com sucesso.';
        await loadSettings();
        renderSettingsKpis();
    }

    function renderUsersKpis(targetId) {
        renderKpis(targetId, [
            { label: 'Usuários totais', value: state.users.length, hint: 'identidades do tenant' },
            { label: 'Ativos', value: state.users.filter((item) => item.ativo !== false).length, hint: 'liberados' },
            { label: 'Administradores', value: state.users.filter((item) => String(item.cargo || '').toUpperCase() === 'ADMIN').length, hint: 'alto privilégio' },
            { label: 'Com perfis vinculados', value: state.users.filter((item) => (item.profiles || []).length).length, hint: 'RBAC aplicado' }
        ]);
    }

    function renderProfilesKpis(targetId) {
        renderKpis(targetId, [
            { label: 'Perfis ativos', value: state.profiles.filter((item) => item.ativo !== false).length, hint: 'governança' },
            { label: 'Perfis do sistema', value: state.profiles.filter((item) => item.sistema).length, hint: 'base padrão' },
            { label: 'Permissões cadastradas', value: state.permissions.length, hint: 'granulares' },
            { label: 'Perfis escolares', value: state.profiles.filter((item) => String(item.escopo).toUpperCase() === 'ESCOLA').length, hint: 'unidade' }
        ]);
    }

    function renderLogsKpis(targetId) {
        renderKpis(targetId, [
            { label: 'Eventos recentes', value: state.logs.length, hint: 'janela carregada' },
            { label: 'Críticos', value: state.logs.filter((item) => String(item.nivel).toLowerCase() === 'danger').length, hint: 'incidentes' },
            { label: 'Usuário/conta', value: state.logs.filter((item) => String(item.escopo) === 'Usuário').length, hint: 'identidade' },
            { label: 'Secretaria', value: state.logs.filter((item) => String(item.escopo) === 'Secretaria').length, hint: 'administração' }
        ]);
    }

    function renderSettingsKpis(targetId = 'securityKpisSettings') {
        if (!state.settings) return;
        renderKpis(targetId, [
            { label: 'Tentativas para bloqueio', value: state.settings.lockout_attempts, hint: 'persistente' },
            { label: 'Bloqueio', value: `${state.settings.lockout_minutes} min`, hint: 'janela ativa' },
            { label: 'Reset', value: `${state.settings.reset_link_minutes} min`, hint: 'validade do código' },
            { label: 'Sessão', value: `${state.settings.session_minutes} min`, hint: 'JWT web' }
        ]);
    }

    function renderUsersSection(targetId, kpiTargetId) {
        const container = $(targetId);
        if (!container) return;
        renderUsersKpis(kpiTargetId);

        container.innerHTML = `
            <div class="card shadow security-card mb-4">
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-4 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Buscar</label>
                            <input id="${targetId}SearchInput" type="search" class="form-control" placeholder="Nome, e-mail, papel ou perfil">
                        </div>
                        <div class="col-md-3 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Papel</label>
                            <select id="${targetId}RoleFilter" class="form-control">
                                <option value="">Todos</option>
                                <option value="ADMIN">Administrador</option>
                                <option value="GESTOR">Gestor</option>
                                <option value="USUARIO">Usuário</option>
                                <option value="FORNECEDOR_ESCOLAR">Fornecedor</option>
                            </select>
                        </div>
                        <div class="col-md-3 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Situação</label>
                            <select id="${targetId}StatusFilter" class="form-control">
                                <option value="">Todos</option>
                                <option value="ativos">Ativos</option>
                                <option value="inativos">Inativos</option>
                            </select>
                        </div>
                        <div class="col-md-2 d-flex align-items-end">
                            ${isAdmin() ? `<button class="btn btn-primary btn-block" id="${targetId}CreateBtn">Novo usuário</button>` : ''}
                        </div>
                    </div>
                </div>
            </div>
            <div class="card shadow security-card security-table">
                <div class="card-body">
                    <div id="${targetId}TableWrap"></div>
                </div>
            </div>
        `;

        function draw() {
            const search = String($(`${targetId}SearchInput`)?.value || '').trim().toLowerCase();
            const role = String($(`${targetId}RoleFilter`)?.value || '').trim().toUpperCase();
            const status = String($(`${targetId}StatusFilter`)?.value || '').trim();
            const filtered = state.users.filter((item) => {
                const active = item.ativo !== false;
                if (role && String(item.cargo || '').toUpperCase() !== role) return false;
                if (status === 'ativos' && !active) return false;
                if (status === 'inativos' && active) return false;
                if (!search) return true;
                return [
                    item.nome,
                    item.email,
                    item.telefone,
                    item.cargo,
                    ...(item.profiles || []).map((profile) => profile.codigo)
                ].join(' ').toLowerCase().includes(search);
            });

            $(`${targetId}TableWrap`).innerHTML = filtered.length ? `
                <div class="table-responsive">
                    <table class="table table-hover mb-0">
                        <thead>
                            <tr>
                                <th>Usuário</th>
                                <th>Papel base</th>
                                <th>Perfis</th>
                                <th>Status</th>
                                <th>Contato</th>
                                <th class="text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filtered.map((item) => `
                                <tr>
                                    <td>
                                        <div class="font-weight-bold">${escapeHtml(item.nome || 'Sem nome')}</div>
                                        <div class="security-meta">${escapeHtml(item.email || 'Sem e-mail')}</div>
                                    </td>
                                    <td><span class="security-chip security-chip-soft">${escapeHtml(item.cargo || 'USUARIO')}</span></td>
                                    <td>
                                        ${(item.profiles || []).length
                                            ? item.profiles.map((profile) => `<span class="security-chip security-chip-soft mr-1 mb-1">${escapeHtml(profile.codigo)}</span>`).join('')
                                            : '<span class="security-meta">Sem perfis vinculados</span>'}
                                    </td>
                                    <td><span class="badge ${item.ativo !== false ? 'badge-success' : 'badge-secondary'}">${item.ativo !== false ? 'Ativo' : 'Inativo'}</span></td>
                                    <td>${escapeHtml(item.telefone || 'Não informado')}</td>
                                    <td class="text-right">
                                        ${isAdmin()
                                            ? `<div class="btn-group btn-group-sm">
                                                <button class="btn btn-outline-secondary js-user-edit" data-id="${item.id}">Editar</button>
                                                <button class="btn btn-outline-secondary js-user-profiles" data-id="${item.id}">Perfis</button>
                                                <button class="btn btn-outline-secondary js-user-toggle" data-id="${item.id}">${item.ativo !== false ? 'Bloquear' : 'Reativar'}</button>
                                            </div>`
                                            : '<span class="security-meta">Leitura</span>'}
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : `<div class="security-empty">Nenhum usuário encontrado com os filtros atuais.</div>`;
        }

        [`${targetId}SearchInput`, `${targetId}RoleFilter`, `${targetId}StatusFilter`].forEach((id) => {
            $(id)?.addEventListener('input', draw);
            $(id)?.addEventListener('change', draw);
        });
        $(`${targetId}CreateBtn`)?.addEventListener('click', () => promptCreateUser().catch((error) => notify('Falha ao criar usuário', error.message)));
        container.addEventListener('click', (event) => {
            const id = Number(event.target.closest('[data-id]')?.dataset?.id || 0);
            if (!id) return;
            const user = state.users.find((item) => Number(item.id) === id);
            if (!user) return;
            if (event.target.closest('.js-user-edit')) {
                promptEditUser(user).catch((error) => notify('Falha ao editar usuário', error.message));
            } else if (event.target.closest('.js-user-profiles')) {
                promptAssignProfiles(user).catch((error) => notify('Falha ao atualizar perfis', error.message));
            } else if (event.target.closest('.js-user-toggle')) {
                toggleUserStatus(user).catch((error) => notify('Falha ao atualizar status', error.message));
            }
        });
        draw();
    }

    function renderProfilesSection(targetId, kpiTargetId) {
        const container = $(targetId);
        if (!container) return;
        renderProfilesKpis(kpiTargetId);

        const permissionRows = state.permissions.slice(0, 12).map((permission) => {
            const byProfile = {};
            state.profiles.forEach((profile) => {
                byProfile[profile.codigo] = (profile.permissions || []).some((item) => item.codigo === permission.codigo) ? 'Sim' : 'Não';
            });
            return { capability: permission.nome, values: byProfile };
        });

        const profileColumns = state.profiles.slice(0, 4);

        container.innerHTML = `
            <div class="security-grid security-grid-2 mb-4">
                ${state.profiles.map((profile) => `
                    <div class="card shadow security-card">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start mb-3">
                                <div>
                                    <div class="security-section-title mb-1">${escapeHtml(profile.codigo)}</div>
                                    <h5 class="mb-1">${escapeHtml(profile.nome)}</h5>
                                    <div class="security-meta">${escapeHtml(getScopeLabel(profile))}</div>
                                </div>
                                <div>
                                    <span class="security-chip security-chip-soft">${escapeHtml((profile.permissions || []).length)} permissões</span>
                                </div>
                            </div>
                            <p class="mb-3">${escapeHtml(profile.descricao || 'Sem descrição')}</p>
                            <div class="mb-3">
                                ${(profile.permissions || []).slice(0, 8).map((permission) => `<span class="security-chip security-chip-soft mr-1 mb-1">${escapeHtml(permission.codigo)}</span>`).join('')}
                            </div>
                            ${isAdmin() ? `<button class="btn btn-outline-secondary btn-sm js-profile-edit" data-id="${profile.id}">Editar permissões</button>` : ''}
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="card shadow security-card">
                <div class="card-body">
                    <div class="d-flex justify-content-between align-items-center mb-3">
                        <div>
                            <div class="security-section-title mb-1">Matriz resumida</div>
                            <h5 class="mb-0">Controle granular de permissões</h5>
                        </div>
                        ${isAdmin() ? `<button class="btn btn-outline-primary btn-sm" id="${targetId}CreateProfileBtn">Criar perfil personalizado</button>` : ''}
                    </div>
                    <div class="security-permission-matrix">
                        <div class="security-permission-row font-weight-bold">
                            <div class="security-permission-cell">Capacidade</div>
                            ${profileColumns.map((profile) => `<div class="security-permission-cell">${escapeHtml(profile.nome)}</div>`).join('')}
                        </div>
                        ${permissionRows.map((row) => `
                            <div class="security-permission-row">
                                <div class="security-permission-cell">${escapeHtml(row.capability)}</div>
                                ${profileColumns.map((profile) => `<div class="security-permission-cell">${escapeHtml(row.values[profile.codigo] || 'Não')}</div>`).join('')}
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;

        $(`${targetId}CreateProfileBtn`)?.addEventListener('click', () => promptCreateProfile().catch((error) => notify('Falha ao salvar perfil', error.message)));
        container.addEventListener('click', (event) => {
            const button = event.target.closest('.js-profile-edit');
            if (!button) return;
            const profile = state.profiles.find((item) => Number(item.id) === Number(button.dataset.id));
            if (!profile) return;
            promptEditProfilePermissions(profile).catch((error) => notify('Falha ao atualizar perfil', error.message));
        });
    }

    function renderLogsSection(targetId, kpiTargetId) {
        const container = $(targetId);
        if (!container) return;
        renderLogsKpis(kpiTargetId);

        container.innerHTML = `
            <div class="card shadow security-card mb-4">
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-4 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Buscar evento</label>
                            <input id="${targetId}SearchInput" type="search" class="form-control" placeholder="ação, e-mail, descrição ou alvo">
                        </div>
                        <div class="col-md-3 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Nível</label>
                            <select id="${targetId}LevelFilter" class="form-control">
                                <option value="">Todos</option>
                                <option value="info">Informação</option>
                                <option value="warn">Alerta</option>
                                <option value="danger">Crítico</option>
                            </select>
                        </div>
                        <div class="col-md-3 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Escopo</label>
                            <select id="${targetId}ScopeFilter" class="form-control">
                                <option value="">Todos</option>
                                <option value="Secretaria">Secretaria</option>
                                <option value="Escola">Escola</option>
                                <option value="Usuário">Usuário</option>
                            </select>
                        </div>
                        <div class="col-md-2 d-flex align-items-end">
                            <button class="btn btn-outline-primary btn-block" id="${targetId}ReloadBtn">Atualizar</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="card shadow security-card security-table">
                <div class="card-body">
                    <div id="${targetId}TableWrap"></div>
                </div>
            </div>
        `;

        async function draw(fetchRemote) {
            if (fetchRemote) {
                await loadLogs({
                    search: $(`${targetId}SearchInput`)?.value || '',
                    level: $(`${targetId}LevelFilter`)?.value || '',
                    scope: $(`${targetId}ScopeFilter`)?.value || ''
                });
                renderLogsKpis(kpiTargetId);
            }

            $(`${targetId}TableWrap`).innerHTML = state.logs.length ? `
                <div class="table-responsive">
                    <table class="table table-hover mb-0">
                        <thead>
                            <tr>
                                <th>Quando</th>
                                <th>Ação</th>
                                <th>Usuário</th>
                                <th>Descrição</th>
                                <th>Escopo</th>
                                <th>Nível</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${state.logs.map((item) => `
                                <tr>
                                    <td>${escapeHtml(formatDateTime(item.created_at))}</td>
                                    <td>
                                        <div class="font-weight-bold">${escapeHtml(item.acao || 'Evento')}</div>
                                        <div class="security-meta">${escapeHtml(item.alvo_tipo || '')} ${escapeHtml(item.alvo_id || '')}</div>
                                    </td>
                                    <td>${escapeHtml(item.email || 'Sistema')}</td>
                                    <td>${escapeHtml(item.descricao || 'Sem descrição')}</td>
                                    <td><span class="security-chip security-chip-soft">${escapeHtml(item.escopo || 'Secretaria')}</span></td>
                                    <td><span class="security-chip security-log-level ${escapeHtml(item.nivel || 'info')}">${escapeHtml(item.nivel || 'info')}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : `<div class="security-empty">Nenhum log encontrado para os filtros atuais.</div>`;
        }

        [`${targetId}SearchInput`, `${targetId}LevelFilter`, `${targetId}ScopeFilter`].forEach((id) => {
            $(id)?.addEventListener('input', () => draw(true).catch((error) => notify('Falha ao carregar logs', error.message)));
            $(id)?.addEventListener('change', () => draw(true).catch((error) => notify('Falha ao carregar logs', error.message)));
        });
        $(`${targetId}ReloadBtn`)?.addEventListener('click', () => draw(true).catch((error) => notify('Falha ao atualizar logs', error.message)));
        draw(false);
    }

    function renderSecuritySettingsSection(targetId, kpiTargetId) {
        const container = $(targetId);
        if (!container || !state.settings) return;
        renderSettingsKpis(kpiTargetId);
        const settings = state.settings;

        container.innerHTML = `
            <div class="security-grid security-grid-2">
                <div class="card shadow security-card">
                    <div class="card-body">
                        <div class="security-section-title">Autenticação e senha</div>
                        <div class="security-setting-item">
                            <div class="d-flex justify-content-between align-items-center">
                                <div>
                                    <h6 class="mb-1">Bloqueio por tentativas</h6>
                                    <div class="security-switch-note">Persistido em banco, com bloqueio real por conta.</div>
                                </div>
                                <div class="custom-control custom-switch">
                                    <input type="checkbox" class="custom-control-input" id="${targetId}LockoutEnabled" ${settings.lockout_enabled ? 'checked' : ''}>
                                    <label class="custom-control-label" for="${targetId}LockoutEnabled"></label>
                                </div>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label>Tentativas máximas</label>
                                <input type="number" class="form-control" data-key="lockoutAttempts" value="${escapeHtml(settings.lockout_attempts)}">
                            </div>
                            <div class="form-group col-md-6">
                                <label>Tempo de bloqueio (min)</label>
                                <input type="number" class="form-control" data-key="lockoutMinutes" value="${escapeHtml(settings.lockout_minutes)}">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label>Tamanho mínimo da senha</label>
                                <input type="number" class="form-control" data-key="passwordMinLength" value="${escapeHtml(settings.password_min_length)}">
                            </div>
                            <div class="form-group col-md-6">
                                <label>Rotação obrigatória (dias)</label>
                                <input type="number" class="form-control" data-key="passwordRotation" value="${escapeHtml(settings.password_rotation_days)}">
                            </div>
                        </div>
                        <div class="custom-control custom-checkbox mb-2">
                            <input type="checkbox" class="custom-control-input" id="${targetId}Uppercase" ${settings.password_uppercase ? 'checked' : ''}>
                            <label class="custom-control-label" for="${targetId}Uppercase">Exigir letra maiúscula</label>
                        </div>
                        <div class="custom-control custom-checkbox mb-2">
                            <input type="checkbox" class="custom-control-input" id="${targetId}Numbers" ${settings.password_numbers ? 'checked' : ''}>
                            <label class="custom-control-label" for="${targetId}Numbers">Exigir número</label>
                        </div>
                        <div class="custom-control custom-checkbox">
                            <input type="checkbox" class="custom-control-input" id="${targetId}Symbols" ${settings.password_symbols ? 'checked' : ''}>
                            <label class="custom-control-label" for="${targetId}Symbols">Exigir caractere especial</label>
                        </div>
                    </div>
                </div>
                <div class="card shadow security-card">
                    <div class="card-body">
                        <div class="security-section-title">Sessão, reset e segregação</div>
                        <div class="form-group">
                            <label>Expiração da sessão web (min)</label>
                            <input type="number" class="form-control" data-key="sessionMinutes" value="${escapeHtml(settings.session_minutes)}">
                        </div>
                        <div class="form-group">
                            <label>Validade do reset (min)</label>
                            <input type="number" class="form-control" data-key="resetLinkMinutes" value="${escapeHtml(settings.reset_link_minutes)}">
                        </div>
                        <div class="form-group">
                            <label>Retenção dos logs (dias)</label>
                            <input type="number" class="form-control" data-key="auditRetentionDays" value="${escapeHtml(settings.audit_retention_days)}">
                        </div>
                        <div class="custom-control custom-checkbox mb-2">
                            <input type="checkbox" class="custom-control-input" id="${targetId}GeoSegregation" ${settings.geo_segregation ? 'checked' : ''}>
                            <label class="custom-control-label" for="${targetId}GeoSegregation">Aplicar segregação por secretaria / escola / usuário</label>
                        </div>
                        <div class="custom-control custom-checkbox mb-2">
                            <input type="checkbox" class="custom-control-input" id="${targetId}UnitRequired" ${settings.unit_selection_required ? 'checked' : ''}>
                            <label class="custom-control-label" for="${targetId}UnitRequired">Exigir seleção contextual de unidade quando aplicável</label>
                        </div>
                        <div class="custom-control custom-checkbox">
                            <input type="checkbox" class="custom-control-input" id="${targetId}Enforce2faAdmins" ${settings.enforce_2fa_admins ? 'checked' : ''}>
                            <label class="custom-control-label" for="${targetId}Enforce2faAdmins">Exigir segundo fator para administradores</label>
                        </div>
                        <div class="mt-4 d-flex flex-wrap">
                            ${isAdmin() ? `<button id="${targetId}SaveBtn" class="btn btn-primary mb-2">Salvar política</button>` : '<span class="security-meta">Somente administradores alteram a política.</span>'}
                        </div>
                        <div id="${targetId}Feedback" class="security-meta mt-2"></div>
                    </div>
                </div>
            </div>
        `;

        $(`${targetId}SaveBtn`)?.addEventListener('click', () => {
            saveSecuritySettings(targetId, `${targetId}Feedback`).catch((error) => notify('Falha ao salvar política', error.message));
        });
    }

    async function refreshUsers() {
        await Promise.all([loadUsers(), loadProfiles()]);
        renderUsersSection('securityUsersContent', 'securityKpisUsers');
    }

    async function refreshProfiles() {
        await Promise.all([loadProfiles(), loadPermissions()]);
        renderProfilesSection('securityProfilesContent', 'securityKpisProfiles');
    }

    async function refreshLogs() {
        await loadLogs();
        renderLogsSection('securityLogsContent', 'securityKpisLogs');
    }

    async function refreshSettings() {
        await loadSettings();
        renderSecuritySettingsSection('securitySettingsContent', 'securityKpisSettings');
    }

    async function renderConfigHub() {
        await Promise.all([loadMe(), loadUsers(), loadProfiles(), loadPermissions(), loadLogs(), loadSettings()]);
        renderUsersSection('securityUsersContent', 'securityKpisUsers');
        renderProfilesSection('securityProfilesContent', 'securityKpisProfiles');
        renderLogsSection('securityLogsContent', 'securityKpisLogs');
        renderSecuritySettingsSection('securitySettingsContent', 'securityKpisSettings');
    }

    function renderSelectionPage() {
        setPageMeta(
            'Seleção de unidade escolar',
            'Escolha o contexto de trabalho antes de entrar no sistema. Use SEMED para o painel geral ou entre direto em uma unidade escolar.',
            ['SEMED', 'Escolas', 'Contexto seguro']
        );

        renderKpis('securityKpis', [
            { label: 'Unidades escolares', value: state.schools.length, hint: 'cards disponíveis' },
            { label: 'Contextos', value: state.schools.length + 1, hint: 'SEMED + escolas' },
            { label: 'Perfis ativos', value: (state.me?.profiles || []).length || 1, hint: 'sessão atual' },
            { label: 'Tenant', value: state.me?.tenant_id || 'N/I', hint: 'segregado' }
        ]);

        const container = $('securityPageContent');
        if (!container) return;

        container.innerHTML = `
            <div class="card shadow security-card mb-4">
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-6 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Buscar unidade</label>
                            <input id="unitSearchInput" type="search" class="form-control" placeholder="Nome, INEP, bairro ou endereço">
                        </div>
                        <div class="col-md-3 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Tipo</label>
                            <select id="unitTypeFilter" class="form-control">
                                <option value="">Todos</option>
                                <option value="semed">SEMED</option>
                                <option value="escola">Escolas</option>
                            </select>
                        </div>
                        <div class="col-md-3">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Etapa</label>
                            <select id="unitStageFilter" class="form-control">
                                <option value="">Todas</option>
                                ${Array.from(new Set(state.schools.flatMap((school) => Array.isArray(school.ensino_nivel || school.niveis_ensino) ? (school.ensino_nivel || school.niveis_ensino) : []))).sort().map((level) => `<option value="${escapeHtml(level)}">${escapeHtml(level)}</option>`).join('')}
                            </select>
                        </div>
                    </div>
                </div>
            </div>
            <div id="unitSelectionGrid" class="row"></div>
        `;

        function buildCards() {
            const term = String($('unitSearchInput')?.value || '').trim().toLowerCase();
            const type = String($('unitTypeFilter')?.value || '').trim().toLowerCase();
            const stage = String($('unitStageFilter')?.value || '').trim().toLowerCase();

            const cards = [
                {
                    type: 'semed',
                    searchable: 'semed secretaria painel geral rede municipal contexto central',
                    html: `
                        <div class="col-12 col-lg-6 col-xl-4 mb-4">
                            <div class="card shadow security-card h-100">
                                <div class="card-body d-flex flex-column">
                                    <div class="d-flex justify-content-between align-items-start mb-3">
                                        <div>
                                            <div class="security-section-title mb-1">Contexto central</div>
                                            <h4 class="mb-1">SEMED</h4>
                                            <div class="security-meta">Painel geral da secretaria</div>
                                        </div>
                                        <span class="security-chip security-chip-soft">Geral</span>
                                    </div>
                                    <p class="mb-4">Acesso ao dashboard executivo, indicadores gerais, configurações, segurança e visão consolidada da rede.</p>
                                    <div class="mt-auto">
                                        <a href="/dashboard" class="btn btn-primary btn-block js-select-context" data-kind="semed" data-id="semed" data-name="SEMED">Entrar como SEMED</a>
                                    </div>
                                </div>
                            </div>
                        </div>
                    `
                },
                ...state.schools.map((school) => {
                    const levels = Array.isArray(school.ensino_nivel || school.niveis_ensino) ? (school.ensino_nivel || school.niveis_ensino) : [];
                    return {
                        type: 'escola',
                        levels,
                        searchable: [
                            school.nome,
                            school.codigo_inep || school.inep,
                            school.logradouro || school.endereco,
                            school.numero,
                            school.bairro,
                            school.cep,
                            ...levels
                        ].filter(Boolean).join(' ').toLowerCase(),
                        html: `
                            <div class="col-12 col-lg-6 col-xl-4 mb-4">
                                <div class="card shadow security-card h-100">
                                    <div class="card-body d-flex flex-column">
                                        <div class="d-flex justify-content-between align-items-start mb-3">
                                            <div>
                                                <div class="security-section-title mb-1">Unidade escolar</div>
                                                <h4 class="mb-1">${escapeHtml(school.nome || 'Escola')}</h4>
                                                <div class="security-meta">INEP ${escapeHtml(school.codigo_inep || school.inep || 'Não informado')}</div>
                                            </div>
                                            <span class="security-chip security-chip-soft">Escola</span>
                                        </div>
                                        <p class="mb-2">${escapeHtml([school.logradouro || school.endereco, school.numero, school.bairro].filter(Boolean).join(' • ') || 'Endereço não informado')}</p>
                                        <div class="mb-3">
                                            ${levels.length
                                                ? levels.slice(0, 4).map((level) => `<span class="security-chip security-chip-soft mr-1 mb-1">${escapeHtml(level)}</span>`).join('')
                                                : '<span class="security-meta">Etapas não informadas</span>'}
                                        </div>
                                        <div class="mt-auto">
                                            <a href="/escolar/escola/${encodeURIComponent(school.id)}/dashboard" class="btn btn-outline-primary btn-block js-select-context" data-kind="escola" data-id="${escapeHtml(school.id)}" data-name="${escapeHtml(school.nome || 'Escola')}">Entrar na escola</a>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        `
                    };
                })
            ];

            return cards.filter((card) => {
                if (type && card.type !== type) return false;
                if (stage && card.type === 'escola') {
                    const hasStage = (card.levels || []).some((value) => String(value).toLowerCase() === stage);
                    if (!hasStage) return false;
                }
                if (!term) return true;
                return String(card.searchable || '').includes(term);
            });
        }

        function drawCards() {
            const cards = buildCards();
            $('unitSelectionGrid').innerHTML = cards.length
                ? cards.map((card) => card.html).join('')
                : `<div class="col-12"><div class="security-empty">Nenhuma unidade encontrada com os filtros atuais.</div></div>`;
        }

        ['unitSearchInput', 'unitTypeFilter', 'unitStageFilter'].forEach((id) => {
            $(id)?.addEventListener('input', drawCards);
            $(id)?.addEventListener('change', drawCards);
        });

        drawCards();

        container.addEventListener('click', (event) => {
            const link = event.target.closest('.js-select-context');
            if (!link) return;
            persistSchoolContext({
                kind: link.dataset.kind || 'escola',
                id: link.dataset.id || null,
                name: link.dataset.name || '',
                selected_at: new Date().toISOString(),
            });
        });
    }

    async function renderStandalone(kind) {
        if (kind === 'unit-selection') {
            await Promise.all([loadMe(), loadSchools()]);
            return renderSelectionPage();
        }

        await Promise.all([loadMe(), loadUsers(), loadProfiles(), loadPermissions(), loadLogs(), loadSettings()]);
        if (kind === 'users') {
            setPageMeta('Gestão de usuários', 'Controle acessos por papel, status e perfis vinculados ao tenant.', ['Usuários', 'Perfis', 'Bloqueio']);
            renderUsersKpis('securityKpis');
            return renderUsersSection('securityPageContent', null);
        }
        if (kind === 'profiles') {
            setPageMeta('Perfis e permissões', 'RBAC real com perfis persistidos, permissões granulares e vínculo com usuários.', ['RBAC', 'Permissões', 'Governança']);
            renderProfilesKpis('securityKpis');
            return renderProfilesSection('securityPageContent', null);
        }
        if (kind === 'logs') {
            setPageMeta('Logs de acesso e auditoria', 'Eventos reais de autenticação, bloqueio, reset e operações administrativas.', ['Auditoria', 'Acesso', 'Conformidade']);
            renderLogsKpis('securityKpis');
            return renderLogsSection('securityPageContent', null);
        }
        if (kind === 'settings') {
            setPageMeta('Configurações de segurança', 'Políticas persistidas para senha, reset, sessão e bloqueio por tentativas.', ['Política', 'Sessão', 'Reset']);
            renderSettingsKpis('securityKpis');
            return renderSecuritySettingsSection('securityPageContent', null);
        }
    }

    async function boot() {
        if (window.SETRANE_SECURITY && document.body?.dataset?.configHub === 'true') {
            return;
        }
        if (!page) return;
        if (['unit-selection', 'users', 'profiles', 'logs', 'settings'].includes(page)) {
            try {
                await renderStandalone(page);
            } catch (error) {
                notify('Falha ao carregar módulo de segurança', error.message);
            }
        }
    }

    window.SETRANE_SECURITY = {
        renderConfigHub: function () {
            renderConfigHub().catch((error) => notify('Falha ao carregar segurança', error.message));
        }
    };

    document.addEventListener('DOMContentLoaded', boot);
})();
