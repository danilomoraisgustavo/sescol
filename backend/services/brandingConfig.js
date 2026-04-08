// backend/services/brandingConfig.js
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pool from '../db.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Diretório físico onde os arquivos de logo serão salvos.
export const BRANDING_UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'branding');

// Garante que o diretório existe
if (!fs.existsSync(BRANDING_UPLOAD_DIR)) {
    fs.mkdirSync(BRANDING_UPLOAD_DIR, { recursive: true });
}

// Nome da tabela
const TABLE_NAME = 'sistema_branding';

// Garante que haja uma linha por tenant
async function ensureBrandingRow(tenantId) {
    const tid = Number(tenantId) || 1;
    const query = `
        INSERT INTO ${TABLE_NAME} (tenant_id)
        SELECT $1
        WHERE NOT EXISTS (
            SELECT 1
            FROM ${TABLE_NAME}
            WHERE tenant_id = $1
        );
    `;
    await pool.query(query, [tid]);
}

// Carrega a linha bruta do banco
export async function getBrandingRow(tenantId) {
    const tid = Number(tenantId) || 1;
    await ensureBrandingRow(tid);

    const { rows } = await pool.query(
        `SELECT * FROM ${TABLE_NAME} WHERE tenant_id = $1 LIMIT 1`,
        [tid]
    );

    return rows[0] || null;
}

// Monta URLs públicas das logos a partir do path salvo no banco
function buildLogoUrls(row) {
    if (!row) {
        return {
            logo_principal_url: null,
            logo_secundaria_url: null,
            logo_extra_url: null,
            foto_padrao_aluno_url: null,
            separador_imagem_url: null
        };
    }

    const baseUrl = '/uploads/branding';
    const makeUrl = (fileName) => (fileName ? `${baseUrl}/${fileName}` : null);

    return {
        logo_principal_url: makeUrl(row.logo_principal_path),
        logo_secundaria_url: makeUrl(row.logo_secundaria_path),
        logo_extra_url: makeUrl(row.logo_extra_path),
        foto_padrao_aluno_url: makeUrl(row.foto_padrao_aluno_path),
        separador_imagem_url: makeUrl(row.doc_separador_imagem_path)
    };
}

// Payload para o frontend (configuracoes.html)
export function buildBrandingApiPayload(row) {
    const logos = buildLogoUrls(row || {});

    return {
        // Campos básicos
        nome_sistema: row?.nome_sistema || '',
        telefone_contato: row?.telefone_contato || '',
        email_contato: row?.email_contato || '',
        site_oficial: row?.site_oficial || '',

        // URLs de logos
        logo_principal_url: logos.logo_principal_url,
        logo_secundaria_url: logos.logo_secundaria_url,
        logo_extra_url: logos.logo_extra_url,

        // Foto padrão de aluno (carteirinhas)
        foto_padrao_aluno_url: logos.foto_padrao_aluno_url,

        // Separador (imagem + flag)
        separador_imagem_url: logos.separador_imagem_url,
        // Se nulo no banco, consideramos ativo por padrão
        separador_ativo: row?.doc_separador_ativo === false ? false : true,

        // Ofícios – Cabeçalho (mapped para doc_cabecalho_*)
        oficio_cabecalho_linha1: row?.doc_cabecalho_linha1 || '',
        oficio_cabecalho_linha2: row?.doc_cabecalho_linha2 || '',
        oficio_cabecalho_linha3: row?.doc_cabecalho_linha3 || '',
        oficio_cabecalho_alinhamento: row?.doc_cabecalho_alinhamento || 'center',

        oficio_logo_esquerda_ativo: !!row?.doc_cabecalho_logo_esquerda_ativo,
        oficio_logo_direita_ativo: !!row?.doc_cabecalho_logo_direita_ativo,
        oficio_logo_esquerda_tipo: row?.doc_cabecalho_logo_esquerda_tipo || 'principal',
        oficio_logo_direita_tipo: row?.doc_cabecalho_logo_direita_tipo || 'secundaria',

        // Ofícios – Rodapé (texto)
        doc_rodape_linha1: row?.doc_rodape_linha1 || '',
        doc_rodape_linha2: row?.doc_rodape_linha2 || '',
        doc_rodape_linha3: row?.doc_rodape_linha3 || '',

        // Ofícios – Rodapé (imagens)
        rodape_logo_esquerda_ativo: !!row?.rodape_logo_esquerda_ativo,
        rodape_logo_centro_ativo: !!row?.rodape_logo_centro_ativo,
        rodape_logo_direita_ativo: !!row?.rodape_logo_direita_ativo,

        rodape_logo_esquerda_tipo: row?.rodape_logo_esquerda_tipo || 'principal',
        rodape_logo_centro_tipo: row?.rodape_logo_centro_tipo || 'secundaria',
        rodape_logo_direita_tipo: row?.rodape_logo_direita_tipo || 'extra',

        // Carteirinhas – configurações visuais
        carteirinha_logo_esquerda_ativo: !!row?.carteirinha_logo_esquerda_ativo,
        carteirinha_logo_direita_ativo: !!row?.carteirinha_logo_direita_ativo,
        carteirinha_logo_esquerda_tipo: row?.carteirinha_logo_esquerda_tipo || 'principal',
        carteirinha_logo_direita_tipo: row?.carteirinha_logo_direita_tipo || 'secundaria',
        carteirinha_exibir_qr_verso:
            row?.carteirinha_exibir_qr_verso === false ? false : true,

        // Extras usados em PDFs (termo etc.)
        cidade_uf: row?.cidade_uf || '',
        termo_paragrafo_extra: row?.termo_paragrafo_extra || ''
    };
}

// Salva/atualiza configuração a partir do payload do frontend + arquivos
export async function saveBrandingFromApi(tenantId, cfg, files) {
    const tid = Number(tenantId) || 1;
    await ensureBrandingRow(tid);

    const currentRow = await getBrandingRow(tid);

    // Trata logos (upload + remoção), incluindo foto padrão do aluno e separador
    const logoFields = {
        principal: {
            removeFlag: cfg.remove_logo_principal,
            dbColumn: 'logo_principal_path',
            fileArray: files?.logo_principal || []
        },
        secundaria: {
            removeFlag: cfg.remove_logo_secundaria,
            dbColumn: 'logo_secundaria_path',
            fileArray: files?.logo_secundaria || []
        },
        extra: {
            removeFlag: cfg.remove_logo_extra,
            dbColumn: 'logo_extra_path',
            fileArray: files?.logo_extra || []
        },
        foto_padrao_aluno: {
            removeFlag: cfg.remove_foto_padrao_aluno,
            dbColumn: 'foto_padrao_aluno_path',
            fileArray: files?.foto_padrao_aluno || []
        },
        separador: {
            removeFlag: cfg.remove_separador_imagem,
            dbColumn: 'doc_separador_imagem_path',
            fileArray: files?.doc_separador_imagem || []
        }
    };

    const updates = {
        nome_sistema: cfg.nome_sistema,
        telefone_contato: cfg.telefone_contato,
        email_contato: cfg.email_contato,
        site_oficial: cfg.site_oficial,

        // Cabeçalho
        doc_cabecalho_linha1: cfg.oficio_cabecalho_linha1,
        doc_cabecalho_linha2: cfg.oficio_cabecalho_linha2,
        doc_cabecalho_linha3: cfg.oficio_cabecalho_linha3,
        doc_cabecalho_alinhamento: cfg.oficio_cabecalho_alinhamento || 'center',

        doc_cabecalho_logo_esquerda_ativo: !!cfg.oficio_logo_esquerda_ativo,
        doc_cabecalho_logo_direita_ativo: !!cfg.oficio_logo_direita_ativo,
        doc_cabecalho_logo_esquerda_tipo: cfg.oficio_logo_esquerda_tipo || 'principal',
        doc_cabecalho_logo_direita_tipo: cfg.oficio_logo_direita_tipo || 'secundaria',

        // Separador (flag)
        doc_separador_ativo: cfg.doc_separador_ativo === false ? false : true,

        // Rodapé texto
        doc_rodape_linha1: cfg.doc_rodape_linha1,
        doc_rodape_linha2: cfg.doc_rodape_linha2,
        doc_rodape_linha3: cfg.doc_rodape_linha3,

        // Rodapé imagens
        rodape_logo_esquerda_ativo: !!cfg.rodape_logo_esquerda_ativo,
        rodape_logo_centro_ativo: !!cfg.rodape_logo_centro_ativo,
        rodape_logo_direita_ativo: !!cfg.rodape_logo_direita_ativo,

        rodape_logo_esquerda_tipo: cfg.rodape_logo_esquerda_tipo || 'principal',
        rodape_logo_centro_tipo: cfg.rodape_logo_centro_tipo || 'secundaria',
        rodape_logo_direita_tipo: cfg.rodape_logo_direita_tipo || 'extra',

        // Carteirinhas – configs
        carteirinha_logo_esquerda_ativo: !!cfg.carteirinha_logo_esquerda_ativo,
        carteirinha_logo_direita_ativo: !!cfg.carteirinha_logo_direita_ativo,
        carteirinha_logo_esquerda_tipo: cfg.carteirinha_logo_esquerda_tipo || 'principal',
        carteirinha_logo_direita_tipo: cfg.carteirinha_logo_direita_tipo || 'secundaria',
        carteirinha_exibir_qr_verso:
            cfg.carteirinha_exibir_qr_verso === false ? false : true,

        // Extras para PDFs (se vierem do front)
        cidade_uf: cfg.cidade_uf,
        termo_paragrafo_extra: cfg.termo_paragrafo_extra
    };

    // Processa cada logo (remoção / upload)
    for (const key of Object.keys(logoFields)) {
        const info = logoFields[key];
        const column = info.dbColumn;
        let currentValue = currentRow ? currentRow[column] : null;

        // Se marcar para remoção, apaga arquivo e zera coluna
        if (info.removeFlag && currentValue) {
            const oldPath = path.join(BRANDING_UPLOAD_DIR, currentValue);
            try {
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            } catch (err) {
                console.error(`Erro ao remover arquivo antigo (${column}):`, err);
            }
            currentValue = null;
        }

        // Se tiver novo upload, renomeia e atualiza
        if (info.fileArray && info.fileArray.length > 0) {
            const file = info.fileArray[0];
            const ext = path.extname(file.originalname) || '.png';
            const newFileName = `tenant_${tid}_${column}_${Date.now()}${ext}`;
            const destPath = path.join(BRANDING_UPLOAD_DIR, newFileName);

            try {
                fs.renameSync(file.path, destPath);
                // Se havia um arquivo antigo, tenta apagar
                if (currentValue) {
                    const oldPath = path.join(BRANDING_UPLOAD_DIR, currentValue);
                    if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
                }
                currentValue = newFileName;
            } catch (err) {
                console.error(`Erro ao mover arquivo (${column}):`, err);
            }
        }

        updates[column] = currentValue;
    }

    // Compatível com bases que ainda não têm UNIQUE(tenant_id)
    const cols = Object.keys(updates);
    const values = cols.map((c) => updates[c]);

    const setClause = cols
        .map((col, idx) => `${col} = $${idx + 2}`)
        .join(', ');
    const updateQuery = `
        UPDATE ${TABLE_NAME}
        SET ${setClause}
        WHERE tenant_id = $1;
    `;
    const updateResult = await pool.query(updateQuery, [tid, ...values]);

    if (!updateResult.rowCount) {
        const insertCols = ['tenant_id', ...cols];
        const insertPlaceholders = insertCols.map((_, idx) => `$${idx + 1}`);
        const insertValues = [tid, ...values];
        const insertQuery = `
            INSERT INTO ${TABLE_NAME} (${insertCols.join(', ')})
            SELECT ${insertPlaceholders.join(', ')}
            WHERE NOT EXISTS (
                SELECT 1
                FROM ${TABLE_NAME}
                WHERE tenant_id = $1
            );
        `;
        await pool.query(insertQuery, insertValues);
        await pool.query(updateQuery, [tid, ...values]);
    }

    // Retorna linha atualizada
    const row = await getBrandingRow(tid);
    return row;
}

// Helper interno para evitar typo no const
function BRANDNG_UPLOAD_DIR_SAFE() {
    return BRANDING_UPLOAD_DIR;
}

// Função usada pelos PDFs (termo, ofícios, carteirinhas etc.)
export async function getBranding(tenantId) {
    const row = await getBrandingRow(tenantId);
    const logos = buildLogoUrls(row);

    const files = {
        principalFile: row?.logo_principal_path
            ? path.join(BRANDNG_UPLOAD_DIR_SAFE(), row.logo_principal_path)
            : null,
        secundariaFile: row?.logo_secundaria_path
            ? path.join(BRANDNG_UPLOAD_DIR_SAFE(), row.logo_secundaria_path)
            : null,
        extraFile: row?.logo_extra_path
            ? path.join(BRANDNG_UPLOAD_DIR_SAFE(), row.logo_extra_path)
            : null,
        fotoPadraoAlunoFile: row?.foto_padrao_aluno_path
            ? path.join(BRANDNG_UPLOAD_DIR_SAFE(), row.foto_padrao_aluno_path)
            : null,
        separadorFile: row?.doc_separador_imagem_path
            ? path.join(BRANDNG_UPLOAD_DIR_SAFE(), row.doc_separador_imagem_path)
            : null
    };

    // Paths usados pela carteirinha
    const paths = {
        logo_principal: files.principalFile,
        logo_secundaria: files.secundariaFile,
        logo_extra: files.extraFile,
        foto_padrao_aluno: files.fotoPadraoAlunoFile
    };

    // Flags e config específicos da carteirinha
    const flags = {
        carteirinhaExibirImagemEsquerda: !!row?.carteirinha_logo_esquerda_ativo,
        carteirinhaExibirImagemDireita: !!row?.carteirinha_logo_direita_ativo,
        carteirinhaExibirQr:
            row?.carteirinha_exibir_qr_verso === false ? false : true
    };

    const cardConfig = {
        imagemEsquerdaTipo: row?.carteirinha_logo_esquerda_tipo || 'principal',
        imagemDireitaTipo: row?.carteirinha_logo_direita_tipo || 'secundaria'
    };

    return {
        raw: row,
        logos,
        files,
        paths,
        flags,
        cardConfig,
        header: {
            align: row?.doc_cabecalho_alinhamento || 'center',
            linhas: [
                row?.doc_cabecalho_linha1 || '',
                row?.doc_cabecalho_linha2 || '',
                row?.doc_cabecalho_linha3 || ''
            ],
            left: {
                ativo: !!row?.doc_cabecalho_logo_esquerda_ativo,
                tipo: row?.doc_cabecalho_logo_esquerda_tipo || 'principal'
            },
            right: {
                ativo: !!row?.doc_cabecalho_logo_direita_ativo,
                tipo: row?.doc_cabecalho_logo_direita_tipo || 'secundaria'
            }
        },
        footer: {
            linhas: [
                row?.doc_rodape_linha1 || '',
                row?.doc_rodape_linha2 || '',
                row?.doc_rodape_linha3 || ''
            ],
            left: {
                ativo: !!row?.rodape_logo_esquerda_ativo,
                tipo: row?.rodape_logo_esquerda_tipo || 'principal'
            },
            center: {
                ativo: !!row?.rodape_logo_centro_ativo,
                tipo: row?.rodape_logo_centro_tipo || 'secundaria'
            },
            right: {
                ativo: !!row?.rodape_logo_direita_ativo,
                tipo: row?.rodape_logo_direita_tipo || 'extra'
            }
        },
        separator: {
            ativo: row?.doc_separador_ativo === false ? false : true,
            file: files.separadorFile
        },
        texts: {
            termoParagrafoExtra: row?.termo_paragrafo_extra || ''
        }
    };
}

// Resolve tipo de logo ('principal' | 'secundaria' | 'extra') para caminho de arquivo
function resolveLogoFile(branding, tipo) {
    if (!branding || !branding.files) return null;
    switch (tipo) {
        case 'principal':
            return branding.files.principalFile;
        case 'secundaria':
            return branding.files.secundariaFile;
        case 'extra':
            return branding.files.extraFile;
        default:
            return null;
    }
}

// Desenha separador padrão (cabeçalho/rodapé) usando a mesma config
function drawSeparator(doc, branding, y) {
    if (!branding || !branding.separator) return;

    const separator = branding.separator;
    if (separator.ativo === false) return;

    const marginLeft = doc.page.margins.left || 50;
    const marginRight = doc.page.margins.right || 50;
    const pageWidth = doc.page.width;
    const usableWidth = pageWidth - marginLeft - marginRight;

    const file = separator.file;

    if (file && fs.existsSync(file)) {
        // Usa imagem como faixa horizontal
        try {
            doc.image(file, marginLeft, y, {
                width: usableWidth
            });
        } catch (err) {
            console.error('Erro ao desenhar imagem de separador:', err);
        }
    } else {
        // Fallback: linha simples
        doc
            .moveTo(marginLeft, y + 1)
            .lineTo(pageWidth - marginRight, y + 1)
            .strokeColor('#CCCCCC')
            .lineWidth(0.5)
            .stroke()
            .strokeColor('#000000');
    }
}

// Desenha cabeçalho padrão (usado em termos, ofícios etc.)
export function drawCabecalho(doc, branding) {
    if (!doc || !branding) return;

    const header = branding.header || {};
    const linhas = header.linhas || [];
    const align = header.align || 'center';

    const marginLeft = doc.page.margins.left || 50;
    const marginRight = doc.page.margins.right || 50;
    const pageWidth = doc.page.width;
    const usableWidth = pageWidth - marginLeft - marginRight;

    const topY = doc.page.margins.top || 50;
    const logoSize = 60;

    // Imagem esquerda
    if (header.left?.ativo) {
        const file = resolveLogoFile(branding, header.left.tipo);
        if (file && fs.existsSync(file)) {
            try {
                doc.image(file, marginLeft, topY, {
                    fit: [logoSize, logoSize]
                });
            } catch (err) {
                console.error('Erro ao desenhar logo esquerda no cabeçalho:', err);
            }
        }
    }

    // Imagem direita
    if (header.right?.ativo) {
        const file = resolveLogoFile(branding, header.right.tipo);
        if (file && fs.existsSync(file)) {
            const x = pageWidth - marginRight - logoSize;
            try {
                doc.image(file, x, topY, {
                    fit: [logoSize, logoSize]
                });
            } catch (err) {
                console.error('Erro ao desenhar logo direita no cabeçalho:', err);
            }
        }
    }

    // Texto do cabeçalho
    const textStartY = topY + 5;
    doc.fontSize(11).font('Helvetica-Bold');

    linhas.forEach((linha, idx) => {
        if (!linha) return;
        doc.text(linha, marginLeft, textStartY + (doc.currentLineHeight() * idx), {
            width: usableWidth,
            align: align
        });
    });

    // Desenha separador abaixo do texto do cabeçalho
    const sepY = (doc.y || (topY + logoSize)) + 8;
    drawSeparator(doc, branding, sepY);

    doc.moveDown(3);
}

// Desenha rodapé (último bloco da página)
export function drawRodape(doc, branding) {
    if (!doc || !branding) return;

    const footer = branding.footer || {};
    const linhas = footer.linhas || [];

    const marginLeft = doc.page.margins.left || 50;
    const marginRight = doc.page.margins.right || 50;
    const pageWidth = doc.page.width;
    const pageHeight = doc.page.height;
    const usableWidth = pageWidth - marginLeft - marginRight;

    const logoSize = 40;
    const footerHeight = 135;
    const baseY = pageHeight - footerHeight;

    // Separador acima do rodapé (mesma config do cabeçalho)
    const sepY = baseY - 12;
    drawSeparator(doc, branding, sepY);

    // Imagem esquerda
    if (footer.left?.ativo) {
        const file = resolveLogoFile(branding, footer.left.tipo);
        if (file && fs.existsSync(file)) {
            try {
                doc.image(file, marginLeft, baseY, {
                    fit: [logoSize, logoSize]
                });
            } catch (err) {
                console.error('Erro ao desenhar logo rodapé esquerda:', err);
            }
        }
    }

    // Imagem direita
    if (footer.right?.ativo) {
        const file = resolveLogoFile(branding, footer.right.tipo);
        if (file && fs.existsSync(file)) {
            const x = pageWidth - marginRight - logoSize;
            try {
                doc.image(file, x, baseY, {
                    fit: [logoSize, logoSize]
                });
            } catch (err) {
                console.error('Erro ao desenhar logo rodapé direita:', err);
            }
        }
    }

    // Imagem central
    if (footer.center?.ativo) {
        const file = resolveLogoFile(branding, footer.center.tipo);
        if (file && fs.existsSync(file)) {
            const x = marginLeft + (usableWidth / 2) - (logoSize / 2);
            try {
                doc.image(file, x, baseY, {
                    fit: [logoSize, logoSize]
                });
            } catch (err) {
                console.error('Erro ao desenhar logo rodapé centro:', err);
            }
        }
    }

    // Texto do rodapé (centralizado)
    const textY = baseY + logoSize + 2;
    doc.fontSize(10).font('Helvetica');

    linhas.forEach((linha, idx) => {
        if (!linha) return;
        doc.text(linha, marginLeft, textY + (idx * 10), {
            width: usableWidth,
            align: 'center'
        });
    });

    // ================== META: DATA/HORA + PAGINAÇÃO ==================

    // Data/hora de emissão (agora). Se quiser, pode passar uma data fixa via parâmetro extra.
    const agora = new Date();
    const hora = agora.toLocaleTimeString('pt-BR', {
        hour: '2-digit',
        minute: '2-digit'
    });
    const dia = String(agora.getDate()).padStart(2, '0');
    const mesExtenso = agora.toLocaleString('pt-BR', { month: 'long' });
    const ano = agora.getFullYear();

    const dataHoraStr = `${hora}, ${dia} de ${mesExtenso} de ${ano}`;

    // Número da página atual
    let pageNumber = doc.pageNumber || 1;

    // Tentativa de total de páginas (pode não ser o valor final se estiver streamando)
    let totalPages = pageNumber;
    try {
        const maybeTotal =
            doc._root &&
            doc._root.data &&
            doc._root.data.Pages &&
            doc._root.data.Pages.data &&
            doc._root.data.Pages.data.Count;

        if (typeof maybeTotal === 'number' && maybeTotal >= pageNumber) {
            totalPages = maybeTotal;
        }
    } catch (err) {
        // Se falhar, continua só com o número atual.
    }

    const metaY = textY + (linhas.length * 10) + 4;

    doc.fontSize(7).font('Helvetica');

    // Esquerda: data/hora
    doc.text(dataHoraStr, marginLeft, metaY, {
        width: usableWidth / 2,
        align: 'left'
    });

    // Direita: paginação
    const paginacaoStr = `Página ${pageNumber} de ${totalPages}`;
    doc.text(paginacaoStr, marginLeft + usableWidth / 2, metaY, {
        width: usableWidth / 2,
        align: 'right'
    });
}
