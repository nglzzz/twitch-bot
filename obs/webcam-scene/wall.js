// Стена хрущёвки за камерой и «Доска почёта» под чат.
(function (D) {
  'use strict';
  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  const W = 640; const H = 360;
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  let seed = 5;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const dither = (x, y, w, h, c, d) => {
    ctx.fillStyle = c;
    for (let yy = y; yy < y + h; yy += 1) for (let xx = x; xx < x + w; xx += 1) if (BAYER[(yy & 3) * 4 + (xx & 3)] / 16 < d) ctx.fillRect(xx, yy, 1, 1);
  };

  function wall() {
    rect(0, 0, W, H, '#67656e');
    // вечерний холод сверху, тёплый отсвет снизу — дизерингом, без градиентов
    dither(0, 0, W, 40, '#5c5a66', 0.5);
    dither(0, 40, W, 40, '#5c5a66', 0.25);
    // панели и швы
    for (let y = 2; y < H; y += 70) { rect(0, y, W, 1, '#53515a'); rect(0, y + 1, W, 1, '#75737c'); }
    for (let x = 98; x < W; x += 132) for (let y = 2; y < H; y += 70) { rect(x + ((y / 70) % 2) * 20, y, 1, 70, '#53515a'); }
    for (let i = 0; i < 26; i += 1) dither(Math.floor(rnd() * W), Math.floor(rnd() * H), 1 + Math.floor(rnd() * 2), 6 + Math.floor(rnd() * 20), '#5a5861', 0.5);
  }

  // Доска почёта: деревянная рама, бордовый бархат, звезда сверху.
  // Доска слева (под чат), окно с камерой справа. Для зеркального варианта: x: 487.
  const BOARD = { x: 2, y: 10, w: 151, h: 270 };
  function board() {
    const { x, y, w, h } = BOARD;
    rect(x - 1, y - 1, w + 2, h + 2, '#14111c');
    rect(x, y, w, h, '#4a2c1a');
    rect(x, y, w, 1, '#7a4c2c'); rect(x, y, 1, h, '#6a4228');
    rect(x + 5, y + 5, w - 10, h - 10, '#14111c');
    rect(x + 6, y + 6, w - 12, h - 12, '#4a1a1e');
    dither(x + 6, y + 6, w - 12, h - 12, '#3e1518', 0.5);
    // табличка
    rect(x + 12, y + 12, w - 24, 17, '#2e1a10');
    rect(x + 12, y + 12, w - 24, 1, '#5a3a24');
    const cols = D.led.columns('ДОСКА ПОЧЁТА');
    const tx = x + Math.floor((w - cols.length) / 2); const ty = y + 17;
    cols.forEach((bits, c) => {
      for (let r = 0; r < 7; r += 1) {
        if (!(bits & (1 << r))) continue;
        rect(tx + c + 1, ty + r + 1, 1, 1, '#1a0e08');
        rect(tx + c, ty + r, 1, 1, '#d9b25a');
      }
    });
    // звезда над доской
    const star = ['.....#.....', '....###....', '....###....', '###########', '.#########.', '..#######..', '..###.###..', '.###...###.', '.##.....##.'];
    const sx = x + Math.floor(w / 2) - 5; const sy = y - 7;
    star.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch === '#') rect(sx + rx, sy + ry, 1, 1, ry < 3 ? '#e04a3a' : '#c8322c'); }));
    rect(sx + 5, sy + 1, 1, 1, '#ff8a6a');
    // кнопки-гвоздики по углам бархата
    for (const [cx, cy] of [[x + 9, y + 34], [x + w - 10, y + 34], [x + 9, y + h - 10], [x + w - 10, y + h - 10]]) rect(cx, cy, 1, 1, '#c9a24a');
  }

  // Таблички «лучший донатер дня / месяца» между заголовком и чатом.
  const PLATE = { x: BOARD.x + 8, w: BOARD.w - 16, h: 13, ys: [BOARD.y + 37, BOARD.y + 52] };
  const LABEL_W = 29; // «МЕСЯЦ» — 5 знаков по 6 px без последнего зазора
  const COLOR = { label: '#9a7a3e', name: '#d9b25a', sum: '#f2d27a', empty: '#6e5a36', flash: '#fff2c4', shadow: '#1a0e08' };
  const top = { day: undefined, month: undefined };
  const rows = [
    { key: 'day', label: 'ДЕНЬ', shift: 0, dir: 1, wait: 60, flash: 0, sig: '' },
    { key: 'month', label: 'МЕСЯЦ', shift: 0, dir: 1, wait: 60, flash: 0, sig: '' },
  ];

  function plates() {
    for (const y of PLATE.ys) {
      rect(PLATE.x - 1, y - 1, PLATE.w + 2, PLATE.h + 2, '#14111c');
      rect(PLATE.x, y, PLATE.w, PLATE.h, '#2e1a10');
      rect(PLATE.x, y, PLATE.w, 1, '#5a3a24');
      rect(PLATE.x, y + PLATE.h - 1, PLATE.w, 1, '#24140c');
    }
  }

  function text(str, x, y, color, from = -Infinity, to = Infinity) {
    D.led.columns(str).forEach((bits, c) => {
      const cx = x + c;
      if (cx < from || cx + 1 > to) return;
      for (let r = 0; r < 7; r += 1) {
        if (!(bits & (1 << r))) continue;
        rect(cx + 1, y + r + 1, 1, 1, COLOR.shadow);
        rect(cx, y + r, 1, 1, color);
      }
    });
  }
  const width = (str) => Math.max(0, D.led.columns(str).length - 1);

  function money(rub) {
    if (rub < 10000) return `${rub}₽`;
    if (rub < 100000) return `${(Math.round(rub / 100) / 10).toString().replace('.', ',')}К₽`;
    return `${Math.round(rub / 1000)}К₽`;
  }

  function drawRow(row, y) {
    const entry = top[row.key];
    const left = PLATE.x + 4; const right = PLATE.x + PLATE.w - 4; const ty = y + 3;
    const lit = row.flash > 0 && Math.floor(row.flash / 4) % 2 === 0;
    text(row.label, left, ty, lit ? COLOR.flash : COLOR.label);
    const nameX = left + LABEL_W + 5;
    if (entry === undefined) return;
    if (!entry) { text('ЖДЁТ ГЕРОЯ', nameX, ty, COLOR.empty); return; }
    const sum = money(entry.amount);
    const sumX = right - width(sum);
    text(sum, sumX, ty, lit ? COLOR.flash : COLOR.sum);
    // длинное имя медленно едет внутри своего места, с паузами по краям
    const room = sumX - 5 - nameX;
    const over = width(entry.name) - room;
    if (over <= 0) row.shift = 0;
    else if (row.wait > 0) row.wait -= 1;
    else {
      row.shift += 0.5 * row.dir;
      if (row.shift >= over) { row.shift = over; row.dir = -1; row.wait = 45; }
      if (row.shift <= 0) { row.shift = 0; row.dir = 1; row.wait = 60; }
    }
    text(entry.name, nameX - Math.floor(row.shift), ty, lit ? COLOR.flash : COLOR.name, nameX, nameX + room);
    if (row.flash > 0) row.flash -= 1;
  }

  D.setDonationTop = (data) => {
    for (const row of rows) {
      const entry = data && data[row.key] ? { name: String(data[row.key].name || '?').slice(0, 40), amount: Math.max(0, Math.round(Number(data[row.key].amount) || 0)) } : null;
      const sig = entry ? `${entry.name.toLowerCase()}|${entry.amount}` : '';
      // мигаем, когда сменился лидер или выросла сумма (но не при первой загрузке)
      if (top[row.key] !== undefined && sig && sig !== row.sig) row.flash = 48;
      if (sig !== row.sig) { row.shift = 0; row.dir = 1; row.wait = 60; }
      row.sig = sig;
      top[row.key] = entry;
    }
  };

  // Звезда тихо мерцает, иначе стена мертва.
  let t = 0;
  function frame() {
    t += 1;
    const glow = 0.5 + 0.5 * Math.sin(t / 18);
    ctx.drawImage(still, 0, 0);
    ctx.globalAlpha = 0.12 * glow;
    rect(BOARD.x + BOARD.w / 2 - 9, 0, 18, 12, '#ff6a4a');
    ctx.globalAlpha = 1;
    rows.forEach((row, i) => drawRow(row, PLATE.ys[i]));
  }

  wall(); board(); plates();
  const still = document.createElement('canvas');
  still.width = W; still.height = H;
  still.getContext('2d').drawImage(canvas, 0, 0);
  setInterval(frame, 66);

  // Данные от бота: при подключении, раз в 30 секунд и когда сцену показывают.
  const config = D.config || {};
  let socket = null;
  const ask = () => { if (socket && socket.readyState === 1) socket.send(JSON.stringify({ type: 'donations:top' })); };
  setInterval(ask, 30000);
  window.addEventListener('obsSourceActiveChanged', (event) => { if (event.detail && event.detail.active) ask(); });
  if (location.hash.includes('demo')) {
    D.setDonationTop({ day: { name: 'Krolik_Bandit', amount: 1500 }, month: { name: 'Shrek_Na_Raione', amount: 12500 } });
    setTimeout(() => D.setDonationTop({ day: { name: 'pelmen', amount: 2000 }, month: { name: 'Shrek_Na_Raione', amount: 14000 } }), 4000);
  } else if (config.websocket) {
    let delay = 1000;
    const open = () => {
      let ws;
      try { ws = new WebSocket(config.websocket); } catch (e) { setTimeout(open, delay); return; }
      socket = ws;
      ws.onopen = () => { delay = 1000; ask(); };
      ws.onclose = () => { setTimeout(open, delay); delay = Math.min(delay * 2, 15000); };
      ws.onmessage = (event) => {
        let data;
        try { data = JSON.parse(event.data); } catch (e) { return; }
        if (data && data.type === 'donations:top') D.setDonationTop(data.top);
      };
    };
    open();
  }
})(window.Dvor);
