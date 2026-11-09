'use strict';

// Единые алерты донатов: док для OBS (по токену) и настройки в админке.
const express = require('express');
const config = require('../config');
const { getAlerts } = require('../services/alerts');
const { SECRET_FIELDS } = require('../services/alerts/alertSettings.service');
const { tokensEqual, safeJson } = require('./music.routes');

const DOCK_CSP = [
  "default-src 'self' 'unsafe-inline' data:",
  "script-src 'self' 'unsafe-inline'",
  'connect-src *',
  'img-src * data:',
  "style-src 'self' 'unsafe-inline'",
].join('; ');

const STATE_LABELS = { connected: 'подключён', connecting: 'подключается', error: 'ошибка', off: 'режим выключен', disabled: 'выключен' };

function publicBase(req) {
  if (config.SITE_PUBLIC_URL) return config.SITE_PUBLIC_URL.replace(/\/+$/, '');
  const host = req.get('x-forwarded-host') || req.get('host');
  const proto = req.get('x-forwarded-proto') || req.protocol;
  return `${proto}://${host}`;
}

function createAlertsRouter({ requireAdmin, requireCsrf, adminPage }) {
  const router = express.Router();
  const json = express.json({ limit: '8kb' });
  const form = express.urlencoded({ extended: false, limit: '16kb' });

  function requireDockToken(req, res, next) {
    const provided = req.get('x-alerts-token') || req.query.token || req.body?.token;
    if (!tokensEqual(provided, getAlerts().store.get().dockToken)) {
      if (req.method === 'GET' && !req.path.startsWith('/api/')) return res.status(404).send('Not found');
      return res.status(401).json({ ok: false, message: 'Неверный токен' });
    }
    return next();
  }

  // ---------- док OBS ----------
  router.get('/alerts/dock', requireDockToken, (req, res) => {
    res.set('Content-Security-Policy', DOCK_CSP);
    res.removeHeader('X-Frame-Options');
    res.render('pages/alerts-dock', { layout: false, tokenJson: safeJson(String(req.query.token || '')) });
  });

  router.get('/api/alerts/state', requireDockToken, (req, res) => {
    res.set('Cache-Control', 'no-store');
    res.json({ ok: true, state: getAlerts().state() });
  });

  router.post('/api/alerts/control', json, requireDockToken, (req, res) => {
    try {
      const { action, ...value } = req.body || {};
      const result = getAlerts().control(String(action || ''), value);
      res.json({ ok: Boolean(result), state: getAlerts().state() });
    } catch (error) {
      res.status(400).json({ ok: false, message: error.message });
    }
  });

  // ---------- админка ----------
  function render(req, res) {
    const alerts = getAlerts();
    const settings = alerts.store.get();
    const state = alerts.state();
    res.render('pages/admin-alerts', adminPage('alerts', {
      pageTitle: 'Админка — алерты донатов',
      settings: {
        enabled: settings.enabled,
        daTtsMinRub: settings.daTtsMinRub,
        configured: Object.fromEntries(SECRET_FIELDS.map((key) => [key, Boolean(settings.secrets[key])])),
      },
      services: state.services.map((service) => ({ ...service, stateLabel: STATE_LABELS[service.state] || service.state })),
      seConfig: state.seConfig,
      dockUrl: `${publicBase(req)}/alerts/dock?token=${encodeURIComponent(settings.dockToken)}`,
      overlayPath: 'obs/alerts/index.html',
      success: req.query.success || null,
      error: req.query.error || null,
    }));
  }

  router.get('/admin/alerts', requireAdmin, render);

  router.post('/admin/alerts', form, requireAdmin, requireCsrf, (req, res) => {
    try {
      const alerts = getAlerts();
      const current = alerts.store.get();
      const min = Number(String(req.body.daTtsMinRub ?? '').replace(',', '.'));
      alerts.store.save({ ...current, enabled: req.body.enabled === 'on', daTtsMinRub: Number.isFinite(min) && min >= 0 ? min : current.daTtsMinRub });
      for (const key of SECRET_FIELDS) {
        const value = String(req.body[key] || '').trim();
        if (value) alerts.store.setSecret(key, value);
        else if (req.body[`clear_${key}`] === 'on') alerts.store.setSecret(key, '');
      }
      alerts.refreshTipConfig();
      alerts.sync();
      return res.redirect('/admin/alerts?success=Сохранено');
    } catch (error) {
      return res.redirect(`/admin/alerts?error=${encodeURIComponent(error.message)}`);
    }
  });

  router.post('/admin/alerts/regenerate-dock', form, requireAdmin, requireCsrf, (req, res) => {
    getAlerts().store.regenerateDockToken();
    return res.redirect('/admin/alerts?success=Ссылка+дока+перевыпущена+—+обновите+док+в+OBS');
  });

  return router;
}

module.exports = { createAlertsRouter };
