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

const SCHEMA_VERSION = 7;

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
    user_id TEXT,
    message_id TEXT,
    display_name TEXT,
    message TEXT,
    stream_session_id TEXT REFERENCES stream_session(id) ON DELETE SET NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_chat_log_created ON chat_log(created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_log_user_created ON chat_log(user, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_chat_log_lower_user ON chat_log(lower(user))`,
  `CREATE INDEX IF NOT EXISTS idx_chat_log_stream ON chat_log(stream_session_id)`,
  // --- community profiles and game events ---
  `CREATE TABLE IF NOT EXISTS community_user (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE,
    display_name TEXT NOT NULL,
    first_seen_at INTEGER NOT NULL,
    last_seen_at INTEGER NOT NULL,
    followed_at INTEGER,
    identity_checked_at INTEGER,
    current_followed_at INTEGER,
    follow_status INTEGER,
    follow_checked_at INTEGER,
    avatar_url TEXT,
    avatar_checked_at INTEGER,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_community_user_username ON community_user(username COLLATE NOCASE)`,
  `CREATE TABLE IF NOT EXISTS community_paid_subscription (
    user_id TEXT NOT NULL REFERENCES community_user(user_id) ON DELETE CASCADE,
    provider TEXT NOT NULL CHECK (provider IN ('twitch', 'boosty')),
    external_subscriber_id TEXT,
    confirmed_by TEXT,
    first_confirmed_at INTEGER NOT NULL,
    PRIMARY KEY (user_id, provider)
  )`,
  `CREATE TABLE IF NOT EXISTS community_game_win (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES community_user(user_id) ON DELETE CASCADE,
    mode TEXT NOT NULL,
    stream_id TEXT,
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_community_game_win_user_mode ON community_game_win(user_id, mode, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_community_game_win_mode_created ON community_game_win(mode, created_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_community_game_win_stream ON community_game_win(stream_id)`,
  `CREATE TABLE IF NOT EXISTS community_achievement (
    user_id TEXT NOT NULL REFERENCES community_user(user_id) ON DELETE CASCADE,
    achievement_id TEXT NOT NULL,
    earned_at INTEGER NOT NULL,
    is_historical INTEGER NOT NULL DEFAULT 0,
    announced_at INTEGER,
    PRIMARY KEY (user_id, achievement_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_community_achievement_earned ON community_achievement(earned_at DESC, achievement_id)`,
  `CREATE INDEX IF NOT EXISTS idx_community_achievement_pending ON community_achievement(announced_at, earned_at)`,
  `CREATE TABLE IF NOT EXISTS community_achievement_state (
    user_id TEXT PRIMARY KEY REFERENCES community_user(user_id) ON DELETE CASCADE,
    initialized_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS community_redemption (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES community_user(user_id) ON DELETE CASCADE,
    cost INTEGER NOT NULL CHECK (cost >= 0),
    reward_id TEXT,
    status TEXT NOT NULL DEFAULT 'unfulfilled',
    redeemed_at INTEGER NOT NULL,
    handled INTEGER NOT NULL DEFAULT 0 CHECK (handled IN (0, 1)),
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_community_redemption_user_status ON community_redemption(user_id, status)`,
  `CREATE TABLE IF NOT EXISTS community_support_link_audit (
    id TEXT PRIMARY KEY,
    record_kind TEXT NOT NULL,
    record_id TEXT NOT NULL,
    user_id TEXT NOT NULL REFERENCES community_user(user_id) ON DELETE CASCADE,
    admin_id TEXT,
    created_at INTEGER NOT NULL,
    UNIQUE (record_kind, record_id)
  )`,

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
    community_user_id TEXT REFERENCES community_user(user_id) ON DELETE SET NULL,
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
    community_user_id TEXT REFERENCES community_user(user_id) ON DELETE SET NULL,
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
    boosty_token TEXT NOT NULL DEFAULT '',
    twitch_token TEXT NOT NULL DEFAULT '',
    usdt_trc20_wallet_address TEXT NOT NULL DEFAULT '',
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

  // --- quiz: lifetime points and one manual/automatic start per stream ---
  `CREATE TABLE IF NOT EXISTS quiz_score (
    user_id TEXT PRIMARY KEY,
    username TEXT NOT NULL COLLATE NOCASE,
    display_name TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_quiz_score_points ON quiz_score(points DESC, username COLLATE NOCASE)`,
  `CREATE TABLE IF NOT EXISTS quiz_stream (
    stream_id TEXT PRIMARY KEY,
    started_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS quiz_question (
    id TEXT PRIMARY KEY,
    clue TEXT NOT NULL,
    answers TEXT NOT NULL,
    answer_key TEXT NOT NULL UNIQUE,
    source TEXT NOT NULL DEFAULT 'ai',
    mode TEXT NOT NULL DEFAULT 'quiz',
    created_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_quiz_question_source_created ON quiz_question(source, created_at)`,
  `CREATE TABLE IF NOT EXISTS quiz_question_use (
    stream_id TEXT NOT NULL,
    question_id TEXT NOT NULL REFERENCES quiz_question(id) ON DELETE CASCADE,
    used_at INTEGER NOT NULL,
    PRIMARY KEY (stream_id, question_id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_quiz_question_use_question ON quiz_question_use(question_id)`,

  // --- alerts: единые алерты донатов со всех сервисов (настройки key/value JSON) ---
  `CREATE TABLE IF NOT EXISTS alerts_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,

  // --- music: заказ музыки (song requests) ---
  `CREATE TABLE IF NOT EXISTS music_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS music_request (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT NOT NULL,
    author TEXT,
    duration_sec INTEGER NOT NULL DEFAULT 0,
    thumbnail TEXT,
    url TEXT,
    requested_by TEXT NOT NULL,
    requested_by_display TEXT,
    requested_by_id TEXT,
    source TEXT NOT NULL,
    is_paid INTEGER NOT NULL DEFAULT 0,
    amount REAL,
    currency TEXT,
    amount_rub REAL,
    donation_id TEXT,
    start_sec INTEGER NOT NULL DEFAULT 0,
    play_limit_sec INTEGER,
    position REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',
    status_reason TEXT,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_music_request_status_position ON music_request(status, position)`,
  `CREATE INDEX IF NOT EXISTS idx_music_request_finished ON music_request(finished_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_music_request_requester ON music_request(lower(requested_by), status)`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_music_request_donation ON music_request(donation_id) WHERE donation_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_music_request_requester_id ON music_request(requested_by_id) WHERE requested_by_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS music_blacklist_track (
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (provider, external_id)
  )`,
  `CREATE TABLE IF NOT EXISTS music_blacklist_user (
    login TEXT PRIMARY KEY COLLATE NOCASE,
    created_at INTEGER NOT NULL
  )`,

  // --- video: заказ видео (video requests) ---
  `CREATE TABLE IF NOT EXISTS video_settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS video_request (
    id TEXT PRIMARY KEY,
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'video',
    title TEXT NOT NULL,
    author TEXT,
    channel_id TEXT,
    duration_sec INTEGER,
    thumbnail TEXT,
    url TEXT,
    embed TEXT,
    is_vertical INTEGER NOT NULL DEFAULT 0,
    view_count INTEGER,
    published_at INTEGER,
    requested_by TEXT NOT NULL,
    requested_by_display TEXT,
    requested_by_id TEXT,
    message_id TEXT,
    co_requesters TEXT NOT NULL DEFAULT '[]',
    source TEXT NOT NULL,
    is_paid INTEGER NOT NULL DEFAULT 0,
    amount REAL,
    currency TEXT,
    amount_rub REAL,
    donation_id TEXT,
    start_sec INTEGER NOT NULL DEFAULT 0,
    play_limit_sec INTEGER,
    position REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'queued',
    status_reason TEXT,
    votes_skip REAL,
    votes_keep REAL,
    created_at INTEGER NOT NULL,
    started_at INTEGER,
    finished_at INTEGER,
    updated_at INTEGER NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_video_request_status_position ON video_request(status, position)`,
  `CREATE INDEX IF NOT EXISTS idx_video_request_requester_id ON video_request(requested_by_id) WHERE requested_by_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_video_request_donation ON video_request(donation_id) WHERE donation_id IS NOT NULL`,
  `CREATE INDEX IF NOT EXISTS idx_video_request_finished ON video_request(finished_at DESC)`,
  `CREATE INDEX IF NOT EXISTS idx_video_request_requester ON video_request(lower(requested_by), status)`,
  `CREATE INDEX IF NOT EXISTS idx_video_request_item ON video_request(provider, external_id)`,
  `CREATE INDEX IF NOT EXISTS idx_video_request_message ON video_request(message_id) WHERE message_id IS NOT NULL`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_video_request_donation ON video_request(donation_id) WHERE donation_id IS NOT NULL`,
  `CREATE TABLE IF NOT EXISTS video_blacklist_item (
    provider TEXT NOT NULL,
    external_id TEXT NOT NULL,
    title TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (provider, external_id)
  )`,
  `CREATE TABLE IF NOT EXISTS video_blacklist_user (
    login TEXT PRIMARY KEY COLLATE NOCASE,
    created_at INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS video_blacklist_channel (
    provider TEXT NOT NULL,
    channel_id TEXT NOT NULL,
    name TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (provider, channel_id)
  )`,

  // --- schema_migrations: контроль версий схемы ---
  `CREATE TABLE IF NOT EXISTS schema_migrations (
    version INTEGER PRIMARY KEY,
    applied_at INTEGER NOT NULL
  )`,
];

/**
 * Add columns introduced after the initial SQLite schema was deployed.
 * SQLite has no portable `ADD COLUMN IF NOT EXISTS`, so each column is
 * checked before it is added. This keeps upgrades safe for existing data
 * while the CREATE TABLE statement above remains sufficient for new files.
 *
 * @param {import('better-sqlite3').Database} database
 */
function upgradeSchema(database) {
  const existingColumns = new Set(
    database.prepare('PRAGMA table_info(admin_settings)').all().map((column) => column.name)
  );

  const columns = {
    boosty_token: "TEXT NOT NULL DEFAULT ''",
    twitch_token: "TEXT NOT NULL DEFAULT ''",
    usdt_trc20_wallet_address: "TEXT NOT NULL DEFAULT ''",
  };

  for (const [name, definition] of Object.entries(columns)) {
    if (!existingColumns.has(name)) {
      database.exec(`ALTER TABLE admin_settings ADD COLUMN ${name} ${definition}`);
    }
  }

  const questionColumns = new Set(
    database.prepare('PRAGMA table_info(quiz_question)').all().map((column) => column.name)
  );
  if (!questionColumns.has('mode')) {
    database.exec("ALTER TABLE quiz_question ADD COLUMN mode TEXT NOT NULL DEFAULT 'quiz'");
  }

  const communityColumns = new Set(
    database.prepare('PRAGMA table_info(community_user)').all().map((column) => column.name)
  );
  if (communityColumns.size > 0) {
    database.exec(`CREATE TABLE IF NOT EXISTS community_paid_subscription (
      user_id TEXT NOT NULL REFERENCES community_user(user_id) ON DELETE CASCADE,
      provider TEXT NOT NULL CHECK (provider IN ('twitch', 'boosty')),
      external_subscriber_id TEXT,
      confirmed_by TEXT,
      first_confirmed_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, provider)
    )`);
    const paidSubscriptionColumns = new Set(
      database.prepare('PRAGMA table_info(community_paid_subscription)').all().map((column) => column.name)
    );
    if (!paidSubscriptionColumns.has('external_subscriber_id')) {
      database.exec('ALTER TABLE community_paid_subscription ADD COLUMN external_subscriber_id TEXT');
    }
    if (!paidSubscriptionColumns.has('confirmed_by')) {
      database.exec('ALTER TABLE community_paid_subscription ADD COLUMN confirmed_by TEXT');
    }
    database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_community_paid_subscription_external
      ON community_paid_subscription(provider, external_subscriber_id) WHERE external_subscriber_id IS NOT NULL`);
    const userColumns = {
      current_followed_at: 'INTEGER',
      identity_checked_at: 'INTEGER',
      follow_status: 'INTEGER',
      follow_checked_at: 'INTEGER',
      avatar_url: 'TEXT',
      avatar_checked_at: 'INTEGER',
    };
    for (const [name, definition] of Object.entries(userColumns)) {
      if (!communityColumns.has(name)) database.exec(`ALTER TABLE community_user ADD COLUMN ${name} ${definition}`);
    }
    database.exec(`CREATE TABLE IF NOT EXISTS community_achievement (
      user_id TEXT NOT NULL REFERENCES community_user(user_id) ON DELETE CASCADE,
      achievement_id TEXT NOT NULL,
      earned_at INTEGER NOT NULL,
      is_historical INTEGER NOT NULL DEFAULT 0,
      announced_at INTEGER,
      PRIMARY KEY (user_id, achievement_id)
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_community_achievement_earned ON community_achievement(earned_at DESC, achievement_id)');
    database.exec('CREATE INDEX IF NOT EXISTS idx_community_achievement_pending ON community_achievement(announced_at, earned_at)');
    database.exec(`CREATE TABLE IF NOT EXISTS community_achievement_state (
      user_id TEXT PRIMARY KEY REFERENCES community_user(user_id) ON DELETE CASCADE,
      initialized_at INTEGER NOT NULL
    )`);
    database.exec(`CREATE TABLE IF NOT EXISTS community_redemption (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES community_user(user_id) ON DELETE CASCADE,
      cost INTEGER NOT NULL CHECK (cost >= 0),
      reward_id TEXT,
      status TEXT NOT NULL DEFAULT 'unfulfilled',
      redeemed_at INTEGER NOT NULL,
      handled INTEGER NOT NULL DEFAULT 0 CHECK (handled IN (0, 1)),
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    )`);
    database.exec('CREATE INDEX IF NOT EXISTS idx_community_redemption_user_status ON community_redemption(user_id, status)');
    database.exec(`CREATE TABLE IF NOT EXISTS community_support_link_audit (
      id TEXT PRIMARY KEY,
      record_kind TEXT NOT NULL,
      record_id TEXT NOT NULL,
      user_id TEXT NOT NULL REFERENCES community_user(user_id) ON DELETE CASCADE,
      admin_id TEXT,
      created_at INTEGER NOT NULL,
      UNIQUE (record_kind, record_id)
    )`);
  }

  for (const table of ['meme_log', 'donation']) {
    const tableColumns = new Set(database.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name));
    if (tableColumns.size > 0 && !tableColumns.has('community_user_id')) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN community_user_id TEXT REFERENCES community_user(user_id) ON DELETE SET NULL`);
    }
  }
  if (database.prepare('PRAGMA table_info(meme_log)').all().some((column) => column.name === 'community_user_id')) {
    database.exec('CREATE INDEX IF NOT EXISTS idx_meme_log_community_user_sent ON meme_log(community_user_id, sent_at DESC)');
  }
  if (database.prepare('PRAGMA table_info(donation)').all().some((column) => column.name === 'community_user_id')) {
    database.exec('CREATE INDEX IF NOT EXISTS idx_donation_community_user_created ON donation(community_user_id, created_at DESC)');
  }

  const chatColumns = new Set(
    database.prepare('PRAGMA table_info(chat_log)').all().map((column) => column.name)
  );
  if (chatColumns.size === 0) return;
  if (!chatColumns.has('user_id')) {
    database.exec('ALTER TABLE chat_log ADD COLUMN user_id TEXT');
  }
  if (!chatColumns.has('message_id')) {
    database.exec('ALTER TABLE chat_log ADD COLUMN message_id TEXT');
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_chat_log_user_id_created ON chat_log(user_id, created_at DESC)');
  database.exec('CREATE INDEX IF NOT EXISTS idx_chat_log_login_identity ON chat_log(lower(user), user_id)');
  database.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_chat_log_message_id ON chat_log(message_id) WHERE message_id IS NOT NULL');
}

module.exports = {
  SCHEMA_VERSION,
  STATEMENTS,
  upgradeSchema,
};
