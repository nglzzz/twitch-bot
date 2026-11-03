'use strict';

function parseHistoryCursor(value) {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length > 512 || !/^[A-Za-z0-9_-]+$/.test(value)) {
    throw new TypeError('Invalid message history cursor');
  }
  let cursor;
  try { cursor = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')); }
  catch (_) { throw new TypeError('Invalid message history cursor'); }
  if (!cursor || !Number.isSafeInteger(cursor.createdAt) || cursor.createdAt < 0
    || typeof cursor.id !== 'string' || !cursor.id || cursor.id.length > 128) {
    throw new TypeError('Invalid message history cursor');
  }
  return { createdAt: cursor.createdAt, id: cursor.id };
}

function encodeHistoryCursor(message) {
  return Buffer.from(JSON.stringify({ createdAt: message.createdAt, id: message.id })).toString('base64url');
}

module.exports = { parseHistoryCursor, encodeHistoryCursor };
