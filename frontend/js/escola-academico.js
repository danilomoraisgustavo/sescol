(function () {
    function q(selector, root) { return (root || document).querySelector(selector); }
    function qa(selector, root) { return Array.prototype.slice.call((root || document).querySelectorAll(selector)); }
    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }
    function formatDate(value) {
        if (!value) return 'Não informado';
        var date = new Date(value);
        if (isNaN(date.getTime())) return 'Não informado';
        return date.toLocaleDateString('pt-BR');
    }
    function formatDateTime(value) {
        if (!value) return 'Não informado';
        var date = new Date(value);
        if (isNaN(date.getTime())) return 'Não informado';
        return date.toLocaleString('pt-BR');
    }
    function badge(label, tone) {
        var tones = {
            success: 'badge-success',
            warning: 'badge-warning',
            danger: 'badge-danger',
            info: 'badge-info',
            primary: 'badge-primary',
            secondary: 'badge-secondary'
        };
        return '<span class="badge ' + (tones[tone] || tones.info) + '">' + escapeHtml(label) + '</span>';
    }
    function normalizeStatusTone(status) {
        var normalized = String(status || '').toUpperCase();
        if (['ATIVO', 'CONCLUIDA', 'FECHADA'].indexOf(normalized) !== -1) return 'success';
        if (['ABERTA', 'EM_ANDAMENTO', 'AGUARDANDO_DOCUMENTO', 'EM_TRANSFERENCIA'].indexOf(normalized) !== -1) return 'warning';
        if (['TRANSFERIDO', 'TRANSFERENCIA_EXTERNA', 'INATIVO'].indexOf(normalized) !== -1) return 'secondary';
        return 'info';
    }
    function fetchJson(url, options) {
        return fetch(url, Object.assign({ credentials: 'include' }, options || {})).then(function (response) {
            if (!response.ok) {
                return response.json().catch(function () { return {}; }).then(function (payload) {
                    throw new Error(payload.error || 'Falha na operação.');
                });
            }
            return response.json();
        });
    }
    function postJson(url, body, method) {
        return fetchJson(url, {
            method: method || 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body || {})
        });
    }
    function openPdf(url) {
        window.open(url, '_blank', 'noopener,noreferrer');
    }
    function getSchoolId() {
        return window.EscolaContexto ? window.EscolaContexto.obterEscolaIdDaUrl() : null;
    }

    var state = {
        schoolId: null,
        page: null,
        dashboard: null,
        overview: null,
        alunos: [],
        turmas: [],
        ocorrencias: [],
        transferenciasExternas: [],
        historyCache: {}
    };

    var PAGE_META = {
        matriculas: {
            title: 'Matrículas',
            description: 'Gestão de vínculos escolares, cadastro ativo e acompanhamento de matrículas da unidade.'
        },
        'diario-classe': {
            title: 'Diário de Classe',
            description: 'Registro de aulas, conteúdo ministrado, frequência diária e fechamento do diário por turma e disciplina.'
        },
        'notas-componentes': {
            title: 'Notas e Componentes',
            description: 'Lançamento por disciplina, período letivo, avaliação, frequência, faltas e parecer descritivo.'
        },
        rematriculas: {
            title: 'Rematrículas',
            description: 'Planejamento e processamento da continuidade do aluno para o próximo ano letivo.'
        },
        enturmacao: {
            title: 'Enturmação',
            description: 'Distribuição e remanejamento de estudantes nas turmas da unidade.'
        },
        transferencias: {
            title: 'Transferências',
            description: 'Controle de transferências internas e externas com histórico, protocolo e validação.'
        },
        'conselho-classe': {
            title: 'Conselho de Classe',
            description: 'Pauta pedagógica, alunos em atenção, deliberações, encaminhamentos e participantes por turma/período.'
        },
        fechamentos: {
            title: 'Fechamentos',
            description: 'Fechamento formal por período, consolidação de resultados, situação final e indicadores da turma.'
        },
        'historico-escolar': {
            title: 'Histórico Escolar',
            description: 'Linha do tempo acadêmica, vínculos, ocorrências e documentos formais do estudante.'
        },
        documentos: {
            title: 'Documentos Escolares',
            description: 'Emissão centralizada de declarações, históricos, boletins, fichas e atas por turma.'
        },
        ocorrencias: {
            title: 'Ocorrências',
            description: 'Registro, acompanhamento e fechamento de ocorrências acadêmicas e disciplinares.'
        },
        relatorios: {
            title: 'Relatórios Acadêmicos',
            description: 'Indicadores por escola, turma e situação acadêmica para apoio à gestão.'
        }
    };

    function ensureModal() {
        if (q('#academic-modal')) return;
        document.body.insertAdjacentHTML('beforeend',
            '<div class="modal fade modal-slide-right" id="academic-modal" tabindex="-1" role="dialog" aria-hidden="true">' +
                '<div class="modal-dialog modal-xl" role="document">' +
                    '<div class="modal-content">' +
                        '<div class="modal-header">' +
                            '<div><h5 class="modal-title mb-1" id="academic-modal-title">Detalhes</h5><div class="small text-muted" id="academic-modal-subtitle"></div></div>' +
                            '<button type="button" class="close" data-dismiss="modal" aria-label="Fechar"><span aria-hidden="true">&times;</span></button>' +
                        '</div>' +
                        '<div class="modal-body" id="academic-modal-body"></div>' +
                        '<div class="modal-footer" id="academic-modal-footer">' +
                            '<button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Fechar</button>' +
                        '</div>' +
                    '</div>' +
                '</div>' +
            '</div>'
        );
    }

    function showModal(title, subtitle, bodyHtml, footerHtml) {
        ensureModal();
        q('#academic-modal-title').textContent = title || 'Detalhes';
        q('#academic-modal-subtitle').textContent = subtitle || '';
        q('#academic-modal-body').innerHTML = bodyHtml || '';
        q('#academic-modal-footer').innerHTML = footerHtml || '<button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Fechar</button>';
        if (window.jQuery) window.jQuery('#academic-modal').modal('show');
    }

    function renderStats(cards) {
        var container = q('#page-stats');
        if (!container) return;
        container.innerHTML = (cards || []).map(function (item) {
            return '<div class="col-md-3 mb-3"><div class="card shadow h-100"><div class="card-body"><div class="small text-muted">' +
                escapeHtml(item.label) + '</div><div class="h3 mb-0">' + escapeHtml(item.value) + '</div></div></div></div>';
        }).join('');
    }

    function setHeader() {
        var meta = PAGE_META[state.page] || {};
        var title = q('#page-title');
        var subtitle = q('#page-subtitle');
        var school = state.dashboard && state.dashboard.escola;
        if (title) title.textContent = meta.title || 'Acadêmico';
        if (subtitle) subtitle.textContent = (school && school.nome ? school.nome + ' • ' : '') + (meta.description || '');
        var actions = q('#page-actions');
        if (actions) {
            actions.innerHTML =
                '<a href="' + window.EscolaContexto.montarUrlModulo(state.schoolId, 'dashboard') + '" class="btn btn-outline-secondary btn-sm mr-2">Dashboard</a>' +
                '<a href="' + window.EscolaContexto.montarUrlModulo(state.schoolId, 'alunos') + '" class="btn btn-outline-primary btn-sm mr-2">Alunos</a>' +
                '<a href="' + window.EscolaContexto.montarUrlModulo(state.schoolId, 'turmas') + '" class="btn btn-primary btn-sm">Turmas</a>';
        }
    }

    function renderTable(headers, rows, emptyText) {
        if (!rows || !rows.length) {
            return '<div class="text-muted py-4 text-center">' + escapeHtml(emptyText || 'Nenhum registro encontrado.') + '</div>';
        }
        return '<div class="table-responsive"><table class="table table-hover mb-0"><thead><tr>' +
            headers.map(function (header) { return '<th>' + escapeHtml(header) + '</th>'; }).join('') +
            '</tr></thead><tbody>' + rows.join('') + '</tbody></table></div>';
    }

    function loadCore() {
        return Promise.all([
            window.EscolaContexto.carregarDashboard(state.schoolId).then(function (data) { state.dashboard = data || {}; }),
            fetchJson('/api/escolas/' + state.schoolId + '/academico/overview').then(function (data) { state.overview = data || {}; }),
            fetchJson('/api/escolas/' + state.schoolId + '/alunos').then(function (data) { state.alunos = data.alunos || []; }),
            fetchJson('/api/escolas/' + state.schoolId + '/turmas').then(function (data) { state.turmas = data.turmas || []; })
        ]);
    }

    function studentName(aluno) {
        return aluno.pessoa_nome || aluno.nome || 'Aluno não identificado';
    }

    function renderMatriculasPage() {
        renderStats([
            { label: 'Matrículas ativas', value: state.overview.matriculas.ativas || 0 },
            { label: 'Matrículas inativas', value: state.overview.matriculas.inativas || 0 },
            { label: 'Turmas vinculadas', value: state.overview.matriculas.turmas || 0 },
            { label: 'Rematrículas previstas', value: state.overview.rematriculas.previstas || 0 }
        ]);
        q('#page-filters').innerHTML =
            '<div class="d-flex align-items-center justify-content-between flex-wrap">' +
                '<div class="text-muted mb-2">A matrícula completa do aluno continua disponível na página da unidade.</div>' +
                '<a href="' + window.EscolaContexto.montarUrlModulo(state.schoolId, 'alunos') + '" class="btn btn-success btn-sm mb-2">Abrir ficha completa de matrícula</a>' +
            '</div>';

        var rows = state.alunos.map(function (aluno) {
            return '<tr>' +
                '<td><strong>' + escapeHtml(studentName(aluno)) + '</strong><div class="small text-muted">Matrícula ' + escapeHtml(aluno.id_pessoa || 'N/I') + '</div></td>' +
                '<td>' + escapeHtml(aluno.turma_escola || aluno.turma || 'Não informada') + '</td>' +
                '<td>' + escapeHtml(aluno.ano_letivo || 'N/I') + '</td>' +
                '<td>' + badge(aluno.status || 'Ativo', normalizeStatusTone(aluno.status)) + '</td>' +
                '<td>' + escapeHtml(aluno.responsavel || 'Não informado') + '</td>' +
                '<td class="text-right"><a class="btn btn-sm btn-outline-primary" href="' + window.EscolaContexto.montarUrlModulo(state.schoolId, 'alunos') + '">Abrir cadastro</a></td>' +
            '</tr>';
        });
        q('#page-content').innerHTML = renderTable(['Aluno', 'Turma', 'Ano letivo', 'Status', 'Responsável', 'Ações'], rows, 'Nenhuma matrícula encontrada.');
    }

    function renderRematriculasPage() {
        var currentYear = new Date().getFullYear();
        q('#page-filters').innerHTML =
            '<div class="form-row align-items-end">' +
                '<div class="col-md-3"><label>Ano de origem</label><input type="number" class="form-control" id="filtro-ano-origem" value="' + currentYear + '"></div>' +
                '<div class="col-md-3"><label>Ano de destino</label><input type="number" class="form-control" id="filtro-ano-destino" value="' + (currentYear + 1) + '"></div>' +
                '<div class="col-md-3"><button class="btn btn-outline-primary btn-block" id="btn-preview-rematriculas">Atualizar prévia</button></div>' +
                '<div class="col-md-3"><button class="btn btn-primary btn-block" id="btn-processar-rematriculas">Processar selecionados</button></div>' +
            '</div>';
        renderStats([
            { label: 'Ano atual', value: state.overview.rematriculas.ano_atual || currentYear },
            { label: 'Ano destino', value: state.overview.rematriculas.ano_destino || (currentYear + 1) },
            { label: 'Previstas', value: state.overview.rematriculas.previstas || 0 },
            { label: 'Matrículas ativas', value: state.overview.matriculas.ativas || 0 }
        ]);

        function loadPreview() {
            var origem = q('#filtro-ano-origem').value;
            var destino = q('#filtro-ano-destino').value;
            fetchJson('/api/escolas/' + state.schoolId + '/rematriculas/preview?ano_origem=' + encodeURIComponent(origem) + '&ano_destino=' + encodeURIComponent(destino))
                .then(function (data) {
                    var rows = (data.alunos || []).map(function (aluno) {
                        return '<tr>' +
                            '<td><input type="checkbox" class="rematricula-check" value="' + escapeHtml(aluno.id) + '"></td>' +
                            '<td><strong>' + escapeHtml(aluno.pessoa_nome || 'Sem nome') + '</strong><div class="small text-muted">Matrícula ' + escapeHtml(aluno.id_pessoa || 'N/I') + '</div></td>' +
                            '<td>' + escapeHtml(aluno.turma || 'Sem turma') + '</td>' +
                            '<td>' + escapeHtml(data.ano_origem) + ' → ' + escapeHtml(data.ano_destino) + '</td>' +
                        '</tr>';
                    });
                    q('#page-content').innerHTML = renderTable(['', 'Aluno', 'Turma atual', 'Fluxo'], rows, 'Nenhuma rematrícula pendente.');
                    q('#btn-processar-rematriculas').onclick = function () {
                        var ids = qa('.rematricula-check:checked').map(function (item) { return Number(item.value); });
                        postJson('/api/escolas/' + state.schoolId + '/rematriculas/processar', {
                            ano_origem: Number(origem),
                            ano_destino: Number(destino),
                            aluno_ids: ids
                        }).then(function (payload) {
                            window.alert((payload.processados || 0) + ' rematrícula(s) processada(s).');
                            loadPreview();
                        }).catch(function (error) {
                            window.alert(error.message || 'Falha ao processar rematrículas.');
                        });
                    };
                });
        }

        q('#btn-preview-rematriculas').onclick = loadPreview;
        loadPreview();
    }

    function renderEnturmacaoPage() {
        renderStats([
            { label: 'Turmas ativas', value: state.overview.matriculas.turmas || 0 },
            { label: 'Alunos vinculados', value: state.alunos.length },
            { label: 'Com transporte', value: state.alunos.filter(function (aluno) { return aluno.transporte_apto; }).length },
            { label: 'Com deficiência', value: state.alunos.filter(function (aluno) { return !!aluno.deficiencia; }).length }
        ]);
        q('#page-filters').innerHTML =
            '<div class="form-row align-items-end">' +
                '<div class="col-md-3"><label>Ano letivo</label><input type="number" class="form-control" id="enturmacao-ano" value="' + (new Date().getFullYear()) + '"></div>' +
                '<div class="col-md-5"><label>Turma de destino</label><select class="form-control" id="enturmacao-turma"><option value="">Selecione</option>' +
                    state.turmas.map(function (turma) {
                        return '<option value="' + escapeHtml(turma.nome || turma.turma || '') + '">' + escapeHtml((turma.nome || turma.turma || 'Turma') + ' • ' + (turma.ano_letivo || 'N/I')) + '</option>';
                    }).join('') +
                '</select></div>' +
                '<div class="col-md-4"><button class="btn btn-primary btn-block" id="btn-processar-enturmacao">Enturmar selecionados</button></div>' +
            '</div>';
        var rows = state.alunos.map(function (aluno) {
            return '<tr>' +
                '<td><input type="checkbox" class="enturmacao-check" value="' + escapeHtml(aluno.id) + '"></td>' +
                '<td><strong>' + escapeHtml(studentName(aluno)) + '</strong><div class="small text-muted">Ano ' + escapeHtml(aluno.ano_letivo || 'N/I') + '</div></td>' +
                '<td>' + escapeHtml(aluno.turma_escola || aluno.turma || 'Sem turma') + '</td>' +
                '<td>' + escapeHtml(aluno.turno || 'Não informado') + '</td>' +
                '<td>' + escapeHtml(aluno.etapa || 'Não informada') + '</td>' +
            '</tr>';
        });
        q('#page-content').innerHTML = renderTable(['', 'Aluno', 'Turma atual', 'Turno', 'Etapa'], rows, 'Nenhum aluno para enturmar.');
        q('#btn-processar-enturmacao').onclick = function () {
            var turma = q('#enturmacao-turma').value;
            var ano = Number(q('#enturmacao-ano').value);
            var ids = qa('.enturmacao-check:checked').map(function (item) { return Number(item.value); });
            postJson('/api/escolas/' + state.schoolId + '/enturmacao/processar', {
                ano_letivo: ano,
                turma_destino: turma,
                aluno_ids: ids
            }).then(function (payload) {
                window.alert((payload.enturmados || 0) + ' aluno(s) enturmado(s).');
                window.location.reload();
            }).catch(function (error) {
                window.alert(error.message || 'Falha ao processar enturmação.');
            });
        };
    }

    function renderDiarioPage() {
        renderStats([
            { label: 'Lançamentos', value: state.overview.diario_classe.total || 0 },
            { label: 'Diários fechados', value: state.overview.diario_classe.fechados || 0 },
            { label: 'Turmas', value: state.overview.matriculas.turmas || 0 },
            { label: 'Avaliações lançadas', value: state.overview.avaliacoes.lancamentos || 0 }
        ]);
        q('#page-filters').innerHTML =
            '<div class="d-flex align-items-center justify-content-between flex-wrap">' +
                '<div class="text-muted mb-2">Registre a aula ministrada, o componente curricular, a frequência e o status do diário.</div>' +
                '<button class="btn btn-primary btn-sm mb-2" id="btn-novo-diario">Novo lançamento</button>' +
            '</div>';

        function loadDiary() {
            fetchJson('/api/escolas/' + state.schoolId + '/diario-classe?ano_letivo=' + encodeURIComponent(new Date().getFullYear())).then(function (payload) {
                var registros = payload.registros || [];
                var disciplinas = payload.disciplinas || [];
                var rows = registros.map(function (item) {
                    var taxa = item.total_previsto ? Math.round(((Number(item.presentes || 0) / Number(item.total_previsto || 1)) * 100)) : 0;
                    return '<tr>' +
                        '<td><strong>' + escapeHtml(item.data_aula || '') + '</strong><div class="small text-muted">' + escapeHtml(item.periodo_letivo || 'Sem período') + '</div></td>' +
                        '<td>' + escapeHtml(item.turma || 'Sem turma') + '</td>' +
                        '<td><strong>' + escapeHtml(item.disciplina_nome || 'Sem disciplina') + '</strong><div class="small text-muted">' + escapeHtml(item.professor_nome || 'Professor não informado') + '</div></td>' +
                        '<td>' + escapeHtml(item.conteudo || 'Sem conteúdo') + '</td>' +
                        '<td>' + escapeHtml((item.presentes || 0) + '/' + (item.total_previsto || 0)) + '<div class="small text-muted">Presença ' + escapeHtml(taxa) + '%</div></td>' +
                        '<td>' + badge(item.status || 'LANÇADO', normalizeStatusTone(item.status)) + '</td>' +
                        '<td class="text-right"><button class="btn btn-sm btn-outline-primary diario-editar" data-id="' + item.id + '">Editar</button></td>' +
                    '</tr>';
                });
                q('#page-content').innerHTML = renderTable(['Data', 'Turma', 'Disciplina', 'Conteúdo', 'Frequência', 'Status', 'Ações'], rows, 'Nenhum lançamento de diário encontrado.');
                function openDiaryModal(item) {
                    item = item || {};
                    showModal(
                        item.id ? 'Editar diário' : 'Novo diário de classe',
                        'Registro de conteúdo, frequência e fechamento do lançamento.',
                        '<div class="form-row">' +
                            '<div class="form-group col-md-4"><label>Data da aula</label><input type="date" class="form-control" id="diario-data" value="' + escapeHtml(item.data_aula ? String(item.data_aula).slice(0, 10) : new Date().toISOString().slice(0, 10)) + '"></div>' +
                            '<div class="form-group col-md-4"><label>Turma</label><select class="form-control" id="diario-turma"><option value="">Selecione</option>' + state.turmas.map(function (turma) { var value = turma.nome || turma.turma || ''; return '<option value="' + escapeHtml(value) + '"' + (String(item.turma || '') === String(value) ? ' selected' : '') + '>' + escapeHtml(value) + '</option>'; }).join('') + '</select></div>' +
                            '<div class="form-group col-md-4"><label>Período letivo</label><input type="text" class="form-control" id="diario-periodo" value="' + escapeHtml(item.periodo_letivo || '') + '" placeholder="1º Bimestre"></div>' +
                            '<div class="form-group col-md-6"><label>Disciplina</label><select class="form-control" id="diario-disciplina"><option value="">Selecione</option>' + disciplinas.map(function (disc) { return '<option value="' + escapeHtml(disc.nome) + '"' + (String(item.disciplina_nome || '') === String(disc.nome) ? ' selected' : '') + ' data-id="' + escapeHtml(disc.id) + '">' + escapeHtml(disc.nome) + '</option>'; }).join('') + '</select></div>' +
                            '<div class="form-group col-md-6"><label>Professor</label><input type="text" class="form-control" id="diario-professor" value="' + escapeHtml(item.professor_nome || '') + '"></div>' +
                            '<div class="form-group col-md-6"><label>Conteúdo</label><textarea class="form-control" id="diario-conteudo" rows="3">' + escapeHtml(item.conteudo || '') + '</textarea></div>' +
                            '<div class="form-group col-md-6"><label>Metodologia/atividade</label><textarea class="form-control" id="diario-metodologia" rows="3">' + escapeHtml(item.metodologia || item.atividade_prevista || '') + '</textarea></div>' +
                            '<div class="form-group col-md-3"><label>Total previsto</label><input type="number" class="form-control" id="diario-total" value="' + escapeHtml(item.total_previsto || 0) + '"></div>' +
                            '<div class="form-group col-md-3"><label>Presentes</label><input type="number" class="form-control" id="diario-presentes" value="' + escapeHtml(item.presentes || 0) + '"></div>' +
                            '<div class="form-group col-md-3"><label>Ausentes</label><input type="number" class="form-control" id="diario-ausentes" value="' + escapeHtml(item.ausentes || 0) + '"></div>' +
                            '<div class="form-group col-md-3"><label>Justificados</label><input type="number" class="form-control" id="diario-justificados" value="' + escapeHtml(item.justificados || 0) + '"></div>' +
                            '<div class="form-group col-md-8"><label>Observações</label><textarea class="form-control" id="diario-observacoes" rows="2">' + escapeHtml(item.observacoes || '') + '</textarea></div>' +
                            '<div class="form-group col-md-4"><label>Status</label><select class="form-control" id="diario-status"><option' + ((item.status || 'LANÇADO') === 'LANÇADO' ? ' selected' : '') + '>LANÇADO</option><option' + (item.status === 'FECHADO' ? ' selected' : '') + '>FECHADO</option></select></div>' +
                        '</div>',
                        '<button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Cancelar</button><button type="button" class="btn btn-primary" id="btn-salvar-diario">Salvar diário</button>'
                    );
                    q('#btn-salvar-diario').onclick = function () {
                        var discSelect = q('#diario-disciplina');
                        var selected = discSelect.options[discSelect.selectedIndex];
                        var payload = {
                            data_aula: q('#diario-data').value,
                            turma: q('#diario-turma').value,
                            ano_letivo: new Date().getFullYear(),
                            periodo_letivo: q('#diario-periodo').value,
                            disciplina_id: selected ? Number(selected.getAttribute('data-id') || '') || null : null,
                            disciplina_nome: discSelect.value,
                            professor_nome: q('#diario-professor').value,
                            conteudo: q('#diario-conteudo').value,
                            metodologia: q('#diario-metodologia').value,
                            atividade_prevista: q('#diario-metodologia').value,
                            total_previsto: Number(q('#diario-total').value || 0),
                            presentes: Number(q('#diario-presentes').value || 0),
                            ausentes: Number(q('#diario-ausentes').value || 0),
                            justificados: Number(q('#diario-justificados').value || 0),
                            observacoes: q('#diario-observacoes').value,
                            status: q('#diario-status').value
                        };
                        postJson('/api/escolas/' + state.schoolId + '/diario-classe' + (item.id ? '/' + item.id : ''), payload, item.id ? 'PUT' : 'POST')
                            .then(function () { if (window.jQuery) window.jQuery('#academic-modal').modal('hide'); loadDiary(); })
                            .catch(function (error) { window.alert(error.message || 'Falha ao salvar diário.'); });
                    };
                }
                q('#btn-novo-diario').onclick = function () { openDiaryModal(null); };
                qa('.diario-editar').forEach(function (button) {
                    button.onclick = function () {
                        var item = registros.find(function (row) { return String(row.id) === String(button.getAttribute('data-id')); });
                        openDiaryModal(item);
                    };
                });
            });
        }
        loadDiary();
    }

    function renderNotasPage() {
        renderStats([
            { label: 'Lançamentos', value: state.overview.avaliacoes.lancamentos || 0 },
            { label: 'Média geral', value: state.overview.avaliacoes.media_geral || 'N/I' },
            { label: 'Frequência média', value: state.overview.avaliacoes.frequencia_media || 'N/I' },
            { label: 'Alunos', value: state.alunos.length }
        ]);
        q('#page-filters').innerHTML =
            '<div class="d-flex align-items-center justify-content-between flex-wrap">' +
                '<div class="text-muted mb-2">Lance notas, frequência, faltas e pareceres por aluno, componente e período letivo.</div>' +
                '<button class="btn btn-primary btn-sm mb-2" id="btn-nova-nota">Novo lançamento</button>' +
            '</div>';
        function loadNotas() {
            fetchJson('/api/escolas/' + state.schoolId + '/notas-componentes?ano_letivo=' + encodeURIComponent(new Date().getFullYear())).then(function (payload) {
                var itens = payload.lancamentos || [];
                var disciplinas = payload.disciplinas || [];
                var rows = itens.map(function (item) {
                    return '<tr>' +
                        '<td><strong>' + escapeHtml(item.pessoa_nome || 'Aluno') + '</strong><div class="small text-muted">Matrícula ' + escapeHtml(item.id_pessoa || 'N/I') + '</div></td>' +
                        '<td>' + escapeHtml(item.disciplina_nome || 'Sem disciplina') + '<div class="small text-muted">' + escapeHtml(item.periodo_letivo || 'Sem período') + '</div></td>' +
                        '<td>' + escapeHtml(item.tipo_avaliacao || 'REGULAR') + '</td>' +
                        '<td><strong>' + escapeHtml(item.nota == null ? 'N/I' : item.nota) + '</strong><div class="small text-muted">Recup.: ' + escapeHtml(item.recuperacao ? 'Sim' : 'Não') + '</div></td>' +
                        '<td>' + escapeHtml(item.frequencia == null ? 'N/I' : item.frequencia + '%') + '<div class="small text-muted">Faltas: ' + escapeHtml(item.faltas || 0) + '</div></td>' +
                        '<td>' + badge(item.status || 'LANÇADO', normalizeStatusTone(item.status)) + '</td>' +
                        '<td class="text-right"><button class="btn btn-sm btn-outline-primary nota-editar" data-id="' + item.id + '">Editar</button></td>' +
                    '</tr>';
                });
                q('#page-content').innerHTML = renderTable(['Aluno', 'Componente', 'Tipo', 'Nota', 'Frequência', 'Status', 'Ações'], rows, 'Nenhum lançamento de nota encontrado.');
                function openNotasModal(item) {
                    item = item || {};
                    showModal(
                        item.id ? 'Editar lançamento' : 'Novo lançamento de notas',
                        'Componente curricular, tipo avaliativo, nota, frequência e parecer descritivo.',
                        '<div class="form-row">' +
                            '<div class="form-group col-md-6"><label>Aluno</label><select class="form-control" id="nota-aluno"><option value="">Selecione</option>' + state.alunos.map(function (aluno) { return '<option value="' + escapeHtml(aluno.id) + '"' + (String(item.aluno_id || '') === String(aluno.id) ? ' selected' : '') + '>' + escapeHtml(studentName(aluno)) + '</option>'; }).join('') + '</select></div>' +
                            '<div class="form-group col-md-3"><label>Turma</label><input type="text" class="form-control" id="nota-turma" value="' + escapeHtml(item.turma || '') + '"></div>' +
                            '<div class="form-group col-md-3"><label>Ano letivo</label><input type="number" class="form-control" id="nota-ano" value="' + escapeHtml(item.ano_letivo || new Date().getFullYear()) + '"></div>' +
                            '<div class="form-group col-md-4"><label>Período</label><input type="text" class="form-control" id="nota-periodo" value="' + escapeHtml(item.periodo_letivo || '') + '" placeholder="1º Bimestre"></div>' +
                            '<div class="form-group col-md-5"><label>Disciplina</label><select class="form-control" id="nota-disciplina"><option value="">Selecione</option>' + disciplinas.map(function (disc) { return '<option value="' + escapeHtml(disc.nome) + '"' + (String(item.disciplina_nome || '') === String(disc.nome) ? ' selected' : '') + ' data-id="' + escapeHtml(disc.id) + '">' + escapeHtml(disc.nome) + '</option>'; }).join('') + '</select></div>' +
                            '<div class="form-group col-md-3"><label>Tipo</label><select class="form-control" id="nota-tipo"><option' + ((item.tipo_avaliacao || 'REGULAR') === 'REGULAR' ? ' selected' : '') + '>REGULAR</option><option' + (item.tipo_avaliacao === 'RECUPERACAO' ? ' selected' : '') + '>RECUPERACAO</option><option' + (item.tipo_avaliacao === 'CONSELHO' ? ' selected' : '') + '>CONSELHO</option></select></div>' +
                            '<div class="form-group col-md-3"><label>Nota</label><input type="number" step="0.01" class="form-control" id="nota-valor" value="' + escapeHtml(item.nota == null ? '' : item.nota) + '"></div>' +
                            '<div class="form-group col-md-3"><label>Frequência %</label><input type="number" step="0.01" class="form-control" id="nota-frequencia" value="' + escapeHtml(item.frequencia == null ? '' : item.frequencia) + '"></div>' +
                            '<div class="form-group col-md-3"><label>Faltas</label><input type="number" class="form-control" id="nota-faltas" value="' + escapeHtml(item.faltas || 0) + '"></div>' +
                            '<div class="form-group col-md-3"><label>Status</label><select class="form-control" id="nota-status"><option' + ((item.status || 'LANÇADO') === 'LANÇADO' ? ' selected' : '') + '>LANÇADO</option><option' + (item.status === 'HOMOLOGADO' ? ' selected' : '') + '>HOMOLOGADO</option></select></div>' +
                            '<div class="form-group col-md-3"><label>Recuperação</label><select class="form-control" id="nota-recuperacao"><option value="false"' + (item.recuperacao ? '' : ' selected') + '>Não</option><option value="true"' + (item.recuperacao ? ' selected' : '') + '>Sim</option></select></div>' +
                            '<div class="form-group col-12"><label>Parecer descritivo</label><textarea class="form-control" id="nota-parecer" rows="3">' + escapeHtml(item.parecer_descritivo || '') + '</textarea></div>' +
                        '</div>',
                        '<button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Cancelar</button><button type="button" class="btn btn-primary" id="btn-salvar-nota">Salvar lançamento</button>'
                    );
                    q('#btn-salvar-nota').onclick = function () {
                        var discSelect = q('#nota-disciplina');
                        var selected = discSelect.options[discSelect.selectedIndex];
                        var payload = {
                            aluno_id: Number(q('#nota-aluno').value || 0),
                            turma: q('#nota-turma').value,
                            ano_letivo: Number(q('#nota-ano').value || 0),
                            periodo_letivo: q('#nota-periodo').value,
                            disciplina_id: selected ? Number(selected.getAttribute('data-id') || '') || null : null,
                            disciplina_nome: discSelect.value,
                            tipo_avaliacao: q('#nota-tipo').value,
                            nota: q('#nota-valor').value,
                            frequencia: q('#nota-frequencia').value,
                            faltas: Number(q('#nota-faltas').value || 0),
                            recuperacao: q('#nota-recuperacao').value === 'true',
                            parecer_descritivo: q('#nota-parecer').value,
                            status: q('#nota-status').value
                        };
                        postJson('/api/escolas/' + state.schoolId + '/notas-componentes' + (item.id ? '/' + item.id : ''), payload, item.id ? 'PUT' : 'POST')
                            .then(function () { if (window.jQuery) window.jQuery('#academic-modal').modal('hide'); loadNotas(); })
                            .catch(function (error) { window.alert(error.message || 'Falha ao salvar lançamento.'); });
                    };
                }
                q('#btn-nova-nota').onclick = function () { openNotasModal(null); };
                qa('.nota-editar').forEach(function (button) {
                    button.onclick = function () {
                        var item = itens.find(function (row) { return String(row.id) === String(button.getAttribute('data-id')); });
                        openNotasModal(item);
                    };
                });
            });
        }
        loadNotas();
    }

    function renderTransferenciasPage() {
        renderStats([
            { label: 'Internas pendentes', value: state.overview.transferencias_internas.pendentes || 0 },
            { label: 'Externas pendentes', value: state.overview.transferencias_externas.pendentes || 0 },
            { label: 'Ocorrências abertas', value: state.overview.ocorrencias.abertas || 0 },
            { label: 'Matrículas ativas', value: state.overview.matriculas.ativas || 0 }
        ]);
        q('#page-filters').innerHTML =
            '<div class="d-flex align-items-center justify-content-between flex-wrap">' +
                '<div class="text-muted mb-2">As transferências internas continuam disponíveis no cadastro do aluno dentro da página de alunos da unidade.</div>' +
                '<div class="mb-2">' +
                    '<a href="' + window.EscolaContexto.montarUrlModulo(state.schoolId, 'alunos') + '" class="btn btn-outline-primary btn-sm mr-2">Abrir transferências internas</a>' +
                    '<button class="btn btn-primary btn-sm" id="btn-nova-transferencia-externa">Nova transferência externa</button>' +
                '</div>' +
            '</div>';

        fetchJson('/api/escolas/' + state.schoolId + '/transferencias-externas').then(function (items) {
            state.transferenciasExternas = items || [];
            var rows = state.transferenciasExternas.map(function (item) {
                return '<tr>' +
                    '<td><strong>' + escapeHtml(item.pessoa_nome || 'Sem nome') + '</strong><div class="small text-muted">Matrícula ' + escapeHtml(item.id_pessoa || 'N/I') + '</div></td>' +
                    '<td>' + escapeHtml(item.escola_destino_nome || 'Não informado') + '<div class="small text-muted">' + escapeHtml([item.rede_destino, item.municipio_destino, item.uf_destino].filter(Boolean).join(' / ') || 'Destino sem detalhamento') + '</div></td>' +
                    '<td>' + badge(item.status || 'SOLICITADA', normalizeStatusTone(item.status)) + '</td>' +
                    '<td>' + escapeHtml(item.protocolo || 'N/I') + '</td>' +
                    '<td>' + formatDate(item.criado_em) + '</td>' +
                    '<td class="text-right">' +
                        '<button class="btn btn-sm btn-outline-secondary acao-transferencia-pdf" data-id="' + item.id + '" data-aluno-id="' + item.aluno_id + '">Documento</button>' +
                        (item.status !== 'CONCLUIDA' ? '<button class="btn btn-sm btn-primary ml-2 acao-concluir-transferencia-externa" data-id="' + item.id + '">Concluir</button>' : '') +
                    '</td>' +
                '</tr>';
            });
            q('#page-content').innerHTML = renderTable(['Aluno', 'Destino', 'Status', 'Protocolo', 'Data', 'Ações'], rows, 'Nenhuma transferência externa registrada.');
            qa('.acao-transferencia-pdf').forEach(function (button) {
                button.onclick = function () {
                    openPdf('/api/escolas/' + state.schoolId + '/alunos/' + button.getAttribute('data-aluno-id') + '/transferencias-externas/' + button.getAttribute('data-id') + '/autorizacao-pdf');
                };
            });
            qa('.acao-concluir-transferencia-externa').forEach(function (button) {
                button.onclick = function () {
                    var codigo = window.prompt('Digite o código de validação do documento assinado:');
                    if (!codigo) return;
                    postJson('/api/escolas/' + state.schoolId + '/transferencias-externas/' + button.getAttribute('data-id') + '/concluir', { codigo_validacao: codigo })
                        .then(function () { window.location.reload(); })
                        .catch(function (error) { window.alert(error.message || 'Falha ao concluir transferência externa.'); });
                };
            });
        });

        q('#btn-nova-transferencia-externa').onclick = function () {
            showModal(
                'Nova transferência externa',
                'Solicitação com protocolo, PDF e código de validação.',
                '<div class="form-row">' +
                    '<div class="form-group col-md-6"><label>Aluno</label><select class="form-control" id="transfer-ext-aluno"><option value="">Selecione</option>' +
                        state.alunos.map(function (aluno) { return '<option value="' + escapeHtml(aluno.id) + '">' + escapeHtml(studentName(aluno)) + ' • ' + escapeHtml(aluno.turma_escola || aluno.turma || 'Sem turma') + '</option>'; }).join('') +
                    '</select></div>' +
                    '<div class="form-group col-md-6"><label>Escola de destino</label><input class="form-control" id="transfer-ext-destino" type="text"></div>' +
                    '<div class="form-group col-md-4"><label>Rede destino</label><input class="form-control" id="transfer-ext-rede" type="text"></div>' +
                    '<div class="form-group col-md-4"><label>Município</label><input class="form-control" id="transfer-ext-municipio" type="text"></div>' +
                    '<div class="form-group col-md-4"><label>UF</label><input class="form-control" id="transfer-ext-uf" type="text"></div>' +
                    '<div class="form-group col-md-4"><label>Responsável</label><input class="form-control" id="transfer-ext-responsavel" type="text"></div>' +
                    '<div class="form-group col-md-4"><label>Documento</label><input class="form-control" id="transfer-ext-documento" type="text"></div>' +
                    '<div class="form-group col-md-4"><label>Parentesco</label><input class="form-control" id="transfer-ext-parentesco" type="text"></div>' +
                    '<div class="form-group col-md-6"><label>Telefone</label><input class="form-control" id="transfer-ext-telefone" type="text"></div>' +
                    '<div class="form-group col-md-6"><label>E-mail</label><input class="form-control" id="transfer-ext-email" type="email"></div>' +
                    '<div class="form-group col-12"><label>Motivo</label><textarea class="form-control" id="transfer-ext-motivo" rows="3"></textarea></div>' +
                '</div>',
                '<button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Cancelar</button><button type="button" class="btn btn-primary" id="btn-salvar-transferencia-externa">Gerar autorização</button>'
            );
            q('#btn-salvar-transferencia-externa').onclick = function () {
                var alunoId = q('#transfer-ext-aluno').value;
                postJson('/api/escolas/' + state.schoolId + '/alunos/' + alunoId + '/transferencias-externas', {
                    escola_destino_nome: q('#transfer-ext-destino').value,
                    rede_destino: q('#transfer-ext-rede').value,
                    municipio_destino: q('#transfer-ext-municipio').value,
                    uf_destino: q('#transfer-ext-uf').value,
                    responsavel_nome: q('#transfer-ext-responsavel').value,
                    responsavel_documento: q('#transfer-ext-documento').value,
                    responsavel_parentesco: q('#transfer-ext-parentesco').value,
                    responsavel_telefone: q('#transfer-ext-telefone').value,
                    responsavel_email: q('#transfer-ext-email').value,
                    motivo: q('#transfer-ext-motivo').value
                }).then(function (payload) {
                    if (window.jQuery) window.jQuery('#academic-modal').modal('hide');
                    openPdf(payload.pdf_url);
                    window.location.reload();
                }).catch(function (error) {
                    window.alert(error.message || 'Falha ao registrar transferência externa.');
                });
            };
        };
    }

    function renderHistoricoPage() {
        renderStats([
            { label: 'Alunos', value: state.alunos.length },
            { label: 'Ocorrências abertas', value: state.overview.ocorrencias.abertas || 0 },
            { label: 'Transferências pendentes', value: (state.overview.transferencias_internas.pendentes || 0) + (state.overview.transferencias_externas.pendentes || 0) },
            { label: 'Componentes lançados', value: state.overview.avaliacoes.lancamentos || 0 }
        ]);
        q('#page-filters').innerHTML = '<div class="text-muted">Clique em um aluno para visualizar a linha do tempo formal e emitir o histórico escolar.</div>';
        var rows = state.alunos.map(function (aluno) {
            return '<tr>' +
                '<td><strong>' + escapeHtml(studentName(aluno)) + '</strong><div class="small text-muted">Matrícula ' + escapeHtml(aluno.id_pessoa || 'N/I') + '</div></td>' +
                '<td>' + escapeHtml(aluno.turma_escola || aluno.turma || 'Não informada') + '</td>' +
                '<td>' + escapeHtml(aluno.ano_letivo || 'N/I') + '</td>' +
                '<td>' + badge(aluno.status || 'Ativo', normalizeStatusTone(aluno.status)) + '</td>' +
                '<td class="text-right"><button class="btn btn-sm btn-outline-primary acao-ver-historico" data-id="' + aluno.id + '">Ver histórico</button><button class="btn btn-sm btn-primary ml-2 acao-pdf-historico" data-id="' + aluno.id + '">PDF</button></td>' +
            '</tr>';
        });
        q('#page-content').innerHTML = renderTable(['Aluno', 'Turma', 'Ano', 'Status', 'Ações'], rows, 'Nenhum aluno disponível.');
        qa('.acao-pdf-historico').forEach(function (button) {
            button.onclick = function () {
                openPdf('/api/escolas/' + state.schoolId + '/alunos/' + button.getAttribute('data-id') + '/historico-escolar-pdf');
            };
        });
        qa('.acao-ver-historico').forEach(function (button) {
            button.onclick = function () {
                var alunoId = button.getAttribute('data-id');
                fetchJson('/api/escolas/' + state.schoolId + '/alunos/' + alunoId + '/historico-escolar').then(function (data) {
                    var body = '<div class="row mb-3">' +
                        '<div class="col-md-3"><div class="border rounded p-3"><div class="small text-muted">Vínculos</div><div class="h4 mb-0">' + escapeHtml(data.resumo.total_vinculos || 0) + '</div></div></div>' +
                        '<div class="col-md-3"><div class="border rounded p-3"><div class="small text-muted">Ocorrências abertas</div><div class="h4 mb-0">' + escapeHtml(data.resumo.ocorrencias_abertas || 0) + '</div></div></div>' +
                        '<div class="col-md-3"><div class="border rounded p-3"><div class="small text-muted">Componentes</div><div class="h4 mb-0">' + escapeHtml(data.resumo.componentes_lancados || 0) + '</div></div></div>' +
                        '<div class="col-md-3"><div class="border rounded p-3"><div class="small text-muted">Anos letivos</div><div class="h6 mb-0">' + escapeHtml((data.resumo.anos_letivos || []).join(', ') || 'N/I') + '</div></div></div>' +
                    '</div>' +
                    '<h6 class="mb-3">Rendimento por disciplina</h6>' +
                    ((data.rendimento_disciplinas || []).length ? '<div class="table-responsive mb-3"><table class="table table-hover"><thead><tr><th>Ano</th><th>Período</th><th>Disciplina</th><th>Nota</th><th>Frequência</th><th>Faltas</th></tr></thead><tbody>' + (data.rendimento_disciplinas || []).map(function (item) {
                        return '<tr><td>' + escapeHtml(item.ano_letivo || 'N/I') + '</td><td>' + escapeHtml(item.periodo_letivo || 'N/I') + '</td><td><strong>' + escapeHtml(item.disciplina_nome || 'Disciplina') + '</strong></td><td>' + escapeHtml(item.media == null ? 'N/I' : item.media) + '</td><td>' + escapeHtml(item.frequencia == null ? 'N/I' : item.frequencia + '%') + '</td><td>' + escapeHtml(item.faltas || 0) + '</td></tr>';
                    }).join('') + '</tbody></table></div>' : '<div class="text-muted mb-3">Sem lançamentos por disciplina.</div>') +
                    '<h6 class="mb-3">Linha do tempo</h6>' +
                    (data.linha_do_tempo || []).map(function (item) {
                        return '<div class="border rounded p-3 mb-2"><div class="d-flex justify-content-between"><strong>' + escapeHtml(item.titulo || item.tipo) + '</strong><span class="text-muted small">' + escapeHtml(formatDateTime(item.criado_em)) + '</span></div><div class="small text-muted mt-1">' + escapeHtml(item.descricao || 'Sem detalhes') + '</div></div>';
                    }).join('');
                    showModal('Histórico escolar', data.aluno && data.aluno.pessoa_nome ? data.aluno.pessoa_nome : 'Aluno', body);
                });
            };
        });
    }

    function renderDocumentosPage() {
        renderStats([
            { label: 'Alunos aptos', value: state.alunos.length },
            { label: 'Turmas disponíveis', value: state.turmas.length },
            { label: 'Documentos escolares', value: 5 },
            { label: 'Atas por turma', value: state.turmas.length }
        ]);
        q('#page-filters').innerHTML =
            '<div class="form-row align-items-end">' +
                '<div class="col-md-4"><label>Turma para ata</label><select class="form-control" id="ata-turma"><option value="">Selecione</option>' +
                    state.turmas.map(function (turma) { return '<option value="' + escapeHtml(turma.nome || turma.turma || '') + '">' + escapeHtml((turma.nome || turma.turma || 'Turma') + ' • ' + (turma.ano_letivo || 'N/I')) + '</option>'; }).join('') +
                '</select></div>' +
                '<div class="col-md-3"><label>Ano letivo</label><input type="number" class="form-control" id="ata-ano-letivo" value="' + (new Date().getFullYear()) + '"></div>' +
                '<div class="col-md-5"><button class="btn btn-outline-primary btn-block" id="btn-emitir-ata">Emitir ata de turma</button></div>' +
            '</div>';
        q('#btn-emitir-ata').onclick = function () {
            var turma = q('#ata-turma').value;
            var ano = q('#ata-ano-letivo').value;
            if (!turma) return window.alert('Selecione a turma.');
            openPdf('/api/escolas/' + state.schoolId + '/documentos/ata-turma-pdf?turma=' + encodeURIComponent(turma) + '&ano_letivo=' + encodeURIComponent(ano));
        };

        var rows = state.alunos.map(function (aluno) {
            var base = '/api/escolas/' + state.schoolId + '/alunos/' + aluno.id;
            return '<tr>' +
                '<td><strong>' + escapeHtml(studentName(aluno)) + '</strong><div class="small text-muted">Turma ' + escapeHtml(aluno.turma_escola || aluno.turma || 'N/I') + '</div></td>' +
                '<td class="text-right">' +
                    '<button class="btn btn-sm btn-outline-secondary doc-btn" data-url="' + base + '/atestado-matricula-pdf">Atestado</button> ' +
                    '<button class="btn btn-sm btn-outline-secondary doc-btn" data-url="' + base + '/declaracao-escolar-pdf">Declaração</button> ' +
                    '<button class="btn btn-sm btn-outline-secondary doc-btn" data-url="' + base + '/ficha-matricula-pdf">Ficha</button> ' +
                    '<button class="btn btn-sm btn-outline-primary doc-btn" data-url="' + base + '/historico-escolar-pdf">Histórico</button> ' +
                    '<button class="btn btn-sm btn-primary doc-btn" data-url="' + base + '/boletim-pdf">Boletim</button>' +
                '</td>' +
            '</tr>';
        });
        q('#page-content').innerHTML = renderTable(['Aluno', 'Documentos'], rows, 'Nenhum aluno disponível para emissão.');
        qa('.doc-btn').forEach(function (button) {
            button.onclick = function () { openPdf(button.getAttribute('data-url')); };
        });
    }

    function renderOcorrenciasPage() {
        renderStats([
            { label: 'Ocorrências totais', value: state.overview.ocorrencias.total || 0 },
            { label: 'Em aberto', value: state.overview.ocorrencias.abertas || 0 },
            { label: 'Alta gravidade', value: state.overview.ocorrencias.altas || 0 },
            { label: 'Alunos monitorados', value: state.alunos.length }
        ]);
        q('#page-filters').innerHTML =
            '<div class="d-flex align-items-center justify-content-between flex-wrap">' +
                '<div class="text-muted mb-2">Registre ocorrências acadêmicas, disciplinares, administrativas e de apoio escolar.</div>' +
                '<button class="btn btn-primary btn-sm mb-2" id="btn-nova-ocorrencia">Nova ocorrência</button>' +
            '</div>';

        function loadOcorrencias() {
            fetchJson('/api/escolas/' + state.schoolId + '/ocorrencias').then(function (items) {
                state.ocorrencias = items || [];
                var rows = state.ocorrencias.map(function (item) {
                    return '<tr>' +
                        '<td><strong>' + escapeHtml(item.titulo || 'Sem título') + '</strong><div class="small text-muted">' + escapeHtml(item.categoria || 'Sem categoria') + ' • ' + escapeHtml(item.subcategoria || 'Sem subcategoria') + '</div></td>' +
                        '<td>' + escapeHtml(item.pessoa_nome || 'Aluno não encontrado') + '</td>' +
                        '<td>' + badge(item.gravidade || 'MEDIA', normalizeStatusTone(item.gravidade)) + '</td>' +
                        '<td>' + badge(item.status || 'ABERTA', normalizeStatusTone(item.status)) + '</td>' +
                        '<td>' + formatDate(item.data_ocorrencia) + '</td>' +
                        '<td class="text-right"><button class="btn btn-sm btn-outline-primary ocorrencia-editar" data-id="' + item.id + '">Editar</button><button class="btn btn-sm btn-outline-danger ml-2 ocorrencia-excluir" data-id="' + item.id + '">Excluir</button></td>' +
                    '</tr>';
                });
                q('#page-content').innerHTML = renderTable(['Ocorrência', 'Aluno', 'Gravidade', 'Status', 'Data', 'Ações'], rows, 'Nenhuma ocorrência registrada.');
                qa('.ocorrencia-editar').forEach(function (button) {
                    button.onclick = function () {
                        var item = state.ocorrencias.find(function (row) { return String(row.id) === String(button.getAttribute('data-id')); });
                        openOccurrenceModal(item);
                    };
                });
                qa('.ocorrencia-excluir').forEach(function (button) {
                    button.onclick = function () {
                        if (!window.confirm('Deseja excluir esta ocorrência?')) return;
                        fetchJson('/api/escolas/' + state.schoolId + '/ocorrencias/' + button.getAttribute('data-id'), { method: 'DELETE' }).then(loadOcorrencias);
                    };
                });
            });
        }

        function openOccurrenceModal(item) {
            item = item || {};
            showModal(
                item.id ? 'Editar ocorrência' : 'Nova ocorrência',
                'Registro acadêmico com classificação, status e providências.',
                '<div class="form-row">' +
                    '<div class="form-group col-md-6"><label>Aluno</label><select class="form-control" id="oc-aluno"><option value="">Selecione</option>' + state.alunos.map(function (aluno) {
                        return '<option value="' + escapeHtml(aluno.id) + '"' + (String(item.aluno_id || '') === String(aluno.id) ? ' selected' : '') + '>' + escapeHtml(studentName(aluno)) + '</option>';
                    }).join('') + '</select></div>' +
                    '<div class="form-group col-md-3"><label>Ano letivo</label><input class="form-control" id="oc-ano" type="number" value="' + escapeHtml(item.ano_letivo || new Date().getFullYear()) + '"></div>' +
                    '<div class="form-group col-md-3"><label>Turma</label><input class="form-control" id="oc-turma" type="text" value="' + escapeHtml(item.turma || '') + '"></div>' +
                    '<div class="form-group col-md-4"><label>Categoria</label><input class="form-control" id="oc-categoria" type="text" value="' + escapeHtml(item.categoria || '') + '"></div>' +
                    '<div class="form-group col-md-4"><label>Subcategoria</label><input class="form-control" id="oc-subcategoria" type="text" value="' + escapeHtml(item.subcategoria || '') + '"></div>' +
                    '<div class="form-group col-md-2"><label>Gravidade</label><select class="form-control" id="oc-gravidade"><option>BAIXA</option><option' + (item.gravidade === 'MEDIA' ? ' selected' : '') + '>MEDIA</option><option' + (item.gravidade === 'ALTA' ? ' selected' : '') + '>ALTA</option></select></div>' +
                    '<div class="form-group col-md-2"><label>Status</label><select class="form-control" id="oc-status"><option>ABERTA</option><option' + (item.status === 'EM_ANDAMENTO' ? ' selected' : '') + '>EM_ANDAMENTO</option><option' + (item.status === 'FECHADA' ? ' selected' : '') + '>FECHADA</option></select></div>' +
                    '<div class="form-group col-md-8"><label>Título</label><input class="form-control" id="oc-titulo" type="text" value="' + escapeHtml(item.titulo || '') + '"></div>' +
                    '<div class="form-group col-md-4"><label>Data</label><input class="form-control" id="oc-data" type="date" value="' + escapeHtml(item.data_ocorrencia ? String(item.data_ocorrencia).slice(0, 10) : new Date().toISOString().slice(0, 10)) + '"></div>' +
                    '<div class="form-group col-12"><label>Descrição</label><textarea class="form-control" id="oc-descricao" rows="3">' + escapeHtml(item.descricao || '') + '</textarea></div>' +
                    '<div class="form-group col-md-6"><label>Providências</label><textarea class="form-control" id="oc-providencias" rows="3">' + escapeHtml(item.providencias || '') + '</textarea></div>' +
                    '<div class="form-group col-md-6"><label>Encaminhamento</label><textarea class="form-control" id="oc-encaminhamento" rows="3">' + escapeHtml(item.encaminhamento || '') + '</textarea></div>' +
                '</div>',
                '<button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Cancelar</button><button type="button" class="btn btn-primary" id="btn-salvar-ocorrencia">Salvar ocorrência</button>'
            );
            q('#btn-salvar-ocorrencia').onclick = function () {
                var payload = {
                    aluno_id: Number(q('#oc-aluno').value),
                    ano_letivo: Number(q('#oc-ano').value),
                    turma: q('#oc-turma').value,
                    categoria: q('#oc-categoria').value,
                    subcategoria: q('#oc-subcategoria').value,
                    gravidade: q('#oc-gravidade').value,
                    status: q('#oc-status').value,
                    titulo: q('#oc-titulo').value,
                    data_ocorrencia: q('#oc-data').value,
                    descricao: q('#oc-descricao').value,
                    providencias: q('#oc-providencias').value,
                    encaminhamento: q('#oc-encaminhamento').value
                };
                var method = item.id ? 'PUT' : 'POST';
                var url = '/api/escolas/' + state.schoolId + '/ocorrencias' + (item.id ? '/' + item.id : '');
                postJson(url, payload, method).then(function () {
                    if (window.jQuery) window.jQuery('#academic-modal').modal('hide');
                    loadOcorrencias();
                }).catch(function (error) {
                    window.alert(error.message || 'Falha ao salvar ocorrência.');
                });
            };
        }

        q('#btn-nova-ocorrencia').onclick = function () { openOccurrenceModal(null); };
        loadOcorrencias();
    }

    function renderRelatoriosPage() {
        q('#page-filters').innerHTML =
            '<div class="form-row align-items-end">' +
                '<div class="col-md-3"><label>Ano letivo</label><input type="number" class="form-control" id="relatorio-ano" value="' + (new Date().getFullYear()) + '"></div>' +
                '<div class="col-md-3"><button class="btn btn-outline-primary btn-block" id="btn-atualizar-relatorios">Atualizar relatórios</button></div>' +
            '</div>';

        function loadReports() {
            var ano = q('#relatorio-ano').value;
            fetchJson('/api/escolas/' + state.schoolId + '/relatorios-academicos?ano_letivo=' + encodeURIComponent(ano)).then(function (data) {
                renderStats([
                    { label: 'Matrículas ativas', value: data.overview.matriculas.ativas || 0 },
                    { label: 'Ocorrências abertas', value: data.overview.ocorrencias.abertas || 0 },
                    { label: 'Transf. pendentes', value: (data.overview.transferencias_internas.pendentes || 0) + (data.overview.transferencias_externas.pendentes || 0) },
                    { label: 'Rematrículas previstas', value: data.overview.rematriculas.previstas || 0 }
                ]);
                var porTurmaRows = (data.por_turma || []).map(function (item) {
                    return '<tr><td><strong>' + escapeHtml(item.turma) + '</strong></td><td>' + escapeHtml(item.total) + '</td><td>' + escapeHtml(item.transporte) + '</td><td>' + escapeHtml(item.deficiencia) + '</td></tr>';
                });
                var etapasHtml = Object.entries(data.distribuicoes.etapas || {}).map(function (entry) {
                    return '<div class="border rounded p-3 mb-2"><strong>' + escapeHtml(entry[0]) + '</strong><div class="small text-muted">' + escapeHtml(entry[1]) + ' aluno(s)</div></div>';
                }).join('');
                var statusHtml = Object.entries(data.distribuicoes.status || {}).map(function (entry) {
                    return '<div class="border rounded p-3 mb-2"><strong>' + escapeHtml(entry[0]) + '</strong><div class="small text-muted">' + escapeHtml(entry[1]) + ' aluno(s)</div></div>';
                }).join('');
                var disciplinasRows = (data.rendimento_por_disciplina || []).map(function (item) {
                    return '<tr><td><strong>' + escapeHtml(item.disciplina) + '</strong></td><td>' + escapeHtml(item.total_lancamentos) + '</td><td>' + escapeHtml(item.media_nota == null ? 'N/I' : item.media_nota) + '</td><td>' + escapeHtml(item.media_frequencia == null ? 'N/I' : item.media_frequencia + '%') + '</td><td>' + escapeHtml(item.faltas || 0) + '</td></tr>';
                });
                var conselhosHtml = (data.conselhos || []).map(function (item) {
                    return '<div class="border rounded p-3 mb-2"><strong>' + escapeHtml(item.turma || 'Geral') + '</strong><div class="small text-muted">' + escapeHtml(item.periodo_letivo || 'Período') + ' • ' + escapeHtml(item.status || 'N/I') + ' • ' + escapeHtml(formatDate(item.data_reuniao)) + '</div></div>';
                }).join('');
                var fechamentosHtml = (data.fechamentos || []).map(function (item) {
                    return '<div class="border rounded p-3 mb-2"><strong>' + escapeHtml(item.periodo_letivo || 'Período') + '</strong><div class="small text-muted">' + escapeHtml(item.turma || 'Geral') + ' • ' + escapeHtml(item.status || 'N/I') + '</div><div class="small text-muted">Aprov.: ' + escapeHtml(item.total_aprovados || 0) + ' • Reprov.: ' + escapeHtml(item.total_reprovados || 0) + ' • Abandono: ' + escapeHtml(item.total_abandono || 0) + '</div></div>';
                }).join('');
                q('#page-content').innerHTML =
                    '<div class="row">' +
                        '<div class="col-lg-7 mb-4"><div class="card shadow h-100"><div class="card-header"><strong>Relatório por turma</strong></div><div class="card-body">' +
                            renderTable(['Turma', 'Total', 'Transporte', 'Deficiência'], porTurmaRows, 'Nenhuma turma encontrada.') +
                        '</div></div></div>' +
                        '<div class="col-lg-5 mb-4"><div class="card shadow mb-4"><div class="card-header"><strong>Distribuição por etapa</strong></div><div class="card-body">' + (etapasHtml || '<div class="text-muted">Sem dados.</div>') + '</div></div>' +
                        '<div class="card shadow"><div class="card-header"><strong>Distribuição por status</strong></div><div class="card-body">' + (statusHtml || '<div class="text-muted">Sem dados.</div>') + '</div></div></div>' +
                        '<div class="col-12 mb-4"><div class="card shadow"><div class="card-header"><strong>Rendimento por disciplina</strong></div><div class="card-body">' +
                            renderTable(['Disciplina', 'Lançamentos', 'Média', 'Freq. média', 'Faltas'], disciplinasRows, 'Sem lançamentos por disciplina.') +
                        '</div></div></div>' +
                        '<div class="col-lg-6 mb-4"><div class="card shadow"><div class="card-header"><strong>Conselho de classe</strong></div><div class="card-body">' + (conselhosHtml || '<div class="text-muted">Nenhum conselho registrado.</div>') + '</div></div></div>' +
                        '<div class="col-lg-6 mb-4"><div class="card shadow"><div class="card-header"><strong>Fechamentos de período</strong></div><div class="card-body">' + (fechamentosHtml || '<div class="text-muted">Nenhum fechamento registrado.</div>') + '</div></div></div>' +
                    '</div>';
            });
        }
        q('#btn-atualizar-relatorios').onclick = loadReports;
        loadReports();
    }

    function renderConselhoPage() {
        renderStats([
            { label: 'Conselhos', value: state.overview.conselho_classe.total || 0 },
            { label: 'Concluídos', value: state.overview.conselho_classe.concluidos || 0 },
            { label: 'Ocorrências abertas', value: state.overview.ocorrencias.abertas || 0 },
            { label: 'Turmas', value: state.turmas.length }
        ]);
        q('#page-filters').innerHTML =
            '<div class="d-flex align-items-center justify-content-between flex-wrap">' +
                '<div class="text-muted mb-2">Organize as pautas, consolide deliberações e identifique os estudantes em atenção pedagógica.</div>' +
                '<button class="btn btn-primary btn-sm mb-2" id="btn-novo-conselho">Novo conselho</button>' +
            '</div>';
        function loadConselho() {
            fetchJson('/api/escolas/' + state.schoolId + '/conselho-classe?ano_letivo=' + encodeURIComponent(new Date().getFullYear())).then(function (items) {
                items = items || [];
                var rows = items.map(function (item) {
                    return '<tr><td><strong>' + escapeHtml(item.turma || 'Geral') + '</strong><div class="small text-muted">' + escapeHtml(item.periodo_letivo || 'Período') + '</div></td><td>' + escapeHtml(formatDate(item.data_reuniao)) + '</td><td>' + escapeHtml(item.coordenador_nome || 'Não informado') + '</td><td>' + badge(item.status || 'PLANEJADO', normalizeStatusTone(item.status)) + '</td><td class="text-right"><button class="btn btn-sm btn-outline-primary conselho-editar" data-id="' + item.id + '">Editar</button></td></tr>';
                });
                q('#page-content').innerHTML = renderTable(['Turma / período', 'Data', 'Coordenação', 'Status', 'Ações'], rows, 'Nenhum conselho de classe registrado.');
                function openConselhoModal(item) {
                    item = item || {};
                    showModal(
                        item.id ? 'Editar conselho de classe' : 'Novo conselho de classe',
                        'Defina pauta, deliberações, estudantes em atenção e participantes do encontro.',
                        '<div class="form-row">' +
                            '<div class="form-group col-md-4"><label>Turma</label><select class="form-control" id="conselho-turma"><option value="">Selecione</option>' + state.turmas.map(function (turma) { var value = turma.nome || turma.turma || ''; return '<option value="' + escapeHtml(value) + '"' + (String(item.turma || '') === String(value) ? ' selected' : '') + '>' + escapeHtml(value) + '</option>'; }).join('') + '</select></div>' +
                            '<div class="form-group col-md-4"><label>Período letivo</label><input type="text" class="form-control" id="conselho-periodo" value="' + escapeHtml(item.periodo_letivo || '') + '" placeholder="1º Bimestre"></div>' +
                            '<div class="form-group col-md-4"><label>Data da reunião</label><input type="date" class="form-control" id="conselho-data" value="' + escapeHtml(item.data_reuniao ? String(item.data_reuniao).slice(0, 10) : '') + '"></div>' +
                            '<div class="form-group col-md-6"><label>Coordenador / presidente</label><input type="text" class="form-control" id="conselho-coordenador" value="' + escapeHtml(item.coordenador_nome || '') + '"></div>' +
                            '<div class="form-group col-md-3"><label>Status</label><select class="form-control" id="conselho-status"><option' + ((item.status || 'PLANEJADO') === 'PLANEJADO' ? ' selected' : '') + '>PLANEJADO</option><option' + (item.status === 'REALIZADO' ? ' selected' : '') + '>REALIZADO</option><option' + (item.status === 'FECHADO' ? ' selected' : '') + '>FECHADO</option></select></div>' +
                            '<div class="form-group col-md-3"><label>Ano letivo</label><input type="number" class="form-control" id="conselho-ano" value="' + escapeHtml(item.ano_letivo || new Date().getFullYear()) + '"></div>' +
                            '<div class="form-group col-12"><label>Pauta</label><textarea class="form-control" id="conselho-pauta" rows="2">' + escapeHtml(item.pauta || '') + '</textarea></div>' +
                            '<div class="form-group col-md-6"><label>Deliberações</label><textarea class="form-control" id="conselho-deliberacoes" rows="4">' + escapeHtml(item.deliberacoes || '') + '</textarea></div>' +
                            '<div class="form-group col-md-6"><label>Encaminhamentos</label><textarea class="form-control" id="conselho-encaminhamentos" rows="4">' + escapeHtml(item.encaminhamentos || '') + '</textarea></div>' +
                            '<div class="form-group col-md-6"><label>Alunos em atenção</label><textarea class="form-control" id="conselho-alunos" rows="3" placeholder="Um nome por linha">' + escapeHtml((item.alunos_em_atencao || []).join('\n')) + '</textarea></div>' +
                            '<div class="form-group col-md-6"><label>Participantes</label><textarea class="form-control" id="conselho-participantes" rows="3" placeholder="Um nome por linha">' + escapeHtml((item.participantes || []).join('\n')) + '</textarea></div>' +
                        '</div>',
                        '<button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Cancelar</button><button type="button" class="btn btn-primary" id="btn-salvar-conselho">Salvar conselho</button>'
                    );
                    q('#btn-salvar-conselho').onclick = function () {
                        var payload = {
                            turma: q('#conselho-turma').value,
                            periodo_letivo: q('#conselho-periodo').value,
                            data_reuniao: q('#conselho-data').value,
                            coordenador_nome: q('#conselho-coordenador').value,
                            status: q('#conselho-status').value,
                            ano_letivo: Number(q('#conselho-ano').value || 0),
                            pauta: q('#conselho-pauta').value,
                            deliberacoes: q('#conselho-deliberacoes').value,
                            encaminhamentos: q('#conselho-encaminhamentos').value,
                            alunos_em_atencao: q('#conselho-alunos').value.split('\n').map(function (v) { return v.trim(); }).filter(Boolean),
                            participantes: q('#conselho-participantes').value.split('\n').map(function (v) { return v.trim(); }).filter(Boolean)
                        };
                        postJson('/api/escolas/' + state.schoolId + '/conselho-classe' + (item.id ? '/' + item.id : ''), payload, item.id ? 'PUT' : 'POST')
                            .then(function () { if (window.jQuery) window.jQuery('#academic-modal').modal('hide'); loadConselho(); })
                            .catch(function (error) { window.alert(error.message || 'Falha ao salvar conselho.'); });
                    };
                }
                q('#btn-novo-conselho').onclick = function () { openConselhoModal(null); };
                qa('.conselho-editar').forEach(function (button) {
                    button.onclick = function () {
                        var item = items.find(function (row) { return String(row.id) === String(button.getAttribute('data-id')); });
                        openConselhoModal(item);
                    };
                });
            });
        }
        loadConselho();
    }

    function renderFechamentosPage() {
        renderStats([
            { label: 'Fechamentos', value: state.overview.fechamentos.total || 0 },
            { label: 'Fechados', value: state.overview.fechamentos.fechados || 0 },
            { label: 'Nota mínima', value: state.dashboard && state.dashboard.institucional && state.dashboard.institucional.parametros ? (state.dashboard.institucional.parametros.nota_minima || 'N/I') : 'N/I' },
            { label: 'Freq. mínima', value: state.dashboard && state.dashboard.institucional && state.dashboard.institucional.parametros ? (state.dashboard.institucional.parametros.frequencia_minima || 'N/I') : 'N/I' }
        ]);
        q('#page-filters').innerHTML =
            '<div class="d-flex align-items-center justify-content-between flex-wrap">' +
                '<div class="text-muted mb-2">Formalize o encerramento do período, consolide resultados e registre situação final da turma ou da unidade.</div>' +
                '<button class="btn btn-primary btn-sm mb-2" id="btn-novo-fechamento">Novo fechamento</button>' +
            '</div>';
        function loadFechamentos() {
            fetchJson('/api/escolas/' + state.schoolId + '/fechamentos?ano_letivo=' + encodeURIComponent(new Date().getFullYear())).then(function (items) {
                items = items || [];
                var rows = items.map(function (item) {
                    return '<tr><td><strong>' + escapeHtml(item.periodo_letivo || 'Período') + '</strong><div class="small text-muted">' + escapeHtml(item.turma || 'Fechamento geral') + '</div></td><td>' + badge(item.status || 'ABERTO', normalizeStatusTone(item.status)) + '</td><td>' + escapeHtml(item.total_alunos || 0) + '</td><td>' + escapeHtml(item.total_aprovados || 0) + '</td><td>' + escapeHtml(item.total_reprovados || 0) + '</td><td>' + escapeHtml(item.total_abandono || 0) + '</td><td class="text-right"><button class="btn btn-sm btn-outline-primary fechamento-editar" data-id="' + item.id + '">Editar</button></td></tr>';
                });
                q('#page-content').innerHTML = renderTable(['Período', 'Status', 'Total', 'Aprovados', 'Reprovados', 'Abandono', 'Ações'], rows, 'Nenhum fechamento registrado.');
                function openFechamentoModal(item) {
                    item = item || {};
                    showModal(
                        item.id ? 'Editar fechamento' : 'Novo fechamento de período',
                        'Consolide resultados formais do período letivo com situação final da turma.',
                        '<div class="form-row">' +
                            '<div class="form-group col-md-4"><label>Turma</label><select class="form-control" id="fechamento-turma"><option value="">Fechamento geral</option>' + state.turmas.map(function (turma) { var value = turma.nome || turma.turma || ''; return '<option value="' + escapeHtml(value) + '"' + (String(item.turma || '') === String(value) ? ' selected' : '') + '>' + escapeHtml(value) + '</option>'; }).join('') + '</select></div>' +
                            '<div class="form-group col-md-4"><label>Período letivo</label><input type="text" class="form-control" id="fechamento-periodo" value="' + escapeHtml(item.periodo_letivo || '') + '" placeholder="1º Bimestre"></div>' +
                            '<div class="form-group col-md-4"><label>Status</label><select class="form-control" id="fechamento-status"><option' + ((item.status || 'ABERTO') === 'ABERTO' ? ' selected' : '') + '>ABERTO</option><option' + (item.status === 'EM_REVISAO' ? ' selected' : '') + '>EM_REVISAO</option><option' + (item.status === 'FECHADO' ? ' selected' : '') + '>FECHADO</option></select></div>' +
                            '<div class="form-group col-md-3"><label>Ano letivo</label><input type="number" class="form-control" id="fechamento-ano" value="' + escapeHtml(item.ano_letivo || new Date().getFullYear()) + '"></div>' +
                            '<div class="form-group col-md-3"><label>Data inicial</label><input type="date" class="form-control" id="fechamento-inicio" value="' + escapeHtml(item.data_inicio ? String(item.data_inicio).slice(0, 10) : '') + '"></div>' +
                            '<div class="form-group col-md-3"><label>Data fechamento</label><input type="date" class="form-control" id="fechamento-data" value="' + escapeHtml(item.data_fechamento ? String(item.data_fechamento).slice(0, 10) : '') + '"></div>' +
                            '<div class="form-group col-md-3"><label>Freq. mínima</label><input type="number" step="0.01" class="form-control" id="fechamento-frequencia" value="' + escapeHtml(item.frequencia_minima == null ? '' : item.frequencia_minima) + '"></div>' +
                            '<div class="form-group col-md-3"><label>Nota mínima</label><input type="number" step="0.01" class="form-control" id="fechamento-nota" value="' + escapeHtml(item.nota_minima == null ? '' : item.nota_minima) + '"></div>' +
                            '<div class="form-group col-md-3"><label>Total alunos</label><input type="number" class="form-control" id="fechamento-total" value="' + escapeHtml(item.total_alunos || 0) + '"></div>' +
                            '<div class="form-group col-md-2"><label>Aprovados</label><input type="number" class="form-control" id="fechamento-aprovados" value="' + escapeHtml(item.total_aprovados || 0) + '"></div>' +
                            '<div class="form-group col-md-2"><label>Reprovados</label><input type="number" class="form-control" id="fechamento-reprovados" value="' + escapeHtml(item.total_reprovados || 0) + '"></div>' +
                            '<div class="form-group col-md-2"><label>Transferidos</label><input type="number" class="form-control" id="fechamento-transferidos" value="' + escapeHtml(item.total_transferidos || 0) + '"></div>' +
                            '<div class="form-group col-md-2"><label>Abandono</label><input type="number" class="form-control" id="fechamento-abandono" value="' + escapeHtml(item.total_abandono || 0) + '"></div>' +
                            '<div class="form-group col-12"><label>Observações</label><textarea class="form-control" id="fechamento-observacoes" rows="3">' + escapeHtml(item.observacoes || '') + '</textarea></div>' +
                        '</div>',
                        '<button type="button" class="btn btn-outline-secondary" data-dismiss="modal">Cancelar</button><button type="button" class="btn btn-primary" id="btn-salvar-fechamento">Salvar fechamento</button>'
                    );
                    q('#btn-salvar-fechamento').onclick = function () {
                        var payload = {
                            turma: q('#fechamento-turma').value,
                            periodo_letivo: q('#fechamento-periodo').value,
                            status: q('#fechamento-status').value,
                            ano_letivo: Number(q('#fechamento-ano').value || 0),
                            data_inicio: q('#fechamento-inicio').value,
                            data_fechamento: q('#fechamento-data').value,
                            frequencia_minima: q('#fechamento-frequencia').value,
                            nota_minima: q('#fechamento-nota').value,
                            total_alunos: Number(q('#fechamento-total').value || 0),
                            total_aprovados: Number(q('#fechamento-aprovados').value || 0),
                            total_reprovados: Number(q('#fechamento-reprovados').value || 0),
                            total_transferidos: Number(q('#fechamento-transferidos').value || 0),
                            total_abandono: Number(q('#fechamento-abandono').value || 0),
                            observacoes: q('#fechamento-observacoes').value
                        };
                        postJson('/api/escolas/' + state.schoolId + '/fechamentos' + (item.id ? '/' + item.id : ''), payload, item.id ? 'PUT' : 'POST')
                            .then(function () { if (window.jQuery) window.jQuery('#academic-modal').modal('hide'); loadFechamentos(); })
                            .catch(function (error) { window.alert(error.message || 'Falha ao salvar fechamento.'); });
                    };
                }
                q('#btn-novo-fechamento').onclick = function () { openFechamentoModal(null); };
                qa('.fechamento-editar').forEach(function (button) {
                    button.onclick = function () {
                        var item = items.find(function (row) { return String(row.id) === String(button.getAttribute('data-id')); });
                        openFechamentoModal(item);
                    };
                });
            });
        }
        loadFechamentos();
    }

    function init() {
        state.page = document.body.getAttribute('data-academic-page');
        if (!state.page || !window.EscolaContexto) return;
        state.schoolId = getSchoolId();
        if (!state.schoolId) return;
        loadCore().then(function () {
            setHeader();
            if (state.page === 'matriculas') return renderMatriculasPage();
            if (state.page === 'diario-classe') return renderDiarioPage();
            if (state.page === 'notas-componentes') return renderNotasPage();
            if (state.page === 'rematriculas') return renderRematriculasPage();
            if (state.page === 'enturmacao') return renderEnturmacaoPage();
            if (state.page === 'transferencias') return renderTransferenciasPage();
            if (state.page === 'conselho-classe') return renderConselhoPage();
            if (state.page === 'fechamentos') return renderFechamentosPage();
            if (state.page === 'historico-escolar') return renderHistoricoPage();
            if (state.page === 'documentos') return renderDocumentosPage();
            if (state.page === 'ocorrencias') return renderOcorrenciasPage();
            if (state.page === 'relatorios') return renderRelatoriosPage();
        }).catch(function (error) {
            q('#page-content').innerHTML = '<div class="alert alert-danger mb-0">' + escapeHtml(error.message || 'Falha ao carregar módulo acadêmico.') + '</div>';
        });
    }

    document.addEventListener('DOMContentLoaded', init);
})();
