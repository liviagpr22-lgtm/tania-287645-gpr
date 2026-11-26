const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const DB_DIR = path.join(__dirname, '..', 'data');
const DB_PATH = process.env.TANIA_DB_PATH || path.join(DB_DIR, 'tania.db');
const DB_PARENT = path.dirname(DB_PATH);
const SCHEMA_PATH = path.join(__dirname, 'schema.sql');

if (!fs.existsSync(DB_PARENT)) fs.mkdirSync(DB_PARENT, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = ' + (process.env.TANIA_SERVERLESS === '1' ? 'DELETE' : 'WAL'));
db.exec('PRAGMA foreign_keys = ON');

const schema = fs.readFileSync(SCHEMA_PATH, 'utf8');
db.exec(schema);

function transaction(fn) {
  db.exec('BEGIN');
  try {
    const result = fn(db);
    db.exec('COMMIT');
    return result;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

module.exports = { db, transaction };