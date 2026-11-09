// Персонажи: собираются из прямоугольников, обводка — отдельным проходом.
(function (D) {
  'use strict';

  const INK = '#14111c';
  const HEIGHT = 26; // от макушки до подошвы

  /* ---------- костюмы ---------- */
  // Цвета частей тела + функции деталей. Деталь: [x, y, w, h, color] в координатах «лицом вправо».
  const OUTFITS = {
    freeman: {
      title: 'учёный в оранжевом',
      skin: '#d9a27c', torso: '#d76b1f', sleeve: '#d76b1f', hand: '#232227', pants: '#585b63', boot: '#2a2a2e',
      head: [[3, 0, 6, 2, '#4a2f1d'], [3, 4, 6, 2, '#5b3a22'], [5, 4, 2, 1, '#d9a27c']],
      face: [[5, 2, 4, 1, '#0d0d10']],
      body: [[4, 7, 4, 4, '#3a3d44'], [5, 8, 2, 1, '#f39a3a'], [3, 13, 6, 1, '#3a3d44']],
      item: 'crowbar',
      quotes: ['…', '*молча кивает*', 'Где мой костюм…'],
    },
    scientist: {
      title: 'лаборант',
      skin: '#e0b08e', torso: '#e9e6dc', sleeve: '#e9e6dc', hand: '#e0b08e', pants: '#3d414c', boot: '#2b2b30',
      head: [[3, 0, 1, 3, '#bdb8ad'], [8, 0, 1, 3, '#bdb8ad'], [4, 0, 4, 1, '#d6a585']],
      face: [[5, 2, 1, 1, '#2a2a30'], [7, 2, 1, 1, '#2a2a30'], [6, 2, 1, 1, '#9a9a9a']],
      body: [[6, 7, 1, 5, '#2f4a7a'], [5, 6, 3, 1, '#c9c6bc']],
      coat: '#e9e6dc',
      quotes: ['Доктор Фримен?', 'Образец уже в камере!', 'Это… неожиданно.'],
    },
    terror: {
      title: 'террорист',
      skin: '#c8936c', torso: '#5b4733', sleeve: '#5b4733', hand: '#2a2622', pants: '#77694f', boot: '#2a2622',
      head: [[3, 0, 6, 2, '#1f1f22'], [3, 2, 1, 4, '#1f1f22'], [3, 4, 6, 2, '#1f1f22']],
      face: [[6, 2, 1, 1, '#f2efe6'], [8, 2, 1, 1, '#f2efe6']],
      body: [[3, 12, 6, 1, '#3a2e22']],
      item: 'rifle',
      quotes: ['Закладываю на A!', 'Раш Б, не стоим', 'Кто купил мне калаш?'],
    },
    ct: {
      title: 'спецназ',
      skin: '#d6a17c', torso: '#3f4c58', sleeve: '#3f4c58', hand: '#1f1f22', pants: '#3a4650', boot: '#1f1f22',
      head: [[2, 0, 8, 2, '#3d4a52'], [3, 2, 6, 1, '#3d4a52'], [5, 2, 4, 1, '#7fa0a8']],
      body: [[3, 7, 6, 5, '#262f38'], [4, 8, 1, 2, '#5d6a74'], [7, 8, 1, 2, '#5d6a74']],
      item: 'rifle',
      quotes: ['Прикрываю!', 'Чисто', 'Бомба где-то на A…'],
    },
    dovah: {
      title: 'северянин',
      skin: '#d8a684', torso: '#6a4b30', sleeve: '#6a4b30', hand: '#d8a684', pants: '#47392b', boot: '#3a2c20',
      head: [[2, 0, 8, 2, '#8b8e95'], [2, 2, 1, 2, '#8b8e95'], [9, 2, 1, 2, '#8b8e95'], [3, 4, 6, 2, '#a0703f'],
        [1, -1, 1, 2, '#e3d8bd'], [0, -3, 1, 2, '#e3d8bd'], [10, -1, 1, 2, '#e3d8bd'], [11, -3, 1, 2, '#e3d8bd']],
      body: [[2, 6, 8, 2, '#b19771'], [3, 13, 6, 1, '#3a2c20']],
      item: 'axe',
      shout: true,
      quotes: ['Раньше я тоже был искателем приключений…', 'Опять эти драконы', 'Сладкий рулет никто не видел?'],
    },
    nameless: {
      title: 'безымянный',
      skin: '#cf9a74', torso: '#5a3a22', sleeve: '#4a3020', hand: '#cf9a74', pants: '#3a2a1c', boot: '#22180f',
      head: [[3, 0, 6, 2, '#1e1712'], [3, 2, 1, 3, '#1e1712'], [2, 2, 1, 4, '#1e1712']],
      body: [[3, 8, 1, 1, '#2c1c10'], [4, 9, 1, 1, '#2c1c10'], [5, 10, 1, 1, '#2c1c10'], [6, 11, 1, 1, '#2c1c10'], [3, 13, 6, 1, '#2c1c10']],
      back: 'sword',
      quotes: ['Эй, ты! Да, ты.', 'Мне бы в Старый лагерь…', 'Я тут просто прохожий.'],
    },
    gopnik: {
      title: 'пацан с района',
      skin: '#e0aa86', torso: '#1f2c4a', sleeve: '#1f2c4a', hand: '#e0aa86', pants: '#1f2c4a', boot: '#e6e6e6',
      head: [[3, 0, 6, 2, '#151518'], [8, 1, 3, 1, '#151518']],
      body: [[6, 6, 1, 8, '#c9c9c9']],
      stripes: '#e6e6e6',
      squats: true,
      quotes: ['Слышь, есть чё?', 'С какого района?', 'Семки будешь?'],
    },
    grove: {
      title: 'парень с Грув-стрит',
      skin: '#7a4a30', torso: '#2e8a3a', sleeve: '#7a4a30', hand: '#7a4a30', pants: '#355a8c', boot: '#1c1c1c',
      head: [[3, 0, 6, 1, '#151212']],
      body: [[3, 6, 1, 2, '#7a4a30'], [8, 6, 1, 2, '#7a4a30']],
      quotes: ['Ну вот, опять началось', 'Грув-стрит — дом родной', 'Следуй за поездом!'],
    },
    stalker: {
      title: 'сталкер',
      skin: '#6e7174', torso: '#4f5b3a', sleeve: '#4f5b3a', hand: '#2a2a2a', pants: '#3e4532', boot: '#262421',
      head: [[2, 0, 8, 2, '#4f5b3a'], [2, 2, 1, 4, '#4f5b3a'], [9, 2, 1, 3, '#4f5b3a']],
      face: [[5, 2, 1, 1, '#a9c7b0'], [7, 2, 1, 1, '#a9c7b0'], [6, 4, 2, 2, '#3a3a3e']],
      back: 'pack',
      item: 'rifle',
      quotes: ['Подходи, не обижу', 'Выброс скоро…', 'Здесь аномалия, обходи'],
    },
    vault: {
      title: 'житель убежища',
      skin: '#e2b08f', torso: '#2d5ea6', sleeve: '#2d5ea6', hand: '#e2b08f', pants: '#2d5ea6', boot: '#2a2522',
      head: [[3, 0, 6, 2, '#6b4a2a'], [3, 2, 1, 1, '#6b4a2a']],
      body: [[5, 6, 2, 8, '#e5c23a'], [3, 13, 6, 1, '#e5c23a']],
      pipboy: true,
      quotes: ['Война никогда не меняется', 'Кто-нибудь видел крышки?', 'Я из убежища, мне можно'],
    },
    witcher: {
      title: 'седой охотник',
      skin: '#d8b090', torso: '#2a2a30', sleeve: '#2a2a30', hand: '#3a2a20', pants: '#2b2622', boot: '#1e1a17',
      head: [[3, 0, 6, 2, '#e5e4de'], [3, 2, 1, 3, '#e5e4de'], [2, 3, 1, 3, '#e5e4de']],
      body: [[5, 8, 1, 1, '#c9b26a'], [3, 9, 1, 1, '#7a7a80'], [8, 9, 1, 1, '#7a7a80'], [3, 13, 6, 1, '#4a3a2a']],
      back: 'swords',
      quotes: ['Хм.', 'Зараза…', 'Ветер воет.'],
    },
  };
  const OUTFIT_KEYS = Object.keys(OUTFITS);

  function hash(text) {
    let h = 2166136261;
    for (const ch of String(text)) { h ^= ch.codePointAt(0); h = Math.imul(h, 16777619); }
    return h >>> 0;
  }
  function outfitFor(login) {
    if (login && login === String(D.config.channel || '').toLowerCase()) return 'freeman';
    return OUTFIT_KEYS[hash(login) % OUTFIT_KEYS.length];
  }

  /* ---------- скелет поз ---------- */
  // Возвращает части тела: { tag, x, y, w, h } в координатах 12×26 «лицом вправо».
  function skeleton(pose, frame, outfit) {
    const parts = [];
    const add = (tag, x, y, w, h) => parts.push({ tag, x, y, w, h });
    let dy = 0; // приседание
    const ph = frame % 4;

    if (pose === 'squat' || pose === 'kneel') dy = pose === 'squat' ? 7 : 5;
    if (pose === 'sit') dy = 4;

    // ноги
    if (pose === 'sit') {
      add('pants', 3, 15 + dy - 4, 7, 3);
      add('pants', 8, 18 + dy - 4, 2, 4); add('boot', 8, 22, 3, 2);
      add('pants', 6, 18 + dy - 4, 2, 4); add('boot', 6, 22, 3, 2);
    } else if (pose === 'squat') {
      add('pants', 1, 17, 3, 6); add('boot', 1, 23, 3, 3);
      add('pants', 8, 17, 3, 6); add('boot', 8, 23, 3, 3);
    } else if (pose === 'kneel') {
      add('pants', 3, 20, 2, 4); add('boot', 3, 24, 2, 2);
      add('pants', 6, 17, 4, 2); add('pants', 8, 19, 2, 5); add('boot', 8, 24, 3, 2);
    } else {
      let lh = 8; let rh = 8; let lx = 3; let rx = 7;
      if (pose === 'walk') { if (ph === 1) lh = 7; if (ph === 3) rh = 7; }
      if (pose === 'run') { lx = ph < 2 ? 2 : 4; rx = ph < 2 ? 8 : 6; if (ph === 1) lh = 6; if (ph === 3) rh = 6; }
      add('pants', lx, 15, 2, lh); add('boot', lx, 15 + lh, 2 + (lx < 3 ? 0 : 1), 3 - (8 - lh));
      add('pants', rx, 15, 2, rh); add('boot', rx, 15 + rh, 3, 3 - (8 - rh));
    }

    const lean = pose === 'punch' || pose === 'kiss' || pose === 'shout' ? 1 : (pose === 'hit' ? -1 : 0);
    const bob = (pose === 'walk' && (ph === 1 || ph === 3)) ? -1 : 0;
    const by = dy + bob;
    // торс
    add('torso', 3 + lean, 6 + by, 6, 9);
    if (outfit.coat && pose !== 'sit' && pose !== 'squat') add('coat', 2 + lean, 13 + by, 8, 5);

    // руки
    const armY = 7 + by;
    const swing = pose === 'walk' ? (ph === 1 ? 1 : ph === 3 ? -1 : 0) : 0;
    switch (pose) {
      case 'punch':
        add('sleeve', 1 + lean, armY, 2, 6); add('hand', 1 + lean, armY + 6, 2, 1);
        add('sleeve', 9 + lean, armY + 1, 4, 2); add('hand', 13 + lean, armY + 1, 2, 2);
        break;
      case 'hug':
        add('sleeve', 8, armY + 1, 5, 2); add('hand', 13, armY + 1, 1, 2);
        add('sleeve', 5, armY + 4, 8, 2); add('hand', 13, armY + 4, 1, 2);
        break;
      case 'cheer': case 'run':
        add('sleeve', 1, armY - 6 + (ph % 2), 2, 6); add('hand', 1, armY - 7 + (ph % 2), 2, 1);
        add('sleeve', 9, armY - 6 + ((ph + 1) % 2), 2, 6); add('hand', 9, armY - 7 + ((ph + 1) % 2), 2, 1);
        break;
      case 'shout':
        add('sleeve', 9 + lean, armY - 1, 4, 2); add('hand', 13 + lean, armY - 2, 2, 2);
        add('sleeve', 9 + lean, armY + 3, 4, 2); add('hand', 13 + lean, armY + 3, 2, 2);
        break;
      case 'hit':
        add('sleeve', 0, armY - 3, 2, 6); add('hand', 0, armY - 4, 2, 1);
        add('sleeve', 9 + lean, armY - 2, 2, 6); add('hand', 9 + lean, armY - 3, 2, 1);
        break;
      case 'fist':
        add('sleeve', 1, armY, 2, 6); add('hand', 1, armY + 6, 2, 1);
        add('sleeve', 9, armY - 5, 2, 5); add('hand', 9, armY - 7, 2, 2);
        break;
      default:
        add('sleeve', 1 + lean, armY + swing, 2, 6); add('hand', 1 + lean, armY + 6 + swing, 2, 1);
        add('sleeve', 9 + lean, armY - swing, 2, 6); add('hand', 9 + lean, armY + 6 - swing, 2, 1);
    }

    // голова
    add('skin', 3 + lean, 0 + by, 6, 6);
    return { parts, lean, by };
  }

  /* ---------- рисование ---------- */
  function drawFigure(ctx, ox, oy, facing, pose, frame, outfit, extra) {
    const { parts, lean, by } = skeleton(pose, frame, outfit);
    const mx = (x, w) => (facing > 0 ? ox + x : ox + (12 - x - w));
    const fill = (x, y, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(mx(x, w), oy + y, w, h); };

    // предметы за спиной
    if (outfit.back === 'sword') { for (let i = 0; i < 12; i += 1) fill(1 + Math.floor(i / 2), 15 - i + by, 1, 1, i > 9 ? '#3a2a1a' : '#a7adb4'); }
    if (outfit.back === 'swords') {
      for (let i = 0; i < 12; i += 1) { fill(1 + Math.floor(i / 2), 15 - i + by, 1, 1, i > 9 ? '#3a2a1a' : '#b9bfc6'); fill(2 + Math.floor(i / 3), 16 - i + by, 1, 1, i > 9 ? '#3a2a1a' : '#8d939a'); }
    }
    if (outfit.back === 'pack') { fill(0, 7 + by, 3, 7, INK); fill(0, 8 + by, 2, 5, '#3c3628'); }

    // обводка
    ctx.fillStyle = INK;
    for (const p of parts) ctx.fillRect(mx(p.x, p.w) - 1, oy + p.y - 1, p.w + 2, p.h + 2);
    const head = outfit.head || [];
    for (const [x, y, w, h] of head) if (y < 0 || x < 3 || x > 8) ctx.fillRect(mx(x + lean, w) - 1, oy + y + by - 1, w + 2, h + 2);

    // заливка
    for (const p of parts) {
      const color = p.tag === 'coat' ? outfit.coat : outfit[p.tag] || '#888';
      fill(p.x, p.y, p.w, p.h, color);
    }
    // лампасы
    if (outfit.stripes) {
      for (const p of parts) {
        if (p.tag === 'sleeve' && p.h > p.w) fill(p.x + (p.x > 5 ? p.w - 1 : 0), p.y, 1, p.h, outfit.stripes);
        if (p.tag === 'pants' && p.h > p.w) fill(p.x + (p.x > 5 ? p.w - 1 : 0), p.y, 1, p.h, outfit.stripes);
      }
    }
    // детали торса
    for (const [x, y, w, h, color] of outfit.body || []) fill(x + lean, y + by, w, h, color);
    if (outfit.pipboy) { const arm = parts.find((p) => p.tag === 'sleeve'); if (arm) { fill(arm.x, arm.y + 3, 2, 2, '#3a3d38'); fill(arm.x, arm.y + 3, 1, 1, '#7cff7c'); } }

    // лицо: глаза по умолчанию
    const face = outfit.face;
    if (!face) {
      fill(6 + lean, 2 + by, 1, 1, INK); fill(8 + lean, 2 + by, 1, 1, INK);
      if (pose === 'shout' || pose === 'hit') fill(7 + lean, 4 + by, 2, 1, '#5a1f22');
      if (pose === 'kiss') fill(9 + lean, 4 + by, 1, 1, '#c4485a');
    }
    for (const [x, y, w, h, color] of head) fill(x + lean, y + by, w, h, color);
    if (face) for (const [x, y, w, h, color] of face) fill(x + lean, y + by, w, h, color);
    if (extra && extra.blush) { fill(7 + lean, 3 + by, 1, 1, '#e07a8a'); fill(4 + lean, 3 + by, 1, 1, '#e07a8a'); }

    drawItem(fill, pose, outfit.item, parts, frame);
  }

  function drawItem(fill, pose, item, parts, frame) {
    if (!item) return;
    const hands = parts.filter((p) => p.tag === 'hand');
    const hand = hands[hands.length - 1];
    if (!hand) return;
    const hx = hand.x; const hy = hand.y;
    if (item === 'crowbar') {
      if (pose === 'punch') { for (let i = 0; i < 7; i += 1) fill(hx + 1 + i, hy - Math.floor(i / 4), 1, 1, '#b23128'); fill(hx + 7, hy - 2, 1, 1, '#b23128'); }
      else { for (let i = 0; i < 8; i += 1) fill(hx + (i > 5 ? 1 : 0), hy + 1 - i, 1, 1, '#b23128'); fill(hx + 1, hy + 2, 1, 1, '#b23128'); }
    } else if (item === 'axe') {
      for (let i = 0; i < 8; i += 1) fill(hx, hy + 1 - i, 1, 1, '#5a3d22');
      fill(hx + 1, hy - 7, 2, 3, '#9aa0a8'); fill(hx + 3, hy - 7, 1, 3, '#d5d9de');
    } else if (item === 'rifle' && pose !== 'hug' && pose !== 'cheer' && pose !== 'run' && pose !== 'sit') {
      const y = pose === 'punch' ? hy : 10;
      fill(2, y + 1, 3, 2, '#6d4a2c'); fill(5, y, 9, 2, '#2b2b2f'); fill(14, y, 2, 1, '#2b2b2f'); fill(9, y + 2, 1, 2, '#2b2b2f');
    }
  }

  // Персонаж: p.x — центр, p.y — подошвы.
  function drawPerson(ctx, p) {
    const outfit = OUTFITS[p.outfit];
    const ox = Math.round(p.x) - 6;
    const oy = Math.round(p.y) - HEIGHT - (p.z || 0); // z — прыжок, тень остаётся на земле
    if (p.pose === 'lie') { drawLying(ctx, p, outfit); return; }
    // тень
    ctx.globalAlpha = 0.35;
    ctx.fillStyle = '#0d0c12';
    ctx.fillRect(ox + 1, Math.round(p.y) - 1, 10, 2);
    ctx.globalAlpha = 1;
    drawFigure(ctx, ox, oy, p.facing, p.pose, p.frame, outfit, p.extra);
    if (p.headcrab) drawHeadcrab(ctx, ox + 1, oy - 4 + (p.pose === 'squat' ? 7 : 0), p.frame, true);
  }

  const lieCanvas = document.createElement('canvas');
  lieCanvas.width = 20; lieCanvas.height = 34;
  const lieCtx = lieCanvas.getContext('2d');
  function drawLying(ctx, p, outfit) {
    lieCtx.clearRect(0, 0, 20, 34);
    drawFigure(lieCtx, 4, 5, 1, 'stand', 0, outfit, null);
    const x = Math.round(p.x); const y = Math.round(p.y);
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#0d0c12'; ctx.fillRect(x - 15, y - 1, 30, 2); ctx.globalAlpha = 1;
    ctx.save();
    ctx.translate(x, y - 10);
    ctx.rotate((p.facing > 0 ? -1 : 1) * Math.PI / 2); // падает на спину
    ctx.drawImage(lieCanvas, -10, -17);
    ctx.restore();
  }

  /* ---------- хедкраб ---------- */
  function drawHeadcrab(ctx, x, y, frame, onHead) {
    const legs = frame % 2;
    ctx.fillStyle = INK; ctx.fillRect(x - 1, y - 1, 12, 6);
    ctx.fillStyle = '#c9a77a'; ctx.fillRect(x, y, 10, 4);
    ctx.fillStyle = '#e3c79a'; ctx.fillRect(x + 2, y, 6, 1);
    ctx.fillStyle = '#7a3a2e'; ctx.fillRect(x + 3, y + 3, 4, 1);
    ctx.fillStyle = '#a88660';
    if (!onHead) {
      ctx.fillRect(x - 1, y + 4, 1, 2 + legs); ctx.fillRect(x + 10, y + 4, 1, 2 + legs);
      ctx.fillRect(x + 2, y + 4, 1, 2 - legs); ctx.fillRect(x + 7, y + 4, 1, 2 - legs);
    } else {
      ctx.fillRect(x - 1, y + 3, 1, 4); ctx.fillRect(x + 10, y + 3, 1, 4);
    }
  }

  /* ---------- машина ---------- */
  const CAR_COLORS = [['#c9b48a', '#a8956e'], ['#8c2f2f', '#6e2424'], ['#d9d6cc', '#b5b2a8'], ['#3b5f7a', '#2e4a60']];
  function drawCar(ctx, car, t) {
    const [body, shade] = CAR_COLORS[car.color % CAR_COLORS.length];
    const x = Math.round(car.x); const y = Math.round(car.y); // y — по колёсам
    const f = car.facing;
    const W2 = 26;
    const px = (dx, w) => (f > 0 ? x + dx : x - dx - w);
    const r = (dx, dy, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(px(dx, w), y + dy, w, h); };
    ctx.globalAlpha = 0.35; ctx.fillStyle = '#0d0c12'; ctx.fillRect(x - W2, y - 1, W2 * 2, 3); ctx.globalAlpha = 1;
    // обводка корпуса
    r(-W2 - 1, -12, W2 * 2 + 2, 10, INK);
    r(-14, -20, 26, 9, INK);
    // корпус и крыша
    r(-W2, -11, W2 * 2, 8, body);
    r(-W2, -5, W2 * 2, 2, shade);
    r(-13, -19, 24, 8, body);
    // стёкла
    r(-11, -18, 10, 6, '#2b3a50'); r(1, -18, 9, 6, '#2b3a50');
    r(-10, -18, 3, 1, '#6d86a6');
    // водитель
    if (car.driver) {
      const o = OUTFITS[car.driver.outfit];
      r(2, -17, 5, 5, o.skin);
      const hair = (o.head && o.head[0] && o.head[0][4]) || '#333';
      r(2, -17, 5, 2, hair);
      r(6, -15, 1, 1, INK);
    }
    // фары, бампер, ручки
    r(W2 - 2, -10, 2, 2, '#ffe8a8'); r(-W2, -10, 2, 2, '#b8322a');
    r(-W2, -4, W2 * 2, 1, '#8b8890');
    r(-4, -9, 3, 1, shade); r(8, -9, 3, 1, shade);
    // колёса
    for (const wx of [-16, 10]) {
      r(wx - 1, -5, 9, 7, INK); r(wx, -4, 7, 5, '#1b1a1f');
      const spin = Math.floor((car.dist || 0) / 3) % 2;
      r(wx + 2 + spin, -3, 3 - spin, 3, '#7d7a82');
    }
    // свет фар на асфальте
    if (car.moving || car.lights) {
      ctx.fillStyle = '#ffe8a8';
      for (let i = 0; i < 26; i += 1) {
        for (let j = -2 - Math.floor(i / 6); j <= 1 + Math.floor(i / 8); j += 1) {
          const sx = px(W2 + 1 + i, 1); const sy = y + j - 2;
          if (D.world.BAYER[(sy & 3) * 4 + (sx & 3)] / 16 < 0.3 * (1 - i / 26)) ctx.fillRect(sx, sy, 1, 1);
        }
      }
    }
    if (car.honk && t - car.honk < 0.6) r(W2 + 2, -16, 3, 1, '#f2efe6');
  }

  /* ---------- соседи ---------- */
  function drawGranny(ctx, g, t) {
    const x = Math.round(g.x) - 6; const y = Math.round(g.y) - HEIGHT;
    const o = {
      skin: '#e2b598', torso: '#4b4a5e', sleeve: '#4b4a5e', hand: '#e2b598', pants: '#3a3646', boot: '#2a2622', coat: '#4b4a5e',
      // платок в горошек, завязан под подбородком; очки
      head: [[2, 0, 8, 2, '#3f4f7a'], [2, 2, 2, 4, '#3f4f7a'], [8, 2, 2, 3, '#3f4f7a'], [3, 5, 6, 1, '#3f4f7a'], [6, 6, 2, 1, '#3f4f7a'],
        [3, 0, 1, 1, '#d9d2c0'], [6, 1, 1, 1, '#d9d2c0'], [8, 0, 1, 1, '#d9d2c0'], [2, 3, 1, 1, '#d9d2c0'], [9, 3, 1, 1, '#d9d2c0']],
      face: [[5, 2, 4, 1, '#6b6158'], [6, 2, 1, 1, '#c9d0d8'], [8, 2, 1, 1, '#c9d0d8'], [6, 4, 2, 1, '#b07a6a']],
    };
    drawFigure(ctx, x, y, g.facing, g.pose || (g.angry ? 'fist' : 'sit'), g.frame || 0, o, null);
    if (!g.angry && !g.pose) {
      // вязание
      const k = Math.floor(t * 3) % 2;
      ctx.fillStyle = '#d9c24a'; ctx.fillRect(x + (g.facing > 0 ? 9 : 0), y + 16, 3, 3);
      ctx.fillStyle = '#9a9aa2'; ctx.fillRect(x + (g.facing > 0 ? 7 : 3) + k, y + 13, 1, 4);
    }
  }

  function drawCat(ctx, c, t) {
    const x = Math.round(c.x); const y = Math.round(c.y); const f = c.facing;
    const px = (dx, w) => (f > 0 ? x + dx : x - dx - w);
    const r = (dx, dy, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(px(dx, w), y + dy, w, h); };
    const step = c.moving ? Math.floor(t * 8) % 2 : 0;
    if (c.sitting) {
      r(-4, -8, 7, 8, INK); r(-3, -7, 5, 7, '#3b3840'); r(0, -10, 5, 4, INK); r(1, -9, 3, 3, '#3b3840');
      r(1, -11, 1, 1, '#3b3840'); r(3, -11, 1, 1, '#3b3840'); r(2, -8, 1, 1, '#d9e05a');
      r(-6, -2 - (Math.floor(t * 2) % 2), 3, 1, '#3b3840');
      return;
    }
    r(-5, -6, 10, 5, INK); r(-4, -5, 8, 3, '#3b3840');
    r(3, -9, 5, 5, INK); r(4, -8, 3, 3, '#3b3840'); r(4, -9, 1, 1, '#3b3840'); r(6, -9, 1, 1, '#3b3840');
    r(6, -7, 1, 1, '#d9e05a');
    r(-7, -8 + step, 3, 1, '#3b3840'); r(-6, -7, 1, 2, '#3b3840');
    r(-3, -2, 1, 2 - step, '#3b3840'); r(2, -2, 1, 1 + step, '#3b3840');
  }

  function drawPigeon(ctx, b, t) {
    const x = Math.round(b.x); const y = Math.round(b.y); const f = b.facing;
    const px = (dx, w) => (f > 0 ? x + dx : x - dx - w);
    const r = (dx, dy, w, h, color) => { ctx.fillStyle = color; ctx.fillRect(px(dx, w), y + dy, w, h); };
    if (b.flying) {
      const flap = Math.floor(t * 12 + b.phase) % 2;
      r(-2, -2, 5, 2, '#7d7f8c'); r(-3, flap ? -4 : 0, 2, 2, '#9a9caa'); r(2, flap ? -4 : 0, 2, 2, '#9a9caa'); r(3, -2, 1, 1, '#c9c6d0');
      return;
    }
    const peck = b.peck ? 1 : 0;
    r(-3, -4, 6, 3, '#7d7f8c'); r(-3, -2, 5, 1, '#5d5f6c');
    r(2, -6 + peck * 2, 2, 2, '#8a8c99'); r(3, -5 + peck * 2, 1, 1, '#5aa07a');
    r(4, -5 + peck * 2, 1, 1, '#c98a5a');
    r(-1, -1, 1, 1, '#c96a5a'); r(1, -1, 1, 1, '#c96a5a');
  }

  /* ---------- эффекты ---------- */
  function drawHeart(ctx, x, y, color = '#e0485a') {
    const rows = ['.##.##.', '#######', '#######', '.#####.', '..###..', '...#...'];
    ctx.fillStyle = color;
    rows.forEach((row, ry) => [...row].forEach((ch, rx) => { if (ch === '#') ctx.fillRect(Math.round(x) + rx - 3, Math.round(y) + ry - 3, 1, 1); }));
    ctx.fillStyle = '#ffb3bd'; ctx.fillRect(Math.round(x) - 2, Math.round(y) - 2, 1, 1);
  }
  function drawSpark(ctx, x, y, size, color = '#ffe08a') {
    ctx.fillStyle = color;
    ctx.fillRect(Math.round(x) - size, Math.round(y), size * 2 + 1, 1);
    ctx.fillRect(Math.round(x), Math.round(y) - size, 1, size * 2 + 1);
  }
  function drawBomb(ctx, x, y, t) {
    ctx.fillStyle = INK; ctx.fillRect(x - 5, y - 6, 10, 6);
    ctx.fillStyle = '#5b4a36'; ctx.fillRect(x - 4, y - 5, 8, 4);
    ctx.fillStyle = '#c9372c'; ctx.fillRect(x - 3, y - 4, 2, 2);
    if (Math.floor(t * 4) % 2) { ctx.fillStyle = '#ff5a4a'; ctx.fillRect(x + 1, y - 5, 2, 2); }
    ctx.fillStyle = '#2b3a2b'; ctx.fillRect(x + 1, y - 3, 3, 1);
  }

  D.people = {
    OUTFITS, OUTFIT_KEYS, HEIGHT, outfitFor, hash,
    drawPerson, drawCar, drawGranny, drawCat, drawPigeon, drawHeadcrab, drawHeart, drawSpark, drawBomb,
  };
})(window.Dvor = window.Dvor || {});
