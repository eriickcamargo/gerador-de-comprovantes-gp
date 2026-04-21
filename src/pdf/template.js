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
  } = data;

  const amountExtenso = valorPorExtenso(amount || '');
  const today = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  const pixInfo = [];
  if (pixKey) pixInfo.push(`<tr><td class="label">Chave PIX:</td><td>${pixKey}</td></tr>`);
  if (agenciaConta) pixInfo.push(`<tr><td class="label">Agência / Conta:</td><td>${agenciaConta}</td></tr>`);
  if (bankName) pixInfo.push(`<tr><td class="label">Banco:</td><td>${bankName}</td></tr>`);
  if (paymentDate) pixInfo.push(`<tr><td class="label">Data do PIX:</td><td>${paymentDate}${paymentTime ? ' às ' + paymentTime : ''}</td></tr>`);
  if (transactionId) pixInfo.push(`<tr><td class="label">ID da Transação:</td><td style="word-break:break-all;font-size:9pt;">${transactionId}</td></tr>`);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Recibo Nº ${receiptNumber}</title>
  <style>
    @page {
      size: A4;
      margin: 15mm 18mm;
    }
    * {
      margin: 0;
      padding: 0;
      box-sizing: border-box;
    }
    body {
      font-family: 'Arial', sans-serif;
      font-size: 11pt;
      color: #1a1a1a;
      background: white;
    }

    /* ─── RECIBO (ocupa metade da folha A4) ─── */
    .receipt-block {
      width: 100%;
      padding: 10mm 0;
      page-break-inside: avoid;
    }

    /* Linha pontilhada entre as 2 vias */
    .divider {
      border: none;
      border-top: 2px dashed #555;
      margin: 4mm 0;
    }
    .divider-label {
      text-align: center;
      font-size: 8pt;
      color: #555;
      margin: 2mm 0;
    }

    /* Cabeçalho */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      margin-bottom: 6mm;
      padding-bottom: 4mm;
      border-bottom: 2px solid #1a1a1a;
    }
    .company-info h1 {
      font-size: 14pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }
    .company-info p {
      font-size: 9pt;
      color: #555;
      margin-top: 2px;
    }
    .receipt-meta {
      text-align: right;
    }
    .receipt-meta .receipt-title {
      font-size: 13pt;
      font-weight: 700;
      text-transform: uppercase;
      color: #1a1a1a;
    }
    .receipt-meta .receipt-number {
      font-size: 10pt;
      color: #444;
      margin-top: 3px;
    }

    /* Corpo do recibo */
    .body-text {
      line-height: 1.8;
      margin: 5mm 0;
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
      padding: 3mm 5mm;
      margin: 4mm 0;
      font-size: 9.5pt;
    }
    .pix-box h3 {
      font-size: 9pt;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #00b386;
      margin-bottom: 3px;
    }
    .pix-box table {
      width: 100%;
      border-collapse: collapse;
    }
    .pix-box td {
      padding: 1.5px 4px;
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
      margin-top: 10mm;
      gap: 15mm;
    }
    .sig-block {
      flex: 1;
      text-align: center;
    }
    .sig-line {
      border-top: 1px solid #1a1a1a;
      padding-top: 3px;
      margin-top: 14mm;
      font-size: 9pt;
    }
    .sig-block .sig-name {
      font-weight: 700;
      font-size: 9.5pt;
    }
    .sig-block .sig-role {
      font-size: 8.5pt;
      color: #555;
    }

    .date-line {
      text-align: right;
      font-size: 9pt;
      color: #555;
      margin-top: 3mm;
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
      <strong> ${valeType}</strong> do(a) funcionário(a)
      <strong>${employeeName}</strong>,
      ${cargo ? `cargo <strong>${cargo}</strong>,` : ''}
      ${setor ? `setor <strong>${setor}</strong>,` : ''}
      realizado via PIX conforme comprovante abaixo.
    </p>

    ${pixInfo.length > 0 ? `
    <div class="pix-box">
      <h3>✓ Pagamento via PIX</h3>
      <table>${pixInfo.join('')}</table>
    </div>` : ''}

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
      <strong> ${valeType}</strong> do(a) funcionário(a)
      <strong>${employeeName}</strong>,
      ${cargo ? `cargo <strong>${cargo}</strong>,` : ''}
      ${setor ? `setor <strong>${setor}</strong>,` : ''}
      realizado via PIX conforme comprovante abaixo.
    </p>

    ${pixInfo.length > 0 ? `
    <div class="pix-box">
      <h3>✓ Pagamento via PIX</h3>
      <table>${pixInfo.join('')}</table>
    </div>` : ''}

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
