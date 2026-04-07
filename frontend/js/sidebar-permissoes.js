/**
 * sidebar-permissoes.js
 * Ajusta o menu lateral (aside) no frontend com base no cargo do usuário.
 * Requer endpoint GET /api/me (já incluído no server).
 *
 * Comportamento (UX):
 * - FORNECEDOR / FORNECEDOR_ESCOLAR:
 *   - Mantém Escolar > Operação (Motoristas, Monitores, Veículos, Fornecedores)
 *   - Mantém Escolar > Cadastros > Rotas escolares (Municipais/Exclusivas/Estaduais)
 *   - Oculta Zoneamentos, Escolas, Alunos e Pontos de parada
 * - Outros cargos: mantém o menu padrão
 *
 * Observação: isso é apenas UX. Segurança real está no backend.
 */

(function () {
    function q(sel, root) { return (root || document).querySelector(sel); }
    function qa(sel, root) { return Array.from((root || document).querySelectorAll(sel)); }

    function hideEl(el) { if (el) el.style.display = 'none'; }
    function showEl(el) { if (el) el.style.display = ''; }

    async function getMe() {
        const r = await fetch('/api/me', { credentials: 'include' });
        if (!r.ok) return null;
        return r.json();
    }

    function keepOnlyFornecedorMenu() {
        // Itens permitidos por href (links finais, não toggles '#...')
        const allowHrefs = new Set([
            '/dashboard',
            '/motoristas',
            '/monitores',
            '/veiculos',
            '/fornecedores',
            '/rotas-municipais',
            '/rotas-exclusivas',
            '/rotas-estaduais',
            '/auth-logout.html'
        ]);

        // 1) Oculta links finais não permitidos
        qa('aside#leftSidebar a.nav-link').forEach(a => {
            const href = (a.getAttribute('href') || '').trim();
            if (!href) return;

            // dropdown toggles: mantém por enquanto (vamos limpar filhos depois)
            if (href.startsWith('#')) return;

            if (!allowHrefs.has(href)) {
                hideEl(a.closest('li.nav-item'));
            }
        });

        // 2) Cadastros: remove tudo exceto Rotas escolares (3 páginas)
        const cad = q('#escolar-cadastros');
        if (cad) {
            qa('#escolar-cadastros a.nav-link').forEach(a => {
                const href = (a.getAttribute('href') || '').trim();
                if (href.startsWith('#')) return; // toggle do dropdown "Rotas escolares"
                if (!['/rotas-municipais', '/rotas-exclusivas', '/rotas-estaduais'].includes(href)) {
                    hideEl(a.closest('li.nav-item'));
                } else {
                    showEl(a.closest('li.nav-item'));
                }
            });

            // Se o dropdown "Rotas escolares" existir, garante que fique visível
            const dropdownRotas = q('#escolar-rotas-escolares');
            if (dropdownRotas) {
                showEl(dropdownRotas.closest('li.nav-item.dropdown') || dropdownRotas.closest('li.nav-item'));
            }

            // Se o Cadastros ficou vazio, esconde o dropdown inteiro (não deve acontecer aqui)
            const anyVisible = qa('#escolar-cadastros li.nav-item').some(li => li.style.display !== 'none');
            if (!anyVisible) hideEl(cad.closest('li.nav-item.dropdown'));
        }

        // 3) Operação: remove itens não permitidos
        const op = q('#escolar-operacao');
        if (op) {
            qa('#escolar-operacao a.nav-link').forEach(a => {
                const href = (a.getAttribute('href') || '').trim();
                if (!href || href.startsWith('#')) return;
                if (!['/motoristas', '/monitores', '/veiculos', '/fornecedores'].includes(href)) {
                    hideEl(a.closest('li.nav-item'));
                } else {
                    showEl(a.closest('li.nav-item'));
                }
            });
        }

        // 4) Esconde seção Sistema (configurações) para fornecedor
        qa('p.nav-heading').forEach(p => {
            if ((p.textContent || '').trim().toLowerCase() === 'sistema') hideEl(p);
        });
        qa('a.nav-link[href="/sistema/configuracoes"]').forEach(a => hideEl(a.closest('li.nav-item')));

        // 5) Expande seções úteis
        const toggleOp = q('a[href="#escolar-operacao"]');
        if (toggleOp) toggleOp.setAttribute('aria-expanded', 'true');
        const opList = q('#escolar-operacao');
        if (opList) opList.classList.add('show');

        const toggleCad = q('a[href="#escolar-cadastros"]');
        if (toggleCad) toggleCad.setAttribute('aria-expanded', 'true');
        const cadList = q('#escolar-cadastros');
        if (cadList) cadList.classList.add('show');

        const toggleRotas = q('a[href="#escolar-rotas-escolares"]');
        if (toggleRotas) toggleRotas.setAttribute('aria-expanded', 'true');
        const rotasList = q('#escolar-rotas-escolares');
        if (rotasList) rotasList.classList.add('show');
    }

    document.addEventListener('DOMContentLoaded', async function () {
        try {
            const me = await getMe();
            if (me) window.__ME = me;
            if (!me) return;

            const cargo = String(me.cargo || '').toUpperCase();
            if (cargo === 'FORNECEDOR_ESCOLAR' || cargo === 'FORNECEDOR') {
                keepOnlyFornecedorMenu();
            }
        } catch (e) {
            // silencioso
        }
    });
})();
