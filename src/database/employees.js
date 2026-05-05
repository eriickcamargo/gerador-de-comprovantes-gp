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

function saveEmployee({ id, name, cpf, cargo, setor, salary }) {
  const salaryVal = salary != null ? Number(salary) || 0 : null;

  if (id) {
    const setCols = salaryVal != null
      ? `name = ?, cpf = ?, cargo = ?, setor = ?, salary = ?, updated_at = datetime('now')`
      : `name = ?, cpf = ?, cargo = ?, setor = ?, updated_at = datetime('now')`;
    const params = salaryVal != null
      ? [name, cpf, cargo, setor, salaryVal, id]
      : [name, cpf, cargo, setor, id];
    db.run(`UPDATE employees SET ${setCols} WHERE id = ?`, params);
    return;
  }

  const existing = db.get(
    'SELECT id FROM employees WHERE LOWER(name) = LOWER(?)',
    [name]
  );
  if (existing) {
    const setCols = salaryVal != null
      ? `cpf = ?, cargo = ?, setor = ?, salary = ?, updated_at = datetime('now')`
      : `cpf = ?, cargo = ?, setor = ?, updated_at = datetime('now')`;
    const params = salaryVal != null
      ? [cpf, cargo, setor, salaryVal, name]
      : [cpf, cargo, setor, name];
    db.run(`UPDATE employees SET ${setCols} WHERE LOWER(name) = LOWER(?)`, params);
  } else {
    db.run(
      'INSERT INTO employees (name, cpf, cargo, setor, salary) VALUES (?, ?, ?, ?, ?)',
      [name, cpf, cargo, setor, salaryVal || 0]
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
