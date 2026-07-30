'use strict';

const { stmt, uuid, toEpochMs, mapRow, mapRows, updateById } = require('./base');

const MAP_OPTS = { boolFields: [] };

function findByStatus(status) {
  return mapRows(
    stmt('SELECT * FROM sub_game WHERE game = ?').all(status),
    MAP_OPTS
  );
}

/**
 * Все незакрытые (closed_date IS NULL) заказы игр.
 */
function findOpen() {
  return mapRows(
    stmt('SELECT * FROM sub_game WHERE closed_date IS NULL').all(),
    MAP_OPTS
  );
}

/**
 * Незакрытый заказ конкретного пользователя.
 */
function findOneOpenByUser(user) {
  return mapRow(
    stmt('SELECT * FROM sub_game WHERE user = ? AND closed_date IS NULL LIMIT 1').get(user),
    MAP_OPTS
  );
}

/**
 * Незакрытые заказы набора пользователей.
 */
function findOpenByUsers(users) {
  if (!users || users.length === 0) return [];
  const placeholders = users.map(() => '?').join(',');
  return mapRows(
    stmt(`SELECT * FROM sub_game WHERE user IN (${placeholders}) AND closed_date IS NULL`).all(...users),
    MAP_OPTS
  );
}

function findOneByGameAndUser(game, user) {
  return mapRow(
    stmt('SELECT * FROM sub_game WHERE game = ? AND user = ? LIMIT 1').get(game, user),
    MAP_OPTS
  );
}

function findById(id) {
  return mapRow(stmt('SELECT * FROM sub_game WHERE id = ?').get(id), MAP_OPTS);
}

function create(data) {
  const id = uuid();
  const now = Date.now();
  stmt(
    `INSERT INTO sub_game (id, game, user, winner_date, closed_date, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    id,
    data.game ?? null,
    data.user ?? null,
    toEpochMs(data.winnerDate),
    toEpochMs(data.closedDate),
    now,
    now
  );
  return findById(id);
}

function update(id, patch) {
  updateById('sub_game', id, patch);
  return findById(id);
}

/**
 * Удаление по id.
 */
function removeById(id) {
  stmt('DELETE FROM sub_game WHERE id = ?').run(id);
}

module.exports = {
  findByStatus,
  findOpen,
  findOneOpenByUser,
  findOpenByUsers,
  findOneByGameAndUser,
  findById,
  create,
  update,
  removeById,
};
