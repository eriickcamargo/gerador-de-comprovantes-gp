const { GoogleGenerativeAI } = require('@google/generative-ai');
const fs = require('fs');
const path = require('path');

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const EXTRACTION_PROMPT = `Analise este comprovante de pagamento PIX e extraia os dados em JSON.
Retorne APENAS o JSON válido, sem texto adicional, sem markdown, sem explicações.

Formato esperado:
{
  "valor": "R$ 000,00",
  "data": "DD/MM/AAAA",
  "hora": "HH:MM",
  "nome_beneficiario": "Nome completo do favorecido",
  "nome_pagador": "Nome ou razão social de quem pagou",
  "cnpj_pagador": "00.000.000/0001-00 ou null se não disponível",
  "chave_pix": "chave pix real do beneficiário (CPF, e-mail, telefone ou chave aleatória) ou null",
  "agencia_conta": "agência e conta do beneficiário (ex: 1 / 12345678-9) ou null",
  "id_transacao": "código E ou ID da transação ou null",
  "banco_beneficiario": "nome do banco/fintech do beneficiário ou null"
}

ATENÇÃO:
- "chave_pix" e "agencia_conta" são campos SEPARADOS — nunca misture os dois.
- Se o comprovante mostrar apenas agência/conta sem chave PIX, "chave_pix" deve ser null.
- "valor" deve incluir o símbolo R$ e vírgula decimal (ex: "R$ 1.250,00").
- "data" deve estar no formato DD/MM/AAAA.
- Todos os campos desconhecidos devem ser null (não string vazia).`;

const RETRYABLE_STATUSES = new Set([503, 429]);
const MAX_RETRIES = 3;
const RETRY_BASE_DELAY_MS = 3000;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Extrai dados de um comprovante PIX usando Google Gemini Vision.
 * Tenta até MAX_RETRIES vezes em caso de 503/429 com backoff exponencial.
 * @param {string} filePath - Caminho local do arquivo (imagem ou PDF)
 * @returns {Object} Dados extraídos do comprovante
 */
async function extractFromVoucher(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  const fileBuffer = fs.readFileSync(filePath);
  const base64Data = fileBuffer.toString('base64');

  const mimeMap = {
    '.jpg':  'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.png':  'image/png',
    '.webp': 'image/webp',
    '.pdf':  'application/pdf',
  };
  const mimeType = mimeMap[ext] || 'image/jpeg';

  const model = genAI.getGenerativeModel({ model: 'gemini-2.5-flash' });

  let lastError;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    try {
      const result = await model.generateContent([
        { inlineData: { data: base64Data, mimeType } },
        EXTRACTION_PROMPT,
      ]);

      const rawText = result.response.text().trim();
      const jsonText = rawText
        .replace(/^```(?:json)?\s*/i, '')
        .replace(/\s*```$/, '')
        .trim();

      try {
        return JSON.parse(jsonText);
      } catch {
        console.error('Erro ao parsear JSON da IA:', rawText);
        throw new Error(
          'A IA não retornou um JSON válido. Tente reenviar o comprovante com melhor qualidade.'
        );
      }
    } catch (err) {
      const isRetryable = RETRYABLE_STATUSES.has(err.status);
      if (!isRetryable || attempt === MAX_RETRIES) throw err;

      const delay = RETRY_BASE_DELAY_MS * attempt;
      console.warn(`Gemini retornou ${err.status} (tentativa ${attempt}/${MAX_RETRIES}). Aguardando ${delay / 1000}s...`);
      lastError = err;
      await sleep(delay);
    }
  }

  throw lastError;
}

module.exports = { extractFromVoucher };
