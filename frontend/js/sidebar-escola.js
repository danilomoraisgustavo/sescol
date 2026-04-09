(function () {
    function q(sel, root) { return (root || document).querySelector(sel); }

    function normalizePath(path) {
        if (!path) return '/';
        return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
    }

    async function getMe() {
        try {
            var r = await fetch('/api/me', { credentials: 'include' });
            if (!r.ok) return null;
            return await r.json();
        } catch (_) {
            return null;
        }
    }

    function renderSidebar(escola) {
        var sidebar = q('aside#leftSidebar');
        var nav = q('.vertnav.navbar', sidebar);
        if (!sidebar || !nav || !window.EscolaContexto) return;

        var escolaId = window.EscolaContexto.obterEscolaIdDaUrl();
        var currentPath = normalizePath(window.location.pathname || '/');
        var nomeEscola = (escola && escola.nome) || 'Escola';
        var permissions = Array.isArray(window.__ME && window.__ME.permissions) ? window.__ME.permissions : [];
        var canViewInstitutional = permissions.indexOf('institution.master.view') !== -1 || permissions.indexOf('institution.master.manage') !== -1;
        var contextualInstitutionalQuery = '?contexto=escola&escola_id=' + encodeURIComponent(escolaId);

        function item(href, icon, label) {
            var activeClass = normalizePath(href) === currentPath ? ' active' : '';
            return '' +
                '<li class="nav-item' + activeClass + '">' +
                    '<a class="nav-link" href="' + href + '">' +
                        '<i class="fe ' + icon + ' fe-16"></i>' +
                        '<span class="ml-3 item-text">' + label + '</span>' +
                    '</a>' +
                '</li>';
        }

        var institucionalHtml = canViewInstitutional ? (
            '<p class="text-muted nav-heading mt-4 mb-1"><span>Institucional</span></p>' +
            '<ul class="navbar-nav flex-fill w-100 mb-2">' +
                item('/institucional/calendarios-letivos' + contextualInstitutionalQuery, 'fe-calendar', 'Calendário da unidade') +
                item('/institucional/servidores' + contextualInstitutionalQuery, 'fe-briefcase', 'Equipe da unidade') +
            '</ul>'
        ) : '';

        nav.innerHTML = '' +
            '<div class="w-100 mb-4 d-flex">' +
                '<a class="navbar-brand mx-auto mt-2 flex-fill text-center" href="' + window.EscolaContexto.montarUrlModulo(escolaId, 'dashboard') + '">' +
                    '<span class="h5 mb-0 font-weight-bold">' + nomeEscola + '</span>' +
                '</a>' +
            '</div>' +
            '<p class="text-muted nav-heading mt-3 mb-1"><span>Escola</span></p>' +
            '<ul class="navbar-nav flex-fill w-100 mb-2">' +
                item(window.EscolaContexto.montarUrlModulo(escolaId, 'dashboard'), 'fe-home', 'Dashboard') +
                item(window.EscolaContexto.montarUrlModulo(escolaId, 'turmas'), 'fe-layers', 'Turmas') +
                item(window.EscolaContexto.montarUrlModulo(escolaId, 'alunos'), 'fe-users', 'Alunos') +
            '</ul>' +
            '<p class="text-muted nav-heading mt-4 mb-1"><span>Navegacao</span></p>' +
            '<ul class="navbar-nav flex-fill w-100 mb-2">' +
                item('/escolas', 'fe-map-pin', 'Voltar para escolas') +
                item('/zoneamentos', 'fe-map', 'Zoneamentos') +
                item('/pontos-parada', 'fe-navigation', 'Pontos de parada') +
            '</ul>' +
            institucionalHtml +
            '<p class="text-muted nav-heading mt-4 mb-1"><span>Sistema</span></p>' +
            '<ul class="navbar-nav flex-fill w-100 mb-2">' +
                item('/dashboard', 'fe-grid', 'Painel geral') +
                item('/auth-logout.html', 'fe-log-out', 'Sair') +
            '</ul>';
    }

    document.addEventListener('DOMContentLoaded', function () {
        if (!window.EscolaContexto) return;

        Promise.all([
            getMe().then(function (me) { if (me) window.__ME = me; }),
            window.EscolaContexto.carregarDashboard()
        ])
            .then(function (results) {
                var data = results[1];
                renderSidebar(data && data.escola ? data.escola : null);
            })
            .catch(function () {
                renderSidebar(null);
            });
    });
})();
