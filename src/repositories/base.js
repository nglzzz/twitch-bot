'use strict';

const crypto = require('crypto');
const db = require('../app/db');

// Кэш подготовленных инструкций. Создаются лениво при первом использовании,
// поэтому модуль безопасно загружается даже когда БД недоступна (сервисы
// проверяют isDbReady() до вызова функций репозиториев).
const _stmtCache = new Map();

function stmt(sql) {
  let s = _stmtCache.get(sql);
  if (!s) {
    s = db.prepare(sql);
    _stmtCache.set(sql, s);
  }
  return s;
}

function uuid() {
  return crypto.randomUUID();
}

function camelToSnake(key) {
  return key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
}

function snakeToCamel(key) {
  return key.replace(/_([a-z])/g, (_, c) => c.toUpperCase());
}

/**
 * Преобразует JS-значение в форму для записи в SQLite:
 * Date → epoch-ms, boolean → 0/1, массив/объект → JSON, null/undefined → null.
 */
function normalizeValue(value) {
  if (value === undefined) return null;
  if (value === null) return null;
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (Array.isArray(value) || (typeof value === 'object' && !(value instanceof Date))) {
    return JSON.stringify(value);
  }
  return value;
}

/**
 * Принимает значение даты (Date | number | string) и возвращает epoch-ms.
 */
function toEpochMs(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.getTime();
  const num = Number(value);
  if (Number.isFinite(num)) return num;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : null;
}

/**
 * Маппер строки БД (snake_case) в JS-объект (camelCase), совместимый с
 * lean-документами Mongoose. Колонка `id` → `_id`. JSON-колонки
 * парсятся, числовые флаги приводятся к boolean.
 */
function mapRow(row, opts = {}) {
  if (!row) return null;
  const { jsonFields = [], boolFields = [] } = opts;
  const result = {};
  for (const [snakeKey, value] of Object.entries(row)) {
    let key = snakeToCamel(snakeKey);
    let v = value;
    if (snakeKey === 'id') {
      key = '_id';
    }
    if (jsonFields.includes(snakeKey) && typeof v === 'string') {
      try {
        v = JSON.parse(v);
      } catch (_) {
        /* оставляем сырую строку */
      }
    }
    if (boolFields.includes(snakeKey) && v !== null && v !== undefined) {
      v = Boolean(v);
    }
    result[key] = v;
  }
  return result;
}

function mapRows(rows, opts) {
  return rows.map((r) => mapRow(r, opts));
}

/**
 * Универсальный UPDATE по первичному ключу `id`. Ключи patch — camelCase.
 */
function updateById(table, id, patch) {
  const keys = Object.keys(patch);
  if (keys.length === 0) {
    stmt(`UPDATE ${table} SET updated_at = ? WHERE id = ?`).run(Date.now(), id);
    return;
  }
  const sets = keys.map((k) => `${camelToSnake(k)} = ?`).join(', ');
  const values = keys.map((k) => normalizeValue(patch[k]));
  stmt(`UPDATE ${table} SET ${sets}, updated_at = ? WHERE id = ?`)
    .run(...values, Date.now(), id);
}

module.exports = {
  db,
  stmt,
  uuid,
  camelToSnake,
  normalizeValue,
  toEpochMs,
  mapRow,
  mapRows,
  updateById,
};
