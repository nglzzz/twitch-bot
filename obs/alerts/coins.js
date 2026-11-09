// Дождь из денег на весь экран, пиксельно, как «Двор»: 640×360, каждый пиксель ×4.
// Сила 1…5 (по сумме доната): копейки → рубли → купюры → золотой ливень.
(function (D) {
  'use strict';

  const W = 640;
  const H = 360;
  const canvas = document.getElementById('coins');
  const ctx = canvas.getContext('2d');
  canvas.width = W;
  canvas.height = H;
  ctx.imageSmoothingEnabled = false;

  const EDGE = '#14111c';
  const METALS = {
    copper: { face: '#c87533', rim: '#7a3f17', shine: '#f0a868' },
    silver: { face: '#cfd6e0', rim: '#6f7886', shine: '#ffffff' },
    gold: { face: '#f2c94a', rim: '#9a6c12', shine: '#fff1b0' },
  };
  // купюры: 100 (зелёно-голубая), 1000 (бирюзовая), 5000 (красно-рыжая)
  const NOTES = [
    { body: '#7fae8a', dark: '#3f6b4c', mark: '#cfe6c4' },
    { body: '#6fb4b0', dark: '#2f6a6a', mark: '#c8ecea' },
    { body: '#d9774f', dark: '#8a3a22', mark: '#f6c3a4' },
  ];
  // что и сколько падает при каждой силе: монеты, купюры, секунды, доля золота
  const POWER = [
    null,
    { coins: 16, notes: 0, seconds: 2, mix: ['copper', 'copper', 'silver'] },
    { coins: 40, notes: 0, seconds: 3, mix: ['copper', 'silver', 'silver', 'gold'] },
    { coins: 80, notes: 6, seconds: 4, mix: ['silver', 'gold', 'gold', 'copper'] },
    { coins: 140, notes: 24, seconds: 5, mix: ['gold', 'gold', 'silver'] },
    { coins: 260, notes: 70, seconds: 6.5, mix: ['gold'] },
  ];

  const bits = [];
  let last = 0;
  let running = false;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];

  function rain(power) {
    const p = POWER[Math.max(1, Math.min(5, Math.round(Number(power) || 1)))];
    const now = performance.now() / 1000;
    for (let i = 0; i < p.coins; i += 1) {
      bits.push({ kind: 'coin', metal: METALS[pick(p.mix)], x: rand(4, W - 8), y: rand(-24, -6), vy: rand(30, 70), vx: rand(-8, 8), at: now + rand(0, p.seconds), spin: rand(0, 4), spinRate: rand(8, 16) });
    }
    for (let i = 0; i < p.notes; i += 1) {
      bits.push({ kind: 'note', look: pick(power >= 5 ? NOTES : NOTES.slice(0, 2)), x: rand(4, W - 14), y: rand(-20, -8), vy: rand(14, 26), vx: 0, at: now + rand(0, p.seconds + 1), phase: rand(0, 6.28), sway: rand(10, 22) });
    }
    if (!running) { running = true; last = now; requestAnimationFrame(loop); }
  }

  function drawCoin(b, t) {
    const frame = Math.floor(b.spin) % 4; // монета вертится: 5 → 3 → 1 → 3 пикселя в ширину
    const w = [5, 3, 1, 3][frame];
    const x = Math.round(b.x + (5 - w) / 2);
    const y = Math.round(b.y);
    const m = b.metal;
    ctx.fillStyle = EDGE;
    ctx.fillRect(x - 1, y, w + 2, 5); ctx.fillRect(x, y - 1, w, 7);
    ctx.fillStyle = m.rim; ctx.fillRect(x, y, w, 5);
    if (w >= 3) { ctx.fillStyle = m.face; ctx.fillRect(x + 1, y + 1, w - 2, 3); }
    if (w === 5 && Math.floor(t * 6 + b.x) % 5 === 0) { ctx.fillStyle = m.shine; ctx.fillRect(x + 1, y + 1, 1, 1); }
  }

  function drawNote(b, t) {
    // купюра планирует и переворачивается: высота 5 → 3 → 1
    const flip = Math.abs(Math.sin(t * 2.2 + b.phase));
    const h = flip > 0.66 ? 5 : flip > 0.33 ? 3 : 1;
    const x = Math.round(b.x);
    const y = Math.round(b.y + (5 - h) / 2);
    const n = b.look;
    ctx.fillStyle = EDGE; ctx.fillRect(x - 1, y - 1, 13, h + 2);
    ctx.fillStyle = n.dark; ctx.fillRect(x, y, 11, h);
    if (h >= 3) {
      ctx.fillStyle = n.body; ctx.fillRect(x + 1, y + 1, 9, h - 2);
      ctx.fillStyle = n.mark; ctx.fillRect(x + 4, y + 1, 3, h - 2);
    }
  }

  function loop() {
    const now = performance.now() / 1000;
    const dt = Math.min(0.05, now - last);
    last = now;
    ctx.clearRect(0, 0, W, H);
    for (let i = bits.length - 1; i >= 0; i -= 1) {
      const b = bits[i];
      if (now < b.at) continue;
      if (b.kind === 'coin') {
        b.vy = Math.min(190, b.vy + 160 * dt);
        b.spin += b.spinRate * dt;
      } else {
        b.vy = Math.min(42, b.vy + 30 * dt);
        b.vx = Math.sin(now * 1.6 + b.phase) * b.sway;
      }
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.y > H + 8) { bits.splice(i, 1); continue; }
      if (b.kind === 'coin') drawCoin(b, now); else drawNote(b, now);
    }
    if (bits.length) requestAnimationFrame(loop);
    else { running = false; ctx.clearRect(0, 0, W, H); }
  }

  D.coinRain = rain;
})(window.Dvor = window.Dvor || {});
