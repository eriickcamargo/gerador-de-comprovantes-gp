const db = require('./db');

function generateReceiptNumber() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const prefix = `${year}${month}`;

  const last = db.get(
    `SELECT receipt_number FROM receipts WHERE receipt_number LIKE ? ORDER BY id DESC LIMIT 1`,
    [`${prefix}-%`]
  );

  let seq = 1;
  if (last) {
    const parts = last.receipt_number.split('-');
    seq = parseInt(parts[1], 10) + 1;
  }

  return `${prefix}-${String(seq).padStart(3, '0')}`;
}

function saveReceipt(data) {
  const receiptNumber = generateReceiptNumber();

  let extraDataStr = null;
  if (data.extraData && Object.keys(data.extraData).length > 0) {
    extraDataStr = JSON.stringify(data.extraData);
  }

  db.run(`
    INSERT INTO receipts (
      receipt_number, employee_name, cargo, setor, amount, vale_type,
      payment_date, payment_time, pix_key, agencia_conta, transaction_id,
      bank_name, company_name, company_cnpj, pdf_path, telegram_user_id, payment_method, extra_data, status
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'active')
  `, [
    receiptNumber,
    data.employee_name,
    data.cargo || null,
    data.setor || null,
    data.amount,
    data.vale_type,
    data.payment_date,
    data.payment_time || null,
    data.pix_key || null,
    data.agencia_conta || null,
    data.transaction_id || null,
    data.bank_name || null,
    data.company_name,
    data.company_cnpj || null,
    data.pdf_path || null,
    data.telegram_user_id || null,
    data.payment_method || 'pix',
    extraDataStr
  ]);

  const row = db.get('SELECT * FROM receipts WHERE receipt_number = ?', [receiptNumber]);
  if (row && row.extra_data) {
    try { row.extra_data_parsed = JSON.parse(row.extra_data); } catch (e) {}
  }
  return row;
}

function getReceiptByNumber(receiptNumber) {
  return db.get('SELECT * FROM receipts WHERE receipt_number = ?', [receiptNumber]) || null;
}

function listReceipts(limit = 10) {
  return db.all(`SELECT * FROM receipts ORDER BY id DESC LIMIT ?`, [limit]);
}

function searchReceiptsByEmployee(name) {
  return db.all(
    `SELECT * FROM receipts WHERE LOWER(employee_name) LIKE LOWER(?) ORDER BY id DESC LIMIT 20`,
    [`%${name}%`]
  );
}

/**
 * Retorna todos os recibos de um funcionário em um determinado mês/ano.
 * @param {string} employeeName - Nome exato do funcionário
 * @param {string} month - Mês com zero à esquerda (ex: "04")
 * @param {string} year - Ano com 4 dígitos (ex: "2026")
 */
function getReceiptsByEmployeeAndPeriod(employeeName, month, year) {
  // payment_date é armazenado como "DD/MM/AAAA"; substr(payment_date, 4, 7) extrai "MM/AAAA"
  // Fallback para created_at quando payment_date é nulo
  const period = `${month}/${year}`;
  const createdPrefix = `${year}-${month}`;
  return db.all(
    `SELECT * FROM receipts
     WHERE LOWER(employee_name) = LOWER(?)
       AND (
         substr(payment_date, 4, 7) = ?
         OR (payment_date IS NULL AND substr(created_at, 1, 7) = ?)
       )
     ORDER BY id ASC`,
    [employeeName, period, createdPrefix]
  );
}

function getSumByEmployeeAndPeriod(employeeName, month, year) {
  const receipts = getReceiptsByEmployeeAndPeriod(employeeName, month, year);
  return receipts
    .filter(r => r.status !== 'cancelled')
    .reduce((sum, r) => {
      const val = parseFloat(
        String(r.amount || '0').replace('R$', '').replace(/\./g, '').replace(',', '.').trim()
      ) || 0;
      return sum + val;
    }, 0);
}

function cancelReceiptByNumber(receiptNumber) {
  db.run(`UPDATE receipts SET status = 'cancelled' WHERE receipt_number = ?`, [receiptNumber]);
  return getReceiptByNumber(receiptNumber);
}

function updateReceipt(receiptNumber, updateData) {
  const allowed = [
    'employee_name', 'cargo', 'setor', 'amount', 'vale_type',
    'payment_date', 'payment_time', 'pix_key', 'agencia_conta',
    'transaction_id', 'bank_name', 'extra_data',
  ];
  const fields = Object.keys(updateData).filter(k => allowed.includes(k));
  if (fields.length === 0) return getReceiptByNumber(receiptNumber);
  const sets = fields.map(f => `${f} = ?`).join(', ');
  const values = [...fields.map(f => updateData[f]), receiptNumber];
  db.run(`UPDATE receipts SET ${sets} WHERE receipt_number = ?`, values);
  return getReceiptByNumber(receiptNumber);
}

module.exports = {
  generateReceiptNumber,
  saveReceipt,
  getReceiptByNumber,
  listReceipts,
  searchReceiptsByEmployee,
  getReceiptsByEmployeeAndPeriod,
  getSumByEmployeeAndPeriod,
  cancelReceiptByNumber,
  updateReceipt,
};
