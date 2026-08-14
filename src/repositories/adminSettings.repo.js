'use strict';

const { stmt, mapRow, camelToSnake } = require('./base');

const MAP_OPTS = { boolFields: [] };

function getSingleton() {
  const row = stmt("SELECT * FROM admin_settings WHERE singleton_key = 'primary' LIMIT 1").get();
  return mapRow(row, MAP_OPTS);
}

/**
 * Upsert настроек (singleton). data — camelCase-ключи.
 * Сопоставляет findOneAndUpdate({singletonKey:'primary'}, {$set:data}, {upsert:true, new:true}).
 */
function upsert(data) {
  const fields = [
    'donation_alerts_api_key',
    'stream_elements_token',
    'stream_elements_channel_id',
    'boosty_token',
    'twitch_token',
    'usdt_trc20_wallet_address',
    'meme_alerts_channel_id',
    'meme_alerts_test_token',
    'meme_alerts_test_csrf',
    'meme_alerts_test_csrf_token',
    'meme_alerts_test_name',
  ];

  const patch = {};
  for (const [key, value] of Object.entries(data)) {
    const snake = camelToSnake(key);
    if (fields.includes(snake)) {
      patch[snake] = value;
    }
  }

  const existing = getSingleton();
  if (!existing) {
    const cols = ['singleton_key', ...fields, 'updated_at'];
    const placeholders = cols.map(() => '?').join(',');
    stmt(
      `INSERT INTO admin_settings (${cols.join(',')}) VALUES (${placeholders})`
    ).run('primary', ...fields.map((f) => patch[f] ?? ''), Date.now());
  } else {
    const keys = Object.keys(patch);
    if (keys.length === 0) {
      stmt("UPDATE admin_settings SET updated_at = ? WHERE singleton_key = 'primary'").run(Date.now());
    } else {
      const sets = keys.map((k) => `${k} = ?`).join(', ');
      stmt(`UPDATE admin_settings SET ${sets}, updated_at = ? WHERE singleton_key = 'primary'`)
        .run(...keys.map((k) => patch[k]), Date.now());
    }
  }

  return getSingleton();
}

module.exports = {
  getSingleton,
  upsert,
};
