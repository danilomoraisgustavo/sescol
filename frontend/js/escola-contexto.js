(function () {
    function obterEscolaIdDaUrl() {
        var match = window.location.pathname.match(/\/escolar\/escola\/(\d+)\//);
        if (match) return Number(match[1]);

        match = window.location.pathname.match(/\/escolas\/(\d+)\/dashboard/);
        return match ? Number(match[1]) : null;
    }

    function montarUrlModulo(escolaId, secao) {
        return '/escolar/escola/' + escolaId + '/' + secao;
    }

    function formatarEndereco(escola) {
        return [
            escola && escola.logradouro,
            escola && escola.numero,
            escola && escola.bairro,
            escola && escola.cep
        ].filter(Boolean).join(', ');
    }

    function carregarJson(url) {
        return fetch(url, { credentials: 'include' }).then(function (resp) {
            if (!resp.ok) throw new Error('Falha ao carregar ' + url);
            return resp.json();
        });
    }

    function carregarDashboard(escolaId) {
        var id = escolaId || obterEscolaIdDaUrl();
        if (!id) return Promise.reject(new Error('Escola nao identificada na URL'));

        window.__escolaDashboardCache = window.__escolaDashboardCache || {};
        if (!window.__escolaDashboardCache[id]) {
            window.__escolaDashboardCache[id] = carregarJson('/api/escolas/' + id + '/dashboard');
        }
        return window.__escolaDashboardCache[id];
    }

    window.EscolaContexto = {
        obterEscolaIdDaUrl: obterEscolaIdDaUrl,
        montarUrlModulo: montarUrlModulo,
        formatarEndereco: formatarEndereco,
        carregarJson: carregarJson,
        carregarDashboard: carregarDashboard
    };
})();
