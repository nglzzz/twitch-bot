/* ============ Игровой движок ============ */
'use strict';

const Game = {
  state: null,
  _saveTimer: null,

  SAVE_KEY: 'phonechat_save_v1',

  // через сколько дней пульная «болталка» может прийти снова
  POOL_CD: 2,

  // подарки в чате — всегда за монеты
  GIFTS: {
    sticker:{ name:'Стикер «жаба»', emoji:'🐸', price:15, rel:2,  say:'Ага)) жаба — это теперь наш мем' },
    flowers:{ name:'Букет',        emoji:'💐', price:40, rel:5,  say:'Ой… они же настоящие? Спасибо!)' },
    teddy:  { name:'Мишка',        emoji:'🧸', price:80, rel:8,  say:'Мишка!!! Теперь он живёт на подушке' },
    ring:   { name:'Кольцо',       emoji:'💍', price:200, rel:15, say:'…это был очень серьёзный намёк. Я подумаю ❤' }
  },

  freshState(){
    return {
      v: 2,
      day: 1,
      minutes: 8*60+10,
      coins: 100,
      rel: { katya:4, sveta:4, anya:14, vika:4, dima:16, mama:40, alisa:0, teach:10, young:2 },
      fl: { kind:0, calm:0, romance:0, bold:0, humor:0, mamaBoy:0, sport:0, honest:0, lie:0 },
      done: {},
      gf: null,
      gf2: null,
      harem: null,
      flagday: {},
      altUsed: {},
      ach: {},
      stat: { gifts:0, giftCoins:0, likes:0, kind:{}, to:{} },
      gallery: [],
      purchased: {},
      equipped: { theme:'classic', case:'carbon' },
      games: { best:{}, coinsDay:0, dayKey:0 },
      msgSeq: 0,
      chats: {},
      started: false,
      sound: true
    };
  },

  chat(id){
    if (!this.state.chats[id]) this.state.chats[id] = { hist:[], unread:0, last:'', choice:null, incoming:[], queue:[], nextAt:0 };
    const ch = this.state.chats[id];
    if (!ch.queue) ch.queue = [];
    return ch;
  },

  // метка последней активности чата — по ней строится список чатов
  touch(charId){
    const s = this.state;
    s.msgSeq = (s.msgSeq || 0) + 1;
    this.chat(charId).at = s.msgSeq;
  },

  /* ---------- сохранение ---------- */

  save(){
    try { localStorage.setItem(this.SAVE_KEY, JSON.stringify(Object.assign({}, this.state, { ts: Date.now() }))); } catch(e){}
    clearTimeout(this._saveTimer);
    this._saveTimer = setTimeout(() => { YSDK.cloudSave(Object.assign({}, this.state, { ts: Date.now() })); }, 8000);
  },

  async load(){
    let local = null;
    try { local = JSON.parse(localStorage.getItem(this.SAVE_KEY) || 'null'); } catch(e){}
    const cloud = await YSDK.cloudLoad();
    const pick = (a,b) => (a && b) ? ((a.ts||0) >= (b.ts||0) ? a : b) : (a||b);
    this.state = pick(cloud, local) || this.freshState();
    // сейв старой версии (v1, до глобального обновления диалогов): историю сбрасываем,
    // оставляя только косметику — как «Начать заново» с сохранением галереи и покупок
    if (this.state.v !== 2){
      const old = this.state;
      this.state = this.freshState();
      this.state.gallery = old.gallery || [];
      this.state.purchased = old.purchased || {};
      this.state.equipped = Object.assign({theme:'classic',case:'carbon'}, old.equipped||{});
      this.state.coins = typeof old.coins === 'number' ? old.coins : this.state.coins;
      this.state.sound = old.sound !== false;
      this.state.games = old.games || this.state.games;
      this.state.games = this.state.games || { best:{}, coinsDay:0, dayKey:0 };
      if (!this.state.games.best) this.state.games.best = {};
    }
    // миграции/починка
    const f = this.freshState();
    for (const k in f.rel) if (typeof this.state.rel[k] !== 'number') this.state.rel[k] = f.rel[k];
    for (const k in f.fl)  if (typeof this.state.fl[k] !== 'number') this.state.fl[k] = f.fl[k];
    this.state.chats = this.state.chats || {};
    for (const id in GD.chars) this.chat(id);
    this.state.equipped = Object.assign({theme:'classic',case:'carbon'}, this.state.equipped||{});
    if (!this.state.gallery) this.state.gallery = [];
    if (!this.state.purchased) this.state.purchased = {};
    if (!this.state.done) this.state.done = {};
    if (typeof this.state.gf2 === 'undefined') this.state.gf2 = null;
    if (typeof this.state.harem === 'undefined') this.state.harem = null;
    if (!this.state.flagday) this.state.flagday = {};
    if (!this.state.ach) this.state.ach = {};
    if (!this.state.stat) this.state.stat = { gifts:0, giftCoins:0, likes:0, kind:{}, to:{} };
    if (!this.state.stat.kind) this.state.stat.kind = {};
    if (!this.state.stat.to) this.state.stat.to = {};
    this.state.games = this.state.games || { best:{}, coinsDay:0, dayKey:0 };
    if (!this.state.games.best) this.state.games.best = {};
    if (typeof this.state.games.coinsDay !== 'number') this.state.games.coinsDay = 0;
    if (typeof this.state.games.dayKey !== 'number') this.state.games.dayKey = 0;
    // сортировка чатов по свежести: старым сейвам выдаём сдвиг, чтобы новые сообщения всегда были «свежее»
    if (typeof this.state.msgSeq !== 'number') this.state.msgSeq = 10000;
    // сообщениям из старых сейвов выдаём id — по ним лайк ставится двойным нажатием
    for (const id in this.state.chats){
      for (const m of this.state.chats[id].hist){
        if ((m.who === 'in' || m.who === 'photo') && !m.id) m.id = ++this.state.msgSeq;
      }
    }
  },

  /* ---------- условия и эффекты ---------- */

  // участники группового чата (для динамических условий a_rel/b_rel)
  partsOf(charId){
    const ch = charId && this.state.chats[charId];
    return (ch && ch.participants) || null;
  },

  condOK(c, charId){
    if (!c) return true;
    if (this.condOKInner(c, charId) === false) return false;
    return true;
  },

  condOKInner(c, charId){
    const s = this.state;
    const parts = this.partsOf(charId);
    if (c.two && !(s.gf && s.gf2)) return false;
    if (c.harem && !(Array.isArray(s.harem) && s.harem.length)) return false;
    if (c.a_calm && !(parts && ['katya','vika'].includes(parts[0]))) return false;
    if (c.a_jealous && !(parts && ['sveta','anya'].includes(parts[0]))) return false;
    if (c.a_rel && parts){ const [op,v] = c.a_rel; if (op === '>=' && !(s.rel[parts[0]] >= v)) return false; if (op === '<=' && !(s.rel[parts[0]] <= v)) return false; }
    if (c.b_rel && parts){ const [op,v] = c.b_rel; if (op === '>=' && !(s.rel[parts[1]] >= v)) return false; if (op === '<=' && !(s.rel[parts[1]] <= v)) return false; }
    if (c.not && this.condOKInner(c.not, charId) !== false) return false;
    if (c.any && !c.any.some(x => this.condOKInner(x, charId) !== false)) return false;
    if (c.all && !c.all.every(x => this.condOKInner(x, charId) !== false)) return false;
    if (c.since) for (const fl in c.since){
      const [op,v] = c.since[fl];
      const d0 = s.flagday[fl] || 0;
      if (op === '>=' && !((s.day - d0) >= v)) return false;
      if (op === '<=' && !((s.day - d0) <= v)) return false;
    }
    if (c.day){
      const [op, v] = c.day;
      if (op === '>=' && !(s.day >= v)) return false;
      if (op === '<=' && !(s.day <= v)) return false;
    }
    if (c.rel) for (const k in c.rel){
      const [op, v] = c.rel[k];
      if (op === '>=' && !((s.rel[k]||0) >= v)) return false;
      if (op === '<=' && !((s.rel[k]||0) <= v)) return false;
    }
    if (c.fl) for (const k in c.fl){
      const [op, v] = c.fl[k];
      if (op === '>=' && !((s.fl[k]||0) >= v)) return false;
      if (op === '<=' && !((s.fl[k]||0) <= v)) return false;
    }
    if (c.done) for (const n of c.done) if (!s.done[n]) return false;
    if (c.notdone) for (const n of c.notdone) if (s.done[n]) return false;
    if (c.no_gf && s.gf) return false;
    if (c.gf && s.gf !== c.gf) return false;
    if (typeof c.coins === 'object' && c.coins){
      const [op, v] = c.coins;
      if (op === '>=' && !(s.coins >= v)) return false;
    }
    return true;
  },

  // подстановка {A}/{B}/{INF} в текстах групповых сцен и ключах эффектов.
  // если чат без участников (личные чаты сцен разоблачения) — берём пару из состояния (gf + gf2)
  subst(str, parts){
    if (typeof str !== 'string') return str;
    if (!Array.isArray(parts) || !parts.length) parts = [this.state.gf, this.state.gf2].filter(Boolean);
    if (!parts.length || !GD.chars[parts[0]]) return str;
    const inf = this.informer(parts);
    const nm = id => GD.chars[id] ? GD.chars[id].name : '';
    // пол персонажа (мужской — только Дима): для согласования старых реплик вида «слил(а)»
    const g = id => (id === 'dima' ? 'm' : 'f');
    // легаси: в старых сейвах «{X} глагол(окончание)» — согласуем окончание с полом говорящего
    const verb = (str2, ph, id) => str2.replace(
      new RegExp('\\{' + ph + '\\} ([а-яё]+)\\(([а-яё]{1,3})\\)', 'g'),
      (_, w, e) => '{' + ph + '} ' + (g(id) === 'f' ? w + e : w)
    );
    // легаси: старые тексты писали «с {B}» без падежного маркера
    str = str.replace('переписку с {B}', 'переписку с {Bt}').replace('переписки с {B}', 'переписки с {Bt}');
    str = verb(str, 'A', parts[0]);
    str = verb(str, 'B', parts[1]);
    str = verb(str, 'INF', inf);
    const decl = (name, m) => name.split(' ').map(w => {
      if (!/[ая]$/i.test(w)) return w;
      const т = (m === 'т' || m === 't'), д = (m === 'д' || m === 'd'), г = (m === 'г' || m === 'g');
      if (т) return w.slice(0,-1) + (/я$/.test(w) ? 'ей' : 'ой'); // с кем
      if (д) return w.slice(0,-1) + 'е';                          // к кому
      if (г) return w.slice(0,-1) + (/я$/.test(w) ? 'и' : 'ы');   // чей/у кого
      return w;
    }).join(' ');
    // «с {At}» → «со Светой», но «с Аней»: предлог выбирается по инструментальной форме имени
    str = str.replace(/([сС]) \{([AB]|INF)([тдгtdg])\}/g, (_, c, ph, m) => {
      const id = ph === 'A' ? parts[0] : (ph === 'B' ? parts[1] : inf);
      const form = decl(nm(id), m);
      const so = /^[сз][бвгджзйклмнпрстфхцчшщ]/i.test(form);
      return (so ? (c === 'С' ? 'Со ' : 'со ') : (c === 'С' ? 'С ' : 'с ')) + form;
    });
    return str
      .replace(/\{A([тдгtdg])\}/g, (_, m) => decl(nm(parts[0]), m))
      .replace(/\{B([тдгtdg])\}/g, (_, m) => decl(nm(parts[1]), m))
      .replace(/\{INF([тдгtdg])\}/g, (_, m) => decl(nm(inf), m))
      .replace(/\{A\}/g, nm(parts[0]))
      .replace(/\{B\}/g, nm(parts[1]))
      .replace(/\{INF\}/g, nm(inf));
  },

  // «человек, с которым испортились отношения» — источник сплетен
  informer(parts){
    const s = this.state;
    let worst = 'alisa', min = 101;
    for (const id in GD.chars){
      if (id === 'group' || (parts && parts.includes(id))) continue;
      if ((s.rel[id]||0) < min){ min = s.rel[id]||0; worst = id; }
    }
    return worst;
  },

  // разворачивает ключи A/B в eff.rel/eff.fl по участникам группового чата
  expandEff(eff, parts){
    if (!parts || !eff) return eff;
    const map = k => k === 'A' ? parts[0] : (k === 'B' ? parts[1] : k);
    const out = Object.assign({}, eff);
    for (const key of ['rel','fl']){
      if (eff[key]){
        out[key] = {};
        for (const k in eff[key]) out[key][map(k)] = eff[key][k];
      }
    }
    if (eff.cross){
      out.cross = {};
      for (const k in eff.cross) out.cross[map(k)] = eff.cross[k];
    }
    return out;
  },

  applyEff(eff, charId){
    if (!eff) return;
    const s = this.state;
    const parts = this.partsOf(charId);
    eff = this.expandEff(eff, parts);
    const notes = [];
    // флаг-метка (для последующих условий) + день, когда поставлен
    if (eff.flag){
      s.done[eff.flag] = 1;
      s.flagday[eff.flag] = s.day;
    }
    // «втроём»: обе участницы группового диалога становятся девушками
    if (eff.harem && parts){
      s.harem = parts.slice();
      s.gf = parts[0]; s.gf2 = parts[1];
      notes.push('❤🔥 У вас теперь сразу две девушки. Тишина в чате — это не про вас');
    }
    // выбрать одну из двух: 'A' — оставить первую (нынешнюю), 'B' — вторую
    if (eff.dropgf2 && parts){
      const keep = eff.dropgf2;
      const drop = keep === 'A' ? parts[1] : parts[0];
      if (keep === 'B'){ s.gf = parts[1]; }
      s.gf2 = null;
      s.rel[drop] = Math.max(0, s.rel[drop] - 40);
      // брошенная уходит в «тишину» — у неё стартует одноразовая арка (см. dumpSilent)
      s.done['#dump:' + drop] = 1;
      s.flagday['#dump:' + drop] = s.day;
      notes.push('💔 ' + GD.chars[drop].name + ' ушла. −40 ' + GD.chars[drop].name);
    }
    if (eff.rel) for (const k in eff.rel){
      const before = s.rel[k];
      s.rel[k] = Math.max(0, Math.min(100, s.rel[k] + eff.rel[k]));
      if (s.rel[k] !== before && Math.abs(eff.rel[k]) >= 5 && k !== charId && GD.chars[k])
        notes.push((eff.rel[k] > 0 ? '+' : '') + eff.rel[k] + ' ' + GD.chars[k].name);
    }
    if (eff.fl) for (const k in eff.fl) s.fl[k] = (s.fl[k]||0) + eff.fl[k];
    if (eff.coins){
      s.coins = Math.max(0, s.coins + eff.coins);
      if (eff.coins > 0) notes.push('+' + eff.coins + ' 🪙');
    }
    if (eff.photo) this.addPhoto(eff.photo);
    // ревность девушки, если флиртуешь с другими
    if (s.gf && eff.rel){
      const gfs = [s.gf, s.gf2].filter(Boolean);
      for (const k in eff.rel){
        if (['katya','sveta','anya','vika'].includes(k) && eff.rel[k] >= 3 && !gfs.includes(k) && !(Array.isArray(s.harem) && s.harem.includes(k))){
          for (const g of gfs){
            if (g === charId) continue;
            s.rel[g] = Math.max(0, s.rel[g] - 3);
            notes.push(GD.chars[g].name + ' ревнует −3');
          }
          break;
        }
      }
    }
    if (eff.cross) for (const k in eff.cross){
      const c = eff.cross[k];
      s.rel[k] = Math.max(0, Math.min(100, s.rel[k] + (c.rel||0)));
      if (c.note) notes.push(c.note);
    }
    // новый роман: если девушка уже есть — это «две девушки» (young вне этой драмы: замена)
    if (eff.gf){
      const prev = s.gf;
      const makingTwo = prev && prev !== eff.gf && !Array.isArray(s.harem) && prev !== 'young' && eff.gf !== 'young';
      if (makingTwo){
        s.gf2 = eff.gf;
        s.done['#two'] = 1;
        s.flagday['#two'] = s.day;
        s.rel[eff.gf] = 100;
        notes.push('❤ Теперь у вас всё с ' + GD.chars[eff.gf].name + '!');
        notes.push('🔥 Осторожно: теперь у вас две девушки…');
      } else {
        if (prev && prev !== eff.gf && (prev === 'young' || eff.gf === 'young')){
          s.rel[prev] = Math.max(0, s.rel[prev] - 30);
          notes.push('💔 ' + GD.chars[prev].name + ' узнала. Такие истории не делят на двоих');
          // герой ушёл к Елизавете Андреевне — прежняя девушка «брошена» так же, как в общем чате
          if (eff.gf === 'young'){
            s.done['#dump:' + prev] = 1;
            s.flagday['#dump:' + prev] = s.day;
          }
        }
        if (Array.isArray(s.harem) && s.harem.includes(eff.gf)) s.harem = null;
        s.gf = eff.gf;
        s.rel[eff.gf] = 100;
        notes.push('❤ Теперь у вас всё с ' + GD.chars[eff.gf].name + '!');
      }
    }
    // героиня расстаётся с героем: статус снимается, включается «тишина» с эпилог-аркой
    // (та же обвязка #dump, что при выборе одной из двух в общем чате)
    if (eff.breakup && GD.chars[eff.breakup]){
      const id = eff.breakup;
      if (s.gf === id) s.gf = null;
      if (s.gf2 === id) s.gf2 = null;
      if (Array.isArray(s.harem)){
        s.harem = s.harem.filter(x => x !== id);
        if (!s.harem.length) s.harem = null;
      }
      s.done['#dump:' + id] = 1;
      s.flagday['#dump:' + id] = s.day;
      notes.push('💔 ' + GD.chars[id].name + ' ушла. Вы больше не встречаетесь');
    }
    // старт сцены в другом чате (обычно — групповом). Повторный запуск уже пройденной
    // сцены подавляется: у «разоблачений» две девушки стартуют один и тот же GR1
    if (eff.start && GD.scenes[eff.start.node] && !(this.state.done[eff.start.node] && !eff.start.force)){
      const gch = this.chat(eff.start.char);
      if (eff.start.parts){
        gch.participants = eff.start.parts.map(tok => tok === 'gf' ? s.gf : (tok === 'gf2' ? s.gf2 : tok));
      }
      this.startNode(eff.start.char, eff.start.node, true);
    }
    for (const n of notes) UI.toast(n);
    this.save();
  },

  addPhoto(id){
    const s = this.state;
    if (!Photo.get(id)) return;
    if (s.gallery.some(g => g.id === id)) return;
    s.gallery.push({ id, day: s.day });
    UI.toast('📸 Новое фото в галерее!');
    UI.renderBadges();
    this.save();
  },

  /* ---------- доставка сообщений ---------- */

  // ставит сцену в очередь персонажа (front — сыграть следующей)
  startNode(charId, nodeId, front, fromPool){
    const sc = GD.scenes[nodeId];
    if (!sc) return;
    const ch = this.chat(charId);
    if (front) ch.queue.unshift(nodeId);
    else ch.queue.push(nodeId);
    // пульные «болталки» помечаются днём запуска — их можно переигрывать с кулдауном
    if (fromPool) this.state.flagday['#pool:' + nodeId] = this.state.day;
    UI.renderBadges();
    this.save();
  },

  // запускает доставку сцены, когда персонаж полностью свободен
  _activateNode(charId, nodeId){
    const sc = GD.scenes[nodeId];
    if (!sc) return;
    const ch = this.chat(charId);
    const parts = ch.participants || null;
    const wasDone = !!this.state.done[nodeId];
    this.state.done[nodeId] = 1;
    ch.lastNode = nodeId;
    ch.effApplied = false;
    // повтор пульной сцены — берём ещё не виденный вариант реплик (alt),
    // чтобы вместо дословного повтора игрок получал новый разговор
    let live = sc;
    if (wasDone && sc.alts && sc.alts.length){
      const s = this.state;
      if (!s.altUsed) s.altUsed = {};
      const used = s.altUsed[nodeId] || 0;
      if (used < sc.alts.length){
        live = Object.assign({}, sc, sc.alts[used]);
        s.altUsed[nodeId] = used + 1;
      }
    }
    const sub = t => this.subst(t, parts);
    for (const m of live.msgs){
      if (m[0] === 'photo') ch.incoming.push({ who:'photo', photo:m[1] });
      else if (m[0] === 'skip') ch.incoming.push({ who:'skip', mins:m[1] });
      else ch.incoming.push({ who:m[0], txt:sub(m[1]) || '' });
    }
    if (live.choices && live.choices.length){
      // копии вариантов: в групповых сценах подставляем имена в тексты
      ch.pendingChoices = { node: nodeId, options: live.choices.map(o => Object.assign({}, o, { t: sub(o.t) })) };
    }
    ch.nextAt = Date.now() + 1000 + Math.random()*1400;
    // редкие «ночные» сцены сами ставят часы: промотка через полночь
    // прыгает сразу на утро, и 02:11 в пузырьке иначе не существует
    if (live.clock != null) this.jumpToClock(live.clock);
    else this.bumpClock(6 + Math.floor(Math.random()*18));
  },

  // тик доставки: по одному сообщению на персонажа, с «печатает…»
  tickDelivery(){
    const now = Date.now();
    let dirty = false;
    for (const charId in GD.chars){
      const ch = this.state.chats[charId];
      if (!ch) continue;

      // следующая сцена из очереди — когда персонаж полностью свободен
      if (ch.queue.length && !ch.incoming.length && !ch.choice && !ch.pendingChoices && now >= (ch.nextAt||0)){
        this._activateNode(charId, ch.queue.shift());
        dirty = true;
        this.save();
        continue;
      }

      if (!ch.incoming.length) continue;
      if (ch.nextAt > now) continue;
      const m = ch.incoming.shift();
      if (m.who === 'skip'){
        this.bumpClock(m.mins || 40);
        ch.hist.push({ who:'sys', txt:'Позже в этот день…', t:this.clockStr(), id:++this.state.msgSeq });
      } else if (m.who === 'photo'){
        ch.hist.push({ who:'photo', photo:m.photo, t:this.clockStr(), id:++this.state.msgSeq });
        this.addPhoto(m.photo);
        ch.last = '📷 Фото';
      } else {
        ch.hist.push({ who:m.who, txt:m.txt, t:this.clockStr(), id:++this.state.msgSeq });
        if (m.who === 'in') ch.last = m.txt;
      }
      if (ch.hist.length > 80) ch.hist.splice(0, ch.hist.length - 80);
      ch.unread++;
      this.touch(charId);
      ch.typing = false;
      ch.nextAt = ch.incoming.length ? (Date.now() + 1100 + (m.who === 'photo' ? 30 : (m.txt || '').length)*22 + Math.random()*900) : 0;
      // если выбор готов и всё доставлено — он появится в чате
      if (!ch.incoming.length && ch.pendingChoices && !ch.choice){
        ch.choice = ch.pendingChoices;
        delete ch.pendingChoices;
      }
      dirty = true;
      const open = UI.currentChat === charId;
      if (!open){
        UI.notifyIncoming(charId, m);
        ch.unread = ch.unread; // бейдж виден в списке
      }
      UI.onChatUpdate(charId, open, m.who === 'in' || m.who === 'photo');
      // сработавшие эффекты сцены — когда сцена полностью доставлена (однократно)
      if (!ch.incoming.length && !ch.choice && !ch.pendingChoices && !ch.effApplied){
        ch.effApplied = true;
        const sc = GD.scenes[ch.lastNode];
        if (sc && sc.eff) this.applyEff(sc.eff, charId);
      }
    }
    if (dirty) { UI.renderBadges(); this.checkAch(); this.save(); }
  },

  /* ---------- выборы игрока ---------- */

  choose(charId, idx){
    const ch = this.chat(charId);
    if (!ch.choice) return;
    const opt = ch.choice.options[idx];
    const nodeId = ch.choice.node;
    ch.choice = null;
    const txt = this.subst(opt.t, ch.participants);
    const myMsg = { who:'out', txt, t:this.clockStr(), id:++this.state.msgSeq };
    ch.hist.push(myMsg);
    ch.last = txt;
    ch.unread = 0;
    this.touch(charId);
    this.bumpClock(4 + Math.floor(Math.random()*10));
    this.applyEff(opt.eff, charId);
    UI.onChatUpdate(charId, UI.currentChat === charId, false);
    let followUp = false;
    if (opt.next && GD.scenes[opt.next]){
      this.startNode(charId, opt.next, true);
      followUp = true;
    } else {
      ch.lastNode = nodeId;
      const sc = GD.scenes[nodeId];
      if (sc && sc.eff && !ch.effApplied){
        ch.effApplied = true;
        this.applyEff(sc.eff, charId);
      }
    }
    this.maybeGirlLike(charId, opt, myMsg, followUp);
    this.checkAch();
    this.save();
  },

  /* ---------- лайки ---------- */

  // двойное нажатие на входящее сообщение: ставит/снимает лайк.
  // +1 к отношению раз в день с каждым персонажем; при снятии лайка бонус откатывается (m.bonus)
  toggleLike(charId, m){
    if (!m || (m.who !== 'in' && m.who !== 'photo')) return false;
    if (!(charId in this.state.rel)) return false; // групповой чат не лайкается
    if (this.state.done['#block:' + charId]){ UI.toast(GD.chars[charId].name + ' заблокировала вас'); return false; }
    const ch = this.chat(charId);
    const s = this.state;
    if (m.liked){
      delete m.liked;
      if (m.bonus){
        delete m.bonus;
        s.rel[charId] = Math.max(0, s.rel[charId] - 1);
      }
      this.save();
      return false;
    }
    m.liked = 1;
    if (!m.id) m.id = ++s.msgSeq;
    s.stat.likes = (s.stat.likes||0) + 1;
    this.checkAch();
    if (ch.likeDay !== s.day){
      const before = s.rel[charId];
      ch.likeDay = s.day;
      s.rel[charId] = Math.max(0, Math.min(100, before + 1));
      if (s.rel[charId] !== before){ m.bonus = 1; UI.toast('❤ +1 ' + GD.chars[charId].name); }
    }
    this.save();
    return true;
  },

  // реакция зависит от характера: тихая Катя грустит, дерзкая Света шлёт какашку,
  // ранимая Аня — разбитое сердце, прямая Вика — палец вниз
  REACTS: {
    katya: { like:'❤', dislike:'😔' },
    sveta: { like:'🔥', dislike:'💩' },
    anya:  { like:'😍', dislike:'💔' },
    vika:  { like:'👍', dislike:'👎' }
  },

  // девушки иногда реагируют на реплики игрока: за особенно приятный ответ — с большой
  // вероятностью и быстро; за обидный — негативной реакцией; за нормальный ответ, после
  // которого разговора пока нет — изредка и с задержкой. На отношение не влияет
  maybeGirlLike(charId, opt, myMsg, followUp){
    const R = this.REACTS[charId];
    if (!R) return;
    const gain = (opt.eff && opt.eff.rel && opt.eff.rel[charId]) || 0;
    let chance = 0, delay = 1200, neg = false;
    if (gain >= 5){
      chance = gain >= 8 ? 0.7 : 0.45;
      delay = 800 + Math.random()*1600;
    } else if (gain <= -3){
      chance = 0.45;
      delay = 700 + Math.random()*1200;
      neg = true;
    } else if (gain >= 0 && !followUp && this.state.rel[charId] >= 10){
      const ch = this.chat(charId);
      if (!ch.queue.length && !ch.incoming.length && !ch.pendingChoices){
        chance = 0.35;
        delay = 1500 + Math.random()*3500;
      }
    }
    if (Math.random() >= chance) return;
    const emoji = neg ? R.dislike : R.like;
    setTimeout(() => {
      // чат мог быть пересоздан (рестарт), сообщение — обрезано или уже с реакцией
      if (myMsg.likedBy || !(charId in this.state.chats) || this.state.chats[charId].hist.indexOf(myMsg) === -1) return;
      myMsg.likedBy = emoji;
      this.save();
      UI.onGirlLike(charId, myMsg, neg);
    }, delay);
  },

  /* ---------- подарки ---------- */

  // подарок всегда стоит монет; персонаж отвечает своей репликой (def.giftSay)
  sendGift(charId, giftId){
    const g = this.GIFTS[giftId];
    if (!g || !GD.chars[charId]) return false;
    if (GD.chars[charId].dyn) return false; // в общий чат подарки не отправляют
    if (this.state.done['#block:' + charId]){ UI.toast(GD.chars[charId].name + ' заблокировала вас'); return false; }
    const s = this.state;
    if (s.coins < g.price){ UI.toast('Не хватает монет: нужно ' + g.price + ' 🪙'); return false; }
    s.coins -= g.price;
    const ch = this.chat(charId);
    s.stat.gifts = (s.stat.gifts||0) + 1;
    s.stat.giftCoins = (s.stat.giftCoins||0) + g.price;
    s.stat.kind[giftId] = (s.stat.kind[giftId]||0) + 1;
    const comboKey = charId + ':' + giftId;
    s.stat.to[comboKey] = (s.stat.to[comboKey]||0) + 1;
    ch.hist.push({ who:'gift', gift:giftId, t:this.clockStr() });
    let rel = (GD.chars[charId].gifts && typeof GD.chars[charId].gifts[giftId] === 'number')
      ? GD.chars[charId].gifts[giftId] : g.rel;
    let line = (GD.chars[charId].giftSay && GD.chars[charId].giftSay[giftId]) || g.say;
    if (ch.hist.length > 80) ch.hist.splice(0, ch.hist.length - 80);
    ch.last = '🎁 ' + g.name;
    if (line){
      ch.hist.push({ who:'in', txt:line, t:this.clockStr(), id:++s.msgSeq });
      ch.last = line;
      ch.unread = UI.currentChat === charId ? ch.unread : ch.unread + 1;
    }
    this.touch(charId);
    this.bumpClock(2 + Math.floor(Math.random()*5));
    this.pop('like');
    if (rel) this.applyEff({ rel:{ [charId]: rel } }, charId);
    UI.onChatUpdate(charId, UI.currentChat === charId, false);
    this.checkAch();
    this.save();
    return true;
  },

  /* ---------- достижения ---------- */

  // secret:true — до получения показывается как «???»
  ACH: [
    // видимые: игрок знает, к чему стремиться
    { id:'photo1',   ico:'📸', name:'Первое фото',      desc:'Получить первую фотографию',                  chk: s => s.gallery.length >= 1 },
    { id:'photo10',  ico:'🖼️', name:'Коллекционер',     desc:'Собрать 10 фотографий в галерее',              chk: s => s.gallery.length >= 10 },
    { id:'gf1',      ico:'💘', name:'Первый шаг',       desc:'Начать встречаться',                           chk: s => !!s.gf },
    { id:'gf2',      ico:'🔌', name:'Кабель',           desc:'Встречаться с двумя сразу. Зачем ты это начал?', chk: s => !!s.gf2 },
    { id:'harem',    ico:'❤️‍🔥', name:'Все сразу',        desc:'Договориться о жизни втроём',                  chk: s => Array.isArray(s.harem) && s.harem.length > 0 },
    { id:'younglove',ico:'📖', name:'Особая история',    desc:'Начать встречаться с Елизаветой Андреевной',   chk: s => s.gf === 'young' },
    { id:'heart100', ico:'💗', name:'Большое сердце',    desc:'Довести чьи-то отношения до максимума',        chk: s => Object.keys(s.rel).some(id => s.rel[id] >= 100) },
    { id:'popular',  ico:'⭐', name:'Душа компании',     desc:'Отношения 60+ со всеми четырьмя девчонками',   chk: s => ['katya','sveta','anya','vika'].every(id => s.rel[id] >= 60) },
    { id:'loved',    ico:'🤝', name:'Любимец класса',    desc:'Отношения 60+ со всеми девятью',               chk: s => Object.keys(GD.chars).filter(id => id !== 'group').every(id => (s.rel[id]||0) >= 60) },
    { id:'day7',     ico:'📅', name:'Неделя',            desc:'Дожить до 7-го дня',                           chk: s => s.day >= 7 },
    { id:'day30',    ico:'🏅', name:'Ветеран',           desc:'Дожить до 30-го дня',                          chk: s => s.day >= 30 },
    { id:'rich',     ico:'💰', name:'Богач',             desc:'Накопить 300 монет',                           chk: s => s.coins >= 300 },
    { id:'msg500',   ico:'✉️', name:'Марафонец',         desc:'500 сообщений за всё время',                   chk: s => (s.msgSeq||0) >= 500 },
    { id:'like10',   ico:'🤍', name:'Тёплые слова',      desc:'Поставить 10 лайков сообщениям',               chk: s => s.stat.likes >= 10 },
    { id:'gift1',    ico:'🎀', name:'Первый подарок',    desc:'Отправить подарок в чате',                     chk: s => s.stat.gifts >= 1 },
    { id:'gift300',  ico:'💸', name:'Щедрая душа',       desc:'Потратить 300 монет на подарки',               chk: s => s.stat.giftCoins >= 300 },
    { id:'sticker5', ico:'🐸', name:'Мемолог',           desc:'Отправить 5 стикеров',                         chk: s => (s.stat.kind.sticker||0) >= 5 },
    { id:'ring1',    ico:'💍', name:'Романтик',          desc:'Подарить кольцо',                              chk: s => (s.stat.kind.ring||0) >= 1 },
    { id:'gr1',      ico:'💔', name:'Сердцеед',          desc:'Выбрать одну из двух в общем чате',            chk: s => !!s.done['GR_over'] && !s.harem },
    { id:'gamer',    ico:'🎮', name:'Игрок',             desc:'Сыграть во все пять мини-игр',                 chk: s => ['memory','mole','simon','cups','flappy'].every(id => s.games.best[id] !== undefined) },
    // секретные
    { id:'sakhalin', ico:'🤫', name:'Сахалин',           secret:true, desc:'Успеть везде и никуда не успеть',                 chk: s => !!s.done['SV1d'] },
    { id:'cactus',   ico:'🌵', name:'Кактус',            secret:true, desc:'Увидеть цветение кактуса',                        chk: s => !!s.done['Tp4'] },
    { id:'diplomat', ico:'🕊️', name:'Дипломат',          secret:true, desc:'Помирить тех, кто не должен был ссориться',       chk: s => !!s.done['AV1b'] },
    { id:'alisa2',   ico:'🤖', name:'Алиса 2.0',         secret:true, desc:'Подружиться с ассистентом по-настоящему',         chk: s => !!s.done['AL6'] },
    { id:'caught',   ico:'🎭', name:'Пойман с поличным', secret:true, desc:'Отрицать очевидное и быть уличённым',             chk: s => !!s.done['SVrev1b'] || !!s.done['ANrev1b'] || !!s.done['VKrev1b'] || !!s.done['KRev1b'] },
    { id:'teachfrog',ico:'📌', name:'Жаба на парту',     secret:true, desc:'Отправить классному руководителю стикер',         chk: s => (s.stat.to['teach:sticker']||0) >= 1 }
  ],

  // проверяет недостигнутые; возвращает число новых. тост — суммарный, чтобы не мелькало
  checkAch(){
    const s = this.state;
    if (!s.ach) s.ach = {};
    const got = [];
    for (const a of this.ACH){
      if (s.ach[a.id]) continue;
      let ok = false;
      try { ok = a.chk(s); } catch(e){}
      if (ok){ s.ach[a.id] = s.day; got.push(a); }
    }
    if (got.length){
      this.pop('like');
      UI.toast('🏆 Достижение: ' + got[0].name + (got.length > 1 ? ' (+' + (got.length-1) + ')' : ''));
    }
    return got.length;
  },

  /* ---------- планировщик: дуги и случайные события ---------- */

  // пауза жизни чатов: пока «разоблачение» не разрешено в общем чате (идёт GR-цепочка),
  // личные чаты не получают новых событий, а мотание времени заблокировано
  groupHold(){
    const g = this.state.chats.group;
    return !!(g && g.participants && !this.state.done.GR_over
      && (g.queue.length || g.incoming.length || g.choice || g.pendingChoices));
  },

  // брошенная (#dump:) молчит: до развязки её арки — всегда, после «ЧС» — навсегда,
  // после мирного финала (#dumpres:) — два дня на переварить, потом обычная жизнь.
  // Ургент-сцены её арки это НЕ блокирует: проверка идёт только для арок и пулов
  dumpSilent(charId){
    const s = this.state;
    if (!s.done['#dump:' + charId]) return false;
    if (s.done['#block:' + charId]) return true;
    if (!s.done['#dumpres:' + charId]) return true;
    return s.day - (s.flagday['#dumpres:' + charId] || 0) < 2;
  },

  readyArc(charId){
    for (const [node, cond] of GD.chars[charId].arcs || []){
      if (this.state.done[node]) continue;
      // первая ДОСТУПНАЯ дуга: недоступные (например, no_gf при наличии девушки)
      // пропускаются, а не блокируют хвост — порядок обеспечивает пороги day/rel
      if (this.condOK(cond, charId)) return node;
    }
    return null;
  },

  // срочные события (разоблачения): первый подходящий узел, без блокировки следующих
  readyUrgent(charId){
    for (const [node, cond] of GD.chars[charId].urgent || []){
      if (!this.state.done[node] && this.condOK(cond, charId)) return node;
    }
    return null;
  },

  // пул случайных событий; узлы из replay переигрываются раз в POOL_CD дней
  readyPool(charId){
    const s = this.state;
    const replay = GD.chars[charId].replay || [];
    const options = [];
    for (const [node, cond] of GD.chars[charId].pool || []){
      if (this.state.done[node] && !replay.includes(node)) continue;
      if (replay.includes(node)){
        const nsc = GD.scenes[node];
        // уникальные варианты реплик кончились — сцену больше не повторяем вовсе
        if (nsc && nsc.alts && nsc.alts.length && (s.altUsed || {})[node] >= nsc.alts.length) continue;
        const last = s.flagday['#pool:' + node] || 0;
        if (s.day - last < this.POOL_CD) continue;
      }
      if (this.condOK(cond, charId)) options.push(node);
    }
    return options.length ? options[Math.floor(Math.random()*options.length)] : null;
  },

  // ждёт ли где-то ответа игрок: выбор на экране или уже подготовлен
  // (дожидается доставки последнего сообщения сцены) — в любом диалоге
  hasAwaitingReply(){
    for (const id in this.state.chats){
      const ch = this.state.chats[id];
      if (ch && (ch.choice || ch.pendingChoices)) return true;
    }
    return false;
  },

  triggerEvents(force){
    const s = this.state;
    let startedAny = false;
    // автопрокрутка времени стоит, пока в любом диалоге ждёт ответа игрок;
    // ручная промотка (⏩) работает всегда
    if (!force && this.hasAwaitingReply()) return false;
    for (const charId in GD.chars){
      // пока не разрешён общий диалог, жизнь личных чатов на паузе (сам общий чат работает)
      if (charId !== 'group' && this.groupHold()) continue;
      const ch = this.chat(charId);
      if (ch.incoming.length || ch.choice || ch.pendingChoices || ch.queue.length) continue;
      // срочное (разоблачение и т.п.) — вне очереди и дневных лимитов
      const urg = this.readyUrgent(charId);
      if (urg){
        this.startNode(charId, urg);
        startedAny = true;
        continue;
      }
      // брошенная молчит: её арки и пулы не запускаются до развязки (ургент арки выше — работает)
      if (charId !== 'group' && this.dumpSilent(charId)) continue;
      const arc = this.readyArc(charId);
      if (arc){
        this.startNode(charId, arc);
        startedAny = true;
        continue;
      }
      // пул случайных событий: до 2 на день на персонажа
      const key = charId + ':' + s.day;
      const cnt = s.done['#pool:' + key] || 0;
      // одна случайная сцена в день на персонажа: две подряд выглядят как скачки темы
      if (cnt < 1 && (force || Math.random() < 0.22)){
        const pool = this.readyPool(charId);
        if (pool){
          s.done['#pool:' + key] = cnt + 1;
          this.startNode(charId, pool, false, true);
          startedAny = true;
        }
      }
    }
    if (startedAny) UI.renderBadges();
    return startedAny;
  },

  /* ---------- время ---------- */

  clockStr(){
    const m = Math.floor(this.state.minutes) % 1440;
    return String(Math.floor(m/60)).padStart(2,'0') + ':' + String(m%60).padStart(2,'0');
  },

  // минуты суток или [часы, минуты]. Если цель уже позади — ночь следующего дня,
  // без утреннего перескока на 08:00.
  jumpToClock(hm){
    const target = Array.isArray(hm) ? ((hm[0] % 24) * 60 + (hm[1] || 0) % 60) : (hm % 1440);
    const cur = Math.floor(this.state.minutes) % 1440;
    const diff = Math.abs(cur - target);
    if (diff <= 12 || diff >= 1440 - 12) return;
    if (target >= cur){
      this.state.minutes += (target - cur);
    } else {
      this.state.day++;
      this.state.minutes = target;
    }
    if (typeof UI !== 'undefined' && UI.renderBadges) UI.renderBadges();
  },

  bumpClock(min){
    this.state.minutes += min;
    while (this.state.minutes >= 24*60) this.newDay();
  },

  newDay(){
    const s = this.state;
    s.minutes = (s.minutes - 24*60) + 8*60;      // утро следующего дня
    s.day++;
    s.coins += 25;
    UI.toast('🌅 День ' + s.day + ' · ежедневный бонус +25 🪙');
    // рекламная пауза при смене дня, но не чаще раза в минуту (иначе Яндекс сам троттлит)
    if (Date.now() - (this._lastInterstitial || 0) > 60000){
      this._lastInterstitial = Date.now();
      YSDK.showInterstitial();
    }
    this.save();
    UI.onDayChange();
  },

  skipTime(){
    if (UI.adPlaying) return;
    if (this.groupHold()){
      UI.toast('💔 Не до промотки: тебя ждут в общем чате');
      UI.onTick();
      return;
    }
    this.bumpClock(45 + Math.floor(Math.random()*90));
    const started = this.triggerEvents(true);
    if (!started) UI.toast('…пока тихо. Все заняты своими делами');
    this.save();
    UI.onTick();
  },

  /* ---------- перезапуск ---------- */

  restart(keepStuff){
    const old = this.state;
    const fresh = this.freshState();
    if (keepStuff){
      fresh.gallery = old.gallery;
      fresh.purchased = old.purchased;
      fresh.equipped = old.equipped;
      fresh.coins = old.coins;
      fresh.sound = old.sound;
      fresh.games = old.games;
    } else {
      fresh.sound = old.sound;
    }
    this.state = fresh;
    for (const id in GD.chars) this.chat(id);
    this.save();
    YSDK.cloudSave(this.state);
  },

  /* ---------- аудио ---------- */

  _ctx: null,
  pop(kind){
    if (!this.state || !this.state.sound) return;
    try {
      this._ctx = this._ctx || new (window.AudioContext || window.webkitAudioContext)();
      const o = this._ctx.createOscillator(), g = this._ctx.createGain();
      o.frequency.value = kind === 'in' ? 660 : (kind === 'like' ? 880 : (kind === 'neg' ? 330 : 520));
      o.type = 'sine';
      g.gain.setValueAtTime(0.06, this._ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.001, this._ctx.currentTime + 0.16);
      o.connect(g); g.connect(this._ctx.destination);
      o.start(); o.stop(this._ctx.currentTime + 0.18);
    } catch(e){}
  },

  audioMute(muted){ /* на время рекламы звуки глушатся самим попапом */ },

  // запуск истории (после загрузки)
  begin(){
    if (!this.state.started){
      this.state.started = true;
      this.triggerEvents(true);
      this.save();
    }
  }
};
