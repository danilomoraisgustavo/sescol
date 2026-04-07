// backend/routes/termoConfirmacao.js (ou o nome que você estiver usando)
import express from 'express';
import PDFDocument from 'pdfkit';
import pool from '../db.js';
import { getBranding, drawCabecalho, drawRodape } from '../services/brandingConfig.js';

const router = express.Router();

router.get('/:id/gerar-pdf', async (req, res) => {
    const { id } = req.params;
    const signer = req.query.signer || 'filiacao1';

    try {
        const query = `
            SELECT
                a.id,
                a.pessoa_nome AS aluno_nome,
                a.cpf,
                e.nome AS escola_nome,
                a.turma,
                a.deficiencia,
                a.rua,
                a.bairro,
                a.numero_pessoa_endereco,
                ST_Y(a.localizacao::geometry) AS latitude,
                ST_X(a.localizacao::geometry) AS longitude,
                a.filiacao_1,
                a.filiacao_2,
                a.responsavel
            FROM alunos_municipais a
            LEFT JOIN alunos_escolas ae ON ae.aluno_id = a.id
            LEFT JOIN escolas e ON e.id = ae.escola_id
            WHERE a.id = $1
        `;

        const result = await pool.query(query, [id]);

        if (result.rows.length === 0) {
            return res
                .status(404)
                .json({ success: false, message: 'Aluno não encontrado.' });
        }

        const aluno = result.rows[0];

        // Quem assina (filiacao_1, filiacao_2 ou responsavel)
        let signerName = '______________________';
        if (signer === 'filiacao2') {
            signerName = aluno.filiacao_2 || '______________________';
        } else if (signer === 'responsavel') {
            signerName = aluno.responsavel || '______________________';
        } else {
            signerName = aluno.filiacao_1 || '______________________';
        }

        // Carrega branding do tenant (sempre numérico para evitar erro do PostgreSQL)
        const tenantId = Number(req.tenantId) || 1;
        const branding = await getBranding(tenantId);

        const cidadeUf = branding?.raw?.cidade_uf || '';
        const municipioTexto = cidadeUf
            ? `no município de ${cidadeUf}`
            : 'neste município';

        const termoExtra = branding?.texts?.termoParagrafoExtra || '';

        const doc = new PDFDocument({ size: 'A4', margin: 50 });

        res.setHeader(
            'Content-Disposition',
            `inline; filename=termo_cadastro_${id}.pdf`
        );
        res.setHeader('Content-Type', 'application/pdf');

        doc.pipe(res);

        // Cabeçalho dinâmico (linhas configuradas no painel)
        drawCabecalho(doc, branding);

        // Título
        doc.y = 130;
        doc.x = 50;
        doc
            .fontSize(14)
            .font('Helvetica-Bold')
            .text('TERMO DE CONFIRMAÇÃO DE CRITÉRIOS', {
                align: 'center',
                underline: false
            });

        doc.moveDown(1);
        doc.lineGap(4);

        // Corpo principal
        doc
            .fontSize(12)
            .font('Helvetica')
            .text(`Eu, ${signerName}, `, { align: 'justify', continued: true })
            .text('confirmo que sou o(a) responsável pelo(a) aluno(a) ', {
                continued: true
            })
            .font('Helvetica-Bold')
            .text(`${aluno.aluno_nome || ''}`, { continued: true })
            .font('Helvetica')
            .text(', portador(a) do CPF nº ', { continued: true })
            .font('Helvetica-Bold')
            .text(`${aluno.cpf || ''}`, { continued: true })
            .font('Helvetica')
            .text(', devidamente matriculado(a) na Escola ', { continued: true })
            .font('Helvetica-Bold')
            .text(`${aluno.escola_nome || ''}`, { continued: true })
            .font('Helvetica')
            .text('. Residente no endereço: ', { continued: true })
            .font('Helvetica-Bold')
            .text(`${aluno.rua || ''}`, { continued: true })
            .font('Helvetica')
            .text(', nº ', { continued: true })
            .font('Helvetica-Bold')
            .text(`${aluno.numero_pessoa_endereco || ''}`, { continued: true })
            .font('Helvetica')
            .text(', Bairro ', { continued: true })
            .font('Helvetica-Bold')
            .text(`${aluno.bairro || ''}`, { continued: true })
            .font('Helvetica')
            .text(
                '. Declaro, para os devidos fins, a veracidade das informações acima, bem como minha plena consciência e responsabilidade sobre os dados fornecidos, estando ciente de que a omissão ou falsidade de dados pode acarretar o cancelamento do direito ao transporte e responsabilizações legais cabíveis.'
            );

        doc.moveDown(1);

        // Critérios
        doc.font('Helvetica-Bold').text('CRITÉRIOS DE ELEGIBILIDADE:', {
            align: 'left'
        });
        doc.font('Helvetica');

        const criterios = [
            'Idade Mínima: 4 (quatro) anos completos até 31 de março do ano vigente.',
            'Distância Mínima para Educação Infantil: residência a mais de 1,5 km da escola e para Ensino Fundamental e EJA: residência a mais de 2 km da escola.',
            'Alunos com Necessidades Especiais: apresentar laudo médico. Priorização conforme a necessidade, demandando transporte adaptado.'
        ];

        doc.moveDown(0.5).list(criterios, { align: 'justify' });

        doc.moveDown(1);
        doc
            .font('Helvetica')
            .text(
                `Declaro ciência e concordância com os critérios acima descritos para a utilização do Transporte Escolar ${municipioTexto}. Estou ciente de que somente após a verificação desses critérios e a efetivação do cadastro o(a) aluno(a) estará habilitado(a) para o uso do transporte escolar, caso necessário. `,
                { align: 'justify' }
            );

        doc.moveDown(1);
        doc
            .font('Helvetica')
            .text(
                'Por meio deste, autorizo o uso da imagem do(a) aluno(a) para fins de reconhecimento facial no sistema de embarque e desembarque do Transporte Escolar, ciente de que tal procedimento visa exclusivamente à segurança e identificação do(a) aluno(a).',
                { align: 'justify' }
            );

        // Parágrafo extra configurável no painel (opcional)
        if (termoExtra && termoExtra.trim().length > 0) {
            doc.moveDown(1);
            doc
                .font('Helvetica')
                .text(termoExtra, { align: 'justify' });
        }

        doc.moveDown(2);
        doc.text('_____________________________________________', { align: 'center' });
        doc
            .font('Helvetica-Bold')
            .text('Assinatura do Responsável', { align: 'center' });

        doc.moveDown(2);

        // Rodapé dinâmico (linhas configuradas no painel)
        drawRodape(doc, branding);

        doc.end();
    } catch (error) {
        console.error('Erro ao gerar PDF do termo:', error);
        if (!res.headersSent) {
            return res.status(500).json({
                success: false,
                message: 'Erro ao gerar PDF do termo.'
            });
        }
    }
});

export default router;
