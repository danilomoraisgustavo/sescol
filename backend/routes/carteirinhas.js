// backend/routes/carteirinhas.js
import express from 'express';
import PDFDocument from 'pdfkit';
import QR from 'qrcode';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';
import { getBranding, drawCabecalho, drawRodape } from '../services/brandingConfig.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// helper simples para mm -> pt
function mm(value) {
    return (value || 0) * 2.83465;
}

// =================== PÁGINA 1 – COMPROVANTE DE ATENDIMENTO ===================

function drawPaginaComprovante(doc, aluno, branding) {
    // Cabeçalho dinâmico (o próprio drawCabecalho faz fallback se não tiver branding)
    try {
        drawCabecalho(doc, branding || null);
    } catch (err) {
        console.error('Erro ao desenhar cabeçalho no comprovante:', err);
    }

    const now = new Date();
    const anoAtual = now.getFullYear();
    const dataStr = now.toLocaleDateString('pt-BR');
    const horaStr = now.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
    });

    const nome = aluno.pessoa_nome || aluno.nome || '';
    const escola =
        aluno.escola_nome ||
        aluno.escola ||
        aluno.unidade_ensino ||
        'Não informado';
    const turma =
        aluno.turma || aluno.turma_escola || aluno.ano_turma || 'Não informado';
    const ponto =
        aluno.ponto_nome || aluno.ponto || aluno.ponto_id || 'Não informado';

    const rota_associada =
        aluno.rota_associada ||
        (aluno.itinerario_id && aluno.linha
            ? `${aluno.itinerario_id} - ${aluno.linha}`
            : aluno.itinerario_id || aluno.linha || 'Não informado');

    const resultado =
        aluno.resultado_elegibilidade || 'APTO AO TRANSPORTE ESCOLAR';
    const detalhes =
        aluno.detalhe_elegibilidade ||
        aluno.detalhes ||
        'Critérios de distância e zoneamento atendidos.';
    const distanciaKm =
        typeof aluno.distancia_km === 'number'
            ? aluno.distancia_km.toFixed(2)
            : aluno.distancia_km || null;

    doc.y = 130;
    doc.x = 50;
    doc
        .fontSize(14)
        .font('Helvetica-Bold')
        .text('COMPROVANTE DE ATENDIMENTO – TRANSPORTE ESCOLAR', {
            align: 'center'
        });

    doc.moveDown(2);

    doc.fontSize(12).font('Helvetica');

    doc.text('Aluno(a): ', { continued: true });
    doc.font('Helvetica-Bold').text(nome);
    doc.font('Helvetica');

    doc.text('Escola: ', { continued: true });
    doc.font('Helvetica-Bold').text(escola);
    doc.font('Helvetica');

    doc.text('Turma: ', { continued: true });
    doc.font('Helvetica-Bold').text(turma);
    doc.font('Helvetica');

    doc.text('Ponto de parada: ', { continued: true });
    doc.font('Helvetica-Bold').text(String(ponto));
    doc.font('Helvetica');

    if (distanciaKm) {
        doc.text('Distância aproximada até a escola: ', { continued: true });
        doc.font('Helvetica-Bold').text(`${distanciaKm} km`);
        doc.font('Helvetica');
    }

    doc.moveDown(1.5);

    doc.text('Situação do atendimento: ', { continued: true });
    doc
        .font('Helvetica-Bold')
        .text(String(resultado).toUpperCase())
        .font('Helvetica');

    doc.moveDown(0.5);
    doc.text('Detalhes:', { underline: true });
    doc.moveDown(0.3);
    doc.text(detalhes, { align: 'justify' });

    doc.moveDown(1.5);
    doc
        .font('Helvetica')
        .text(
            `Este comprovante certifica que, na data de ${dataStr}, após análise dos critérios de elegibilidade para o transporte escolar, o(a) estudante acima identificado(a) foi considerado(a): `,
            { align: 'justify', continued: true }
        )
        .font('Helvetica-Bold')
        .text(String(resultado).toUpperCase() + '.', { align: 'justify' });

    doc.moveDown(1.5);
    doc
        .font('Helvetica')
        .text(
            'Este documento deve ser apresentado, junto com a carteirinha de identificação do estudante, sempre que solicitado pela equipe de transporte escolar do município.',
            { align: 'justify' }
        );

    doc.moveDown(3);

    const linhaY = doc.y + 40;
    doc
        .moveTo(100, linhaY)
        .lineTo(doc.page.width - 100, linhaY)
        .stroke();

    doc
        .font('Helvetica-Bold')
        .text(
            ' Secretaria Municipal de Educação',
            0,
            linhaY + 5,
            {
                align: 'center'
            }
        );

    doc.moveDown(3);

    doc
        .fontSize(10)
        .font('Helvetica')
        .text(
            `Emitido em ${dataStr}, às ${horaStr}. Válido para o ano letivo de ${anoAtual}.`,
            { align: 'center' }
        );

    // Rodapé dinâmico
    try {
        drawRodape(doc, branding || null);
    } catch (err) {
        console.error('Erro ao desenhar rodapé no comprovante:', err);
    }
}

// =================== DESENHO DA CARTEIRINHA (MESMA ESTILIZAÇÃO DO SEU CARD) ===================

function drawIdCard(doc, aluno, x, y, w, h, qrPngBuffer, branding) {
    // Objetos vinda de brandingConfig.getBranding
    const paths = (branding && branding.paths) ? branding.paths : {};
    const flags = (branding && branding.flags) ? branding.flags : {};
    const cardConfig = (branding && branding.cardConfig) ? branding.cardConfig : {};

    // Tipos vindos da aba "Carteirinhas" no front:
    // valores: 'principal' | 'secundaria' | 'extra'
    const tipoImagemEsquerda = cardConfig.imagemEsquerdaTipo || 'principal';
    const tipoImagemDireita = cardConfig.imagemDireitaTipo || 'secundaria';

    // Flags vindas do banco (ligadas aos switches "Exibir imagem à esquerda/direita")
    let exibirImagemEsquerda = !!flags.carteirinhaExibirImagemEsquerda;
    let exibirImagemDireita = !!flags.carteirinhaExibirImagemDireita;

    // Flag de QR (já está ok no serviço de branding)
    const exibirQr = flags.carteirinhaExibirQr !== false; // default: true

    // Resolve tipo ('principal' | 'secundaria' | 'extra') => caminho físico
    function resolveLogoPathByTipo(tipo) {
        switch (tipo) {
            case 'principal':
                return paths.logo_principal || null;
            case 'secundaria':
                return paths.logo_secundaria || null;
            case 'extra':
                return paths.logo_extra || null;
            default:
                return null;
        }
    }

    let logoEsquerdaPath = resolveLogoPathByTipo(tipoImagemEsquerda);
    let logoDireitaPath = resolveLogoPathByTipo(tipoImagemDireita);

    // Aplica flags de exibição
    if (!exibirImagemEsquerda) {
        logoEsquerdaPath = null;
    }
    if (!exibirImagemDireita) {
        logoDireitaPath = null;
    }

    // Foto padrão do aluno (já está correta no brandingConfig)
    const fotoPadraoAlunoPath =
        paths.foto_padrao_aluno ||
        paths.fotoPadraoAluno ||
        null;

    // ================= CARTÃO =================

    // Moldura externa
    doc.save();
    doc.roundedRect(x, y, w, h, mm(0)).lineWidth(0.6).stroke('#000');

    // Padding interno
    const padX = mm(10), padY = mm(2);
    const ix = x + padX, iy = y + padY;
    const iw = w - padX * 2, ih = h - padY * 2;

    // ======== Grid principal: 2 colunas ========
    const colGap = exibirQr ? mm(20) : 0;
    const qrColW = exibirQr ? mm(65) : 0;
    const leftW = iw - qrColW - colGap;
    const leftX = ix;
    const rightX = ix + leftW + colGap;
    const topY = iy;

    // ---------- COLUNA ESQUERDA ----------

    // Cabeçalho (logos + título)
    const headH = mm(12);
    const logoW = mm(20);

    // Linha abaixo do cabeçalho
    doc.moveTo(leftX, topY + headH)
        .lineTo(leftX + leftW, topY + headH)
        .lineWidth(0.4)
        .stroke('#000');

    // Logo ESQUERDA (ao lado esquerdo do título)
    try {
        if (logoEsquerdaPath && fs.existsSync(logoEsquerdaPath)) {
            doc.image(logoEsquerdaPath, leftX, topY + mm(1), {
                fit: [logoW, headH - mm(2)]
            });
        }
    } catch (err) {
        console.error('Erro ao desenhar logo esquerda na carteirinha:', err);
    }

    // Logo DIREITA (ao lado direito do título, ainda na coluna esquerda)
    try {
        if (logoDireitaPath && fs.existsSync(logoDireitaPath)) {
            doc.image(logoDireitaPath, leftX + leftW - logoW, topY + mm(1), {
                fit: [logoW, headH - mm(2)]
            });
        }
    } catch (err) {
        console.error('Erro ao desenhar logo direita na carteirinha:', err);
    }

    // Título centralizado entre as duas imagens
    const headGap = mm(4);
    const titleX = leftX + logoW + headGap;
    const titleW = leftW - (logoW * 2 + headGap * 2);

    doc.fillColor('#000')
        .font('Helvetica-Bold')
        .fontSize(9)
        .text('Documento de Identificação do Estudante', titleX, topY, {
            width: titleW,
            align: 'center'
        });

    // Corpo (foto + dados)
    const bodyY = topY + headH + mm(3);
    const fotoW = mm(30), fotoH = mm(32);
    const fotoX = leftX, fotoY = bodyY + mm(2);
    const fotoPadY = mm(1.2);

    // Foto do aluno ou foto padrão
    let fotoPath = null;
    if (aluno.foto_perfil && fs.existsSync(aluno.foto_perfil)) {
        fotoPath = aluno.foto_perfil;
    } else if (fotoPadraoAlunoPath && fs.existsSync(fotoPadraoAlunoPath)) {
        fotoPath = fotoPadraoAlunoPath;
    }

    if (fotoPath) {
        try {
            doc.image(fotoPath, fotoX, fotoY + fotoPadY, {
                width: fotoW,
                height: fotoH - (fotoPadY * 2)
            });
        } catch (err) {
            console.error('Erro ao desenhar foto na carteirinha:', err);
        }
    }

    // Moldura da foto
    doc.roundedRect(fotoX, fotoY, fotoW, fotoH, mm(2)).lineWidth(0.4).stroke('#000');

    const fieldsX = fotoX + fotoW + mm(6);
    const fieldsW = leftW - (fieldsX - leftX);
    let ty = bodyY + mm(2);

    const label = txt => {
        doc.fillColor('#444')
            .font('Helvetica')
            .fontSize(6)
            .text(txt, fieldsX, ty, { width: fieldsW });
        ty += mm(3.5);
    };

    const value = (txt, bold = false) => {
        doc.fillColor('#000')
            .font(bold ? 'Helvetica-Bold' : 'Helvetica')
            .fontSize(6)
            .text(txt || '', fieldsX, ty, { width: fieldsW });
        ty += mm(3.5);
    };

    // Campos
    label('Nome');
    value(aluno.pessoa_nome || aluno.nome || '', true);

    label('Escola');
    value(aluno.escola_nome || aluno.escola || aluno.unidade_ensino || '');

    label('Turma');
    value(aluno.turma || aluno.turma_escola || '');

    label('Ponto de Parada');
    const pontoId =
        aluno.ponto_id ??
        aluno.ponto_parada_id ??
        aluno.id_ponto ??
        null;

    if (pontoId) {
        value(`ID: ${pontoId}`);
    } else {
        ty += mm(1);
    }

    // Rodapé da coluna esquerda
    const footY = iy + ih - mm(12);
    doc.moveTo(leftX, footY).lineTo(leftX + leftW, footY).lineWidth(0.4).stroke('#000');

    const anoCarteira = aluno.ano || new Date().getFullYear();

    doc.font('Helvetica-Bold').fontSize(6).fillColor('#000')
        .text(`Válido para o ano de ${anoCarteira}`, leftX, footY + mm(6), {
            width: leftW / 2
        });

    const badgeTxt = 'Transporte Escolar';
    doc.font('Helvetica-Bold').fontSize(11);
    const bW = doc.widthOfString(badgeTxt) + mm(20);
    const bH = mm(10);
    const badgeX = leftX + leftW - bW;
    const badgeY = footY + mm(2);

    doc.save();
    doc.rect(badgeX, badgeY, bW, bH).fill('#fef08a');
    doc.fillColor('#000').font('Helvetica-Bold').fontSize(11)
        .text(badgeTxt, badgeX, badgeY + (bH / 2) - (doc.currentLineHeight() / 2), {
            width: bW,
            align: 'center'
        });
    doc.restore();

    // ---------- COLUNA DIREITA (QR) ----------
    if (exibirQr && qrPngBuffer && qrColW > 0) {
        const qrColX = rightX;
        const qrColY = topY;
        const qrColH = ih;

        const qrTop = qrColY + mm(0);
        let qrBox = mm(85);
        const minBottomClearance = mm(4);
        qrBox = Math.min(qrBox, qrColH - minBottomClearance);

        const qrLeft = qrColX + (qrColW - qrBox) / 2;

        try {
            doc.image(qrPngBuffer, qrLeft, qrTop, { width: qrBox, height: qrBox });
        } catch (err) {
            console.error('Erro ao desenhar QRCode na carteirinha:', err);
        }
    }

    doc.restore();
}

function drawCarteirinhaEstudante(doc, aluno, qrPng, branding) {
    const cardW = doc.page.width - doc.page.margins.left - doc.page.margins.right;
    const cardH = mm(68);

    const x = doc.page.margins.left;
    const y = doc.page.margins.top;

    drawIdCard(doc, aluno, x, y, cardW, cardH, qrPng, branding);
}

// =================== ROTA PRINCIPAL – COMPROVANTE + CARTEIRINHA ===================

router.post('/pdf', express.json({ limit: '10mb' }), async (req, res) => {
    try {
        let { alunos, aluno } = req.body || {};

        if (!Array.isArray(alunos)) {
            alunos = alunos ? alunos : [];
        }
        if (aluno && typeof aluno === 'object') {
            alunos.push(aluno);
        }

        if (!Array.isArray(alunos) || alunos.length === 0) {
            return res.status(400).json({ error: 'Nenhum aluno informado.' });
        }

        // Carrega branding por tenant (getBranding já trata default/1, etc.)
        const tenantId = req.tenantId || null;
        const branding = await getBranding(tenantId);
        const exibirQr = !branding || branding.flags?.carteirinhaExibirQr !== false;

        res.setHeader('Content-Type', 'application/pdf');
        res.setHeader(
            'Content-Disposition',
            'inline; filename="comprovantes_carteirinhas.pdf"'
        );

        const doc = new PDFDocument({
            size: 'A4',
            margin: mm(10)
        });

        doc.pipe(res);

        for (let i = 0; i < alunos.length; i++) {
            const a = alunos[i];

            if (i > 0) {
                doc.addPage();
            }

            // Página de comprovante com branding
            drawPaginaComprovante(doc, a, branding);

            const rota_associada =
                a.rota_associada ||
                (a.itinerario_id && a.linha
                    ? `${a.itinerario_id} - ${a.linha}`
                    : a.itinerario_id || a.linha || null);

            let qrPng = null;

            if (exibirQr) {
                const qrPayload = {
                    nome: a.pessoa_nome || a.nome || '',
                    escola: a.escola_nome || a.escola || '',
                    utiliza_transporte_escolar: ['municipal', 'estadual'].includes(
                        (a.transporte_escolar_poder_publico || '').toLowerCase()
                    ),
                    id_pessoa: a.id_pessoa ?? null,
                    id_aluno: a.id ?? null,
                    matricula: a.matricula ?? '',
                    cod_aluno: a.cod_aluno ?? '',
                    id_turma: a.id_turma ?? '',
                    itinerario_id: a.itinerario_id ?? null,
                    linha: a.linha ?? null,
                    rota_associada,
                    ponto_id: a.ponto_id ?? a.ponto_parada_id ?? null,
                    ponto_nome: a.ponto_nome || a.ponto_parada_nome || null,
                    ponto_lat: a.ponto_lat ?? null,
                    ponto_lng: a.ponto_lng ?? null,
                    escola_id: a.escola_id ?? null,
                    emitido_em: new Date().toISOString()
                };

                qrPng = await QR.toBuffer(JSON.stringify(qrPayload), {
                    width: 1200,
                    errorCorrectionLevel: 'M'
                });
            }

            doc.addPage();
            drawCarteirinhaEstudante(doc, a, qrPng, branding);
        }

        doc.end();
    } catch (e) {
        console.error('Erro em /carteirinhas/pdf:', e);
        if (!res.headersSent) {
            return res.status(500).json({ error: 'Falha ao gerar PDF.' });
        }
    }
});

// =================== ROTA – SOMENTE CARTEIRINHA ESCOLAR ===================

async function carregarPontoAssociado(aluno) {
    if (!aluno || !aluno.id) return aluno;

    // Se já vier com ponto em memória, não consulta de novo
    if (aluno.ponto_parada_id || aluno.ponto_id) {
        return aluno;
    }

    try {
        const { rows } = await pool.query(
            `
      SELECT 
        p.id,
        p.logradouro,
        p.numero,
        p.bairro
      FROM alunos_pontos ap
      JOIN pontos_parada p ON p.id = ap.ponto_id
      WHERE ap.aluno_id = $1
      `,
            [aluno.id]
        );

        if (!rows.length) return aluno;

        const p = rows[0];

        const nomePonto =
            p.logradouro
                ? `${p.logradouro}${p.numero ? ', ' + p.numero : ''}${p.bairro ? ' - ' + p.bairro : ''}`
                : `Ponto ${p.id}`;

        return {
            ...aluno,
            ponto_parada_id: p.id,
            ponto_parada_nome: nomePonto,
            ponto_id: p.id,
            ponto_nome: nomePonto
        };
    } catch (err) {
        console.error('Erro ao carregar ponto associado:', err);
        return aluno; // em caso de erro, segue sem ponto
    }
}

router.post(
    '/somente-carteirinha',
    express.json({ limit: '10mb' }),
    async (req, res) => {
        try {
            let { alunos, aluno } = req.body || {};

            if (!Array.isArray(alunos)) {
                alunos = alunos ? alunos : [];
            }
            if (aluno && typeof aluno === 'object') {
                alunos.push(aluno);
            }

            if (!Array.isArray(alunos) || alunos.length === 0) {
                return res.status(400).json({ error: 'Nenhum aluno informado.' });
            }

            // Branding do tenant
            const tenantId = req.tenantId || null;
            const branding = await getBranding(tenantId);
            const exibirQr = !branding || branding.flags?.carteirinhaExibirQr !== false;

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader(
                'Content-Disposition',
                'inline; filename="carteirinhas_escolares.pdf"'
            );

            const doc = new PDFDocument({
                size: 'A4',
                margin: mm(10)
            });

            doc.pipe(res);

            for (let i = 0; i < alunos.length; i++) {
                // garante que este aluno venha com o ponto associado a partir de alunos_pontos
                let a = alunos[i];
                a = await carregarPontoAssociado(a);

                if (i > 0) {
                    doc.addPage();
                }

                const rota_associada =
                    a.rota_associada ||
                    (a.itinerario_id && a.linha
                        ? `${a.itinerario_id} - ${a.linha}`
                        : a.itinerario_id || a.linha || null);

                let qrPng = null;

                if (exibirQr) {
                    const qrPayload = {
                        nome: a.pessoa_nome || a.nome || '',
                        escola: a.escola_nome || a.escola || '',
                        utiliza_transporte_escolar: ['municipal', 'estadual'].includes(
                            (a.transporte_escolar_poder_publico || '').toLowerCase()
                        ),
                        id_pessoa: a.id_pessoa ?? null,
                        id_aluno: a.id ?? null,
                        matricula: a.matricula ?? '',
                        cod_aluno: a.cod_aluno ?? '',
                        id_turma: a.id_turma ?? '',
                        itinerario_id: a.itinerario_id ?? null,
                        linha: a.linha ?? null,
                        rota_associada,
                        ponto_id: a.ponto_id ?? a.ponto_parada_id ?? null,
                        ponto_nome: a.ponto_nome || a.ponto_parada_nome || null,
                        ponto_lat: a.ponto_lat ?? null,
                        ponto_lng: a.ponto_lng ?? null,
                        escola_id: a.escola_id ?? null,
                        emitido_em: new Date().toISOString()
                    };

                    qrPng = await QR.toBuffer(JSON.stringify(qrPayload), {
                        width: 1200,
                        errorCorrectionLevel: 'M'
                    });
                }

                // desenha apenas a carteirinha com branding
                drawCarteirinhaEstudante(doc, a, qrPng, branding);
            }

            doc.end();
        } catch (e) {
            console.error('Erro em /carteirinhas/somente-carteirinha:', e);
            if (!res.headersSent) {
                return res.status(500).json({ error: 'Falha ao gerar carteirinha.' });
            }
        }
    }
);

// =================== ROTA – COMPROVANTE SOMENTE (NÃO APTO, OU OUTROS) ===================
router.post(
    '/comprovante-nao-apto',
    express.json({ limit: '2mb' }),
    async (req, res) => {
        try {
            const { aluno } = req.body || {};
            if (!aluno || typeof aluno !== 'object') {
                return res.status(400).json({ error: 'Aluno não informado.' });
            }

            const tenantId = req.tenantId || null;
            const branding = await getBranding(tenantId);

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader(
                'Content-Disposition',
                'inline; filename="comprovante_nao_apto.pdf"'
            );

            const doc = new PDFDocument({
                size: 'A4',
                margin: mm(10)
            });

            doc.pipe(res);

            // Usa a mesma página de comprovante já pronta, com branding
            drawPaginaComprovante(doc, aluno, branding);

            doc.end();
        } catch (e) {
            console.error('Erro em /carteirinhas/comprovante-nao-apto:', e);
            if (!res.headersSent) {
                return res.status(500).json({ error: 'Falha ao gerar comprovante de não apto.' });
            }
        }
    }
);

export default router;
