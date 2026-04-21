const initSqlJs = require('sql.js');
const path = require('path');
const fs = require('fs');

const DB_DIR = path.join(__dirname, '../../db');
const DB_PATH = path.join(DB_DIR, 'data.sqlite');

let db;

/**
 * Persiste o banco em disco (chame após escritas)
 */
function persist() {
  const data = db.export();
  fs.writeFileSync(DB_PATH, Buffer.from(data));
}

/**
 * Inicializa o banco de dados sql.js com persistência em arquivo
 */
async function initDB() {
  // Garante que a pasta db/ existe
  if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
  }

  const SQL = await initSqlJs();

  // Carrega banco existente ou cria novo
  if (fs.existsSync(DB_PATH)) {
    const fileBuffer = fs.readFileSync(DB_PATH);
    db = new SQL.Database(fileBuffer);
  } else {
    db = new SQL.Database();
  }

  // Cria tabelas se não existirem
  db.run(`
    CREATE TABLE IF NOT EXISTS employees (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      name       TEXT NOT NULL UNIQUE,
      cargo      TEXT,
      setor      TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS company (
      id         INTEGER PRIMARY KEY DEFAULT 1,
      name       TEXT,
      cnpj       TEXT,
      address    TEXT,
      updated_at TEXT DEFAULT (datetime('now'))
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS receipts (
      id               INTEGER PRIMARY KEY AUTOINCREMENT,
      receipt_number   TEXT NOT NULL,
      employee_name    TEXT,
      cargo            TEXT,
      setor            TEXT,
      amount           TEXT,
      vale_type        TEXT,
      payment_date     TEXT,
      payment_time     TEXT,
      pix_key          TEXT,
      agencia_conta    TEXT,
      transaction_id   TEXT,
      bank_name        TEXT,
      company_name     TEXT,
      company_cnpj     TEXT,
      pdf_path         TEXT,
      telegram_user_id TEXT,
      payment_method   TEXT DEFAULT 'pix',
      created_at       TEXT DEFAULT (datetime('now'))
    )
  `);

  // Migração segura: adiciona coluna payment_method em bancos já existentes
  try {
    db.run(`ALTER TABLE receipts ADD COLUMN payment_method TEXT DEFAULT 'pix'`);
  } catch (_) {
    // Coluna já existe — ignora o erro
  }

  persist();
  console.log('✅ Banco de dados inicializado em:', DB_PATH);
}

function getDB() {
  if (!db) throw new Error('Banco de dados não inicializado. Chame await initDB() primeiro.');
  return db;
}

/**
 * Executa uma query de escrita (INSERT/UPDATE/DELETE) e persiste no disco
 */
function run(sql, params = []) {
  getDB().run(sql, params);
  persist();
}

/**
 * Retorna todos os resultados de uma query SELECT
 */
function all(sql, params = []) {
  const stmt = getDB().prepare(sql);
  stmt.bind(params);
  const rows = [];
  while (stmt.step()) {
    rows.push(stmt.getAsObject());
  }
  stmt.free();
  return rows;
}

/**
 * Retorna o primeiro resultado de uma query SELECT
 */
function get(sql, params = []) {
  const results = all(sql, params);
  return results.length > 0 ? results[0] : null;
}

/**
 * Retorna o rowid da última linha inserida
 */
function lastInsertRowId() {
  const result = get('SELECT last_insert_rowid() as id');
  return result ? result.id : null;
}

module.exports = { initDB, getDB, run, all, get, lastInsertRowId, persist };
