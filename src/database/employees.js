const db = require('./db');

function findEmployee(name) {
  // Tenta match exato primeiro
  let employee = db.get(
    'SELECT * FROM employees WHERE LOWER(name) = LOWER(?)',
    [name]
  );
  // Busca parcial se não achou
  if (!employee) {
    employee = db.get(
      'SELECT * FROM employees WHERE LOWER(name) LIKE LOWER(?)',
      [`%${name}%`]
    );
  }
  return employee || null;
}

function saveEmployee({ name, cargo, setor }) {
  const existing = db.get(
    'SELECT id FROM employees WHERE LOWER(name) = LOWER(?)',
    [name]
  );
  if (existing) {
    db.run(
      `UPDATE employees SET cargo = ?, setor = ?, updated_at = datetime('now') WHERE LOWER(name) = LOWER(?)`,
      [cargo, setor, name]
    );
  } else {
    db.run(
      'INSERT INTO employees (name, cargo, setor) VALUES (?, ?, ?)',
      [name, cargo, setor]
    );
  }
}

function listEmployees() {
  return db.all('SELECT * FROM employees ORDER BY name');
}

module.exports = { findEmployee, saveEmployee, listEmployees };
