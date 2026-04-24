const LOGO_DATA_URL = require('./logo_base64');

function parseAmount(str) {
  if (!str) return 0;
  return parseFloat(
    String(str).replace('R$', '').replace(/\./g, '').replace(',', '.').trim()
  ) || 0;
}

function formatAmount(value) {
  return 'R$ ' + value.toLocaleString('pt-BR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function monthName(monthStr) {
  const months = [
    '', 'Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho',
    'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro',
  ];
  return months[parseInt(monthStr, 10)] || monthStr;
}

/**
 * Extrato mensal — layout "Corporativo Sóbrio"
 * Logo no topo, régua fina vermelha como acento, tipografia editorial.
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

  const activeReceipts = receipts.filter(r => r.status !== 'cancelled');

  // Linhas da tabela
  const rows = receipts.map((r) => {
    const cancelled = r.status === 'cancelled';
    const amountHtml = cancelled ? `<s style="color:#b8b0a4">${r.amount}</s>` : r.amount;
    const typeLabel = (r.vale_type || '—') + (cancelled
      ? ' <span class="cancel-tag">cancelado</span>'
      : '');
    return `
    <tr${cancelled ? ' class="cancelled"' : ''}>
      <td><span class="mono">${r.receipt_number || '—'}</span></td>
      <td>${r.payment_date || '—'}</td>
      <td>${typeLabel}</td>
      <td class="amount">${amountHtml}</td>
    </tr>`;
  }).join('');

  // Subtotais por tipo
  const byType = {};
  activeReceipts.forEach(r => {
    const type = r.vale_type || 'Outros';
    byType[type] = (byType[type] || 0) + parseAmount(r.amount);
  });

  const summaryRows = Object.entries(byType).map(([type, total]) => `
    <div class="summary-row">
      <span class="summary-label">${type}</span>
      <span class="summary-dots"></span>
      <span class="summary-value">${formatAmount(total)}</span>
    </div>`).join('');

  const grandTotal = activeReceipts.reduce((s, r) => s + parseAmount(r.amount), 0);

  return `<!DOCTYPE html>
<html lang="pt-BR">
<head>
  <meta charset="UTF-8" />
  <title>Extrato — ${employeeName} — ${period}</title>
  <style>
    @page { size: A4; margin: 14mm 16mm; }
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      font-family: 'Helvetica', 'Arial', sans-serif;
      font-size: 9.5pt;
      line-height: 1.5;
      color: #1a1612;
      background: #fbfaf7;
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
      width: 20mm;
      height: 20mm;
      object-fit: contain;
      flex-shrink: 0;
      border-radius: 50%;
    }
    .company-name {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 14pt;
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
    .header-right { text-align: right; flex-shrink: 0; }
    .doc-kicker {
      font-size: 6.5pt;
      font-weight: 700;
      letter-spacing: 1.4px;
      text-transform: uppercase;
      color: #8a8078;
    }
    .doc-period {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 16pt;
      font-weight: 500;
      color: #1a1612;
      line-height: 1;
      margin-top: 2px;
    }
    .doc-meta { font-size: 7.5pt; color: #5a524a; margin-top: 2px; font-style: italic; }

    .rule { height: 0.5px; background: #1a1612; margin-top: 4mm; }
    .rule-accent { height: 1.5px; background: #b01e26; width: 16mm; margin-top: -0.5px; }

    .employee-row {
      display: flex;
      justify-content: space-between;
      align-items: flex-end;
      margin-top: 7mm;
      padding-bottom: 5mm;
      border-bottom: 0.5px solid #efeae0;
      gap: 12mm;
    }
    .kicker {
      font-size: 6.5pt;
      font-weight: 700;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      color: #8a8078;
      margin-bottom: 2mm;
    }
    .employee-name {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 16pt;
      font-weight: 500;
      color: #1a1612;
      letter-spacing: -0.3px;
      line-height: 1.1;
    }
    .employee-meta { font-size: 8pt; color: #5a524a; margin-top: 1.5mm; }
    .grand-total {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 22pt;
      font-weight: 500;
      color: #1a1612;
      line-height: 1;
      letter-spacing: -0.6px;
      font-variant-numeric: tabular-nums;
    }

    .section-label {
      font-size: 6.5pt;
      font-weight: 700;
      letter-spacing: 1.4px;
      text-transform: uppercase;
      color: #8a8078;
      margin-top: 7mm;
      margin-bottom: 2.5mm;
    }

    table {
      width: 100%;
      border-collapse: collapse;
    }
    thead th {
      text-align: left;
      padding: 2.5mm 3mm;
      font-size: 7pt;
      font-weight: 700;
      letter-spacing: 1px;
      text-transform: uppercase;
      color: #8a8078;
      border-bottom: 0.5px solid #1a1612;
    }
    thead th.amount { text-align: right; }
    tbody td {
      padding: 2.8mm 3mm;
      font-size: 9pt;
      color: #1a1612;
      border-bottom: 0.5px solid #efeae0;
      vertical-align: middle;
    }
    tbody td.amount { text-align: right; font-variant-numeric: tabular-nums; font-weight: 500; }
    tr.cancelled td { color: #b8b0a4; }
    .mono {
      font-family: 'Courier New', monospace;
      font-size: 8pt;
      color: #5a524a;
    }
    .cancel-tag {
      display: inline-block;
      margin-left: 2mm;
      font-size: 6.5pt;
      letter-spacing: 1.2px;
      text-transform: uppercase;
      color: #b01e26;
      font-weight: 700;
      padding: 0.5mm 1.5mm;
      border: 0.5px solid #b01e26;
      border-radius: 1mm;
    }

    .summary-grid {
      display: grid;
      grid-template-columns: 1.3fr 1fr;
      gap: 10mm;
      margin-top: 4mm;
    }
    .summary-row {
      display: flex;
      align-items: baseline;
      gap: 2mm;
      padding: 1.5mm 0;
      font-size: 9pt;
    }
    .summary-label { color: #3a342d; }
    .summary-dots {
      flex: 1;
      border-bottom: 0.5px dotted #c8c0b2;
      transform: translateY(-1mm);
    }
    .summary-value {
      font-weight: 500;
      font-variant-numeric: tabular-nums;
      color: #1a1612;
    }
    .total-box {
      background: #1a1612;
      color: #fff;
      padding: 5mm 6mm;
      display: flex;
      flex-direction: column;
      justify-content: center;
    }
    .total-box .label {
      font-size: 6.5pt;
      font-weight: 700;
      letter-spacing: 1.4px;
      text-transform: uppercase;
      color: rgba(255,255,255,0.6);
    }
    .total-box .value {
      font-family: Georgia, 'Times New Roman', serif;
      font-size: 20pt;
      font-weight: 500;
      color: #fff;
      line-height: 1;
      margin-top: 2mm;
      letter-spacing: -0.6px;
      font-variant-numeric: tabular-nums;
    }
    .total-box .meta { font-size: 7.5pt; color: rgba(255,255,255,0.7); margin-top: 2mm; }

    .sigs {
      margin-top: 16mm;
      padding-top: 2mm;
      display: flex;
      gap: 12mm;
    }
    .sig-col { flex: 1; text-align: center; }
    .sig-line {
      border-top: 0.5px solid #1a1612;
      margin-top: 10mm;
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

    .no-receipts {
      text-align: center;
      padding: 10mm;
      color: #8a8078;
      font-style: italic;
      border: 0.5px dashed #c8c0b2;
      border-radius: 1mm;
      margin-top: 3mm;
    }
  </style>
</head>
<body>

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
      <div class="doc-kicker">Extrato de Recibos</div>
      <div class="doc-period">${period}</div>
      <div class="doc-meta">Emitido em ${today}</div>
    </div>
  </div>
  <div class="rule"></div>
  <div class="rule-accent"></div>

  <div class="employee-row">
    <div>
      <div class="kicker">Colaborador(a)</div>
      <div class="employee-name">${employeeName || '—'}</div>
      <div class="employee-meta">
        ${cargo || ''}${cargo && setor ? ' · ' : ''}${setor || ''}
      </div>
    </div>
    <div style="text-align:right">
      <div class="kicker">Total no Período</div>
      <div class="grand-total">${formatAmount(grandTotal)}</div>
      <div class="employee-meta">${activeReceipts.length} recibo(s) ativo(s)</div>
    </div>
  </div>

  <div class="section-label">Recibos emitidos no período</div>

  ${receipts.length === 0
    ? `<div class="no-receipts">Nenhum recibo emitido para este funcionário em ${period}.</div>`
    : `<table>
        <thead>
          <tr>
            <th style="width:22mm">Nº</th>
            <th style="width:22mm">Data</th>
            <th>Tipo de Vale</th>
            <th class="amount">Valor</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>`}

  ${activeReceipts.length > 0 ? `
    <div class="summary-grid">
      <div>
        <div class="section-label" style="margin-top:0">Resumo por Categoria</div>
        ${summaryRows}
      </div>
      <div>
        <div class="section-label" style="margin-top:0">&nbsp;</div>
        <div class="total-box">
          <span class="label">Total geral no período</span>
          <span class="value">${formatAmount(grandTotal)}</span>
          <span class="meta">${period}</span>
        </div>
      </div>
    </div>

    <div class="sigs">
      <div class="sig-col">
        <div class="sig-line"></div>
        <div class="sig-name">${employeeName}</div>
        <div class="sig-role">${cargo || 'Colaborador(a)'}${setor ? ' — ' + setor : ''}</div>
      </div>
      <div class="sig-col">
        <div class="sig-line"></div>
        <div class="sig-name">${companyName || 'EMPRESA'}</div>
        <div class="sig-role">Responsável pela empresa</div>
      </div>
    </div>
    <div class="footer-line">Extrato gerado em ${today}</div>
  ` : ''}

</body>
</html>`;
}

module.exports = { buildStatementHTML };
