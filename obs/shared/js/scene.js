// Жизнь во дворе: зрители, их реплики, драки, обнимашки, машина, хедкраб, бомба.
(function (D) {
  'use strict';

  const cfg = D.config;
  const world = D.world;
  const P = D.people;
  const S = 4; // масштаб: 1 px мира = 4 px холста OBS
  // start — двор перед стримом; end — ночь, все расходятся по домам
  const END = cfg.mode === 'end';
  const closeOverride = /close=([\d.]+)/.exec(location.hash); // для превью: #demo&close=1
  const closeSeconds = (closeOverride ? Number(closeOverride[1]) : cfg.closeMinutes || 5) * 60;
  let timelineStart = 0;
  const wentHome = new Set();
  let summary = null;
  let lastPresence = null;
  const BAND = world.BAND;

  let clock = 0;
  const rand = (a, b) => a + Math.random() * (b - a);
  const pick = (list) => list[Math.floor(Math.random() * list.length)];
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  const hud = document.getElementById('hud');
  const people = new Map(); // login → person
  const effects = []; // частицы и прочее, рисуемые в canvas
  const floats = []; // надписи в DOM
  const cars = [];
  let crab = null;
  let bomb = null;
  let lastChatAt = -999;
  const lastChatBy = new Map();

  /* ---------- время для сценариев ---------- */
  const timers = [];
  function sleep(seconds) { return new Promise((resolve) => timers.push({ at: clock + seconds, resolve })); }
  class Abort extends Error {}
  function alive(...list) { for (const p of list) if (!p || p.gone) throw new Abort(); }

  /* ---------- цвета ников ---------- */
  const PALETTE = ['#e0864a', '#6fbf73', '#5fa8d3', '#d36f9a', '#d9c24a', '#a98bd9', '#4fc1b0', '#e06a5a'];
  function nameColor(login, color) {
    if (!/^#[0-9a-f]{6}$/i.test(color || '')) return PALETTE[P.hash(login) % PALETTE.length];
    return color;
  }
  function onDark(color) {
    const n = parseInt(color.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    if (lum >= 0.45) return color;
    const k = 0.5 - lum + 0.2;
    return `rgb(${c.map((v) => Math.round(v + (255 - v) * k)).join(',')})`;
  }
  function onPaper(color) {
    const n = parseInt(color.slice(1), 16);
    const c = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    const lum = (0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2]) / 255;
    if (lum <= 0.5) return color;
    const k = Math.min(0.6, lum - 0.3);
    return `rgb(${c.map((v) => Math.round(v * (1 - k))).join(',')})`;
  }

  /* ---------- люди ---------- */
  let doorFreeAt = 0;
  function createPerson({ login, name, color, outfit: forcedOutfit }, { fromDoor }) {
    const p = {
      login, name: name || login, color: nameColor(login, color), outfit: P.OUTFITS[forcedOutfit] ? forcedOutfit : P.outfitFor(login),
      x: fromDoor ? world.DOOR.x : rand(20, 620), y: fromDoor ? world.DOOR.y + 6 : rand(BAND.top + 4, BAND.bottom),
      facing: Math.random() < 0.5 ? 1 : -1, pose: 'stand', frame: 0, walked: 0,
      state: 'idle', timer: rand(0.5, 4), target: null, speed: 24, vx: 0,
      busy: false, lieUntil: 0, wanted: 0, extra: null, hidden: false, gone: false,
      bubbles: [], bubble: null, bubbleUntil: 0,
    };
    p.tag = el('div', 'tag');
    p.tag.textContent = p.name;
    p.tag.style.color = onDark(p.color);
    hud.append(p.tag);
    if (fromDoor) {
      // выходят из подъезда по одному
      const wait = Math.max(0, doorFreeAt - clock);
      doorFreeAt = Math.max(clock, doorFreeAt) + 1.3;
      p.hidden = true;
      p.state = 'waitDoor';
      p.timer = wait;
    }
    people.set(login, p);
    wentHome.delete(login);
    if (END) p.leaveAt = Math.max(clock + 25, timelineStart + rand(40, closeSeconds));
    return p;
  }

  function removePerson(p) {
    if (END) wentHome.add(p.login);
    p.gone = true;
    p.tag.remove();
    if (p.bubble) p.bubble.remove();
    people.delete(p.login);
  }

  function walkTo(p, x, y, speed = 26) {
    p.state = 'walk';
    p.target = { x: clamp(x, 8, 632), y: clamp(y, BAND.top, BAND.bottom) };
    p.speed = speed;
    return Promise.race([new Promise((resolve) => { p.onArrive = resolve; }), sleep(14)]);
  }

  function face(a, b) {
    a.facing = b.x >= a.x ? 1 : -1;
    b.facing = a.x > b.x ? 1 : -1;
  }

  function setPose(p, pose, seconds) {
    p.pose = pose;
    p.poseUntil = seconds ? clock + seconds : 0;
  }

  function knockDown(p, seconds, push = 0) {
    p.lieUntil = clock + seconds;
    p.pose = 'lie';
    p.vx = push;
    p.state = 'idle';
    p.target = null;
  }

  function updatePerson(p, dt) {
    // отлёт после удара
    if (Math.abs(p.vx) > 1) {
      p.x = clamp(p.x + p.vx * dt, 8, 632);
      p.vx *= Math.pow(0.02, dt);
    } else p.vx = 0;

    if (p.lieUntil) {
      if (clock < p.lieUntil) return;
      p.lieUntil = 0;
      p.pose = 'stand';
    }
    if (p.poseUntil && clock > p.poseUntil) { p.pose = 'stand'; p.poseUntil = 0; }
    if (p.state === 'waitDoor') {
      p.timer -= dt;
      if (p.timer > 0) return;
      world.openDoor(1.4);
      p.hidden = false;
      p.x = world.DOOR.x; p.y = world.DOOR.y + 6;
      walkTo(p, clamp(world.DOOR.x + rand(-80, 140), 12, 628), rand(BAND.top + 6, BAND.bottom), 24);
      return;
    }
    if (p.hidden) return;

    if (p.state === 'walk' && p.target) {
      const dx = p.target.x - p.x; const dy = p.target.y - p.y;
      const dist = Math.hypot(dx, dy);
      const step = p.speed * dt;
      if (dist <= step) {
        p.x = p.target.x; p.y = p.target.y; p.target = null;
        p.state = p.leaving ? 'gone' : 'idle';
        p.timer = rand(2, 7);
        if (p.pose === 'walk' || p.pose === 'run') p.pose = 'stand';
        if (p.onArrive) { const done = p.onArrive; p.onArrive = null; done(); }
      } else {
        p.x += (dx / dist) * step; p.y += (dy / dist) * step;
        if (Math.abs(dx) > 0.5) p.facing = dx > 0 ? 1 : -1;
        p.walked += step;
        p.frame = Math.floor(p.walked / (p.speed > 40 ? 4 : 3));
        if (!p.poseUntil) p.pose = p.speed > 40 ? 'run' : 'walk';
      }
      return;
    }
    if (p.state === 'gone') { world.openDoor(1.2); removePerson(p); return; }
    if (p.busy) return;

    p.timer -= dt;
    if (p.state === 'sit' && p.timer <= 0) { p.state = 'idle'; p.pose = 'stand'; p.y = BAND.top + 10; p.timer = 0.5; freeSeat(p); return; }
    if (p.state !== 'idle' || p.timer > 0) return;

    if (END && p.leaveAt && clock > p.leaveAt && !p.leaving) {
      p.leaveAt = 0;
      run('bye-' + p.login, goodbye(p));
      return;
    }
    // решаем, чем заняться
    if (p.pose === 'squat') p.pose = 'stand';
    const roll = Math.random();
    const seat = roll < 0.12 ? takeSeat(p) : null;
    if (seat != null) {
      walkTo(p, seat, BAND.top + 9).then(() => {
        if (p.gone || p.busy || p.seat !== seat) return;
        p.state = 'sit'; p.pose = 'sit'; p.facing = 1; p.y = world.BENCH.y + 1; p.timer = rand(10, 24);
      });
    } else if (roll < 0.22 && P.OUTFITS[p.outfit].squats) {
      p.pose = 'squat'; p.timer = rand(6, 14);
    } else if (roll < 0.32) {
      p.facing *= -1; p.timer = rand(1.5, 4);
    } else {
      const range = 90;
      walkTo(p, p.x + rand(-range, range), rand(BAND.top + 4, BAND.bottom), rand(20, 30));
    }
  }

  const seats = new Map(); // x → login
  function takeSeat(p) {
    for (const x of world.BENCH.seats.slice(1)) {
      if (!seats.has(x)) { seats.set(x, p.login); p.seat = x; return x; }
    }
    return null;
  }
  function freeSeat(p) { if (p.seat != null) { seats.delete(p.seat); p.seat = null; } }

  function free(list = [...people.values()]) {
    return list.filter((p) => !p.busy && !p.hidden && p.state !== 'waitDoor' && !p.lieUntil && p.state !== 'sit' && !p.leaving && !p.headcrab);
  }

  function engage(...list) {
    for (const p of list) {
      p.busy = true;
      if (p.state === 'sit') { freeSeat(p); p.y = BAND.top + 10; }
      p.state = 'idle'; p.target = null; p.pose = 'stand';
    }
  }
  function release(...list) {
    for (const p of list) { if (!p.gone) { p.busy = false; p.state = 'idle'; p.timer = rand(1, 3); if (!p.lieUntil) p.pose = 'stand'; } }
  }

  /* ---------- реплики ---------- */
  function el(tag, cls) { const n = document.createElement(tag); if (cls) n.className = cls; return n; }

  function say(p, content, { seconds, system } = {}) {
    if (!p || p.gone) return;
    p.bubbles.push({ content, seconds, system });
    if (p.bubbles.length > 3) p.bubbles.shift();
  }

  function showNextBubble(p) {
    const next = p.bubbles.shift();
    if (!next) return;
    const node = el('div', 'bubble' + (next.system ? ' bubble--shout' : ''));
    if (!next.system) {
      const who = el('b');
      who.textContent = p.name;
      who.style.color = onPaper(p.color);
      node.append(who);
    }
    const body = el('span');
    if (typeof next.content === 'string') body.textContent = next.content;
    else body.append(next.content);
    node.append(body);
    hud.append(node);
    const length = typeof next.content === 'string' ? next.content.length : (next.content.textContent || '').length + 8;
    p.bubble = node;
    p.bubbleUntil = clock + (next.seconds || clamp(2.8 + length * 0.07, 3, 10));
  }

  function updateBubble(p) {
    if (p.bubble && clock > p.bubbleUntil) { p.bubble.remove(); p.bubble = null; }
    if (!p.bubble && p.bubbles.length) showNextBubble(p);
  }

  /* ---------- сообщения чата ---------- */
  const emoteCatalog = new Map();
  function renderMessage(text, emotes) {
    const frag = document.createDocumentFragment();
    const chars = Array.from(String(text));
    const limit = 120;
    let cursor = 0; let used = 0;
    const pushText = (s) => {
      for (const part of s.split(/(\s+)/)) {
        if (!part || used > limit) continue;
        const emote = emoteCatalog.get(part);
        if (emote) { const img = el('img', 'emote'); img.src = emote.url; img.alt = part; frag.append(img); used += 3; continue; }
        let piece = /^https?:\/\//i.test(part) ? '[ссылка]' : part;
        if (used + piece.length > limit) piece = piece.slice(0, Math.max(0, limit - used)) + '…';
        used += piece.length;
        frag.append(document.createTextNode(piece));
      }
    };
    for (const e of (emotes || []).slice().sort((a, b) => a.start - b.start)) {
      if (e.start < cursor || e.end >= chars.length) continue;
      pushText(chars.slice(cursor, e.start).join(''));
      const img = el('img', 'emote');
      img.src = `https://static-cdn.jtvnw.net/emoticons/v2/${encodeURIComponent(e.id)}/default/dark/2.0`;
      frag.append(img); used += 3;
      cursor = e.end + 1;
    }
    pushText(chars.slice(cursor).join(''));
    const wrap = el('span');
    wrap.append(frag);
    return wrap;
  }

  function onChat(msg) {
    const login = String(msg.login || msg.nickname || '').toLowerCase();
    if (!login || !msg.message) return;
    let p = people.get(login);
    if (!p) p = admit({ login, name: msg.nickname, color: msg.color }, true);
    if (!p) return;
    if (msg.color) { p.color = nameColor(login, msg.color); p.tag.style.color = onDark(p.color); }
    if (END && p.leaveAt) p.leaveAt = Math.max(p.leaveAt, clock + 25);
    lastChatAt = clock;
    lastChatBy.set(login, clock);
    // говорящий останавливается и поворачивается к ближайшему соседу
    const near = [...people.values()].filter((o) => o !== p && !o.hidden && Math.abs(o.x - p.x) < 50 && Math.abs(o.y - p.y) < 20)[0];
    if (near && !p.busy && p.state !== 'sit') { p.state = 'idle'; p.target = null; p.pose = 'stand'; p.timer = 4; p.facing = near.x > p.x ? 1 : -1; }
    if (cfg.bubbles !== false) say(p, renderMessage(msg.message, msg.emotes));
  }

  /* ---------- кто во дворе ---------- */
  let presenceSeen = false;
  function admit(viewer, fromDoor) {
    if (people.size >= cfg.maxPeople) {
      // уступает место тот, кто дольше всех молчит
      const quiet = free().sort((a, b) => (lastChatBy.get(a.login) || -1) - (lastChatBy.get(b.login) || -1))[0];
      if (!quiet) return null;
      sendHome(quiet);
    }
    return createPerson(viewer, { fromDoor });
  }

  function sendHome(p) {
    if (p.leaving) return;
    p.leaving = true; p.busy = false; freeSeat(p);
    if (p.hidden) { removePerson(p); return; }
    p.state = 'walk'; p.target = { x: world.DOOR.x, y: BAND.top }; p.speed = 26;
  }

  function onPresence(list, restarting = false) {
    lastPresence = list;
    const wanted = new Map();
    for (const v of list) {
      const login = String(v.login).toLowerCase();
      if (!wentHome.has(login)) wanted.set(login, v);
    }
    const initial = !presenceSeen || restarting;
    presenceSeen = true;
    // недавно писавшие — в приоритете
    const ordered = [...wanted.values()].sort((a, b) => (lastChatBy.get(b.login) || -1) - (lastChatBy.get(a.login) || -1));
    let added = 0;
    for (const v of ordered) {
      if (people.has(v.login)) continue;
      if (people.size >= cfg.maxPeople) break;
      const p = createPerson(v, { fromDoor: !initial && added < 4 });
      if (!initial && added >= 4) { p.x = pick([-6, 646]); walkTo(p, rand(40, 600), rand(BAND.top + 6, BAND.bottom)); }
      added += 1;
    }
    for (const p of people.values()) {
      if (!wanted.has(p.login) && !wentHome.has(p.login) && clock - (lastChatBy.get(p.login) || -999) > 600) sendHome(p);
    }
  }

  /* ---------- сценарии ---------- */
  function floatText(text, x, y, cls, seconds = 3) {
    const node = el('div', 'float ' + (cls || ''));
    node.textContent = text;
    hud.append(node);
    floats.push({ node, x, y, until: clock + seconds, born: clock });
  }

  function hearts(x, y, n = 3) {
    for (let i = 0; i < n; i += 1) effects.push({ kind: 'heart', x: x + rand(-6, 6), y: y - rand(0, 4), vy: -rand(10, 18), born: clock + i * 0.25, life: 1.8 });
  }
  function sparks(x, y) {
    effects.push({ kind: 'spark', x, y, born: clock, life: 0.25, size: 3 });
  }
  const granny = { x: world.BENCH.seats[0], y: world.BENCH.y + 1, facing: 1, angry: -99, login: '__granny', name: 'Баба Валя', color: '#8f3a3a', bubbles: [], bubble: null };
  const GRANNY_LINES = ['Хулиганьё!', 'Щас милицию вызову!', 'Ни стыда ни совести', 'Совсем распустились', 'Я всё видела!'];
  function grannyReacts() {
    if (granny.gone || granny.leaving || clock < granny.angry + 6) return;
    granny.angry = clock;
    say(granny, pick(GRANNY_LINES), { seconds: 3 });
  }

  async function approach(a, b, gap) {
    const side = a.x <= b.x ? -1 : 1;
    await walkTo(a, b.x + side * gap, b.y, 30);
    alive(a, b);
    a.x = b.x + side * gap; a.y = b.y;
    face(a, b);
  }

  async function fight(a, b, { loser } = {}) {
    engage(a, b);
    await approach(a, b, 11);
    const rounds = 2 + Math.floor(Math.random() * 3);
    for (let i = 0; i < rounds; i += 1) {
      const [att, vic] = i % 3 === 2 ? [b, a] : [a, b];
      face(att, vic);
      setPose(att, 'punch', 0.22);
      await sleep(0.1); alive(a, b);
      setPose(vic, 'hit', 0.25);
      vic.vx = 26 * (vic.x > att.x ? 1 : -1);
      sparks((att.x + vic.x) / 2, vic.y - 18);
      await sleep(0.45); alive(a, b);
      setPose(att, 'fist'); setPose(vic, 'fist');
      await sleep(0.2); alive(a, b);
      // вернуться на дистанцию
      const side = a.x <= b.x ? -1 : 1;
      a.x = b.x + side * 11;
    }
    const lose = loser || (Math.random() < 0.65 ? b : a);
    const win = lose === a ? b : a;
    knockDown(lose, 4.5, 40 * (lose.x > win.x ? 1 : -1));
    floatText('ПОТРАЧЕНО', lose.x, lose.y - 22, 'float--wasted', 3.8);
    setPose(win, 'cheer', 1.4);
    win.wanted = clock + 9;
    grannyReacts();
    await sleep(1.6);
    release(win);
    await sleep(3);
    release(lose);
  }

  async function hug(a, b) {
    engage(a, b);
    await approach(a, b, 8);
    setPose(a, 'hug', 2.6); setPose(b, 'hug', 2.6);
    hearts((a.x + b.x) / 2, a.y - 30, 3);
    await sleep(2.7);
    release(a, b);
  }

  async function kiss(a, b) {
    engage(a, b);
    await approach(a, b, 7);
    setPose(a, 'kiss', 1.8); setPose(b, 'kiss', 1.8);
    a.extra = b.extra = { blush: true };
    hearts((a.x + b.x) / 2, a.y - 30, 1);
    effects.push({ kind: 'bigheart', x: (a.x + b.x) / 2, y: a.y - 34, born: clock, life: 1.6 });
    await sleep(2);
    a.extra = b.extra = null;
    if (Math.random() < 0.3) grannyReacts();
    release(a, b);
  }

  async function shove(a, b) {
    engage(a, b);
    await approach(a, b, 9);
    setPose(a, 'punch', 0.25);
    await sleep(0.1); alive(a, b);
    knockDown(b, 1.4, 110 * (b.x > a.x ? 1 : -1));
    sparks(b.x, b.y - 16);
    await sleep(1.6); alive(a, b);
    face(b, a);
    say(b, pick(['Э!', 'Ты чё?!', 'Не понял', 'Ну всё, держись']), { seconds: 2.5 });
    release(a, b);
  }

  async function bite(a, b) {
    engage(a, b);
    await approach(a, b, 7);
    setPose(a, 'kiss', 0.4);
    await sleep(0.2); alive(a, b);
    setPose(b, 'hit', 0.6); b.vx = 30 * (b.x > a.x ? 1 : -1);
    sparks(b.x, b.y - 18);
    say(b, pick(['Ай!', 'Ты кусаешься?!', 'АЙ, БЛИН']), { seconds: 2.2 });
    await sleep(1); release(a, b);
  }

  async function spit(a, b) {
    engage(a, b);
    const side = a.x <= b.x ? -1 : 1;
    await walkTo(a, b.x + side * 34, b.y, 28); alive(a, b);
    face(a, b);
    setPose(a, 'shout', 0.4);
    effects.push({ kind: 'spit', x: a.x + a.facing * 6, y: a.y - 22, tx: b.x, ty: b.y - 22, born: clock, life: 0.5 });
    await sleep(0.5); alive(a, b);
    setPose(b, 'hit', 0.5);
    say(b, pick(['Фу!', 'Ну ты свинья', 'Это что сейчас было']), { seconds: 2.5 });
    await sleep(0.8); release(a, b);
  }

  async function fusrodah(d) {
    engage(d);
    say(d, 'ФУС…', { seconds: 0.8, system: true });
    setPose(d, 'shout', 3);
    await sleep(0.8); alive(d);
    say(d, 'РО…', { seconds: 0.7, system: true });
    await sleep(0.7); alive(d);
    say(d, 'ДА!', { seconds: 1.2, system: true });
    effects.push({ kind: 'wave', x: d.x + d.facing * 8, y: d.y - 14, dir: d.facing, born: clock, life: 0.9 });
    for (const p of people.values()) {
      if (p === d || p.hidden) continue;
      const dx = (p.x - d.x) * d.facing;
      if (dx > 0 && dx < 130 && Math.abs(p.y - d.y) < 30) { p.busy = false; knockDown(p, 2.4, d.facing * (170 - dx)); }
    }
    scarePigeons(d.x, 200);
    grannyReacts();
    await sleep(1.2);
    release(d);
  }

  async function headcrabAttack() {
    const victims = free();
    if (!victims.length || crab) return;
    const v = pick(victims);
    crab = { x: world.MANHOLE.x, y: world.MANHOLE.y, z: 0, state: 'hop', frame: 0, target: v };
    effects.push({ kind: 'steam', x: world.MANHOLE.x, y: world.MANHOLE.y, born: clock, life: 1.5 });
    // прыжки к жертве
    for (let i = 0; i < 12 && crab && !v.gone && v.state !== 'sit'; i += 1) {
      const dx = v.x - crab.x; const dy = v.y - crab.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 14) break;
      const step = Math.min(30, dist);
      crab.hop = { fx: crab.x, fy: crab.y, tx: crab.x + (dx / dist) * step, ty: crab.y + (dy / dist) * step, start: clock, dur: 0.45 };
      await sleep(0.6);
    }
    if (v.gone || !crab) { crab = null; return; }
    engage(v);
    crab = null;
    v.headcrab = true;
    say(v, pick(['А-А-А! СНИМИТЕ!', 'ОНО НА ГОЛОВЕ', 'Мама!']), { seconds: 3 });
    v.busy = false;
    const until = clock + 7;
    const rescuer = free().find((p) => p.outfit === 'freeman' && p !== v);
    while (clock < until && !v.gone) {
      walkTo(v, rand(30, 610), rand(BAND.top + 4, BAND.bottom), 52);
      v.busy = true;
      scarePigeons(v.x, 40);
      if (rescuer && !rescuer.gone && Math.abs(rescuer.x - v.x) < 14 && Math.abs(rescuer.y - v.y) < 10) break;
      if (rescuer && !rescuer.gone) { rescuer.busy = true; walkTo(rescuer, v.x, v.y, 50); }
      await sleep(0.9);
    }
    if (v.gone) return;
    v.headcrab = false; v.target = null; v.state = 'idle';
    if (rescuer && !rescuer.gone) {
      face(rescuer, v);
      setPose(rescuer, 'punch', 0.3);
      sparks(v.x, v.y - 28);
      effects.push({ kind: 'deadcrab', x: v.x + 8 * rescuer.facing, y: v.y, born: clock, life: 2.5 });
      say(v, pick(['Спасибо, доктор', 'Фух…', 'Я обязан тебе жизнью']), { seconds: 2.6 });
      await sleep(1.2); release(rescuer);
    } else {
      effects.push({ kind: 'deadcrab', x: v.x + 10, y: v.y, born: clock, life: 2.5 });
    }
    release(v);
  }

  async function carRide(p) {
    if (cars.length) return;
    engage(p);
    const car = { x: -40, y: world.ROAD.laneY, facing: 1, color: Math.floor(Math.random() * 4), moving: true, dist: 0, driver: null };
    cars.push(car);
    const stopX = clamp(p.x, 80, 560);
    await driveTo(car, stopX);
    car.honk = clock;
    await walkTo(p, stopX - 2, BAND.bottom, 34);
    if (p.gone) { car.target = 700; car.done = true; return; }
    p.hidden = true; car.driver = p;
    await sleep(0.6);
    await driveTo(car, 720, 90);
    if (END) {
      // ночью такси увозит насовсем
      if (!p.gone) removePerson(p);
      cars.splice(cars.indexOf(car), 1);
      return;
    }
    await sleep(rand(8, 16));
    car.facing = -1; car.x = 720;
    const back = rand(120, 520);
    await driveTo(car, back, 90);
    car.honk = clock;
    if (!p.gone) {
      p.hidden = false; car.driver = null; p.carX = null;
      p.x = back + 4; p.y = BAND.bottom;
      say(p, pick(['Покатался', 'Кто последний — тот лох', 'Бензин кончился']), { seconds: 2.6 });
    }
    release(p);
    await sleep(0.8);
    await driveTo(car, -80, 80);
    cars.splice(cars.indexOf(car), 1);
  }

  function driveTo(car, x, speed = 70) {
    car.target = x; car.speed = speed; car.moving = true;
    return new Promise((resolve) => { car.onArrive = resolve; });
  }

  async function plantBomb(t) {
    if (bomb) return;
    engage(t);
    await walkTo(t, world.BOMBSITE.x, world.BOMBSITE.y, 30); alive(t);
    t.facing = 1;
    setPose(t, 'kneel', 3);
    say(t, 'Закладываю…', { seconds: 2.5 });
    await sleep(3); alive(t);
    bomb = { x: world.BOMBSITE.x + 8, y: world.BOMBSITE.y + 1, at: clock };
    floatText('БОМБА ЗАЛОЖЕНА', bomb.x, bomb.y - 34, 'float--bomb', 3);
    release(t);
    walkTo(t, t.x - 120, rand(BAND.top + 10, BAND.bottom), 50);

    const ct = free().find((p) => p.outfit === 'ct');
    if (ct) {
      engage(ct);
      await walkTo(ct, bomb.x - 8, bomb.y, 50);
      if (!ct.gone) {
        ct.facing = 1;
        setPose(ct, 'kneel', 4);
        await sleep(4);
        if (!ct.gone) {
          bomb = null;
          floatText('БОМБА ОБЕЗВРЕЖЕНА', ct.x, ct.y - 34, 'float--defused', 3.5);
          setPose(ct, 'cheer', 1.5);
          await sleep(1.5);
          release(ct);
          return;
        }
      }
    }
    await sleep(bomb ? Math.max(0, 10 - (clock - bomb.at)) : 0);
    if (!bomb) return;
    const { x, y } = bomb;
    bomb = null;
    effects.push({ kind: 'boom', x, y, born: clock, life: 1.4, parts: Array.from({ length: 40 }, () => ({ vx: rand(-90, 90), vy: rand(-130, -20), c: pick(['#ffd45a', '#ff8a3a', '#e0462e', '#5a5560']) })) });
    for (const p of people.values()) {
      if (p.hidden) continue;
      const d = Math.hypot(p.x - x, (p.y - y) * 2);
      if (d < 90) { p.busy = false; knockDown(p, 2.5, (p.x >= x ? 1 : -1) * (120 - d)); }
    }
    scarePigeons(x, 300);
    floatText('ТЕРРОРИСТЫ ПОБЕДИЛИ', x - 40, y - 46, 'float--bomb', 3.5);
    grannyReacts();
  }

  const NIGHT_LINES = ['Ещё одну катку и спать', 'Завтра на работу…', 'Хороший был стрим', 'Кто со мной до ларька?', 'Я ещё посижу', 'Холодно уже'];
  function quote() {
    if (clock - lastChatAt < 35) return;
    const p = pick(free());
    if (!p) return;
    say(p, pick(END ? NIGHT_LINES : P.OUTFITS[p.outfit].quotes), { seconds: 3.4 });
  }

  /* ---------- финал: прощание, поклон, бабушка ---------- */
  const BYE_LINES = ['Всем пока!', 'Спокойной ночи, чат', 'Было круто', 'Завтра приду', 'Ушёл спать', 'До завтра!', 'Спасибо за стрим!'];
  async function goodbye(p) {
    engage(p);
    p.facing = world.DOOR.x > p.x ? -1 : 1; // машет двору, а не стене
    setPose(p, 'cheer', 1.6);
    say(p, pick(BYE_LINES), { seconds: 2.6 });
    await sleep(1.8);
    if (p.gone) return;
    p.busy = false;
    sendHome(p);
  }

  let nextBowAt = 14;
  async function finalBow() {
    const top = ((summary && summary.topChatters) || []).slice(0, 5);
    const crew = [];
    for (const [i, c] of top.entries()) {
      const login = String(c.login).toLowerCase();
      let p = people.get(login);
      if (!p && !wentHome.has(login)) p = admit({ login, name: c.name }, true);
      if (p && !p.leaving) crew.push({ p, rank: i + 1 });
    }
    if (!crew.length) return;
    // дождаться, пока все выйдут из подъезда
    for (let i = 0; i < 30 && crew.some(({ p }) => p.state === 'waitDoor'); i += 1) await sleep(0.3);
    const team = crew.filter(({ p }) => !p.gone && !p.hidden && !p.leaving);
    if (!team.length) return;
    try {
      team.forEach(({ p }) => { p.busy = false; p.lieUntil = 0; });
      engage(...team.map(({ p }) => p));
      const xs = team.map((_, i) => 320 + (i - (team.length - 1) / 2) * 28);
      await Promise.all(team.map(({ p }, i) => walkTo(p, xs[i], 276, 34)));
      floatText('ЛУЧШИЕ В ЧАТЕ', 320, 232, 'float--title', 5);
      team.forEach(({ p, rank }, i) => {
        if (p.gone) return;
        p.facing = i < team.length / 2 ? 1 : -1;
        setPose(p, 'cheer', 3);
        floatText(`№${rank}`, p.x, p.y - 31, 'float--rank', 5);
      });
      hearts(320, 236, 4);
      await sleep(5);
    } finally {
      release(...team.map(({ p }) => p));
      team.forEach(({ p }) => { if (p.leaveAt) p.leaveAt = Math.max(p.leaveAt, clock + 30); });
    }
  }

  function updateGranny(dt) {
    if (!END || granny.gone) return;
    const elapsed = clock - timelineStart;
    if (!granny.leaving && (elapsed > closeSeconds * 0.85 || (people.size === 0 && elapsed > 90))) {
      granny.leaving = true;
      granny.walkAt = clock + 3;
      say(granny, 'Ну всё, и мне пора', { seconds: 3 });
    }
    if (!granny.leaving || clock < granny.walkAt) return;
    const tx = world.DOOR.x; const ty = BAND.top;
    const dx = tx - granny.x; const dy = ty - granny.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 1) {
      world.openDoor(1.2);
      granny.gone = true;
      granny.bubbles.length = 0;
      if (granny.bubble) { granny.bubble.remove(); granny.bubble = null; }
      return;
    }
    const step = Math.min(dist, 12 * dt);
    granny.x += (dx / dist) * step; granny.y += (dy / dist) * step;
    granny.facing = dx >= 0 ? 1 : -1;
    granny.pose = 'walk';
    granny.walked = (granny.walked || 0) + step;
    granny.frame = Math.floor(granny.walked / 3);
  }

  function plural(n, one, few, many) {
    const m10 = n % 10; const m100 = n % 100;
    if (m10 === 1 && m100 !== 11) return one;
    if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
    return many;
  }

  // Титры для табло собираются из итогов эфира.
  function creditsText() {
    if (!summary) return null;
    const parts = [];
    const t = summary.totals || {};
    if (t.chatters) parts.push(`В ЧАТЕ БЫЛО ${t.chatters} ${plural(t.chatters, 'ЧЕЛОВЕК', 'ЧЕЛОВЕКА', 'ЧЕЛОВЕК')} И ${t.messages} ${plural(t.messages, 'СООБЩЕНИЕ', 'СООБЩЕНИЯ', 'СООБЩЕНИЙ')}`);
    const top = (summary.topChatters || []).slice(0, 5);
    if (top.length) parts.push('ТОП ЧАТА: ' + top.map((c, i) => `${i + 1}. ${c.name} (${c.messages})`).join('   '));
    const names = (list) => list.slice(0, 15).map((e) => e.name).join(', ');
    if ((summary.followers || []).length) parts.push('НОВЫЕ ФОЛЛОВЕРЫ: ' + names(summary.followers));
    if ((summary.subscribers || []).length) parts.push('НОВЫЕ САБЫ: ' + names(summary.subscribers));
    if ((summary.donors || []).length) parts.push('СПАСИБО ЗА ПОДДЕРЖКУ: ' + names(summary.donors));
    return parts.length ? parts.join('   *   ') : null;
  }

  function restart() {
    timelineStart = clock;
    if (board) board.reset();
    if (!END) return;
    world.relight();
    world.lightsOut(clock, closeSeconds * 0.9);
    Object.assign(granny, { gone: false, leaving: false, pose: null, x: world.BENCH.seats[0], y: world.BENCH.y + 1, facing: 1 });
    wentHome.clear();
    for (const p of people.values()) { p.leaving = false; p.leaveAt = clock + rand(40, closeSeconds); }
    if (lastPresence) onPresence(lastPresence, true);
    nextBowAt = clock + 14;
  }

  /* ---------- режиссёр ---------- */
  let nextEventAt = 6;
  const running = new Set();
  const debug = location.hash.includes('debug');
  const debugErrors = [];
  function run(name, promise) {
    running.add(name);
    promise.catch((error) => { if (!(error instanceof Abort)) { console.error(name, error); debugErrors.push(name + ': ' + error.message); } })
      .finally(() => running.delete(name));
  }

  function pair(maxDist = 160) {
    const list = free();
    if (list.length < 2) return null;
    const a = pick(list);
    const near = list.filter((b) => b !== a && Math.abs(b.x - a.x) < maxDist);
    return near.length ? [a, pick(near)] : null;
  }

  const forced = [];
  const EVENT_ROLL = { fight: 0.1, hug: 0.3, kiss: 0.4, shove: 0.5, fus: 0.6, crab: 0.66, car: 0.75, bomb: 0.83, quote: 0.95 };
  // В config.disableEvents можно выключить сценарии: car, bomb, crab, fus, fight, hug, kiss, shove.
  const disabled = new Set(cfg.disableEvents || []);
  function direct() {
    if (END && clock > nextBowAt && summary && !running.has('bow')) {
      nextBowAt = clock + 150;
      run('bow', finalBow());
      return;
    }
    if (clock < nextEventAt) return;
    if (END && !forced.length) {
      nextEventAt = clock + rand(6, 12);
      if (running.size >= 3) return;
      const roll = Math.random();
      const list = free();
      if (roll < 0.35) { const pr = pair(); if (pr) run('hug', hug(...pr)); return; }
      if (roll < 0.45) { const pr = pair(); if (pr) run('kiss', kiss(...pr)); return; }
      if (roll < 0.53) { const pr = pair(); if (pr) run('shove', shove(...pr)); return; }
      if (roll < 0.60) { const pr = pair(); if (pr) run('fight', fight(...pr)); return; }
      if (roll < 0.78 && !disabled.has('car') && !running.has('car') && list.length) { run('car', carRide(pick(list))); return; }
      quote();
      return;
    }
    nextEventAt = clock + (forced.length ? 2.5 : rand(5, 11));
    if (running.size >= 3) return;
    let roll = forced.length ? EVENT_ROLL[forced.shift()] : Math.random();
    const bands = [['fight', 0.22], ['hug', 0.36], ['kiss', 0.44], ['shove', 0.56], ['fus', 0.63], ['crab', 0.70], ['car', 0.80], ['bomb', 0.86]];
    const band = bands.find(([, upTo]) => roll < upTo);
    if (band && disabled.has(band[0])) roll = 0.99; // выключенный сценарий → просто реплика
    const list = free();
    if (roll < 0.22) { const pr = pair(); if (pr) run('fight', fight(...pr)); return; }
    if (roll < 0.36) { const pr = pair(); if (pr) run('hug', hug(...pr)); return; }
    if (roll < 0.44) { const pr = pair(); if (pr) run('kiss', kiss(...pr)); return; }
    if (roll < 0.56) { const pr = pair(); if (pr) run('shove', shove(...pr)); return; }
    if (roll < 0.63) { const d = list.find((p) => p.outfit === 'dovah'); if (d && list.length > 1) run('fus', fusrodah(d)); return; }
    if (roll < 0.70 && !running.has('crab')) { run('crab', headcrabAttack()); return; }
    if (roll < 0.80 && !running.has('car') && list.length) { run('car', carRide(pick(list))); return; }
    if (roll < 0.86 && !running.has('bomb')) { const t = list.find((p) => p.outfit === 'terror'); if (t) run('bomb', plantBomb(t)); return; }
    quote();
  }

  // Команды чата: !обнять, !шлёп, !убить, !кусь, !тьфу, !секс
  function onAction(action) {
    const actor = getOrAdmit(action.actor);
    if (!actor) return;
    let target = action.target ? getOrAdmit(action.target) : null;
    if (target === actor) target = null;
    if (!target) target = free().filter((p) => p !== actor).sort((a, b) => Math.abs(a.x - actor.x) - Math.abs(b.x - actor.x))[0];
    if (!target) return;
    for (const p of [actor, target]) { p.busy = false; p.lieUntil = 0; p.pose = 'stand'; if (p.hidden) return; }
    const map = { hug, kiss, slap: shove, kill: (a, b) => fight(a, b, { loser: b }), bite, spit };
    const fn = map[action.action];
    if (fn) run('cmd-' + clock, fn(actor, target));
  }
  function getOrAdmit(who) {
    if (!who || !who.login) return null;
    const login = String(who.login).toLowerCase();
    return people.get(login) || admit({ login, name: who.name }, true);
  }

  function onRaid(raid) {
    floatText(`РЕЙД: ${raid.name} +${raid.viewers}`, 320, 150, 'float--raid', 6);
    const p = getOrAdmit(raid);
    if (p) setPose(p, 'cheer', 3);
  }

  /* ---------- голуби и кот ---------- */
  const pigeons = Array.from({ length: 5 }, (_, i) => ({ x: 230 + i * 22 + rand(-6, 6), y: BAND.bottom - rand(1, 12), facing: Math.random() < 0.5 ? 1 : -1, peck: false, t: rand(0, 2), phase: i, flying: false, home: null }));
  pigeons.forEach((b) => { b.home = { x: b.x, y: b.y }; });
  function scarePigeons(x, radius) {
    for (const b of pigeons) {
      if (!b.flying && Math.abs(b.x - x) < radius) { b.flying = true; b.vx = (b.x >= x ? 1 : -1) * rand(50, 80); b.vy = -rand(40, 60); b.back = clock + rand(25, 50); }
    }
  }
  function updatePigeons(dt) {
    for (const b of pigeons) {
      if (b.flying) {
        b.x += b.vx * dt; b.y += b.vy * dt;
        if (clock > b.back) { b.flying = false; b.x = b.home.x; b.y = b.home.y; }
        continue;
      }
      b.t -= dt;
      if (b.t <= 0) { b.t = rand(0.3, 1.6); b.peck = !b.peck && Math.random() < 0.6; if (Math.random() < 0.3) { b.facing *= -1; b.x += b.facing * 2; } }
      for (const p of people.values()) {
        if (!p.hidden && (p.pose === 'run' || Math.abs(p.vx) > 40) && Math.abs(p.x - b.x) < 26 && Math.abs(p.y - b.y) < 14) scarePigeons(b.x, 30);
      }
    }
  }
  const cat = { x: 520, y: BAND.top + 22, facing: -1, t: 3, sitting: true, moving: false, target: null };
  function updateCat(dt) {
    cat.t -= dt;
    if (cat.target) {
      const dx = cat.target - cat.x;
      if (Math.abs(dx) < 1) { cat.target = null; cat.moving = false; cat.sitting = Math.random() < 0.6; cat.t = rand(4, 12); } else { cat.x += Math.sign(dx) * 14 * dt; cat.facing = Math.sign(dx); cat.moving = true; }
    } else if (cat.t <= 0) { cat.sitting = false; cat.target = rand(430, 626); }
  }

  /* ---------- снег ---------- */
  const flakes = cfg.snow ? Array.from({ length: 70 }, () => ({ x: rand(0, 640), y: rand(0, 360), v: rand(8, 18), p: rand(0, 6.28) })) : [];

  /* ---------- кадр ---------- */
  const canvas = document.getElementById('world');
  const ctx = canvas.getContext('2d');
  ctx.imageSmoothingEnabled = false;
  let board = null;

  function updateCars(dt) {
    for (const car of cars) {
      if (car.target == null) continue;
      const dx = car.target - car.x;
      const step = (car.speed || 70) * dt;
      if (Math.abs(dx) <= step) {
        car.x = car.target; car.target = null; car.moving = false;
        if (car.onArrive) { const done = car.onArrive; car.onArrive = null; done(); }
      } else { car.x += Math.sign(dx) * step; car.dist += step; car.facing = Math.sign(dx); }
    }
  }

  function updateCrab() {
    if (!crab || !crab.hop) return;
    const h = crab.hop;
    const k = clamp((clock - h.start) / h.dur, 0, 1);
    crab.x = h.fx + (h.tx - h.fx) * k; crab.y = h.fy + (h.ty - h.fy) * k;
    crab.z = Math.sin(k * Math.PI) * 10;
    crab.frame = Math.floor(clock * 8);
  }

  function drawEffects() {
    for (let i = effects.length - 1; i >= 0; i -= 1) {
      const e = effects[i];
      const age = clock - e.born;
      if (age < 0) continue;
      if (age > e.life) { effects.splice(i, 1); continue; }
      const k = age / e.life;
      if (e.kind === 'heart') P.drawHeart(ctx, e.x, e.y + e.vy * age);
      else if (e.kind === 'bigheart') { const s = Math.floor(clock * 6) % 2; P.drawHeart(ctx, e.x, e.y - k * 8); if (s) P.drawHeart(ctx, e.x, e.y - k * 8, '#ff7080'); }
      else if (e.kind === 'spark') P.drawSpark(ctx, e.x, e.y, Math.max(1, Math.round(e.size * (1 - k))));
      else if (e.kind === 'spit') { ctx.fillStyle = '#cfe0e8'; ctx.fillRect(Math.round(e.x + (e.tx - e.x) * k), Math.round(e.y + (e.ty - e.y) * k - Math.sin(k * Math.PI) * 10), 2, 2); }
      else if (e.kind === 'wave') {
        ctx.fillStyle = '#dfe8f2';
        for (let r = 0; r < 3; r += 1) {
          const radius = (k * 120) - r * 14;
          if (radius < 4) continue;
          for (let a = -0.6; a <= 0.6; a += 0.05) {
            if (Math.random() < 0.35) continue;
            ctx.fillRect(Math.round(e.x + Math.cos(a) * radius * e.dir), Math.round(e.y + Math.sin(a) * radius * 0.5), 1, 1);
          }
        }
      } else if (e.kind === 'boom') {
        for (const p of e.parts) {
          ctx.fillStyle = p.c;
          ctx.fillRect(Math.round(e.x + p.vx * age), Math.round(e.y + p.vy * age + 140 * age * age), 2, 2);
        }
        if (age < 0.25) { ctx.fillStyle = '#fff3c4'; ctx.fillRect(e.x - 12, e.y - 18, 24, 18); }
      } else if (e.kind === 'steam') {
        ctx.globalAlpha = 0.5 * (1 - k); ctx.fillStyle = '#c9ccd6';
        for (let j = 0; j < 5; j += 1) ctx.fillRect(Math.round(e.x - 6 + j * 3 + Math.sin(age * 3 + j) * 2), Math.round(e.y - 4 - age * 18 - j * 2), 3, 2);
        ctx.globalAlpha = 1;
      } else if (e.kind === 'deadcrab') {
        ctx.save(); ctx.translate(Math.round(e.x), Math.round(e.y)); ctx.scale(1, -1);
        P.drawHeadcrab(ctx, -5, -2, 0, false); ctx.restore();
      }
    }
  }

  function drawWanted(p) {
    if (!p.wanted || clock > p.wanted) return;
    const stars = 2;
    for (let i = 0; i < stars; i += 1) {
      const x = Math.round(p.x) - 6 + i * 8; const y = Math.round(p.y) - 36;
      ctx.fillStyle = '#14111c'; ctx.fillRect(x - 1, y - 1, 7, 7);
      ctx.fillStyle = Math.floor(clock * 4) % 2 ? '#f2c94a' : '#fff1b0';
      ctx.fillRect(x + 2, y, 1, 5); ctx.fillRect(x, y + 2, 5, 1); ctx.fillRect(x + 1, y + 1, 3, 3);
    }
  }

  function frame(t, dt) {
    world.drawStatic(ctx);
    world.drawAmbient(ctx, t, dt);
    if (board) board.draw(ctx, t * 1000);

    // всё, что стоит на земле, — по глубине
    const items = [];
    for (const prop of world.props) items.push({ y: prop.y, draw: () => ctx.drawImage(prop.canvas, prop.x, prop.top) });
    if (!granny.gone) items.push({ y: granny.y, draw: () => P.drawGranny(ctx, { ...granny, angry: clock - granny.angry < 2.5 }, t) });
    items.push({ y: cat.y, draw: () => P.drawCat(ctx, cat, t) });
    for (const b of pigeons) if (!b.flying) items.push({ y: b.y, draw: () => P.drawPigeon(ctx, b, t) });
    for (const p of people.values()) if (!p.hidden) items.push({ y: p.y + (p.pose === 'lie' ? 0.5 : 0), draw: () => { P.drawPerson(ctx, p); drawWanted(p); } });
    for (const car of cars) items.push({ y: car.y, draw: () => P.drawCar(ctx, car, t) });
    if (crab) items.push({ y: crab.y, draw: () => P.drawHeadcrab(ctx, Math.round(crab.x) - 5, Math.round(crab.y - 5 - crab.z), crab.frame, false) });
    if (bomb) items.push({ y: bomb.y, draw: () => P.drawBomb(ctx, bomb.x, bomb.y, t) });
    items.sort((a, b) => a.y - b.y);
    for (const item of items) item.draw();

    for (const b of pigeons) if (b.flying) P.drawPigeon(ctx, b, t);
    drawEffects();

    ctx.fillStyle = '#e9edf5';
    for (const f of flakes) {
      f.y += f.v * dt; f.x += Math.sin(t + f.p) * 6 * dt;
      if (f.y > 360) { f.y = -2; f.x = rand(0, 640); }
      ctx.globalAlpha = 0.75;
      ctx.fillRect(Math.round(f.x), Math.round(f.y), 1, 1);
    }
    ctx.globalAlpha = 1;
  }

  /* ---------- подписи и реплики поверх canvas ---------- */
  function layoutHud() {
    const placed = [];
    const tags = [];
    const all = granny.gone ? [...people.values()] : [...people.values(), granny];
    for (const p of all) {
      if (p !== granny) {
        const inCar = p.hidden && p.carX != null;
        const hideTag = (p.hidden && !inCar) || p.bubble || p.pose === 'lie';
        p.tag.style.display = hideTag ? 'none' : '';
        const tx = inCar ? p.carX : p.x;
        const ty = inCar ? world.ROAD.laneY - 30 : p.y + 2;
        if (!hideTag) {
          const w = p.tag.offsetWidth || 80;
          const x = tx * S - w / 2;
          let y = ty * S;
          for (let guard = 0; guard < 4; guard += 1) {
            const hit = tags.find((r) => x < r.x + r.w && x + w > r.x && y < r.y + 24 && y + 24 > r.y);
            if (!hit) break;
            y = hit.y + 24;
          }
          tags.push({ x, y, w });
          p.tag.style.transform = `translate(${Math.round(x)}px, ${Math.round(y)}px)`;
        }
      }
      updateBubble(p);
      if (!p.bubble) continue;
      const anchorX = p.hidden && p.carX != null ? p.carX : p.x;
      const headY = (p === granny ? p.y - 22 : p.y - P.HEIGHT - (p.pose === 'squat' ? -6 : 4)) * S;
      const w = p.bubble.offsetWidth; const h = p.bubble.offsetHeight;
      let left = clamp(anchorX * S - w / 2, 12, 2548 - w);
      let top = headY - h - 18;
      // не налезать на соседние реплики
      for (let guard = 0; guard < 6; guard += 1) {
        const hit = placed.find((r) => left < r.x + r.w + 8 && left + w + 8 > r.x && top < r.y + r.h + 6 && top + h + 6 > r.y);
        if (!hit) break;
        top = hit.y - h - 10;
      }
      top = Math.max(8, top);
      placed.push({ x: left, y: top, w, h });
      p.bubble.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
      p.bubble.style.setProperty('--tail', `${clamp(Math.round(anchorX * S - left), 18, w - 18)}px`);
    }
    for (let i = floats.length - 1; i >= 0; i -= 1) {
      const f = floats[i];
      if (clock > f.until) { f.node.remove(); floats.splice(i, 1); continue; }
      const rise = Math.min(1, (clock - f.born) / 0.25);
      f.node.style.opacity = clock > f.until - 0.4 ? String((f.until - clock) / 0.4) : '1';
      const fw = f.node.offsetWidth;
      const fx = clamp(f.x * S - fw / 2, 16, 2544 - fw);
      f.node.style.transform = `translate(${Math.round(fx)}px, ${Math.round((f.y - rise * 6) * S)}px) translateY(-100%)`;
    }
  }

  /* ---------- цикл ---------- */
  let last = performance.now();
  function loop(now) {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    clock += dt;
    for (let i = timers.length - 1; i >= 0; i -= 1) if (timers[i].at <= clock) { timers[i].resolve(); timers.splice(i, 1); }
    for (const p of [...people.values()]) updatePerson(p, dt);
    updateGranny(dt);
    for (const car of cars) if (car.driver) car.driver.carX = car.x;
    updateCars(dt); updateCrab(); updatePigeons(dt); updateCat(dt);
    direct();
    frame(clock, dt);
    layoutHud();
    if (debug) document.title = JSON.stringify({ clock: +clock.toFixed(1), running: [...running], forced, next: +nextEventAt.toFixed(1), people: people.size, free: free().length, errors: debugErrors });
    requestAnimationFrame(loop);
  }

  function start() {
    world.build({ night: END });
    if (cfg.board) {
      const items = () => cfg.board.map((item) => (item.credits ? { ...item, text: creditsText } : item));
      board = D.led.createBoard({ x: 30, y: 58, cols: 126, items });
    }
    if (END) world.lightsOut(0, closeSeconds * 0.9);
    requestAnimationFrame(loop);
  }

  D.scene = {
    start, onChat, onPresence, onAction, onRaid,
    restart,
    setSummary(value) { summary = value || null; },
    force(names) { forced.push(...names.filter((n) => n in EVENT_ROLL)); nextEventAt = clock + 1.5; },
    setEmotes(list) { emoteCatalog.clear(); for (const e of list || []) if (e && e.name && e.url) emoteCatalog.set(e.name, e); },
    removeMessagesOf(login) { const p = people.get(login); if (p) { p.bubbles.length = 0; if (p.bubble) { p.bubble.remove(); p.bubble = null; } } },
    get people() { return people; },
  };
})(window.Dvor = window.Dvor || {});
