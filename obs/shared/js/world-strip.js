// Полоска двора для сцены с вебкой: прозрачный слой поверх камеры, земля только внизу.
// Интерфейс тот же, что у world.js, чтобы работал общий движок scene.js.
(function (D) {
  'use strict';

  const W = 640;
  const H = 360;
  const TOP = 288; // верх цоколя
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  const C = {
    base: '#3f3d45', baseHi: '#4d4b53', side: '#56545b', sideLine: '#47454c',
    asphalt: '#38373f', asphaltLo: '#2e2d34', asphaltHi: '#43424a',
    wood: '#6e4f33', woodLo: '#523a25', metal: '#3b3a42',
  };

  let seed = 11;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };
  const rect = (ctx, x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(x, y, w, h); };

  const BAND = { top: 306, bottom: 343 };
  const BENCH = { x: 14, y: 322, seats: [20, 31, 42] };
  const MANHOLE = { x: 404, y: 346 };
  const props = [];

  function makeSprite(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    draw(c.getContext('2d'));
    return c;
  }

  let strip = null;
  function build() {
    strip = makeSprite(W, H, (ctx) => {
      // цоколь дома
      rect(ctx, 0, TOP, W, 8, C.base);
      rect(ctx, 0, TOP, W, 1, C.baseHi);
      for (let x = 0; x < W; x += 1) if (BAYER[(TOP + 2 & 3) * 4 + (x & 3)] / 16 < 0.3) rect(ctx, x, TOP + 2, 1, 1, '#35333b');
      // отмостка
      rect(ctx, 0, TOP + 8, W, 10, C.side);
      for (let x = 0; x < W; x += 12) rect(ctx, x, TOP + 8, 1, 10, C.sideLine);
      // асфальт
      rect(ctx, 0, TOP + 18, W, H - TOP - 18, C.asphalt);
      for (let i = 0; i < 500; i += 1) {
        rect(ctx, Math.floor(rnd() * W), TOP + 18 + Math.floor(rnd() * (H - TOP - 18)), 1, 1, rnd() < 0.5 ? C.asphaltLo : C.asphaltHi);
      }
      ctx.fillStyle = C.asphaltLo;
      for (let c = 0; c < 5; c += 1) {
        let x = rnd() * W; let y = TOP + 22 + rnd() * 30;
        for (let i = 0; i < 22; i += 1) { ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1); x += rnd() * 2 - 0.4; y += rnd() * 1.2 - 0.4; }
      }
      // люк
      for (let y = -3; y <= 3; y += 1) {
        const half = Math.round(Math.sqrt(1 - (y * y) / 12.25) * 9);
        rect(ctx, MANHOLE.x - half, MANHOLE.y + y, half * 2, 1, y === -3 || y === 3 ? '#1b1a1f' : '#26252b');
      }
      // лужа
      for (let y = 0; y < 5; y += 1) { const inset = Math.abs(2 - y) * 3; rect(ctx, 250 + inset, 350 + y, 40 - inset * 2, 1, '#2b3550'); }
      rect(ctx, 258, 352, 20, 1, '#56638a');
    });
    props.push({
      y: BENCH.y, x: BENCH.x, top: BENCH.y - 16,
      canvas: makeSprite(36, 17, (ctx) => {
        rect(ctx, 0, 0, 36, 2, C.woodLo); rect(ctx, 0, 3, 36, 2, C.wood);
        rect(ctx, 0, 9, 36, 3, C.wood); rect(ctx, 0, 11, 36, 1, C.woodLo);
        for (const x of [2, 32]) rect(ctx, x, 0, 2, 17, C.metal);
      }),
    });
  }

  function drawStatic(ctx) {
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(strip, 0, 0);
  }

  D.world = {
    W, H, GROUND: TOP, BAND, BENCH, MANHOLE, BAYER, C,
    ROAD: { top: H, laneY: H + 30 },
    LAMP: { x: -50, y: 0, headX: -50, headY: 0 },
    DOOR: { x: -10, y: BAND.top + 6 }, // из-за левого края
    BOMBSITE: { x: 560, y: BAND.top + 2 },
    props, rect,
    build, drawStatic,
    drawAmbient() {},
    openDoor() {}, lightsOut() {}, relight() {},
  };
})(window.Dvor = window.Dvor || {});
