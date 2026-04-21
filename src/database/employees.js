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

function getEmployeeById(id) {
  return db.get('SELECT * FROM employees WHERE id = ?', [id]) || null;
}

function saveEmployee({ id, name, cpf, cargo, setor }) {
  if (id) {
    db.run(
      `UPDATE employees SET name = ?, cpf = ?, cargo = ?, setor = ?, updated_at = datetime('now') WHERE id = ?`,
      [name, cpf, cargo, setor, id]
    );
    return;
  }

  const existing = db.get(
    'SELECT id FROM employees WHERE LOWER(name) = LOWER(?)',
    [name]
  );
  if (existing) {
    db.run(
      `UPDATE employees SET cpf = ?, cargo = ?, setor = ?, updated_at = datetime('now') WHERE LOWER(name) = LOWER(?)`,
      [cpf, cargo, setor, name]
    );
  } else {
    db.run(
      'INSERT INTO employees (name, cpf, cargo, setor) VALUES (?, ?, ?, ?)',
      [name, cpf, cargo, setor]
    );
  }
}

function listEmployees() {
  return db.all('SELECT * FROM employees ORDER BY name');
}

function deleteEmployee(id) {
  db.run('DELETE FROM employees WHERE id = ?', [id]);
}

module.exports = { findEmployee, saveEmployee, listEmployees, getEmployeeById, deleteEmployee };
