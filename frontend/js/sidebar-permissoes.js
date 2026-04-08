/**
 * sidebar-permissoes.js
 * Reorganiza o menu lateral em módulos fixos, sem submenus recolhíveis,
 * e aplica o recorte visual por cargo do usuário.
 *
 * Observação: isso é UX. Segurança continua sendo responsabilidade do backend.
 */

(function () {
    const MODULES = [
        {
            id: 'visao-geral',
            title: 'Visão Geral',
            items: [
                { href: '/dashboard', label: 'Painel', icon: 'fe-home' },
            ],
        },
        {
            id: 'base-escolar',
            title: 'Base Escolar',
            items: [
                { href: '/zoneamentos', label: 'Zoneamentos', icon: 'fe-layers' },
                { href: '/escolas', label: 'Escolas', icon: 'fe-map-pin' },
                { href: '/alunos', label: 'Alunos', icon: 'fe-users' },
            ],
        },
        {
            id: 'rotas',
            title: 'Rotas',
            items: [
                { href: '/pontos-parada', label: 'Pontos de parada', icon: 'fe-navigation' },
                { href: '/rotas-municipais', label: 'Rotas municipais', icon: 'fe-git-branch' },
                { href: '/rotas-exclusivas', label: 'Rotas exclusivas', icon: 'fe-shuffle' },
                { href: '/rotas-estaduais', label: 'Rotas estaduais', icon: 'fe-compass' },
            ],
        },
        {
            id: 'operacao',
            title: 'Operação',
            items: [
                { href: '/motoristas', label: 'Motoristas', icon: 'fe-user-check' },
                { href: '/monitores', label: 'Monitores', icon: 'fe-shield' },
                { href: '/veiculos', label: 'Veículos', icon: 'fe-truck' },
                { href: '/fornecedores', label: 'Fornecedores', icon: 'fe-briefcase' },
            ],
        },
        {
            id: 'interno',
            title: 'Interno',
            items: [
                { href: '/interno/motoristas', label: 'Motoristas internos', icon: 'fe-user' },
                { href: '/interno/veiculos', label: 'Veículos internos', icon: 'fe-package' },
            ],
        },
        {
            id: 'sistema',
            title: 'Sistema',
            items: [
                { href: '/sistema/configuracoes', label: 'Configurações', icon: 'fe-settings' },
                { href: '/auth-logout.html', label: 'Sair', icon: 'fe-log-out' },
            ],
        },
    ];

    const FORNECEDOR_ALLOWED = new Set([
        '/dashboard',
        '/motoristas',
        '/monitores',
        '/veiculos',
        '/fornecedores',
        '/rotas-municipais',
        '/rotas-exclusivas',
        '/rotas-estaduais',
        '/auth-logout.html',
    ]);

    function q(sel, root) { return (root || document).querySelector(sel); }
    function normalizePath(path) {
        if (!path) return '/';
        return path.length > 1 && path.endsWith('/') ? path.slice(0, -1) : path;
    }

    async function getMe() {
        const r = await fetch('/api/me', { credentials: 'include' });
        if (!r.ok) return null;
        return r.json();
    }

    function isActiveLink(href, currentPath) {
        const normalizedHref = normalizePath(href);
        const normalizedCurrent = normalizePath(currentPath);
        return normalizedHref === normalizedCurrent;
    }

    function filterModulesByCargo(cargo) {
        const normalizedCargo = String(cargo || '').toUpperCase();
        if (normalizedCargo !== 'FORNECEDOR_ESCOLAR' && normalizedCargo !== 'FORNECEDOR') {
            return MODULES;
        }

        return MODULES
            .map((module) => ({
                ...module,
                items: module.items.filter((item) => FORNECEDOR_ALLOWED.has(item.href)),
            }))
            .filter((module) => module.items.length > 0);
    }

    function renderModule(module, currentPath) {
        const itemsHtml = module.items.map((item) => {
            const activeClass = isActiveLink(item.href, currentPath) ? ' active' : '';
            return `
                <li class="nav-item${activeClass}">
                    <a class="nav-link" href="${item.href}">
                        <i class="fe ${item.icon} fe-16"></i>
                        <span class="ml-3 item-text">${item.label}</span>
                    </a>
                </li>
            `;
        }).join('');

        return `
            <p class="text-muted nav-heading mt-4 mb-1" data-module="${module.id}"><span>${module.title}</span></p>
            <ul class="navbar-nav flex-fill w-100 mb-2">
                ${itemsHtml}
            </ul>
        `;
    }

    function renderSidebar(cargo) {
        const sidebar = q('aside#leftSidebar');
        const nav = q('.vertnav.navbar', sidebar);
        if (!sidebar || !nav) return;

        const brand = q('.w-100.mb-4.d-flex', nav);
        const brandHtml = brand ? brand.outerHTML : `
            <div class="w-100 mb-4 d-flex">
                <a class="navbar-brand mx-auto mt-2 flex-fill text-center" href="/dashboard">
                    <span class="h5 mb-0 text-uppercase font-weight-bold">SETRANE EXPRESS</span>
                </a>
            </div>
        `;

        const modules = filterModulesByCargo(cargo);
        const currentPath = window.location.pathname || '/';

        nav.innerHTML = `
            ${brandHtml}
            ${modules.map((module) => renderModule(module, currentPath)).join('')}
        `;
    }

    document.addEventListener('DOMContentLoaded', async function () {
        try {
            const me = await getMe();
            if (me) window.__ME = me;
            renderSidebar(me?.cargo || '');
        } catch (e) {
            renderSidebar('');
        }
    });
})();
