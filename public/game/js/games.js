/* ============ Мини-игры (приложение «Игры») ============
   Все игры рассчитаны на один ввод: клик мышью или тап по экрану.
   За очки начисляются монеты (с дневным лимитом), рекорды хранятся в сейве. */
'use strict';

const GAMES_LIST = [
  {
    id: 'memory', name: 'Пары', ico: '🧠',
    grad: 'linear-gradient(135deg,#8f6cff,#5f8bff)',
    desc: 'Открывай карточки и находи одинаковые',
    rules: 'Открывай по две карточки и находи все пары.<br>Чем меньше ходов и времени — тем больше очков.',
    coinsFor: s => Math.min(60, Math.round(s / 18))
  },
  {
    id: 'mole', name: 'Тапалка', ico: '🔨',
    grad: 'linear-gradient(135deg,#ffb020,#ff7a00)',
    desc: 'Успей тапнуть всех, кто выглянет из укрытия',
    rules: '30 секунд: тапай по всем, кто высовывается.<br>🙂 +1 · ⭐ +3 · 💥 −2 (минус два очка).',
    coinsFor: s => Math.min(50, Math.round(s * 1.5))
  },
  {
    id: 'simon', name: 'Повторяй', ico: '🎵',
    grad: 'linear-gradient(135deg,#43d17c,#1fa855)',
    desc: 'Запоминай мелодию из цветов и повтори',
    rules: 'Смотри, какие цвета загораются, и повтори последовательность.<br>С каждым раундом она длиннее и быстрее.',
    coinsFor: s => Math.min(60, s * 8)
  },
  {
    id: 'cups', name: 'Стаканчики', ico: '🥤',
    grad: 'linear-gradient(135deg,#ff6b8d,#ff3d6e)',
    desc: 'Следи, под каким стаканом конфета',
    rules: 'Конету накроют стаканом и быстро перемешают.<br>Угадай, где она. Жизни три, ошибка — минус ❤.',
    coinsFor: s => Math.min(60, s * 6)
  },
  {
    id: 'flappy', name: 'Птичка', ico: '🐦',
    grad: 'linear-gradient(135deg,#59c2ff,#2f7fd6)',
    desc: 'Проведи птичку сквозь щели между колоннами',
    rules: 'Тапай (или кликай), чтобы птичка взмахивала крыльями.<br>Каждая пройденная щель — очко, скорость растёт. Одно столкновение — конец полёта.',
    coinsFor: s => Math.min(60, s * 4)
  }
];

// общий помощник: таймеры конкретной партии, чтобы уметь всё разом погасить
function mgTimers(){
  const list = [];
  return {
    set(fn, ms){ const id = setTimeout(fn, ms); list.push(id); return id; },
    every(fn, ms){ const id = setInterval(fn, ms); list.push(id); return id; },
    cancel(id){ clearTimeout(id); clearInterval(id); },
    clearAll(){ list.forEach(id => { clearTimeout(id); clearInterval(id); }); list.length = 0; }
  };
}

const MiniGames = {
  DAILY_CAP: 200,          // максимум монет в день со всех мини-игр
  activeId: null,
  inst: null,              // запущенный экземпляр игры
  reviveUsed: false,
  _over: false,

  def(id){ return GAMES_LIST.find(g => g.id === id) || null; },
  best(id){ const g = Game.state.games; return (g && g.best && g.best[id]) || 0; },
  today(){ const g = Game.state.games; return (g.dayKey === Game.state.day ? g.coinsDay : 0); },

  /* ---------- список игр ---------- */

  renderList(){
    const cap = document.getElementById('games-cap');
    if (cap) cap.textContent = '🪙 ' + this.today() + '/' + this.DAILY_CAP;
    const list = document.getElementById('games-list');
    if (!list) return;
    list.innerHTML =
      '<div class="games-note">Все игры — одним касанием: мышь или палец.<br>' +
      'За очки капают монеты — до ' + this.DAILY_CAP + ' 🪙 в день.</div>' +
      GAMES_LIST.map(d => `
        <button class="game-card" data-game="${d.id}">
          <span class="game-ico" style="background:${d.grad}">${d.ico}</span>
          <span class="game-info">
            <span class="game-name">${d.name}</span>
            <span class="game-desc">${d.desc}</span>
          </span>
          <span class="game-best">🏆 ${this.best(d.id)}</span>
        </button>`).join('');
    list.querySelectorAll('[data-game]').forEach(b =>
      b.addEventListener('click', () => this.launch(b.dataset.game)));
  },

  launch(id){
    if (!this.def(id)) return;
    this.activeId = id;
    this.reviveUsed = false;
    UI.show('minigame');
  },

  /* ---------- экран мини-игры ---------- */

  onScreen(){
    const d = this.def(this.activeId);
    if (!d){ UI.show('games'); return; }
    document.getElementById('mg-title').textContent = d.name;
    this._updateBest();
    this._rulesScreen(d);
  },

  _updateBest(){
    const el = document.getElementById('mg-best');
    if (el) el.textContent = '🏆 ' + this.best(this.activeId);
  },

  _updateCap(){
    const el = document.getElementById('games-cap');
    if (el) el.textContent = '🪙 ' + this.today() + '/' + this.DAILY_CAP;
  },

  _stage(){ return document.getElementById('mg-stage'); },

  _rulesScreen(d){
    const st = this._stage();
    st.innerHTML = '';
    const root = document.createElement('div');
    root.className = 'mg-root mg-rules';
    root.innerHTML = `
      <div class="mg-rules-ico" style="background:${d.grad}">${d.ico}</div>
      <div class="mg-rules-name">${d.name}</div>
      <div class="mg-rules-text">${d.rules}</div>
      <button class="mg-play">▶ Играть</button>
      <div class="mg-rules-best">Рекорд: 🏆 ${this.best(d.id)}</div>`;
    st.appendChild(root);
    root.querySelector('.mg-play').addEventListener('click', () => this._run(d));
  },

  _run(d){
    this._teardown();
    this._over = false;
    const st = this._stage();
    st.innerHTML = '';
    YSDK.gameplayStart();
    this.inst = d.create(st, {
      over: (score, opts) => this._finish(score, opts || {})
    });
  },

  _teardown(){
    if (this.inst && this.inst.destroy){ try { this.inst.destroy(); } catch(e){} }
    this.inst = null;
  },

  // полный выход из мини-игры (вызывается из UI.show при уходе с экрана)
  stop(){
    this._teardown();
    const st = this._stage();
    if (st) st.innerHTML = '';
    YSDK.gameplayStop();
  },

  /* ---------- финал партии ---------- */

  _finish(score, opts){
    if (this._over || !this.inst) return;
    this._over = true;
    const d = this.def(this.activeId);
    if (!d) return;
    const s = Game.state, g = s.games;
    if (g.dayKey !== s.day){ g.dayKey = s.day; g.coinsDay = 0; }
    const isNew = score > (g.best[d.id] || 0);
    if (isNew) g.best[d.id] = score;
    const base = Math.max(0, Math.round(d.coinsFor(score) || 0));
    const left = Math.max(0, this.DAILY_CAP - g.coinsDay);
    const earned = Math.min(base, left);
    g.coinsDay += earned;
    s.coins += earned;
    if (this.inst && this.inst.pause) this.inst.pause();
    // партия занимает время в мире игры (как диалог)
    Game.bumpClock(12 + Math.floor(Math.random() * 16));
    Game.save();
    UI.renderBadges();
    this._updateBest();
    this._updateCap();
    if (isNew && score > 0) UI.toast('🏆 Новый рекорд: ' + score);
    this._resultScreen(d, score, isNew, earned, base, opts);
  },

  _resultScreen(d, score, isNew, earned, base, opts){
    const st = this._stage();
    const ov = document.createElement('div');
    ov.className = 'mg-overlay';
    const canRevive = !!(opts && opts.revive) && !this.reviveUsed && score > 0;
    let coinsLine = '';
    if (base > 0){
      if (earned > 0){
        coinsLine = `<div class="mg-coins">+${earned} 🪙</div>`;
        if (earned < base) coinsLine += `<div class="mg-capped">дневной лимит: ${this.today()}/${this.DAILY_CAP} 🪙</div>`;
      } else {
        coinsLine = `<div class="mg-capped">монеты за сегодня заработаны (${this.DAILY_CAP}/${this.DAILY_CAP})<br>рекорды всё ещё считаются</div>`;
      }
    }
    ov.innerHTML = `
      <div class="mg-result">
        <div class="mg-res-title">${score > 0 ? 'Готово!' : 'Увы!'}</div>
        <div class="mg-res-score">${score}</div>
        <div class="mg-res-sub">очков · рекорд 🏆 ${this.best(d.id)}${isNew ? ' · новый!' : ''}</div>
        ${coinsLine}
        <div class="mg-res-actions"></div>
      </div>`;
    const act = ov.querySelector('.mg-res-actions');
    const addBtn = (label, cls, fn) => {
      const b = document.createElement('button');
      b.className = 'm-btn ' + cls;
      b.textContent = label;
      b.addEventListener('click', fn);
      act.appendChild(b);
      return b;
    };

    if (canRevive){
      addBtn('▶ Второй шанс за рекламу', 'primary', () => {
        YSDK.showRewarded(() => {
          this.reviveUsed = true;
          this._over = false;         // партия продолжается — финал будет ещё раз
          ov.remove();
          opts.revive();
        });
      });
    } else if (earned > 0){
      const b = addBtn('▶ Удвоить монеты за рекламу', 'primary', () => {
        YSDK.showRewarded(() => {
          Game.state.coins += earned;
          Game.state.games.coinsDay += earned;
          Game.save();
          UI.renderBadges();
          this._updateCap();
          UI.toast('+' + earned + ' 🪙 за рекламу');
          b.disabled = true;
          b.textContent = 'Начислено ✓';
        });
      });
    }
    addBtn('Ещё раз', '', () => { ov.remove(); this._run(d); });
    addBtn('К списку игр', '', () => UI.show('games'));
    st.appendChild(ov);
  },

  /* ---------- звук / вибрация ---------- */

  beep(freq, dur = 0.08, type = 'sine', vol = 0.06){
    if (!Game.state || !Game.state.sound) return;
    try {
      Game._ctx = Game._ctx || new (window.AudioContext || window.webkitAudioContext)();
      const ctx = Game._ctx;
      const o = ctx.createOscillator(), g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.setValueAtTime(vol, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + dur);
      o.connect(g); g.connect(ctx.destination);
      o.start(); o.stop(ctx.currentTime + dur + 0.02);
    } catch(e){}
  },

  vibe(p){ if (navigator.vibrate) try { navigator.vibrate(p); } catch(e){} }
};

/* ================= 1. Пары (memory) ================= */

GAMES_LIST[0].create = function(stage, api){
  const root = document.createElement('div');
  root.className = 'mg-root mg-mem';
  const emojis = ['📚','✏️','🎒','🏀','🎧','🍎','🧃','🗺️'];
  const deck = emojis.concat(emojis).sort(() => Math.random() - 0.5);
  root.innerHTML = `<div class="mg-hud"><span>Ходы: <b class="j-moves">0</b></span><span>⏱ <b class="j-time">0</b></span></div>
    <div class="mg-mem-grid"></div>`;
  const grid = root.querySelector('.mg-mem-grid');
  deck.forEach(e => {
    const c = document.createElement('button');
    c.className = 'mg-card';
    c.dataset.e = e;
    c.innerHTML = `<span class="mg-card-in"><span class="mg-card-front">🏫</span><span class="mg-card-back">${e}</span></span>`;
    grid.appendChild(c);
  });
  stage.appendChild(root);

  const T = mgTimers();
  let open = [], lock = false, moves = 0, sec = 0, matched = 0, done = false;
  T.every(() => {
    if (done) return;
    sec++;
    root.querySelector('.j-time').textContent = sec;
  }, 1000);

  grid.addEventListener('pointerdown', e => {
    const c = e.target.closest('.mg-card');
    if (!c || lock || done || c.classList.contains('open') || c.classList.contains('done')) return;
    c.classList.add('open');
    MiniGames.beep(540, .05);
    open.push(c);
    if (open.length < 2) return;
    moves++;
    root.querySelector('.j-moves').textContent = moves;
    const a = open[0], b = open[1];
    if (a.dataset.e === b.dataset.e){
      a.classList.add('done'); b.classList.add('done');
      MiniGames.beep(800, .09);
      MiniGames.vibe(12);
      open = [];
      matched++;
      if (matched === emojis.length){
        done = true;
        const score = Math.max(50, 1500 - moves * 40 - sec * 5);
        T.set(() => api.over(score), 550);
      }
    } else {
      lock = true;
      T.set(() => {
        a.classList.remove('open'); b.classList.remove('open');
        open = []; lock = false;
      }, 750);
    }
  });

  return { destroy(){ T.clearAll(); root.remove(); } };
};

/* ================= 2. Тапалка (кроты) ================= */

GAMES_LIST[1].create = function(stage, api){
  const root = document.createElement('div');
  root.className = 'mg-root mg-mole';
  root.innerHTML = `<div class="mg-hud"><span>Очки: <b class="j-score">0</b></span><span>⏱ <b class="j-time">30.0</b></span></div>
    <div class="mg-mole-grid"></div>`;
  const grid = root.querySelector('.mg-mole-grid');
  const cells = [];
  for (let i = 0; i < 9; i++){
    const c = document.createElement('button');
    c.className = 'mg-mole-cell';
    c.innerHTML = '<span class="mg-mole-face"></span>';
    grid.appendChild(c);
    cells.push(c);
  }
  stage.appendChild(root);

  const T = mgTimers();
  const TYPES = [
    { e: '🙂', v: 1, w: 70 },
    { e: '⭐', v: 3, w: 12 },
    { e: '💥', v: -2, w: 18 }
  ];
  let score = 0, t = 30, run = true;

  const pickType = () => {
    let r = Math.random() * 100;
    for (const tp of TYPES){ r -= tp.w; if (r <= 0) return tp; }
    return TYPES[0];
  };

  function spawn(){
    if (!run) return;
    const free = cells.filter(c => !c.classList.contains('up'));
    if (free.length){
      const c = free[(Math.random() * free.length) | 0];
      const tp = pickType();
      if (c._t) T.cancel(c._t);
      c.querySelector('.mg-mole-face').textContent = tp.e;
      c.dataset.v = tp.v;
      c.classList.add('up');
      c._t = T.set(() => c.classList.remove('up'), 650 + Math.random() * 450);
    }
    T.set(spawn, 600 + Math.random() * 300);
  }
  spawn();

  grid.addEventListener('pointerdown', e => {
    if (!run) return;
    const c = e.target.closest('.mg-mole-cell');
    if (!c || !c.classList.contains('up')) return;
    const v = parseInt(c.dataset.v, 10);
    score = Math.max(0, score + v);
    root.querySelector('.j-score').textContent = score;
    c.classList.remove('up');
    c.classList.add('hit');
    if (v < 0){
      MiniGames.beep(130, .18, 'sawtooth', .07);
      MiniGames.vibe(40);
      grid.classList.add('shake');
      T.set(() => grid.classList.remove('shake'), 320);
    } else {
      MiniGames.beep(v > 1 ? 950 : 720, .06);
      MiniGames.vibe(10);
    }
    T.set(() => c.classList.remove('hit'), 260);
  });

  T.every(() => {
    if (!run) return;
    t -= 0.1;
    root.querySelector('.j-time').textContent = (t > 0 ? t : 0).toFixed(1);
    if (t <= 0){
      run = false;
      api.over(score);
    }
  }, 100);

  return { destroy(){ run = false; T.clearAll(); root.remove(); } };
};

/* ================= 3. Повторяй (Саймон) ================= */

GAMES_LIST[2].create = function(stage, api){
  const COLORS = ['#ff5d6c', '#3dc66d', '#4f8dff', '#ffb020'];
  const FREQ = [329.63, 392, 493.88, 587.33];
  const root = document.createElement('div');
  root.className = 'mg-root mg-simon';
  root.innerHTML = `<div class="mg-hud"><span>Раунд: <b class="j-round">–</b></span></div>
    <div class="mg-status j-status">Смотри…</div>
    <div class="mg-simon-body"></div>`;
  const body = root.querySelector('.mg-simon-body');
  const pads = COLORS.map(col => {
    const p = document.createElement('button');
    p.className = 'mg-pad';
    p.style.background = col;
    body.appendChild(p);
    return p;
  });
  stage.appendChild(root);

  const T = mgTimers();
  let seq = [], idx = 0, can = false, round = 0;

  const status = t => { root.querySelector('.j-status').textContent = t; };

  function light(i, ms){
    pads[i].classList.add('lit');
    MiniGames.beep(FREQ[i], ms / 1000 + 0.06, 'triangle', .07);
    T.set(() => pads[i].classList.remove('lit'), ms);
  }

  function playSeq(){
    can = false;
    status('Смотри…');
    const gap = Math.max(400, 680 - round * 22);
    seq.forEach((s, k) => T.set(() => light(s, gap * 0.6), 500 + k * gap));
    T.set(() => { can = true; idx = 0; status('Твой ход — повтори!'); }, 500 + seq.length * gap);
  }

  function next(){
    round++;
    root.querySelector('.j-round').textContent = round;
    seq.push((Math.random() * 4) | 0);
    playSeq();
  }

  pads.forEach((p, i) => p.addEventListener('pointerdown', () => {
    if (!can) return;
    light(i, 180);
    if (i === seq[idx]){
      idx++;
      if (idx === seq.length){
        can = false;
        status('Верно! 🎉');
        MiniGames.beep(880, .12, 'triangle');
        MiniGames.vibe(15);
        T.set(next, 750);
      }
    } else {
      can = false;
      root.classList.add('fail');
      status('Ошибка!');
      MiniGames.beep(140, .3, 'sawtooth', .07);
      MiniGames.vibe(70);
      T.set(() => api.over(round - 1), 750);
    }
  }));

  T.set(next, 500);
  return { destroy(){ T.clearAll(); root.remove(); } };
};

/* ================= 4. Стаканчики (напёрстки) ================= */

GAMES_LIST[3].create = function(stage, api){
  const root = document.createElement('div');
  root.className = 'mg-root mg-cups';
  root.innerHTML = `<div class="mg-hud"><span>Раунд: <b class="j-round">1</b></span><span class="j-lives">❤❤❤</span></div>
    <div class="mg-cups-field"><div class="mg-ball">🍬</div></div>
    <div class="mg-status j-status">Следи за конфетой…</div>`;
  const field = root.querySelector('.mg-cups-field');
  const ballEl = root.querySelector('.mg-ball');
  const cups = [];
  for (let i = 0; i < 3; i++){
    const c = document.createElement('button');
    c.className = 'mg-cup';
    c.textContent = '🥤';
    field.appendChild(c);
    cups.push(c);
  }
  stage.appendChild(root);

  const T = mgTimers();
  const W = Math.max(260, field.clientWidth);
  const CUP_W = 84;
  const slotX = i => 10 + i * ((W - 20 - CUP_W) / 2);
  let cupSlot = [0, 1, 2];     // cupSlot[i] — в каком слоте стоит стакан i
  let ballCup = 1, round = 0, lives = 3, busy = true, dur = 330, swaps = 4;

  const status = t => { root.querySelector('.j-status').textContent = t; };

  function move(i, anim, ms){
    const el = cups[i];
    el.style.transition = anim ? `transform ${ms}ms ease` : 'none';
    el.style.transform = `translateX(${slotX(cupSlot[i])}px)`;
  }
  function lift(i, up){
    const el = cups[i];
    el.style.transition = 'transform .22s ease';
    el.style.transform = `translateX(${slotX(cupSlot[i])}px) translateY(${up ? -58 : 0}px)`;
  }
  function showBall(v){
    ballEl.style.transition = 'transform .2s ease';
    ballEl.style.transform = `translateX(${slotX(cupSlot[ballCup])}px)`;
    ballEl.classList.toggle('show', v);
  }

  function startRound(){
    busy = true;
    status('Следи за конфетой…');
    ballCup = (Math.random() * 3) | 0;
    round++;
    root.querySelector('.j-round').textContent = round;
    dur = Math.max(150, 330 - round * 14);
    swaps = 4 + Math.min(8, round);
    lift(ballCup, true);
    showBall(true);
    MiniGames.beep(660, .07);
    T.set(() => {
      lift(ballCup, false);
      showBall(false);
      T.set(() => shuffle(0), 400);
    }, 1000);
  }

  function shuffle(k){
    if (k >= swaps){
      busy = false;
      status('Где конфета? Тапни по стакану!');
      return;
    }
    const a = (Math.random() * 3) | 0;
    const b = (a + 1 + ((Math.random() * 2) | 0)) % 3;
    const s1 = cupSlot[a], s2 = cupSlot[b];
    cupSlot[a] = s2; cupSlot[b] = s1;
    move(a, true, dur);
    move(b, true, dur);
    T.set(() => shuffle(k + 1), dur + 40);
  }

  field.addEventListener('pointerdown', e => {
    if (busy) return;
    const c = e.target.closest('.mg-cup');
    if (!c) return;
    busy = true;
    const i = cups.indexOf(c);
    if (i === ballCup){
      lift(i, true);
      showBall(true);
      MiniGames.beep(880, .1, 'triangle');
      MiniGames.vibe(15);
      status('Есть! 🍬');
      T.set(startRound, 1100);
    } else {
      lift(i, true);
      lift(ballCup, true);
      showBall(true);
      MiniGames.beep(150, .25, 'sawtooth', .07);
      MiniGames.vibe(60);
      lives--;
      root.querySelector('.j-lives').textContent = '❤'.repeat(Math.max(0, lives)) + '🖤'.repeat(3 - Math.max(0, lives));
      if (lives <= 0){
        status('Увы!');
        T.set(() => api.over(round - 1), 1000);
      } else {
        status('Мимо, −❤');
        T.set(startRound, 1300);
      }
    }
  });

  cups.forEach((c, i) => move(i, false, 0));
  T.set(startRound, 600);
  return { destroy(){ T.clearAll(); root.remove(); } };
};

/* ================= 5. Птичка (flappy: тап — взмах) ================= */

GAMES_LIST[4].create = function(stage, api){
  const root = document.createElement('div');
  root.className = 'mg-root mg-flappy';
  root.innerHTML = `<div class="mg-hud"><span>Очки: <b class="j-score">0</b></span><span class="mg-hint">тап — взмах</span></div>
    <div class="mg-flappy-wrap"><canvas></canvas></div>`;
  stage.appendChild(root);

  const wrap = root.querySelector('.mg-flappy-wrap');
  const cv = root.querySelector('canvas');
  const ctx = cv.getContext('2d');
  const scoreEl = root.querySelector('.j-score');
  const DPR = Math.min(2, window.devicePixelRatio || 1);
  const rect = wrap.getBoundingClientRect();
  const W = Math.max(240, rect.width), H = Math.max(200, rect.height);
  cv.width = W * DPR; cv.height = H * DPR;
  ctx.setTransform(DPR, 0, 0, DPR, 0, 0);

  const PX = Math.round(W * 0.3);   // x птицы (по центру «тела»)
  const floorY = H - 26;            // верх земли
  const R = 20;                     // видимый радиус птицы (эмодзи 40px)
  const GRAV = 1500, FLAP = -470;
  const PIPE_W = 56, CAP_H = 26;
  const SPACING = 235;              // дистанция между колоннами

  const T = mgTimers();
  let t = 0, off = 0;               // время и пройденный путь (для фона)
  let by = H * 0.45, vy = 0;        // птица: y-центр и вертикальная скорость
  let started = false, dead = false, inv = 0;
  let score = 0, speed = 150, spawnDist = 380;
  let pipes = [];
  let raf = 0, last = performance.now();

  function flap(){
    started = true;
    vy = FLAP;
    MiniGames.beep(520, .06, 'triangle', .05);
  }

  root.addEventListener('pointerdown', () => { if (!dead) flap(); });

  function die(){
    if (dead) return;
    dead = true;
    MiniGames.beep(140, .3, 'sawtooth', .08);
    MiniGames.vibe(80);
    T.set(() => api.over(score, {
      revive(){
        pipes = [];
        by = H * 0.45; vy = 0;
        spawnDist = 380;
        inv = 1.8;
        dead = false;
        last = performance.now();
      }
    }), 650);
  }

  function hitPipe(p){
    const HB = 12;                             // половина прощающего хитбокса птицы
    const bx = PX - HB, bw = HB * 2, bh = HB * 2;
    const px = p.x + 6, pw = PIPE_W - 12;      // и колонны
    if (bx + bw < px || bx > px + pw) return false;
    return by - HB < p.top || by + HB > p.top + p.gap;
  }

  function step(dt){
    t += dt;
    inv -= dt;
    if (!started){ by = H * 0.45 + Math.sin(t * 3.2) * 9; return; }
    if (!dead){
      speed = Math.min(235, 150 + score * 3);
      off += speed * dt;
    }
    vy += GRAV * dt;
    by += vy * dt;
    if (dead){                                  // падение после удара
      if (by > floorY - R + 4){ by = floorY - R + 4; vy = 0; }
      return;
    }
    if (by < R - 4){ by = R - 4; vy = Math.max(vy, 0); }
    if (by + R - 4 >= floorY) return die();
    spawnDist -= speed * dt;
    if (spawnDist <= 0){
      spawnDist = SPACING;
      const gap = Math.max(136, 170 - score * 2);
      const top = 34 + Math.random() * Math.max(20, floorY - gap - 86);
      pipes.push({ x: W + PIPE_W, top, gap, scored: false });
    }
    for (const p of pipes){
      p.x -= speed * dt;
      if (!p.scored && p.x + PIPE_W < PX - 12){
        p.scored = true;
        score++;
        scoreEl.textContent = score;
        MiniGames.beep(880, .07, 'triangle', .05);
      }
    }
    pipes = pipes.filter(p => p.x > -PIPE_W - 14);
    if (inv <= 0) for (const p of pipes) if (hitPipe(p)) return die();
  }

  function drawPipe(p){
    const gb = p.top + p.gap;
    ctx.lineWidth = 3;
    ctx.strokeStyle = '#3e8f43';
    ctx.fillStyle = '#5db95f';
    ctx.fillRect(p.x, -8, PIPE_W, p.top + 8);
    ctx.strokeRect(p.x, -8, PIPE_W, p.top + 8);
    ctx.fillRect(p.x, gb, PIPE_W, floorY - gb + 8);
    ctx.strokeRect(p.x, gb, PIPE_W, floorY - gb + 8);
    ctx.fillRect(p.x - 5, p.top - CAP_H, PIPE_W + 10, CAP_H);
    ctx.strokeRect(p.x - 5, p.top - CAP_H, PIPE_W + 10, CAP_H);
    ctx.fillRect(p.x - 5, gb, PIPE_W + 10, CAP_H);
    ctx.strokeRect(p.x - 5, gb, PIPE_W + 10, CAP_H);
    ctx.fillStyle = 'rgba(255,255,255,.18)';    // блик для объёма
    ctx.fillRect(p.x + 8, -8, 8, p.top + 8 - CAP_H + 8);
    ctx.fillRect(p.x + 8, gb + CAP_H, 8, floorY - gb - CAP_H + 8);
  }

  function draw(){
    ctx.clearRect(0, 0, W, H);
    // облака (медленный параллакс)
    ctx.fillStyle = 'rgba(255,255,255,.8)';
    for (let i = 0; i < 3; i++){
      const span = W + 160;
      const cx = (((i * 190 + 700 - off * 0.25) % span) + span) % span - 80;
      const cy = 36 + i * 26;
      ctx.beginPath();
      ctx.arc(cx, cy, 13, 0, 7);
      ctx.arc(cx + 14, cy - 5, 10, 0, 7);
      ctx.arc(cx + 27, cy, 11, 0, 7);
      ctx.fill();
    }
    for (const p of pipes) drawPipe(p);
    // земля
    ctx.fillStyle = '#c9d4a5';
    ctx.fillRect(0, floorY, W, H - floorY);
    ctx.fillStyle = '#aebd85';
    for (let x = -(off % 42); x < W; x += 42) ctx.fillRect(x, floorY + 10, 20, 4);
    // птица (клюёт вниз при падении, мигает после спасения); зеркалим — в эмодзи смотрит влево
    const ang = Math.max(-0.45, Math.min(1.1, vy / 500));
    ctx.save();
    ctx.translate(PX, by);
    ctx.rotate(ang);
    ctx.scale(-1, 1);
    ctx.font = '40px sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    if (!(inv > 0 && ((inv * 10) | 0) % 2 === 0)) ctx.fillText('🐦', 0, 0);
    ctx.restore();
  }

  function loop(ts){
    raf = requestAnimationFrame(loop);
    const dt = Math.max(0, Math.min(0.033, (ts - last) / 1000));
    last = ts;
    step(dt);
    draw();
  }
  raf = requestAnimationFrame(loop);

  // отладочный снимок состояния для автотестов (только чтение, на игру не влияет)
  root._dbg = () => ({ by: Math.round(by), vy: Math.round(vy), score, speed: Math.round(speed),
    spawnDist: Math.round(spawnDist), started, dead, inv: +inv.toFixed(1), pipes: pipes.length, t: +t.toFixed(1) });

  return {
    pause(){ dead = true; },
    destroy(){
      dead = true;
      cancelAnimationFrame(raf);
      T.clearAll();
      root.remove();
    }
  };
};
