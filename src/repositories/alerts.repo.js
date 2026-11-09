'use strict';

const { stmt } = require('./base');

function getSettingsValue(key = 'primary') {
  const row = stmt('SELECT value FROM alerts_settings WHERE key = ?').get(key);
  if (!row) return null;
  try { return JSON.parse(row.value); } catch (_) { return null; }
}

function saveSettingsValue(value, key = 'primary') {
  stmt(`INSERT INTO alerts_settings (key, value, updated_at) VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`)
    .run(key, JSON.stringify(value), Date.now());
}

module.exports = { getSettingsValue, saveSettingsValue };
