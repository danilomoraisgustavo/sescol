// backend/routes/branding.js
import express from 'express';
import multer from 'multer';
import path from 'path';
import { fileURLToPath } from 'url';

import {
    BRANDING_UPLOAD_DIR,
    getBrandingRow,
    buildBrandingApiPayload,
    saveBrandingFromApi
} from '../services/brandingConfig.js';

const router = express.Router();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Configuração do multer para salvar arquivos (logos + foto padrão + separador)
const storage = multer.diskStorage({
    destination: function (req, file, cb) {
        cb(null, BRANDING_UPLOAD_DIR);
    },
    filename: function (req, file, cb) {
        const ext = path.extname(file.originalname) || '.png';
        const tmpName = `tmp_${Date.now()}_${Math.round(Math.random() * 1e9)}${ext}`;
        cb(null, tmpName);
    }
});

const upload = multer({ storage }).fields([
    { name: 'logo_principal', maxCount: 1 },
    { name: 'logo_secundaria', maxCount: 1 },
    { name: 'logo_extra', maxCount: 1 },
    { name: 'foto_padrao_aluno', maxCount: 1 },
    { name: 'doc_separador_imagem', maxCount: 1 } // novo campo do separador
]);

// GET /api/config/branding
router.get('/', async (req, res) => {
    try {
        const tenantId = Number(req.tenantId) || 1;
        const row = await getBrandingRow(tenantId);
        const payload = buildBrandingApiPayload(row);
        return res.json(payload);
    } catch (err) {
        console.error('Erro ao carregar configurações de branding:', err);
        return res.status(500).json({
            success: false,
            message: 'Erro ao carregar configurações de branding.'
        });
    }
});

// POST /api/config/branding
router.post('/', (req, res) => {
    upload(req, res, async (err) => {
        if (err) {
            console.error('Erro no upload de arquivos de branding:', err);
            return res.status(500).json({
                success: false,
                message: 'Erro no upload de arquivos de branding.'
            });
        }

        try {
            const tenantId = Number(req.tenantId) || 1;

            let cfg = {};
            if (req.body && req.body.config) {
                try {
                    cfg = JSON.parse(req.body.config);
                } catch (parseErr) {
                    console.error('Erro ao parsear JSON de config:', parseErr);
                    return res.status(400).json({
                        success: false,
                        message: 'Payload de configuração inválido.'
                    });
                }
            }

            // Normaliza flags de remoção de logos
            cfg.remove_logo_principal =
                cfg.remove_logo_principal === true ||
                cfg.remove_logo_principal === 'true' ||
                cfg.remove_logo_principal === '1';

            cfg.remove_logo_secundaria =
                cfg.remove_logo_secundaria === true ||
                cfg.remove_logo_secundaria === 'true' ||
                cfg.remove_logo_secundaria === '1';

            cfg.remove_logo_extra =
                cfg.remove_logo_extra === true ||
                cfg.remove_logo_extra === 'true' ||
                cfg.remove_logo_extra === '1';

            cfg.remove_foto_padrao_aluno =
                cfg.remove_foto_padrao_aluno === true ||
                cfg.remove_foto_padrao_aluno === 'true' ||
                cfg.remove_foto_padrao_aluno === '1';

            // Nova flag: remover imagem do separador
            cfg.remove_separador_imagem =
                cfg.remove_separador_imagem === true ||
                cfg.remove_separador_imagem === 'true' ||
                cfg.remove_separador_imagem === '1';

            // Normaliza switches de cabeçalho
            cfg.oficio_logo_esquerda_ativo =
                cfg.oficio_logo_esquerda_ativo === true ||
                cfg.oficio_logo_esquerda_ativo === 'true' ||
                cfg.oficio_logo_esquerda_ativo === '1';

            cfg.oficio_logo_direita_ativo =
                cfg.oficio_logo_direita_ativo === true ||
                cfg.oficio_logo_direita_ativo === 'true' ||
                cfg.oficio_logo_direita_ativo === '1';

            // Normaliza switches de rodapé
            cfg.rodape_logo_esquerda_ativo =
                cfg.rodape_logo_esquerda_ativo === true ||
                cfg.rodape_logo_esquerda_ativo === 'true' ||
                cfg.rodape_logo_esquerda_ativo === '1';

            cfg.rodape_logo_centro_ativo =
                cfg.rodape_logo_centro_ativo === true ||
                cfg.rodape_logo_centro_ativo === 'true' ||
                cfg.rodape_logo_centro_ativo === '1';

            cfg.rodape_logo_direita_ativo =
                cfg.rodape_logo_direita_ativo === true ||
                cfg.rodape_logo_direita_ativo === 'true' ||
                cfg.rodape_logo_direita_ativo === '1';

            // Normaliza switches das carteirinhas
            cfg.carteirinha_logo_esquerda_ativo =
                cfg.carteirinha_logo_esquerda_ativo === true ||
                cfg.carteirinha_logo_esquerda_ativo === 'true' ||
                cfg.carteirinha_logo_esquerda_ativo === '1';

            cfg.carteirinha_logo_direita_ativo =
                cfg.carteirinha_logo_direita_ativo === true ||
                cfg.carteirinha_logo_direita_ativo === 'true' ||
                cfg.carteirinha_logo_direita_ativo === '1';

            // QR Code no verso: default TRUE, só é falso se vier explicitamente falso/0
            if (
                cfg.carteirinha_exibir_qr_verso === false ||
                cfg.carteirinha_exibir_qr_verso === 'false' ||
                cfg.carteirinha_exibir_qr_verso === '0'
            ) {
                cfg.carteirinha_exibir_qr_verso = false;
            } else {
                cfg.carteirinha_exibir_qr_verso = true;
            }

            // Novo switch: exibição do separador (cabeçalho e rodapé)
            // default = TRUE, só fica false se vier explicitamente falso/0
            if (
                cfg.doc_separador_ativo === false ||
                cfg.doc_separador_ativo === 'false' ||
                cfg.doc_separador_ativo === '0'
            ) {
                cfg.doc_separador_ativo = false;
            } else {
                cfg.doc_separador_ativo = true;
            }

            // Salva no banco
            const row = await saveBrandingFromApi(tenantId, cfg, req.files || {});
            const payload = buildBrandingApiPayload(row);

            return res.json(payload);
        } catch (saveErr) {
            console.error('Erro ao salvar configurações de branding:', saveErr);
            return res.status(500).json({
                success: false,
                message: 'Erro ao salvar configurações de branding.'
            });
        }
    });
});

export default router;
