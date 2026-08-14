'use strict';

// Одноразовая миграция данных MongoDB → SQLite.
//
// Запуск:
//   MONGO_URI='mongodb+srv://...' SQLITE_PATH=./data/twitch-bot.sqlite node scripts/migrate-mongo-to-sqlite.js
//
// Что делает:
//   1. Подключается к MongoDB (по MONGO_URI) и к SQLite-файлу (по SQLITE_PATH).
//   2. Создаёт схему SQLite (если файла ещё нет).
//   3. Переносит каждую коллекцию батчами, сохраняя исходные _id как TEXT-ключи
//      — поэтому связи по streamSessionId/createdBy остаются консистентными.
//   4. В конце сверяет количество строк в SQLite с countDocuments в Mongo.
//
// Данные с таким же _id уже не вставляются повторно (INSERT OR IGNORE),
// поэтому скрипт можно безопасно перезапускать.

require('dotenv').config();

const path = require('path');
const fs = require('fs');
const { MongoClient } = require('mongodb');
const Database = require('better-sqlite3');
// Схему подключаем независимо от того, откуда запускается скрипт:
// из scripts/ репозитория (../src/app/schema) или из корня migrator-образа (./src/app/schema).
let STATEMENTS, SCHEMA_VERSION, upgradeSchema;
try {
  ({ STATEMENTS, SCHEMA_VERSION, upgradeSchema } = require('../src/app/schema'));
} catch (_) {
  ({ STATEMENTS, SCHEMA_VERSION, upgradeSchema } = require('./src/app/schema'));
}

const MONGO_URI = process.env.MONGO_URI;
const SQLITE_PATH = process.env.SQLITE_PATH
  ? path.resolve(process.env.SQLITE_PATH)
  : path.resolve(process.cwd(), 'data', 'twitch-bot.sqlite');

const BATCH_SIZE = 1000;

if (!MONGO_URI) {
  console.error('MONGO_URI is not set. Export it before running the migration.');
  process.exit(1);
}

/**
 * Нормализация значения из Mongo-документа в значение для SQLite.
 * ObjectId → строка, Date → epoch-ms, массив/объект → JSON, undefined → null.
 */
function val(value) {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
    if (typeof value === 'boolean') return value ? 1 : 0;
    return value;
  }
  if (value instanceof Date) return value.getTime();
  // ObjectId
  if (value && typeof value.toHexString === 'function') return value.toHexString();
  if (value && typeof value.toString === 'function' && value._bsontype) {
    try { return value.toString(); } catch (_) { return String(value); }
  }
  // массивы и объекты — в JSON
  try { return JSON.stringify(value); } catch (_) { return null; }
}

/**
 * Перенос одной коллекции.
 * @param {import('mongodb').Collection} collection
 * @param {string} table — целевая таблица SQLite
 * @param {string[]} columns — имена колонок (snake_case) в порядке плейсхолдеров
 * @param {(doc) => object[]} mapDoc — функция, возвращающая массив значений в порядке columns
 */
async function migrateCollection(collection, table, columns, mapDoc, sqlite) {
  const placeholders = columns.map(() => '?').join(',');
  const insertSql = `INSERT OR IGNORE INTO ${table} (${columns.join(',')}) VALUES (${placeholders})`;
  const insertStmt = sqlite.prepare(insertSql);

  const mongoCount = await collection.countDocuments();
  console.log(`[${table}] Mongo documents: ${mongoCount}`);

  if (mongoCount === 0) {
    return { table, mongo: 0, sqlite: sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c };
  }

  let inserted = 0;
  let processed = 0;
  const cursor = collection.find({});
  const insertMany = sqlite.transaction((rows) => {
    for (const row of rows) {
      insertStmt.run(...mapDoc(row));
    }
  });

  let batch = [];
  while (await cursor.hasNext()) {
    const doc = await cursor.next();
    batch.push(doc);
    if (batch.length >= BATCH_SIZE) {
      insertMany(batch);
      inserted += batch.length;
      processed += batch.length;
      console.log(`[${table}] processed ${processed}/${mongoCount}`);
      batch = [];
    }
  }
  if (batch.length > 0) {
    insertMany(batch);
    processed += batch.length;
  }

  const sqliteCount = sqlite.prepare(`SELECT COUNT(*) AS c FROM ${table}`).get().c;
  console.log(`[${table}] inserted batch rows: ${inserted}, SQLite rows now: ${sqliteCount}`);
  return { table, mongo: mongoCount, sqlite: sqliteCount };
}

async function main() {
  console.log('=== MongoDB → SQLite migration ===');
  console.log(`SQLite target: ${SQLITE_PATH}`);

  // Подготовка SQLite
  const dir = path.dirname(SQLITE_PATH);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const sqlite = new Database(SQLITE_PATH);
  sqlite.pragma('journal_mode = WAL');
  sqlite.pragma('foreign_keys = OFF'); // импорт в порядке зависимостей; проверим после
  for (const statement of STATEMENTS) {
    sqlite.exec(statement);
  }
  upgradeSchema(sqlite);
  const applied = sqlite.prepare('SELECT version FROM schema_migrations WHERE version = ?').get(SCHEMA_VERSION);
  if (!applied) {
    sqlite.prepare('INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)').run(SCHEMA_VERSION, Date.now());
  }

  // Подключение к Mongo
  console.log(`Connecting to MongoDB: ${MONGO_URI.replace(/:\/\/[^@]*@/, '://***@')}`);
  const client = new MongoClient(MONGO_URI, { serverSelectionTimeoutMS: 10000 });
  await client.connect();
  const dbName = new URL(MONGO_URI).pathname.replace(/^\//, '') || 'myFirstDatabase';
  const db = client.db(dbName);
  console.log(`Mongo database: ${dbName}`);

  const results = [];

  try {
    // Порядок по FK: родители (admin_user, stream_session) → зависимые.

    // --- admin_user ---
    results.push(await migrateCollection(
      db.collection('adminusers'), 'admin_user',
      ['id', 'username', 'display_name', 'password_hash', 'role', 'is_active', 'must_change_password', 'last_login_at', 'created_at', 'updated_at'],
      (doc) => [
        String(doc._id),
        doc.username,
        doc.displayName,
        doc.passwordHash,
        doc.role ?? 'admin',
        doc.isActive === false ? 0 : 1,
        doc.mustChangePassword === false ? 0 : 1,
        val(doc.lastLoginAt),
        val(doc.createdAt),
        val(doc.updatedAt),
      ],
      sqlite
    ));

    // --- admin_settings (singleton) ---
    results.push(await migrateCollection(
      db.collection('adminsettings'), 'admin_settings',
      ['singleton_key', 'donation_alerts_api_key', 'stream_elements_token', 'stream_elements_channel_id', 'boosty_token', 'twitch_token', 'meme_alerts_channel_id', 'meme_alerts_test_token', 'meme_alerts_test_csrf', 'meme_alerts_test_csrf_token', 'meme_alerts_test_name', 'updated_at'],
      (doc) => [
        doc.singletonKey ?? 'primary',
        doc.donationAlertsApiKey ?? '',
        doc.streamElementsToken ?? '',
        doc.streamElementsChannelId ?? '',
        doc.boostyToken ?? '',
        doc.twitchToken ?? '',
        doc.memeAlertsChannelId ?? '',
        doc.memeAlertsTestToken ?? '',
        doc.memeAlertsTestCsrf ?? '',
        doc.memeAlertsTestCsrfToken ?? '',
        doc.memeAlertsTestName ?? '',
        val(doc.updatedAt),
      ],
      sqlite
    ));

    // --- stream_session ---
    results.push(await migrateCollection(
      db.collection('streamsessions'), 'stream_session',
      ['id', 'stream_id', 'title', 'game_name', 'started_at', 'ended_at', 'status', 'last_seen_at', 'max_viewers', 'avg_viewers', 'viewer_snapshot_count', 'viewer_snapshot_sum', 'unique_viewers', 'messages_count', 'unique_chatters', 'memes_count', 'created_at', 'updated_at'],
      (doc) => [
        String(doc._id),
        doc.streamId,
        doc.title,
        doc.gameName,
        val(doc.startedAt),
        val(doc.endedAt),
        doc.status ?? 'live',
        val(doc.lastSeenAt),
        doc.maxViewers ?? 0,
        doc.avgViewers ?? 0,
        doc.viewerSnapshotCount ?? 0,
        doc.viewerSnapshotSum ?? 0,
        doc.uniqueViewers ?? 0,
        doc.messagesCount ?? 0,
        doc.uniqueChatters ?? 0,
        doc.memesCount ?? 0,
        val(doc.createdAt),
        val(doc.updatedAt),
      ],
      sqlite
    ));

    // --- chat_log ---
    results.push(await migrateCollection(
      db.collection('chatlogs'), 'chat_log',
      ['id', 'user', 'display_name', 'message', 'stream_session_id', 'created_at', 'updated_at'],
      (doc) => [
        String(doc._id),
        doc.user,
        doc.displayName,
        doc.message,
        val(doc.streamSessionId),
        val(doc.createdAt),
        val(doc.updatedAt),
      ],
      sqlite
    ));

    // --- viewer (viewers → JSON) ---
    results.push(await migrateCollection(
      db.collection('viewers'), 'viewer',
      ['id', 'viewers', 'stream_session_id', 'created_at', 'updated_at'],
      (doc) => [
        String(doc._id),
        JSON.stringify(Array.isArray(doc.viewers) ? doc.viewers : []),
        val(doc.streamSessionId),
        val(doc.createdAt),
        val(doc.updatedAt),
      ],
      sqlite
    ));

    // --- meme_log ---
    results.push(await migrateCollection(
      db.collection('memelogs'), 'meme_log',
      ['id', 'event_id', 'user', 'user_alias', 'sticker_name', 'kind', 'sent_at', 'stream_session_id', 'raw', 'created_at', 'updated_at'],
      (doc) => [
        String(doc._id),
        doc.eventId,
        doc.user,
        doc.userAlias,
        doc.stickerName,
        doc.kind,
        val(doc.sentAt),
        val(doc.streamSessionId),
        doc.raw !== undefined && doc.raw !== null ? JSON.stringify(doc.raw) : null,
        val(doc.createdAt),
        val(doc.updatedAt),
      ],
      sqlite
    ));

    // --- donation ---
    results.push(await migrateCollection(
      db.collection('donations'), 'donation',
      ['id', 'source', 'is_test', 'external_id', 'donor_name', 'donor_id', 'message', 'amount', 'currency', 'stream_session_id', 'stream_elements_activity_id', 'status', 'error', 'raw', 'created_at', 'updated_at'],
      (doc) => [
        String(doc._id),
        doc.source,
        doc.isTest ? 1 : 0,
        doc.externalId ?? null,
        doc.donorName,
        doc.donorId ?? '',
        doc.message ?? '',
        doc.amount,
        doc.currency ?? 'RUB',
        val(doc.streamSessionId),
        doc.streamElementsActivityId ?? null,
        doc.status ?? 'pending',
        doc.error ?? null,
        doc.raw !== undefined && doc.raw !== null ? JSON.stringify(doc.raw) : null,
        val(doc.createdAt),
        val(doc.updatedAt),
      ],
      sqlite
    ));

    // --- scheduled_donation ---
    results.push(await migrateCollection(
      db.collection('scheduleddonations'), 'scheduled_donation',
      ['id', 'donor_name', 'amount', 'message', 'currency', 'scheduled_for', 'status', 'sent_at', 'error', 'created_by', 'created_at', 'updated_at'],
      (doc) => [
        String(doc._id),
        doc.donorName,
        doc.amount,
        doc.message ?? '',
        doc.currency ?? 'RUB',
        val(doc.scheduledFor),
        doc.status ?? 'pending',
        val(doc.sentAt),
        doc.error ?? null,
        val(doc.createdBy),
        val(doc.createdAt),
        val(doc.updatedAt),
      ],
      sqlite
    ));

    // --- scheduled_meme ---
    results.push(await migrateCollection(
      db.collection('scheduledmemes'), 'scheduled_meme',
      ['id', 'sticker_id', 'selection', 'sender', 'message', 'is_sound_only', 'scheduled_for', 'status', 'sent_at', 'error', 'created_by', 'created_at', 'updated_at'],
      (doc) => [
        String(doc._id),
        doc.stickerId ?? '',
        doc.selection ?? 'random',
        doc.sender ?? 'test',
        doc.message ?? '',
        doc.isSoundOnly ? 1 : 0,
        val(doc.scheduledFor),
        doc.status ?? 'pending',
        val(doc.sentAt),
        doc.error ?? null,
        val(doc.createdBy),
        val(doc.createdAt),
        val(doc.updatedAt),
      ],
      sqlite
    ));

    // --- sub_game ---
    results.push(await migrateCollection(
      db.collection('subgames'), 'sub_game',
      ['id', 'game', 'user', 'winner_date', 'closed_date', 'created_at', 'updated_at'],
      (doc) => [
        String(doc._id),
        doc.game,
        doc.user,
        val(doc.winnerDate),
        val(doc.closedDate),
        val(doc.createdAt),
        val(doc.updatedAt),
      ],
      sqlite
    ));
  } finally {
    await client.close();
  }

  // Проверка ссылочной целостности (теперь включаем FK).
  sqlite.pragma('foreign_keys = ON');

  console.log('\n=== Migration summary ===');
  let allOk = true;
  for (const r of results) {
    const match = r.mongo === r.sqlite ? 'OK' : 'MISMATCH';
    if (r.mongo !== r.sqlite) allOk = false;
    console.log(`${r.table.padEnd(20)} mongo=${String(r.mongo).padStart(7)}  sqlite=${String(r.sqlite).padStart(7)}  ${match}`);
  }

  console.log(`\nSQLite file: ${SQLITE_PATH}`);
  if (allOk) {
    console.log('Migration completed. All row counts match.');
    process.exit(0);
  } else {
    console.error('WARNING: some row counts do not match. Inspect the table above before switching.');
    process.exit(2);
  }
}

main().catch((error) => {
  console.error('Migration failed:', error);
  process.exit(1);
});
