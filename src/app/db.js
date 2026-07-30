'use strict';

const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const { SCHEMA_VERSION, STATEMENTS } = require('./schema');

// Путь к файлу базы данных. По умолчанию ./data/twitch-bot.sqlite.
const SQLITE_PATH = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.resolve(process.cwd(), 'data', 'twitch-bot.sqlite');

const STATE_LABELS = {
  0: 'disconnected',
  1: 'connected',
};

let db = null;
let dbOpenError = null;
let dbOpenedAt = null;

/**
 * Применяет миграции схемы. Идемпотентно: CREATE ... IF NOT EXISTS + запись версии.
 * @param {Database} database
 */
function runMigrations(database) {
  // Каждый оператор выполняется отдельно — это надёжнее объединения строк
  // (не зависит от наличия точки с запятой в конце каждого statements) и
  // даёт понятную ошибку при сбое конкретной таблицы/индекса.
  for (const statement of STATEMENTS) {
    database.exec(statement);
  }

  const applied = database.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(SCHEMA_VERSION);
  if (!applied) {
    database.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)')
      .run(SCHEMA_VERSION, Date.now());
  }
}

function connect() {
  try {
    const dir = path.dirname(SQLITE_PATH);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }

    db = new Database(SQLITE_PATH);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    db.pragma('busy_timeout = 5000');

    runMigrations(db);

    dbOpenError = null;
    dbOpenedAt = new Date().toISOString();
    console.log(`SQLite connected: ${SQLITE_PATH}`);
  } catch (error) {
    db = null;
    dbOpenError = error?.message || String(error);
    dbOpenedAt = new Date().toISOString();
    console.warn('SQLite connection failed. Continuing without DB support.');
    console.error(dbOpenError);
  }
}

/**
 * Готова ли база к работе.
 * @returns {boolean}
 */
function isDbReady() {
  return db !== null && db.open;
}

/**
 * Статус подключения, совместимый с /api/diagnostics/db.
 */
function getDbStatus() {
  const ready = isDbReady();
  return {
    readyState: ready ? 1 : 0,
    state: STATE_LABELS[ready ? 1 : 0] || 'unknown',
    hasConfiguration: Boolean(SQLITE_PATH),
    dbName: 'sqlite',
    host: SQLITE_PATH,
    lastConnectionError: dbOpenError,
    lastConnectionEventAt: dbOpenedAt,
  };
}

connect();

// Экспортируем стабильный объект независимо от того, удалось ли подключиться:
// при ошибке db === null, но isDbReady/getDbStatus должны быть доступны
// (иначе приложение падает в graceful-degradation-режиме).
module.exports = db || {};
module.exports.isDbReady = isDbReady;
module.exports.getDbStatus = getDbStatus;
module.exports.SQLITE_PATH = SQLITE_PATH;
