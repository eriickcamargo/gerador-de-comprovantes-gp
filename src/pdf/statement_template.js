/**
 * Converte "R$ 1.250,55" para número 1250.55
 */
function parseAmount(str) {
  if (!str) return 0;
  return parseFloat(
    str.replace('R$', '').replace(/\./g, '').replace(',', '.').trim()
  ) || 0;
}

/**
 * Formata número para "R$ 1.250,55"
 */
function formatAmount(value) {
  return 'R$ ' + value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * Converte número de mês para nome em português
 */
function monthName(monthStr) {
  const months = [
    '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  return months[parseInt(monthStr, 10)] || monthStr;
}

/**
 * Gera o HTML completo do extrato mensal de um funcionário
 * @param {Object} data - Dados do extrato
 * @param {Array}  receipts - Lista de recibos do período
 */
function buildStatementHTML(data, receipts) {
  const {
    companyName,
    companyCnpj,
    companyAddress,
    employeeName,
    cargo,
    setor,
    month,
    year,
  } = data;

  const period = `${monthName(month)}/${year}`;
  const today = new Date().toLocaleDateString('pt-BR', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
  });

  // Linhas da tabela de recibos
  const rows = receipts.map((r, i) => {
    const isCancelled = r.status === 'cancelled';
    const amountHtml = isCancelled ? `<s style="color: #999">${r.amount}</s>` : r.amount;
    const typeLabel = (r.vale_type || '—') + (isCancelled ? ' <span style="font-size: 8pt; color: #d32f2f; font-weight: bold;">(CANCELADO)</span>' : '');
    return `
    <tr class="${i % 2 === 0 ? 'even' : 'odd'}${isCancelled ? ' cancelled' : ''}">
      <td>${isCancelled ? '<s style="color: #999">' + r.receipt_number + '</s>' : r.receipt_number}</td>
      <td>${r.payment_date || '—'}</td>
      <td>${typeLabel}</td>
      <td class="amount">${amountHtml}</td>
    </tr>
  `}).join('');

  // Subtotais por tipo de vale
  const byType = {};
  receipts.forEach(r => {
    if (r.status === 'cancelled') return;
    const type = r.vale_type || 'Outros';
    byType[type] = (byType[type] || 0) + parseAmount(r.amount);
  });

  const activeReceipts = receipts.filter(r => r.status !== 'cancelled');

  const summaryRows = Object.entries(byType).map(([type, total]) => `
    <tr>
      <td>Vale ${type}</td>
      <td>${activeReceipts.filter(r => r.vale_type === type).length} recibo(s)</td>
      <td class="amount"><strong>${formatAmount(total)}</strong></td>
    </tr>
  `).join('');

  const grandTotal = activeReceipts.reduce((sum, r) => sum + parseAmount(r.amount), 0);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Extrato — ${employeeName} — ${period}</title>
  <style>
    @page { size: A4; margin: 15mm 18mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: Arial, sans-serif;
      font-size: 10.5pt;
      color: #1a1a1a;
      background: white;
    }

    /* ── Cabeçalho ── */
    .header {
      display: flex;
      justify-content: space-between;
      align-items: flex-start;
      padding-bottom: 5mm;
      border-bottom: 2.5px solid #1a1a1a;
      margin-bottom: 6mm;
    }
    .company-info h1 {
      font-size: 14pt;
      font-weight: 700;
      text-transform: uppercase;
    }
    .company-info p { font-size: 9pt; color: #555; margin-top: 2px; }
    .doc-info { text-align: right; }
    .doc-info .doc-title {
      font-size: 13pt;
      font-weight: 700;
      text-transform: uppercase;
      color: #1a1a1a;
    }
    .doc-info .doc-sub { font-size: 9pt; color: #555; margin-top: 3px; }

    /* ── Ficha do funcionário ── */
    .employee-card {
      background: #f5f5f5;
      border: 1px solid #ddd;
      border-left: 4px solid #1a73e8;
      border-radius: 4px;
      padding: 3.5mm 5mm;
      margin-bottom: 6mm;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .employee-card .name {
      font-size: 12pt;
      font-weight: 700;
    }
    .employee-card .detail { font-size: 9pt; color: #555; margin-top: 2px; }
    .employee-card .period-badge {
      background: #1a73e8;
      color: white;
      border-radius: 4px;
      padding: 4px 12px;
      font-size: 10pt;
      font-weight: 700;
      white-space: nowrap;
    }

    /* ── Tabela de recibos ── */
    .section-title {
      font-size: 9pt;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: #555;
      margin-bottom: 2mm;
      margin-top: 5mm;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-bottom: 5mm;
    }
    thead th {
      background: #1a1a1a;
      color: white;
      padding: 3.5mm 4mm;
      text-align: left;
      font-size: 9.5pt;
      font-weight: 700;
    }
    thead th.amount { text-align: right; }
    tbody td {
      padding: 3mm 4mm;
      font-size: 9.5pt;
      border-bottom: 1px solid #eee;
      vertical-align: top;
    }
    td.amount { text-align: right; }
    tr.even { background: white; }
    tr.odd  { background: #fafafa; }
    tr.cancelled td { color: #999; }

    /* ── Resumo ── */
    .summary-table thead th { background: #444; }
    .summary-table tbody td { font-size: 9.5pt; }

    /* ── Total geral ── */
    .total-box {
      background: #1a1a1a;
      color: white;
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding: 4mm 5mm;
      border-radius: 4px;
      margin: 4mm 0 8mm 0;
    }
    .total-box .label { font-size: 11pt; font-weight: 700; text-transform: uppercase; }
    .total-box .value { font-size: 14pt; font-weight: 700; }

    /* ── Assinaturas ── */
    .signatures {
      display: flex;
      justify-content: space-between;
      margin-top: 14mm;
      gap: 15mm;
    }
    .sig-block { flex: 1; text-align: center; }
    .sig-line {
      border-top: 1px solid #1a1a1a;
      padding-top: 3px;
      margin-top: 12mm;
      font-size: 9pt;
    }
    .sig-block .sig-name { font-weight: 700; font-size: 9.5pt; }
    .sig-block .sig-role { font-size: 8.5pt; color: #555; }
    .date-line { text-align: right; font-size: 8.5pt; color: #555; margin-top: 3mm; }

    /* ── Rodapé de recibos vazios ── */
    .no-receipts {
      text-align: center;
      padding: 8mm;
      color: #888;
      font-style: italic;
      border: 1px dashed #ccc;
      border-radius: 4px;
    }
  </style>
</head>
<body>

  <!-- Cabeçalho -->
  <div class="header">
    <div class="company-info">
      <h1>${companyName || 'EMPRESA'}</h1>
      ${companyCnpj ? `<p>CNPJ: ${companyCnpj}</p>` : ''}
      ${companyAddress ? `<p>${companyAddress}</p>` : ''}
    </div>
    <div class="doc-info">
      <div class="doc-title">Extrato de Recibos de Vale</div>
      <div class="doc-sub">Emitido em ${today}</div>
    </div>
  </div>

  <!-- Ficha do funcionário -->
  <div class="employee-card">
    <div>
      <div class="name">${employeeName}</div>
      <div class="detail">
        ${cargo ? `Cargo: <strong>${cargo}</strong>` : ''}
        ${cargo && setor ? ' &nbsp;|&nbsp; ' : ''}
        ${setor ? `Setor: <strong>${setor}</strong>` : ''}
      </div>
    </div>
    <div class="period-badge">📅 ${period}</div>
  </div>

  <!-- Tabela de recibos -->
  <div class="section-title">Recibos Emitidos no Período</div>

  ${receipts.length === 0
    ? `<div class="no-receipts">Nenhum recibo emitido para este funcionário em ${period}.</div>`
    : `<table>
        <thead>
          <tr>
            <th>Nº Recibo</th>
            <th>Data do PIX</th>
            <th>Tipo de Vale</th>
            <th class="amount">Valor</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`
  }

  ${receipts.length > 0 ? `
  <!-- Resumo por tipo -->
  <div class="section-title">Resumo por Tipo de Vale</div>
  <table class="summary-table">
    <thead>
      <tr>
        <th>Tipo</th>
        <th>Qtd. Recibos</th>
        <th class="amount">Subtotal</th>
      </tr>
    </thead>
    <tbody>${summaryRows}</tbody>
  </table>

  <!-- Total geral -->
  <div class="total-box">
    <span class="label">Total Geral no Período</span>
    <span class="value">${formatAmount(grandTotal)}</span>
  </div>

  <!-- Assinaturas -->
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
  <p class="date-line">Extrato gerado em ${today}</p>
  ` : ''}

</body>
</html>`;
}

module.exports = { buildStatementHTML };
