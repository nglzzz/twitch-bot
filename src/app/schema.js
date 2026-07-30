'use strict';

// SQL-схема базы данных.
//
// Все таблицы создаются идемпотентно (CREATE TABLE/INDEX IF NOT EXISTS).
// Даты хранятся как INTEGER (unix epoch в миллисекундах) — это совпадает
// с тем, как Mongo возвращает разницу Date - Date в миллисекундах, и позволяет
// считать длительности (например, среднюю длительность стрима) простым вычитанием.
//
// Первичные ключи — TEXT. Для новых записей генерируется UUIDv4; при миграции
// из Mongo сохраняются исходные строковые ObjectId, поэтому связи по
// stream_session_id / created_by остаются консистентными.

const SCHEMA_VERSION = 1;

const STATEMENTS = [
  // --- stream_session: центральная таблица (аналитический хаб) ---
  `CREATE TABLE IF NOT EXISTS stream_session (
    id TEXT PRIMARY KEY,
    stream_id TEXT,
    title TEXT,
    game_name TEXT,
    started_at INTEGER,
    ended_at INTEGER,
    status TEXT NOT NULL DEFAULT 'live',
    last_seen_at INTEGER,
    max_viewers INTEGER NOT NULL DEFAULT 0,
    avg_viewers INTEGER NOT NULL DEFAULT 0,
    viewer_snapshot_count INTEGER NOT NULL DEFAULT 0,
    viewer_snapshot_sum INTEGER NOT NULL DEFAULT 0,
    unique_viewers INTEGER NOT NULL DEFAULT 0,
    messages_count INTEGER NOT NULL DEFAULT 0,
    unique_chatters INTEGER NOT NULL DEFAULT 0,
    memes_count INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stream_session_stream_id ON stream_session(stream_id)`,
  `CREATE INDEX IF NOT EXISTS idx_stream_session_status_started ON stream_session(status, started_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_stream_session_started ON stream_session(started_at DESC)`,

  // --- chat_log: одно сообщение на строку (главный драйвер роста) ---
  `CREATE TABLE IF NOT EXISTS chat_log (
    id TEXT PRIMARY KEY,
    user TEXT NOT NULL,
    display_name TEXT,
    message TEXT,
    stream_session_id TEXT REFERENCES stream_session(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_log_created ON chat_log(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_log_user_created ON chat_log(user, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_log_stream ON chat_log(stream_session_id)`,

  // --- viewer: снапшот каждые 5 минут во время стрима.
  // viewers — JSON-массив ников (TEXT). Запросы по содержимому идут через json_each().
  `CREATE TABLE IF NOT EXISTS viewer (
    id TEXT PRIMARY KEY,
    viewers TEXT NOT NULL DEFAULT '[]',
    stream_session_id TEXT REFERENCES stream_session(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_viewer_created ON viewer(created_at DESC)`,

  // --- meme_log: одно событие отправки мема на строку ---
  `CREATE TABLE IF NOT EXISTS meme_log (
    id TEXT PRIMARY KEY,
    event_id TEXT,
    user TEXT,
    user_alias TEXT,
    sticker_name TEXT,
    kind TEXT,
    sent_at INTEGER,
    stream_session_id TEXT REFERENCES stream_session(id) ON DELETE SET NULL,
    raw TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_meme_log_event ON meme_log(event_id)`,
  `CREATE INDEX IF NOT EXISTS idx_meme_log_user_sent ON meme_log(user, sent_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_meme_log_sent ON meme_log(sent_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_meme_log_stream ON meme_log(stream_session_id)`,

  // --- donation: записи о донациях ---
  `CREATE TABLE IF NOT EXISTS donation (
    id TEXT PRIMARY KEY,
    source TEXT NOT NULL,
    is_test INTEGER NOT NULL DEFAULT 0,
    external_id TEXT,
    donor_name TEXT NOT NULL,
    donor_id TEXT NOT NULL DEFAULT '',
    message TEXT NOT NULL DEFAULT '',
    amount REAL NOT NULL,
    currency TEXT NOT NULL DEFAULT 'RUB',
    stream_session_id TEXT REFERENCES stream_session(id) ON DELETE SET NULL,
    stream_elements_activity_id TEXT,
    status TEXT NOT NULL DEFAULT 'pending',
    error TEXT,
    raw TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_donation_is_test ON donation(is_test)`,
  `CREATE INDEX IF NOT EXISTS idx_donation_stream_created ON donation(stream_session_id, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_donation_created ON donation(created_at DESC)`,
  // Частичный уникальный индекс заменяет Mongo partialFilterExpression + рантайм-миграцию
  // ensureDonationIndexes(): внешние идентификаторы уникальны только когда заданы.
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_donation_source_external
     ON donation(source, external_id) WHERE external_id IS NOT NULL`,

  // --- scheduled_donation: запланированные донации (lifecycle по status) ---
  `CREATE TABLE IF NOT EXISTS scheduled_donation (
    id TEXT PRIMARY KEY,
    donor_name TEXT NOT NULL,
    amount REAL NOT NULL,
    message TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'RUB',
    scheduled_for INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    sent_at INTEGER,
    error TEXT,
    created_by TEXT REFERENCES admin_user(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_donation_for ON scheduled_donation(scheduled_for)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_donation_status ON scheduled_donation(status)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_donation_status_for ON scheduled_donation(status, scheduled_for)`,

  // --- scheduled_meme: запланированные мемы (lifecycle по status) ---
  `CREATE TABLE IF NOT EXISTS scheduled_meme (
    id TEXT PRIMARY KEY,
    sticker_id TEXT NOT NULL DEFAULT '',
    selection TEXT NOT NULL DEFAULT 'random',
    sender TEXT NOT NULL DEFAULT 'test',
    message TEXT NOT NULL DEFAULT '',
    is_sound_only INTEGER NOT NULL DEFAULT 0,
    scheduled_for INTEGER NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    sent_at INTEGER,
    error TEXT,
    created_by TEXT REFERENCES admin_user(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_meme_for ON scheduled_meme(scheduled_for)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_meme_status ON scheduled_meme(status)`,
  `CREATE INDEX IF NOT EXISTS idx_scheduled_meme_status_for ON scheduled_meme(status, scheduled_for)`,

  // --- admin_user: учётки админов ---
  `CREATE TABLE IF NOT EXISTS admin_user (
    id TEXT PRIMARY KEY,
    username TEXT NOT NULL UNIQUE COLLATE NOCASE,
    display_name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    role TEXT NOT NULL DEFAULT 'admin',
    is_active INTEGER NOT NULL DEFAULT 1,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    last_login_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  // --- admin_settings: однорядная таблица настроек (singleton) ---
  `CREATE TABLE IF NOT EXISTS admin_settings (
    singleton_key TEXT PRIMARY KEY NOT NULL DEFAULT 'primary',
    donation_alerts_api_key TEXT NOT NULL DEFAULT '',
    stream_elements_token TEXT NOT NULL DEFAULT '',
    stream_elements_channel_id TEXT NOT NULL DEFAULT '',
    meme_alerts_channel_id TEXT NOT NULL DEFAULT '',
    meme_alerts_test_token TEXT NOT NULL DEFAULT '',
    meme_alerts_test_csrf TEXT NOT NULL DEFAULT '',
    meme_alerts_test_csrf_token TEXT NOT NULL DEFAULT '',
    meme_alerts_test_name TEXT NOT NULL DEFAULT '',
    updated_at INTEGER NOT NULL
  )`,

  // --- sub_game: записи игр подписки (команды отключены, схема сохранена ради миграции) ---
  `CREATE TABLE IF NOT EXISTS sub_game (
    id TEXT PRIMARY KEY,
    game TEXT,
    user TEXT,
    winner_date INTEGER,
    closed_date INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  // --- schema_migrations: контроль версий схемы ---
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`,
];

module.exports = {
  SCHEMA_VERSION,
  STATEMENTS,
};
