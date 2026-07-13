const crypto = require('crypto');
const config = require('../config');
const db = require('../app/db');
const AdminUser = require('../models/adminUser.model');

const SESSION_COOKIE = 'nglzzz_admin_session';
const SESSION_TTL_SECONDS = 60 * 60 * 12;
const DEFAULT_PASSWORD = 'change-me';

function getSecret() {
  return config.ADMIN_SESSION_SECRET || '';
}

function isDbReady() {
  return db?.connection?.readyState === 1;
}

function base64Url(value) {
  return Buffer.from(value).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
}

function base64UrlDecode(value) {
  const padded = String(value).replace(/-/g, '+').replace(/_/g, '/').padEnd(Math.ceil(value.length / 4) * 4, '=');
  return Buffer.from(padded, 'base64').toString('utf8');
}

function sign(value) {
  return base64Url(crypto.createHmac('sha256', getSecret()).update(value).digest());
}

function createPasswordHash(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, hash] = String(storedHash || '').split(':');
  if (!salt || !hash) return false;
  const actual = crypto.scryptSync(password, salt, 64).toString('hex');
  return crypto.timingSafeEqual(Buffer.from(hash, 'hex'), Buffer.from(actual, 'hex'));
}

async function ensureInitialAdmin() {
  if (!isDbReady()) return;
  const username = String(config.CHANNEL || '').trim().toLowerCase();
  if (!username) throw new Error('CHANNEL is not configured');
  const existing = await AdminUser.findOne({ username }).lean();
  if (existing) return;
  await AdminUser.create({
    username,
    displayName: username,
    passwordHash: createPasswordHash(DEFAULT_PASSWORD),
    mustChangePassword: true,
  });
  console.log(`[Admin] Initial administrator created for channel: ${username}`);
}

function parseCookies(header) {
  return String(header || '').split(';').reduce((cookies, part) => {
    const separator = part.indexOf('=');
    if (separator < 0) return cookies;
    const key = part.slice(0, separator).trim();
    cookies[key] = decodeURIComponent(part.slice(separator + 1).trim());
    return cookies;
  }, {});
}

function createSession(user) {
  if (!getSecret()) throw new Error('ADMIN_SESSION_SECRET is not configured');
  const payload = base64Url(JSON.stringify({
    userId: String(user._id),
    nonce: crypto.randomBytes(18).toString('hex'),
    expiresAt: Math.floor(Date.now() / 1000) + SESSION_TTL_SECONDS,
  }));
  return `${payload}.${sign(payload)}`;
}

function readSession(cookieValue) {
  if (!getSecret() || !cookieValue) return null;
  const [payload, signature] = String(cookieValue).split('.');
  const expectedSignature = sign(payload);
  if (!payload || !signature || signature.length !== expectedSignature.length || !crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature))) return null;
  try {
    const session = JSON.parse(base64UrlDecode(payload));
    return session.expiresAt > Math.floor(Date.now() / 1000) ? session : null;
  } catch (_) {
    return null;
  }
}

function csrfToken(session) {
  return base64Url(crypto.createHmac('sha256', getSecret()).update(`csrf:${session.nonce}`).digest());
}

async function requireAdmin(req, res, next) {
  try {
    const cookies = parseCookies(req.headers.cookie);
    const session = readSession(cookies[SESSION_COOKIE]);
    if (!session || !isDbReady()) return res.redirect('/admin/login');
    const user = await AdminUser.findById(session.userId).lean();
    if (!user || !user.isActive) return res.redirect('/admin/login');
    if (user.mustChangePassword && req.path !== '/admin/change-password' && req.path !== '/admin/logout') {
      return res.redirect('/admin/change-password');
    }
    req.adminUser = user;
    req.adminSession = session;
    res.locals.adminUser = user;
    res.locals.csrfToken = csrfToken(session);
    return next();
  } catch (error) {
    return next(error);
  }
}

function requireCsrf(req, res, next) {
  if (!req.adminSession || req.body?._csrf !== csrfToken(req.adminSession)) {
    return res.status(403).render('pages/admin-error', { layout: 'admin', pageTitle: 'Ошибка безопасности', message: 'Сессия устарела. Обновите страницу и повторите действие.' });
  }
  return next();
}

function setSessionCookie(req, res, user) {
  res.cookie(SESSION_COOKIE, createSession(user), {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: SESSION_TTL_SECONDS * 1000,
    path: '/admin',
  });
}

function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, { path: '/admin' });
}

module.exports = {
  SESSION_COOKIE,
  createPasswordHash,
  verifyPassword,
  DEFAULT_PASSWORD,
  ensureInitialAdmin,
  requireAdmin,
  requireCsrf,
  setSessionCookie,
  clearSessionCookie,
};
