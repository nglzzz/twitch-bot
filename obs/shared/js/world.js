// Двор: статичный фон рисуется один раз, «живые» детали — каждый кадр.
(function (D) {
  'use strict';

  const W = 640;
  const H = 360;
  const GROUND = 232; // низ стен
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

  const C = {
    ink: '#14111c',
    far: '#1a1e35', farEdge: '#232847', farLit: '#a88a52',
    panel: '#76747c', panelHi: '#86848b', panelLo: '#64626b', seam: '#55535c', base: '#4a4850',
    glass: '#1f2133', frame: '#3a3944', sill: '#8f8d93',
    lit: '#f0c16a', litDeep: '#d9984f', stair: '#c8d8a8', tv: '#86b9dc',
    roof: '#3e3c45', antenna: '#2a2830',
    garage: '#4d5a4b', garageLo: '#3b4639', garageHi: '#5d6b5a', tar: '#26252b', rust: '#7b4a2c',
    side: '#56545b', sideLine: '#47454c', asphalt: '#38373f', asphaltLo: '#2e2d34', asphaltHi: '#43424a',
    curb: '#75727a', road: '#2c2b32', roadLo: '#25242a', mark: '#6c6a62',
    puddle: '#2b3550', puddleHi: '#56638a',
    sodium: '#ffb15a', chalk: '#cfcac0',
    wood: '#6e4f33', woodLo: '#523a25', metal: '#3b3a42', metalHi: '#5b5a63',
    bark: '#2d2526',
  };
  const SKY = ['#0b1024', '#111836', '#19214a', '#262b5b', '#3b3566', '#5a3f68', '#86506a', '#b0656a', '#cf8064'];
  // глубокая ночь: у горизонта только рыжеватая засветка от города
  const SKY_NIGHT = ['#04060e', '#070a17', '#0a0e20', '#0e1329', '#121731', '#171b38', '#1f213f', '#2b2843', '#3d3044'];
  let night = false;

  function rgb(hex) {
    const n = parseInt(hex.slice(1), 16);
    return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  }

  // детерминированный «случай», чтобы двор не менялся между перезагрузками
  let seed = 7;
  const rnd = () => { seed = (seed * 16807) % 2147483647; return (seed - 1) / 2147483646; };

  const windows = []; // { x, y, w, h, lit, kind, curtain, t }
  const stars = [];
  const props = []; // спрайты с глубиной: { y, canvas, x, top }

  function rect(ctx, x, y, w, h, color) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, w, h);
  }

  function ditherRect(ctx, x, y, w, h, color, density) {
    ctx.fillStyle = color;
    for (let yy = y; yy < y + h; yy += 1) {
      for (let xx = x; xx < x + w; xx += 1) {
        if (BAYER[(yy & 3) * 4 + (xx & 3)] / 16 < density) ctx.fillRect(xx, yy, 1, 1);
      }
    }
  }

  /* ---------- небо ---------- */
  function drawSky(ctx) {
    const img = ctx.createImageData(W, GROUND);
    const cols = (night ? SKY_NIGHT : SKY).map(rgb);
    for (let y = 0; y < GROUND; y += 1) {
      const t = Math.pow(y / (GROUND - 1), 1.25) * (cols.length - 1);
      const band = Math.min(cols.length - 2, Math.floor(t));
      const frac = t - band;
      for (let x = 0; x < W; x += 1) {
        const c = BAYER[(y & 3) * 4 + (x & 3)] / 16 < frac ? cols[band + 1] : cols[band];
        const i = (y * W + x) * 4;
        img.data[i] = c[0]; img.data[i + 1] = c[1]; img.data[i + 2] = c[2]; img.data[i + 3] = 255;
      }
    }
    ctx.putImageData(img, 0, 0);

    // луна-серп
    const mx = 92; const my = 24; const r = 8;
    for (let y = -r; y <= r; y += 1) {
      for (let x = -r; x <= r; x += 1) {
        const inMoon = x * x + y * y <= r * r;
        const inShade = (x + 4) * (x + 4) + (y - 2) * (y - 2) <= r * r;
        if (inMoon && !inShade) rect(ctx, mx + x, my + y, 1, 1, x > 2 ? '#f3ecd2' : '#d9d0b2');
      }
    }
    for (let i = 0; i < (night ? 110 : 46); i += 1) {
      stars.push({ x: Math.floor(rnd() * W), y: Math.floor(rnd() * 120), p: rnd() * 6.28, big: rnd() < 0.15 });
    }
  }

  /* ---------- дальние дома ---------- */
  function drawSkyline(ctx) {
    let x = -10;
    while (x < W) {
      const w = 26 + Math.floor(rnd() * 46);
      const top = 132 + Math.floor(rnd() * 46);
      rect(ctx, x, top, w, GROUND - top, C.far);
      rect(ctx, x, top, w, 1, C.farEdge);
      for (let wy = top + 4; wy < GROUND - 4; wy += 6) {
        for (let wx = x + 3; wx < x + w - 3; wx += 5) {
          if (rnd() < 0.13) rect(ctx, wx, wy, 2, 2, rnd() < 0.5 ? C.farLit : '#7b6a4c');
        }
      }
      x += w + Math.floor(rnd() * 6);
    }
    // труба ТЭЦ
    for (let y = 104; y < GROUND; y += 1) {
      const stripe = Math.floor((y - 104) / 9) % 2 === 0 && y < 140;
      rect(ctx, 574 - Math.floor((y - 104) / 40), y, 7 + Math.floor((y - 104) / 20), 1, stripe ? '#5d3537' : '#2a2c42');
    }
  }

  /* ---------- хрущёвка ---------- */
  const B = { x: 16, w: 404, top: 86, floors: 5, floorH: 27, bays: 12, bay: 33 };
  B.floorTop = B.top + 3;
  B.entranceBay = 3;
  B.door = { x: B.x + 4 + B.entranceBay * B.bay + 9, y: GROUND - 25, w: 16, h: 25 };

  function drawBuilding(ctx) {
    const { x, w, top } = B;
    rect(ctx, x, top, w, GROUND - top, C.panel);
    // светлая полоса сверху каждой панели и тень снизу
    for (let f = 0; f < B.floors; f += 1) {
      const fy = B.floorTop + f * B.floorH;
      rect(ctx, x, fy, w, 1, C.panelHi);
      rect(ctx, x, fy + B.floorH - 1, w, 1, C.seam);
      for (let b = 0; b <= B.bays; b += 1) rect(ctx, x + 4 + b * B.bay - 1, fy, 1, B.floorH, C.seam);
      // грязные потёки
      for (let s = 0; s < 6; s += 1) {
        const sx = x + 6 + Math.floor(rnd() * (w - 12));
        ditherRect(ctx, sx, fy + 1, 1 + Math.floor(rnd() * 2), 6 + Math.floor(rnd() * 14), C.panelLo, 0.5);
      }
    }
    // крыша, парапет, антенны
    rect(ctx, x - 2, top, w + 4, 3, C.roof);
    rect(ctx, x - 2, top + 3, w + 4, 1, C.panelLo);
    for (const ax of [60, 150, 238, 330, 395]) {
      rect(ctx, x + ax, top - 14, 1, 14, C.antenna);
      rect(ctx, x + ax - 5, top - 12, 11, 1, C.antenna);
      rect(ctx, x + ax - 3, top - 8, 7, 1, C.antenna);
    }
    // цоколь
    rect(ctx, x, GROUND - 8, w, 8, C.base);
    ditherRect(ctx, x, GROUND - 8, w, 2, C.panelLo, 0.5);

    for (let f = 0; f < B.floors; f += 1) {
      const fy = B.floorTop + f * B.floorH;
      for (let b = 0; b < B.bays; b += 1) {
        const bx = x + 4 + b * B.bay;
        if (b === B.entranceBay) {
          // окна лестницы — со сдвигом на полэтажа
          if (f < B.floors - 1) addWindow(ctx, bx + 12, fy + 17, 8, 12, 'stair');
          continue;
        }
        const balcony = f > 0 && (b === 1 || b === 6 || b === 9) && f < B.floors;
        addWindow(ctx, bx + 10, fy + 5, 13, 15, f === B.floors - 1 ? 'ground' : 'flat');
        if (balcony) drawBalcony(ctx, bx, fy, b, f);
      }
    }
    // windows были добавлены сверху вниз в порядке этажей (f=0 — верхний)
    drawEntrance(ctx);
  }

  function addWindow(ctx, x, y, w, h, kind) {
    rect(ctx, x - 1, y - 1, w + 2, h + 2, C.frame);
    rect(ctx, x, y, w, h, C.glass);
    if (kind !== 'stair') {
      rect(ctx, x + Math.floor(w / 2), y, 1, h, C.frame);
      rect(ctx, x - 2, y + h + 1, w + 4, 1, C.sill);
    }
    if (kind === 'ground') {
      // решётки на первом этаже
      for (let i = 2; i < w; i += 3) rect(ctx, x + i, y, 1, h, '#2c2b33');
      rect(ctx, x, y + 5, w, 1, '#2c2b33');
      rect(ctx, x, y + 10, w, 1, '#2c2b33');
    }
    const roll = rnd();
    windows.push({
      x, y, w, h, kind,
      lit: kind === 'stair' ? rnd() < 0.8 : roll < (night ? 0.55 : 0.42),
      tone: rnd() < 0.7 ? C.lit : C.litDeep,
      curtain: rnd() < 0.6 ? (rnd() < 0.5 ? 'left' : 'both') : 'none',
      tv: kind !== 'stair' && rnd() < 0.06,
      plant: rnd() < 0.18,
      next: 20 + rnd() * 140,
    });
    windows[windows.length - 1].initialLit = windows[windows.length - 1].lit;
  }

  function drawBalcony(ctx, bx, fy, b, f) {
    const x = bx + 3; const y = fy + 14; const w = 27;
    rect(ctx, x, y + 11, w, 2, C.panelLo); // плита
    rect(ctx, x, y, w, 11, b === 6 ? '#5b6a74' : C.panelHi); // ограждение
    rect(ctx, x, y, w, 1, C.sill);
    if (b === 6) {
      // застеклённый — с рамами
      for (let i = 0; i < w; i += 5) rect(ctx, x + i, y, 1, 11, '#3c4650');
    } else if ((b + f) % 2 === 0) {
      // бельё на верёвке
      rect(ctx, x + 1, y - 8, w - 2, 1, '#2d2c33');
      const cloth = ['#b9b2a3', '#8f5b5b', '#5b6f8f', '#c9c09a'];
      for (let i = 0; i < 4; i += 1) rect(ctx, x + 3 + i * 6, y - 7, 4, 4 + (i % 2) * 2, cloth[(i + b) % 4]);
    } else {
      // лыжи и таз — у всех так
      rect(ctx, x + w - 4, y - 12, 1, 12, '#8a3b2c');
      rect(ctx, x + w - 2, y - 12, 1, 12, '#8a3b2c');
      rect(ctx, x + 2, y - 3, 6, 3, '#6b7a86');
    }
  }

  function drawEntrance(ctx) {
    const d = B.door;
    // козырёк
    rect(ctx, d.x - 6, d.y - 5, d.w + 12, 3, '#5a5860');
    rect(ctx, d.x - 6, d.y - 2, d.w + 12, 1, '#3a3940');
    // дверь (рисуется в кадре, чтобы открываться)
    rect(ctx, d.x - 1, d.y - 1, d.w + 2, d.h + 1, '#2b2a30');
    // ступенька
    rect(ctx, d.x - 4, GROUND, d.w + 8, 2, '#6d6a72');
    // табличка «подъезд 2» и домофон
    rect(ctx, d.x + d.w + 3, d.y + 8, 3, 5, '#2b2a30');
    rect(ctx, d.x + d.w + 4, d.y + 9, 1, 1, '#c9372c');
    rect(ctx, d.x + 2, d.y - 10, 12, 4, '#3b5c8c');
    rect(ctx, d.x + 3, d.y - 9, 10, 2, '#e6e2d8');
    // объявления на стене
    rect(ctx, d.x - 10, d.y + 6, 6, 8, '#d9d3c4');
    rect(ctx, d.x - 9, d.y + 8, 4, 1, '#8a8478');
    rect(ctx, d.x - 9, d.y + 10, 3, 1, '#8a8478');
  }

  /* ---------- гаражи ---------- */
  const GAR = { x: 430, y: 194, boxW: 70, count: 3 };

  function drawGarages(ctx) {
    for (let i = 0; i < GAR.count; i += 1) {
      const x = GAR.x + i * GAR.boxW;
      const top = GAR.y + (i === 1 ? 2 : 0);
      rect(ctx, x, top, GAR.boxW - 1, GROUND - top, i === 2 ? '#5a5048' : C.garage);
      rect(ctx, x, top, GAR.boxW - 1, 1, C.garageHi);
      rect(ctx, x - 1, top - 3, GAR.boxW + 1, 3, C.tar);
      // ворота
      const gx = x + 8; const gy = top + 9; const gw = GAR.boxW - 17;
      rect(ctx, gx - 1, gy - 1, gw + 2, GROUND - gy + 1, C.ink);
      rect(ctx, gx, gy, gw, GROUND - gy, i === 2 ? '#6a5e52' : C.garageLo);
      rect(ctx, gx + Math.floor(gw / 2), gy, 1, GROUND - gy, C.ink);
      for (let r = gy + 3; r < GROUND; r += 6) {
        rect(ctx, gx + 2, r, 1, 1, C.garageHi);
        rect(ctx, gx + gw - 3, r, 1, 1, C.garageHi);
      }
      // ржавые потёки
      for (let s = 0; s < 5; s += 1) {
        ditherRect(ctx, gx + Math.floor(rnd() * gw), gy, 1, 4 + Math.floor(rnd() * 12), C.rust, 0.6);
      }
      rect(ctx, gx + Math.floor(gw / 2) - 3, gy + 12, 2, 3, '#1c1b20'); // замок
    }
    // покрышка на крыше среднего гаража
    rect(ctx, GAR.x + GAR.boxW + 20, GAR.y - 7, 14, 5, '#1b1a1f');
    rect(ctx, GAR.x + GAR.boxW + 24, GAR.y - 6, 6, 2, '#2c2b31');
    drawBombsiteA(ctx, GAR.x + 13, GAR.y + 11);
    // каракули на третьем гараже
    const tx = GAR.x + 2 * GAR.boxW + 12;
    ctx.fillStyle = '#c45c8a';
    for (let i = 0; i < 26; i += 1) ctx.fillRect(tx + i, GAR.y + 18 + Math.round(Math.sin(i * 0.7) * 3), 1, 2);
    ctx.fillStyle = '#5fae7a';
    for (let i = 0; i < 18; i += 1) ctx.fillRect(tx + 4 + i, GAR.y + 26 + Math.round(Math.cos(i * 0.9) * 2), 1, 1);
  }

  // Граффити «A» — площадка закладки бомбы.
  function drawBombsiteA(ctx, x, y) {
    const rows = [
      '....####....',
      '...######...',
      '..###..###..',
      '..##....##..',
      '.###....###.',
      '.##########.',
      '.##########.',
      '###......###',
      '##........##',
      '##........##',
      '##........##',
    ];
    rows.forEach((row, ry) => {
      [...row].forEach((ch, rx) => {
        if (ch === '#') rect(ctx, x + rx * 2, y + ry * 2, 2, 2, '#e07a2a');
      });
    });
    // потёки краски
    for (const [dx, len] of [[2, 5], [20, 7], [11, 3]]) rect(ctx, x + dx, y + 22, 1, len, '#b8611f');
  }

  /* ---------- земля ---------- */
  const BAND = { top: 240, bottom: 298 };
  const ROAD = { top: 303, laneY: 331 };
  const MANHOLE = { x: 372, y: 336 };

  function drawGround(ctx) {
    // тротуар
    rect(ctx, 0, GROUND, W, 10, C.side);
    for (let x = 0; x < W; x += 12) rect(ctx, x, GROUND, 1, 10, C.sideLine);
    rect(ctx, 0, GROUND + 10, W, 1, C.sideLine);
    // двор
    rect(ctx, 0, GROUND + 11, W, ROAD.top - GROUND - 14, C.asphalt);
    for (let i = 0; i < 900; i += 1) {
      const x = Math.floor(rnd() * W); const y = GROUND + 11 + Math.floor(rnd() * (ROAD.top - GROUND - 14));
      rect(ctx, x, y, 1, 1, rnd() < 0.5 ? C.asphaltLo : C.asphaltHi);
    }
    // трещины
    ctx.fillStyle = C.asphaltLo;
    for (let c = 0; c < 7; c += 1) {
      let x = rnd() * W; let y = GROUND + 14 + rnd() * 50;
      for (let i = 0; i < 26; i += 1) { ctx.fillRect(Math.floor(x), Math.floor(y), 1, 1); x += rnd() * 2 - 0.4; y += rnd() * 1.4 - 0.5; }
    }
    // классики мелом
    const hx = 214; const hy = 272;
    const cells = [[0, 0], [0, 1], [1, 0.5], [2, 0], [2, 1], [3, 0.5], [4, 0.5]];
    ctx.fillStyle = C.chalk;
    for (const [cx, cy] of cells) {
      const x = hx + cx * 9; const y = hy + Math.round(cy * 8);
      ctx.globalAlpha = 0.55;
      ctx.fillRect(x, y, 9, 1); ctx.fillRect(x, y + 8, 9, 1); ctx.fillRect(x, y, 1, 8); ctx.fillRect(x + 8, y, 1, 8);
    }
    ctx.globalAlpha = 1;

    // бордюр и дорога
    rect(ctx, 0, ROAD.top - 3, W, 3, C.curb);
    rect(ctx, 0, ROAD.top - 3, W, 1, '#8b8890');
    rect(ctx, 0, ROAD.top, W, H - ROAD.top, C.road);
    for (let i = 0; i < 700; i += 1) rect(ctx, Math.floor(rnd() * W), ROAD.top + Math.floor(rnd() * (H - ROAD.top)), 1, 1, C.roadLo);
    for (let x = 6; x < W; x += 34) ditherRect(ctx, x, ROAD.laneY + 10, 16, 2, C.mark, 0.55);
    // лужи
    for (const [px, py, pw] of [[96, 318, 34], [262, 350, 46], [520, 322, 28]]) {
      for (let y = 0; y < 6; y += 1) {
        const inset = Math.abs(2.5 - y) * 3;
        rect(ctx, px + inset, py + y, pw - inset * 2, 1, C.puddle);
      }
      rect(ctx, px + 8, py + 2, pw - 20, 1, C.puddleHi);
    }
    // люк
    for (let y = -3; y <= 3; y += 1) {
      const half = Math.round(Math.sqrt(1 - (y * y) / 12.25) * 9);
      rect(ctx, MANHOLE.x - half, MANHOLE.y + y, half * 2, 1, y === -3 || y === 3 ? '#1b1a1f' : '#26252b');
    }
    for (let x = -6; x <= 6; x += 3) rect(ctx, MANHOLE.x + x, MANHOLE.y - 1, 2, 1, '#38363e');
  }

  /* ---------- спрайты с глубиной ---------- */
  function makeSprite(w, h, draw) {
    const c = document.createElement('canvas');
    c.width = w; c.height = h;
    const ctx = c.getContext('2d');
    draw(ctx);
    return c;
  }

  const BENCH = { x: 160, y: 247, seats: [166, 177, 188] };
  const LAMP = { x: 300, y: 252, headX: 311, headY: 171 };
  const DOOR_LAMP = { x: B.door.x + 8, y: B.door.y - 4 };

  function buildProps() {
    // лавочка
    props.push({
      y: BENCH.y, x: BENCH.x, top: BENCH.y - 16,
      canvas: makeSprite(36, 17, (ctx) => {
        rect(ctx, 0, 0, 36, 2, C.woodLo); rect(ctx, 0, 3, 36, 2, C.wood);
        rect(ctx, 0, 9, 36, 3, C.wood); rect(ctx, 0, 11, 36, 1, C.woodLo);
        for (const x of [2, 32]) { rect(ctx, x, 0, 2, 17, C.metal); }
        rect(ctx, 4, 6, 1, 1, '#c9c2b0'); // окурок
      }),
    });
    // фонарь
    props.push({
      y: LAMP.y, x: LAMP.x - 2, top: LAMP.headY - 4,
      canvas: makeSprite(20, LAMP.y - LAMP.headY + 6, (ctx) => {
        const h = LAMP.y - LAMP.headY + 6;
        rect(ctx, 1, 4, 3, h - 4, C.metal); rect(ctx, 1, 4, 1, h - 4, C.metalHi);
        rect(ctx, 0, h - 3, 5, 3, '#2b2a31');
        rect(ctx, 2, 2, 13, 2, C.metal);
        rect(ctx, 11, 3, 7, 3, '#2b2a31');
        rect(ctx, 12, 6, 5, 1, '#ffd79a');
      }),
    });
    // контейнеры
    props.push({
      y: 252, x: 392, top: 236,
      canvas: makeSprite(34, 17, (ctx) => {
        for (const [x, col] of [[0, '#3f5a3f'], [17, '#5a4a3a']]) {
          rect(ctx, x, 2, 16, 13, col); rect(ctx, x, 2, 16, 1, '#7d8a76'); rect(ctx, x - 1, 0, 18, 3, '#2c3a2c');
          rect(ctx, x + 2, 15, 2, 2, '#1d1c21'); rect(ctx, x + 12, 15, 2, 2, '#1d1c21');
        }
        rect(ctx, 6, 0, 5, 2, '#b8b2a2'); // пакет
      }),
    });
    // голое дерево
    props.push({
      y: 250, x: 18, top: 120,
      canvas: makeSprite(70, 131, (ctx) => {
        rect(ctx, 32, 70, 5, 61, C.bark); rect(ctx, 33, 70, 1, 61, '#3d3234');
        const branch = (x, y, dx, dy, len, w) => {
          for (let i = 0; i < len; i += 1) { rect(ctx, Math.round(x), Math.round(y), w, 1, C.bark); x += dx; y += dy; }
          return [x, y];
        };
        branch(34, 74, -0.6, -1, 40, 2); branch(35, 72, 0.5, -1, 46, 2); branch(34, 90, -1, -0.5, 26, 1);
        branch(36, 84, 1, -0.6, 28, 1); branch(22, 50, -0.4, -1, 18, 1); branch(52, 40, 0.3, -1, 16, 1);
        branch(14, 40, -1, -0.3, 10, 1); branch(46, 50, 1, -0.4, 14, 1); branch(30, 60, 0, -1, 30, 1);
      }),
    });
  }

  /* ---------- освещение ---------- */
  let lampPool = null;
  function buildLightPools() {
    lampPool = makeSprite(W, H, (ctx) => {
      const pool = (cx, cy, rx, ry, color) => {
        ctx.fillStyle = color;
        for (let y = cy - ry; y <= cy + ry; y += 1) {
          for (let x = cx - rx; x <= cx + rx; x += 1) {
            const d = ((x - cx) / rx) ** 2 + ((y - cy) / ry) ** 2;
            if (d > 1) continue;
            if (BAYER[(y & 3) * 4 + (x & 3)] / 16 < (1 - d) * 0.75) ctx.fillRect(x, y, 1, 1);
          }
        }
      };
      pool(LAMP.headX + 2, 268, 64, 26, C.sodium);
      pool(DOOR_LAMP.x, 244, 26, 10, '#ffd28a');
      // конус света от фонаря
      ctx.fillStyle = C.sodium;
      for (let y = LAMP.headY + 6; y < 262; y += 1) {
        const t = (y - LAMP.headY) / (262 - LAMP.headY);
        const half = 2 + t * 46;
        for (let x = Math.floor(LAMP.headX + 2 - half); x <= LAMP.headX + 2 + half; x += 1) {
          if (BAYER[(y & 3) * 4 + (x & 3)] / 16 < 0.22 * (1 - t * 0.6)) ctx.fillRect(x, y, 1, 1);
        }
      }
    });
  }

  /* ---------- сборка статики ---------- */
  let staticCanvas = null;
  function build(options = {}) {
    night = Boolean(options.night);
    staticCanvas = makeSprite(W, H, (ctx) => {
      drawSky(ctx);
      drawSkyline(ctx);
      drawGarages(ctx);
      drawBuilding(ctx);
      drawGround(ctx);
    });
    buildProps();
    buildLightPools();
  }

  /* ---------- живые детали ---------- */
  const gman = { at: 60 + Math.random() * 90, until: 0, win: null };
  const door = { open: 0, target: 0 };

  function drawStatic(ctx) { ctx.drawImage(staticCanvas, 0, 0); }

  function drawAmbient(ctx, t, dt) {
    // звёзды
    for (const s of stars) {
      const a = 0.45 + 0.55 * Math.sin(t * 1.3 + s.p);
      if (a < 0.2) continue;
      ctx.globalAlpha = a;
      rect(ctx, s.x, s.y, 1, 1, '#e8e4d0');
      if (s.big && a > 0.8) { rect(ctx, s.x - 1, s.y, 3, 1, '#8f8ca0'); rect(ctx, s.x, s.y - 1, 1, 3, '#8f8ca0'); rect(ctx, s.x, s.y, 1, 1, '#fff'); }
    }
    ctx.globalAlpha = 1;
    // красный огонь на трубе
    if (Math.floor(t * 1.2) % 2 === 0) rect(ctx, 576, 102, 2, 2, '#ff4a3a');

    // окна; на крупный донат — дискотека во всех окнах
    if (partyLeft > 0) partyLeft -= dt;
    for (const w of windows) {
      if (partyLeft > 0 && w.kind !== 'stair') {
        const c = DISCO[(Math.floor(t * 3) + Math.floor(w.x / 7) + Math.floor(w.y / 9)) % DISCO.length];
        rect(ctx, w.x, w.y, w.w, w.h, c);
        rect(ctx, w.x + Math.floor(w.w / 2), w.y, 1, w.h, C.frame);
        continue;
      }
      if (night) {
        // ночью свет только гаснет — по расписанию lightsOut()
        if (w.offAt && t > w.offAt) { w.lit = false; w.offAt = 0; }
      } else {
        w.next -= dt;
        if (w.next <= 0) {
          w.next = 25 + Math.random() * 160;
          if (w.kind !== 'stair' && Math.random() < 0.5) w.lit = !w.lit;
        }
      }
      if (!w.lit) {
        if (w.plant) { rect(ctx, w.x + 2, w.y + w.h - 4, 3, 4, '#1b2a1e'); rect(ctx, w.x + 1, w.y + w.h - 7, 5, 3, '#22362a'); }
        continue;
      }
      const color = w.kind === 'stair' ? C.stair : (w.tv ? (Math.random() < 0.25 ? '#a7d0ec' : C.tv) : w.tone);
      rect(ctx, w.x, w.y, w.w, w.h, color);
      if (w.kind === 'stair') { rect(ctx, w.x, w.y + 3, w.w, 1, '#9fb38a'); continue; }
      rect(ctx, w.x + Math.floor(w.w / 2), w.y, 1, w.h, C.frame);
      const curtain = w.tv ? '#3f5a78' : '#b06a3c';
      if (w.curtain !== 'none') rect(ctx, w.x, w.y, 3, w.h, curtain);
      if (w.curtain === 'both') rect(ctx, w.x + w.w - 3, w.y, 3, w.h, curtain);
      if (w.plant) { rect(ctx, w.x + 4, w.y + w.h - 4, 3, 4, '#5a3b2a'); rect(ctx, w.x + 3, w.y + w.h - 8, 5, 4, '#3f6b3f'); }
      if (w.kind === 'ground') {
        for (let i = 2; i < w.w; i += 3) rect(ctx, w.x + i, w.y, 1, w.h, '#2c2b33');
        rect(ctx, w.x, w.y + 5, w.w, 1, '#2c2b33'); rect(ctx, w.x, w.y + 10, w.w, 1, '#2c2b33');
      }
    }
    drawGman(ctx, t);
    drawDoor(ctx, dt);

    // свет фонаря иногда моргает
    const flick = Math.random() < 0.006 ? 0.15 : 1;
    ctx.globalAlpha = 0.55 * flick;
    ctx.drawImage(lampPool, 0, 0);
    ctx.globalAlpha = 1;
  }

  // Человек в костюме иногда стоит в тёмном окне. Недолго.
  function drawGman(ctx, t) {
    if (!gman.win && t > gman.at) {
      const dark = windows.filter((w) => !w.lit && w.kind === 'flat' && w.y < 160);
      if (dark.length) { gman.win = dark[Math.floor(Math.random() * dark.length)]; gman.until = t + 7; }
      gman.at = t + 140 + Math.random() * 120;
    }
    if (!gman.win) return;
    if (t > gman.until || gman.win.lit) { gman.win = null; return; }
    const w = gman.win;
    const x = w.x + 4; const y = w.y + 3;
    rect(ctx, x, y, 5, 4, '#c9a184'); // лицо
    rect(ctx, x, y - 1, 5, 1, '#2a2622');
    rect(ctx, x - 1, y + 4, 7, w.h - 7, '#2f3a4a'); // костюм
    rect(ctx, x + 2, y + 4, 1, 5, '#5a7a8a'); // галстук
    rect(ctx, x + 1, y + 1, 1, 1, '#14111c'); rect(ctx, x + 3, y + 1, 1, 1, '#14111c');
  }

  function drawDoor(ctx, dt) {
    door.open += Math.sign(door.target - door.open) * Math.min(Math.abs(door.target - door.open), dt * 4);
    const d = B.door;
    const openPx = Math.round(door.open * (d.w - 3));
    rect(ctx, d.x, d.y, d.w, d.h, '#1a1820'); // проём
    if (door.open > 0.05) rect(ctx, d.x + 2, d.y + 4, d.w - 4, 6, '#c8d8a8'); // свет на лестнице
    rect(ctx, d.x + openPx, d.y, d.w - openPx, d.h, '#4a3a2e');
    rect(ctx, d.x + openPx, d.y, 1, d.h, '#5e4b3c');
    if (d.w - openPx > 4) rect(ctx, d.x + d.w - 4, d.y + 12, 2, 2, '#b8a37a');
    // лампа над дверью
    rect(ctx, DOOR_LAMP.x - 2, DOOR_LAMP.y - 1, 5, 2, '#ffe2a8');
  }

  /** Окна гаснут в случайный момент до from+seconds; несколько полуночников не спят. */
  function lightsOut(from, seconds) {
    for (const w of windows) {
      if (!w.lit || w.kind === 'stair') continue;
      if (Math.random() < 0.1) continue;
      w.offAt = from + seconds * (0.1 + Math.random() * 0.9);
    }
  }

  const DISCO = ['#e0485a', '#f2c94a', '#5cc977', '#4aa3d8', '#9a5ad8', '#ff8aa0'];
  let partyLeft = 0;
  function party(seconds) { partyLeft = Math.max(partyLeft, seconds); }

  function relight() {
    for (const w of windows) { w.lit = w.initialLit; w.offAt = 0; }
  }

  function openDoor(seconds) {
    door.target = 1;
    clearTimeout(door.timer);
    door.timer = setTimeout(() => { door.target = 0; }, seconds * 1000);
  }

  D.world = {
    W, H, GROUND, BAND, ROAD, MANHOLE, BENCH, LAMP, GAR, B,
    DOOR: { x: B.door.x + B.door.w / 2, y: GROUND + 4 },
    BOMBSITE: { x: GAR.x + 26, y: BAND.top + 2 },
    build, drawStatic, drawAmbient, openDoor, lightsOut, relight, party, props, rect, BAYER, C,
  };
})(window.Dvor = window.Dvor || {});
