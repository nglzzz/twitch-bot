const test = require('node:test');
const assert = require('node:assert/strict');
const { fromDonationAlerts, fromStreamElements, fromDonatePay, fromDonatex } = require('../src/services/alerts/normalize');
const { extractTipConfig, pickView, renderTitle, seSpeechUrl, parseOverlayUrl } = require('../src/services/alerts/seAlertConfig');
const { createAlertHub } = require('../src/services/alerts/alertHub');

const DA = {
  id: 188335993, alert_type: 1, additional_data: '{"randomness":426,"is_commission_covered":1}', username: 'flxx', amount: 50,
  amount_main: 50, currency: 'RUB', message: 'премия пришла', tts_url: 'https://files.donationalerts.com/da/speechsynthesis/188335/e9.wav',
  _is_test_alert: false, message_type: 'text',
};

test('DonationAlerts: ruble amount, heart for covered fee, native TTS file', () => {
  const d = fromDonationAlerts(JSON.stringify(DA), { ttsMinRub: 25 });
  assert.equal(d.name, '❤️ flxx');
  assert.equal(d.amount, 50);
  assert.deepEqual(d.media, [{ kind: 'tts', url: DA.tts_url }]);
  assert.equal(fromDonationAlerts({ ...DA, amount: 10, amount_main: 10 }, { ttsMinRub: 25 }).media.length, 0);
  assert.equal(fromDonationAlerts({ ...DA, alert_type: 4 }), null);
  const usd = fromDonationAlerts({ ...DA, currency: 'USD', amount: 2, amount_main: 180 });
  assert.equal(usd.currency, 'RUB');
  assert.equal(usd.amount, 180);
});

test('StreamElements tip from astro activity', () => {
  const d = fromStreamElements({ type: 'tip', provider: 'twitch', data: { amount: 111, currency: 'RUB', username: 'Тест', tipId: 't1', message: 'ТЕЕЕСТ' } });
  assert.equal(d.externalId, 't1');
  assert.deepEqual(d.media, [{ kind: 'se-tts' }]);
  assert.equal(fromStreamElements({ type: 'follower', data: {} }), null);
});

test('DonatePay builds their voice link the way their widget does', () => {
  const ctx = { widgetsToken: 'TOK', voiceSum: 25, allowPremium: true, widgets: { '#4702183': { 'a_s.speed': 'medium', 'a_s.play': '1' } } };
  const pub = { widgetId: 4702183, notification: { id: 77, type: 'donation', vars: { name: 'Петя', sum: '150.00', comment: 'привет', premiumSettings: { voice: 'v', speed: 's', emotion: 'e' } } } };
  const d = fromDonatePay(pub, ctx);
  assert.equal(d.amount, 150);
  const url = new URL(d.media[0].url);
  assert.equal(url.pathname, '/donation/notifications/widget/TOK/voice');
  assert.equal(url.searchParams.get('text'), encodeURIComponent(' привет'));
  assert.equal(url.searchParams.get('widget_id'), '4702183');
  assert.equal(url.searchParams.get('premium_voice'), 'v');
  assert.equal(fromDonatePay({ ...pub, notification: { ...pub.notification, vars: { ...pub.notification.vars, sum: 10 } } }, ctx).media.length, 0);
  assert.equal(fromDonatePay({ data: pub }, ctx).externalId, '77');
});

test('DonatePay paid picture and effect follow the streamer settings like their widget', () => {
  const widgets = { '#1': { 'a_m.active': '1', 'a_m.min_sum': '1', 'a_s.play': '1' } };
  const pub = (premiumSettings) => ({ widgetId: 1, notification: { id: 5, type: 'donation', vars: { name: 'Петя', sum: 300, comment: 'hi', premiumSettings } } });
  const ctx = { base: 'https://widget.donatepay.ru', widgets, allowPremium: true, premiumImageType: '1' };
  assert.deepEqual(fromDonatePay(pub({ image: '/uploads/p/1.png', effect: 'HeartUp' }), ctx).premium,
    { image: 'https://widget.donatepay.ru/uploads/p/1.png', imageMode: 'preview', effect: 'HeartUp' });
  assert.equal(fromDonatePay(pub({ image: 'a.png', giphy: 'https://media.giphy.com/x.gif' }), { ...ctx, premiumImageType: '2' }).premium.image, 'https://media.giphy.com/x.gif');
  assert.equal(fromDonatePay(pub({ image: 'a.png', giphy: 'https://media.giphy.com/x.gif' }), { ...ctx, premiumImageType: '2' }).premium.imageMode, 'replace');
  // премиум выключен — картинки нет, а эффект их виджет всё равно показывает
  assert.deepEqual(fromDonatePay(pub({ image: 'a.png', effect: 'KappaUp' }), { ...ctx, allowPremium: false }).premium, { image: null, imageMode: null, effect: 'KappaUp' });
  assert.equal(fromDonatePay(pub({ effect: 'Unknown' }), ctx).premium, null);
  assert.equal(fromDonatePay(pub(undefined), ctx).premium, null);
});

test('DonatePay as it really arrives: vars as a JSON string, widget picked by amount, test without id', () => {
  const ctx = { widgetsToken: 'TOK', voiceSum: 25, widgets: {
    '#2611037': { 'a_m.active': '0', 'a_m.min_sum': '1', 'a_s.play': '1' },
    '#4702183': { 'a_m.active': '1', 'a_m.min_sum': '3', 'a_s.play': '1', 'a_s.speed': 'medium' },
  } };
  const pub = (vars, id) => ({ notification: { type: 'donation', user_id: 675066, ...(id ? { id } : {}), vars: JSON.stringify(vars) } });
  const test1 = fromDonatePay(pub({ name: 'DonatePay', comment: 'цитата', sum: 1 }), ctx);
  assert.equal(test1.isTest, true);
  assert.equal(test1.amount, 1);
  // тест озвучивается всегда, даже ниже порога и без подходящего по сумме виджета
  assert.equal(new URL(test1.media[0].url).searchParams.get('widget_id'), '4702183');
  const small = fromDonatePay(pub({ name: 'Петя', comment: 'мало', sum: 10 }, 556), ctx);
  assert.equal(small.media.length, 0);
  const real = fromDonatePay(pub({ name: 'Вася', comment: 'привет', sum: 300 }, 555), ctx);
  assert.equal(real.isTest, false);
  assert.equal(real.externalId, '555');
  assert.equal(new URL(real.media[0].url).searchParams.get('widget_id'), '4702183');
});

test('Donatex: TTS file, voice message wins, AI answer after it', () => {
  const base = { id: 'x1', username: 'Аноним', message: 'Это тестовый донат!', currency: 'RUB', amount: 50, voiceFilePath: 'https://cdn.donatex.gg/default-donation-voices/x1.mp3' };
  assert.deepEqual(fromDonatex(base).media, [{ kind: 'tts', url: base.voiceFilePath }]);
  assert.equal(fromDonatex({ ...base, username: 'Аноним тест' }).isTest, true);
  assert.equal(fromDonatex(base).isTest, false);
  const withVoice = fromDonatex({ ...base, voiceMessagePath: 'voice/1.mp3', withAIResponse: true, aiResponseVoiceFilePath: 'ai/1.mp3' });
  assert.deepEqual(withVoice.media.map((m) => m.kind), ['voice', 'ai']);
  assert.equal(withVoice.media[0].url, 'https://cdn.donatex.gg/voice/1.mp3');
  const aiNoPath = fromDonatex({ ...base, withAIResponse: true });
  assert.deepEqual(aiNoPath.media[1], { kind: 'ai', url: 'https://cdn.donatex.gg/aiassistant-widgets/sounds/x1.mp3', wait: true });
  assert.equal(fromDonatex({ ...base, isRefunded: true }), null);
});

const BOOT = {
  overlay: {
    widgets: [
      { type: 'se-widget-kappagen', listeners: { 'tip-latest': true }, variables: {} },
      {
        type: 'se-widget-alert-box', listeners: { 'tip-latest': true }, css: { width: '1034.79px', height: '774.65px' },
        variables: {
          tip: {
            enableRandomPick: true, duration: 7.8, layout: 'column', showMessage: true,
            graphics: { src: 'base.mp4', type: 'video', volume: 1 }, audio: { src: null },
            tts: { enabled: true, voice: 'Tatyana', volume: 0.75, minAmount: 10, announceAction: true },
            text: { message: '{name} занёс {currency}{amount} стримеру!', css: { 'font-size': 30, highlights: { color: 'rgb(106, 111, 252)' }, message: { 'font-size': 16 } } },
            variations: [
              { name: 'A200', condition: 'ATLEAST', requirement: 200, chance: 100, type: 'amount', settings: { graphics: { src: 'a.mp4', type: 'video' }, duration: 15 } },
              { name: 'B300', condition: 'ATLEAST', requirement: 300, chance: 100, type: 'tip', settings: { graphics: { src: 'b.mp4', type: 'video' } } },
              { name: 'C300', condition: 'ATLEAST', requirement: 300, chance: 100, type: 'tip', settings: { graphics: { src: 'c.mp4', type: 'video' } } },
              { name: 'Nice', condition: 'EXACT', requirement: 69, chance: 100, type: 'tip', settings: {} },
              { name: 'Off', condition: 'ATLEAST', requirement: 100, enabled: false, settings: {} },
            ],
          },
        },
      },
    ],
  },
};

test('SE config: base, thresholds, exact match, random among equal thresholds', () => {
  const cfg = extractTipConfig(BOOT);
  assert.equal(cfg.variations.length, 4);
  assert.equal(Math.round(cfg.box.width), 1035);
  assert.equal(pickView(cfg, 50).name, '');
  assert.equal(pickView(cfg, 69).name, 'Nice');
  assert.equal(pickView(cfg, 250).name, 'A200');
  assert.equal(pickView(cfg, 250).view.duration, 15);
  assert.equal(pickView(cfg, 250).view.tts.voice, 'Tatyana');
  assert.equal(pickView(cfg, 400, () => 0.1).name, 'B300');
  assert.equal(pickView(cfg, 400, () => 0.9).name, 'C300');
});

test('title parts highlight name and amount; SE speech reads title and message', () => {
  const parts = renderTitle('{name} занёс {currency}{amount} стримеру!', { name: 'Тест', amount: 111, currency: 'RUB' });
  assert.deepEqual(parts, [{ text: 'Тест', hl: true }, { text: ' занёс ' }, { text: '₽111', hl: true }, { text: ' стримеру!' }]);
  const cfg = extractTipConfig(BOOT);
  const url = new URL(seSpeechUrl({ view: cfg.base, titleText: 'Тест занёс ₽111 стримеру!', message: 'ТЕЕЕСТ', apiKey: 'K' }));
  assert.equal(url.searchParams.get('text'), 'Тест занёс ₽111 стримеру!, ТЕЕЕСТ');
  assert.equal(url.searchParams.get('voice'), 'Tatyana');
  assert.deepEqual(parseOverlayUrl('https://streamelements.com/overlay/5fe31d38de4c33e3028cd76e/baoy_PrJNOPuCrkUttQfbVFduKYhOr6_B2ZGWW8DpJqWK_sZ'), { overlayId: '5fe31d38de4c33e3028cd76e', apiKey: 'baoy_PrJNOPuCrkUttQfbVFduKYhOr6_B2ZGWW8DpJqWK_sZ' });
});

function fakeWs() {
  return { readyState: 1, sent: [], send(raw) { this.sent.push(JSON.parse(raw)); } };
}

function makeHub(extra = {}) {
  let t = 1000;
  const timers = [];
  const hub = createAlertHub({
    getTipConfig: () => extractTipConfig(BOOT),
    getSeApiKey: () => 'K',
    now: () => t,
    setTimer: (fn) => { timers.push(fn); return timers.length; },
    clearTimer: () => {},
    ...extra,
  });
  return { hub, tick: (ms) => { t += ms; }, timers };
}

const donation = (over = {}) => ({ source: 'donatex', externalId: 'd1', name: 'Аня', amount: 300, currency: 'RUB', message: 'hi', media: [{ kind: 'tts', url: 'u' }], ...over });

test('hub plays one alert at a time and waits for the overlay', () => {
  const { hub } = makeHub();
  hub.ingest(donation());
  hub.ingest(donation({ externalId: 'd2' }));
  assert.equal(hub.state().queue.length, 2);
  const ws = fakeWs();
  hub.attachOverlay(ws);
  const play = ws.sent.find((m) => m.type === 'alerts:play');
  assert.equal(play.alert.name, 'Аня');
  assert.equal(hub.state().queue.length, 1);
  hub.finish(play.alert.id);
  assert.equal(ws.sent.filter((m) => m.type === 'alerts:play').length, 2);
  assert.equal(hub.state().history.length, 1);
});

test('hub drops repeats, disabled services and SE echoes of imported donations', () => {
  const disabled = new Set(['donatepay']);
  const { hub } = makeHub({ isServiceEnabled: (s) => !disabled.has(s) });
  assert.ok(hub.ingest(donation({ source: 'donationalerts', externalId: '5', name: '❤️ Тест', amount: 111 })));
  assert.equal(hub.ingest(donation({ source: 'donationalerts', externalId: '5' })), null);
  assert.equal(hub.ingest(donation({ source: 'streamelements', externalId: 'se1', name: 'Тест', amount: 111, media: [{ kind: 'se-tts' }] })), null);
  assert.equal(hub.ingest(donation({ source: 'donatepay', externalId: '9' })), null);
  const se = hub.ingest(donation({ source: 'streamelements', externalId: 'se2', name: 'Боб', amount: 500, message: 'йо', media: [{ kind: 'se-tts' }] }));
  assert.equal(se.media[0].kind, 'tts');
  assert.match(se.media[0].url, /speech\?voice=Tatyana/);
});

test('hub keeps the current alert when the source reloads, pauses and replays', () => {
  const { hub } = makeHub();
  const ws = fakeWs();
  hub.attachOverlay(ws);
  hub.ingest(donation());
  const first = hub.state().current.id;
  hub.detachOverlay(ws);
  assert.equal(hub.state().current, null);
  assert.equal(hub.state().queue[0].id, first);
  hub.setPaused(true);
  const ws2 = fakeWs();
  hub.attachOverlay(ws2);
  assert.equal(hub.state().current, null);
  hub.setPaused(false);
  assert.equal(hub.state().current.id, first);
  hub.skip();
  assert.ok(ws2.sent.some((m) => m.type === 'alerts:stop' && m.id === first));
  const again = hub.replay();
  assert.equal(again.name, 'Аня');
  assert.equal(hub.state().current.id, again.id);
});

test('a donation still being prepared already hides its SE echo', () => {
  const { hub } = makeHub();
  hub.expect({ source: 'donationalerts', name: '❤️ Тест', amount: 111 });
  assert.equal(hub.ingest(donation({ source: 'streamelements', externalId: 'se9', name: 'Тест', amount: 111, media: [{ kind: 'se-tts' }] })), null);
});

test('DA and DonatePay sounds are downloaded by the bot, others stay links', async () => {
  const { embedMedia } = require('../src/services/alerts/embed');
  const riff = Buffer.from('ID3\u0004\u0000\u0000\u0000\u0000\u0000"TSSE', 'latin1'); // DA: MP3 под именем .wav
  const http = { get: async (url) => ({ headers: { 'content-type': url.includes('donatepay') ? 'audio/mpeg' : 'application/octet-stream' }, data: riff }) };
  const out = await embedMedia({ media: [
    { kind: 'tts', url: 'https://files.donationalerts.com/da/speechsynthesis/1/a.wav' },
    { kind: 'tts', url: 'https://widget.donatepay.ru/donation/notifications/widget/T/voice?text=x' },
    { kind: 'tts', url: 'https://cdn.donatex.gg/v.mp3' },
  ] }, { http, log: { warn() {} } });
  assert.match(out.media[0].url, /^data:audio\/mpeg;base64,/);
  assert.match(out.media[1].url, /^data:audio\/mpeg;base64,/);
  assert.match(out.media[2].url, /^data:audio\/mpeg;base64,/);
});

test('Donatex AI answer: the bot waits until the file appears, then gives up', async () => {
  const { embedMedia } = require('../src/services/alerts/embed');
  const notYet = () => Object.assign(new Error('404'), { response: { status: 404 } });
  let calls = 0;
  const http = { get: async () => { calls += 1; if (calls < 3) throw notYet(); return { headers: { 'content-type': 'audio/mpeg' }, data: Buffer.from('ID3') }; } };
  const opts = { http, log: { warn() {} }, pause: async () => {}, retryMs: 0 };
  const ai = { kind: 'ai', url: 'https://cdn.donatex.gg/aiassistant-widgets/sounds/x1.mp3', wait: true };
  const ready = await embedMedia({ media: [ai] }, opts);
  assert.equal(calls, 3);
  assert.match(ready.media[0].url, /^data:audio\/mpeg;base64,/);
  const never = await embedMedia({ media: [ai] }, { ...opts, http: { get: async () => { throw notYet(); } }, waitMs: 0 });
  assert.equal(never.media[0].broken, true);
  calls = 0;
  const tts = await embedMedia({ media: [{ kind: 'tts', url: 'https://cdn.donatex.gg/v.mp3' }] }, { ...opts, http: { get: async () => { calls += 1; throw notYet(); } } });
  assert.equal(calls, 1, 'only AI answers are waited for');
  assert.equal(tts.media[0].broken, true);
});

test('widget links can be pasted whole', () => {
  const { cleanSecret } = require('../src/services/alerts/alertSettings.service');
  assert.equal(cleanSecret('donatePayToken', 'https://widget.donatepay.ru/alert-box/widget/8fa3f986c1404469646bc87a362fcc19a6ffe8ff00e181252859b3fdfaba8760'), '8fa3f986c1404469646bc87a362fcc19a6ffe8ff00e181252859b3fdfaba8760');
  assert.equal(cleanSecret('donatePayToken', '8fa3f986c1404469'), '8fa3f986c1404469');
  assert.equal(cleanSecret('donatexWidgetId', 'https://donatex.gg/widgets/donations/12c3d1ed-cb7f-4f7c-a60b-0d444324c603?x=1'), '12c3d1ed-cb7f-4f7c-a60b-0d444324c603');
});

test('SE echo is recognised when DA says Аноним and SE says Anonymous', () => {
  const { hub } = makeHub();
  assert.ok(hub.ingest(donation({ source: 'donationalerts', externalId: '77', name: 'Аноним', amount: 100, message: 'привет' })));
  assert.equal(hub.ingest(donation({ source: 'streamelements', externalId: 'se77', name: 'Anonymous', amount: 100, message: 'привет', media: [{ kind: 'se-tts' }] })), null);
  assert.ok(hub.ingest(donation({ source: 'streamelements', externalId: 'se78', name: 'Вася', amount: 100, message: 'другое', media: [{ kind: 'se-tts' }] })));
});

test('SE echo and disabled services are known before the donation is saved (no second music order)', () => {
  const { hub } = makeHub({ isServiceEnabled: (s) => s !== 'donatex' });
  hub.expect(donation({ source: 'donatepay', externalId: '5', name: 'Петя', amount: 300, message: 'https://youtu.be/x' }));
  assert.equal(hub.isIgnored(donation({ source: 'streamelements', externalId: 'se5', name: 'Петя', amount: 300, message: 'https://youtu.be/x' })), true);
  assert.equal(hub.isIgnored(donation({ source: 'streamelements', externalId: 'se6', name: 'Вася', amount: 300, message: 'другое' })), false);
  assert.equal(hub.isIgnored(donation({ source: 'donatex', externalId: '7', name: 'Вася', amount: 50 })), true);
  assert.equal(hub.isIgnored(donation({ source: 'donatepay', externalId: '8', name: 'Вася', amount: 50 })), false);
});

test('DA alert without its own voice is read by the SE voice', () => {
  const d = fromDonationAlerts({ ...DA, tts_url: null, _is_test_alert: true }, { ttsMinRub: 25 });
  assert.deepEqual(d.media, [{ kind: 'se-tts' }]);
});

test('DA repeat from its history plays again after the duplicate window', () => {
  const { hub, tick } = makeHub();
  assert.ok(hub.ingest(donation({ source: 'donationalerts', externalId: 'r1' })));
  tick(5000);
  assert.equal(hub.ingest(donation({ source: 'donationalerts', externalId: 'r1' })), null);
  tick(60000);
  assert.ok(hub.ingest(donation({ source: 'donationalerts', externalId: 'r1' })));
  tick(60000);
  assert.equal(hub.ingest(donation({ source: 'donatex', externalId: 'x1' })) !== null, true);
  tick(60000);
  assert.equal(hub.ingest(donation({ source: 'donatex', externalId: 'x1' })), null);
});

test('a deleted native voice is replaced by the SE voice, and every alert carries an SE fallback', () => {
  const { hub } = makeHub();
  const gone = hub.ingest(donation({ externalId: 'g1', media: [{ kind: 'ai', url: 'https://cdn.donatex.gg/ai.mp3', broken: true }] }));
  assert.equal(gone.media.length, 1);
  assert.equal(gone.media[0].fallback, true);
  assert.match(gone.media[0].url, /api\.streamelements\.com\/kappa\/v2\/speech/);
  assert.equal(gone.fallback, null);
  const ok = hub.ingest(donation({ externalId: 'g2', media: [{ kind: 'tts', url: 'https://cdn.donatex.gg/v.mp3' }] }));
  assert.match(ok.fallback, /speech\?voice=/);
});

test('celebration power grows with the amount and every played alert is announced to the scenes', () => {
  const { powerOf } = require('../src/services/alerts/alertHub');
  assert.deepEqual([50, 100, 300, 999, 1000, 5000].map(powerOf), [1, 2, 3, 3, 4, 5]);
  const played = [];
  const { hub } = makeHub({ onPlay: (item) => played.push(item) });
  hub.attachOverlay(fakeWs());
  hub.ingest(donation({ externalId: 'p1', amount: 1500 }));
  assert.equal(played.length, 1);
  assert.equal(played[0].power, 4);
});
