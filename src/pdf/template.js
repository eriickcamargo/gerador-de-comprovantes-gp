/**
 * Converte valor numérico para extenso em português brasileiro
 * Ex: 1250.00 -> "um mil duzentos e cinquenta reais"
 */
function valorPorExtenso(valorStr) {
  // Remove R$, pontos de milhar e troca vírgula por ponto
  const cleaned = valorStr
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

  const parteCentavos = unidades[centavos] || `${Math.floor(centavos / 10)} e ${unidades[centavos % 10]}`;
  const moedaCentavos = centavos === 1 ? 'centavo' : 'centavos';

  if (inteiros === 0) {
    return `${parteCentavos} ${moedaCentavos}`;
  }

  return `${parteInteira} ${moedaInteira} e ${parteCentavos} ${moedaCentavos}`;
}

/**
 * Gera o HTML completo do recibo
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
    transactionId,
    bankName,
    paymentMethod, // 'pix' | 'dinheiro'
    extraData,
  } = data;

  const isDinheiro = paymentMethod === 'dinheiro';

  const amountExtenso = valorPorExtenso(amount || '');
  const today = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const pixInfo = [];
  if (!isDinheiro) {
    if (pixKey) pixInfo.push(`<tr><td class="label">Chave PIX:</td><td>${pixKey}</td></tr>`);
    if (agenciaConta) pixInfo.push(`<tr><td class="label">Agência / Conta:</td><td>${agenciaConta}</td></tr>`);
    if (bankName) pixInfo.push(`<tr><td class="label">Banco:</td><td>${bankName}</td></tr>`);
    if (paymentDate) pixInfo.push(`<tr><td class="label">Data do PIX:</td><td>${paymentDate}${paymentTime ? ' às ' + paymentTime : ''}</td></tr>`);
    if (transactionId) pixInfo.push(`<tr><td class="label">ID da Transação:</td><td style="word-break:break-all;font-size:9pt;">${transactionId}</td></tr>`);
  }

  // Bloco de pagamento em dinheiro
  const dinheiroBlock = isDinheiro ? `
    <div class="pix-box" style="border-left-color:#e6a817;">
      <h3 style="color:#c47e00;">💵 Pagamento em Dinheiro</h3>
      <table>
        ${paymentDate ? `<tr><td class="label">Data do pagamento:</td><td>${paymentDate}</td></tr>` : ''}
      </table>
    </div>` : '';

  let pagamentoReferencia = `<strong> ${valeType}</strong>`;
  let extraInfoBlock = '';

  if (valeType === 'Férias' && extraData) {
    extraInfoBlock = `
    <div class="pix-box" style="border-left-color:#3498db;">
      <h3 style="color:#2980b9;">🏖️ Detalhes das Férias</h3>
      <table>
        ${extraData.periodoAquisitivo ? `<tr><td class="label">Período Aquisitivo:</td><td>${extraData.periodoAquisitivo}</td></tr>` : ''}
        ${extraData.periodoGozo ? `<tr><td class="label">Período de Gozo:</td><td>${extraData.periodoGozo}</td></tr>` : ''}
      </table>
    </div>`;
    pagamentoReferencia = `<strong> Férias (com 1/3 Constitucional)</strong>`;
  } else if (valeType === '13º Salário' && extraData) {
    extraInfoBlock = `
    <div class="pix-box" style="border-left-color:#e74c3c;">
      <h3 style="color:#c0392b;">🎁 Detalhes do 13º Salário</h3>
      <table>
        ${extraData.anoBase ? `<tr><td class="label">Ano de Referência:</td><td>${extraData.anoBase}</td></tr>` : ''}
      </table>
    </div>`;
    pagamentoReferencia = `<strong> ${extraData.parcelaDecimo ? extraData.parcelaDecimo + ' do ' : ''}13º Salário</strong>`;
  }

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Recibo Nº ${receiptNumber}</title>
  <style>
    @page {
      size: A4;
      margin: 10mm 15mm;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Arial', sans-serif;
      font-size: 10pt;
      color: #1a1a1a;
      background: white;
    }

    /* ─── RECIBO (ocupa metade da folha A4) ─── */
    .receipt-block {
      width: 100%;
      padding: 4mm 0;
      page-break-inside: avoid;
    }

    /* Linha pontilhada entre as 2 vias */
    .divider {
      border: none;
      border-top: 2px dashed #555;
      margin: 2mm 0;
    }
    .divider-label {
      text-align: center;
      font-size: 7.5pt;
      color: #555;
      margin: 1mm 0;
    }

    /* Cabeçalho */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 3mm;
      padding-bottom: 2mm;
      border-bottom: 2px solid #1a1a1a;
    }
    .company-info h1 {
      font-size: 12pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .company-info p {
      font-size: 8pt;
      color: #555;
      margin-top: 1px;
    }
    .receipt-meta {
      text-align: right;
    }
    .receipt-meta .receipt-title {
      font-size: 11pt;
      font-weight: 700;
      text-transform: uppercase;
      color: #1a1a1a;
    }
    .receipt-meta .receipt-number {
      font-size: 9pt;
      color: #444;
      margin-top: 2px;
    }

    /* Corpo do recibo */
    .body-text {
      line-height: 1.6;
      margin: 3mm 0;
      text-align: justify;
    }
    .body-text strong {
      text-decoration: underline;
    }

    /* Bloco PIX */
    .pix-box {
      background: #f5f5f5;
      border: 1px solid #ccc;
      border-left: 4px solid #00b386;
      border-radius: 4px;
      padding: 2mm 4mm;
      margin: 2mm 0;
      font-size: 9pt;
    }
    .pix-box h3 {
      font-size: 8.5pt;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #00b386;
      margin-bottom: 2px;
    }
    .pix-box table {
      width: 100%;
      border-collapse: collapse;
    }
    .pix-box td {
      padding: 1px 4px;
      vertical-align: top;
    }
    .pix-box td.label {
      font-weight: 700;
      white-space: nowrap;
      width: 130px;
    }

    /* Assinaturas */
    .signatures {
      display: flex;
      justify-content: space-between;
      margin-top: 5mm;
      gap: 10mm;
    }
    .sig-block {
      flex: 1;
      text-align: center;
    }
    .sig-line {
      border-top: 1px solid #1a1a1a;
      padding-top: 2px;
      margin-top: 8mm;
      font-size: 8.5pt;
    }
    .sig-block .sig-name {
      font-weight: 700;
      font-size: 9pt;
    }
    .sig-block .sig-role {
      font-size: 8pt;
      color: #555;
    }

    .date-line {
      text-align: right;
      font-size: 8.5pt;
      color: #555;
      margin-top: 2mm;
    }
  </style>
</head>
<body>

  <!-- 1ª VIA -->
  <div class="receipt-block">
    <div class="header">
      <div class="company-info">
        <h1>${companyName || 'EMPRESA'}</h1>
        ${companyCnpj ? `<p>CNPJ: ${companyCnpj}</p>` : ''}
        ${companyAddress ? `<p>${companyAddress}</p>` : ''}
      </div>
      <div class="receipt-meta">
        <div class="receipt-title">Recibo de Pagamento</div>
        <div class="receipt-number">Nº ${receiptNumber} &nbsp;|&nbsp; 1ª via</div>
      </div>
    </div>

    <p class="body-text">
      Recebi(mos) da empresa <strong>${companyName || 'EMPRESA'}</strong>
      ${companyCnpj ? `, inscrita no CNPJ sob o nº <strong>${companyCnpj}</strong>,` : ','}
      a importância de <strong>${amount}</strong>
      (<em>${amountExtenso}</em>), referente ao pagamento de
      ${pagamentoReferencia} do(a) funcionário(a)
      <strong>${employeeName}</strong>,
      ${cargo ? `cargo <strong>${cargo}</strong>,` : ''}
      ${setor ? `setor <strong>${setor}</strong>,` : ''}
      ${isDinheiro ? 'realizado em dinheiro.' : 'realizado via PIX conforme comprovante abaixo.'}
    </p>

    ${extraInfoBlock}

    ${isDinheiro ? dinheiroBlock : (pixInfo.length > 0 ? `
    <div class="pix-box">
      <h3>✓ Pagamento via PIX</h3>
      <table>${pixInfo.join('')}</table>
    </div>` : '')}

    <div class="signatures">
      <div class="sig-block">
        <div class="sig-line">
          <div class="sig-name">${employeeName}</div>
          <div class="sig-role">${cargo || 'Funcionário(a)'}${setor ? ' — ' + setor : ''}</div>
        </div>
      </div>
      <div class="sig-block">
        <div class="sig-line">
          <div class="sig-name">${companyName || 'EMPRESA'}</div>
          <div class="sig-role">Responsável pela empresa</div>
        </div>
      </div>
    </div>
    <p class="date-line">Emitido em ${today}</p>
  </div>

  <!-- Separador -->
  <hr class="divider" />
  <p class="divider-label">✂ &nbsp; Recortar aqui — 2ª via (empresa) &nbsp; ✂</p>
  <hr class="divider" />

  <!-- 2ª VIA -->
  <div class="receipt-block">
    <div class="header">
      <div class="company-info">
        <h1>${companyName || 'EMPRESA'}</h1>
        ${companyCnpj ? `<p>CNPJ: ${companyCnpj}</p>` : ''}
        ${companyAddress ? `<p>${companyAddress}</p>` : ''}
      </div>
      <div class="receipt-meta">
        <div class="receipt-title">Recibo de Pagamento</div>
        <div class="receipt-number">Nº ${receiptNumber} &nbsp;|&nbsp; 2ª via</div>
      </div>
    </div>

    <p class="body-text">
      Recebi(mos) da empresa <strong>${companyName || 'EMPRESA'}</strong>
      ${companyCnpj ? `, inscrita no CNPJ sob o nº <strong>${companyCnpj}</strong>,` : ','}
      a importância de <strong>${amount}</strong>
      (<em>${amountExtenso}</em>), referente ao pagamento de
      ${pagamentoReferencia} do(a) funcionário(a)
      <strong>${employeeName}</strong>,
      ${cargo ? `cargo <strong>${cargo}</strong>,` : ''}
      ${setor ? `setor <strong>${setor}</strong>,` : ''}
      ${isDinheiro ? 'realizado em dinheiro.' : 'realizado via PIX conforme comprovante abaixo.'}
    </p>

    ${extraInfoBlock}

    ${isDinheiro ? dinheiroBlock : (pixInfo.length > 0 ? `
    <div class="pix-box">
      <h3>✓ Pagamento via PIX</h3>
      <table>${pixInfo.join('')}</table>
    </div>` : '')}

    <div class="signatures">
      <div class="sig-block">
        <div class="sig-line">
          <div class="sig-name">${employeeName}</div>
          <div class="sig-role">${cargo || 'Funcionário(a)'}${setor ? ' — ' + setor : ''}</div>
        </div>
      </div>
      <div class="sig-block">
        <div class="sig-line">
          <div class="sig-name">${companyName || 'EMPRESA'}</div>
          <div class="sig-role">Responsável pela empresa</div>
        </div>
      </div>
    </div>
    <p class="date-line">Emitido em ${today}</p>
  </div>

</body>
</html>`;
}

module.exports = { buildReceiptHTML };
