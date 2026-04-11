(function () {
    var RESOURCE_CONFIGS = {
        servidores: {
            title: 'Servidores',
            singular: 'Servidor',
            description: 'Equipe da rede, lotação por unidade e composição institucional por escola.',
            endpoint: '/api/institucional/servidores',
            permissionManage: 'institution.master.manage',
            emptyText: 'Nenhum servidor cadastrado.',
            stats: function (items) {
                var ativos = items.filter(function (item) { return item.ativo !== false; }).length;
                var lotacoes = items.reduce(function (acc, item) {
                    return acc + ((item.lotacoes || []).length || 0);
                }, 0);
                return [
                    { label: 'Servidores', value: items.length },
                    { label: 'Ativos', value: ativos },
                    { label: 'Lotações', value: lotacoes },
                    { label: 'Escolas cobertas', value: new Set(items.flatMap(function (item) { return (item.lotacoes || []).map(function (lot) { return lot.escola_id; }).filter(Boolean); })).size },
                ];
            },
            fields: [
                { type: 'section', label: 'Identificação funcional', description: 'Dados principais do servidor na rede municipal.' },
                { name: 'nome', label: 'Nome completo', type: 'text', required: true, col: 'col-md-8' },
                { name: 'matricula_rede', label: 'Matrícula na rede', type: 'text', col: 'col-md-2' },
                { name: 'matricula_funcional', label: 'Matrícula funcional', type: 'text', col: 'col-md-2' },
                { name: 'cargo', label: 'Cargo', type: 'text', col: 'col-md-4' },
                { name: 'funcao_principal', label: 'Função principal', type: 'text', col: 'col-md-4' },
                { name: 'area_atuacao', label: 'Área de atuação', type: 'text', col: 'col-md-4' },
                { name: 'vinculo_tipo', label: 'Vínculo', type: 'select', col: 'col-md-3', options: ['Efetivo', 'Temporário', 'Comissionado', 'Terceirizado', 'Cedência', 'Outro'] },
                { name: 'carga_horaria_semanal', label: 'Carga horária semanal', type: 'number', col: 'col-md-3' },
                { name: 'jornada_descricao', label: 'Descrição da jornada', type: 'text', col: 'col-md-3' },
                { name: 'ativo', label: 'Servidor ativo', type: 'checkbox', col: 'col-md-3' },
                { type: 'section', label: 'Documentação e dados pessoais', description: 'Identificação civil e dados básicos do servidor.' },
                { name: 'cpf', label: 'CPF', type: 'text', col: 'col-md-3' },
                { name: 'rg', label: 'RG', type: 'text', col: 'col-md-3' },
                { name: 'orgao_emissor_rg', label: 'Órgão emissor', type: 'text', col: 'col-md-3' },
                { name: 'sexo', label: 'Sexo', type: 'select', col: 'col-md-3', options: ['Masculino', 'Feminino', 'Outro', 'Prefiro não informar'] },
                { name: 'data_nascimento', label: 'Data de nascimento', type: 'date', col: 'col-md-4' },
                { name: 'escolaridade', label: 'Escolaridade', type: 'select', col: 'col-md-4', options: ['Fundamental', 'Médio', 'Técnico', 'Superior', 'Especialização', 'Mestrado', 'Doutorado'] },
                { name: 'formacao_principal', label: 'Formação principal', type: 'text', col: 'col-md-4' },
                { type: 'section', label: 'Contato e endereço', description: 'Informações para contato institucional e localização.' },
                { name: 'email', label: 'E-mail', type: 'email', col: 'col-md-4' },
                { name: 'telefone', label: 'Telefone principal', type: 'text', col: 'col-md-4' },
                { name: 'telefone_secundario', label: 'Telefone secundário', type: 'text', col: 'col-md-4' },
                { name: 'cep', label: 'CEP', type: 'text', col: 'col-md-3' },
                { name: 'logradouro', label: 'Logradouro', type: 'text', col: 'col-md-5' },
                { name: 'numero', label: 'Número', type: 'text', col: 'col-md-2' },
                { name: 'complemento', label: 'Complemento', type: 'text', col: 'col-md-2' },
                { name: 'bairro', label: 'Bairro', type: 'text', col: 'col-md-4' },
                { name: 'cidade', label: 'Cidade', type: 'text', col: 'col-md-4' },
                { name: 'uf', label: 'UF', type: 'text', col: 'col-md-4' },
                { type: 'section', label: 'Vínculo e lotação', description: 'Dados administrativos e distribuição por escola.' },
                { name: 'data_admissao', label: 'Data de admissão', type: 'date', col: 'col-md-4' },
                { name: 'data_desligamento', label: 'Data de desligamento', type: 'date', col: 'col-md-4' },
                { name: 'observacoes', label: 'Observações', type: 'textarea', col: 'col-12' },
                { name: 'lotacoes', label: 'Lotações por escola', type: 'lotacoes', col: 'col-12' },
            ],
            columns: [
                {
                    label: 'Servidor',
                    render: function (item) {
                        return '<strong>' + escapeHtml(item.nome || 'Sem nome') + '</strong>'
                            + '<p class="mb-0 text-muted">Matrícula: ' + escapeHtml(item.matricula_rede || 'N/I') + ' • CPF: ' + escapeHtml(maskCpf(item.cpf)) + '</p>'
                            + '<p class="mb-0 text-muted">' + escapeHtml(item.cargo || 'Cargo não informado') + ' • ' + escapeHtml(item.funcao_principal || 'Função não informada') + '</p>';
                    }
                },
                {
                    label: 'Contato',
                    render: function (item) {
                        return '<strong>' + escapeHtml(item.email || 'Sem e-mail') + '</strong>'
                            + '<p class="mb-0 text-muted">' + escapeHtml(item.telefone || 'Sem telefone') + '</p>';
                    }
                },
                {
                    label: 'Lotação',
                    render: function (item) {
                        var lotacoes = item.lotacoes || [];
                        if (!lotacoes.length) return '<span class="text-muted">Sem vínculo escolar</span>';
                        return lotacoes.map(function (lot) {
                            return '<div class="mb-1"><strong>' + escapeHtml(lot.escola_nome || 'SEMED') + '</strong><br><small class="text-muted">'
                                + escapeHtml(lot.funcao || 'Função não informada')
                                + (lot.carga_horaria ? ' • ' + escapeHtml(String(lot.carga_horaria)) + 'h' : '')
                                + (lot.principal ? ' • principal' : '')
                                + '</small></div>';
                        }).join('');
                    }
                },
                {
                    label: 'Status',
                    render: function (item) {
                        return badge(item.ativo !== false ? 'Ativo' : 'Inativo', item.ativo !== false ? 'success' : 'secondary');
                    }
                },
            ],
        },
        disciplinas: {
            title: 'Disciplinas',
            singular: 'Disciplina',
            description: 'Catálogo oficial de componentes curriculares da rede municipal.',
            endpoint: '/api/institucional/disciplinas',
            permissionManage: 'institution.master.manage',
            emptyText: 'Nenhuma disciplina cadastrada.',
            stats: basicStats,
            fields: [
                { type: 'section', label: 'Identificação curricular', description: 'Base oficial do componente curricular na rede.' },
                { name: 'codigo', label: 'Código', type: 'text', required: true, col: 'col-md-3' },
                { name: 'nome', label: 'Nome da disciplina', type: 'text', required: true, col: 'col-md-5' },
                { name: 'abreviacao', label: 'Abreviação', type: 'text', col: 'col-md-2' },
                { name: 'carga_horaria_padrao', label: 'Carga horária padrão (h)', type: 'number', col: 'col-md-2' },
                { name: 'area_conhecimento', label: 'Área do conhecimento', type: 'text', col: 'col-md-4' },
                { name: 'bncc_area', label: 'Área BNCC', type: 'text', col: 'col-md-4' },
                { name: 'eixo_formativo', label: 'Eixo formativo', type: 'text', col: 'col-md-4' },
                { name: 'etapa_recomendada', label: 'Etapa recomendada', type: 'text', col: 'col-md-4' },
                { name: 'sigla_censo', label: 'Sigla no censo', type: 'text', col: 'col-md-2' },
                { name: 'ordem_curricular', label: 'Ordem curricular', type: 'number', col: 'col-md-2' },
                { name: 'componente_obrigatorio', label: 'Componente obrigatório', type: 'checkbox', col: 'col-md-2' },
                { name: 'usa_nota', label: 'Usa nota', type: 'checkbox', col: 'col-md-2' },
                { name: 'ativo', label: 'Disciplina ativa', type: 'checkbox', col: 'col-md-2' },
                { name: 'observacoes', label: 'Observações pedagógicas', type: 'textarea', col: 'col-12' },
            ],
            columns: [
                { label: 'Disciplina', render: function (item) { return '<strong>' + escapeHtml(item.nome) + '</strong><p class="mb-0 text-muted">Código ' + escapeHtml(item.codigo) + ' • ' + escapeHtml(item.abreviacao || 'Sem abreviação') + '</p>'; } },
                { label: 'Área', render: function (item) { return '<strong>' + escapeHtml(item.area_conhecimento || 'Não informada') + '</strong><p class="mb-0 text-muted">' + escapeHtml(item.bncc_area || item.eixo_formativo || 'Sem referência BNCC') + '</p>'; } },
                { label: 'Currículo', render: function (item) { return '<strong>' + escapeHtml(item.etapa_recomendada || 'Etapa livre') + '</strong><p class="mb-0 text-muted">Censo: ' + escapeHtml(item.sigla_censo || 'N/I') + ' • Ordem ' + escapeHtml(String(item.ordem_curricular || 0)) + '</p>'; } },
                { label: 'Carga', render: function (item) { return '<strong>' + escapeHtml(item.carga_horaria_padrao ? String(item.carga_horaria_padrao) + 'h' : 'Não definida') + '</strong><p class="mb-0 text-muted">' + (item.componente_obrigatorio !== false ? 'Obrigatória' : 'Optativa') + ' • ' + (item.usa_nota !== false ? 'Com nota' : 'Sem nota') + '</p>'; } },
                { label: 'Status', render: function (item) { return badge(item.ativo !== false ? 'Ativa' : 'Inativa', item.ativo !== false ? 'success' : 'secondary'); } },
            ],
        },
        series: {
            title: 'Séries',
            singular: 'Série',
            description: 'Estrutura das etapas, anos e faixas etárias utilizadas pela rede.',
            endpoint: '/api/institucional/series',
            permissionManage: 'institution.master.manage',
            emptyText: 'Nenhuma série cadastrada.',
            stats: basicStats,
            fields: [
                { type: 'section', label: 'Organização da etapa', description: 'Estrutura oficial das séries, anos e etapas da rede.' },
                { name: 'codigo', label: 'Código', type: 'text', required: true, col: 'col-md-3' },
                { name: 'nome', label: 'Nome da série/ano', type: 'text', required: true, col: 'col-md-5' },
                { name: 'etapa', label: 'Etapa', type: 'select', required: true, col: 'col-md-4', options: ['Educação infantil', 'Ensino fundamental', 'Ensino médio', 'EJA', 'Educação especial'] },
                { name: 'segmento', label: 'Segmento', type: 'text', col: 'col-md-4' },
                { name: 'etapa_modalidade', label: 'Etapa/modalidade', type: 'text', col: 'col-md-4' },
                { name: 'nomenclatura_censo', label: 'Nomenclatura do censo', type: 'text', col: 'col-md-4' },
                { name: 'ordem', label: 'Ordem pedagógica', type: 'number', col: 'col-md-3' },
                { name: 'idade_minima', label: 'Idade mínima', type: 'number', col: 'col-md-3' },
                { name: 'idade_maxima', label: 'Idade máxima', type: 'number', col: 'col-md-3' },
                { name: 'idade_referencia', label: 'Idade de referência', type: 'number', col: 'col-md-3' },
                { name: 'carga_horaria_anual_horas', label: 'Carga anual prevista (h)', type: 'number', col: 'col-md-4' },
                { name: 'permite_distorcao_idade', label: 'Permite distorção idade-série', type: 'checkbox', col: 'col-md-3' },
                { name: 'usa_progressao_parcial', label: 'Usa progressão parcial', type: 'checkbox', col: 'col-md-2' },
                { name: 'ativo', label: 'Série ativa', type: 'checkbox', col: 'col-md-3' },
                { name: 'observacoes', label: 'Observações acadêmicas', type: 'textarea', col: 'col-12' },
            ],
            columns: [
                { label: 'Série', render: function (item) { return '<strong>' + escapeHtml(item.nome) + '</strong><p class="mb-0 text-muted">Código ' + escapeHtml(item.codigo) + ' • Ordem ' + escapeHtml(String(item.ordem || 0)) + '</p>'; } },
                { label: 'Etapa', render: function (item) { return '<strong>' + escapeHtml(item.etapa || 'Não informada') + '</strong><p class="mb-0 text-muted">' + escapeHtml(item.segmento || item.etapa_modalidade || 'Segmento não informado') + '</p>'; } },
                { label: 'Faixa etária', render: function (item) { return '<strong>' + escapeHtml((item.idade_minima != null ? item.idade_minima + ' anos' : 'Sem mínimo') + ' • ' + (item.idade_maxima != null ? item.idade_maxima + ' anos' : 'Sem máximo')) + '</strong><p class="mb-0 text-muted">Referência: ' + escapeHtml(item.idade_referencia != null ? item.idade_referencia + ' anos' : 'N/I') + '</p>'; } },
                { label: 'Conformidade', render: function (item) { return '<strong>' + escapeHtml(item.carga_horaria_anual_horas ? String(item.carga_horaria_anual_horas) + 'h/ano' : 'Carga não definida') + '</strong><p class="mb-0 text-muted">' + (item.permite_distorcao_idade !== false ? 'Com distorção permitida' : 'Sem distorção') + ' • ' + (item.usa_progressao_parcial ? 'Progressão parcial' : 'Sem progressão parcial') + '</p>'; } },
                { label: 'Status', render: function (item) { return badge(item.ativo !== false ? 'Ativa' : 'Inativa', item.ativo !== false ? 'success' : 'secondary'); } },
            ],
        },
        turnos: {
            title: 'Turnos',
            singular: 'Turno',
            description: 'Janela oficial de funcionamento por manhã, tarde, noite e formatos especiais.',
            endpoint: '/api/institucional/turnos',
            permissionManage: 'institution.master.manage',
            emptyText: 'Nenhum turno cadastrado.',
            stats: basicStats,
            fields: [
                { type: 'section', label: 'Janela de funcionamento', description: 'Configuração horária e operacional do turno.' },
                { name: 'codigo', label: 'Código', type: 'text', required: true, col: 'col-md-3' },
                { name: 'nome', label: 'Nome do turno', type: 'text', required: true, col: 'col-md-5' },
                { name: 'carga_horaria_minutos', label: 'Carga horária (minutos)', type: 'number', col: 'col-md-4' },
                { name: 'hora_inicio', label: 'Hora início', type: 'time', col: 'col-md-3' },
                { name: 'hora_fim', label: 'Hora fim', type: 'time', col: 'col-md-3' },
                { name: 'tolerancia_entrada_min', label: 'Tolerância entrada (min)', type: 'number', col: 'col-md-3' },
                { name: 'tolerancia_saida_min', label: 'Tolerância saída (min)', type: 'number', col: 'col-md-3' },
                { name: 'intervalo_minutos', label: 'Intervalo (min)', type: 'number', col: 'col-md-3' },
                { name: 'dias_semana', label: 'Dias de funcionamento', type: 'text', col: 'col-md-6' },
                { name: 'atendimento_sabado', label: 'Atende aos sábados', type: 'checkbox', col: 'col-md-3' },
                { name: 'ativo', label: 'Turno ativo', type: 'checkbox', col: 'col-md-3' },
                { name: 'observacoes', label: 'Observações operacionais', type: 'textarea', col: 'col-12' },
            ],
            columns: [
                { label: 'Turno', render: function (item) { return '<strong>' + escapeHtml(item.nome) + '</strong><p class="mb-0 text-muted">Código ' + escapeHtml(item.codigo) + '</p>'; } },
                { label: 'Faixa horária', render: function (item) { return '<strong>' + escapeHtml((item.hora_inicio || 'N/I') + ' → ' + (item.hora_fim || 'N/I')) + '</strong><p class="mb-0 text-muted">Intervalo: ' + escapeHtml(item.intervalo_minutos != null ? item.intervalo_minutos + ' min' : 'N/I') + '</p>'; } },
                { label: 'Carga', render: function (item) { return '<strong>' + escapeHtml(item.carga_horaria_minutos ? String(item.carga_horaria_minutos) + ' min' : 'Não definida') + '</strong><p class="mb-0 text-muted">Tol. entrada ' + escapeHtml(item.tolerancia_entrada_min != null ? item.tolerancia_entrada_min + ' min' : '0') + ' • Tol. saída ' + escapeHtml(item.tolerancia_saida_min != null ? item.tolerancia_saida_min + ' min' : '0') + '</p>'; } },
                { label: 'Funcionamento', render: function (item) { return '<strong>' + escapeHtml(Array.isArray(item.dias_semana) && item.dias_semana.length ? item.dias_semana.join(', ') : 'Dias não informados') + '</strong><p class="mb-0 text-muted">' + (item.atendimento_sabado ? 'Com atendimento aos sábados' : 'Sem atendimento aos sábados') + '</p>'; } },
                { label: 'Status', render: function (item) { return badge(item.ativo !== false ? 'Ativo' : 'Inativo', item.ativo !== false ? 'success' : 'secondary'); } },
            ],
        },
        calendarios: {
            title: 'Calendários Letivos',
            singular: 'Calendário letivo',
            description: 'Planejamento letivo por rede ou por unidade escolar, com vigência e dias previstos.',
            endpoint: '/api/institucional/calendarios',
            permissionManage: 'institution.master.manage',
            emptyText: 'Nenhum calendário letivo cadastrado.',
            stats: function (items) {
                return [
                    { label: 'Calendários', value: items.length },
                    { label: 'Em execução', value: items.filter(function (item) { return String(item.status || '').toUpperCase() === 'EM_EXECUCAO'; }).length },
                    { label: 'Por escola', value: items.filter(function (item) { return !!item.escola_id; }).length },
                    { label: 'De rede', value: items.filter(function (item) { return !item.escola_id; }).length },
                ];
            },
            fields: [
                { type: 'section', label: 'Identificação do calendário', description: 'Definição do calendário da rede ou de uma unidade específica.' },
                { name: 'nome', label: 'Nome do calendário', type: 'text', required: true, col: 'col-md-6' },
                { name: 'ano_letivo', label: 'Ano letivo', type: 'number', required: true, col: 'col-md-3' },
                { name: 'escola_id', label: 'Unidade escolar', type: 'schoolSelect', allowBlank: true, blankLabel: 'Calendário da rede (SEMED)', col: 'col-md-3' },
                { name: 'modelo_calendario', label: 'Modelo de calendário', type: 'text', col: 'col-md-4' },
                { name: 'etapa_alcance', label: 'Etapa/alcance', type: 'text', col: 'col-md-4' },
                { name: 'referencia_normativa', label: 'Referência normativa', type: 'text', col: 'col-md-4' },
                { name: 'data_inicio', label: 'Início', type: 'date', col: 'col-md-3' },
                { name: 'data_fim', label: 'Fim', type: 'date', col: 'col-md-3' },
                { name: 'dias_letivos_previstos', label: 'Dias letivos previstos', type: 'number', col: 'col-md-3' },
                { name: 'status', label: 'Status', type: 'select', col: 'col-md-3', options: ['PLANEJADO', 'EM_EXECUCAO', 'ENCERRADO'] },
                { name: 'dias_planejamento', label: 'Dias de planejamento', type: 'number', col: 'col-md-3' },
                { name: 'dias_recesso', label: 'Dias de recesso', type: 'number', col: 'col-md-3' },
                { name: 'dias_avaliacao', label: 'Dias de avaliação', type: 'number', col: 'col-md-3' },
                { name: 'dias_nao_letivos', label: 'Dias não letivos', type: 'number', col: 'col-md-3' },
                { name: 'usa_sabado_letivo', label: 'Usa sábado letivo', type: 'checkbox', col: 'col-md-3' },
                { name: 'aplica_transporte_escolar', label: 'Aplica transporte escolar', type: 'checkbox', col: 'col-md-3' },
                { name: 'observacoes', label: 'Observações', type: 'textarea', col: 'col-12' },
            ],
            columns: [
                { label: 'Calendário', render: function (item) { return '<strong>' + escapeHtml(item.nome) + '</strong><p class="mb-0 text-muted">Ano letivo ' + escapeHtml(String(item.ano_letivo || 'N/I')) + '</p>'; } },
                { label: 'Escopo', render: function (item) {
                    var school = (state.escolas || []).find(function (row) { return String(row.id) === String(item.escola_id); });
                    return escapeHtml(item.escola_nome || (school && school.nome) || 'SEMED / Rede');
                } },
                { label: 'Vigência', render: function (item) { return '<strong>' + escapeHtml((item.data_inicio || 'N/I') + ' → ' + (item.data_fim || 'N/I')) + '</strong><p class="mb-0 text-muted">' + escapeHtml(item.modelo_calendario || 'Modelo livre') + ' • ' + escapeHtml(item.etapa_alcance || 'Rede completa') + '</p>'; } },
                { label: 'Planejamento', render: function (item) { return '<strong>' + escapeHtml(item.dias_letivos_previstos ? String(item.dias_letivos_previstos) + ' dias letivos' : 'Dias não informados') + '</strong><p class="mb-0 text-muted">Planej.: ' + escapeHtml(item.dias_planejamento != null ? String(item.dias_planejamento) : '0') + ' • Recesso: ' + escapeHtml(item.dias_recesso != null ? String(item.dias_recesso) : '0') + '</p>'; } },
                { label: 'Status', render: function (item) { return badge(item.status || 'PLANEJADO', 'info'); } },
            ],
        },
        periodos: {
            title: 'Períodos Letivos',
            singular: 'Período letivo',
            description: 'Bimestres, trimestres, semestres ou ciclos vinculados a cada calendário.',
            endpoint: '/api/institucional/periodos',
            permissionManage: 'institution.master.manage',
            emptyText: 'Nenhum período letivo cadastrado.',
            stats: function (items) {
                return [
                    { label: 'Períodos', value: items.length },
                    { label: 'Abertos', value: items.filter(function (item) { return String(item.status || '').toUpperCase() === 'ABERTO'; }).length },
                    { label: 'Fechados', value: items.filter(function (item) { return String(item.status || '').toUpperCase() === 'FECHADO'; }).length },
                    { label: 'Calendários cobertos', value: new Set(items.map(function (item) { return item.calendario_id; }).filter(Boolean)).size },
                ];
            },
            fields: [
                { type: 'section', label: 'Estrutura do período', description: 'Recorte letivo e regras de fechamento pedagógico.' },
                { name: 'calendario_id', label: 'Calendário letivo', type: 'calendarSelect', required: true, col: 'col-md-5' },
                { name: 'nome', label: 'Nome do período', type: 'text', required: true, col: 'col-md-4' },
                { name: 'tipo', label: 'Tipo', type: 'select', required: true, col: 'col-md-3', options: ['BIMESTRE', 'TRIMESTRE', 'SEMESTRE', 'UNIDADE', 'MÓDULO'] },
                { name: 'ordem', label: 'Ordem', type: 'number', col: 'col-md-3' },
                { name: 'referencia_codigo', label: 'Código de referência', type: 'text', col: 'col-md-3' },
                { name: 'peso_avaliativo', label: 'Peso avaliativo', type: 'number', col: 'col-md-3' },
                { name: 'data_inicio', label: 'Início', type: 'date', col: 'col-md-3' },
                { name: 'data_fim', label: 'Fim', type: 'date', col: 'col-md-3' },
                { name: 'data_fechamento', label: 'Fechamento', type: 'date', col: 'col-md-3' },
                { name: 'status', label: 'Status', type: 'select', col: 'col-md-3', options: ['ABERTO', 'FECHADO', 'PLANEJADO'] },
                { name: 'exige_fechamento', label: 'Exige fechamento', type: 'checkbox', col: 'col-md-3' },
                { name: 'permite_lancamento_fora_periodo', label: 'Permite lançamento fora do período', type: 'checkbox', col: 'col-md-4' },
                { name: 'observacoes', label: 'Observações do período', type: 'textarea', col: 'col-12' },
            ],
            columns: [
                { label: 'Período', render: function (item) { return '<strong>' + escapeHtml(item.nome) + '</strong><p class="mb-0 text-muted">' + escapeHtml(item.tipo || 'Tipo não informado') + ' • Ordem ' + escapeHtml(String(item.ordem || 1)) + '</p>'; } },
                { label: 'Calendário', render: function (item) {
                    var calendar = (state.calendarios || []).find(function (row) { return String(row.id) === String(item.calendario_id); }) || {};
                    return '<strong>' + escapeHtml(item.calendario_nome || calendar.nome || 'Não informado') + '</strong><p class="mb-0 text-muted">' + escapeHtml(item.escola_nome || calendar.escola_nome || 'SEMED / Rede') + '</p>';
                } },
                { label: 'Vigência', render: function (item) { return '<strong>' + escapeHtml((item.data_inicio || 'N/I') + ' → ' + (item.data_fim || 'N/I')) + '</strong><p class="mb-0 text-muted">Fechamento: ' + escapeHtml(item.data_fechamento || 'N/I') + '</p>'; } },
                { label: 'Regras', render: function (item) { return '<strong>' + escapeHtml(item.referencia_codigo || 'Sem código') + '</strong><p class="mb-0 text-muted">Peso: ' + escapeHtml(item.peso_avaliativo != null ? String(item.peso_avaliativo) : 'N/I') + ' • ' + (item.exige_fechamento !== false ? 'Com fechamento' : 'Sem fechamento') + '</p>'; } },
                { label: 'Status', render: function (item) { return badge(item.status || 'ABERTO', 'info'); } },
            ],
        },
    };

    var state = {
        resourceKey: null,
        config: null,
        items: [],
        escolas: [],
        calendarios: [],
        currentEditId: null,
        overview: null,
        schoolContextId: null,
        schoolContextMode: false,
    };

    function escapeHtml(value) {
        return String(value == null ? '' : value)
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;')
            .replace(/"/g, '&quot;')
            .replace(/'/g, '&#39;');
    }

    function basicStats(items) {
        return [
            { label: 'Registros', value: items.length },
            { label: 'Ativos', value: items.filter(function (item) { return item.ativo !== false; }).length },
            { label: 'Inativos', value: items.filter(function (item) { return item.ativo === false; }).length },
            { label: 'Cobertura', value: items.length ? 'Base pronta' : 'Iniciando' },
        ];
    }

    function maskCpf(cpf) {
        var digits = String(cpf || '').replace(/\D/g, '');
        if (!digits) return '***.***.***-**';
        if (digits.length < 11) return digits;
        return digits.slice(0, 3) + '.***.***-' + digits.slice(-2);
    }

    function badge(label, tone) {
        var tones = {
            success: 'badge-success',
            secondary: 'badge-secondary',
            info: 'badge-info',
            warning: 'badge-warning',
            danger: 'badge-danger',
        };
        return '<span class="badge ' + (tones[tone] || tones.info) + '">' + escapeHtml(label) + '</span>';
    }

    function qs(selector) {
        return document.querySelector(selector);
    }

    function apiFetch(url, options) {
        return fetch(url, Object.assign({ credentials: 'include' }, options || {})).then(function (response) {
            if (!response.ok) {
                return response.json().catch(function () { return {}; }).then(function (payload) {
                    throw new Error(payload.error || 'Falha na operação.');
                });
            }
            if (response.status === 204) return null;
            return response.json();
        });
    }

    function loadCurrentUser() {
        return apiFetch('/api/me').then(function (me) {
            window.__ME = me || {};
            return me;
        }).catch(function () {
            window.__ME = window.__ME || {};
            return window.__ME;
        });
    }

    function renderHero() {
        if (!state.config) return;
        var titleEl = qs('[data-role="page-title"]');
        var descEl = qs('[data-role="page-description"]');
        var school = getSchoolContextSchool();
        if (titleEl) titleEl.textContent = state.config.title;
        if (descEl) {
            descEl.textContent = state.schoolContextMode && school
                ? ('Visão contextual da unidade ' + school.nome + '. ' + state.config.description)
                : state.config.description;
        }
    }

    function renderStats() {
        var container = qs('[data-role="stats"]');
        if (!container || !state.config) return;
        var stats = state.config.stats(state.items || []);
        container.innerHTML = stats.map(function (item) {
            return '<div class="col-md-3 mb-3">'
                + '<div class="card institutional-stat-card shadow-sm h-100"><div class="card-body">'
                + '<div class="institutional-stat-label mb-2">' + escapeHtml(item.label) + '</div>'
                + '<div class="h3 mb-0">' + escapeHtml(item.value) + '</div>'
                + '</div></div></div>';
        }).join('');
    }

    function currentSearchTerm() {
        return String((qs('#institutional-search') || {}).value || '').trim().toLowerCase();
    }

    function getSchoolContextSchool() {
        if (!state.schoolContextMode || !state.schoolContextId) return null;
        return (state.escolas || []).find(function (school) {
            return String(school.id) === String(state.schoolContextId);
        }) || null;
    }

    function applySchoolContext(items) {
        if (!state.schoolContextMode || !state.schoolContextId) return items || [];
        var escolaId = String(state.schoolContextId);

        if (state.resourceKey === 'servidores') {
            return (items || []).filter(function (item) {
                return (item.lotacoes || []).some(function (lotacao) {
                    return String(lotacao.escola_id || '') === escolaId;
                });
            });
        }

        if (state.resourceKey === 'calendarios') {
            return (items || []).filter(function (item) {
                return String(item.escola_id || '') === escolaId;
            });
        }

        if (state.resourceKey === 'periodos') {
            var calendariosPermitidos = new Set((state.calendarios || []).filter(function (calendar) {
                return String(calendar.escola_id || '') === escolaId;
            }).map(function (calendar) {
                return String(calendar.id);
            }));
            return (items || []).filter(function (item) {
                return calendariosPermitidos.has(String(item.calendario_id || ''));
            });
        }

        if (state.resourceKey === 'turmas') {
            return (items || []).filter(function (item) {
                return String(item.escola_id || '') === escolaId;
            });
        }

        return items || [];
    }

    function filterItems(items) {
        items = applySchoolContext(items);
        var term = currentSearchTerm();
        if (!term) return items;
        return items.filter(function (item) {
            return JSON.stringify(item || {}).toLowerCase().indexOf(term) !== -1;
        });
    }

    function openModal() {
        if (window.jQuery) window.jQuery('#modal-institucional-form').modal('show');
    }

    function closeModal() {
        if (window.jQuery) window.jQuery('#modal-institucional-form').modal('hide');
    }

    function renderSimpleField(field, value) {
        var col = field.col || 'col-md-6';
        if (field.type === 'section') {
            return '<div class="col-12"><div class="institutional-form-section-title mt-3 mb-2">' + escapeHtml(field.label) + '</div>'
                + (field.description ? '<p class="text-muted small mb-3">' + escapeHtml(field.description) + '</p>' : '')
                + '</div>';
        }
        if (field.type === 'textarea') {
            return '<div class="' + col + '"><div class="form-group"><label>' + escapeHtml(field.label) + '</label><textarea class="form-control" rows="3" name="' + escapeHtml(field.name) + '">' + escapeHtml(value || '') + '</textarea></div></div>';
        }
        if (field.type === 'checkbox') {
            return '<div class="' + col + ' d-flex align-items-end"><div class="custom-control custom-switch mb-3">'
                + '<input type="checkbox" class="custom-control-input" id="field-' + escapeHtml(field.name) + '" name="' + escapeHtml(field.name) + '"' + ((value !== false && value !== 'false') ? ' checked' : '') + '>'
                + '<label class="custom-control-label" for="field-' + escapeHtml(field.name) + '">' + escapeHtml(field.label) + '</label>'
                + '</div></div>';
        }
        if (field.type === 'select') {
            return '<div class="' + col + '"><div class="form-group"><label>' + escapeHtml(field.label) + '</label><select class="custom-select" name="' + escapeHtml(field.name) + '">' + field.options.map(function (option) {
                var selected = String(value || '') === String(option) ? ' selected' : '';
                return '<option value="' + escapeHtml(option) + '"' + selected + '>' + escapeHtml(option) + '</option>';
            }).join('') + '</select></div></div>';
        }
        if (field.type === 'schoolSelect') {
            var options = ['<option value="">' + escapeHtml(field.blankLabel || 'Selecione') + '</option>'].concat(state.escolas.map(function (school) {
                var selected = String(value || '') === String(school.id) ? ' selected' : '';
                return '<option value="' + escapeHtml(school.id) + '"' + selected + '>' + escapeHtml(school.nome) + '</option>';
            }));
            return '<div class="' + col + '"><div class="form-group"><label>' + escapeHtml(field.label) + '</label><select class="custom-select" name="' + escapeHtml(field.name) + '">' + options.join('') + '</select></div></div>';
        }
        if (field.type === 'calendarSelect') {
            var calendarOptions = ['<option value="">Selecione</option>'].concat(state.calendarios.map(function (calendar) {
                var label = calendar.nome + ' • ' + (calendar.escola_nome || 'SEMED') + ' • ' + calendar.ano_letivo;
                var selected = String(value || '') === String(calendar.id) ? ' selected' : '';
                return '<option value="' + escapeHtml(calendar.id) + '"' + selected + '>' + escapeHtml(label) + '</option>';
            }));
            return '<div class="' + col + '"><div class="form-group"><label>' + escapeHtml(field.label) + '</label><select class="custom-select" name="' + escapeHtml(field.name) + '">' + calendarOptions.join('') + '</select></div></div>';
        }
        if (field.type === 'lotacoes') {
            return '<div class="' + col + '"><div class="d-flex align-items-center justify-content-between mb-2"><span class="institutional-form-section-title mb-0">'
                + escapeHtml(field.label)
                + '</span><button type="button" class="btn btn-sm btn-outline-primary" id="btn-add-lotacao">Adicionar lotação</button></div>'
                + '<div id="lotacoes-repeater"></div></div>';
        }
        var inputType = field.type || 'text';
        return '<div class="' + col + '"><div class="form-group"><label>' + escapeHtml(field.label) + (field.required ? ' *' : '') + '</label><input class="form-control" type="' + escapeHtml(inputType) + '" name="' + escapeHtml(field.name) + '" value="' + escapeHtml(value || '') + '"' + (field.required ? ' required' : '') + '></div></div>';
    }

    function renderLotacaoItem(item) {
        var schoolsOptions = ['<option value="">Selecione a escola</option>'].concat(state.escolas.map(function (school) {
            var selected = String(item.escola_id || '') === String(school.id) ? ' selected' : '';
            return '<option value="' + escapeHtml(school.id) + '"' + selected + '>' + escapeHtml(school.nome) + '</option>';
        }));
        return '<div class="institutional-lotacao-item">'
            + '<div class="row">'
            + '<div class="col-md-4"><div class="form-group"><label>Escola</label><select class="custom-select" data-lotacao="escola_id">' + schoolsOptions.join('') + '</select></div></div>'
            + '<div class="col-md-3"><div class="form-group"><label>Função</label><input class="form-control" data-lotacao="funcao" value="' + escapeHtml(item.funcao || '') + '"></div></div>'
            + '<div class="col-md-2"><div class="form-group"><label>Carga horária</label><input class="form-control" type="number" data-lotacao="carga_horaria" value="' + escapeHtml(item.carga_horaria || '') + '"></div></div>'
            + '<div class="col-md-3"><div class="form-group"><label>Início da vigência</label><input class="form-control" type="date" data-lotacao="inicio_vigencia" value="' + escapeHtml(item.inicio_vigencia || '') + '"></div></div>'
            + '<div class="col-md-3"><div class="form-group"><label>Fim da vigência</label><input class="form-control" type="date" data-lotacao="fim_vigencia" value="' + escapeHtml(item.fim_vigencia || '') + '"></div></div>'
            + '<div class="col-md-3"><div class="form-group"><label>Observações</label><input class="form-control" data-lotacao="observacoes" value="' + escapeHtml(item.observacoes || '') + '"></div></div>'
            + '<div class="col-md-3 d-flex align-items-center"><div class="custom-control custom-switch mb-3">'
            + '<input type="checkbox" class="custom-control-input" id="lot-principal-' + Math.random().toString(36).slice(2) + '" data-lotacao="principal"' + (item.principal ? ' checked' : '') + '>'
            + '<label class="custom-control-label">Lotação principal</label></div></div>'
            + '<div class="col-md-3 d-flex align-items-center justify-content-end"><button type="button" class="btn btn-sm btn-outline-danger btn-remove-lotacao">Remover</button></div>'
            + '</div></div>';
    }

    function syncLotacoesEvents() {
        var button = qs('#btn-add-lotacao');
        if (button) {
            button.onclick = function () {
                var repeater = qs('#lotacoes-repeater');
                if (repeater) repeater.insertAdjacentHTML('beforeend', renderLotacaoItem({ principal: false }));
                bindLotacaoRemovals();
            };
        }
        bindLotacaoRemovals();
    }

    function bindLotacaoRemovals() {
        Array.prototype.slice.call(document.querySelectorAll('.btn-remove-lotacao')).forEach(function (button) {
            button.onclick = function () {
                var item = button.closest('.institutional-lotacao-item');
                if (item) item.remove();
            };
        });
    }

    function populateModal(item) {
        var body = qs('#modal-institucional-body');
        var title = qs('#modal-institucional-label');
        if (!body || !state.config) return;
        state.currentEditId = item && item.id ? item.id : null;
        title.textContent = state.currentEditId ? ('Editar ' + state.config.singular) : ('Novo ' + state.config.singular);
        body.innerHTML = '<div class="row">' + state.config.fields.map(function (field) {
            return renderSimpleField(field, item ? item[field.name] : (field.type === 'checkbox' ? true : ''));
        }).join('') + '</div>';
        if (state.resourceKey === 'servidores') {
            var repeater = qs('#lotacoes-repeater');
            if (repeater) {
                var lotacoes = item && item.lotacoes && item.lotacoes.length ? item.lotacoes : [];
                if (!lotacoes.length && state.schoolContextMode && state.schoolContextId) {
                    lotacoes = [{ escola_id: state.schoolContextId, principal: true }];
                }
                repeater.innerHTML = lotacoes.map(renderLotacaoItem).join('');
            }
            syncLotacoesEvents();
        }
        openModal();
    }

    function collectFormData() {
        var form = qs('#form-institucional');
        var payload = {};
        if (!form || !state.config) return payload;
        state.config.fields.forEach(function (field) {
            if (field.type === 'lotacoes') return;
            var input = form.querySelector('[name="' + field.name + '"]');
            if (!input) return;
            if (field.type === 'checkbox') {
                payload[field.name] = !!input.checked;
            } else {
                payload[field.name] = input.value;
            }
        });
        if (state.resourceKey === 'servidores') {
            payload.lotacoes = Array.prototype.slice.call(document.querySelectorAll('#lotacoes-repeater .institutional-lotacao-item')).map(function (item) {
                return {
                    escola_id: item.querySelector('[data-lotacao="escola_id"]').value,
                    funcao: item.querySelector('[data-lotacao="funcao"]').value,
                    carga_horaria: item.querySelector('[data-lotacao="carga_horaria"]').value,
                    principal: item.querySelector('[data-lotacao="principal"]').checked,
                    inicio_vigencia: item.querySelector('[data-lotacao="inicio_vigencia"]').value,
                    fim_vigencia: item.querySelector('[data-lotacao="fim_vigencia"]').value,
                    observacoes: item.querySelector('[data-lotacao="observacoes"]').value,
                };
            }).filter(function (lot) {
                return lot.escola_id || lot.funcao || lot.carga_horaria || lot.inicio_vigencia || lot.fim_vigencia;
            });
        }
        return payload;
    }

    function renderTable() {
        var thead = qs('#institutional-thead');
        var tbody = qs('#institutional-tbody');
        if (!tbody || !state.config) return;
        if (thead) {
            thead.innerHTML = '<tr>' + state.config.columns.map(function (column) {
                return '<th>' + escapeHtml(column.label) + '</th>';
            }).join('') + '<th class="text-right">Ações</th></tr>';
        }
        var items = filterItems(state.items || []);
        if (!items.length) {
            tbody.innerHTML = '<tr><td colspan="' + (state.config.columns.length + 1) + '"><div class="institutional-empty-state">' + escapeHtml(state.config.emptyText) + '</div></td></tr>';
            return;
        }
        tbody.innerHTML = items.map(function (item) {
            return '<tr>'
                + state.config.columns.map(function (column) {
                    return '<td>' + column.render(item) + '</td>';
                }).join('')
                + '<td class="text-right"><div class="dropdown">'
                + '<button class="btn btn-sm dropdown-toggle more-horizontal" type="button" data-toggle="dropdown"><span class="text-muted sr-only">Ações</span></button>'
                + '<div class="dropdown-menu dropdown-menu-right">'
                + (state.config.permissionManage && hasManagePermission() ? '<a class="dropdown-item action-edit" href="#" data-id="' + escapeHtml(item.id) + '">Editar</a><a class="dropdown-item action-delete text-danger" href="#" data-id="' + escapeHtml(item.id) + '">Excluir</a>' : '<span class="dropdown-item-text text-muted">Somente leitura</span>')
                + '</div></div></td></tr>';
        }).join('');

        Array.prototype.slice.call(document.querySelectorAll('.action-edit')).forEach(function (link) {
            link.onclick = function (event) {
                event.preventDefault();
                var id = Number(link.getAttribute('data-id'));
                var item = (state.items || []).find(function (row) { return Number(row.id) === id; });
                populateModal(item || null);
            };
        });
        Array.prototype.slice.call(document.querySelectorAll('.action-delete')).forEach(function (link) {
            link.onclick = function (event) {
                event.preventDefault();
                deleteItem(Number(link.getAttribute('data-id')));
            };
        });
    }

    function renderHeaderActions() {
        var addButton = qs('#btn-new-resource');
        if (!addButton || !state.config) return;
        addButton.textContent = 'Novo cadastro +';
        addButton.style.display = (hasManagePermission() && !state.schoolContextMode) ? '' : 'none';
        addButton.onclick = function () {
            populateModal(null);
        };
    }

    function hasManagePermission() {
        var permissions = (window.__ME && Array.isArray(window.__ME.permissions)) ? window.__ME.permissions : [];
        return permissions.indexOf('institution.master.manage') !== -1;
    }

    function loadResourceList() {
        return apiFetch(state.config.endpoint).then(function (items) {
            state.items = Array.isArray(items) ? items : [];
            renderStats();
            renderTable();
        });
    }

    function loadMeta() {
        return Promise.all([
            apiFetch('/api/institucional/meta/escolas').then(function (items) { state.escolas = items || []; }),
            apiFetch('/api/institucional/meta/calendarios').then(function (items) { state.calendarios = items || []; }),
        ]);
    }

    function deleteItem(id) {
        if (!window.confirm('Deseja realmente excluir este registro?')) return;
        apiFetch(state.config.endpoint + '/' + id, { method: 'DELETE' })
            .then(loadResourceList)
            .catch(function (error) { alert(error.message || 'Falha ao excluir.'); });
    }

    function bootGenericResource(resourceKey) {
        var searchParams = new URLSearchParams(window.location.search || '');
        state.resourceKey = resourceKey;
        state.config = RESOURCE_CONFIGS[resourceKey];
        state.schoolContextId = searchParams.get('escola_id') || null;
        state.schoolContextMode = searchParams.get('contexto') === 'escola' && !!state.schoolContextId;
        loadCurrentUser().then(function () {
            return loadMeta();
        })
            .then(function () {
                renderHero();
                renderHeaderActions();
                return loadResourceList();
            })
            .catch(function (error) { alert(error.message || 'Falha ao carregar dados institucionais.'); });

        var form = qs('#form-institucional');
        if (form) {
            form.addEventListener('submit', function (event) {
                event.preventDefault();
                var payload = collectFormData();
                var url = state.currentEditId ? state.config.endpoint + '/' + state.currentEditId : state.config.endpoint;
                var method = state.currentEditId ? 'PUT' : 'POST';
                apiFetch(url, {
                    method: method,
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }).then(function () {
                    closeModal();
                    return loadMeta().then(loadResourceList);
                }).catch(function (error) {
                    alert(error.message || 'Falha ao salvar.');
                });
            });
        }

        var search = qs('#institutional-search');
        if (search) {
            search.addEventListener('input', renderTable);
        }
    }

    function renderTurmasTable(items) {
        var tbody = qs('#institutional-tbody');
        if (!tbody) return;
        var filtered = filterItems(items);
        if (!filtered.length) {
            tbody.innerHTML = '<tr><td colspan="6"><div class="institutional-empty-state">Nenhuma turma encontrada.</div></td></tr>';
            return;
        }
        tbody.innerHTML = filtered.map(function (item) {
            return '<tr>'
                + '<td><strong>' + escapeHtml(item.turma || 'Sem turma') + '</strong><p class="mb-0 text-muted">Ano letivo ' + escapeHtml(String(item.ano_letivo || 'N/I')) + '</p></td>'
                + '<td><strong>' + escapeHtml(item.escola_nome || 'Escola não informada') + '</strong></td>'
                + '<td>' + escapeHtml(item.turno || 'Não informado') + '</td>'
                + '<td>' + escapeHtml(item.etapa || 'Não informada') + '</td>'
                + '<td>' + escapeHtml(item.modalidade || 'Não informada') + '</td>'
                + '<td class="text-right"><span class="institutional-meta-pill">' + escapeHtml(String(item.total_alunos || 0)) + ' alunos</span> <a class="btn btn-sm btn-outline-primary ml-2" href="/escolar/escola/' + escapeHtml(item.escola_id) + '/turmas">Abrir escola</a></td>'
                + '</tr>';
        }).join('');
    }

    function bootTurmasPage() {
        var searchParams = new URLSearchParams(window.location.search || '');
        state.resourceKey = 'turmas';
        state.schoolContextId = searchParams.get('escola_id') || null;
        state.schoolContextMode = searchParams.get('contexto') === 'escola' && !!state.schoolContextId;
        var titleEl = qs('[data-role="page-title"]');
        var descEl = qs('[data-role="page-description"]');
        var addButton = qs('#btn-new-resource');
        if (addButton) addButton.style.display = 'none';
        loadMeta().then(function () {
            var school = getSchoolContextSchool();
            if (titleEl) titleEl.textContent = state.schoolContextMode && school ? ('Turmas de ' + school.nome) : 'Turmas da rede';
            if (descEl) {
                descEl.textContent = state.schoolContextMode && school
                    ? ('Visão contextual das turmas da unidade ' + school.nome + '.')
                    : 'Visão consolidada das turmas por escola e ano letivo, preservando a operação por unidade.';
            }
            return apiFetch('/api/institucional/turmas');
        }).then(function (items) {
            state.items = items || [];
            var filteredItems = filterItems(state.items || []);
            var thead = qs('#institutional-thead');
            if (thead) {
                thead.innerHTML = '<tr><th>Turma</th><th>Escola</th><th>Turno</th><th>Etapa</th><th>Modalidade</th><th class="text-right">Ações</th></tr>';
            }
            var statsContainer = qs('[data-role="stats"]');
            if (statsContainer) {
                var schools = new Set(filteredItems.map(function (item) { return item.escola_id; }).filter(Boolean));
                var years = new Set(filteredItems.map(function (item) { return item.ano_letivo; }).filter(Boolean));
                statsContainer.innerHTML = [
                    { label: 'Turmas', value: filteredItems.length },
                    { label: 'Escolas', value: schools.size },
                    { label: 'Anos letivos', value: years.size },
                    { label: 'Alunos vinculados', value: filteredItems.reduce(function (sum, item) { return sum + Number(item.total_alunos || 0); }, 0) },
                ].map(function (item) {
                    return '<div class="col-md-3 mb-3"><div class="card institutional-stat-card shadow-sm h-100"><div class="card-body"><div class="institutional-stat-label mb-2">' + escapeHtml(item.label) + '</div><div class="h3 mb-0">' + escapeHtml(item.value) + '</div></div></div></div>';
                }).join('');
            }
            renderTurmasTable(state.items);
        }).catch(function (error) {
            alert(error.message || 'Falha ao carregar turmas.');
        });
        var search = qs('#institutional-search');
        if (search) search.addEventListener('input', function () { renderTurmasTable(state.items || []); });
    }

    function fillParametersForm(data) {
        Array.prototype.slice.call(document.querySelectorAll('[data-parameter-name]')).forEach(function (input) {
            var name = input.getAttribute('data-parameter-name');
            if (!(name in data)) return;
            if (input.type === 'checkbox') input.checked = !!data[name];
            else input.value = data[name] == null ? '' : data[name];
        });
    }

    function collectSectionPayload(section) {
        var payload = {};
        Array.prototype.slice.call(section.querySelectorAll('[data-parameter-name]')).forEach(function (input) {
            var name = input.getAttribute('data-parameter-name');
            payload[name] = input.type === 'checkbox' ? !!input.checked : input.value;
        });
        return payload;
    }

    function bootParametrosPage() {
        var searchParams = new URLSearchParams(window.location.search || '');
        state.schoolContextId = searchParams.get('escola_id') || null;
        state.schoolContextMode = searchParams.get('contexto') === 'escola' && !!state.schoolContextId;
        var titleEl = qs('[data-role="page-title"]');
        var descEl = qs('[data-role="page-description"]');
        if (titleEl) titleEl.textContent = 'Parâmetros Gerais';
        if (descEl) {
            descEl.textContent = state.schoolContextMode
                ? 'Consulta dos parâmetros acadêmicos e institucionais definidos pela SEMED para aplicação na unidade.'
                : 'Regras acadêmicas, limites institucionais, políticas de etapas e dados-base da rede municipal.';
        }
        var addButton = qs('#btn-new-resource');
        if (addButton) addButton.style.display = 'none';
        apiFetch('/api/institucional/parametros').then(function (data) {
            fillParametersForm(data || {});
            var statsContainer = qs('[data-role="stats"]');
            if (statsContainer) {
                statsContainer.innerHTML = [
                    { label: 'Rede', value: data.nome_rede || 'SEMED' },
                    { label: 'Frequência mínima', value: (data.frequencia_minima || 0) + '%' },
                    { label: 'Dias letivos', value: data.dias_letivos_minimos || 0 },
                    { label: 'Tamanho padrão', value: (data.tamanho_padrao_turma || 0) + ' alunos' },
                ].map(function (item) {
                    return '<div class="col-md-3 mb-3"><div class="card institutional-stat-card shadow-sm h-100"><div class="card-body"><div class="institutional-stat-label mb-2">' + escapeHtml(item.label) + '</div><div class="h3 mb-0">' + escapeHtml(item.value) + '</div></div></div></div>';
                }).join('');
            }
        }).catch(function (error) {
            alert(error.message || 'Falha ao carregar parâmetros.');
        });

        if (state.schoolContextMode) {
            Array.prototype.slice.call(document.querySelectorAll('[data-save-section]')).forEach(function (button) {
                button.style.display = 'none';
            });
            Array.prototype.slice.call(document.querySelectorAll('[data-parameter-name]')).forEach(function (input) {
                input.disabled = true;
            });
            return;
        }

        Array.prototype.slice.call(document.querySelectorAll('[data-save-section]')).forEach(function (button) {
            button.addEventListener('click', function () {
                var section = button.closest('.institutional-section-card');
                if (!section) return;
                var payload = collectSectionPayload(section);
                apiFetch('/api/institucional/parametros', {
                    method: 'PUT',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(payload),
                }).then(function (data) {
                    fillParametersForm(data || {});
                    alert('Seção salva com sucesso.');
                }).catch(function (error) {
                    alert(error.message || 'Falha ao salvar parâmetros.');
                });
            });
        });
    }

    document.addEventListener('DOMContentLoaded', function () {
        var page = document.body.getAttribute('data-institucional-page');
        if (!page) return;
        if (page === 'parametros') return bootParametrosPage();
        if (page === 'turmas') return bootTurmasPage();
        if (RESOURCE_CONFIGS[page]) return bootGenericResource(page);
    });
})();
