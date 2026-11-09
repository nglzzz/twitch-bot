// Оконная рама вокруг камеры: крашеное дерево, подоконник, кактус, кружка, радио и кот.
// Источник лежит во вложенной сцене вместе с камерой — двигаются вместе.
(function (D) {
  'use strict';
  const canvas = document.getElementById('frame');
  const ctx = canvas.getContext('2d');
  const W = canvas.width; const H = canvas.height; // 490×282, окно камеры 456×256 от (17, 9)
  const GLASS = { x: 17, y: 9, w: 456, h: 256 };
  const SILL_Y = 268;
  const INK = '#14111c';
  const rect = (x, y, w, h, c) => { ctx.fillStyle = c; ctx.fillRect(x, y, w, h); };
  let seed = 3;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  function drawFrame() {
    const ox = 8; const ow = W - 16;
    // рама: наличник 3 px, створка 4 px, четверть 2 px
    rect(ox - 1, -1, ow + 2, SILL_Y + 2, INK);
    rect(ox, 0, ow, SILL_Y, '#d6d1c4');
    rect(ox, 0, ow, 1, '#ece8de'); rect(ox, 0, 1, SILL_Y, '#ece8de');
    rect(ox + ow - 1, 0, 1, SILL_Y, '#b3ad9e');
    rect(ox + 3, 3, ow - 6, 1, '#b3ad9e'); rect(ox + 3, 3, 1, SILL_Y - 3, '#b3ad9e');
    rect(GLASS.x - 2, GLASS.y - 2, GLASS.w + 4, GLASS.h + 4, '#2a2730');
    ctx.clearRect(GLASS.x, GLASS.y, GLASS.w, GLASS.h); // стекло прозрачное — под ним камера
    // облупившаяся краска
    for (let i = 0; i < 18; i += 1) {
      const onSide = rnd() < 0.5;
      const x = onSide ? (rnd() < 0.5 ? ox + 1 + Math.floor(rnd() * 5) : ox + ow - 7 + Math.floor(rnd() * 5)) : ox + Math.floor(rnd() * ow);
      const y = onSide ? Math.floor(rnd() * SILL_Y) : (rnd() < 0.5 ? 1 + Math.floor(rnd() * 5) : SILL_Y - 7 + Math.floor(rnd() * 4));
      rect(x, y, 1 + Math.floor(rnd() * 3), 1 + Math.floor(rnd() * 2), rnd() < 0.6 ? '#8a6a46' : '#a59f90');
    }
    // ручка-шпингалет справа
    rect(GLASS.x + GLASS.w + 3, 120, 3, 16, '#7d7a82'); rect(GLASS.x + GLASS.w + 2, 126, 1, 4, '#5b5960');
    // подоконник
    rect(0, SILL_Y - 1, W, 14, INK);
    rect(1, SILL_Y, W - 2, 6, '#e4e0d6');
    rect(1, SILL_Y, W - 2, 1, '#f4f1ea');
    rect(1, SILL_Y + 6, W - 2, 6, '#a9a497');
    rect(1, SILL_Y + 11, W - 2, 1, '#8a8578');
    // блики на стекле — едва заметно
    ctx.globalAlpha = 0.07;
    for (let i = 0; i < 22; i += 1) rect(GLASS.x + 18 + i, GLASS.y + 30 - i, 1, 3, '#ffffff');
    for (let i = 0; i < 12; i += 1) rect(GLASS.x + 30 + i, GLASS.y + 30 - i, 1, 2, '#ffffff');
    ctx.globalAlpha = 1;
  }

  function drawStill() {
    // кактус
    rect(39, SILL_Y - 9, 12, 10, INK); rect(40, SILL_Y - 8, 10, 8, '#a5532e'); rect(40, SILL_Y - 8, 10, 1, '#c26a3e');
    rect(42, SILL_Y - 21, 6, 13, INK); rect(43, SILL_Y - 20, 4, 12, '#4f8a3e'); rect(44, SILL_Y - 20, 1, 12, '#6aa852');
    rect(39, SILL_Y - 17, 4, 5, INK); rect(40, SILL_Y - 16, 3, 3, '#4f8a3e');
    rect(48, SILL_Y - 15, 4, 4, INK); rect(48, SILL_Y - 14, 3, 2, '#4f8a3e');
    rect(45, SILL_Y - 22, 1, 1, '#e86a8a');
    // радио «как у деда»
    const rx = 400;
    rect(rx - 1, SILL_Y - 15, 30, 16, INK); rect(rx, SILL_Y - 14, 28, 14, '#5a3a24');
    rect(rx + 2, SILL_Y - 12, 14, 9, '#c9b98a'); for (let i = 0; i < 4; i += 1) rect(rx + 4 + i * 3, SILL_Y - 10, 1, 5, '#8a7a52');
    rect(rx + 19, SILL_Y - 11, 6, 6, '#2a1c12'); rect(rx + 21, SILL_Y - 9, 2, 2, '#c9a24a');
    rect(rx + 24, SILL_Y - 22, 1, 8, '#9a9aa2');
    // кружка
    rect(368, SILL_Y - 10, 10, 11, INK); rect(369, SILL_Y - 9, 8, 9, '#e8e4d8'); rect(369, SILL_Y - 6, 8, 2, '#c8322c');
    rect(377, SILL_Y - 7, 3, 5, INK); rect(377, SILL_Y - 6, 2, 3, '#e8e4d8');
  }

  const still = document.createElement('canvas');
  still.width = W; still.height = H;
  drawFrame(); drawStill();
  still.getContext('2d').drawImage(canvas, 0, 0);

  // кот гуляет по подоконнику
  const cat = { x: 300, y: SILL_Y, facing: -1, sitting: true, moving: false, target: null, t: 8 };
  let last = performance.now(); let clock = 0;
  function tick(now) {
    const dt = Math.min(0.1, (now - last) / 1000); last = now; clock += dt;
    cat.t -= dt;
    if (cat.target != null) {
      const dx = cat.target - cat.x;
      if (Math.abs(dx) < 1) { cat.target = null; cat.moving = false; cat.sitting = true; cat.t = 10 + Math.random() * 25; } else { cat.x += Math.sign(dx) * 10 * dt; cat.facing = Math.sign(dx); cat.moving = true; }
    } else if (cat.t <= 0) { cat.sitting = false; cat.target = 70 + Math.random() * 300; }

    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(still, 0, 0);
    // пар над кружкой
    ctx.globalAlpha = 0.45;
    for (let i = 0; i < 3; i += 1) {
      const k = ((clock * 0.6 + i / 3) % 1);
      rect(Math.round(372 + Math.sin(clock * 2 + i * 2) * 2), Math.round(SILL_Y - 12 - k * 14), 1, 2, '#e9edf5');
    }
    ctx.globalAlpha = 1;
    D.people.drawCat(ctx, cat, clock);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);
})(window.Dvor);
