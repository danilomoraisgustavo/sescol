import express from 'express';

const router = express.Router();

router.get('/:cep', async (req, res) => {
    try {
        const cep = String(req.params.cep || '').replace(/\D/g, '');

        if (cep.length !== 8) {
            return res.status(400).json({ error: 'CEP inválido. Use 8 dígitos.' });
        }

        const r = await fetch(`https://viacep.com.br/ws/${cep}/json/`, {
            headers: { 'Accept': 'application/json' }
        });

        if (!r.ok) {
            return res.status(502).json({ error: 'Falha ao consultar ViaCEP', status: r.status });
        }

        const data = await r.json();

        if (data?.erro) {
            return res.status(404).json({ error: 'CEP não encontrado', viacep: data });
        }

        return res.json(data);
    } catch (err) {
        console.error('Erro rota CEP:', err);
        return res.status(500).json({ error: 'Erro interno ao consultar CEP' });
    }
});

export default router;