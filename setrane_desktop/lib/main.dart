import 'dart:async';
import 'dart:convert';
import 'dart:io';

import 'package:flutter/material.dart';

void main() {
  runApp(const SetraneDesktopApp());
}

class SetraneDesktopApp extends StatefulWidget {
  const SetraneDesktopApp({super.key});

  @override
  State<SetraneDesktopApp> createState() => _SetraneDesktopAppState();
}

class _SetraneDesktopAppState extends State<SetraneDesktopApp> {
  late final SecretariaOfflineController controller;
  bool sessionUnlocked = false;

  @override
  void initState() {
    super.initState();
    controller = SecretariaOfflineController(DesktopRepository());
    unawaited(controller.initialize());
  }

  @override
  void dispose() {
    controller.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    const seed = Color(0xFF0F766E);
    return AnimatedBuilder(
      animation: controller,
      builder: (context, _) {
        return MaterialApp(
          debugShowCheckedModeBanner: false,
          title: 'SETRANE Secretaria Offline',
          theme: ThemeData(
            useMaterial3: true,
            colorScheme: ColorScheme.fromSeed(
              seedColor: seed,
              brightness: Brightness.light,
            ),
            scaffoldBackgroundColor: const Color(0xFFF5F7FA),
            cardTheme: const CardThemeData(
              elevation: 0,
              margin: EdgeInsets.zero,
              shape: RoundedRectangleBorder(
                borderRadius: BorderRadius.all(Radius.circular(18)),
              ),
            ),
            inputDecorationTheme: const InputDecorationTheme(
              border: OutlineInputBorder(
                borderRadius: BorderRadius.all(Radius.circular(14)),
              ),
              filled: true,
              fillColor: Colors.white,
            ),
          ),
          home: !controller.initialized
              ? const Scaffold(body: Center(child: CircularProgressIndicator()))
              : sessionUnlocked
              ? SecretariaShell(
                  controller: controller,
                  onLockSession: () => setState(() => sessionUnlocked = false),
                )
              : SecretariaLoginScreen(
                  controller: controller,
                  onLoginSuccess: () => setState(() => sessionUnlocked = true),
                ),
        );
      },
    );
  }
}

class SecretariaShell extends StatefulWidget {
  const SecretariaShell({
    super.key,
    required this.controller,
    required this.onLockSession,
  });

  final SecretariaOfflineController controller;
  final VoidCallback onLockSession;

  @override
  State<SecretariaShell> createState() => _SecretariaShellState();
}

class _SecretariaShellState extends State<SecretariaShell> {
  int selectedIndex = 0;

  final studentNameCtrl = TextEditingController();
  final studentCodeCtrl = TextEditingController();
  final turmaCtrl = TextEditingController();
  final anoLetivoCtrl = TextEditingController(
    text: DateTime.now().year.toString(),
  );
  final dataMatriculaCtrl = TextEditingController(
    text: DateTime.now().toIso8601String().split('T').first,
  );
  final statusMatriculaCtrl = TextEditingController(text: 'ativo');
  final academicYearCtrl = TextEditingController();
  final nomeSocialCtrl = TextEditingController();
  final cpfCtrl = TextEditingController();
  final rgCtrl = TextEditingController();
  final certidaoCtrl = TextEditingController();
  final nisCtrl = TextEditingController();
  final cartaoSusCtrl = TextEditingController();
  final dataNascimentoCtrl = TextEditingController();
  final sexoCtrl = TextEditingController();
  final corRacaCtrl = TextEditingController();
  final nacionalidadeCtrl = TextEditingController();
  final naturalidadeCtrl = TextEditingController();
  final beneficioSocialCtrl = TextEditingController();
  final numeroRedeCtrl = TextEditingController();
  final orgaoEmissorRgCtrl = TextEditingController();
  final ufRgCtrl = TextEditingController();
  final dataExpedicaoRgCtrl = TextEditingController();
  final cartorioRegistroCtrl = TextEditingController();
  final termoGuardaCtrl = TextEditingController();
  final cartaoVacinacaoCtrl = TextEditingController();
  final documentosPendentesCtrl = TextEditingController();
  final etapaCtrl = TextEditingController();
  final modalidadeCtrl = TextEditingController();
  final formatoLetivoCtrl = TextEditingController();
  final turnoSimplificadoCtrl = TextEditingController();
  final escolaOrigemCtrl = TextEditingController();
  final redeOrigemCtrl = TextEditingController();
  final situacaoEscolarCtrl = TextEditingController();
  final observacoesPedagogicasCtrl = TextEditingController();
  final filiacao1Ctrl = TextEditingController();
  final telefoneFiliacao1Ctrl = TextEditingController();
  final cpfFiliacao1Ctrl = TextEditingController();
  final parentescoFiliacao1Ctrl = TextEditingController();
  final profissaoFiliacao1Ctrl = TextEditingController();
  final escolaridadeFiliacao1Ctrl = TextEditingController();
  final filiacao2Ctrl = TextEditingController();
  final telefoneFiliacao2Ctrl = TextEditingController();
  final cpfFiliacao2Ctrl = TextEditingController();
  final parentescoFiliacao2Ctrl = TextEditingController();
  final profissaoFiliacao2Ctrl = TextEditingController();
  final escolaridadeFiliacao2Ctrl = TextEditingController();
  final addressCtrl = TextEditingController();
  final responsibleCtrl = TextEditingController();
  final telefoneResponsavelCtrl = TextEditingController();
  final emailResponsavelCtrl = TextEditingController();
  final cpfResponsavelCtrl = TextEditingController();
  final parentescoResponsavelCtrl = TextEditingController();
  final profissaoResponsavelCtrl = TextEditingController();
  final escolaridadeResponsavelCtrl = TextEditingController();
  final contatoEmergenciaNomeCtrl = TextEditingController();
  final telefoneEmergenciaCtrl = TextEditingController();
  final contatoParentescoCtrl = TextEditingController();
  final matriculanteNomeCtrl = TextEditingController();
  final matriculanteCpfCtrl = TextEditingController();
  final matriculanteParentescoCtrl = TextEditingController();
  final matriculanteTelefoneCtrl = TextEditingController();
  final matriculanteEmailCtrl = TextEditingController();
  final matriculanteDocumentoCtrl = TextEditingController();
  final cepCtrl = TextEditingController();
  final ruaCtrl = TextEditingController();
  final numeroCtrl = TextEditingController();
  final complementoEnderecoCtrl = TextEditingController();
  final bairroCtrl = TextEditingController();
  final zonaCtrl = TextEditingController();
  final pontoReferenciaCtrl = TextEditingController();
  final latitudeCtrl = TextEditingController();
  final longitudeCtrl = TextEditingController();
  final transportCtrl = TextEditingController();
  final desejaTransporteCtrl = TextEditingController();
  final transporteAprovadoCtrl = TextEditingController();
  final transporteUtilizaCtrl = TextEditingController();
  final tipoTransporteCtrl = TextEditingController();
  final poderPublicoTransporteCtrl = TextEditingController();
  final categoriaTransporteCensoCtrl = TextEditingController();
  final distanciaKmCtrl = TextEditingController();
  final tempoDeslocamentoCtrl = TextEditingController();
  final turnoEmbarqueCtrl = TextEditingController();
  final turnoRetornoCtrl = TextEditingController();
  final localEmbarqueCtrl = TextEditingController();
  final precisaMonitorCtrl = TextEditingController();
  final embarqueAssistidoCtrl = TextEditingController();
  final rotaExclusivaCtrl = TextEditingController();
  final carroAdaptadoCtrl = TextEditingController();
  final emitirCarteirinhaCtrl = TextEditingController();
  final observacoesTransporteCtrl = TextEditingController();
  final deficienciaCtrl = TextEditingController();
  final diagnosticosCtrl = TextEditingController();
  final medicacoesCtrl = TextEditingController();
  final restricoesSaudeCtrl = TextEditingController();
  final alergiasCtrl = TextEditingController();
  final usaCadeiraRodasCtrl = TextEditingController();
  final usaMedicacaoControladaCtrl = TextEditingController();
  final peiCtrl = TextEditingController();
  final unidadeSaudeCtrl = TextEditingController();
  final prontuarioSaudeCtrl = TextEditingController();
  final religiaoCtrl = TextEditingController();
  final etniaIndigenaCtrl = TextEditingController();
  final resideComCtrl = TextEditingController();
  final tipoMoradiaCtrl = TextEditingController();
  final rendaFamiliarCtrl = TextEditingController();
  final cadunicoCtrl = TextEditingController();
  final acessoInternetCtrl = TextEditingController();
  final possuiDispositivoCtrl = TextEditingController();
  final autorizaImagemCtrl = TextEditingController();
  final recebeBpcCtrl = TextEditingController();
  final idiomaFamiliarCtrl = TextEditingController();
  final autorizadosBuscaCtrl = TextEditingController();
  final vulnerabilidadeSocialCtrl = TextEditingController();
  final observacoesConvivenciaCtrl = TextEditingController();
  final observacoesGeraisCtrl = TextEditingController();
  final destinationCtrl = TextEditingController();
  final movementReasonCtrl = TextEditingController();
  final periodCtrl = TextEditingController(text: '1º Bimestre');
  final notesCtrl = TextEditingController();
  final backendCtrl = TextEditingController();
  final printerCtrl = TextEditingController();
  final syncIntervalCtrl = TextEditingController();
  final offlineUsersCtrl = TextEditingController();
  final loginEmailCtrl = TextEditingController();
  final loginPasswordCtrl = TextEditingController();
  final loginTenantCtrl = TextEditingController();

  @override
  void initState() {
    super.initState();
    backendCtrl.text = widget.controller.backendUrl;
    printerCtrl.text = widget.controller.printerName;
    syncIntervalCtrl.text = widget.controller.syncIntervalSeconds.toString();
    offlineUsersCtrl.text = widget.controller.offlineUsers.join('\n');
    loginEmailCtrl.text = widget.controller.backendEmail;
    loginTenantCtrl.text = widget.controller.backendTenantCode;
  }

  @override
  void dispose() {
    studentNameCtrl.dispose();
    studentCodeCtrl.dispose();
    turmaCtrl.dispose();
    anoLetivoCtrl.dispose();
    dataMatriculaCtrl.dispose();
    statusMatriculaCtrl.dispose();
    academicYearCtrl.dispose();
    nomeSocialCtrl.dispose();
    cpfCtrl.dispose();
    rgCtrl.dispose();
    certidaoCtrl.dispose();
    nisCtrl.dispose();
    cartaoSusCtrl.dispose();
    dataNascimentoCtrl.dispose();
    sexoCtrl.dispose();
    corRacaCtrl.dispose();
    nacionalidadeCtrl.dispose();
    naturalidadeCtrl.dispose();
    beneficioSocialCtrl.dispose();
    numeroRedeCtrl.dispose();
    orgaoEmissorRgCtrl.dispose();
    ufRgCtrl.dispose();
    dataExpedicaoRgCtrl.dispose();
    cartorioRegistroCtrl.dispose();
    termoGuardaCtrl.dispose();
    cartaoVacinacaoCtrl.dispose();
    documentosPendentesCtrl.dispose();
    etapaCtrl.dispose();
    modalidadeCtrl.dispose();
    formatoLetivoCtrl.dispose();
    turnoSimplificadoCtrl.dispose();
    escolaOrigemCtrl.dispose();
    redeOrigemCtrl.dispose();
    situacaoEscolarCtrl.dispose();
    observacoesPedagogicasCtrl.dispose();
    filiacao1Ctrl.dispose();
    telefoneFiliacao1Ctrl.dispose();
    cpfFiliacao1Ctrl.dispose();
    parentescoFiliacao1Ctrl.dispose();
    profissaoFiliacao1Ctrl.dispose();
    escolaridadeFiliacao1Ctrl.dispose();
    filiacao2Ctrl.dispose();
    telefoneFiliacao2Ctrl.dispose();
    cpfFiliacao2Ctrl.dispose();
    parentescoFiliacao2Ctrl.dispose();
    profissaoFiliacao2Ctrl.dispose();
    escolaridadeFiliacao2Ctrl.dispose();
    addressCtrl.dispose();
    responsibleCtrl.dispose();
    telefoneResponsavelCtrl.dispose();
    emailResponsavelCtrl.dispose();
    cpfResponsavelCtrl.dispose();
    parentescoResponsavelCtrl.dispose();
    profissaoResponsavelCtrl.dispose();
    escolaridadeResponsavelCtrl.dispose();
    contatoEmergenciaNomeCtrl.dispose();
    telefoneEmergenciaCtrl.dispose();
    contatoParentescoCtrl.dispose();
    matriculanteNomeCtrl.dispose();
    matriculanteCpfCtrl.dispose();
    matriculanteParentescoCtrl.dispose();
    matriculanteTelefoneCtrl.dispose();
    matriculanteEmailCtrl.dispose();
    matriculanteDocumentoCtrl.dispose();
    cepCtrl.dispose();
    ruaCtrl.dispose();
    numeroCtrl.dispose();
    complementoEnderecoCtrl.dispose();
    bairroCtrl.dispose();
    zonaCtrl.dispose();
    pontoReferenciaCtrl.dispose();
    latitudeCtrl.dispose();
    longitudeCtrl.dispose();
    transportCtrl.dispose();
    desejaTransporteCtrl.dispose();
    transporteAprovadoCtrl.dispose();
    transporteUtilizaCtrl.dispose();
    tipoTransporteCtrl.dispose();
    poderPublicoTransporteCtrl.dispose();
    categoriaTransporteCensoCtrl.dispose();
    distanciaKmCtrl.dispose();
    tempoDeslocamentoCtrl.dispose();
    turnoEmbarqueCtrl.dispose();
    turnoRetornoCtrl.dispose();
    localEmbarqueCtrl.dispose();
    precisaMonitorCtrl.dispose();
    embarqueAssistidoCtrl.dispose();
    rotaExclusivaCtrl.dispose();
    carroAdaptadoCtrl.dispose();
    emitirCarteirinhaCtrl.dispose();
    observacoesTransporteCtrl.dispose();
    deficienciaCtrl.dispose();
    diagnosticosCtrl.dispose();
    medicacoesCtrl.dispose();
    restricoesSaudeCtrl.dispose();
    alergiasCtrl.dispose();
    usaCadeiraRodasCtrl.dispose();
    usaMedicacaoControladaCtrl.dispose();
    peiCtrl.dispose();
    unidadeSaudeCtrl.dispose();
    prontuarioSaudeCtrl.dispose();
    religiaoCtrl.dispose();
    etniaIndigenaCtrl.dispose();
    resideComCtrl.dispose();
    tipoMoradiaCtrl.dispose();
    rendaFamiliarCtrl.dispose();
    cadunicoCtrl.dispose();
    acessoInternetCtrl.dispose();
    possuiDispositivoCtrl.dispose();
    autorizaImagemCtrl.dispose();
    recebeBpcCtrl.dispose();
    idiomaFamiliarCtrl.dispose();
    autorizadosBuscaCtrl.dispose();
    vulnerabilidadeSocialCtrl.dispose();
    observacoesConvivenciaCtrl.dispose();
    observacoesGeraisCtrl.dispose();
    destinationCtrl.dispose();
    movementReasonCtrl.dispose();
    periodCtrl.dispose();
    notesCtrl.dispose();
    backendCtrl.dispose();
    printerCtrl.dispose();
    syncIntervalCtrl.dispose();
    offlineUsersCtrl.dispose();
    loginEmailCtrl.dispose();
    loginPasswordCtrl.dispose();
    loginTenantCtrl.dispose();
    super.dispose();
  }

  Future<void> _submitLaunch(String channel) async {
    if (studentNameCtrl.text.trim().isEmpty || turmaCtrl.text.trim().isEmpty) {
      _showSnack('Informe ao menos estudante e turma.');
      return;
    }
    await widget.controller.createLaunch(
      channel: channel,
      operation: 'REGISTRO_SECRETARIA',
      studentName: studentNameCtrl.text,
      studentCode: studentCodeCtrl.text,
      turma: turmaCtrl.text,
      period: periodCtrl.text,
      notes: notesCtrl.text,
    );
    studentNameCtrl.clear();
    studentCodeCtrl.clear();
    turmaCtrl.clear();
    addressCtrl.clear();
    responsibleCtrl.clear();
    transportCtrl.clear();
    destinationCtrl.clear();
    movementReasonCtrl.clear();
    notesCtrl.clear();
    _showSnack(
      channel == 'offline'
          ? 'Lançamento salvo localmente e enviado para a fila.'
          : 'Lançamento registrado e preparado para sincronização.',
    );
  }

  void _showSnack(String message) {
    ScaffoldMessenger.of(
      context,
    ).showSnackBar(SnackBar(content: Text(message)));
  }

  void _clearStudentForm() {
    studentNameCtrl.clear();
    studentCodeCtrl.clear();
    turmaCtrl.clear();
    anoLetivoCtrl.text = DateTime.now().year.toString();
    dataMatriculaCtrl.text = DateTime.now().toIso8601String().split('T').first;
    statusMatriculaCtrl.text = 'ativo';
    academicYearCtrl.clear();
    nomeSocialCtrl.clear();
    cpfCtrl.clear();
    rgCtrl.clear();
    certidaoCtrl.clear();
    nisCtrl.clear();
    cartaoSusCtrl.clear();
    dataNascimentoCtrl.clear();
    sexoCtrl.clear();
    corRacaCtrl.clear();
    nacionalidadeCtrl.clear();
    naturalidadeCtrl.clear();
    beneficioSocialCtrl.clear();
    numeroRedeCtrl.clear();
    orgaoEmissorRgCtrl.clear();
    ufRgCtrl.clear();
    dataExpedicaoRgCtrl.clear();
    cartorioRegistroCtrl.clear();
    termoGuardaCtrl.clear();
    cartaoVacinacaoCtrl.clear();
    documentosPendentesCtrl.clear();
    etapaCtrl.clear();
    modalidadeCtrl.clear();
    formatoLetivoCtrl.clear();
    turnoSimplificadoCtrl.clear();
    escolaOrigemCtrl.clear();
    redeOrigemCtrl.clear();
    situacaoEscolarCtrl.clear();
    observacoesPedagogicasCtrl.clear();
    filiacao1Ctrl.clear();
    telefoneFiliacao1Ctrl.clear();
    cpfFiliacao1Ctrl.clear();
    parentescoFiliacao1Ctrl.clear();
    profissaoFiliacao1Ctrl.clear();
    escolaridadeFiliacao1Ctrl.clear();
    filiacao2Ctrl.clear();
    telefoneFiliacao2Ctrl.clear();
    cpfFiliacao2Ctrl.clear();
    parentescoFiliacao2Ctrl.clear();
    profissaoFiliacao2Ctrl.clear();
    escolaridadeFiliacao2Ctrl.clear();
    responsibleCtrl.clear();
    telefoneResponsavelCtrl.clear();
    emailResponsavelCtrl.clear();
    cpfResponsavelCtrl.clear();
    parentescoResponsavelCtrl.clear();
    profissaoResponsavelCtrl.clear();
    escolaridadeResponsavelCtrl.clear();
    contatoEmergenciaNomeCtrl.clear();
    telefoneEmergenciaCtrl.clear();
    contatoParentescoCtrl.clear();
    matriculanteNomeCtrl.clear();
    matriculanteCpfCtrl.clear();
    matriculanteParentescoCtrl.clear();
    matriculanteTelefoneCtrl.clear();
    matriculanteEmailCtrl.clear();
    matriculanteDocumentoCtrl.clear();
    addressCtrl.clear();
    cepCtrl.clear();
    ruaCtrl.clear();
    numeroCtrl.clear();
    complementoEnderecoCtrl.clear();
    bairroCtrl.clear();
    zonaCtrl.clear();
    pontoReferenciaCtrl.clear();
    latitudeCtrl.clear();
    longitudeCtrl.clear();
    transportCtrl.clear();
    desejaTransporteCtrl.clear();
    transporteAprovadoCtrl.clear();
    transporteUtilizaCtrl.clear();
    tipoTransporteCtrl.clear();
    poderPublicoTransporteCtrl.clear();
    categoriaTransporteCensoCtrl.clear();
    distanciaKmCtrl.clear();
    tempoDeslocamentoCtrl.clear();
    turnoEmbarqueCtrl.clear();
    turnoRetornoCtrl.clear();
    localEmbarqueCtrl.clear();
    precisaMonitorCtrl.clear();
    embarqueAssistidoCtrl.clear();
    rotaExclusivaCtrl.clear();
    carroAdaptadoCtrl.clear();
    emitirCarteirinhaCtrl.clear();
    observacoesTransporteCtrl.clear();
    deficienciaCtrl.clear();
    diagnosticosCtrl.clear();
    medicacoesCtrl.clear();
    restricoesSaudeCtrl.clear();
    alergiasCtrl.clear();
    usaCadeiraRodasCtrl.clear();
    usaMedicacaoControladaCtrl.clear();
    peiCtrl.clear();
    unidadeSaudeCtrl.clear();
    prontuarioSaudeCtrl.clear();
    religiaoCtrl.clear();
    etniaIndigenaCtrl.clear();
    resideComCtrl.clear();
    tipoMoradiaCtrl.clear();
    rendaFamiliarCtrl.clear();
    cadunicoCtrl.clear();
    acessoInternetCtrl.clear();
    possuiDispositivoCtrl.clear();
    autorizaImagemCtrl.clear();
    recebeBpcCtrl.clear();
    idiomaFamiliarCtrl.clear();
    autorizadosBuscaCtrl.clear();
    vulnerabilidadeSocialCtrl.clear();
    observacoesConvivenciaCtrl.clear();
    observacoesGeraisCtrl.clear();
    notesCtrl.clear();
  }

  void _clearEnrollmentForm() {
    _clearStudentForm();
  }

  void _clearMovementForm() {
    studentNameCtrl.clear();
    studentCodeCtrl.clear();
    turmaCtrl.clear();
    destinationCtrl.clear();
    movementReasonCtrl.clear();
    notesCtrl.clear();
  }

  Future<void> _openSlidePanel({
    required String title,
    required String subtitle,
    required Widget child,
    double width = 560,
  }) {
    return showGeneralDialog<void>(
      context: context,
      barrierLabel: title,
      barrierDismissible: true,
      barrierColor: Colors.black.withValues(alpha: 0.28),
      transitionDuration: const Duration(milliseconds: 260),
      pageBuilder: (dialogContext, _, __) {
        final theme = Theme.of(dialogContext);
        return Align(
          alignment: Alignment.centerRight,
          child: Material(
            color: Colors.transparent,
            child: SafeArea(
              child: Container(
                width: width,
                height: double.infinity,
                margin: const EdgeInsets.fromLTRB(16, 16, 16, 16),
                decoration: BoxDecoration(
                  color: theme.colorScheme.surface,
                  borderRadius: const BorderRadius.only(
                    topLeft: Radius.circular(28),
                    bottomLeft: Radius.circular(28),
                  ),
                  boxShadow: [
                    BoxShadow(
                      color: Colors.black.withValues(alpha: 0.12),
                      blurRadius: 24,
                      offset: const Offset(-6, 0),
                    ),
                  ],
                ),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Padding(
                      padding: const EdgeInsets.fromLTRB(24, 24, 18, 18),
                      child: Row(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Expanded(
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  title,
                                  style: const TextStyle(
                                    fontSize: 22,
                                    fontWeight: FontWeight.w800,
                                  ),
                                ),
                                const SizedBox(height: 6),
                                Text(
                                  subtitle,
                                  style: TextStyle(
                                    color: Colors.grey.shade700,
                                    height: 1.4,
                                  ),
                                ),
                              ],
                            ),
                          ),
                          IconButton(
                            tooltip: 'Fechar',
                            onPressed: () => Navigator.of(dialogContext).pop(),
                            icon: const Icon(Icons.close),
                          ),
                        ],
                      ),
                    ),
                    Divider(height: 1, color: Colors.grey.shade300),
                    Expanded(
                      child: SingleChildScrollView(
                        padding: const EdgeInsets.all(24),
                        child: child,
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        );
      },
      transitionBuilder: (dialogContext, animation, _, dialogChild) {
        final curved = CurvedAnimation(
          parent: animation,
          curve: Curves.easeOutCubic,
        );
        return SlideTransition(
          position: Tween<Offset>(
            begin: const Offset(1, 0),
            end: Offset.zero,
          ).animate(curved),
          child: dialogChild,
        );
      },
    );
  }

  Widget _buildSectionHeader({
    required String title,
    required String subtitle,
    required List<Widget> actions,
  }) {
    return Container(
      padding: const EdgeInsets.all(20),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(22),
      ),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Expanded(
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  title,
                  style: const TextStyle(
                    fontSize: 20,
                    fontWeight: FontWeight.w800,
                  ),
                ),
                const SizedBox(height: 8),
                Text(
                  subtitle,
                  style: TextStyle(color: Colors.grey.shade700, height: 1.4),
                ),
              ],
            ),
          ),
          const SizedBox(width: 16),
          Wrap(spacing: 10, runSpacing: 10, children: actions),
        ],
      ),
    );
  }

  Widget _buildContextPanel({
    required String title,
    required String description,
    required List<String> bullets,
  }) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(20),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              title,
              style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w700),
            ),
            const SizedBox(height: 8),
            Text(
              description,
              style: TextStyle(color: Colors.grey.shade700, height: 1.4),
            ),
            const SizedBox(height: 18),
            ...bullets.map(
              (item) => Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Row(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Container(
                      width: 8,
                      height: 8,
                      margin: const EdgeInsets.only(top: 6),
                      decoration: const BoxDecoration(
                        color: Color(0xFF0F766E),
                        shape: BoxShape.circle,
                      ),
                    ),
                    const SizedBox(width: 10),
                    Expanded(child: Text(item)),
                  ],
                ),
              ),
            ),
          ],
        ),
      ),
    );
  }

  Widget _buildFormSection({
    required String title,
    required String subtitle,
    required List<Widget> children,
  }) {
    return Container(
      margin: const EdgeInsets.only(bottom: 18),
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: Colors.white,
        borderRadius: BorderRadius.circular(20),
        border: Border.all(color: Colors.grey.shade300),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(
            title,
            style: const TextStyle(fontSize: 17, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Text(
            subtitle,
            style: TextStyle(color: Colors.grey.shade700, height: 1.4),
          ),
          const SizedBox(height: 16),
          ...children,
        ],
      ),
    );
  }

  Map<String, dynamic> _buildAcademicPayload() {
    return {
      'ano_letivo': anoLetivoCtrl.text.trim(),
      'data_matricula': dataMatriculaCtrl.text.trim(),
      'status': statusMatriculaCtrl.text.trim(),
      'id_pessoa': studentCodeCtrl.text.trim(),
      'pessoa_nome': studentNameCtrl.text.trim(),
      'nome_social': nomeSocialCtrl.text.trim(),
      'cpf': cpfCtrl.text.trim(),
      'rg': rgCtrl.text.trim(),
      'certidao_nascimento': certidaoCtrl.text.trim(),
      'nis': nisCtrl.text.trim(),
      'cartao_sus': cartaoSusCtrl.text.trim(),
      'data_nascimento': dataNascimentoCtrl.text.trim(),
      'sexo': sexoCtrl.text.trim(),
      'cor_raca': corRacaCtrl.text.trim(),
      'nacionalidade': nacionalidadeCtrl.text.trim(),
      'naturalidade': naturalidadeCtrl.text.trim(),
      'beneficio_social': beneficioSocialCtrl.text.trim(),
      'numero_matricula_rede': numeroRedeCtrl.text.trim(),
      'orgao_emissor_rg': orgaoEmissorRgCtrl.text.trim(),
      'uf_rg': ufRgCtrl.text.trim(),
      'data_expedicao_rg': dataExpedicaoRgCtrl.text.trim(),
      'cartorio_registro': cartorioRegistroCtrl.text.trim(),
      'termo_guarda': termoGuardaCtrl.text.trim(),
      'cartao_vacinacao': cartaoVacinacaoCtrl.text.trim(),
      'documentos_pendentes': documentosPendentesCtrl.text.trim(),
      'turma': turmaCtrl.text.trim(),
      'ano': academicYearCtrl.text.trim(),
      'etapa': etapaCtrl.text.trim(),
      'modalidade': modalidadeCtrl.text.trim(),
      'formato_letivo': formatoLetivoCtrl.text.trim(),
      'turno_simplificado': turnoSimplificadoCtrl.text.trim(),
      'escola_origem': escolaOrigemCtrl.text.trim(),
      'rede_origem': redeOrigemCtrl.text.trim(),
      'situacao_escolar': situacaoEscolarCtrl.text.trim(),
      'observacoes_pedagogicas': observacoesPedagogicasCtrl.text.trim(),
      'filiacao_1': filiacao1Ctrl.text.trim(),
      'telefone_filiacao_1': telefoneFiliacao1Ctrl.text.trim(),
      'cpf_filiacao_1': cpfFiliacao1Ctrl.text.trim(),
      'parentesco_filiacao_1': parentescoFiliacao1Ctrl.text.trim(),
      'profissao_filiacao_1': profissaoFiliacao1Ctrl.text.trim(),
      'escolaridade_filiacao_1': escolaridadeFiliacao1Ctrl.text.trim(),
      'filiacao_2': filiacao2Ctrl.text.trim(),
      'telefone_filiacao_2': telefoneFiliacao2Ctrl.text.trim(),
      'cpf_filiacao_2': cpfFiliacao2Ctrl.text.trim(),
      'parentesco_filiacao_2': parentescoFiliacao2Ctrl.text.trim(),
      'profissao_filiacao_2': profissaoFiliacao2Ctrl.text.trim(),
      'escolaridade_filiacao_2': escolaridadeFiliacao2Ctrl.text.trim(),
      'responsavel': responsibleCtrl.text.trim(),
      'telefone_responsavel': telefoneResponsavelCtrl.text.trim(),
      'email_responsavel': emailResponsavelCtrl.text.trim(),
      'cpf_responsavel': cpfResponsavelCtrl.text.trim(),
      'parentesco_responsavel': parentescoResponsavelCtrl.text.trim(),
      'profissao_responsavel': profissaoResponsavelCtrl.text.trim(),
      'escolaridade_responsavel': escolaridadeResponsavelCtrl.text.trim(),
      'contato_emergencia_nome': contatoEmergenciaNomeCtrl.text.trim(),
      'telefone_emergencia': telefoneEmergenciaCtrl.text.trim(),
      'contato_emergencia_parentesco': contatoParentescoCtrl.text.trim(),
      'matriculante_nome': matriculanteNomeCtrl.text.trim(),
      'matriculante_cpf': matriculanteCpfCtrl.text.trim(),
      'matriculante_parentesco': matriculanteParentescoCtrl.text.trim(),
      'matriculante_telefone': matriculanteTelefoneCtrl.text.trim(),
      'matriculante_email': matriculanteEmailCtrl.text.trim(),
      'matriculante_documento': matriculanteDocumentoCtrl.text.trim(),
      'cep': cepCtrl.text.trim(),
      'rua': ruaCtrl.text.trim(),
      'numero_pessoa_endereco': numeroCtrl.text.trim(),
      'complemento_endereco': complementoEnderecoCtrl.text.trim(),
      'bairro': bairroCtrl.text.trim(),
      'zona': zonaCtrl.text.trim(),
      'ponto_referencia': pontoReferenciaCtrl.text.trim(),
      'endereco_referencia': addressCtrl.text.trim(),
      'latitude': latitudeCtrl.text.trim(),
      'longitude': longitudeCtrl.text.trim(),
      'deseja_transporte': desejaTransporteCtrl.text.trim(),
      'transporte_aprovado': transporteAprovadoCtrl.text.trim(),
      'transporte_escolar_publico_utiliza': transporteUtilizaCtrl.text.trim(),
      'tipo_transporte': tipoTransporteCtrl.text.trim(),
      'poder_publico_transporte': poderPublicoTransporteCtrl.text.trim(),
      'categoria_transporte_censo': categoriaTransporteCensoCtrl.text.trim(),
      'distancia_km': distanciaKmCtrl.text.trim(),
      'tempo_deslocamento_min': tempoDeslocamentoCtrl.text.trim(),
      'turno_embarque': turnoEmbarqueCtrl.text.trim(),
      'turno_retorno': turnoRetornoCtrl.text.trim(),
      'local_embarque': localEmbarqueCtrl.text.trim(),
      'precisa_monitor': precisaMonitorCtrl.text.trim(),
      'embarque_assistido': embarqueAssistidoCtrl.text.trim(),
      'rota_exclusiva': rotaExclusivaCtrl.text.trim(),
      'carro_adaptado': carroAdaptadoCtrl.text.trim(),
      'emitir_carteirinha_ao_finalizar': emitirCarteirinhaCtrl.text.trim(),
      'observacoes_transporte': observacoesTransporteCtrl.text.trim(),
      'apoio_escolar': transportCtrl.text.trim(),
      'deficiencia': deficienciaCtrl.text.trim(),
      'diagnosticos': diagnosticosCtrl.text.trim(),
      'medicacoes': medicacoesCtrl.text.trim(),
      'restricoes_saude': restricoesSaudeCtrl.text.trim(),
      'alergias': alergiasCtrl.text.trim(),
      'usa_cadeira_rodas': usaCadeiraRodasCtrl.text.trim(),
      'usa_medicacao_controlada': usaMedicacaoControladaCtrl.text.trim(),
      'plano_educacional_individualizado': peiCtrl.text.trim(),
      'unidade_saude_referencia': unidadeSaudeCtrl.text.trim(),
      'numero_prontuario_saude': prontuarioSaudeCtrl.text.trim(),
      'religiao': religiaoCtrl.text.trim(),
      'etnia_indigena': etniaIndigenaCtrl.text.trim(),
      'reside_com': resideComCtrl.text.trim(),
      'tipo_moradia': tipoMoradiaCtrl.text.trim(),
      'renda_familiar': rendaFamiliarCtrl.text.trim(),
      'cadunico': cadunicoCtrl.text.trim(),
      'acesso_internet': acessoInternetCtrl.text.trim(),
      'possui_dispositivo': possuiDispositivoCtrl.text.trim(),
      'autoriza_imagem': autorizaImagemCtrl.text.trim(),
      'recebe_bpc': recebeBpcCtrl.text.trim(),
      'idioma_familiar': idiomaFamiliarCtrl.text.trim(),
      'autorizados_busca': autorizadosBuscaCtrl.text.trim(),
      'vulnerabilidade_social': vulnerabilidadeSocialCtrl.text.trim(),
      'observacoes_convivencia': observacoesConvivenciaCtrl.text.trim(),
      'observacoes_gerais': observacoesGeraisCtrl.text.trim(),
    }..removeWhere((key, value) => value == null || value.toString().isEmpty);
  }

  String _buildAcademicNotesSummary() {
    final payload = _buildAcademicPayload();
    return [
      'Ano letivo: ${payload['ano_letivo'] ?? 'N/I'}',
      'Turma: ${payload['turma'] ?? 'N/I'}',
      'Status: ${payload['status'] ?? 'N/I'}',
      'Responsável: ${payload['responsavel'] ?? 'N/I'}',
      'Telefone: ${payload['telefone_responsavel'] ?? 'N/I'}',
      'Endereço: ${payload['rua'] ?? payload['endereco_referencia'] ?? 'N/I'}',
      'Transporte: ${payload['transporte_escolar_publico_utiliza'] ?? payload['deseja_transporte'] ?? 'N/I'}',
      'Deficiência: ${payload['deficiencia'] ?? 'N/I'}',
      if ((payload['observacoes_gerais'] as String?)?.isNotEmpty ?? false)
        'Observações gerais: ${payload['observacoes_gerais']}',
    ].join('\n');
  }

  List<Widget> _buildAcademicRecordSections() {
    return [
      _buildFormSection(
        title: 'Matrícula',
        subtitle:
            'Dados do vínculo escolar atual, matrícula na rede e situação da ficha offline.',
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: anoLetivoCtrl,
                  decoration: const InputDecoration(labelText: 'Ano letivo'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: turmaCtrl,
                  decoration: const InputDecoration(labelText: 'Turma'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: dataMatriculaCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Data da matrícula',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: statusMatriculaCtrl,
                  decoration: const InputDecoration(labelText: 'Status'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: studentCodeCtrl,
                  decoration: const InputDecoration(
                    labelText: 'ID/Matrícula na rede',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: academicYearCtrl,
                  decoration: const InputDecoration(labelText: 'Série/Ano'),
                ),
              ),
            ],
          ),
        ],
      ),
      _buildFormSection(
        title: 'Identificação e documentação',
        subtitle:
            'Mesma lógica da ficha web para documentação civil, identificação social e dados de origem.',
        children: [
          TextField(
            controller: studentNameCtrl,
            decoration: const InputDecoration(labelText: 'Nome completo'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: nomeSocialCtrl,
            decoration: const InputDecoration(labelText: 'Nome social'),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: cpfCtrl,
                  decoration: const InputDecoration(labelText: 'CPF'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: rgCtrl,
                  decoration: const InputDecoration(labelText: 'RG'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: certidaoCtrl,
                  decoration: const InputDecoration(labelText: 'Certidão'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: nisCtrl,
                  decoration: const InputDecoration(labelText: 'NIS'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: cartaoSusCtrl,
                  decoration: const InputDecoration(labelText: 'Cartão SUS'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: dataNascimentoCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Data de nascimento',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: sexoCtrl,
                  decoration: const InputDecoration(labelText: 'Sexo'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: corRacaCtrl,
                  decoration: const InputDecoration(labelText: 'Cor/Raça'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: nacionalidadeCtrl,
                  decoration: const InputDecoration(labelText: 'Nacionalidade'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: naturalidadeCtrl,
                  decoration: const InputDecoration(labelText: 'Naturalidade'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: beneficioSocialCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Benefício social',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: numeroRedeCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Número de matrícula da rede',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: orgaoEmissorRgCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Órgão emissor do RG',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: ufRgCtrl,
                  decoration: const InputDecoration(labelText: 'UF do RG'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: dataExpedicaoRgCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Data de expedição',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: cartorioRegistroCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Cartório de registro',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: termoGuardaCtrl,
            decoration: const InputDecoration(
              labelText: 'Termo de guarda / decisão judicial',
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: cartaoVacinacaoCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Cartão de vacinação',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: documentosPendentesCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Documentos pendentes',
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
      _buildFormSection(
        title: 'Dados escolares',
        subtitle:
            'Etapa, modalidade, origem escolar e observações pedagógicas da matrícula.',
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: etapaCtrl,
                  decoration: const InputDecoration(labelText: 'Etapa'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: modalidadeCtrl,
                  decoration: const InputDecoration(labelText: 'Modalidade'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: formatoLetivoCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Formato letivo',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: turnoSimplificadoCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Turno simplificado',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: escolaOrigemCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Escola de origem',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: redeOrigemCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Rede de origem',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: situacaoEscolarCtrl,
            decoration: const InputDecoration(labelText: 'Situação escolar'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: observacoesPedagogicasCtrl,
            minLines: 3,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Observações pedagógicas',
            ),
          ),
        ],
      ),
      _buildFormSection(
        title: 'Família e contatos',
        subtitle:
            'Filiação, responsável principal, contatos de emergência e pessoa que efetivou a matrícula.',
        children: [
          TextField(
            controller: filiacao1Ctrl,
            decoration: const InputDecoration(labelText: 'Filiação 1'),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: telefoneFiliacao1Ctrl,
                  decoration: const InputDecoration(
                    labelText: 'Telefone filiação 1',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: cpfFiliacao1Ctrl,
                  decoration: const InputDecoration(
                    labelText: 'CPF filiação 1',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: parentescoFiliacao1Ctrl,
                  decoration: const InputDecoration(
                    labelText: 'Parentesco filiação 1',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: profissaoFiliacao1Ctrl,
                  decoration: const InputDecoration(
                    labelText: 'Profissão filiação 1',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: escolaridadeFiliacao1Ctrl,
            decoration: const InputDecoration(
              labelText: 'Escolaridade filiação 1',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: filiacao2Ctrl,
            decoration: const InputDecoration(labelText: 'Filiação 2'),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: telefoneFiliacao2Ctrl,
                  decoration: const InputDecoration(
                    labelText: 'Telefone filiação 2',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: cpfFiliacao2Ctrl,
                  decoration: const InputDecoration(
                    labelText: 'CPF filiação 2',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: parentescoFiliacao2Ctrl,
                  decoration: const InputDecoration(
                    labelText: 'Parentesco filiação 2',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: profissaoFiliacao2Ctrl,
                  decoration: const InputDecoration(
                    labelText: 'Profissão filiação 2',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: escolaridadeFiliacao2Ctrl,
            decoration: const InputDecoration(
              labelText: 'Escolaridade filiação 2',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: responsibleCtrl,
            decoration: const InputDecoration(
              labelText: 'Responsável principal',
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: telefoneResponsavelCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Telefone do responsável',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: emailResponsavelCtrl,
                  decoration: const InputDecoration(
                    labelText: 'E-mail do responsável',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: cpfResponsavelCtrl,
                  decoration: const InputDecoration(
                    labelText: 'CPF do responsável',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: parentescoResponsavelCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Parentesco do responsável',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: profissaoResponsavelCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Profissão do responsável',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: escolaridadeResponsavelCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Escolaridade do responsável',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: contatoEmergenciaNomeCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Contato de emergência',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: telefoneEmergenciaCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Telefone de emergência',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: contatoParentescoCtrl,
            decoration: const InputDecoration(
              labelText: 'Parentesco do contato de emergência',
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: matriculanteNomeCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Nome do matriculante',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: matriculanteCpfCtrl,
                  decoration: const InputDecoration(
                    labelText: 'CPF do matriculante',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: matriculanteParentescoCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Vínculo com o aluno',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: matriculanteTelefoneCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Telefone do matriculante',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: matriculanteEmailCtrl,
                  decoration: const InputDecoration(
                    labelText: 'E-mail do matriculante',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: matriculanteDocumentoCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Documento apresentado',
                  ),
                ),
              ),
            ],
          ),
        ],
      ),
      _buildFormSection(
        title: 'Endereço e mapa',
        subtitle:
            'Referência territorial do aluno, localização e dados de residência para cruzamento com transporte.',
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: cepCtrl,
                  decoration: const InputDecoration(labelText: 'CEP'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: ruaCtrl,
                  decoration: const InputDecoration(labelText: 'Rua'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: numeroCtrl,
                  decoration: const InputDecoration(labelText: 'Número'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: complementoEnderecoCtrl,
                  decoration: const InputDecoration(labelText: 'Complemento'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: bairroCtrl,
                  decoration: const InputDecoration(labelText: 'Bairro'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: zonaCtrl,
                  decoration: const InputDecoration(labelText: 'Zona'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: pontoReferenciaCtrl,
            decoration: const InputDecoration(labelText: 'Ponto de referência'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: addressCtrl,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Referência complementar do endereço',
            ),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: latitudeCtrl,
                  decoration: const InputDecoration(labelText: 'Latitude'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: longitudeCtrl,
                  decoration: const InputDecoration(labelText: 'Longitude'),
                ),
              ),
            ],
          ),
        ],
      ),
      _buildFormSection(
        title: 'Transporte',
        subtitle:
            'Fluxo equivalente ao da ficha web, incluindo elegibilidade, dados de embarque e parâmetros do censo.',
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: desejaTransporteCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Deseja utilizar transporte?',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: transporteAprovadoCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Aprovado para transporte?',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: transporteUtilizaCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Transporte escolar público utiliza',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: tipoTransporteCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Tipo de transporte',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: poderPublicoTransporteCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Poder público responsável',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: categoriaTransporteCensoCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Categoria transporte censo',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: distanciaKmCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Distância em km',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: tempoDeslocamentoCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Tempo de deslocamento',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: turnoEmbarqueCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Turno de embarque',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: turnoRetornoCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Turno de retorno',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: localEmbarqueCtrl,
            decoration: const InputDecoration(labelText: 'Local de embarque'),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: precisaMonitorCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Precisa de monitor?',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: embarqueAssistidoCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Embarque assistido?',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: rotaExclusivaCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Precisa de rota exclusiva?',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: carroAdaptadoCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Necessita carro adaptado?',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: emitirCarteirinhaCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Emitir carteirinha ao finalizar?',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: transportCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Apoio escolar / transporte',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: observacoesTransporteCtrl,
            minLines: 3,
            maxLines: 5,
            decoration: const InputDecoration(
              labelText: 'Observações do transporte',
            ),
          ),
        ],
      ),
      _buildFormSection(
        title: 'Saúde e inclusão',
        subtitle:
            'Dados clínicos e pedagógicos para apoio à inclusão e atendimento do estudante.',
        children: [
          TextField(
            controller: deficienciaCtrl,
            decoration: const InputDecoration(labelText: 'Deficiência'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: diagnosticosCtrl,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(labelText: 'Diagnósticos'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: medicacoesCtrl,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(labelText: 'Medicações'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: restricoesSaudeCtrl,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(labelText: 'Restrições de saúde'),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: alergiasCtrl,
            decoration: const InputDecoration(labelText: 'Alergias'),
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: usaCadeiraRodasCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Usa cadeira de rodas?',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: usaMedicacaoControladaCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Usa medicação controlada?',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: peiCtrl,
                  decoration: const InputDecoration(labelText: 'Possui PEI?'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: unidadeSaudeCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Unidade de saúde de referência',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: prontuarioSaudeCtrl,
            decoration: const InputDecoration(
              labelText: 'Número do prontuário de saúde',
            ),
          ),
        ],
      ),
      _buildFormSection(
        title: 'Complementares',
        subtitle:
            'Informações socioeconômicas, convivência e autorizações complementares da ficha do aluno.',
        children: [
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: religiaoCtrl,
                  decoration: const InputDecoration(labelText: 'Religião'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: etniaIndigenaCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Etnia indígena',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: resideComCtrl,
                  decoration: const InputDecoration(labelText: 'Reside com'),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: tipoMoradiaCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Tipo de moradia',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: rendaFamiliarCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Renda familiar',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: cadunicoCtrl,
                  decoration: const InputDecoration(labelText: 'CadÚnico'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: acessoInternetCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Acesso à internet?',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: possuiDispositivoCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Possui dispositivo?',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: autorizaImagemCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Autoriza uso de imagem?',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: recebeBpcCtrl,
                  decoration: const InputDecoration(labelText: 'Recebe BPC?'),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          Row(
            children: [
              Expanded(
                child: TextField(
                  controller: idiomaFamiliarCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Idioma familiar',
                  ),
                ),
              ),
              const SizedBox(width: 12),
              Expanded(
                child: TextField(
                  controller: vulnerabilidadeSocialCtrl,
                  decoration: const InputDecoration(
                    labelText: 'Vulnerabilidade social',
                  ),
                ),
              ),
            ],
          ),
          const SizedBox(height: 12),
          TextField(
            controller: autorizadosBuscaCtrl,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Autorizados para busca do aluno',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: observacoesConvivenciaCtrl,
            minLines: 2,
            maxLines: 4,
            decoration: const InputDecoration(
              labelText: 'Observações de convivência',
            ),
          ),
          const SizedBox(height: 12),
          TextField(
            controller: observacoesGeraisCtrl,
            minLines: 3,
            maxLines: 5,
            decoration: const InputDecoration(labelText: 'Observações gerais'),
          ),
        ],
      ),
    ];
  }

  Widget _buildStudentFormPanel(SecretariaOfflineController controller) {
    return Column(
      children: [
        ..._buildAcademicRecordSections(),
        const SizedBox(height: 22),
        Row(
          children: [
            Expanded(
              child: OutlinedButton.icon(
                onPressed: () async {
                  final doc = await controller.generateDocument(
                    type: 'ESPELHO_CADASTRAL',
                    studentName: studentNameCtrl.text,
                    studentCode: studentCodeCtrl.text,
                    turma: turmaCtrl.text,
                    notes: _buildAcademicNotesSummary(),
                  );
                  if (mounted) {
                    _showSnack('Espelho cadastral salvo em ${doc.filePath}.');
                  }
                },
                icon: const Icon(Icons.article_outlined),
                label: const Text('Gerar espelho local'),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: FilledButton.icon(
                onPressed: () async {
                  if (studentNameCtrl.text.trim().isEmpty) {
                    _showSnack('Informe o nome do aluno.');
                    return;
                  }
                  await controller.createLaunch(
                    channel: 'offline',
                    operation: 'CADASTRO_ALUNO',
                    studentName: studentNameCtrl.text,
                    studentCode: studentCodeCtrl.text,
                    turma: turmaCtrl.text,
                    period: anoLetivoCtrl.text,
                    notes: _buildAcademicNotesSummary(),
                    payload: _buildAcademicPayload(),
                  );
                  _clearStudentForm();
                  if (mounted) {
                    Navigator.of(context).pop();
                    _showSnack('Cadastro local do aluno salvo.');
                  }
                },
                icon: const Icon(Icons.save_outlined),
                label: const Text('Salvar aluno offline'),
              ),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildEnrollmentFormPanel(SecretariaOfflineController controller) {
    return Column(
      children: [
        ..._buildAcademicRecordSections(),
        const SizedBox(height: 22),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            FilledButton.tonalIcon(
              onPressed: () async {
                await controller.createLaunch(
                  channel: 'offline',
                  operation: 'MATRICULA_LOCAL',
                  studentName: studentNameCtrl.text,
                  studentCode: studentCodeCtrl.text,
                  turma: turmaCtrl.text,
                  period: anoLetivoCtrl.text,
                  notes: _buildAcademicNotesSummary(),
                  payload: _buildAcademicPayload(),
                );
                _clearEnrollmentForm();
                if (mounted) {
                  Navigator.of(context).pop();
                  _showSnack('Matrícula local adicionada à fila.');
                }
              },
              icon: const Icon(Icons.app_registration_outlined),
              label: const Text('Registrar matrícula'),
            ),
            FilledButton.tonalIcon(
              onPressed: () async {
                await controller.createLaunch(
                  channel: 'offline',
                  operation: 'REMATRICULA_LOCAL',
                  studentName: studentNameCtrl.text,
                  studentCode: studentCodeCtrl.text,
                  turma: turmaCtrl.text,
                  period: anoLetivoCtrl.text,
                  notes: _buildAcademicNotesSummary(),
                  payload: _buildAcademicPayload(),
                );
                _clearEnrollmentForm();
                if (mounted) {
                  Navigator.of(context).pop();
                  _showSnack('Rematrícula salva localmente.');
                }
              },
              icon: const Icon(Icons.refresh_outlined),
              label: const Text('Registrar rematrícula'),
            ),
            OutlinedButton.icon(
              onPressed: () async {
                final doc = await controller.generateDocument(
                  type: 'DECLARACAO_MATRICULA_LOCAL',
                  studentName: studentNameCtrl.text,
                  studentCode: studentCodeCtrl.text,
                  turma: turmaCtrl.text,
                  notes: _buildAcademicNotesSummary(),
                );
                if (mounted) {
                  _showSnack('Declaração local gerada em ${doc.filePath}.');
                }
              },
              icon: const Icon(Icons.picture_as_pdf_outlined),
              label: const Text('Gerar declaração local'),
            ),
          ],
        ),
      ],
    );
  }

  Widget _buildMovementFormPanel(SecretariaOfflineController controller) {
    return Column(
      children: [
        Row(
          children: [
            Expanded(
              child: TextField(
                controller: studentNameCtrl,
                decoration: const InputDecoration(
                  labelText: 'Aluno',
                  prefixIcon: Icon(Icons.person_outline),
                ),
              ),
            ),
            const SizedBox(width: 12),
            Expanded(
              child: TextField(
                controller: studentCodeCtrl,
                decoration: const InputDecoration(
                  labelText: 'Código local',
                  prefixIcon: Icon(Icons.badge_outlined),
                ),
              ),
            ),
          ],
        ),
        const SizedBox(height: 12),
        TextField(
          controller: turmaCtrl,
          decoration: const InputDecoration(
            labelText: 'Turma atual',
            prefixIcon: Icon(Icons.groups_outlined),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: destinationCtrl,
          decoration: const InputDecoration(
            labelText: 'Destino / nova turma / nova escola',
            prefixIcon: Icon(Icons.place_outlined),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: movementReasonCtrl,
          decoration: const InputDecoration(
            labelText: 'Motivo da movimentação',
            prefixIcon: Icon(Icons.live_help_outlined),
          ),
        ),
        const SizedBox(height: 12),
        TextField(
          controller: notesCtrl,
          minLines: 3,
          maxLines: 5,
          decoration: const InputDecoration(
            labelText: 'Observações / protocolo / documentos anexos',
            alignLabelWithHint: true,
            prefixIcon: Icon(Icons.note_outlined),
          ),
        ),
        const SizedBox(height: 22),
        Wrap(
          spacing: 12,
          runSpacing: 12,
          children: [
            FilledButton.tonalIcon(
              onPressed: () async {
                await controller.createLaunch(
                  channel: 'offline',
                  operation: 'TRANSFERENCIA_SAIDA',
                  studentName: studentNameCtrl.text,
                  studentCode: studentCodeCtrl.text,
                  turma: turmaCtrl.text,
                  period: periodCtrl.text,
                  notes:
                      'Destino: ${destinationCtrl.text}\nMotivo: ${movementReasonCtrl.text}\n${notesCtrl.text}',
                );
                _clearMovementForm();
                if (mounted) {
                  Navigator.of(context).pop();
                  _showSnack('Transferência de saída registrada.');
                }
              },
              icon: const Icon(Icons.north_east_outlined),
              label: const Text('Transferência de saída'),
            ),
            FilledButton.tonalIcon(
              onPressed: () async {
                await controller.createLaunch(
                  channel: 'offline',
                  operation: 'TRANSFERENCIA_ENTRADA',
                  studentName: studentNameCtrl.text,
                  studentCode: studentCodeCtrl.text,
                  turma: turmaCtrl.text,
                  period: periodCtrl.text,
                  notes:
                      'Origem: ${destinationCtrl.text}\nMotivo: ${movementReasonCtrl.text}\n${notesCtrl.text}',
                );
                _clearMovementForm();
                if (mounted) {
                  Navigator.of(context).pop();
                  _showSnack('Transferência de entrada registrada.');
                }
              },
              icon: const Icon(Icons.south_west_outlined),
              label: const Text('Transferência de entrada'),
            ),
            FilledButton.tonalIcon(
              onPressed: () async {
                await controller.createLaunch(
                  channel: 'offline',
                  operation: 'REMANEJAMENTO_TURMA',
                  studentName: studentNameCtrl.text,
                  studentCode: studentCodeCtrl.text,
                  turma: turmaCtrl.text,
                  period: periodCtrl.text,
                  notes:
                      'Novo destino: ${destinationCtrl.text}\nMotivo: ${movementReasonCtrl.text}\n${notesCtrl.text}',
                );
                _clearMovementForm();
                if (mounted) {
                  Navigator.of(context).pop();
                  _showSnack('Remanejamento salvo na fila.');
                }
              },
              icon: const Icon(Icons.alt_route_outlined),
              label: const Text('Remanejamento'),
            ),
            OutlinedButton.icon(
              onPressed: () async {
                final doc = await controller.generateDocument(
                  type: 'COMPROVANTE_MOVIMENTACAO',
                  studentName: studentNameCtrl.text,
                  studentCode: studentCodeCtrl.text,
                  turma: turmaCtrl.text,
                  notes:
                      'Destino: ${destinationCtrl.text}\nMotivo: ${movementReasonCtrl.text}\n${notesCtrl.text}',
                );
                if (mounted) {
                  _showSnack('Comprovante salvo em ${doc.filePath}.');
                }
              },
              icon: const Icon(Icons.receipt_long_outlined),
              label: const Text('Comprovante local'),
            ),
          ],
        ),
      ],
    );
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    final destinations = controller.isSchoolScoped
        ? const [
            _NavMeta('Dashboard da Escola', Icons.space_dashboard_outlined),
            _NavMeta('Alunos', Icons.people_alt_outlined),
            _NavMeta('Matrículas', Icons.how_to_reg_outlined),
            _NavMeta('Movimentações', Icons.compare_arrows_outlined),
            _NavMeta('Documentos', Icons.description_outlined),
            _NavMeta('Pendências', Icons.rule_folder_outlined),
            _NavMeta('Conferência de dados', Icons.fact_check_outlined),
            _NavMeta('Sincronização', Icons.sync_alt_outlined),
            _NavMeta('Relatórios locais', Icons.assessment_outlined),
            _NavMeta('Configurações da escola', Icons.settings_outlined),
          ]
        : const [
            _NavMeta('Painel da Secretaria', Icons.space_dashboard_outlined),
            _NavMeta('Alunos', Icons.people_alt_outlined),
            _NavMeta('Matrículas', Icons.how_to_reg_outlined),
            _NavMeta('Movimentações', Icons.compare_arrows_outlined),
            _NavMeta('Documentos', Icons.description_outlined),
            _NavMeta('Pendências', Icons.rule_folder_outlined),
            _NavMeta('Conferência de dados', Icons.fact_check_outlined),
            _NavMeta('Sincronização', Icons.sync_alt_outlined),
            _NavMeta('Relatórios locais', Icons.assessment_outlined),
            _NavMeta('Configurações da escola', Icons.settings_outlined),
          ];

    return Scaffold(
      body: Row(
        children: [
          NavigationRail(
            selectedIndex: selectedIndex,
            onDestinationSelected: (value) =>
                setState(() => selectedIndex = value),
            labelType: NavigationRailLabelType.all,
            leading: Padding(
              padding: const EdgeInsets.fromLTRB(12, 20, 12, 8),
              child: Column(
                children: [
                  Container(
                    width: 56,
                    height: 56,
                    decoration: BoxDecoration(
                      color: Theme.of(
                        context,
                      ).colorScheme.primary.withValues(alpha: 0.12),
                      borderRadius: BorderRadius.circular(16),
                    ),
                    child: Icon(
                      Icons.school_outlined,
                      color: Theme.of(context).colorScheme.primary,
                    ),
                  ),
                  const SizedBox(height: 12),
                  const Text(
                    'SETRANE\nDesktop',
                    textAlign: TextAlign.center,
                    style: TextStyle(fontWeight: FontWeight.w800),
                  ),
                ],
              ),
            ),
            destinations: destinations
                .map(
                  (item) => NavigationRailDestination(
                    icon: Icon(item.icon),
                    label: Text(item.label),
                  ),
                )
                .toList(),
          ),
          const VerticalDivider(width: 1),
          Expanded(
            child: SafeArea(
              child: Padding(
                padding: const EdgeInsets.all(20),
                child: Column(
                  children: [
                    _buildHeader(controller),
                    const SizedBox(height: 18),
                    Expanded(
                      child: IndexedStack(
                        index: selectedIndex,
                        children: [
                          _buildDashboardPage(controller),
                          _buildStudentsPage(controller),
                          _buildEnrollmentPage(controller),
                          _buildMovementsPage(controller),
                          _buildDocumentsPage(controller),
                          _buildValidationsPage(controller),
                          _buildConferencePage(controller),
                          _buildQueuePage(controller),
                          _buildReportsPage(controller),
                          _buildSettingsPage(controller),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
          ),
        ],
      ),
    );
  }

  Widget _buildDashboardPage(SecretariaOfflineController controller) {
    final statusMeta = controller.operationStatusMeta;
    final localStudents = controller.localStudents;
    final enrollmentCount = controller.entriesByOperation('MATRICULA_LOCAL');
    final movementCount = controller.movementEntries.length;
    final draftDocs = controller.documentByStatus('rascunho');
    final centralStudents = controller.centralStudentCount;

    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(22),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [statusMeta.color.withValues(alpha: 0.18), Colors.white],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(22),
          ),
          child: Row(
            children: [
              CircleAvatar(
                radius: 28,
                backgroundColor: statusMeta.color.withValues(alpha: 0.16),
                child: Icon(statusMeta.icon, color: statusMeta.color),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      statusMeta.title,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      'Unidade: ${controller.selectedUnitName} • Período ativo: ${controller.activePeriodLabel}',
                      style: TextStyle(color: Colors.grey.shade800),
                    ),
                    const SizedBox(height: 4),
                    Text(
                      statusMeta.description,
                      style: TextStyle(color: Colors.grey.shade700),
                    ),
                  ],
                ),
              ),
              FilledButton.icon(
                onPressed: () async {
                  await controller.checkConnectivityAndSync(forceSync: true);
                  if (mounted) _showSnack('Rotina de sincronização executada.');
                },
                icon: const Icon(Icons.sync),
                label: const Text('Sincronizar agora'),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: [
            _summaryCard(
              'Base local',
              controller.storageReady ? 'Pronta' : 'Preparando',
              Icons.storage_outlined,
            ),
            _summaryCard(
              'Pendentes de envio',
              controller.pendingQueueCount.toString(),
              Icons.schedule_send_outlined,
            ),
            _summaryCard(
              'Documentos em rascunho',
              draftDocs.toString(),
              Icons.description_outlined,
            ),
            _summaryCard(
              'Validações pendentes',
              controller.openValidationCount.toString(),
              Icons.rule_outlined,
            ),
            _summaryCard(
              'Conflitos aguardando revisão',
              controller.conflictCount.toString(),
              Icons.alt_route_outlined,
            ),
            _summaryCard(
              'Última sincronização',
              controller.lastSyncAt == null ? 'Ainda não' : 'Concluída',
              Icons.cloud_done_outlined,
            ),
            _summaryCard(
              'Base central carregada',
              controller.isAuthenticated
                  ? '$centralStudents aluno(s)'
                  : 'Faça login',
              Icons.apartment_outlined,
            ),
          ],
        ),
        const SizedBox(height: 18),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 3,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Painel operacional da secretaria',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Expanded(
                          child: GridView.count(
                            crossAxisCount: 2,
                            mainAxisSpacing: 14,
                            crossAxisSpacing: 14,
                            childAspectRatio: 1.65,
                            children: [
                              _dashboardBlock(
                                'Alunos',
                                '$localStudents local / $centralStudents central',
                                'Consulta e cadastro local com leitura da base oficial quando houver autenticação.',
                                Icons.people_alt_outlined,
                              ),
                              _dashboardBlock(
                                'Matrículas',
                                '$enrollmentCount lançamento(s) de matrícula',
                                'Inclui criação local, conferência, situação e envio posterior.',
                                Icons.how_to_reg_outlined,
                              ),
                              _dashboardBlock(
                                'Movimentações',
                                '$movementCount movimentação(ões)',
                                'Transferência, remanejamento, abandono, cancelamento e regularização.',
                                Icons.compare_arrows_outlined,
                              ),
                              _dashboardBlock(
                                'Documentos',
                                '${controller.documentCount} arquivo(s) local(is)',
                                'Declarações, comprovantes, espelhos cadastrais e relatórios de sincronização.',
                                Icons.description_outlined,
                              ),
                              _dashboardBlock(
                                'Pendências',
                                '${controller.openValidationCount} item(ns) em aberto',
                                'Validações cadastrais, acadêmicas e de sincronização aguardando análise.',
                                Icons.task_alt_outlined,
                              ),
                              _dashboardBlock(
                                'Conferência',
                                '${controller.syncedQueueCount} item(ns) consolidados',
                                'Comparação entre base local e espelho central com suporte a conflitos.',
                                Icons.fact_check_outlined,
                              ),
                            ],
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                flex: 2,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: ListView(
                      children: [
                        const Text(
                          'Situação da unidade',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 16),
                        _detailTile(
                          'Unidade logada',
                          controller.selectedUnitName,
                        ),
                        _detailTile(
                          'Período letivo',
                          controller.activePeriodLabel,
                        ),
                        _detailTile(
                          'Última sincronização',
                          controller.lastSyncLabel,
                        ),
                        _detailTile(
                          'Internet',
                          controller.online ? 'Disponível' : 'Indisponível',
                        ),
                        _detailTile(
                          'Modo de conectividade',
                          controller.connectivityModeLabel,
                        ),
                        _detailTile('Base local', controller.storageLabel),
                        _detailTile(
                          'Conectado ao backend',
                          controller.isAuthenticated
                              ? 'Sim, como ${controller.backendUserLabel}'
                              : 'Não',
                        ),
                        _detailTile(
                          'Fila pendente',
                          '${controller.pendingQueueCount} item(ns)',
                        ),
                        _detailTile(
                          'Rascunhos documentais',
                          '$draftDocs arquivo(s)',
                        ),
                        const SizedBox(height: 18),
                        const Text(
                          'Ações rápidas',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 10,
                          runSpacing: 10,
                          children: [
                            FilledButton.tonalIcon(
                              onPressed: () =>
                                  setState(() => selectedIndex = 1),
                              icon: const Icon(Icons.person_add_alt_1_outlined),
                              label: const Text('Novo aluno'),
                            ),
                            FilledButton.tonalIcon(
                              onPressed: () =>
                                  setState(() => selectedIndex = 2),
                              icon: const Icon(Icons.app_registration_outlined),
                              label: const Text('Nova matrícula'),
                            ),
                            FilledButton.tonalIcon(
                              onPressed: () =>
                                  setState(() => selectedIndex = 7),
                              icon: const Icon(Icons.sync_problem_outlined),
                              label: const Text('Ver fila'),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildStudentsPage(SecretariaOfflineController controller) {
    final students = controller.studentEntries;
    final backendStudents = controller.centralStudents;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: [
            _summaryCard(
              'Alunos locais',
              controller.localStudents.toString(),
              Icons.people_alt_outlined,
            ),
            _summaryCard(
              'Com pendência documental',
              controller.studentsWithOpenValidation.toString(),
              Icons.assignment_late_outlined,
            ),
            _summaryCard(
              'Com transporte informado',
              controller.studentsWithTransport.toString(),
              Icons.directions_bus_outlined,
            ),
            _summaryCard(
              'Sincronizados',
              controller.studentsSynced.toString(),
              Icons.cloud_done_outlined,
            ),
            _summaryCard(
              'Alunos da base central',
              controller.centralStudentCount.toString(),
              Icons.cloud_queue_outlined,
            ),
          ],
        ),
        const SizedBox(height: 18),
        _buildSectionHeader(
          title: 'Cadastro de alunos',
          subtitle:
              'Organize a operação da unidade com foco em consulta rápida, qualidade cadastral e lançamento local pronto para sincronização.',
          actions: [
            FilledButton.icon(
              onPressed: () => _openSlidePanel(
                title: 'Novo aluno offline',
                subtitle:
                    'Cadastre o aluno localmente, valide os campos essenciais e gere o espelho cadastral sem depender da internet.',
                child: _buildStudentFormPanel(controller),
              ),
              icon: const Icon(Icons.person_add_alt_1_outlined),
              label: const Text('Novo aluno'),
            ),
            OutlinedButton.icon(
              onPressed: controller.isAuthenticated
                  ? () async {
                      await controller.refreshCentralData();
                      if (mounted) {
                        _showSnack('Base central de alunos recarregada.');
                      }
                    }
                  : null,
              icon: const Icon(Icons.cloud_sync_outlined),
              label: const Text('Atualizar base central'),
            ),
          ],
        ),
        const SizedBox(height: 18),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 2,
                child: _buildContextPanel(
                  title: 'Operação local organizada',
                  description:
                      'O cadastro agora fica separado da consulta. A escola enxerga rapidamente a situação da base e abre o formulário em painel lateral apenas quando precisa lançar ou ajustar um aluno.',
                  bullets: [
                    'Cadastre alunos offline e gere espelho cadastral sem sair da tela.',
                    'Atualize a base central quando a internet estiver disponível.',
                    'Use a listagem como visão operacional contínua da unidade.',
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                flex: 3,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child:
                        controller.isAuthenticated && backendStudents.isNotEmpty
                        ? ListView.separated(
                            itemCount: backendStudents.length,
                            separatorBuilder: (_, __) =>
                                const Divider(height: 28),
                            itemBuilder: (context, index) {
                              final item = backendStudents[index];
                              return ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: const CircleAvatar(
                                  child: Icon(Icons.cloud_done_outlined),
                                ),
                                title: Text(
                                  item['display_name'] as String? ?? 'Sem nome',
                                ),
                                subtitle: Text(
                                  '${item['display_turma']} • ${item['display_ano']} • ${item['cpf_masked'] ?? 'CPF oculto'}',
                                ),
                                trailing: Text(
                                  item['status']?.toString() ?? 'ativo',
                                ),
                              );
                            },
                          )
                        : students.isEmpty
                        ? const Center(
                            child: Text('Nenhum aluno local registrado.'),
                          )
                        : ListView.separated(
                            itemCount: students.length,
                            separatorBuilder: (_, __) =>
                                const Divider(height: 28),
                            itemBuilder: (context, index) {
                              final item = students[index];
                              return ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: CircleAvatar(
                                  backgroundColor: _statusColor(
                                    item['status'] as String? ?? 'pending',
                                  ).withValues(alpha: 0.12),
                                  child: const Icon(Icons.person_outline),
                                ),
                                title: Text(
                                  item['studentName'] as String? ?? 'Sem nome',
                                ),
                                subtitle: Text(
                                  '${item['studentCode'] ?? 'Sem ID'} • ${item['turma'] ?? 'Sem turma'} • ${item['unitName']}',
                                ),
                                trailing: Column(
                                  mainAxisAlignment: MainAxisAlignment.center,
                                  crossAxisAlignment: CrossAxisAlignment.end,
                                  children: [
                                    Text(
                                      item['statusLabel'] as String? ??
                                          'Pendente',
                                    ),
                                    Text(
                                      item['createdAtLabel'] as String? ??
                                          'N/I',
                                      style: TextStyle(
                                        fontSize: 12,
                                        color: Colors.grey.shade700,
                                      ),
                                    ),
                                  ],
                                ),
                              );
                            },
                          ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildEnrollmentPage(SecretariaOfflineController controller) {
    final items = controller.enrollmentEntries;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: [
            _summaryCard(
              'Matrículas locais',
              items.length.toString(),
              Icons.how_to_reg_outlined,
            ),
            _summaryCard(
              'Pendentes de sincronização',
              controller.enrollmentsPending.toString(),
              Icons.schedule_outlined,
            ),
            _summaryCard(
              'Com ajuste pendente',
              controller.enrollmentsWithValidation.toString(),
              Icons.rule_outlined,
            ),
            _summaryCard(
              'Sincronizadas',
              controller.enrollmentsSynced.toString(),
              Icons.cloud_done_outlined,
            ),
          ],
        ),
        const SizedBox(height: 18),
        _buildSectionHeader(
          title: 'Matrículas e rematrículas',
          subtitle:
              'Conduza a operação da secretaria com clareza: cada lançamento entra na fila certa, com rastreabilidade e possibilidade de documento local.',
          actions: [
            FilledButton.icon(
              onPressed: () => _openSlidePanel(
                title: 'Nova matrícula offline',
                subtitle:
                    'Registre matrícula inicial, rematrícula ou uma declaração local em um fluxo lateral mais limpo e próximo ao padrão web.',
                child: _buildEnrollmentFormPanel(controller),
              ),
              icon: const Icon(Icons.app_registration_outlined),
              label: const Text('Nova matrícula'),
            ),
          ],
        ),
        const SizedBox(height: 18),
        Expanded(
          child: Row(
            children: [
              Expanded(
                flex: 2,
                child: _buildContextPanel(
                  title: 'Lançamento acadêmico contínuo',
                  description:
                      'Separe bem consulta e produção. A secretaria acompanha a fila local aqui e abre o cadastro apenas quando precisar registrar nova matrícula ou rematrícula.',
                  bullets: [
                    'Matrícula inicial e rematrícula no mesmo fluxo lateral.',
                    'Documentos locais ligados ao registro acadêmico.',
                    'Rastreabilidade por status para revisão antes da sincronização.',
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                flex: 3,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: items.isEmpty
                        ? const Center(
                            child: Text('Nenhuma matrícula local registrada.'),
                          )
                        : ListView.separated(
                            itemCount: items.length,
                            separatorBuilder: (_, __) =>
                                const Divider(height: 28),
                            itemBuilder: (context, index) {
                              final item = items[index];
                              return ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: CircleAvatar(
                                  backgroundColor: _statusColor(
                                    item['status'] as String? ?? 'pending',
                                  ).withValues(alpha: 0.12),
                                  child: const Icon(Icons.school_outlined),
                                ),
                                title: Text(
                                  item['studentName'] as String? ?? 'Sem aluno',
                                ),
                                subtitle: Text(
                                  '${item['operationLabel']} • ${item['turma']} • ${item['period']}',
                                ),
                                trailing: Text(
                                  item['statusLabel'] as String? ?? 'Pendente',
                                ),
                              );
                            },
                          ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildMovementsPage(SecretariaOfflineController controller) {
    final items = controller.movementEntries;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: [
            _summaryCard(
              'Movimentações',
              items.length.toString(),
              Icons.compare_arrows_outlined,
            ),
            _summaryCard(
              'Transferências',
              controller.entriesByOperationPrefix('TRANSFERENCIA').toString(),
              Icons.swap_horiz_outlined,
            ),
            _summaryCard(
              'Cancelamentos',
              controller
                  .entriesByOperation('CANCELAMENTO_MATRICULA')
                  .toString(),
              Icons.cancel_outlined,
            ),
            _summaryCard(
              'Remanejamentos',
              controller.entriesByOperation('REMANEJAMENTO_TURMA').toString(),
              Icons.alt_route_outlined,
            ),
          ],
        ),
        const SizedBox(height: 18),
        _buildSectionHeader(
          title: 'Movimentação escolar',
          subtitle:
              'Controle saídas, entradas e remanejamentos com um fluxo operacional mais claro, preservando a visão da fila e os comprovantes locais.',
          actions: [
            FilledButton.icon(
              onPressed: () => _openSlidePanel(
                title: 'Nova movimentação offline',
                subtitle:
                    'Registre transferências e remanejamentos em um painel lateral com foco em motivo, destino e documentação local.',
                child: _buildMovementFormPanel(controller),
              ),
              icon: const Icon(Icons.compare_arrows_outlined),
              label: const Text('Nova movimentação'),
            ),
          ],
        ),
        const SizedBox(height: 18),
        Expanded(
          child: Row(
            children: [
              Expanded(
                flex: 2,
                child: _buildContextPanel(
                  title: 'Ciclo de vida escolar',
                  description:
                      'Use esta área para organizar a vida escolar do aluno fora da tela de cadastro, com prioridade para rastreabilidade e conferência do destino.',
                  bullets: [
                    'Transferências de entrada e saída em fluxo separado.',
                    'Remanejamentos com justificativa e destino registrado.',
                    'Comprovante local emitido antes da consolidação central.',
                  ],
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                flex: 3,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: items.isEmpty
                        ? const Center(
                            child: Text(
                              'Nenhuma movimentação local registrada.',
                            ),
                          )
                        : ListView.separated(
                            itemCount: items.length,
                            separatorBuilder: (_, __) =>
                                const Divider(height: 28),
                            itemBuilder: (context, index) {
                              final item = items[index];
                              return ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: CircleAvatar(
                                  backgroundColor: _statusColor(
                                    item['status'] as String? ?? 'pending',
                                  ).withValues(alpha: 0.12),
                                  child: const Icon(
                                    Icons.compare_arrows_outlined,
                                  ),
                                ),
                                title: Text(
                                  item['studentName'] as String? ?? 'Sem aluno',
                                ),
                                subtitle: Text(
                                  '${item['operationLabel']} • ${item['notesSummary']}',
                                ),
                                trailing: Text(
                                  item['statusLabel'] as String? ?? 'Pendente',
                                ),
                              );
                            },
                          ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildHeader(SecretariaOfflineController controller) {
    final onlineColor = controller.online
        ? const Color(0xFF15803D)
        : const Color(0xFFB91C1C);
    return Row(
      children: [
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              const Text(
                'Módulo 4 · Secretaria escolar offline',
                style: TextStyle(fontSize: 24, fontWeight: FontWeight.w800),
              ),
              const SizedBox(height: 6),
              Text(
                'Operação local, sincronização automática, documentos, conferência e tratamento de conflitos.',
                style: TextStyle(color: Colors.grey.shade700),
              ),
            ],
          ),
        ),
        const SizedBox(width: 16),
        SizedBox(
          width: 250,
          child: DropdownButtonFormField<String>(
            initialValue: controller.selectedUnitId,
            isExpanded: true,
            decoration: const InputDecoration(
              labelText: 'Unidade ativa',
              prefixIcon: Icon(Icons.apartment_outlined),
            ),
            items: controller.units
                .map(
                  (unit) => DropdownMenuItem<String>(
                    value: unit.id,
                    child: Text('${unit.name} · ${unit.kind}'),
                  ),
                )
                .toList(),
            onChanged: (value) {
              if (value != null) {
                widget.controller.selectUnit(value);
              }
            },
          ),
        ),
        const SizedBox(width: 12),
        Container(
          padding: const EdgeInsets.symmetric(horizontal: 16, vertical: 12),
          decoration: BoxDecoration(
            color: onlineColor.withValues(alpha: 0.12),
            borderRadius: BorderRadius.circular(16),
          ),
          child: Row(
            children: [
              Icon(
                controller.online ? Icons.wifi : Icons.wifi_off,
                color: onlineColor,
              ),
              const SizedBox(width: 10),
              Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    controller.online
                        ? 'Internet disponível'
                        : 'Trabalhando offline',
                  ),
                  Text(
                    controller.lastOnlineCheckLabel,
                    style: TextStyle(fontSize: 12, color: Colors.grey.shade700),
                  ),
                ],
              ),
            ],
          ),
        ),
        const SizedBox(width: 12),
        OutlinedButton.icon(
          onPressed: widget.onLockSession,
          icon: const Icon(Icons.lock_outline),
          label: const Text('Bloquear'),
        ),
        const SizedBox(width: 12),
        FilledButton.icon(
          onPressed: () async {
            await widget.controller.setBackendUrl(backendCtrl.text.trim());
            await widget.controller.checkConnectivityAndSync(forceSync: true);
            if (mounted) _showSnack('Sincronização manual executada.');
          },
          icon: const Icon(Icons.sync),
          label: const Text('Sincronizar'),
        ),
      ],
    );
  }

  Widget _buildLaunchForm({required String channel}) {
    final controller = widget.controller;
    final title = channel == 'offline'
        ? 'Salvar lançamento local'
        : 'Registrar lançamento sincronizável';
    final buttonLabel = channel == 'offline'
        ? 'Gravar no modo offline'
        : 'Registrar e sincronizar';

    return Column(
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: [
            _summaryCard(
              'Pendentes',
              controller.pendingQueueCount.toString(),
              Icons.schedule_send_outlined,
            ),
            _summaryCard(
              'Conflitos',
              controller.conflictCount.toString(),
              Icons.alt_route_outlined,
            ),
            _summaryCard(
              'Documentos',
              controller.documentCount.toString(),
              Icons.article_outlined,
            ),
            _summaryCard(
              'Validações',
              controller.validationCount.toString(),
              Icons.task_alt_outlined,
            ),
          ],
        ),
        const SizedBox(height: 18),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                flex: 3,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: ListView(
                      children: [
                        Text(
                          title,
                          style: const TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Cada lançamento gera um item de fila, guarda rastreabilidade local e entra no mecanismo de sincronização/validação.',
                          style: TextStyle(color: Colors.grey.shade700),
                        ),
                        const SizedBox(height: 18),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: studentNameCtrl,
                                decoration: const InputDecoration(
                                  labelText: 'Estudante',
                                  prefixIcon: Icon(Icons.person_outline),
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: TextField(
                                controller: studentCodeCtrl,
                                decoration: const InputDecoration(
                                  labelText: 'Matrícula / ID',
                                  prefixIcon: Icon(Icons.badge_outlined),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: turmaCtrl,
                                decoration: const InputDecoration(
                                  labelText: 'Turma',
                                  prefixIcon: Icon(Icons.groups_outlined),
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: TextField(
                                controller: periodCtrl,
                                decoration: const InputDecoration(
                                  labelText: 'Período letivo',
                                  prefixIcon: Icon(
                                    Icons.calendar_month_outlined,
                                  ),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: notesCtrl,
                          minLines: 4,
                          maxLines: 6,
                          decoration: const InputDecoration(
                            labelText: 'Observações / lançamento local',
                            alignLabelWithHint: true,
                            prefixIcon: Icon(Icons.edit_note_outlined),
                          ),
                        ),
                        const SizedBox(height: 20),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: () async {
                                  final doc = await controller.generateDocument(
                                    type: channel == 'offline'
                                        ? 'COMPROVANTE_OFFLINE'
                                        : 'DECLARACAO_ATENDIMENTO',
                                    studentName: studentNameCtrl.text,
                                    studentCode: studentCodeCtrl.text,
                                    turma: turmaCtrl.text,
                                    notes: notesCtrl.text,
                                  );
                                  if (mounted) {
                                    _showSnack(
                                      'Documento local gerado em ${doc.filePath}',
                                    );
                                  }
                                },
                                icon: const Icon(Icons.description_outlined),
                                label: const Text('Gerar documento local'),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: FilledButton.icon(
                                onPressed: () => _submitLaunch(channel),
                                icon: const Icon(Icons.save_outlined),
                                label: Text(buttonLabel),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                flex: 2,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: ListView(
                      children: [
                        const Text(
                          'Conectividade e sincronização',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 14),
                        TextField(
                          controller: backendCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Backend base URL',
                            prefixIcon: Icon(Icons.link_outlined),
                          ),
                        ),
                        const SizedBox(height: 12),
                        SwitchListTile.adaptive(
                          value: controller.autoSyncEnabled,
                          title: const Text('Sincronização automática'),
                          subtitle: const Text(
                            'Executa tentativas sempre que houver internet disponível.',
                          ),
                          contentPadding: EdgeInsets.zero,
                          onChanged: (value) => controller.setAutoSync(value),
                        ),
                        const SizedBox(height: 10),
                        _detailTile(
                          'Última sincronização',
                          controller.lastSyncLabel,
                        ),
                        _detailTile(
                          'Fila pendente',
                          '${controller.pendingQueueCount} item(ns)',
                        ),
                        _detailTile(
                          'Conflitos em aberto',
                          '${controller.conflictCount} item(ns)',
                        ),
                        _detailTile(
                          'Documentos locais',
                          '${controller.documentCount} arquivo(s)',
                        ),
                        const SizedBox(height: 18),
                        OutlinedButton.icon(
                          onPressed: () async {
                            await controller.checkConnectivityAndSync(
                              forceSync: true,
                            );
                            if (mounted) {
                              _showSnack('Verificação de internet concluída.');
                            }
                          },
                          icon: const Icon(Icons.wifi_find_outlined),
                          label: const Text('Testar conexão e sincronizar'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildQueuePage(SecretariaOfflineController controller) {
    final pending = controller.queue;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: [
            _summaryCard(
              'Na fila',
              controller.queue.length.toString(),
              Icons.queue_outlined,
            ),
            _summaryCard(
              'Sincronizados',
              controller.syncedQueueCount.toString(),
              Icons.cloud_done_outlined,
            ),
            _summaryCard(
              'Com conflito',
              controller.conflictCount.toString(),
              Icons.warning_amber_outlined,
            ),
            _summaryCard(
              'Falhas',
              controller.failedQueueCount.toString(),
              Icons.error_outline,
            ),
          ],
        ),
        const SizedBox(height: 18),
        Expanded(
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: pending.isEmpty
                  ? const Center(
                      child: Text('Nenhum item na fila de sincronização.'),
                    )
                  : ListView.separated(
                      itemCount: pending.length,
                      separatorBuilder: (_, __) => const Divider(height: 28),
                      itemBuilder: (context, index) {
                        final item = pending[index];
                        final status = item['status'] as String? ?? 'pending';
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: CircleAvatar(
                            backgroundColor: _statusColor(
                              status,
                            ).withValues(alpha: 0.12),
                            child: Icon(
                              _statusIcon(status),
                              color: _statusColor(status),
                            ),
                          ),
                          title: Text(
                            item['studentName'] as String? ?? 'Sem estudante',
                          ),
                          subtitle: Padding(
                            padding: const EdgeInsets.only(top: 6),
                            child: Column(
                              crossAxisAlignment: CrossAxisAlignment.start,
                              children: [
                                Text(
                                  '${item['operation']} • ${item['unitName']} • ${item['turma']} • ${item['period']}',
                                ),
                                const SizedBox(height: 4),
                                Text(
                                  'Status: $status • Criado em ${_formatDate(item['createdAt'] as String?)}',
                                  style: TextStyle(color: Colors.grey.shade700),
                                ),
                                if ((item['errorMessage'] as String?)
                                        ?.isNotEmpty ??
                                    false)
                                  Text(
                                    item['errorMessage'] as String,
                                    style: const TextStyle(
                                      color: Color(0xFFB91C1C),
                                    ),
                                  ),
                              ],
                            ),
                          ),
                          trailing: Wrap(
                            spacing: 8,
                            children: [
                              OutlinedButton(
                                onPressed: status == 'conflict'
                                    ? () => controller.resolveConflictFromQueue(
                                        item['id'] as String,
                                        'keep_local',
                                      )
                                    : () => controller.retryQueueItem(
                                        item['id'] as String,
                                      ),
                                child: Text(
                                  status == 'conflict'
                                      ? 'Usar local'
                                      : 'Reenviar',
                                ),
                              ),
                              if (status == 'conflict')
                                OutlinedButton(
                                  onPressed: () =>
                                      controller.resolveConflictFromQueue(
                                        item['id'] as String,
                                        'keep_server',
                                      ),
                                  child: const Text('Manter central'),
                                ),
                            ],
                          ),
                        );
                      },
                    ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildDocumentsPage(SecretariaOfflineController controller) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: [
            _summaryCard(
              'Emitidos',
              controller.documentCount.toString(),
              Icons.insert_drive_file_outlined,
            ),
            _summaryCard(
              'Autorizações',
              controller.documentByType('AUTORIZACAO_TRANSFERENCIA').toString(),
              Icons.assignment_turned_in_outlined,
            ),
            _summaryCard(
              'Comprovantes offline',
              controller.documentByType('COMPROVANTE_OFFLINE').toString(),
              Icons.offline_pin_outlined,
            ),
            _summaryCard(
              'Relatórios sync',
              controller.documentByType('RELATORIO_SINCRONIZACAO').toString(),
              Icons.sync_problem_outlined,
            ),
            _summaryCard(
              'Rascunhos',
              controller.documentByStatus('rascunho').toString(),
              Icons.description_outlined,
            ),
          ],
        ),
        const SizedBox(height: 18),
        Expanded(
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: controller.documents.isEmpty
                  ? const Center(child: Text('Nenhum documento local emitido.'))
                  : ListView.separated(
                      itemCount: controller.documents.length,
                      separatorBuilder: (_, __) => const Divider(height: 28),
                      itemBuilder: (context, index) {
                        final doc = controller.documents[index];
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: const CircleAvatar(
                            child: Icon(Icons.description_outlined),
                          ),
                          title: Text(doc.title),
                          subtitle: Text(
                            '${doc.type} • ${doc.unitName} • ${_formatDate(doc.createdAt)}',
                          ),
                          trailing: SizedBox(
                            width: 360,
                            child: Row(
                              mainAxisAlignment: MainAxisAlignment.end,
                              children: [
                                Expanded(
                                  child: Text(
                                    doc.filePath,
                                    overflow: TextOverflow.ellipsis,
                                    textAlign: TextAlign.right,
                                    style: TextStyle(
                                      fontSize: 12,
                                      color: Colors.grey.shade700,
                                    ),
                                  ),
                                ),
                                const SizedBox(width: 8),
                                OutlinedButton(
                                  onPressed: () => _showDocumentPreview(doc),
                                  child: const Text('Visualizar'),
                                ),
                              ],
                            ),
                          ),
                        );
                      },
                    ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildValidationsPage(SecretariaOfflineController controller) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: [
            _summaryCard(
              'Pendências',
              controller.validationCount.toString(),
              Icons.pending_actions_outlined,
            ),
            _summaryCard(
              'Conflitos',
              controller.conflictCount.toString(),
              Icons.compare_arrows_outlined,
            ),
            _summaryCard(
              'Revisões necessárias',
              controller.validationByStatus('aberta').toString(),
              Icons.rate_review_outlined,
            ),
            _summaryCard(
              'Resolvidas',
              controller.validationByStatus('resolvida').toString(),
              Icons.check_circle_outline,
            ),
          ],
        ),
        const SizedBox(height: 18),
        Expanded(
          child: Card(
            child: Padding(
              padding: const EdgeInsets.all(20),
              child: controller.validations.isEmpty
                  ? const Center(child: Text('Nenhuma validação pendente.'))
                  : ListView.separated(
                      itemCount: controller.validations.length,
                      separatorBuilder: (_, __) => const Divider(height: 28),
                      itemBuilder: (context, index) {
                        final item = controller.validations[index];
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: CircleAvatar(
                            backgroundColor: _statusColor(
                              item.status,
                            ).withValues(alpha: 0.12),
                            child: Icon(
                              Icons.rule_outlined,
                              color: _statusColor(item.status),
                            ),
                          ),
                          title: Text(item.title),
                          subtitle: Text(
                            '${item.unitName} • ${item.description}',
                          ),
                          trailing: item.status == 'aberta'
                              ? FilledButton.tonal(
                                  onPressed: () async {
                                    await controller.resolveValidation(item.id);
                                    if (mounted) {
                                      _showSnack(
                                        'Validação marcada como resolvida.',
                                      );
                                    }
                                  },
                                  child: const Text('Marcar resolvida'),
                                )
                              : const Text('Resolvida'),
                        );
                      },
                    ),
            ),
          ),
        ),
      ],
    );
  }

  Widget _buildConferencePage(SecretariaOfflineController controller) {
    final summary = controller.buildConferenceSummary();
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: [
            _summaryCard(
              'Unidades',
              summary['units'].toString(),
              Icons.domain_outlined,
            ),
            _summaryCard(
              'Lançamentos locais',
              summary['launches'].toString(),
              Icons.edit_calendar_outlined,
            ),
            _summaryCard(
              'Sincronizados',
              summary['synced'].toString(),
              Icons.cloud_done_outlined,
            ),
            _summaryCard(
              'Conflitos',
              summary['conflicts'].toString(),
              Icons.alt_route_outlined,
            ),
          ],
        ),
        const SizedBox(height: 18),
        Expanded(
          child: Row(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Expanded(
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Conferência por unidade',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 16),
                        Expanded(
                          child: ListView.separated(
                            itemCount: controller.units.length,
                            separatorBuilder: (_, __) =>
                                const Divider(height: 28),
                            itemBuilder: (context, index) {
                              final unit = controller.units[index];
                              final stats = controller.conferenceByUnit(
                                unit.id,
                              );
                              return ListTile(
                                contentPadding: EdgeInsets.zero,
                                leading: CircleAvatar(
                                  child: Text(unit.kind == 'SEMED' ? 'S' : 'E'),
                                ),
                                title: Text(unit.name),
                                subtitle: Text(
                                  '${unit.kind} • Pendentes ${stats['pending']} • Conflitos ${stats['conflicts']}',
                                ),
                                trailing: Text(
                                  'Sincronizados ${stats['synced']}',
                                ),
                              );
                            },
                          ),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Checklist da secretaria rural',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 16),
                        _checkItem(
                          controller.storageReady,
                          'Base local pronta e persistente',
                        ),
                        _checkItem(
                          controller.queue.isNotEmpty ||
                              controller.documents.isNotEmpty,
                          'Fluxo de operação local executado',
                        ),
                        _checkItem(true, 'Fila de sincronização disponível'),
                        _checkItem(true, 'Tratamento de conflitos habilitado'),
                        _checkItem(
                          true,
                          'Documentos locais e conferência habilitados',
                        ),
                        _checkItem(
                          controller.lastSyncAt != null ||
                              controller.pendingQueueCount > 0,
                          'Rotina de sincronização preparada',
                        ),
                        const SizedBox(height: 24),
                        const Text(
                          'Leitura operacional',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 12),
                        Text(
                          controller.online
                              ? 'A aplicação está conectada e pronta para consolidar lançamentos quando o backend estiver acessível.'
                              : 'A aplicação está preservando os dados localmente e aguardando o retorno da conectividade para sincronizar.',
                          style: TextStyle(color: Colors.grey.shade700),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildReportsPage(SecretariaOfflineController controller) {
    final reports = controller.localReports;
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: [
            _summaryCard(
              'Alunos locais',
              controller.localStudents.toString(),
              Icons.people_alt_outlined,
            ),
            _summaryCard(
              'Matrículas pendentes',
              controller.enrollmentsPending.toString(),
              Icons.schedule_outlined,
            ),
            _summaryCard(
              'Documentos emitidos',
              controller.documentCount.toString(),
              Icons.article_outlined,
            ),
            _summaryCard(
              'Sincronizações concluídas',
              controller.syncedQueueCount.toString(),
              Icons.cloud_done_outlined,
            ),
          ],
        ),
        const SizedBox(height: 18),
        Expanded(
          child: Row(
            children: [
              Expanded(
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: ListView.separated(
                      itemCount: reports.length,
                      separatorBuilder: (_, __) => const Divider(height: 28),
                      itemBuilder: (context, index) {
                        final report = reports[index];
                        return ListTile(
                          contentPadding: EdgeInsets.zero,
                          leading: CircleAvatar(
                            backgroundColor: const Color(
                              0xFF0F766E,
                            ).withValues(alpha: 0.12),
                            child: const Icon(
                              Icons.assessment_outlined,
                              color: Color(0xFF0F766E),
                            ),
                          ),
                          title: Text(report['title'] as String),
                          subtitle: Text(report['description'] as String),
                          trailing: Text(report['value'] as String),
                        );
                      },
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              SizedBox(
                width: 320,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        const Text(
                          'Exportação local',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 14),
                        Text(
                          'Gere evidências locais para auditoria, suporte e apresentação da operação offline.',
                          style: TextStyle(color: Colors.grey.shade700),
                        ),
                        const SizedBox(height: 16),
                        FilledButton.tonalIcon(
                          onPressed: () async {
                            final doc = await controller
                                .generateOperationalReport();
                            if (mounted)
                              _showSnack(
                                'Relatório local gerado em ${doc.filePath}.',
                              );
                          },
                          icon: const Icon(Icons.file_download_outlined),
                          label: const Text('Gerar relatório consolidado'),
                        ),
                        const SizedBox(height: 12),
                        OutlinedButton.icon(
                          onPressed: () async {
                            final doc = await controller
                                .generatePendingReport();
                            if (mounted)
                              _showSnack(
                                'Relatório de pendências salvo em ${doc.filePath}.',
                              );
                          },
                          icon: const Icon(Icons.report_problem_outlined),
                          label: const Text('Relatório de pendências'),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _buildSettingsPage(SecretariaOfflineController controller) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Wrap(
          spacing: 14,
          runSpacing: 14,
          children: [
            _summaryCard(
              'Sincronização automática',
              controller.autoSyncEnabled ? 'Ativa' : 'Inativa',
              Icons.sync_outlined,
            ),
            _summaryCard(
              'Intervalo',
              '${controller.syncIntervalSeconds}s',
              Icons.timer_outlined,
            ),
            _summaryCard(
              'Modo de rede',
              controller.connectivityModeLabel,
              Icons.wifi_tethering_outlined,
            ),
            _summaryCard(
              'Usuários offline',
              controller.offlineUsers.length.toString(),
              Icons.manage_accounts_outlined,
            ),
          ],
        ),
        const SizedBox(height: 18),
        Expanded(
          child: Row(
            children: [
              Expanded(
                flex: 3,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: ListView(
                      children: [
                        const Text(
                          'Configurações da escola',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 8),
                        Text(
                          'Defina integração, política de sincronização, usuários offline autorizados e recursos locais do dispositivo.',
                          style: TextStyle(color: Colors.grey.shade700),
                        ),
                        const SizedBox(height: 16),
                        TextField(
                          controller: backendCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Servidor central / backend URL',
                            prefixIcon: Icon(Icons.link_outlined),
                          ),
                        ),
                        const SizedBox(height: 12),
                        const Text(
                          'Autenticação no backend',
                          style: TextStyle(fontWeight: FontWeight.w700),
                        ),
                        const SizedBox(height: 12),
                        Row(
                          children: [
                            Expanded(
                              child: TextField(
                                controller: loginEmailCtrl,
                                decoration: const InputDecoration(
                                  labelText: 'E-mail',
                                  prefixIcon: Icon(Icons.mail_outline),
                                ),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: TextField(
                                controller: loginTenantCtrl,
                                decoration: const InputDecoration(
                                  labelText: 'Código do tenant',
                                  prefixIcon: Icon(Icons.apartment_outlined),
                                ),
                              ),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: loginPasswordCtrl,
                          obscureText: true,
                          decoration: const InputDecoration(
                            labelText: 'Senha',
                            prefixIcon: Icon(Icons.lock_outline),
                          ),
                        ),
                        const SizedBox(height: 12),
                        Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: [
                            FilledButton.tonalIcon(
                              onPressed: () async {
                                try {
                                  await controller.loginToBackend(
                                    email: loginEmailCtrl.text,
                                    password: loginPasswordCtrl.text,
                                    tenantCode: loginTenantCtrl.text,
                                  );
                                  if (mounted) {
                                    _showSnack(
                                      'Conectado ao backend com sucesso.',
                                    );
                                  }
                                } catch (err) {
                                  if (mounted) {
                                    _showSnack(
                                      'Falha no login do backend: $err',
                                    );
                                  }
                                }
                              },
                              icon: const Icon(Icons.login_outlined),
                              label: Text(
                                controller.isAuthenticated
                                    ? 'Reconectar backend'
                                    : 'Entrar no backend',
                              ),
                            ),
                            OutlinedButton.icon(
                              onPressed: controller.isAuthenticated
                                  ? () async {
                                      await controller.refreshCentralData();
                                      if (mounted) {
                                        _showSnack('Base central recarregada.');
                                      }
                                    }
                                  : null,
                              icon: const Icon(Icons.cloud_download_outlined),
                              label: const Text('Carregar dados centrais'),
                            ),
                            OutlinedButton.icon(
                              onPressed: controller.isAuthenticated
                                  ? () async {
                                      await controller.logoutBackend();
                                      if (mounted) {
                                        _showSnack('Sessão central encerrada.');
                                      }
                                    }
                                  : null,
                              icon: const Icon(Icons.logout_outlined),
                              label: const Text('Sair do backend'),
                            ),
                          ],
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: printerCtrl,
                          decoration: const InputDecoration(
                            labelText: 'Impressora padrão (Windows/macOS)',
                            prefixIcon: Icon(Icons.print_outlined),
                          ),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: syncIntervalCtrl,
                          keyboardType: TextInputType.number,
                          decoration: const InputDecoration(
                            labelText:
                                'Intervalo de sincronização automática (segundos)',
                            prefixIcon: Icon(Icons.timer_outlined),
                          ),
                        ),
                        const SizedBox(height: 12),
                        DropdownButtonFormField<String>(
                          initialValue: controller.connectivityMode,
                          decoration: const InputDecoration(
                            labelText: 'Simulação de conectividade',
                            prefixIcon: Icon(Icons.network_check_outlined),
                          ),
                          items: const [
                            DropdownMenuItem(
                              value: 'auto',
                              child: Text('Automático'),
                            ),
                            DropdownMenuItem(
                              value: 'force_online',
                              child: Text('Forçar online'),
                            ),
                            DropdownMenuItem(
                              value: 'force_offline',
                              child: Text('Forçar offline'),
                            ),
                            DropdownMenuItem(
                              value: 'unstable',
                              child: Text('Sinal instável'),
                            ),
                          ],
                          onChanged: (value) {
                            if (value != null) {
                              controller.setConnectivityMode(value);
                            }
                          },
                        ),
                        const SizedBox(height: 12),
                        SwitchListTile.adaptive(
                          value: controller.autoSyncEnabled,
                          title: const Text(
                            'Sincronização automática habilitada',
                          ),
                          subtitle: const Text(
                            'Tenta enviar a outbox local assim que houver conectividade.',
                          ),
                          contentPadding: EdgeInsets.zero,
                          onChanged: (value) => controller.setAutoSync(value),
                        ),
                        const SizedBox(height: 12),
                        TextField(
                          controller: offlineUsersCtrl,
                          minLines: 4,
                          maxLines: 6,
                          decoration: const InputDecoration(
                            labelText:
                                'Usuários autorizados offline (um por linha)',
                            alignLabelWithHint: true,
                            prefixIcon: Icon(Icons.manage_accounts_outlined),
                          ),
                        ),
                        const SizedBox(height: 18),
                        Row(
                          children: [
                            Expanded(
                              child: OutlinedButton.icon(
                                onPressed: () {
                                  backendCtrl.text = controller.backendUrl;
                                  loginEmailCtrl.text = controller.backendEmail;
                                  loginTenantCtrl.text =
                                      controller.backendTenantCode;
                                  loginPasswordCtrl.clear();
                                  printerCtrl.text = controller.printerName;
                                  syncIntervalCtrl.text = controller
                                      .syncIntervalSeconds
                                      .toString();
                                  offlineUsersCtrl.text = controller
                                      .offlineUsers
                                      .join('\n');
                                  _showSnack(
                                    'Campos recarregados com a configuração salva.',
                                  );
                                },
                                icon: const Icon(Icons.refresh_outlined),
                                label: const Text('Recarregar'),
                              ),
                            ),
                            const SizedBox(width: 12),
                            Expanded(
                              child: FilledButton.icon(
                                onPressed: () async {
                                  final interval =
                                      int.tryParse(
                                        syncIntervalCtrl.text.trim(),
                                      ) ??
                                      controller.syncIntervalSeconds;
                                  final users = offlineUsersCtrl.text
                                      .split('\n')
                                      .map((e) => e.trim())
                                      .where((e) => e.isNotEmpty)
                                      .toList();
                                  await controller.updateLocalSettings(
                                    backend: backendCtrl.text.trim(),
                                    printer: printerCtrl.text.trim(),
                                    syncInterval: interval,
                                    users: users,
                                  );
                                  if (mounted)
                                    _showSnack('Configurações locais salvas.');
                                },
                                icon: const Icon(Icons.save_outlined),
                                label: const Text('Salvar esta seção'),
                              ),
                            ),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ),
              const SizedBox(width: 16),
              Expanded(
                flex: 2,
                child: Card(
                  child: Padding(
                    padding: const EdgeInsets.all(20),
                    child: ListView(
                      children: [
                        const Text(
                          'Resumo técnico local',
                          style: TextStyle(
                            fontSize: 18,
                            fontWeight: FontWeight.w700,
                          ),
                        ),
                        const SizedBox(height: 16),
                        _detailTile('Base local', controller.storageLabel),
                        _detailTile(
                          'Impressora padrão',
                          controller.printerName,
                        ),
                        _detailTile(
                          'Intervalo automático',
                          '${controller.syncIntervalSeconds}s',
                        ),
                        _detailTile(
                          'Modo de conectividade',
                          controller.connectivityModeLabel,
                        ),
                        _detailTile(
                          'Usuários offline',
                          controller.offlineUsers.isEmpty
                              ? 'Nenhum configurado'
                              : controller.offlineUsers.join(', '),
                        ),
                        _detailTile('Backend central', controller.backendUrl),
                        _detailTile(
                          'Sessão backend',
                          controller.isAuthenticated
                              ? controller.backendUserLabel
                              : 'Não autenticado',
                        ),
                        _detailTile(
                          'Escolas carregadas',
                          controller.centralSchoolCount.toString(),
                        ),
                        _detailTile(
                          'Alunos da unidade',
                          controller.centralStudentCount.toString(),
                        ),
                      ],
                    ),
                  ),
                ),
              ),
            ],
          ),
        ),
      ],
    );
  }

  Widget _dashboardBlock(
    String title,
    String value,
    String description,
    IconData icon,
  ) {
    return Container(
      padding: const EdgeInsets.all(18),
      decoration: BoxDecoration(
        color: const Color(0xFFF8FAFC),
        borderRadius: BorderRadius.circular(18),
        border: Border.all(color: const Color(0xFFE2E8F0)),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          CircleAvatar(
            backgroundColor: const Color(0xFF0F766E).withValues(alpha: 0.12),
            child: Icon(icon, color: const Color(0xFF0F766E)),
          ),
          const SizedBox(height: 12),
          Text(title, style: const TextStyle(fontWeight: FontWeight.w700)),
          const SizedBox(height: 6),
          Text(
            value,
            style: const TextStyle(fontSize: 18, fontWeight: FontWeight.w800),
          ),
          const SizedBox(height: 6),
          Expanded(
            child: Text(
              description,
              style: const TextStyle(color: Color(0xFF64748B)),
            ),
          ),
        ],
      ),
    );
  }

  void _showDocumentPreview(GeneratedDocument doc) {
    showDialog<void>(
      context: context,
      builder: (context) {
        return AlertDialog(
          title: Text(doc.title),
          content: SizedBox(
            width: 720,
            child: SingleChildScrollView(child: SelectableText(doc.content)),
          ),
          actions: [
            TextButton(
              onPressed: () => Navigator.of(context).pop(),
              child: const Text('Fechar'),
            ),
          ],
        );
      },
    );
  }
}

class _SecretariaPage extends StatelessWidget {
  const _SecretariaPage({
    required this.title,
    required this.description,
    required this.accent,
    required this.summary,
    required this.form,
  });

  final String title;
  final String description;
  final Color accent;
  final String summary;
  final Widget form;

  @override
  Widget build(BuildContext context) {
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Container(
          padding: const EdgeInsets.all(20),
          decoration: BoxDecoration(
            gradient: LinearGradient(
              colors: [accent.withValues(alpha: 0.16), Colors.white],
              begin: Alignment.topLeft,
              end: Alignment.bottomRight,
            ),
            borderRadius: BorderRadius.circular(22),
          ),
          child: Row(
            children: [
              Container(
                width: 52,
                height: 52,
                decoration: BoxDecoration(
                  color: accent.withValues(alpha: 0.18),
                  borderRadius: BorderRadius.circular(16),
                ),
                child: Icon(Icons.account_balance_outlined, color: accent),
              ),
              const SizedBox(width: 16),
              Expanded(
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(
                      title,
                      style: const TextStyle(
                        fontSize: 20,
                        fontWeight: FontWeight.w800,
                      ),
                    ),
                    const SizedBox(height: 6),
                    Text(
                      description,
                      style: TextStyle(color: Colors.grey.shade700),
                    ),
                  ],
                ),
              ),
              Text(
                summary,
                style: TextStyle(
                  color: Colors.grey.shade800,
                  fontWeight: FontWeight.w600,
                ),
              ),
            ],
          ),
        ),
        const SizedBox(height: 18),
        Expanded(child: form),
      ],
    );
  }
}

class _NavMeta {
  const _NavMeta(this.label, this.icon);

  final String label;
  final IconData icon;
}

class SecretariaLoginScreen extends StatefulWidget {
  const SecretariaLoginScreen({
    super.key,
    required this.controller,
    required this.onLoginSuccess,
  });

  final SecretariaOfflineController controller;
  final VoidCallback onLoginSuccess;

  @override
  State<SecretariaLoginScreen> createState() => _SecretariaLoginScreenState();
}

class _SecretariaLoginScreenState extends State<SecretariaLoginScreen> {
  late final TextEditingController backendCtrl;
  late final TextEditingController emailCtrl;
  late final TextEditingController passwordCtrl;
  late final TextEditingController tenantCtrl;
  bool submitting = false;
  String? errorText;

  @override
  void initState() {
    super.initState();
    backendCtrl = TextEditingController(text: widget.controller.backendUrl);
    emailCtrl = TextEditingController(text: widget.controller.backendEmail);
    passwordCtrl = TextEditingController();
    tenantCtrl = TextEditingController(
      text: widget.controller.backendTenantCode,
    );
  }

  @override
  void dispose() {
    backendCtrl.dispose();
    emailCtrl.dispose();
    passwordCtrl.dispose();
    tenantCtrl.dispose();
    super.dispose();
  }

  Future<void> _handleLogin() async {
    setState(() {
      submitting = true;
      errorText = null;
    });
    try {
      await widget.controller.setBackendUrl(backendCtrl.text.trim());
      try {
        await widget.controller.loginToBackend(
          email: emailCtrl.text,
          password: passwordCtrl.text,
          tenantCode: tenantCtrl.text,
        );
      } catch (onlineError) {
        final ok = await widget.controller.unlockOfflineSession(
          email: emailCtrl.text,
          password: passwordCtrl.text,
          tenantCode: tenantCtrl.text,
        );
        if (!ok) {
          throw Exception('$onlineError');
        }
      }
      if (mounted) {
        widget.onLoginSuccess();
      }
    } catch (err) {
      if (mounted) {
        setState(() {
          errorText = '$err';
        });
      }
    } finally {
      if (mounted) {
        setState(() => submitting = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final controller = widget.controller;
    return Scaffold(
      body: Center(
        child: ConstrainedBox(
          constraints: const BoxConstraints(maxWidth: 1120),
          child: Padding(
            padding: const EdgeInsets.all(24),
            child: Row(
              children: [
                Expanded(
                  flex: 5,
                  child: Container(
                    padding: const EdgeInsets.all(30),
                    decoration: BoxDecoration(
                      gradient: const LinearGradient(
                        colors: [Color(0xFF0F766E), Color(0xFF164E63)],
                        begin: Alignment.topLeft,
                        end: Alignment.bottomRight,
                      ),
                      borderRadius: BorderRadius.circular(28),
                    ),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      mainAxisAlignment: MainAxisAlignment.center,
                      children: [
                        const Text(
                          'SETRANE EXPRESS',
                          style: TextStyle(
                            color: Colors.white70,
                            fontSize: 14,
                            fontWeight: FontWeight.w700,
                            letterSpacing: 1.4,
                          ),
                        ),
                        const SizedBox(height: 16),
                        const Text(
                          'Secretaria escolar offline integrada ao mesmo banco de dados da rede.',
                          style: TextStyle(
                            color: Colors.white,
                            fontSize: 34,
                            height: 1.15,
                            fontWeight: FontWeight.w800,
                          ),
                        ),
                        const SizedBox(height: 16),
                        const Text(
                          'O app desktop funciona como continuação do dashboard web: autentica no backend, guarda credenciais locais para operação sem internet e sincroniza quando a conectividade voltar.',
                          style: TextStyle(
                            color: Colors.white70,
                            fontSize: 16,
                            height: 1.45,
                          ),
                        ),
                        const SizedBox(height: 24),
                        Wrap(
                          spacing: 12,
                          runSpacing: 12,
                          children: [
                            _loginFeature('Login online e offline'),
                            _loginFeature('Mesma base da escola'),
                            _loginFeature('Sincronização bidirecional'),
                            _loginFeature('Fila local com auditoria'),
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
                const SizedBox(width: 20),
                Expanded(
                  flex: 4,
                  child: Card(
                    child: Padding(
                      padding: const EdgeInsets.all(28),
                      child: ListView(
                        shrinkWrap: true,
                        children: [
                          const Text(
                            'Entrar na unidade',
                            style: TextStyle(
                              fontSize: 24,
                              fontWeight: FontWeight.w800,
                            ),
                          ),
                          const SizedBox(height: 8),
                          Text(
                            controller.hasOfflineCredential
                                ? 'Se não houver internet, você pode entrar com a última credencial validada neste dispositivo.'
                                : 'Faça um login online ao menos uma vez para liberar acesso offline posterior.',
                            style: TextStyle(color: Colors.grey.shade700),
                          ),
                          const SizedBox(height: 18),
                          TextField(
                            controller: backendCtrl,
                            decoration: const InputDecoration(
                              labelText: 'Servidor central',
                              prefixIcon: Icon(Icons.link_outlined),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: emailCtrl,
                            decoration: const InputDecoration(
                              labelText: 'E-mail',
                              prefixIcon: Icon(Icons.mail_outline),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: tenantCtrl,
                            decoration: const InputDecoration(
                              labelText: 'Código do tenant',
                              prefixIcon: Icon(Icons.apartment_outlined),
                            ),
                          ),
                          const SizedBox(height: 12),
                          TextField(
                            controller: passwordCtrl,
                            obscureText: true,
                            decoration: const InputDecoration(
                              labelText: 'Senha',
                              prefixIcon: Icon(Icons.lock_outline),
                            ),
                          ),
                          const SizedBox(height: 16),
                          Container(
                            padding: const EdgeInsets.all(14),
                            decoration: BoxDecoration(
                              color:
                                  (controller.online
                                          ? const Color(0xFF15803D)
                                          : const Color(0xFFB45309))
                                      .withValues(alpha: 0.10),
                              borderRadius: BorderRadius.circular(16),
                            ),
                            child: Row(
                              children: [
                                Icon(
                                  controller.online
                                      ? Icons.wifi
                                      : Icons.wifi_off,
                                  color: controller.online
                                      ? const Color(0xFF15803D)
                                      : const Color(0xFFB45309),
                                ),
                                const SizedBox(width: 10),
                                Expanded(
                                  child: Text(
                                    controller.online
                                        ? 'Internet disponível. O login vai validar no backend e carregar a base oficial.'
                                        : 'Se a conexão com o backend falhar, a app tentará liberar o acesso offline com a última credencial validada neste dispositivo.',
                                  ),
                                ),
                              ],
                            ),
                          ),
                          if (errorText != null) ...[
                            const SizedBox(height: 12),
                            Text(
                              errorText!,
                              style: const TextStyle(color: Color(0xFFB91C1C)),
                            ),
                          ],
                          const SizedBox(height: 18),
                          FilledButton.icon(
                            onPressed: submitting ? null : _handleLogin,
                            icon: submitting
                                ? const SizedBox(
                                    width: 16,
                                    height: 16,
                                    child: CircularProgressIndicator(
                                      strokeWidth: 2,
                                      color: Colors.white,
                                    ),
                                  )
                                : const Icon(Icons.login_outlined),
                            label: Text(
                              submitting ? 'Autenticando...' : 'Entrar',
                            ),
                          ),
                        ],
                      ),
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

Widget _loginFeature(String label) {
  return Container(
    padding: const EdgeInsets.symmetric(horizontal: 14, vertical: 10),
    decoration: BoxDecoration(
      color: Colors.white.withValues(alpha: 0.12),
      borderRadius: BorderRadius.circular(999),
    ),
    child: Text(
      label,
      style: const TextStyle(color: Colors.white, fontWeight: FontWeight.w600),
    ),
  );
}

Widget _summaryCard(String label, String value, IconData icon) {
  return SizedBox(
    width: 220,
    child: Card(
      child: Padding(
        padding: const EdgeInsets.all(18),
        child: Row(
          children: [
            CircleAvatar(
              radius: 22,
              backgroundColor: const Color(0xFF0F766E).withValues(alpha: 0.12),
              child: Icon(icon, color: const Color(0xFF0F766E)),
            ),
            const SizedBox(width: 14),
            Expanded(
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(
                    label,
                    style: const TextStyle(
                      fontSize: 13,
                      color: Color(0xFF64748B),
                    ),
                  ),
                  const SizedBox(height: 4),
                  Text(
                    value,
                    style: const TextStyle(
                      fontSize: 22,
                      fontWeight: FontWeight.w800,
                    ),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    ),
  );
}

Widget _detailTile(String label, String value) {
  return Padding(
    padding: const EdgeInsets.symmetric(vertical: 6),
    child: Row(
      children: [
        Expanded(
          child: Text(label, style: const TextStyle(color: Color(0xFF64748B))),
        ),
        const SizedBox(width: 10),
        Flexible(child: Text(value, textAlign: TextAlign.right)),
      ],
    ),
  );
}

Widget _checkItem(bool ok, String label) {
  return Padding(
    padding: const EdgeInsets.only(bottom: 10),
    child: Row(
      children: [
        Icon(
          ok ? Icons.check_circle : Icons.pending_outlined,
          color: ok ? const Color(0xFF15803D) : const Color(0xFFB45309),
        ),
        const SizedBox(width: 10),
        Expanded(child: Text(label)),
      ],
    ),
  );
}

Color _statusColor(String status) {
  switch (status.toLowerCase()) {
    case 'synced':
    case 'resolvida':
    case 'fechado':
      return const Color(0xFF15803D);
    case 'conflict':
    case 'conflito':
      return const Color(0xFFB45309);
    case 'failed':
    case 'erro':
      return const Color(0xFFB91C1C);
    default:
      return const Color(0xFF0F766E);
  }
}

IconData _statusIcon(String status) {
  switch (status.toLowerCase()) {
    case 'synced':
    case 'resolvida':
      return Icons.cloud_done_outlined;
    case 'conflict':
    case 'conflito':
      return Icons.alt_route_outlined;
    case 'failed':
    case 'erro':
      return Icons.error_outline;
    default:
      return Icons.schedule_send_outlined;
  }
}

String _formatDate(String? value) {
  if (value == null || value.isEmpty) return 'N/I';
  final date = DateTime.tryParse(value);
  if (date == null) return value;
  final day = date.day.toString().padLeft(2, '0');
  final month = date.month.toString().padLeft(2, '0');
  return '$day/$month/${date.year} ${date.hour.toString().padLeft(2, '0')}:${date.minute.toString().padLeft(2, '0')}';
}

class UnitItem {
  const UnitItem({required this.id, required this.name, required this.kind});

  final String id;
  final String name;
  final String kind;

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'kind': kind};

  factory UnitItem.fromJson(Map<String, dynamic> json) => UnitItem(
    id: json['id'] as String,
    name: json['name'] as String,
    kind: json['kind'] as String,
  );
}

class GeneratedDocument {
  const GeneratedDocument({
    required this.id,
    required this.type,
    required this.title,
    required this.unitId,
    required this.unitName,
    required this.filePath,
    required this.createdAt,
    required this.content,
  });

  final String id;
  final String type;
  final String title;
  final String unitId;
  final String unitName;
  final String filePath;
  final String createdAt;
  final String content;

  Map<String, dynamic> toJson() => {
    'id': id,
    'type': type,
    'title': title,
    'unitId': unitId,
    'unitName': unitName,
    'filePath': filePath,
    'createdAt': createdAt,
    'content': content,
  };

  factory GeneratedDocument.fromJson(Map<String, dynamic> json) =>
      GeneratedDocument(
        id: json['id'] as String,
        type: json['type'] as String,
        title: json['title'] as String,
        unitId: json['unitId'] as String,
        unitName: json['unitName'] as String,
        filePath: json['filePath'] as String,
        createdAt: json['createdAt'] as String,
        content: json['content'] as String,
      );
}

class ValidationItem {
  const ValidationItem({
    required this.id,
    required this.title,
    required this.description,
    required this.unitId,
    required this.unitName,
    required this.status,
    required this.createdAt,
  });

  final String id;
  final String title;
  final String description;
  final String unitId;
  final String unitName;
  final String status;
  final String createdAt;

  Map<String, dynamic> toJson() => {
    'id': id,
    'title': title,
    'description': description,
    'unitId': unitId,
    'unitName': unitName,
    'status': status,
    'createdAt': createdAt,
  };

  factory ValidationItem.fromJson(Map<String, dynamic> json) => ValidationItem(
    id: json['id'] as String,
    title: json['title'] as String,
    description: json['description'] as String,
    unitId: json['unitId'] as String,
    unitName: json['unitName'] as String,
    status: json['status'] as String,
    createdAt: json['createdAt'] as String,
  );
}

class OperationStatusMeta {
  const OperationStatusMeta({
    required this.title,
    required this.description,
    required this.color,
    required this.icon,
  });

  final String title;
  final String description;
  final Color color;
  final IconData icon;
}

class DesktopRepository {
  Future<Directory> appDirectory() async {
    final base = _resolveBaseStoragePath();
    final dir = Directory('$base${Platform.pathSeparator}SetraneDesktop');
    if (!dir.existsSync()) {
      dir.createSync(recursive: true);
    }
    final docs = Directory('${dir.path}${Platform.pathSeparator}documents');
    if (!docs.existsSync()) {
      docs.createSync(recursive: true);
    }
    return dir;
  }

  String _resolveBaseStoragePath() {
    if (Platform.isMacOS) {
      return '${Platform.environment['HOME']}/Library/Application Support';
    }
    if (Platform.isWindows) {
      return Platform.environment['APPDATA'] ??
          '${Platform.environment['USERPROFILE']}\\AppData\\Roaming';
    }
    return '${Platform.environment['HOME']}/.local/share';
  }

  Future<File> stateFile() async {
    final dir = await appDirectory();
    return File('${dir.path}${Platform.pathSeparator}secretaria_state.json');
  }

  Future<Map<String, dynamic>> loadState() async {
    final file = await stateFile();
    if (!file.existsSync()) return {};
    final content = await file.readAsString();
    if (content.trim().isEmpty) return {};
    return jsonDecode(content) as Map<String, dynamic>;
  }

  Future<void> saveState(Map<String, dynamic> state) async {
    final file = await stateFile();
    await file.writeAsString(const JsonEncoder.withIndent('  ').convert(state));
  }

  Future<String> saveDocument(String fileName, String content) async {
    final dir = await appDirectory();
    final docs = Directory('${dir.path}${Platform.pathSeparator}documents');
    final file = File('${docs.path}${Platform.pathSeparator}$fileName');
    await file.writeAsString(content);
    return file.path;
  }
}

class SecretariaOfflineController extends ChangeNotifier {
  SecretariaOfflineController(this.repository);

  final DesktopRepository repository;

  bool initialized = false;
  bool online = false;
  bool autoSyncEnabled = true;
  bool storageReady = false;
  String backendUrl = 'http://localhost:2000';
  String selectedUnitId = 'semed';
  String printerName = 'Impressora local da unidade';
  int syncIntervalSeconds = 20;
  String connectivityMode = 'auto';
  List<String> offlineUsers = const ['secretaria.local', 'gestor.unidade'];
  String backendEmail = '';
  String backendTenantCode = '';
  String authToken = '';
  String offlineCredentialHash = '';
  Map<String, dynamic> backendUser = {};
  Map<String, dynamic> centralOverview = {};
  List<Map<String, dynamic>> centralStudents = [];
  DateTime? lastSyncAt;
  DateTime? lastOnlineCheckAt;
  Timer? _syncTimer;

  List<UnitItem> units = const [
    UnitItem(id: 'semed', name: 'SEMED', kind: 'SEMED'),
    UnitItem(id: 'escola-aurora', name: 'EMEF Aurora do Campo', kind: 'Escola'),
    UnitItem(id: 'escola-rio-verde', name: 'EMEF Rio Verde', kind: 'Escola'),
    UnitItem(id: 'escola-serra-alta', name: 'EMEF Serra Alta', kind: 'Escola'),
  ];

  List<Map<String, dynamic>> queue = [];
  List<Map<String, dynamic>> conflicts = [];
  List<GeneratedDocument> documents = [];
  List<ValidationItem> validations = [];
  Map<String, dynamic> serverLedger = {};

  String get storageLabel => repository._resolveBaseStoragePath();
  int get pendingQueueCount =>
      queue.where((item) => item['status'] == 'pending').length;
  int get syncedQueueCount =>
      queue.where((item) => item['status'] == 'synced').length;
  int get failedQueueCount =>
      queue.where((item) => item['status'] == 'failed').length;
  int get conflictCount =>
      conflicts.where((item) => item['status'] == 'aberta').length;
  int get documentCount => documents.length;
  int get validationCount => validations.length;
  int get openValidationCount =>
      validations.where((item) => item.status == 'aberta').length;
  bool get isAuthenticated => authToken.isNotEmpty;
  bool get hasOfflineCredential => offlineCredentialHash.isNotEmpty;
  String get backendUserLabel =>
      (backendUser['nome'] as String?)?.trim().isNotEmpty == true
      ? backendUser['nome'] as String
      : 'Não autenticado';
  int get centralStudentCount => centralStudents.length;
  int get centralSchoolCount =>
      units.where((item) => item.kind == 'Escola').length;
  bool get isSchoolScoped =>
      (backendUser['cargo'] as String? ?? '').toUpperCase() == 'USUARIO' &&
      selectedUnitId != 'semed';
  String get lastSyncLabel => lastSyncAt == null
      ? 'Ainda não sincronizado'
      : _formatDate(lastSyncAt!.toIso8601String());
  String get lastOnlineCheckLabel => lastOnlineCheckAt == null
      ? 'Sem verificação recente'
      : 'Última checagem ${_formatDate(lastOnlineCheckAt!.toIso8601String())}';

  @override
  void dispose() {
    _syncTimer?.cancel();
    super.dispose();
  }

  Future<void> initialize() async {
    final saved = await repository.loadState();
    storageReady = true;
    if (saved.isNotEmpty) {
      backendUrl = saved['backendUrl'] as String? ?? backendUrl;
      selectedUnitId = saved['selectedUnitId'] as String? ?? selectedUnitId;
      autoSyncEnabled = saved['autoSyncEnabled'] as bool? ?? autoSyncEnabled;
      printerName = saved['printerName'] as String? ?? printerName;
      syncIntervalSeconds =
          saved['syncIntervalSeconds'] as int? ?? syncIntervalSeconds;
      connectivityMode =
          saved['connectivityMode'] as String? ?? connectivityMode;
      offlineUsers = List<String>.from(
        saved['offlineUsers'] as List? ?? offlineUsers,
      );
      backendEmail = saved['backendEmail'] as String? ?? backendEmail;
      backendTenantCode =
          saved['backendTenantCode'] as String? ?? backendTenantCode;
      authToken = saved['authToken'] as String? ?? authToken;
      offlineCredentialHash =
          saved['offlineCredentialHash'] as String? ?? offlineCredentialHash;
      backendUser = Map<String, dynamic>.from(
        saved['backendUser'] as Map? ?? const {},
      );
      centralOverview = Map<String, dynamic>.from(
        saved['centralOverview'] as Map? ?? const {},
      );
      centralStudents = List<Map<String, dynamic>>.from(
        (saved['centralStudents'] as List? ?? const []).map(
          (e) => Map<String, dynamic>.from(e as Map),
        ),
      );
      queue = List<Map<String, dynamic>>.from(
        (saved['queue'] as List? ?? const []).map(
          (e) => Map<String, dynamic>.from(e as Map),
        ),
      );
      conflicts = List<Map<String, dynamic>>.from(
        (saved['conflicts'] as List? ?? const []).map(
          (e) => Map<String, dynamic>.from(e as Map),
        ),
      );
      documents = (saved['documents'] as List? ?? const [])
          .map(
            (item) => GeneratedDocument.fromJson(
              Map<String, dynamic>.from(item as Map),
            ),
          )
          .toList();
      validations = (saved['validations'] as List? ?? const [])
          .map(
            (item) =>
                ValidationItem.fromJson(Map<String, dynamic>.from(item as Map)),
          )
          .toList();
      serverLedger = Map<String, dynamic>.from(
        saved['serverLedger'] as Map? ?? const {},
      );
      lastSyncAt = _parseDate(saved['lastSyncAt'] as String?);
      lastOnlineCheckAt = _parseDate(saved['lastOnlineCheckAt'] as String?);
      final savedUnits = (saved['units'] as List?)
          ?.map(
            (item) => UnitItem.fromJson(Map<String, dynamic>.from(item as Map)),
          )
          .toList();
      if (savedUnits != null && savedUnits.isNotEmpty) units = savedUnits;
    }
    initialized = true;
    notifyListeners();
    _startAutoSync();
    if (authToken.isNotEmpty) {
      await refreshCentralData();
    }
    await checkConnectivityAndSync();
  }

  Future<void> setBackendUrl(String value) async {
    if (value.isEmpty) return;
    backendUrl = value;
    await _persist();
    notifyListeners();
  }

  Future<void> setAutoSync(bool value) async {
    autoSyncEnabled = value;
    _startAutoSync();
    await _persist();
    notifyListeners();
  }

  Future<void> setConnectivityMode(String value) async {
    connectivityMode = value;
    await _persist();
    notifyListeners();
  }

  Future<void> selectUnit(String id) async {
    selectedUnitId = id;
    if (authToken.isNotEmpty) {
      await refreshCentralData();
    }
    await _persist();
    notifyListeners();
  }

  Future<void> updateLocalSettings({
    required String backend,
    required String printer,
    required int syncInterval,
    required List<String> users,
  }) async {
    if (backend.isNotEmpty) backendUrl = backend;
    if (printer.isNotEmpty) printerName = printer;
    syncIntervalSeconds = syncInterval < 10 ? 10 : syncInterval;
    offlineUsers = users;
    _startAutoSync();
    await _persist();
    notifyListeners();
  }

  Future<void> loginToBackend({
    required String email,
    required String password,
    required String tenantCode,
  }) async {
    final payload = await _requestJson(
      'POST',
      '/api/login',
      body: {
        'email': email.trim(),
        'senha': password,
        'tenant_codigo': tenantCode.trim(),
      },
      authenticated: false,
    );
    authToken = payload['token'] as String? ?? '';
    backendUser = Map<String, dynamic>.from(
      payload['user'] as Map? ?? const {},
    );
    backendEmail = email.trim();
    backendTenantCode = tenantCode.trim();
    offlineCredentialHash = _credentialHash(
      email.trim(),
      password,
      tenantCode.trim(),
    );
    await refreshCentralData();
    await _persist();
    notifyListeners();
  }

  Future<bool> unlockOfflineSession({
    required String email,
    required String password,
    required String tenantCode,
  }) async {
    final hash = _credentialHash(email.trim(), password, tenantCode.trim());
    if (offlineCredentialHash.isEmpty || hash != offlineCredentialHash) {
      return false;
    }
    backendEmail = email.trim();
    backendTenantCode = tenantCode.trim();
    _applyRoleBasedUnitScope();
    await _persist();
    notifyListeners();
    return true;
  }

  Future<void> logoutBackend() async {
    authToken = '';
    backendUser = {};
    centralOverview = {};
    centralStudents = [];
    await _persist();
    notifyListeners();
  }

  Future<void> refreshCentralData() async {
    if (authToken.isEmpty) return;
    try {
      final me = await _requestJson('GET', '/api/me');
      backendUser = Map<String, dynamic>.from(me as Map);

      final schoolsResponse = await _requestJson('GET', '/api/escolas');
      final schools = List<Map<String, dynamic>>.from(
        (schoolsResponse as List).map(
          (e) => Map<String, dynamic>.from(e as Map),
        ),
      );

      final schoolOnlyUnits = schools
          .map(
            (school) => UnitItem(
              id: '${school['id']}',
              name: (school['nome'] as String?) ?? 'Escola',
              kind: 'Escola',
            ),
          )
          .toList();
      final isSchoolUser =
          (backendUser['cargo'] as String? ?? '').toUpperCase() == 'USUARIO';
      final backendUnits = <UnitItem>[
        if (!isSchoolUser)
          const UnitItem(id: 'semed', name: 'SEMED', kind: 'SEMED'),
        ...schoolOnlyUnits,
      ];
      units = backendUnits;
      _applyRoleBasedUnitScope();

      if (selectedUnitId != 'semed') {
        final dashboard = await _requestJson(
          'GET',
          '/api/escolas/$selectedUnitId/dashboard',
        );
        centralOverview = Map<String, dynamic>.from(dashboard as Map);
        final studentsResponse = await _requestJson(
          'GET',
          '/api/escolas/$selectedUnitId/alunos',
        );
        centralStudents = List<Map<String, dynamic>>.from(
          ((studentsResponse as Map)['alunos'] as List? ?? const []).map((e) {
            final row = Map<String, dynamic>.from(e as Map);
            row['display_name'] =
                row['nome'] ??
                row['pessoa_nome'] ??
                row['studentName'] ??
                'Sem nome';
            row['display_turma'] =
                row['turma_escola'] ?? row['turma'] ?? 'Sem turma';
            row['display_ano'] = row['ano_letivo'] ?? row['ano'] ?? 'N/I';
            return row;
          }),
        );
      } else {
        centralOverview = {'escolas': schools.length};
        centralStudents = [];
      }
    } catch (_) {
      // preserve cached central snapshot if backend is unavailable
    }
  }

  String get selectedUnitName =>
      units.firstWhere((item) => item.id == selectedUnitId).name;

  String get activePeriodLabel =>
      'Ano letivo 2026 · ${selectedUnitName == 'SEMED' ? 'Rede municipal' : 'Unidade'}';

  String get connectivityModeLabel => switch (connectivityMode) {
    'force_online' => 'Forçado online',
    'force_offline' => 'Forçado offline',
    'unstable' => 'Sinal instável',
    _ => 'Automático',
  };

  List<Map<String, dynamic>> get studentEntries =>
      _entriesByOperations(const ['CADASTRO_ALUNO']);

  List<Map<String, dynamic>> get enrollmentEntries =>
      _entriesByOperations(const ['MATRICULA_LOCAL', 'REMATRICULA_LOCAL']);

  List<Map<String, dynamic>> get movementEntries =>
      _entriesByOperations(_movementOperations);

  int get localStudents => studentEntries.length;

  int get studentsSynced =>
      studentEntries.where((item) => item['status'] == 'synced').length;

  int get studentsWithTransport => studentEntries
      .where(
        (item) => (item['notesRaw'] as String? ?? '').toLowerCase().contains(
          'transporte',
        ),
      )
      .length;

  int get studentsWithOpenValidation => studentEntries
      .where((item) => (item['hasOpenValidation'] as bool? ?? false))
      .length;

  int get enrollmentsPending =>
      enrollmentEntries.where((item) => item['status'] == 'pending').length;

  int get enrollmentsSynced =>
      enrollmentEntries.where((item) => item['status'] == 'synced').length;

  int get enrollmentsWithValidation => enrollmentEntries
      .where((item) => (item['hasOpenValidation'] as bool? ?? false))
      .length;

  List<Map<String, dynamic>> get localReports => [
    {
      'title': 'Alunos cadastrados no dispositivo',
      'description':
          'Total de estudantes com cadastro local registrado pela unidade.',
      'value': localStudents.toString(),
    },
    {
      'title': 'Matrículas aguardando envio',
      'description':
          'Lançamentos de matrícula ou rematrícula ainda não consolidados.',
      'value': enrollmentsPending.toString(),
    },
    {
      'title': 'Documentos emitidos localmente',
      'description':
          'Arquivos gerados no dispositivo para continuidade administrativa.',
      'value': documentCount.toString(),
    },
    {
      'title': 'Pendências em aberto',
      'description':
          'Validações que precisam de conferência antes da publicação oficial.',
      'value': openValidationCount.toString(),
    },
    {
      'title': 'Conflitos detectados',
      'description':
          'Registros locais que divergem do espelho central e exigem decisão.',
      'value': conflictCount.toString(),
    },
    {
      'title': 'Último ciclo de sincronização',
      'description':
          'Momento mais recente em que o aplicativo consolidou a outbox local.',
      'value': lastSyncAt == null
          ? 'Ainda não executado'
          : _formatDate(lastSyncAt!.toIso8601String()),
    },
  ];

  OperationStatusMeta get operationStatusMeta {
    if (conflictCount > 0) {
      return const OperationStatusMeta(
        title: 'Atenção: conflitos encontrados',
        description:
            'Há registros locais que também foram alterados no espelho central.',
        color: Color(0xFFB45309),
        icon: Icons.alt_route_outlined,
      );
    }
    if (online && pendingQueueCount > 0) {
      return const OperationStatusMeta(
        title: 'Sincronizando a base local',
        description:
            'A unidade está conectada e o aplicativo está processando a fila.',
        color: Color(0xFF0F766E),
        icon: Icons.sync_outlined,
      );
    }
    if (!online) {
      return const OperationStatusMeta(
        title: 'Offline operando localmente',
        description:
            'A escola continua funcionando e vai sincronizar quando a rede voltar.',
        color: Color(0xFFB91C1C),
        icon: Icons.wifi_off_outlined,
      );
    }
    return const OperationStatusMeta(
      title: 'Online e integrado à base central',
      description:
          'A escola pode operar diretamente e consolidar seus registros.',
      color: Color(0xFF15803D),
      icon: Icons.wifi_outlined,
    );
  }

  static const List<String> _movementOperations = [
    'TRANSFERENCIA_SAIDA',
    'TRANSFERENCIA_ENTRADA',
    'REMANEJAMENTO_TURMA',
    'CANCELAMENTO_MATRICULA',
    'ABANDONO_ESCOLAR',
    'REGULARIZACAO_CADASTRAL',
  ];

  Future<void> createLaunch({
    required String channel,
    required String operation,
    required String studentName,
    required String studentCode,
    required String turma,
    required String period,
    required String notes,
    Map<String, dynamic>? payload,
  }) async {
    final createdAt = DateTime.now().toIso8601String();
    final id = _newId('fila');
    final entry = <String, dynamic>{
      'id': id,
      'channel': channel,
      'operation': operation,
      'operationLabel': _operationLabel(operation),
      'studentName': studentName.trim(),
      'studentCode': studentCode.trim(),
      'turma': turma.trim(),
      'period': period.trim(),
      'notes': notes.trim(),
      'notesRaw': notes.trim(),
      'notesSummary': _notesSummary(notes),
      'payload': payload ?? const <String, dynamic>{},
      'unitId': selectedUnitId,
      'unitName': selectedUnitName,
      'createdAt': createdAt,
      'createdAtLabel': _formatDate(createdAt),
      'status': 'pending',
      'statusLabel': 'Pendente',
      'hasOpenValidation': true,
      'baseRevision': _currentRevisionFor(studentCode, operation),
      'entityKey':
          '$selectedUnitId:${studentCode.trim().isEmpty ? studentName.trim() : studentCode.trim()}:$operation',
      'errorMessage': null,
    };
    queue.insert(0, entry);
    validations.insert(
      0,
      ValidationItem(
        id: _newId('validacao'),
        title: 'Conferir lançamento local',
        description:
            'Validar o registro de ${entry['studentName']} antes da consolidação final.',
        unitId: selectedUnitId,
        unitName: selectedUnitName,
        status: 'aberta',
        createdAt: createdAt,
      ),
    );
    await _persist();
    notifyListeners();
    if (autoSyncEnabled) {
      await checkConnectivityAndSync();
    }
  }

  Future<GeneratedDocument> generateDocument({
    required String type,
    required String studentName,
    required String studentCode,
    required String turma,
    required String notes,
  }) async {
    final timestamp = DateTime.now();
    final title = switch (type) {
      'AUTORIZACAO_TRANSFERENCIA' => 'Autorização para transferência',
      'RELATORIO_SINCRONIZACAO' => 'Relatório de sincronização',
      'COMPROVANTE_OFFLINE' => 'Comprovante de lançamento offline',
      'ESPELHO_CADASTRAL' => 'Espelho de dados cadastrais',
      'DECLARACAO_MATRICULA_LOCAL' => 'Declaração local de matrícula',
      'COMPROVANTE_MOVIMENTACAO' => 'Comprovante de movimentação escolar',
      'RELATORIO_OPERACIONAL_LOCAL' => 'Relatório operacional local',
      'RELATORIO_PENDENCIAS_LOCAL' => 'Relatório de pendências locais',
      _ => 'Declaração de atendimento',
    };
    final content = StringBuffer()
      ..writeln(title.toUpperCase())
      ..writeln('SETRANE EXPRESS · Secretaria escolar offline')
      ..writeln('')
      ..writeln('Unidade: $selectedUnitName')
      ..writeln('Data: ${_formatDate(timestamp.toIso8601String())}')
      ..writeln(
        'Estudante: ${studentName.isEmpty ? 'Não informado' : studentName}',
      )
      ..writeln(
        'Matrícula: ${studentCode.isEmpty ? 'Não informada' : studentCode}',
      )
      ..writeln('Turma: ${turma.isEmpty ? 'Não informada' : turma}')
      ..writeln('')
      ..writeln('Observações:')
      ..writeln(notes.isEmpty ? 'Sem observações complementares.' : notes)
      ..writeln('')
      ..writeln(
        'Documento gerado localmente no módulo de secretaria escolar offline.',
      )
      ..writeln(
        'A consolidação central dependerá do ciclo de sincronização e das validações pendentes.',
      );
    final fileName =
        '${type.toLowerCase()}_${timestamp.millisecondsSinceEpoch}.txt';
    final path = await repository.saveDocument(fileName, content.toString());
    final document = GeneratedDocument(
      id: _newId('doc'),
      type: type,
      title: title,
      unitId: selectedUnitId,
      unitName: selectedUnitName,
      filePath: path,
      createdAt: timestamp.toIso8601String(),
      content: content.toString(),
    );
    documents.insert(0, document);
    await _persist();
    notifyListeners();
    return document;
  }

  Future<GeneratedDocument> generateOperationalReport() {
    return generateDocument(
      type: 'RELATORIO_OPERACIONAL_LOCAL',
      studentName: '',
      studentCode: '',
      turma: '',
      notes:
          'Unidade: $selectedUnitName\nAlunos locais: $localStudents\nMatrículas pendentes: $enrollmentsPending\nDocumentos locais: $documentCount\nValidações em aberto: $openValidationCount\nConflitos: $conflictCount',
    );
  }

  Future<GeneratedDocument> generatePendingReport() {
    return generateDocument(
      type: 'RELATORIO_PENDENCIAS_LOCAL',
      studentName: '',
      studentCode: '',
      turma: '',
      notes:
          'Pendências abertas: $openValidationCount\nFila pendente: $pendingQueueCount\nConflitos: $conflictCount\nUsuários offline: ${offlineUsers.join(', ')}',
    );
  }

  Future<void> checkConnectivityAndSync({bool forceSync = false}) async {
    online = await _pingBackend();
    lastOnlineCheckAt = DateTime.now();
    if (online && authToken.isNotEmpty) {
      await refreshCentralData();
    }
    if (online && (autoSyncEnabled || forceSync)) {
      await _processQueue();
    }
    if (online && authToken.isNotEmpty) {
      await refreshCentralData();
    }
    await _persist();
    notifyListeners();
  }

  Future<void> retryQueueItem(String id) async {
    final item = queue.firstWhere((row) => row['id'] == id);
    item['status'] = 'pending';
    item['statusLabel'] = 'Pendente';
    item['errorMessage'] = null;
    await _persist();
    notifyListeners();
    await checkConnectivityAndSync();
  }

  Future<void> resolveConflictFromQueue(String queueId, String strategy) async {
    final item = queue.firstWhere((row) => row['id'] == queueId);
    final entityKey = item['entityKey'] as String;
    final conflict = conflicts.firstWhere(
      (row) => row['queueId'] == queueId,
      orElse: () => {},
    );
    if (strategy == 'keep_local') {
      final revision = (serverLedger[entityKey]?['revision'] as int? ?? 0) + 1;
      serverLedger[entityKey] = {
        'revision': revision,
        'hash': _payloadHash(item),
        'syncedAt': DateTime.now().toIso8601String(),
      };
      item['status'] = 'synced';
      item['statusLabel'] = 'Sincronizado';
      item['syncedAt'] = DateTime.now().toIso8601String();
      item['errorMessage'] = null;
      item['hasOpenValidation'] = false;
    } else {
      item['status'] = 'discarded';
      item['statusLabel'] = 'Descartado';
      item['errorMessage'] =
          'Mantido registro central durante resolução de conflito.';
      item['hasOpenValidation'] = false;
    }
    if (conflict.isNotEmpty) {
      conflict['status'] = 'resolvida';
    }
    validations.insert(
      0,
      ValidationItem(
        id: _newId('validacao'),
        title: 'Conflito de sincronização resolvido',
        description:
            'A fila ${item['id']} foi tratada com a estratégia $strategy.',
        unitId: item['unitId'] as String,
        unitName: item['unitName'] as String,
        status: 'resolvida',
        createdAt: DateTime.now().toIso8601String(),
      ),
    );
    await _persist();
    notifyListeners();
  }

  Future<void> resolveValidation(String id) async {
    final index = validations.indexWhere((item) => item.id == id);
    if (index == -1) return;
    final current = validations[index];
    validations[index] = ValidationItem(
      id: current.id,
      title: current.title,
      description: current.description,
      unitId: current.unitId,
      unitName: current.unitName,
      status: 'resolvida',
      createdAt: current.createdAt,
    );
    for (final item in queue) {
      if ((item['unitId'] as String?) == current.unitId &&
          (item['hasOpenValidation'] as bool? ?? false)) {
        item['hasOpenValidation'] = false;
      }
    }
    await _persist();
    notifyListeners();
  }

  int documentByType(String type) =>
      documents.where((item) => item.type == type).length;
  int documentByStatus(String status) => status == 'rascunho'
      ? documents.where((item) => item.type != 'RELATORIO_SINCRONIZACAO').length
      : 0;
  int validationByStatus(String status) =>
      validations.where((item) => item.status == status).length;
  int entriesByOperation(String operation) =>
      queue.where((item) => item['operation'] == operation).length;
  int entriesByOperationPrefix(String operationPrefix) => queue
      .where(
        (item) =>
            (item['operation'] as String? ?? '').startsWith(operationPrefix),
      )
      .length;

  Map<String, int> buildConferenceSummary() => {
    'units': units.length,
    'launches': queue.length,
    'synced': syncedQueueCount,
    'conflicts': conflictCount,
  };

  Map<String, int> conferenceByUnit(String unitId) {
    final unitQueue = queue.where((item) => item['unitId'] == unitId);
    return {
      'pending': unitQueue.where((item) => item['status'] == 'pending').length,
      'synced': unitQueue.where((item) => item['status'] == 'synced').length,
      'conflicts': conflicts
          .where(
            (item) => item['unitId'] == unitId && item['status'] == 'aberta',
          )
          .length,
    };
  }

  int _currentRevisionFor(String studentCode, String operation) {
    final key =
        '$selectedUnitId:${studentCode.trim().isEmpty ? 'sem-id' : studentCode.trim()}:$operation';
    return serverLedger[key]?['revision'] as int? ?? 0;
  }

  Future<bool> _pingBackend() async {
    if (connectivityMode == 'force_online') return true;
    if (connectivityMode == 'force_offline') return false;
    if (connectivityMode == 'unstable') {
      return DateTime.now().second.isEven;
    }
    try {
      if (authToken.isNotEmpty) {
        await _requestJson('GET', '/api/me');
        return true;
      }
      final client = HttpClient()
        ..connectionTimeout = const Duration(seconds: 5);
      final uri = Uri.parse(backendUrl);
      final request = await client.getUrl(uri);
      final response = await request.close().timeout(
        const Duration(seconds: 6),
      );
      client.close(force: true);
      return response.statusCode >= 200 && response.statusCode < 500;
    } catch (_) {
      return false;
    }
  }

  Future<void> _processQueue() async {
    for (final item
        in queue.where((row) => row['status'] == 'pending').toList()) {
      final syncedByApi = await _trySyncWithBackend(item);
      if (syncedByApi) {
        continue;
      }

      final entityKey = item['entityKey'] as String;
      final ledger = Map<String, dynamic>.from(
        serverLedger[entityKey] as Map? ?? const {},
      );
      final currentRevision = ledger['revision'] as int? ?? 0;
      final localBaseRevision = item['baseRevision'] as int? ?? 0;
      final localHash = _payloadHash(item);

      if (ledger.isNotEmpty &&
          localBaseRevision < currentRevision &&
          ledger['hash'] != localHash) {
        item['status'] = 'conflict';
        item['statusLabel'] = 'Conflito';
        item['errorMessage'] =
            'O registro foi alterado no espelho central e exige decisão manual.';
        item['hasOpenValidation'] = true;
        conflicts.insert(0, {
          'id': _newId('conflito'),
          'queueId': item['id'],
          'unitId': item['unitId'],
          'unitName': item['unitName'],
          'status': 'aberta',
          'local': Map<String, dynamic>.from(item),
          'server': Map<String, dynamic>.from(ledger),
          'createdAt': DateTime.now().toIso8601String(),
        });
        validations.insert(
          0,
          ValidationItem(
            id: _newId('validacao'),
            title: 'Conflito de sincronização',
            description:
                'O registro ${item['studentName']} precisa de conferência antes da consolidação.',
            unitId: item['unitId'] as String,
            unitName: item['unitName'] as String,
            status: 'aberta',
            createdAt: DateTime.now().toIso8601String(),
          ),
        );
        continue;
      }

      serverLedger[entityKey] = {
        'revision': currentRevision + 1,
        'hash': localHash,
        'syncedAt': DateTime.now().toIso8601String(),
      };
      item['status'] = 'synced';
      item['statusLabel'] = 'Sincronizado';
      item['syncedAt'] = DateTime.now().toIso8601String();
      item['errorMessage'] = null;
      item['hasOpenValidation'] = false;
    }

    if (queue.any((item) => item['status'] == 'synced')) {
      lastSyncAt = DateTime.now();
      final report = await generateDocument(
        type: 'RELATORIO_SINCRONIZACAO',
        studentName: '',
        studentCode: '',
        turma: '',
        notes:
            'Sincronização executada com $syncedQueueCount item(ns) já consolidados, $pendingQueueCount pendente(s) e $conflictCount conflito(s).',
      );
      if (report.content.isNotEmpty) {
        // just keeps the report as part of the local evidence set
      }
    }
    if (authToken.isNotEmpty) {
      await refreshCentralData();
    }
  }

  Future<bool> _trySyncWithBackend(Map<String, dynamic> item) async {
    if (authToken.isEmpty || selectedUnitId == 'semed') return false;
    final escolaId = int.tryParse(selectedUnitId);
    if (escolaId == null) return false;

    final operation = item['operation'] as String? ?? '';
    if (!const {
      'CADASTRO_ALUNO',
      'MATRICULA_LOCAL',
      'REMATRICULA_LOCAL',
    }.contains(operation)) {
      return false;
    }

    try {
      final turma = (item['turma'] as String? ?? '').trim();
      final period = (item['period'] as String? ?? '').trim();
      final ano =
          int.tryParse(
            (item['payload'] as Map?)?['ano_letivo']?.toString() ??
                RegExp(r'20\d{2}').firstMatch(period)?.group(0) ??
                '',
          ) ??
          2026;
      final notes = (item['notesRaw'] as String? ?? '').trim();
      final payload = Map<String, dynamic>.from(
        item['payload'] as Map? ?? const {},
      );
      final aluno = {
        'pessoa_nome': payload['pessoa_nome'] ?? item['studentName'],
        'id_pessoa': payload['id_pessoa'] ?? item['studentCode'],
        'cpf': payload['cpf'],
        'data_nascimento': payload['data_nascimento'],
        'sexo': payload['sexo'],
        'status': payload['status'],
        'ano': payload['ano'],
        'modalidade': payload['modalidade'],
        'formato_letivo': payload['formato_letivo'],
        'etapa': payload['etapa'],
        'turno_simplificado': payload['turno_simplificado'],
        'cep': payload['cep'],
        'rua': payload['rua'],
        'bairro': payload['bairro'],
        'numero_pessoa_endereco': payload['numero_pessoa_endereco'],
        'zona': payload['zona'],
        'filiacao_1': payload['filiacao_1'],
        'telefone_filiacao_1': payload['telefone_filiacao_1'],
        'filiacao_2': payload['filiacao_2'],
        'telefone_filiacao_2': payload['telefone_filiacao_2'],
        'responsavel': payload['responsavel'],
        'telefone_responsavel': payload['telefone_responsavel'],
        'deficiencia': payload['deficiencia'],
        'transporte_escolar_publico_utiliza':
            payload['transporte_escolar_publico_utiliza'],
        'transporte_apto': payload['transporte_aprovado'],
        'nome_social': payload['nome_social'],
        'nis': payload['nis'],
        'cartao_sus': payload['cartao_sus'],
        'rg': payload['rg'],
        'certidao_nascimento': payload['certidao_nascimento'],
        'naturalidade': payload['naturalidade'],
        'nacionalidade': payload['nacionalidade'],
        'cor_raca': payload['cor_raca'],
        'email_responsavel': payload['email_responsavel'],
        'telefone_emergencia': payload['telefone_emergencia'],
        'contato_emergencia_nome': payload['contato_emergencia_nome'],
        'contato_emergencia_parentesco':
            payload['contato_emergencia_parentesco'],
        'complemento_endereco': payload['complemento_endereco'],
        'ponto_referencia': payload['ponto_referencia'],
        'diagnosticos': payload['diagnosticos'],
        'medicacoes': payload['medicacoes'],
        'restricoes_saude': payload['restricoes_saude'],
        'alergias': payload['alergias'],
        'observacoes_gerais': payload['observacoes_gerais'],
        'beneficio_social': payload['beneficio_social'],
        'numero_matricula_rede': payload['numero_matricula_rede'],
        'orgao_emissor_rg': payload['orgao_emissor_rg'],
        'uf_rg': payload['uf_rg'],
        'data_expedicao_rg': payload['data_expedicao_rg'],
        'cartorio_registro': payload['cartorio_registro'],
        'termo_guarda': payload['termo_guarda'],
        'cartao_vacinacao': payload['cartao_vacinacao'],
        'documentos_pendentes': payload['documentos_pendentes'],
        'observacoes_pedagogicas': payload['observacoes_pedagogicas'],
        'escola_origem': payload['escola_origem'],
        'rede_origem': payload['rede_origem'],
        'situacao_escolar': payload['situacao_escolar'],
        'cpf_filiacao_1': payload['cpf_filiacao_1'],
        'parentesco_filiacao_1': payload['parentesco_filiacao_1'],
        'profissao_filiacao_1': payload['profissao_filiacao_1'],
        'escolaridade_filiacao_1': payload['escolaridade_filiacao_1'],
        'cpf_filiacao_2': payload['cpf_filiacao_2'],
        'parentesco_filiacao_2': payload['parentesco_filiacao_2'],
        'profissao_filiacao_2': payload['profissao_filiacao_2'],
        'escolaridade_filiacao_2': payload['escolaridade_filiacao_2'],
        'cpf_responsavel': payload['cpf_responsavel'],
        'parentesco_responsavel': payload['parentesco_responsavel'],
        'profissao_responsavel': payload['profissao_responsavel'],
        'escolaridade_responsavel': payload['escolaridade_responsavel'],
        'matriculante_nome': payload['matriculante_nome'],
        'matriculante_cpf': payload['matriculante_cpf'],
        'matriculante_parentesco': payload['matriculante_parentesco'],
        'matriculante_telefone': payload['matriculante_telefone'],
        'matriculante_email': payload['matriculante_email'],
        'matriculante_documento': payload['matriculante_documento'],
      }..removeWhere((key, value) => value == null || value.toString().isEmpty);
      final complementar = {
        'observacoes_offline': notes,
        'deseja_transporte': payload['deseja_transporte'],
        'transporte_aprovado': payload['transporte_aprovado'],
        'emitir_carteirinha_ao_finalizar':
            payload['emitir_carteirinha_ao_finalizar'],
        'poder_publico_transporte': payload['poder_publico_transporte'],
        'categoria_transporte_censo': payload['categoria_transporte_censo'],
        'tipo_transporte': payload['tipo_transporte'],
        'distancia_km': payload['distancia_km'],
        'tempo_deslocamento_min': payload['tempo_deslocamento_min'],
        'turno_embarque': payload['turno_embarque'],
        'turno_retorno': payload['turno_retorno'],
        'local_embarque': payload['local_embarque'],
        'precisa_monitor': payload['precisa_monitor'],
        'embarque_assistido': payload['embarque_assistido'],
        'rota_exclusiva': payload['rota_exclusiva'],
        'carro_adaptado': payload['carro_adaptado'],
        'observacoes_transporte': payload['observacoes_transporte'],
        'religiao': payload['religiao'],
        'etnia_indigena': payload['etnia_indigena'],
        'reside_com': payload['reside_com'],
        'tipo_moradia': payload['tipo_moradia'],
        'renda_familiar': payload['renda_familiar'],
        'cadunico': payload['cadunico'],
        'acesso_internet': payload['acesso_internet'],
        'possui_dispositivo': payload['possui_dispositivo'],
        'autoriza_imagem': payload['autoriza_imagem'],
        'recebe_bpc': payload['recebe_bpc'],
        'idioma_familiar': payload['idioma_familiar'],
        'unidade_saude_referencia': payload['unidade_saude_referencia'],
        'numero_prontuario_saude': payload['numero_prontuario_saude'],
        'autorizados_busca': payload['autorizados_busca'],
        'vulnerabilidade_social': payload['vulnerabilidade_social'],
        'observacoes_convivencia': payload['observacoes_convivencia'],
        'latitude': payload['latitude'],
        'longitude': payload['longitude'],
      }..removeWhere((key, value) => value == null || value.toString().isEmpty);

      await _requestJson(
        'POST',
        '/api/escolas/$escolaId/matriculas',
        body: {
          'aluno_id': null,
          'ano_letivo': ano,
          'turma': turma.isEmpty ? 'SEM TURMA' : turma,
          'aluno': aluno,
          'complementar': complementar,
        },
      );

      item['status'] = 'synced';
      item['statusLabel'] = 'Sincronizado';
      item['syncedAt'] = DateTime.now().toIso8601String();
      item['errorMessage'] = null;
      item['hasOpenValidation'] = false;
      return true;
    } catch (err) {
      item['status'] = 'failed';
      item['statusLabel'] = 'Falha';
      item['errorMessage'] = 'Falha ao sincronizar com backend: $err';
      return false;
    }
  }

  void _startAutoSync() {
    _syncTimer?.cancel();
    _syncTimer = Timer.periodic(Duration(seconds: syncIntervalSeconds), (_) {
      unawaited(checkConnectivityAndSync());
    });
  }

  String _newId(String prefix) =>
      '$prefix-${DateTime.now().microsecondsSinceEpoch}';

  String _payloadHash(Map<String, dynamic> item) {
    final relevant = {
      'operation': item['operation'],
      'studentName': item['studentName'],
      'studentCode': item['studentCode'],
      'turma': item['turma'],
      'period': item['period'],
      'notes': item['notes'],
      'payload': item['payload'],
      'unitId': item['unitId'],
    };
    return base64Encode(utf8.encode(jsonEncode(relevant)));
  }

  Future<dynamic> _requestJson(
    String method,
    String path, {
    Map<String, dynamic>? body,
    bool authenticated = true,
  }) async {
    final client = HttpClient()..connectionTimeout = const Duration(seconds: 8);
    try {
      final base = backendUrl.endsWith('/')
          ? backendUrl.substring(0, backendUrl.length - 1)
          : backendUrl;
      final uri = Uri.parse('$base$path');
      final request = await client.openUrl(method, uri);
      request.headers.set(HttpHeaders.acceptHeader, 'application/json');
      if (authenticated && authToken.isNotEmpty) {
        request.headers.set(
          HttpHeaders.authorizationHeader,
          'Bearer $authToken',
        );
      }
      if (body != null) {
        request.headers.set(HttpHeaders.contentTypeHeader, 'application/json');
        request.write(jsonEncode(body));
      }
      final response = await request.close().timeout(
        const Duration(seconds: 15),
      );
      final text = await response.transform(utf8.decoder).join();
      if (response.statusCode < 200 || response.statusCode >= 300) {
        throw HttpException('HTTP ${response.statusCode}: $text');
      }
      if (text.trim().isEmpty) return {};
      return jsonDecode(text);
    } finally {
      client.close(force: true);
    }
  }

  Future<void> _persist() async {
    await repository.saveState({
      'backendUrl': backendUrl,
      'selectedUnitId': selectedUnitId,
      'autoSyncEnabled': autoSyncEnabled,
      'printerName': printerName,
      'syncIntervalSeconds': syncIntervalSeconds,
      'connectivityMode': connectivityMode,
      'offlineUsers': offlineUsers,
      'backendEmail': backendEmail,
      'backendTenantCode': backendTenantCode,
      'authToken': authToken,
      'offlineCredentialHash': offlineCredentialHash,
      'backendUser': backendUser,
      'centralOverview': centralOverview,
      'centralStudents': centralStudents,
      'lastSyncAt': lastSyncAt?.toIso8601String(),
      'lastOnlineCheckAt': lastOnlineCheckAt?.toIso8601String(),
      'queue': queue,
      'conflicts': conflicts,
      'documents': documents.map((item) => item.toJson()).toList(),
      'validations': validations.map((item) => item.toJson()).toList(),
      'serverLedger': serverLedger,
      'units': units.map((item) => item.toJson()).toList(),
    });
  }

  DateTime? _parseDate(String? value) =>
      value == null ? null : DateTime.tryParse(value);

  List<Map<String, dynamic>> _entriesByOperations(List<String> operations) {
    return queue
        .where((item) => operations.contains(item['operation']))
        .map((item) => Map<String, dynamic>.from(item))
        .toList();
  }

  String _operationLabel(String operation) => switch (operation) {
    'CADASTRO_ALUNO' => 'Cadastro de aluno',
    'MATRICULA_LOCAL' => 'Matrícula local',
    'REMATRICULA_LOCAL' => 'Rematrícula local',
    'TRANSFERENCIA_SAIDA' => 'Transferência de saída',
    'TRANSFERENCIA_ENTRADA' => 'Transferência de entrada',
    'REMANEJAMENTO_TURMA' => 'Remanejamento de turma',
    'CANCELAMENTO_MATRICULA' => 'Cancelamento de matrícula',
    'ABANDONO_ESCOLAR' => 'Abandono escolar',
    'REGULARIZACAO_CADASTRAL' => 'Regularização cadastral',
    _ => operation,
  };

  String _notesSummary(String notes) {
    final trimmed = notes.trim();
    if (trimmed.isEmpty) return 'Sem observações.';
    if (trimmed.length <= 72) return trimmed;
    return '${trimmed.substring(0, 72)}...';
  }

  Future<bool> checkConnectivityOnly() async {
    online = await _pingBackend();
    lastOnlineCheckAt = DateTime.now();
    await _persist();
    notifyListeners();
    return online;
  }

  void _applyRoleBasedUnitScope() {
    final isSchoolUser =
        (backendUser['cargo'] as String? ?? '').toUpperCase() == 'USUARIO';
    if (isSchoolUser) {
      final schoolUnits = units.where((item) => item.kind == 'Escola').toList();
      if (schoolUnits.isNotEmpty) {
        selectedUnitId = schoolUnits.first.id;
        return;
      }
    }
    if (!units.any((item) => item.id == selectedUnitId)) {
      selectedUnitId = units.isNotEmpty ? units.first.id : 'semed';
    }
  }

  String _credentialHash(String email, String password, String tenantCode) {
    final input = '$email|$tenantCode|$password';
    var hash = 2166136261;
    for (final codeUnit in input.codeUnits) {
      hash ^= codeUnit;
      hash = (hash * 16777619) & 0xFFFFFFFF;
    }
    return hash.toRadixString(16);
  }
}
