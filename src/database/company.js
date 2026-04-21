const db = require('./db');

function getCompany() {
  return db.get('SELECT * FROM company WHERE id = 1') || null;
}

function saveCompany({ name, cnpj, address }) {
  const existing = getCompany();
  if (existing) {
    db.run(
      `UPDATE company SET name = ?, cnpj = ?, address = ?, updated_at = datetime('now') WHERE id = 1`,
      [name || existing.name, cnpj || existing.cnpj, address || existing.address]
    );
  } else {
    db.run(
      'INSERT INTO company (id, name, cnpj, address) VALUES (1, ?, ?, ?)',
      [name, cnpj, address]
    );
  }
}

module.exports = { getCompany, saveCompany };
