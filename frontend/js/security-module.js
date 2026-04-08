(function () {
    const page = document.body?.dataset?.securityPage || '';
    const storageKey = 'setrane.security.module.v1';
    const fallbackLogo = '/assets/icons/school-marker.png';

    function $(id) {
        return document.getElementById(id);
    }

    function safeJsonParse(value, fallback) {
        try {
            return JSON.parse(value);
        } catch (_) {
            return fallback;
        }
    }

    function getStoredState() {
        const raw = localStorage.getItem(storageKey);
        const parsed = safeJsonParse(raw, {});
        return {
            profiles: parsed.profiles || [
                {
                    id: 'ADMIN',
                    title: 'Administrador',
                    scope: 'Secretaria / tenant',
                    description: 'Controla autenticação, usuários, perfis, políticas e auditoria global do tenant.',
                    permissions: ['Autenticação', 'Gestão de usuários', 'Perfis e permissões', 'Logs', 'Configurações de segurança']
                },
                {
                    id: 'GESTOR',
                    title: 'Gestor',
                    scope: 'Secretaria / operação',
                    description: 'Acompanha indicadores, supervisiona acessos e aprova operações críticas.',
                    permissions: ['Visão executiva', 'Aprovação operacional', 'Leitura de auditoria', 'Gestão escolar']
                },
                {
                    id: 'USUARIO',
                    title: 'Secretaria escolar',
                    scope: 'Escola / unidade',
                    description: 'Opera matrícula, cadastro e rotina escolar com escopo controlado por escola.',
                    permissions: ['Matrícula', 'Turmas', 'Alunos', 'Documentos', 'Consulta de logs próprios']
                },
                {
                    id: 'PROFESSOR',
                    title: 'Professor',
                    scope: 'Turma / docência',
                    description: 'Acompanha diários, frequência e informações pedagógicas da própria atuação.',
                    permissions: ['Turmas atribuídas', 'Frequência', 'Registro pedagógico', 'Consulta restrita de alunos']
                }
            ],
            logs: parsed.logs || [
                { when: 'Hoje, 08:12', actor: 'Administrador do tenant', action: 'Login bem-sucedido', target: 'Portal administrativo', level: 'info', scope: 'Secretaria' },
                { when: 'Hoje, 08:20', actor: 'Secretaria Escolar', action: 'Redefinição de senha solicitada', target: 'Usuário escola', level: 'warn', scope: 'Escola' },
                { when: 'Hoje, 09:03', actor: 'Sistema', action: 'Bloqueio por tentativas excedidas', target: 'Conta temporariamente bloqueada', level: 'danger', scope: 'Usuário' },
                { when: 'Ontem, 17:48', actor: 'Gestor', action: 'Alteração de perfil/permissão', target: 'Perfil Secretaria Escolar', level: 'warn', scope: 'Secretaria' }
            ],
            settings: parsed.settings || {
                lockoutEnabled: true,
                lockoutAttempts: 5,
                lockoutMinutes: 30,
                passwordMinLength: 8,
                passwordUppercase: true,
                passwordNumbers: true,
                passwordSymbols: true,
                passwordRotation: 180,
                resetLinkMinutes: 20,
                sessionMinutes: 480,
                enforce2faAdmins: false,
                auditRetentionDays: 365,
                geoSegregation: true,
                unitSelectionRequired: true
            }
        };
    }

    function saveStoredState(nextState) {
        const current = getStoredState();
        const merged = { ...current, ...nextState };
        localStorage.setItem(storageKey, JSON.stringify(merged));
    }

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    async function getMeSafe() {
        try {
            const response = await fetch('/api/me', { credentials: 'include' });
            if (!response.ok) return null;
            return await response.json();
        } catch (_) {
            return null;
        }
    }

    async function getUnits() {
        try {
            const response = await fetch('/api/escolas', { credentials: 'include' });
            if (!response.ok) throw new Error('Falha ao listar escolas');
            const payload = await response.json();
            const items = Array.isArray(payload?.items) ? payload.items : (Array.isArray(payload) ? payload : []);
            if (!items.length) throw new Error('Sem escolas');
            return items.slice(0, 12).map((item) => ({
                id: item.id,
                nome: item.nome || 'Escola sem nome',
                inep: item.codigo_inep || item.inep || 'Não informado',
                endereco: [item.endereco, item.bairro, item.cidade].filter(Boolean).join(' • ') || 'Endereço ainda não preenchido',
                logo: item.logo_url || item.logo_escola_url || fallbackLogo,
                etapas: Array.isArray(item.niveis_ensino) ? item.niveis_ensino : [],
                zoneamentos: Array.isArray(item.zoneamentos_nomes) ? item.zoneamentos_nomes : []
            }));
        } catch (_) {
            return [
                { id: 1, nome: 'Escola Municipal Modelo', inep: '15000001', endereco: 'Centro • Unidade piloto', logo: fallbackLogo, etapas: ['Anos iniciais', 'Anos finais'], zoneamentos: ['Zona Norte'] },
                { id: 2, nome: 'Escola do Campo Rio Verde', inep: '15000002', endereco: 'Comunidade Rio Verde', logo: fallbackLogo, etapas: ['Educação infantil', 'Fundamental'], zoneamentos: ['Zona Rural'] },
                { id: 3, nome: 'EMEF Professor João', inep: '15000003', endereco: 'Bairro Novo Horizonte', logo: fallbackLogo, etapas: ['Fundamental', 'EJA'], zoneamentos: ['Zona Sul'] }
            ];
        }
    }

    async function getUsers() {
        try {
            const response = await fetch('/api/admin/users', { credentials: 'include' });
            if (!response.ok) throw new Error('Sem acesso admin');
            const payload = await response.json();
            const items = Array.isArray(payload?.items) ? payload.items : [];
            if (!items.length) throw new Error('Sem usuários');
            return items;
        } catch (_) {
            const me = await getMeSafe();
            return [
                { id: 1, nome: me?.nome || 'Administrador do tenant', email: me?.email || 'admin@tenant.local', cargo: String(me?.cargo || 'ADMIN').toUpperCase(), ativo: true, telefone: '(94) 99999-0001', escopo: 'Secretaria', unidade: 'Todas as unidades' },
                { id: 2, nome: 'Secretaria Escolar', email: 'secretaria@tenant.local', cargo: 'USUARIO', ativo: true, telefone: '(94) 99999-0002', escopo: 'Escola', unidade: 'Escola Municipal Modelo' },
                { id: 3, nome: 'Gestor de Transporte', email: 'gestor@tenant.local', cargo: 'GESTOR', ativo: true, telefone: '(94) 99999-0003', escopo: 'Secretaria', unidade: 'Rede municipal' },
                { id: 4, nome: 'Professor Referência', email: 'professor@tenant.local', cargo: 'USUARIO', ativo: false, telefone: '(94) 99999-0004', escopo: 'Usuário', unidade: 'Escola do Campo Rio Verde' }
            ];
        }
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
        if (!$(targetId)) return;
        $(targetId).innerHTML = items.map((item) => `
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

    function renderUsersSection(targetId, kpiTargetId) {
        return getUsers().then((users) => {
            if (kpiTargetId) {
                renderKpis(kpiTargetId, [
                    { label: 'Usuários totais', value: users.length, hint: 'identidades ativas' },
                    { label: 'Ativos', value: users.filter((item) => item.ativo !== false).length, hint: 'liberados' },
                    { label: 'Administradores', value: users.filter((item) => String(item.cargo).toUpperCase() === 'ADMIN').length, hint: 'alto privilégio' },
                    { label: 'Escopo escolar', value: users.filter((item) => String(item.unidade || '').toLowerCase().includes('escola')).length, hint: 'vinculados' }
                ]);
            }

            const container = $(targetId);
            if (!container) return;

            container.innerHTML = `
                <div class="card shadow security-card mb-4">
                    <div class="card-body">
                        <div class="row">
                            <div class="col-md-4 mb-3 mb-md-0">
                                <label class="small text-muted text-uppercase font-weight-bold mb-2">Buscar</label>
                                <input id="${targetId}SearchInput" type="search" class="form-control" placeholder="Nome, e-mail ou unidade">
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
                                <button class="btn btn-primary btn-block">Novo usuário</button>
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
                const filtered = users.filter((item) => {
                    const active = item.ativo !== false;
                    if (role && String(item.cargo || '').toUpperCase() !== role) return false;
                    if (status === 'ativos' && !active) return false;
                    if (status === 'inativos' && active) return false;
                    if (!search) return true;
                    return [item.nome, item.email, item.telefone, item.unidade, item.escopo].join(' ').toLowerCase().includes(search);
                });

                $(`${targetId}TableWrap`).innerHTML = filtered.length ? `
                    <div class="table-responsive">
                        <table class="table table-hover mb-0">
                            <thead>
                                <tr>
                                    <th>Usuário</th>
                                    <th>Papel</th>
                                    <th>Escopo</th>
                                    <th>Status</th>
                                    <th>Contato</th>
                                    <th class="text-right">Ações</th>
                                </tr>
                            </thead>
                            <tbody>
                                ${filtered.map((item) => `
                                    <tr>
                                        <td>
                                            <div class="d-flex align-items-center">
                                                <div class="security-avatar mr-3">${escapeHtml(String(item.nome || 'U').trim().slice(0, 2).toUpperCase())}</div>
                                                <div>
                                                    <div class="font-weight-bold">${escapeHtml(item.nome || 'Sem nome')}</div>
                                                    <div class="security-meta">${escapeHtml(item.email || 'Sem e-mail')}</div>
                                                </div>
                                            </div>
                                        </td>
                                        <td><span class="security-chip security-chip-soft">${escapeHtml(item.cargo || 'USUARIO')}</span></td>
                                        <td>
                                            <div>${escapeHtml(item.unidade || item.escopo || 'Escopo não informado')}</div>
                                            <div class="security-meta">${escapeHtml(item.escopo || 'Usuário')}</div>
                                        </td>
                                        <td><span class="badge ${item.ativo !== false ? 'badge-success' : 'badge-secondary'}">${item.ativo !== false ? 'Ativo' : 'Inativo'}</span></td>
                                        <td>
                                            <div>${escapeHtml(item.telefone || 'Não informado')}</div>
                                            <div class="security-meta">Reset e MFA sob política central</div>
                                        </td>
                                        <td class="text-right">
                                            <div class="btn-group btn-group-sm">
                                                <button class="btn btn-outline-secondary">Editar</button>
                                                <button class="btn btn-outline-secondary">Permissões</button>
                                                <button class="btn btn-outline-secondary">${item.ativo !== false ? 'Bloquear' : 'Reativar'}</button>
                                            </div>
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
            draw();
        });
    }

    function renderProfilesSection(targetId, kpiTargetId) {
        const state = getStoredState();
        if (kpiTargetId) {
            renderKpis(kpiTargetId, [
                { label: 'Perfis estruturados', value: state.profiles.length, hint: 'governança ativa' },
                { label: 'Perfis escolares', value: state.profiles.filter((item) => String(item.scope).toLowerCase().includes('escola')).length, hint: 'escopo local' },
                { label: 'Permissões núcleo', value: 18, hint: 'autenticação + escolar' },
                { label: 'Matriz de acesso', value: 'Completa', hint: 'por papel' }
            ]);
        }

        const container = $(targetId);
        if (!container) return;

        const permissionRows = [
            { capability: 'Login web e sessão', admin: 'Total', gestor: 'Leitura', usuario: 'Próprio acesso', professor: 'Próprio acesso' },
            { capability: 'Gestão de usuários', admin: 'Criar / editar / bloquear', gestor: 'Consultar / sugerir', usuario: 'Sem acesso', professor: 'Sem acesso' },
            { capability: 'Perfis e permissões', admin: 'Total', gestor: 'Consultar', usuario: 'Sem acesso', professor: 'Sem acesso' },
            { capability: 'Logs e auditoria', admin: 'Total', gestor: 'Leitura setorial', usuario: 'Próprias ações', professor: 'Próprias ações' },
            { capability: 'Matrícula e cadastro escolar', admin: 'Total', gestor: 'Supervisionar', usuario: 'Operar escola', professor: 'Consulta restrita' },
            { capability: 'Frequência e rotina pedagógica', admin: 'Supervisão', gestor: 'Supervisão', usuario: 'Apoio', professor: 'Operar turma' }
        ];

        container.innerHTML = `
            <div class="security-grid security-grid-2 mb-4">
                ${state.profiles.map((profile) => `
                    <div class="card shadow security-card">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start mb-3">
                                <div>
                                    <div class="security-section-title mb-1">${escapeHtml(profile.id)}</div>
                                    <h5 class="mb-1">${escapeHtml(profile.title)}</h5>
                                    <div class="security-meta">${escapeHtml(profile.scope)}</div>
                                </div>
                                <span class="security-chip security-chip-soft">${escapeHtml(profile.permissions.length)} permissões-chave</span>
                            </div>
                            <p class="mb-3">${escapeHtml(profile.description)}</p>
                            <div>
                                ${profile.permissions.map((permission) => `<span class="security-chip security-chip-soft mr-1 mb-1">${escapeHtml(permission)}</span>`).join('')}
                            </div>
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
                        <button class="btn btn-outline-primary btn-sm">Criar perfil personalizado</button>
                    </div>
                    <div class="security-permission-matrix">
                        <div class="security-permission-row font-weight-bold">
                            <div class="security-permission-cell">Capacidade</div>
                            <div class="security-permission-cell">Administrador</div>
                            <div class="security-permission-cell">Gestor</div>
                            <div class="security-permission-cell">Secretaria</div>
                            <div class="security-permission-cell">Professor</div>
                        </div>
                        ${permissionRows.map((row) => `
                            <div class="security-permission-row">
                                <div class="security-permission-cell">${escapeHtml(row.capability)}</div>
                                <div class="security-permission-cell">${escapeHtml(row.admin)}</div>
                                <div class="security-permission-cell">${escapeHtml(row.gestor)}</div>
                                <div class="security-permission-cell">${escapeHtml(row.usuario)}</div>
                                <div class="security-permission-cell">${escapeHtml(row.professor)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function renderLogsSection(targetId, kpiTargetId) {
        const state = getStoredState();
        if (kpiTargetId) {
            renderKpis(kpiTargetId, [
                { label: 'Eventos auditáveis', value: state.logs.length, hint: 'amostra operacional' },
                { label: 'Bloqueios recentes', value: state.logs.filter((item) => item.level === 'danger').length, hint: 'segurança ativa' },
                { label: 'Ações administrativas', value: state.logs.filter((item) => item.scope === 'Secretaria').length, hint: 'alto impacto' },
                { label: 'Escopos monitorados', value: 3, hint: 'secretaria, escola, usuário' }
            ]);
        }

        const container = $(targetId);
        if (!container) return;
        container.innerHTML = `
            <div class="card shadow security-card mb-4">
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-4 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Buscar evento</label>
                            <input id="${targetId}SearchInput" type="search" class="form-control" placeholder="Usuário, ação, alvo ou escopo">
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
                            <button class="btn btn-outline-primary btn-block">Exportar CSV</button>
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
            const term = String($(`${targetId}SearchInput`)?.value || '').trim().toLowerCase();
            const level = String($(`${targetId}LevelFilter`)?.value || '').trim().toLowerCase();
            const scope = String($(`${targetId}ScopeFilter`)?.value || '').trim();
            const filtered = state.logs.filter((item) => {
                if (level && String(item.level) !== level) return false;
                if (scope && String(item.scope) !== scope) return false;
                if (!term) return true;
                return [item.when, item.actor, item.action, item.target, item.scope].join(' ').toLowerCase().includes(term);
            });

            $(`${targetId}TableWrap`).innerHTML = filtered.length ? `
                <div class="table-responsive">
                    <table class="table table-hover mb-0">
                        <thead>
                            <tr>
                                <th>Quando</th>
                                <th>Ator</th>
                                <th>Ação</th>
                                <th>Alvo</th>
                                <th>Escopo</th>
                                <th>Nível</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filtered.map((item) => `
                                <tr>
                                    <td>${escapeHtml(item.when)}</td>
                                    <td>${escapeHtml(item.actor)}</td>
                                    <td>${escapeHtml(item.action)}</td>
                                    <td>${escapeHtml(item.target)}</td>
                                    <td><span class="security-chip security-chip-soft">${escapeHtml(item.scope)}</span></td>
                                    <td><span class="security-chip security-log-level ${escapeHtml(item.level)}">${escapeHtml(item.level)}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : `<div class="security-empty">Nenhum log corresponde aos filtros atuais.</div>`;
        }

        [`${targetId}SearchInput`, `${targetId}LevelFilter`, `${targetId}ScopeFilter`].forEach((id) => {
            $(id)?.addEventListener('input', draw);
            $(id)?.addEventListener('change', draw);
        });
        draw();
    }

    function renderSecuritySettingsSection(targetId, kpiTargetId) {
        const state = getStoredState();
        const settings = state.settings;
        if (kpiTargetId) {
            renderKpis(kpiTargetId, [
                { label: 'Tentativas antes do bloqueio', value: settings.lockoutAttempts, hint: 'política ativa' },
                { label: 'Validade do reset', value: `${settings.resetLinkMinutes} min`, hint: 'token de recuperação' },
                { label: 'Sessão web', value: `${settings.sessionMinutes} min`, hint: 'timeout configurado' },
                { label: 'Retenção de auditoria', value: `${settings.auditRetentionDays} dias`, hint: 'conformidade' }
            ]);
        }

        const container = $(targetId);
        if (!container) return;
        container.innerHTML = `
            <div class="security-grid security-grid-2">
                <div class="card shadow security-card">
                    <div class="card-body">
                        <div class="security-section-title">Autenticação e senha</div>
                        <div class="security-setting-item">
                            <div class="d-flex justify-content-between align-items-center">
                                <div>
                                    <h6 class="mb-1">Bloqueio por tentativas</h6>
                                    <div class="security-switch-note">Bloqueia temporariamente após excesso de erros de login.</div>
                                </div>
                                <div class="custom-control custom-switch">
                                    <input type="checkbox" class="custom-control-input js-setting" id="${targetId}LockoutEnabled" data-key="lockoutEnabled" ${settings.lockoutEnabled ? 'checked' : ''}>
                                    <label class="custom-control-label" for="${targetId}LockoutEnabled"></label>
                                </div>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label>Tentativas máximas</label>
                                <input type="number" class="form-control js-setting" data-key="lockoutAttempts" value="${escapeHtml(settings.lockoutAttempts)}">
                            </div>
                            <div class="form-group col-md-6">
                                <label>Tempo de bloqueio (min)</label>
                                <input type="number" class="form-control js-setting" data-key="lockoutMinutes" value="${escapeHtml(settings.lockoutMinutes)}">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label>Tamanho mínimo da senha</label>
                                <input type="number" class="form-control js-setting" data-key="passwordMinLength" value="${escapeHtml(settings.passwordMinLength)}">
                            </div>
                            <div class="form-group col-md-6">
                                <label>Rotação obrigatória (dias)</label>
                                <input type="number" class="form-control js-setting" data-key="passwordRotation" value="${escapeHtml(settings.passwordRotation)}">
                            </div>
                        </div>
                        <div class="custom-control custom-checkbox mb-2">
                            <input type="checkbox" class="custom-control-input js-setting" id="${targetId}Uppercase" data-key="passwordUppercase" ${settings.passwordUppercase ? 'checked' : ''}>
                            <label class="custom-control-label" for="${targetId}Uppercase">Exigir letra maiúscula</label>
                        </div>
                        <div class="custom-control custom-checkbox mb-2">
                            <input type="checkbox" class="custom-control-input js-setting" id="${targetId}Numbers" data-key="passwordNumbers" ${settings.passwordNumbers ? 'checked' : ''}>
                            <label class="custom-control-label" for="${targetId}Numbers">Exigir número</label>
                        </div>
                        <div class="custom-control custom-checkbox">
                            <input type="checkbox" class="custom-control-input js-setting" id="${targetId}Symbols" data-key="passwordSymbols" ${settings.passwordSymbols ? 'checked' : ''}>
                            <label class="custom-control-label" for="${targetId}Symbols">Exigir caractere especial</label>
                        </div>
                    </div>
                </div>
                <div class="card shadow security-card">
                    <div class="card-body">
                        <div class="security-section-title">Sessão, reset e segregação</div>
                        <div class="form-group">
                            <label>Expiração da sessão web (min)</label>
                            <input type="number" class="form-control js-setting" data-key="sessionMinutes" value="${escapeHtml(settings.sessionMinutes)}">
                        </div>
                        <div class="form-group">
                            <label>Validade do link de redefinição (min)</label>
                            <input type="number" class="form-control js-setting" data-key="resetLinkMinutes" value="${escapeHtml(settings.resetLinkMinutes)}">
                        </div>
                        <div class="form-group">
                            <label>Retenção dos logs (dias)</label>
                            <input type="number" class="form-control js-setting" data-key="auditRetentionDays" value="${escapeHtml(settings.auditRetentionDays)}">
                        </div>
                        <div class="custom-control custom-checkbox mb-2">
                            <input type="checkbox" class="custom-control-input js-setting" id="${targetId}GeoSegregation" data-key="geoSegregation" ${settings.geoSegregation ? 'checked' : ''}>
                            <label class="custom-control-label" for="${targetId}GeoSegregation">Aplicar segregação por secretaria / escola / usuário</label>
                        </div>
                        <div class="custom-control custom-checkbox mb-2">
                            <input type="checkbox" class="custom-control-input js-setting" id="${targetId}UnitRequired" data-key="unitSelectionRequired" ${settings.unitSelectionRequired ? 'checked' : ''}>
                            <label class="custom-control-label" for="${targetId}UnitRequired">Usar seleção de contexto escolar quando aplicável</label>
                        </div>
                        <div class="custom-control custom-checkbox">
                            <input type="checkbox" class="custom-control-input js-setting" id="${targetId}Enforce2faAdmins" data-key="enforce2faAdmins" ${settings.enforce2faAdmins ? 'checked' : ''}>
                            <label class="custom-control-label" for="${targetId}Enforce2faAdmins">Exigir segundo fator para administradores</label>
                        </div>
                        <div class="mt-4 d-flex flex-wrap">
                            <a href="/login" class="btn btn-outline-secondary mr-2 mb-2">Abrir login</a>
                            <a href="/recuperacao-senha" class="btn btn-outline-secondary mr-2 mb-2">Abrir recuperação</a>
                            <button id="${targetId}SaveBtn" class="btn btn-primary mb-2">Salvar política</button>
                        </div>
                        <div id="${targetId}Feedback" class="security-meta mt-2"></div>
                    </div>
                </div>
            </div>
        `;

        container.addEventListener('change', (event) => {
            const field = event.target.closest('.js-setting');
            if (!field || !container.contains(field)) return;
            const next = getStoredState();
            const key = field.dataset.key;
            const value = field.type === 'checkbox' ? field.checked : Number(field.value || 0);
            next.settings[key] = value;
            saveStoredState({ settings: next.settings });
        });

        $(`${targetId}SaveBtn`)?.addEventListener('click', () => {
            $(`${targetId}Feedback`).textContent = 'Política salva localmente para a prova de conceito e pronta para integrar com backend.';
        });
    }

    async function renderSelectionPage() {
        setPageMeta(
            'Seleção de unidade escolar',
            'Defina o contexto de trabalho por escola para segregar acessos, relatórios, matrícula, turma e operação diária.',
            ['Segregação por unidade', 'Acesso contextual', 'Obrigatório na POC']
        );

        const units = await getUnits();
        renderKpis('securityKpis', [
            { label: 'Unidades disponíveis', value: units.length, hint: 'contexto escolar' },
            { label: 'Rede com acesso', value: new Set(units.map((item) => item.nome)).size, hint: 'escopo liberado' },
            { label: 'Com zoneamento', value: units.filter((item) => item.zoneamentos.length).length, hint: 'roteirização pronta' },
            { label: 'Com etapas cadastradas', value: units.filter((item) => item.etapas.length).length, hint: 'base ativa' }
        ]);

        const container = $('securityPageContent');
        if (!container) return;

        container.innerHTML = `
            <div class="card shadow security-card mb-4">
                <div class="card-body">
                    <div class="row align-items-end">
                        <div class="col-md-7">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Buscar unidade</label>
                            <input id="unitSearchInput" type="search" class="form-control" placeholder="Digite nome da escola, INEP ou bairro">
                        </div>
                        <div class="col-md-5 mt-3 mt-md-0">
                            <div class="security-meta">Depois de selecionar, o sistema pode usar essa unidade como contexto preferencial para secretaria, orientação, frequência, turmas e documentos.</div>
                        </div>
                    </div>
                </div>
            </div>
            <div id="unitCards" class="row"></div>
        `;

        function paint(filter) {
            const term = String(filter || '').trim().toLowerCase();
            const filtered = units.filter((item) => {
                if (!term) return true;
                return [item.nome, item.inep, item.endereco, item.zoneamentos.join(' '), item.etapas.join(' ')]
                    .join(' ')
                    .toLowerCase()
                    .includes(term);
            });
            $('unitCards').innerHTML = filtered.length ? filtered.map((item) => `
                <div class="col-12 col-lg-6 col-xl-4 mb-3">
                    <div class="security-unit-card shadow-sm">
                        <div class="d-flex align-items-start mb-3">
                            <img src="${escapeHtml(item.logo)}" alt="Logo da escola" class="security-unit-logo mr-3">
                            <div class="flex-grow-1">
                                <h5 class="mb-1">${escapeHtml(item.nome)}</h5>
                                <div class="security-meta">INEP ${escapeHtml(item.inep)}</div>
                            </div>
                        </div>
                        <div class="mb-2">${escapeHtml(item.endereco)}</div>
                        <div class="mb-3">
                            ${(item.etapas.length ? item.etapas : ['Etapas não informadas']).map((stage) => `<span class="security-chip security-chip-soft mr-1 mb-1">${escapeHtml(stage)}</span>`).join('')}
                        </div>
                        <div class="security-meta mb-3">Zoneamentos: ${escapeHtml(item.zoneamentos.length ? item.zoneamentos.join(', ') : 'Ainda não vinculados')}</div>
                        <div class="d-flex flex-wrap">
                            <a class="btn btn-primary mr-2 mb-2" href="/escolar/escola/${encodeURIComponent(item.id)}/dashboard">Abrir módulo da escola</a>
                            <button class="btn btn-outline-secondary mb-2 js-select-unit" data-unit-name="${escapeHtml(item.nome)}">Usar como contexto</button>
                        </div>
                    </div>
                </div>
            `).join('') : `<div class="col-12"><div class="security-empty">Nenhuma unidade corresponde ao filtro informado.</div></div>`;
        }

        paint('');
        $('unitSearchInput')?.addEventListener('input', (event) => paint(event.target.value));
        container.addEventListener('click', (event) => {
            const button = event.target.closest('.js-select-unit');
            if (!button) return;
            localStorage.setItem('setrane.currentSchoolContext', button.dataset.unitName || '');
            button.textContent = 'Contexto definido';
            button.classList.remove('btn-outline-secondary');
            button.classList.add('btn-success');
        });
    }

    async function renderUsersPage() {
        setPageMeta(
            'Gestão de usuários',
            'Controle acessos por papel, status, vínculo institucional e escopo de atuação por secretaria, escola e usuário individual.',
            ['Perfis por papel', 'Segregação por unidade', 'Bloqueio e auditoria']
        );

        const users = await getUsers();
        renderKpis('securityKpis', [
            { label: 'Usuários totais', value: users.length, hint: 'identidades ativas' },
            { label: 'Ativos', value: users.filter((item) => item.ativo !== false).length, hint: 'liberados' },
            { label: 'Administradores', value: users.filter((item) => String(item.cargo).toUpperCase() === 'ADMIN').length, hint: 'alto privilégio' },
            { label: 'Escopo escolar', value: users.filter((item) => String(item.unidade || '').toLowerCase().includes('escola')).length, hint: 'vinculados' }
        ]);

        const container = $('securityPageContent');
        if (!container) return;

        container.innerHTML = `
            <div class="card shadow security-card mb-4">
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-4 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Buscar</label>
                            <input id="usersSearchInput" type="search" class="form-control" placeholder="Nome, e-mail ou unidade">
                        </div>
                        <div class="col-md-3 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Papel</label>
                            <select id="usersRoleFilter" class="form-control">
                                <option value="">Todos</option>
                                <option value="ADMIN">Administrador</option>
                                <option value="GESTOR">Gestor</option>
                                <option value="USUARIO">Usuário</option>
                                <option value="FORNECEDOR_ESCOLAR">Fornecedor</option>
                            </select>
                        </div>
                        <div class="col-md-3 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Situação</label>
                            <select id="usersStatusFilter" class="form-control">
                                <option value="">Todos</option>
                                <option value="ativos">Ativos</option>
                                <option value="inativos">Inativos</option>
                            </select>
                        </div>
                        <div class="col-md-2 d-flex align-items-end">
                            <button class="btn btn-primary btn-block">Novo usuário</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="card shadow security-card security-table">
                <div class="card-body">
                    <div id="usersTableWrap"></div>
                </div>
            </div>
        `;

        function draw() {
            const search = String($('usersSearchInput')?.value || '').trim().toLowerCase();
            const role = String($('usersRoleFilter')?.value || '').trim().toUpperCase();
            const status = String($('usersStatusFilter')?.value || '').trim();
            const filtered = users.filter((item) => {
                const active = item.ativo !== false;
                if (role && String(item.cargo || '').toUpperCase() !== role) return false;
                if (status === 'ativos' && !active) return false;
                if (status === 'inativos' && active) return false;
                if (!search) return true;
                return [item.nome, item.email, item.telefone, item.unidade, item.escopo].join(' ').toLowerCase().includes(search);
            });

            $('usersTableWrap').innerHTML = filtered.length ? `
                <div class="table-responsive">
                    <table class="table table-hover mb-0">
                        <thead>
                            <tr>
                                <th>Usuário</th>
                                <th>Papel</th>
                                <th>Escopo</th>
                                <th>Status</th>
                                <th>Contato</th>
                                <th class="text-right">Ações</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filtered.map((item) => `
                                <tr>
                                    <td>
                                        <div class="d-flex align-items-center">
                                            <div class="security-avatar mr-3">${escapeHtml(String(item.nome || 'U').trim().slice(0, 2).toUpperCase())}</div>
                                            <div>
                                                <div class="font-weight-bold">${escapeHtml(item.nome || 'Sem nome')}</div>
                                                <div class="security-meta">${escapeHtml(item.email || 'Sem e-mail')}</div>
                                            </div>
                                        </div>
                                    </td>
                                    <td><span class="security-chip security-chip-soft">${escapeHtml(item.cargo || 'USUARIO')}</span></td>
                                    <td>
                                        <div>${escapeHtml(item.unidade || item.escopo || 'Escopo não informado')}</div>
                                        <div class="security-meta">${escapeHtml(item.escopo || 'Usuário')}</div>
                                    </td>
                                    <td><span class="badge ${item.ativo !== false ? 'badge-success' : 'badge-secondary'}">${item.ativo !== false ? 'Ativo' : 'Inativo'}</span></td>
                                    <td>
                                        <div>${escapeHtml(item.telefone || 'Não informado')}</div>
                                        <div class="security-meta">Reset e MFA sob política central</div>
                                    </td>
                                    <td class="text-right">
                                        <div class="btn-group btn-group-sm">
                                            <button class="btn btn-outline-secondary">Editar</button>
                                            <button class="btn btn-outline-secondary">Permissões</button>
                                            <button class="btn btn-outline-secondary">${item.ativo !== false ? 'Bloquear' : 'Reativar'}</button>
                                        </div>
                                    </td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : `<div class="security-empty">Nenhum usuário encontrado com os filtros atuais.</div>`;
        }

        ['usersSearchInput', 'usersRoleFilter', 'usersStatusFilter'].forEach((id) => {
            $(id)?.addEventListener('input', draw);
            $(id)?.addEventListener('change', draw);
        });
        draw();
    }

    function renderProfilesPage() {
        const state = getStoredState();
        setPageMeta(
            'Perfis e permissões',
            'Estruture perfis por papel, delegue permissões granulares e defina segregação por secretaria, escola, turma e usuário.',
            ['RBAC', 'Permissões granulares', 'Segregação institucional']
        );

        renderKpis('securityKpis', [
            { label: 'Perfis estruturados', value: state.profiles.length, hint: 'governança ativa' },
            { label: 'Perfis escolares', value: state.profiles.filter((item) => String(item.scope).toLowerCase().includes('escola')).length, hint: 'escopo local' },
            { label: 'Permissões núcleo', value: 18, hint: 'autenticação + escolar' },
            { label: 'Matriz de acesso', value: 'Completa', hint: 'por papel' }
        ]);

        const container = $('securityPageContent');
        if (!container) return;

        const permissionRows = [
            { capability: 'Login web e sessão', admin: 'Total', gestor: 'Leitura', usuario: 'Próprio acesso', professor: 'Próprio acesso' },
            { capability: 'Gestão de usuários', admin: 'Criar / editar / bloquear', gestor: 'Consultar / sugerir', usuario: 'Sem acesso', professor: 'Sem acesso' },
            { capability: 'Perfis e permissões', admin: 'Total', gestor: 'Consultar', usuario: 'Sem acesso', professor: 'Sem acesso' },
            { capability: 'Logs e auditoria', admin: 'Total', gestor: 'Leitura setorial', usuario: 'Próprias ações', professor: 'Próprias ações' },
            { capability: 'Matrícula e cadastro escolar', admin: 'Total', gestor: 'Supervisionar', usuario: 'Operar escola', professor: 'Consulta restrita' },
            { capability: 'Frequência e rotina pedagógica', admin: 'Supervisão', gestor: 'Supervisão', usuario: 'Apoio', professor: 'Operar turma' }
        ];

        container.innerHTML = `
            <div class="security-grid security-grid-2 mb-4">
                ${state.profiles.map((profile) => `
                    <div class="card shadow security-card">
                        <div class="card-body">
                            <div class="d-flex justify-content-between align-items-start mb-3">
                                <div>
                                    <div class="security-section-title mb-1">${escapeHtml(profile.id)}</div>
                                    <h5 class="mb-1">${escapeHtml(profile.title)}</h5>
                                    <div class="security-meta">${escapeHtml(profile.scope)}</div>
                                </div>
                                <span class="security-chip security-chip-soft">${escapeHtml(profile.permissions.length)} permissões-chave</span>
                            </div>
                            <p class="mb-3">${escapeHtml(profile.description)}</p>
                            <div>
                                ${profile.permissions.map((permission) => `<span class="security-chip security-chip-soft mr-1 mb-1">${escapeHtml(permission)}</span>`).join('')}
                            </div>
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
                        <button class="btn btn-outline-primary btn-sm">Criar perfil personalizado</button>
                    </div>
                    <div class="security-permission-matrix">
                        <div class="security-permission-row font-weight-bold">
                            <div class="security-permission-cell">Capacidade</div>
                            <div class="security-permission-cell">Administrador</div>
                            <div class="security-permission-cell">Gestor</div>
                            <div class="security-permission-cell">Secretaria</div>
                            <div class="security-permission-cell">Professor</div>
                        </div>
                        ${permissionRows.map((row) => `
                            <div class="security-permission-row">
                                <div class="security-permission-cell">${escapeHtml(row.capability)}</div>
                                <div class="security-permission-cell">${escapeHtml(row.admin)}</div>
                                <div class="security-permission-cell">${escapeHtml(row.gestor)}</div>
                                <div class="security-permission-cell">${escapeHtml(row.usuario)}</div>
                                <div class="security-permission-cell">${escapeHtml(row.professor)}</div>
                            </div>
                        `).join('')}
                    </div>
                </div>
            </div>
        `;
    }

    function renderLogsPage() {
        const state = getStoredState();
        setPageMeta(
            'Logs de acesso e trilha de auditoria',
            'Acompanhe autenticações, operações críticas, redefinição de senha, bloqueios e ações administrativas por secretaria, escola e usuário.',
            ['Trilha de auditoria', 'Acesso e operação', 'Retenção e conformidade']
        );

        renderKpis('securityKpis', [
            { label: 'Eventos auditáveis', value: state.logs.length, hint: 'amostra operacional' },
            { label: 'Bloqueios recentes', value: state.logs.filter((item) => item.level === 'danger').length, hint: 'segurança ativa' },
            { label: 'Ações administrativas', value: state.logs.filter((item) => item.scope === 'Secretaria').length, hint: 'alto impacto' },
            { label: 'Escopos monitorados', value: 3, hint: 'secretaria, escola, usuário' }
        ]);

        const container = $('securityPageContent');
        if (!container) return;

        container.innerHTML = `
            <div class="card shadow security-card mb-4">
                <div class="card-body">
                    <div class="row">
                        <div class="col-md-4 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Buscar evento</label>
                            <input id="logsSearchInput" type="search" class="form-control" placeholder="Usuário, ação, alvo ou escopo">
                        </div>
                        <div class="col-md-3 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Nível</label>
                            <select id="logsLevelFilter" class="form-control">
                                <option value="">Todos</option>
                                <option value="info">Informação</option>
                                <option value="warn">Alerta</option>
                                <option value="danger">Crítico</option>
                            </select>
                        </div>
                        <div class="col-md-3 mb-3 mb-md-0">
                            <label class="small text-muted text-uppercase font-weight-bold mb-2">Escopo</label>
                            <select id="logsScopeFilter" class="form-control">
                                <option value="">Todos</option>
                                <option value="Secretaria">Secretaria</option>
                                <option value="Escola">Escola</option>
                                <option value="Usuário">Usuário</option>
                            </select>
                        </div>
                        <div class="col-md-2 d-flex align-items-end">
                            <button class="btn btn-outline-primary btn-block">Exportar CSV</button>
                        </div>
                    </div>
                </div>
            </div>
            <div class="card shadow security-card security-table">
                <div class="card-body">
                    <div id="logsTableWrap"></div>
                </div>
            </div>
        `;

        function draw() {
            const term = String($('logsSearchInput')?.value || '').trim().toLowerCase();
            const level = String($('logsLevelFilter')?.value || '').trim().toLowerCase();
            const scope = String($('logsScopeFilter')?.value || '').trim();
            const filtered = state.logs.filter((item) => {
                if (level && String(item.level) !== level) return false;
                if (scope && String(item.scope) !== scope) return false;
                if (!term) return true;
                return [item.when, item.actor, item.action, item.target, item.scope].join(' ').toLowerCase().includes(term);
            });

            $('logsTableWrap').innerHTML = filtered.length ? `
                <div class="table-responsive">
                    <table class="table table-hover mb-0">
                        <thead>
                            <tr>
                                <th>Quando</th>
                                <th>Ator</th>
                                <th>Ação</th>
                                <th>Alvo</th>
                                <th>Escopo</th>
                                <th>Nível</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${filtered.map((item) => `
                                <tr>
                                    <td>${escapeHtml(item.when)}</td>
                                    <td>${escapeHtml(item.actor)}</td>
                                    <td>${escapeHtml(item.action)}</td>
                                    <td>${escapeHtml(item.target)}</td>
                                    <td><span class="security-chip security-chip-soft">${escapeHtml(item.scope)}</span></td>
                                    <td><span class="security-chip security-log-level ${escapeHtml(item.level)}">${escapeHtml(item.level)}</span></td>
                                </tr>
                            `).join('')}
                        </tbody>
                    </table>
                </div>
            ` : `<div class="security-empty">Nenhum log corresponde aos filtros atuais.</div>`;
        }

        ['logsSearchInput', 'logsLevelFilter', 'logsScopeFilter'].forEach((id) => {
            $(id)?.addEventListener('input', draw);
            $(id)?.addEventListener('change', draw);
        });
        draw();
    }

    function renderSecuritySettingsPage() {
        const state = getStoredState();
        const settings = state.settings;
        setPageMeta(
            'Configurações de segurança',
            'Defina política de senha, sessões, bloqueios, retenção de auditoria, reset de senha e segregação por unidade escolar.',
            ['Bloqueio por tentativas', 'Reset de senha', 'Política de sessão']
        );

        renderKpis('securityKpis', [
            { label: 'Tentativas antes do bloqueio', value: settings.lockoutAttempts, hint: 'política ativa' },
            { label: 'Validade do reset', value: `${settings.resetLinkMinutes} min`, hint: 'token de recuperação' },
            { label: 'Sessão web', value: `${settings.sessionMinutes} min`, hint: 'timeout configurado' },
            { label: 'Retenção de auditoria', value: `${settings.auditRetentionDays} dias`, hint: 'conformidade' }
        ]);

        const container = $('securityPageContent');
        if (!container) return;

        container.innerHTML = `
            <div class="security-grid security-grid-2">
                <div class="card shadow security-card">
                    <div class="card-body">
                        <div class="security-section-title">Autenticação e senha</div>
                        <div class="security-setting-item">
                            <div class="d-flex justify-content-between align-items-center">
                                <div>
                                    <h6 class="mb-1">Bloqueio por tentativas</h6>
                                    <div class="security-switch-note">Bloqueia temporariamente após excesso de erros de login.</div>
                                </div>
                                <div class="custom-control custom-switch">
                                    <input type="checkbox" class="custom-control-input js-setting" id="lockoutEnabled" data-key="lockoutEnabled" ${settings.lockoutEnabled ? 'checked' : ''}>
                                    <label class="custom-control-label" for="lockoutEnabled"></label>
                                </div>
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label>Tentativas máximas</label>
                                <input type="number" class="form-control js-setting" data-key="lockoutAttempts" value="${escapeHtml(settings.lockoutAttempts)}">
                            </div>
                            <div class="form-group col-md-6">
                                <label>Tempo de bloqueio (min)</label>
                                <input type="number" class="form-control js-setting" data-key="lockoutMinutes" value="${escapeHtml(settings.lockoutMinutes)}">
                            </div>
                        </div>
                        <div class="form-row">
                            <div class="form-group col-md-6">
                                <label>Tamanho mínimo da senha</label>
                                <input type="number" class="form-control js-setting" data-key="passwordMinLength" value="${escapeHtml(settings.passwordMinLength)}">
                            </div>
                            <div class="form-group col-md-6">
                                <label>Rotação obrigatória (dias)</label>
                                <input type="number" class="form-control js-setting" data-key="passwordRotation" value="${escapeHtml(settings.passwordRotation)}">
                            </div>
                        </div>
                        <div class="custom-control custom-checkbox mb-2">
                            <input type="checkbox" class="custom-control-input js-setting" id="passwordUppercase" data-key="passwordUppercase" ${settings.passwordUppercase ? 'checked' : ''}>
                            <label class="custom-control-label" for="passwordUppercase">Exigir letra maiúscula</label>
                        </div>
                        <div class="custom-control custom-checkbox mb-2">
                            <input type="checkbox" class="custom-control-input js-setting" id="passwordNumbers" data-key="passwordNumbers" ${settings.passwordNumbers ? 'checked' : ''}>
                            <label class="custom-control-label" for="passwordNumbers">Exigir número</label>
                        </div>
                        <div class="custom-control custom-checkbox">
                            <input type="checkbox" class="custom-control-input js-setting" id="passwordSymbols" data-key="passwordSymbols" ${settings.passwordSymbols ? 'checked' : ''}>
                            <label class="custom-control-label" for="passwordSymbols">Exigir caractere especial</label>
                        </div>
                    </div>
                </div>
                <div class="card shadow security-card">
                    <div class="card-body">
                        <div class="security-section-title">Sessão, reset e segregação</div>
                        <div class="form-group">
                            <label>Expiração da sessão web (min)</label>
                            <input type="number" class="form-control js-setting" data-key="sessionMinutes" value="${escapeHtml(settings.sessionMinutes)}">
                        </div>
                        <div class="form-group">
                            <label>Validade do link de redefinição (min)</label>
                            <input type="number" class="form-control js-setting" data-key="resetLinkMinutes" value="${escapeHtml(settings.resetLinkMinutes)}">
                        </div>
                        <div class="form-group">
                            <label>Retenção dos logs (dias)</label>
                            <input type="number" class="form-control js-setting" data-key="auditRetentionDays" value="${escapeHtml(settings.auditRetentionDays)}">
                        </div>
                        <div class="custom-control custom-checkbox mb-2">
                            <input type="checkbox" class="custom-control-input js-setting" id="geoSegregation" data-key="geoSegregation" ${settings.geoSegregation ? 'checked' : ''}>
                            <label class="custom-control-label" for="geoSegregation">Aplicar segregação por secretaria / escola / usuário</label>
                        </div>
                        <div class="custom-control custom-checkbox mb-2">
                            <input type="checkbox" class="custom-control-input js-setting" id="unitSelectionRequired" data-key="unitSelectionRequired" ${settings.unitSelectionRequired ? 'checked' : ''}>
                            <label class="custom-control-label" for="unitSelectionRequired">Exigir seleção de unidade escolar</label>
                        </div>
                        <div class="custom-control custom-checkbox">
                            <input type="checkbox" class="custom-control-input js-setting" id="enforce2faAdmins" data-key="enforce2faAdmins" ${settings.enforce2faAdmins ? 'checked' : ''}>
                            <label class="custom-control-label" for="enforce2faAdmins">Exigir segundo fator para administradores</label>
                        </div>
                        <div class="mt-4 d-flex flex-wrap">
                            <a href="/login" class="btn btn-outline-secondary mr-2 mb-2">Abrir login</a>
                            <a href="/recuperacao-senha" class="btn btn-outline-secondary mr-2 mb-2">Abrir recuperação</a>
                            <button id="saveSecuritySettingsBtn" class="btn btn-primary mb-2">Salvar política</button>
                        </div>
                        <div id="securitySettingsFeedback" class="security-meta mt-2"></div>
                    </div>
                </div>
            </div>
        `;

        container.addEventListener('change', (event) => {
            const field = event.target.closest('.js-setting');
            if (!field) return;
            const next = getStoredState();
            const key = field.dataset.key;
            const value = field.type === 'checkbox' ? field.checked : Number(field.value || 0);
            next.settings[key] = value;
            saveStoredState({ settings: next.settings });
        });

        $('saveSecuritySettingsBtn')?.addEventListener('click', () => {
            $('securitySettingsFeedback').textContent = 'Política salva localmente para a prova de conceito e pronta para integrar com backend.';
        });
    }

    function renderConfigHub() {
        renderUsersSection('securityUsersContent', 'securityKpisUsers');
        renderProfilesSection('securityProfilesContent', 'securityKpisProfiles');
        renderLogsSection('securityLogsContent', 'securityKpisLogs');
        renderSecuritySettingsSection('securitySettingsContent', 'securityKpisSettings');
    }

    async function boot() {
        if (!page) return;
        if (page === 'unit-selection') return renderSelectionPage();
        if (page === 'users') return renderUsersPage();
        if (page === 'profiles') return renderProfilesPage();
        if (page === 'logs') return renderLogsPage();
        if (page === 'settings') return renderSecuritySettingsPage();
    }

    window.SETRANE_SECURITY = {
        renderConfigHub
    };

    document.addEventListener('DOMContentLoaded', boot);
})();
