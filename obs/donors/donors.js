// Лучший донатер дня и месяца: две строки светодиодным шрифтом двора, без рамки.
// Строка видна, только когда есть донаты. Выравнивание и размер — в config.js или в адресе: #align=right&scale=3 (#demo — проверка).
(function (D) {
  'use strict';

  const params = new URLSearchParams(location.hash.slice(1));
  const config = D.config || {};
  const align = params.get('align') || config.align || 'left';
  const scale = Math.max(1, Math.min(8, Number(params.get('scale') || config.scale) || 4));
  const labels = Object.assign({ day: 'ДОНАТЕР ДНЯ', month: 'ДОНАТЕР МЕСЯЦА' }, config.labels);
  const maxName = config.maxName || 16;

  const COLOR = { label: '#b08a48', name: '#e8c46a', sum: '#ffe08a', flash: '#fff6d8', edge: '#14111c' };
  const ROW_H = 12; const PAD = 2;

  const canvas = document.getElementById('donors');
  const ctx = canvas.getContext('2d');
  const W = Math.floor(window.innerWidth / scale) || 240;
  canvas.width = W; canvas.height = PAD * 2 + ROW_H * 2;
  canvas.style.width = `${W * scale}px`; canvas.style.height = `${canvas.height * scale}px`;

  const width = (str) => Math.max(0, D.led.columns(str).length - 1);
  function money(rub) {
    if (rub < 10000) return `${rub}₽`;
    if (rub < 100000) return `${(Math.round(rub / 100) / 10).toString().replace('.', ',')}К₽`;
    return `${Math.round(rub / 1000)}К₽`;
  }
  function shorten(name) {
    const clean = String(name || '?').trim();
    return clean.length > maxName ? `${clean.slice(0, maxName - 1)}.` : clean;
  }

  // Буквы с тёмной обводкой и тенью — читаются на любом фоне (небо, игра, вебка).
  function text(str, x, y, color) {
    const cols = D.led.columns(str);
    const on = (c, r) => c >= 0 && c < cols.length && r >= 0 && r < 7 && (cols[c] & (1 << r));
    ctx.fillStyle = COLOR.edge;
    for (let c = -1; c <= cols.length; c += 1) {
      for (let r = -1; r <= 8; r += 1) {
        if (on(c, r)) continue;
        if (on(c - 1, r) || on(c + 1, r) || on(c, r - 1) || on(c, r + 1) || on(c - 1, r - 1) || on(c - 1, r + 1) || on(c + 1, r - 1) || on(c + 1, r + 1) || on(c - 1, r - 2) || on(c - 2, r - 2)) ctx.fillRect(x + c, y + r, 1, 1);
      }
    }
    ctx.fillStyle = color;
    cols.forEach((bits, c) => { for (let r = 0; r < 7; r += 1) if (bits & (1 << r)) ctx.fillRect(x + c, y + r, 1, 1); });
  }

  const state = { day: null, month: null };
  const sig = { day: '', month: '' };
  const flash = { day: 0, month: 0 };
  let loaded = false;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    const rows = ['day', 'month'].filter((key) => state[key]).map((key) => ({
      key, label: labels[key], name: shorten(state[key].name).toUpperCase(), sum: money(state[key].amount),
    }));
    canvas.style.opacity = rows.length ? '1' : '0';
    if (!rows.length) return;
    // колонки: подписи, имена и суммы выровнены между строками
    const labelW = Math.max(...rows.map((r) => width(r.label)));
    const nameW = Math.max(...rows.map((r) => width(r.name)));
    const sumW = Math.max(...rows.map((r) => width(r.sum)));
    const blockW = labelW + 6 + nameW + 6 + sumW;
    const x0 = align === 'right' ? W - PAD - blockW : align === 'center' ? Math.floor((W - blockW) / 2) : PAD;
    rows.forEach((row, i) => {
      const y = PAD + i * ROW_H + 1;
      const lit = flash[row.key] > 0 && Math.floor(flash[row.key] / 4) % 2 === 0;
      text(row.label, x0, y, lit ? COLOR.flash : COLOR.label);
      text(row.name, x0 + labelW + 6, y, lit ? COLOR.flash : COLOR.name);
      text(row.sum, x0 + labelW + 6 + nameW + 6 + sumW - width(row.sum), y, lit ? COLOR.flash : COLOR.sum);
    });
  }

  function setTop(top) {
    for (const key of ['day', 'month']) {
      const item = top && top[key] && Number(top[key].amount) > 0
        ? { name: String(top[key].name || '?'), amount: Math.round(Number(top[key].amount)) } : null;
      const next = item ? `${item.name.toLowerCase()}|${item.amount}` : '';
      if (loaded && next && next !== sig[key]) flash[key] = 48;
      sig[key] = next;
      state[key] = item;
    }
    loaded = true;
  }

  setInterval(() => {
    if (flash.day > 0) flash.day -= 1;
    if (flash.month > 0) flash.month -= 1;
    draw();
  }, 66);

  let bot = null;
  const ask = () => { if (bot) bot.send({ type: 'donations:top' }); };
  setInterval(ask, 30000);
  window.addEventListener('obsSourceActiveChanged', (event) => { if (event.detail && event.detail.active) ask(); });

  if (params.has('demo')) {
    setTop({ day: null, month: { name: 'Shrek_Na_Raione', amount: 12500 } });
    setTimeout(() => setTop({ day: { name: 'pelmen', amount: 2000 }, month: { name: 'Shrek_Na_Raione', amount: 14500 } }), 3000);
  } else {
    bot = D.connectBot({ onOpen: ask, onMessage: (data) => { if (data.type === 'donations:top') setTop(data.top); } });
  }
})(window.Dvor);
