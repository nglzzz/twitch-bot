'use strict';

const { stmt, uuid, toEpochMs, mapRow, mapRows, updateById } = require('./base');

const MAP_OPTS = { boolFields: ['is_active', 'must_change_password'] };

function _map(row) {
  return mapRow(row, MAP_OPTS);
}

function findById(id) {
  return _map(stmt('SELECT * FROM admin_user WHERE id = ?').get(id));
}

function findOneByUsername(username) {
  if (!username) {
    return null;
  }
  // COLLATE NOCASE в схеме обеспечивает case-insensitive unique; дублируем здесь для надёжности.
  return _map(stmt('SELECT * FROM admin_user WHERE username = ? COLLATE NOCASE LIMIT 1').get(username));
}

function findAllOrdered() {
  return mapRows(stmt('SELECT * FROM admin_user ORDER BY created_at ASC').all(), MAP_OPTS);
}

function create(data) {
  const id = uuid();
  const now = Date.now();
  stmt(
    `INSERT INTO admin_user
      (id, username, display_name, password_hash, role, is_active, must_change_password, last_login_at, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    (data.username || '').toLowerCase(),
    data.displayName ?? null,
    data.passwordHash ?? null,
    data.role ?? 'admin',
    data.isActive === false ? 0 : 1,
    data.mustChangePassword === false ? 0 : 1,
    toEpochMs(data.lastLoginAt),
    now,
    now
  );
  return findById(id);
}

function update(id, patch) {
  updateById('admin_user', id, patch);
  return findById(id);
}

module.exports = {
  findById,
  findOneByUsername,
  findAllOrdered,
  create,
  update,
};
