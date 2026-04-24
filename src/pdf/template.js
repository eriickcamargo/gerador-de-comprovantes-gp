const LOGO_DATA_URL = require('./logo_base64');

/**
 * Converte valor numérico para extenso em português brasileiro
 * Ex: 1250.00 -> "um mil duzentos e cinquenta reais"
 */
function valorPorExtenso(valorStr) {
  const cleaned = String(valorStr || '')
    .replace('R$', '')
    .replace(/\./g, '')
    .replace(',', '.')
    .trim();

  const num = parseFloat(cleaned);
  if (isNaN(num)) return valorStr;

  const inteiros = Math.floor(num);
  const centavos = Math.round((num - inteiros) * 100);

  const unidades = ['', 'um', 'dois', 'três', 'quatro', 'cinco', 'seis', 'sete', 'oito', 'nove',
    'dez', 'onze', 'doze', 'treze', 'quatorze', 'quinze', 'dezesseis', 'dezessete', 'dezoito', 'dezenove'];
  const dezenas = ['', '', 'vinte', 'trinta', 'quarenta', 'cinquenta',
    'sessenta', 'setenta', 'oitenta', 'noventa'];
  const centenas = ['', 'cento', 'duzentos', 'trezentos', 'quatrocentos',
    'quinhentos', 'seiscentos', 'setecentos', 'oitocentos', 'novecentos'];

  function converteGrupo(n) {
    if (n === 0) return '';
    if (n === 100) return 'cem';
    const c = Math.floor(n / 100);
    const d = Math.floor((n % 100) / 10);
    const u = n % 10;
    const partes = [];
    if (c > 0) partes.push(centenas[c]);
    if (n % 100 < 20 && n % 100 > 0) {
      partes.push(unidades[n % 100]);
    } else {
      if (d > 0) partes.push(dezenas[d]);
      if (u > 0) partes.push(unidades[u]);
    }
    return partes.join(' e ');
  }

  function converteInteiro(n) {
    if (n === 0) return 'zero';
    const bilhoes = Math.floor(n / 1_000_000_000);
    const milhoes = Math.floor((n % 1_000_000_000) / 1_000_000);
    const milhares = Math.floor((n % 1_000_000) / 1_000);
    const resto = n % 1_000;

    const partes = [];
    if (bilhoes > 0) partes.push(converteGrupo(bilhoes) + (bilhoes === 1 ? ' bilhão' : ' bilhões'));
    if (milhoes > 0) partes.push(converteGrupo(milhoes) + (milhoes === 1 ? ' milhão' : ' milhões'));
    if (milhares > 0) partes.push(converteGrupo(milhares) + ' mil');
    if (resto > 0) partes.push(converteGrupo(resto));
    return partes.join(' e ');
  }

  const parteInteira = converteInteiro(inteiros);
  const moedaInteira = inteiros === 1 ? 'real' : 'reais';

  if (centavos === 0) {
    return `${parteInteira} ${moedaInteira}`;
  }

  const parteCentavos = unidades[centavos] || `${dezenas[Math.floor(centavos / 10)]}${centavos % 10 ? ' e ' + unidades[centavos % 10] : ''}`;
  const moedaCentavos = centavos === 1 ? 'centavo' : 'centavos';

  if (inteiros === 0) {
    return `${parteCentavos} ${moedaCentavos}`;
  }

  return `${parteInteira} ${moedaInteira} e ${parteCentavos} ${moedaCentavos}`;
}

/**
 * Gera o HTML completo do recibo — layout "Corporativo Sóbrio"
 * Logo no topo, régua fina vermelha como acento, tipografia editorial.
 */
function buildReceiptHTML(data) {
  const {
    receiptNumber,
    companyName,
    companyCnpj,
    companyAddress,
    employeeName,
    cargo,
    setor,
    amount,
    valeType,
    paymentDate,
    paymentTime,
    pixKey,
    agenciaConta,
    bankName,
    paymentMethod,
    extraData,
    employeeCpf,
    transactionId,
  } = data;

  const isDinheiro = paymentMethod === 'dinheiro';
  const amountExtenso = valorPorExtenso(amount || '');
  const today = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  // Texto da referência (pode ter extras para Férias/13º)
  let pagamentoReferencia = valeType || '—';
  let extraDetails = '';
  if (valeType === 'Férias' && extraData) {
    pagamentoReferencia = 'Férias (com 1/3 Constitucional)';
    const linhas = [];
    if (extraData.periodoAquisitivo) linhas.push(`Período Aquisitivo: <strong>${extraData.periodoAquisitivo}</strong>`);
    if (extraData.periodoGozo) linhas.push(`Período de Gozo: <strong>${extraData.periodoGozo}</strong>`);
    if (linhas.length) extraDetails = linhas.join(' &nbsp;·&nbsp; ');
  } else if (valeType === '13º Salário' && extraData) {
    pagamentoReferencia = `${extraData.parcelaDecimo ? extraData.parcelaDecimo + ' do ' : ''}13º Salário`;
    if (extraData.anoBase) extraDetails = `Ano de Referência: <strong>${extraData.anoBase}</strong>`;
  }

  // Linhas do bloco de pagamento
  const paymentRows = [];
  if (isDinheiro) {
    paymentRows.push(['Forma', 'Dinheiro']);
    if (paymentDate) paymentRows.push(['Data', paymentDate]);
  } else {
    if (pixKey) paymentRows.push(['Chave PIX', pixKey]);
    if (agenciaConta) paymentRows.push(['Ag/Conta', agenciaConta]);
    if (bankName) paymentRows.push(['Banco', bankName]);
    if (paymentDate) paymentRows.push(['Data', `${paymentDate}${paymentTime ? ' às ' + paymentTime : ''}`]);
    if (transactionId) paymentRows.push(['ID Transação', `<span class="mono-small">${transactionId}</span>`]);
  }

  const paymentRowsHTML = paymentRows.map(([k, v]) =>
    `<dt>${k}</dt><dd>${v}</dd>`
  ).join('');

  const beneficRows = [
    ['Nome', employeeName || '—'],
  ];
  if (employeeCpf) beneficRows.push(['CPF', employeeCpf]);
  if (cargo) beneficRows.push(['Cargo', cargo]);
  if (setor) beneficRows.push(['Setor', setor]);
  const beneficRowsHTML = beneficRows.map(([k, v]) =>
    `<dt>${k}</dt><dd>${v}</dd>`
  ).join('');

  const renderVia = (viaLabel) => `
    <div class="block">
      <div class="header">
        <div class="header-left">
          <img src="${LOGO_DATA_URL}" alt="Gosto Paraense" class="logo" />
          <div>
            <div class="company-name">${companyName || 'EMPRESA'}</div>
            ${companyCnpj ? `<div class="company-meta">CNPJ ${companyCnpj}</div>` : ''}
            ${companyAddress ? `<div class="company-meta">${companyAddress}</div>` : ''}
          </div>
        </div>
        <div class="header-right">
          <div class="doc-kicker">Recibo de Pagamento</div>
          <div class="doc-number">Nº ${receiptNumber}</div>
          <div class="doc-via">${viaLabel}</div>
        </div>
      </div>
      <div class="rule"></div>
      <div class="rule-accent"></div>

      <div class="amount-row">
        <div>
          <div class="kicker">Valor recebido</div>
          <div class="amount-value">${amount}</div>
          <div class="amount-extenso">(${amountExtenso})</div>
        </div>
        <div class="date-block">
          <div class="kicker">Data</div>
          <div class="date-value">${paymentDate || '—'}</div>
          <div class="date-meta">${isDinheiro ? 'Pagamento em dinheiro' : 'Pagamento via PIX'}</div>
        </div>
      </div>

      <p class="body">
        Recebi(mos) da empresa <strong>${companyName || 'EMPRESA'}</strong>${companyCnpj ? `, inscrita no CNPJ sob o nº <strong>${companyCnpj}</strong>` : ''},
        a importância acima discriminada, referente ao pagamento de <strong>${pagamentoReferencia}</strong>,
        ${isDinheiro ? 'realizado em dinheiro.' : 'realizado via PIX conforme dados abaixo.'}
      </p>

      ${extraDetails ? `<div class="extra-details">${extraDetails}</div>` : ''}

      <div class="detail-grid">
        <div class="detail-col">
          <div class="group-label">Beneficiário</div>
          <dl>${beneficRowsHTML}</dl>
        </div>
        <div class="detail-col">
          <div class="group-label">${isDinheiro ? 'Pagamento' : 'Transação PIX'}</div>
          <dl>${paymentRowsHTML}</dl>
        </div>
      </div>

      <div class="sigs">
        <div class="sig-col">
          <div class="sig-line"></div>
          <div class="sig-name">${employeeName}</div>
          <div class="sig-role">${cargo || 'Funcionário(a)'}${setor ? ' — ' + setor : ''}</div>
        </div>
        <div class="sig-col">
          <div class="sig-line"></div>
          <div class="sig-name">${companyName || 'EMPRESA'}</div>
          <div class="sig-role">Responsável pela empresa</div>
        </div>
      </div>

      <div class="footer-line">Emitido em ${today}</div>
    </div>
  `;

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Recibo Nº ${receiptNumber}</title>
  <style>
    @page { size: A4; margin: 10mm 14mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Helvetica', 'Arial', sans-serif;
      font-size: 9.5pt;
      line-height: 1.5;
      color: #1a1612;
      background: #fbfaf7;
    }

    .block {
      width: 100%;
      padding: 2mm 0;
      page-break-inside: avoid;
      display: flex;
      flex-direction: column;
    }

    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      gap: 8mm;
    }
    .header-left {
      display: flex;
      gap: 4mm;
      align-items: flex-start;
    }
    .logo {
      width: 18mm;
      height: 18mm;
      object-fit: contain;
      flex-shrink: 0;
      border-radius: 50%;
    }
    .company-name {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 13pt;
      font-weight: 600;
      letter-spacing: -0.3px;
      color: #1a1612;
      line-height: 1.15;
      margin-bottom: 2px;
    }
    .company-meta {
      font-size: 7.5pt;
      color: #5a524a;
      line-height: 1.45;
    }
    .header-right {
      text-align: right;
      flex-shrink: 0;
    }
    .doc-kicker {
      font-size: 6.5pt;
      font-weight: 700;
      letter-spacing: 1.4px;
      text-transform: uppercase;
      color: #8a8078;
    }
    .doc-number {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 14pt;
      font-weight: 500;
      color: #1a1612;
      line-height: 1;
      margin-top: 2px;
      font-variant-numeric: tabular-nums;
    }
    .doc-via {
      font-size: 7.5pt;
      color: #5a524a;
      margin-top: 2px;
      font-style: italic;
    }

    .rule {
      height: 0.5px;
      background: #1a1612;
      margin-top: 4mm;
    }
    .rule-accent {
      height: 1.5px;
      background: #b01e26;
      width: 16mm;
      margin-top: -0.5px;
    }

    .amount-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      gap: 12mm;
      margin-top: 6mm;
      padding-bottom: 5mm;
      border-bottom: 0.5px solid #efeae0;
    }
    .kicker {
      font-size: 6.5pt;
      font-weight: 700;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      color: #8a8078;
      margin-bottom: 2mm;
    }
    .amount-value {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 26pt;
      font-weight: 500;
      color: #1a1612;
      line-height: 1;
      letter-spacing: -0.8px;
      font-variant-numeric: tabular-nums;
    }
    .amount-extenso {
      font-size: 8pt;
      font-style: italic;
      color: #5a524a;
      margin-top: 2mm;
    }
    .date-block { text-align: right; }
    .date-value {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 14pt;
      font-weight: 500;
      color: #1a1612;
      font-variant-numeric: tabular-nums;
      line-height: 1;
    }
    .date-meta { font-size: 7.5pt; color: #5a524a; margin-top: 1mm; }

    .body {
      margin-top: 5mm;
      font-size: 9pt;
      line-height: 1.65;
      color: #3a342d;
      text-align: justify;
    }

    .extra-details {
      margin-top: 3mm;
      padding: 2mm 3mm;
      background: #f5f2ec;
      border-left: 2px solid #b01e26;
      font-size: 8.5pt;
      color: #3a342d;
    }

    .detail-grid {
      display: grid;
      grid-template-columns: 1fr 1fr;
      gap: 10mm;
      margin-top: 5mm;
      padding-top: 5mm;
      border-top: 0.5px solid #efeae0;
    }
    .group-label {
      font-size: 6.5pt;
      font-weight: 700;
      letter-spacing: 1.4px;
      text-transform: uppercase;
      color: #8a8078;
      margin-bottom: 2.5mm;
    }
    dl {
      display: grid;
      grid-template-columns: auto 1fr;
      column-gap: 4mm;
      row-gap: 1.2mm;
    }
    dt {
      font-size: 7.5pt;
      color: #8a8078;
      font-weight: 400;
    }
    dd {
      font-size: 9pt;
      color: #1a1612;
      font-weight: 500;
    }
    .mono-small {
      font-family: 'Courier New', monospace;
      font-size: 7.5pt;
      word-break: break-all;
    }

    .sigs {
      margin-top: 10mm;
      padding-top: 2mm;
      display: flex;
      gap: 12mm;
    }
    .sig-col { flex: 1; text-align: center; }
    .sig-line {
      border-top: 0.5px solid #1a1612;
      margin-top: 8mm;
      margin-bottom: 1.5mm;
    }
    .sig-name { font-size: 9pt; font-weight: 700; color: #1a1612; }
    .sig-role { font-size: 7.5pt; color: #5a524a; margin-top: 1px; }

    .footer-line {
      font-size: 7.5pt;
      color: #8a8078;
      text-align: right;
      margin-top: 3mm;
      font-style: italic;
    }

    .divider {
      border: none;
      border-top: 1px dashed #b8b0a4;
      margin: 2mm 0;
    }
    .divider-label {
      text-align: center;
      font-size: 6.5pt;
      letter-spacing: 1.5px;
      text-transform: uppercase;
      color: #8a8078;
      font-weight: 500;
      margin: 1mm 0 2mm;
    }
  </style>
</head>
<body>
  ${renderVia('1ª via — Colaborador')}

  <hr class="divider" />
  <div class="divider-label">recortar · 2ª via empresa</div>

  ${renderVia('2ª via — Empresa')}
</body>
</html>`;
}

module.exports = { buildReceiptHTML };
