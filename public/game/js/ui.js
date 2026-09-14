/* ============ UI: экраны телефона ============ */
'use strict';

// количество открытых достижений (для бейджа)
function allAchCount(s){ return Object.keys(s.ach || {}).length; }

const WEEKDAYS = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];

const UI = {
  currentChat: null,
  currentScreen: 'home',
  storeTab: 'themes',
  galleryFilter: '',
  adPlaying: false,

  /* ---------- навигация ---------- */

  show(name){
    if (this.currentScreen === 'minigame' && name !== 'minigame') MiniGames.stop();
    this.currentScreen = name;
    document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
    const el = document.getElementById('screen-' + name);
    if (el) el.classList.add('active');
    if (name === 'chats') this.renderChatList();
    if (name === 'gallery') this.renderGallery();
    if (name === 'store') this.renderStore();
    if (name === 'games') MiniGames.renderList();
    if (name === 'minigame') MiniGames.onScreen();
    if (name === 'diary') this.renderDiary();
    if (name === 'ach') this.renderAch();
    if (name === 'chat') this.renderChat(true);
    if (name === 'home') this.renderHomeClock();
    this.renderBadges();
  },

  initNav(){
    document.querySelectorAll('[data-nav]').forEach(b => {
      b.addEventListener('click', () => {
        const nav = b.dataset.nav;
        if (nav === 'chats'){ this.currentChat = null; }
        this.show(nav);
      });
    });
  },

  /* ---------- статус-бар / бейджи ---------- */

  renderBadges(){
    const s = Game.state;
    document.getElementById('sb-time').textContent = Game.clockStr();
    document.getElementById('sb-day').textContent = 'День ' + s.day;
    document.getElementById('sb-coins').textContent = '🪙 ' + s.coins;
    const storeCoins = document.getElementById('store-coins');
    if (storeCoins) storeCoins.textContent = s.coins;
    let unread = 0, awaitN = 0;
    for (const id in GD.chars){
      const ch = s.chats[id];
      if (!ch) continue;
      unread += ch.unread;
      if (ch.choice) awaitN++;
    }
    const badge = document.getElementById('badge-chats');
    badge.hidden = unread === 0 && awaitN === 0;
    badge.textContent = unread > 0 ? (unread > 99 ? '99+' : unread) : '✍';
    badge.classList.toggle('await', awaitN > 0);
    const achBadge = document.getElementById('badge-ach');
    if (achBadge){
      const got = allAchCount(s);
      achBadge.hidden = got === 0;
      achBadge.textContent = got;
    }
    const gc = document.getElementById('gallery-count');
    if (gc) gc.textContent = '📷 ' + s.gallery.length;
    // пока не разрешён общий диалог — кнопка промотки приглушена
    const skip = document.getElementById('btn-skip');
    if (skip) skip.classList.toggle('hold', Game.groupHold());
    if (this.currentScreen === 'home') this.renderHomeWidget();
  },

  onTick(){ this.renderBadges(); if (this.currentScreen === 'home') this.renderHomeClock(); if (this.currentChat) this.renderChat(); },
  onDayChange(){ this.renderBadges(); },

  renderHomeClock(){
    const el = document.querySelector('.hc-time');
    if (el) el.textContent = Game.clockStr();
    const d = document.querySelector('.hc-date');
    if (d) d.textContent = 'День ' + Game.state.day + ' · ' + WEEKDAYS[Game.state.day % 7];
  },

  lastPreview(id){
    const ch = Game.state.chats[id];
    if (!ch) return 'Начните общение';
    const last = ch.hist.length ? ch.hist[ch.hist.length-1] : null;
    const incoming = (!last && ch.incoming && ch.incoming[0]) ? ch.incoming[0] : null;
    const src = last || incoming;
    let prev = Game.subst(ch.last || (src ? (src.who === 'photo' ? '📷 Фото' : (src.who === 'out' ? 'Вы: ' + src.txt : src.txt)) : 'Начните общение'), ch.participants);
    if (src && src.who === 'out' && !ch.last) prev = 'Вы: ' + prev;
    return prev;
  },

  renderHomeWidget(){
    const body = document.getElementById('hw-body');
    const count = document.getElementById('hw-count');
    if (!body || !count) return;
    const s = Game.state;
    const awaiting = [], unread = [];
    for (const id of this.chatOrder()){
      const ch = s.chats[id];
      if (!ch) continue;
      if (ch.choice) awaiting.push(id);
      else if (ch.unread > 0) unread.push(id);
    }
    const hot = awaiting.concat(unread);
    const unreadN = unread.reduce((n, id) => n + (s.chats[id].unread || 0), 0);
    count.classList.toggle('hot', unreadN > 0 && !awaiting.length);
    count.classList.toggle('await', awaiting.length > 0);
    count.textContent = awaiting.length
      ? (awaiting.length === 1 ? 'ждёт ответа' : 'ждут ответа')
      : (unreadN > 0 ? unreadN + ' новых' : 'тихо');

    const order = this.chatOrder();
    const show = (hot.length ? hot : order).slice(0, 4);
    const first = show[0];
    const sig = awaiting.join(',') + '|' + unread.join(',') + '|' + unreadN + '|' + (first || '') + '|' + (first ? this.lastPreview(first) : '');
    if (sig === this._hwSig && body.firstChild) return;
    this._hwSig = sig;
    if (!show.length){
      body.innerHTML = '<span class="hw-empty">Скоро кто-нибудь напишет</span>';
      return;
    }
    const avas = show.map(id => {
      const c = GD.chars[id];
      return `<span class="hw-ava" data-open-chat="${id}" style="background:linear-gradient(135deg,${c.c1},${c.c2})">${c.ava}${Photo.avaImg(id)}</span>`;
    }).join('');
    body.innerHTML = `<span class="hw-avas">${avas}</span>
      <span class="hw-copy">
        <span class="hw-name">${this.esc(this.tname(first))}</span>
        <span class="hw-prev">${this.esc(this.lastPreview(first))}</span>
      </span>`;
    body.querySelectorAll('[data-open-chat]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        this.currentChat = el.dataset.openChat;
        Game.chat(this.currentChat).unread = 0;
        this.show('chat');
      });
    });
  },

  /* ---------- чаты ---------- */

  // отображаемое имя: для группового чата — имена участниц
  tname(id){
    const c = GD.chars[id];
    if (!c) return id;
    if (c.dyn){
      const parts = (Game.state.chats[id] && Game.state.chats[id].participants) || [];
      return parts.map(p => GD.chars[p].name.split(' ')[0]).join(' + ') || c.name;
    }
    return c.name;
  },

  chatOrder(){
    const s = Game.state;
    return Object.keys(GD.chars).filter(id => {
      const ch = s.chats[id];
      return ch && (ch.hist.length || ch.incoming.length);
    }).sort((a,b) => {
      // свежие чаты сверху; для сейвов без метки — как раньше, по объёму истории
      const ta = s.chats[a].at || s.chats[a].hist.length;
      const tb = s.chats[b].at || s.chats[b].hist.length;
      return tb - ta;
    });
  },

  renderChatList(){
    const s = Game.state;
    const list = document.getElementById('chat-list');
    const ids = this.chatOrder();
    const others = Object.keys(GD.chars).filter(id => !ids.includes(id));
    list.innerHTML = ids.concat(others.length && ids.length === 0 ? others : []).map(id => {
      const c = GD.chars[id], ch = s.chats[id];
      const last = ch.hist.length ? ch.hist[ch.hist.length-1] : null;
      const prev = this.lastPreview(id);
      const time = last ? last.t : '';
      const awaiting = !!ch.choice;
      const unread = awaiting ? '<span class="await-dot">✍</span>'
        : (ch.unread > 0 ? '<span class="unread-dot">' + ch.unread + '</span>' : '');
      const gf = (s.gf === id || s.gf2 === id || (Array.isArray(s.harem) && s.harem.includes(id))) ? '<span class="gf-mark">❤</span>' : '';
      return `<button class="chat-row${awaiting ? ' await' : ''}" data-chat="${id}">
        <span class="ava" style="background:linear-gradient(135deg,${c.c1},${c.c2})">${c.ava}${Photo.avaImg(id)}</span>
        <span class="c-body">
          <span class="c-top"><span class="c-name">${this.tname(id)}${gf}</span><span class="c-time">${time}</span></span>
          <span class="c-prev ${ch.unread?'unread':''}">${this.esc(prev)}</span>
        </span>
        ${unread}
      </button>`;
    }).join('') || '<div class="gallery-empty">Пока тихо…<br>Скоро кто-нибудь напишет 🙂</div>';
    list.querySelectorAll('[data-chat]').forEach(b => {
      b.addEventListener('click', () => {
        this.currentChat = b.dataset.chat;
        Game.chat(this.currentChat).unread = 0;
        this.show('chat');
      });
    });
    const anyChoice = ids.some(id => s.chats[id].incoming.length || s.chats[id].choice);
    const hold = Game.groupHold();
    const hint = document.getElementById('skip-hint');
    hint.hidden = hold ? false : anyChoice;
    hint.textContent = hold
      ? '💔 Девушки ждут объяснений — нажми, чтобы открыть общий чат'
      : 'Все ушли по своим делам — нажми, чтобы листать время';
    this.renderBadges();
  },

  esc(t){ const d = document.createElement('div'); d.textContent = t; return d.innerHTML; },

  renderChat(force){
    const id = this.currentChat;
    if (!id) { this.show('chats'); return; }
    const c = GD.chars[id], ch = Game.chat(id);

    // сигнатура состояния чата: если ничего не изменилось — не трогаем DOM (иначе моргание).
    // ВАЖНО: hist подрезается с головы (кап 80), и длина при этом может не измениться
    // (подарок+ответ: push → splice → push), поэтому в проверке участвует и якорь головы
    const headKey = ch.hist.length ? ((ch.hist[0].id !== undefined ? ch.hist[0].id : 'n') + ':' + ch.hist[0].who) : '';
    const sig = ch.hist.length + '|' + ch.incoming.length + '|' + (ch.choice ? ch.choice.node : '');
    if (force !== 'rebuild' && !force && id === this._chatId && sig === this._chatSig && headKey === this._chatHeadKey) return;
    // 'rebuild' — принудительно перерисовать все сообщения, минуя инкрементальный путь.
    // при сдвиге головы инкрементальный хвост «промахнётся» — нужен полный rebuild
    const fullRebuild = force === 'rebuild' || this._chatId !== id || this._chatHistLen === undefined
      || ch.hist.length < (this._chatHistLen || 0) || headKey !== this._chatHeadKey;

    // шапка
    document.getElementById('chat-ava').innerHTML = c.ava + Photo.avaImg(id);
    document.getElementById('chat-ava').style.background = `linear-gradient(135deg,${c.c1},${c.c2})`;
    document.getElementById('chat-name').textContent = this.tname(id);
    // в общий чат подарки не отправляют — кнопки 🎁 там нет
    document.getElementById('btn-gift').hidden = !!c.dyn;
    const st = document.getElementById('chat-status');
    if (ch.incoming.length){ st.textContent = c.role + ' · печатает…'; st.className = 'chat-status typing'; }
    else { st.textContent = c.role + ' · ' + (ch.choice ? 'ждёт вашего ответа' : c.online); st.className = 'chat-status' + (ch.choice ? ' await' : ''); }

    // сообщения: при росте истории добавляем только новые
    const box = document.getElementById('messages');
    if (fullRebuild){
      box.innerHTML = this._msgsHtml(ch.hist, 0, ch.participants);
    } else {
      const from = this._chatHistLen || 0;
      const typing = box.querySelector('.typing-bubble');
      if (typing) typing.remove();
      if (from < ch.hist.length){
        const tpl = document.createElement('template');
        tpl.innerHTML = this._msgsHtml(ch.hist.slice(from), from, ch.participants);
        box.appendChild(tpl.content);
      }
    }
    this._chatHistLen = ch.hist.length;
    this._chatId = id;
    this._chatSig = sig;
    this._chatHeadKey = headKey;
    if (ch.incoming.length){
      const t = document.createElement('div');
      t.className = 'typing-bubble';
      t.innerHTML = '<i></i><i></i><i></i>';
      box.appendChild(t);
    }
    box.scrollTop = box.scrollHeight;
    this.bindPhotoViewer();
    this.bindLikes();

    // варианты ответа: перерисовываем только при смене узла выбора
    const rep = document.getElementById('replies');
    const chipsSig = ch.choice ? ch.choice.node + '#' + ch.choice.options.length : '';
    if (chipsSig !== this._chipsSig){
      this._chipsSig = chipsSig;
      const fi = document.getElementById('fake-input');
      if (ch.choice){
        const opts = ch.choice.options.map((o, i) => ({o, i})).filter(x => Game.condOK(x.o.req, id));
        rep.innerHTML = opts.map(x => `<button class="chip" data-ci="${x.i}">${this.esc(Game.subst(x.o.t, ch.participants))}</button>`).join('');
        rep.querySelectorAll('[data-ci]').forEach(b => b.addEventListener('click', () => {
          Game.pop('out');
          if (navigator.vibrate) try { navigator.vibrate(8); } catch(e){}
          Game.choose(this.currentChat, parseInt(b.dataset.ci, 10));
        }));
        fi.textContent = 'Выберите ответ ниже…';
      } else {
        rep.innerHTML = '';
        fi.textContent = 'Двойное нажатие на сообщение — лайк ❤';
      }
    }
  },

  // лайк по двойному нажатию на входящее сообщение (повторное — снимает).
  // два клика в пределах 400 мс: событие dblclick на тач-устройствах нестабильно
  bindLikes(){
    document.querySelectorAll('#messages .msg.in').forEach(el => {
      if (el._likeBound) return;
      el._likeBound = true;
      el.addEventListener('click', () => {
        const now = Date.now();
        if (now - (el._lastTap || 0) > 400){ el._lastTap = now; return; }
        el._lastTap = 0;
        const ch = Game.chat(this.currentChat);
        const m = ch.hist.find(x => x.id === parseInt(el.dataset.mid, 10));
        if (!m) return;
        Game.pop('like');
        if (navigator.vibrate) try { navigator.vibrate(8); } catch(e){}
        const liked = Game.toggleLike(this.currentChat, m);
        const r = el.querySelector('.react');
        if (liked && !r) el.insertAdjacentHTML('beforeend', '<span class="react">❤</span>');
        if (!liked && r) r.remove();
      });
    });
  },

  // девушка отреагировала на ответ игрока: в открытом чате — эмодзи на пузырь, иначе — тост
  onGirlLike(charId, m, neg){
    const emoji = typeof m.likedBy === 'string' ? m.likedBy : '❤';
    if (this.currentChat === charId && this.currentScreen === 'chat'){
      const el = document.querySelector('#messages [data-mid="' + m.id + '"]');
      if (el && !el.querySelector('.react')) el.insertAdjacentHTML('beforeend', '<span class="react by">' + emoji + '</span>');
      Game.pop(neg ? 'neg' : 'like');
      if (navigator.vibrate) try { navigator.vibrate(neg ? [30,40,30] : 12); } catch(e){}
    } else {
      const c = GD.chars[charId];
      if (c) this.toast(emoji + ' ' + c.ava + ' ' + c.name + (neg ? ' не оценила твой ответ' : ' лайкнула твой ответ'));
    }
  },

  _msgsHtml(list, offset, parts){
    let html = '';
    // общий чат: у входящих реплик показываем аватарку отправительницы
    const grp = Array.isArray(parts) && parts.length >= 2;
    const nmOf = id => (GD.chars[id] ? GD.chars[id].name : '');
    for (let i = 0; i < list.length; i++){
      const m = list[i];
      const mid = m.id ? ' data-mid="' + m.id + '"' : '';
      const byReact = m.likedBy ? (typeof m.likedBy === 'string' ? m.likedBy : '❤') : null; // в старых сейвах likedBy=1
      const react = m.liked ? '<span class="react">❤</span>' : (byReact ? '<span class="react by">' + byReact + '</span>' : '');
      if (m.who === 'photo'){
        html += `<div class="msg photo-msg"${mid} data-pv="${m.photo}">${Photo.imgTag(m.photo)}<span class="t">${m.t||''}</span>${react}</div>`;
      } else if (m.who === 'gift'){
        const g = Game.GIFTS[m.gift] || { emoji:'🎁', name:'Подарок' };
        html += `<div class="msg out gift-msg"><span class="g-emoji">${g.emoji}</span><span class="g-name">Подарок: ${g.name} · ${g.price} 🪙</span><span class="t">${m.t||''}</span></div>`;
      } else if (m.who === 'sys'){
        html += `<div class="msg sys">${this.esc(Game.subst(m.txt, parts))}</div>`;
      } else {
        let txt = Game.subst(m.txt, parts), from = null;
        if (grp && m.who === 'in'){
          // отправитель закодирован префиксом «Имя: » — все реплики групповых сцен начинаются так
          const cands = parts.slice(0, 2).slice().sort((a, b) => nmOf(b).length - nmOf(a).length);
          for (const pid of cands){
            const nm = nmOf(pid);
            if (nm && txt.startsWith(nm + ':')){ from = pid; txt = txt.slice(nm.length + 1).replace(/^ +/, ''); break; }
          }
        }
        const ava = from ? '<span class="m-ava" data-ava="' + from + '" style="background:linear-gradient(135deg,' + GD.chars[from].c1 + ',' + GD.chars[from].c2 + ')">' + GD.chars[from].ava + Photo.avaImg(from) + '</span>' : '';
        html += `<div class="msg ${m.who}${from ? ' grp' : ''}"${mid}>${ava}${this.esc(txt)}<span class="t">${m.t||''}</span>${react}</div>`;
      }
    }
    return html;
  },

  // увеличенная аватарка: клик по аватару в шапке диалога или у сообщения группового чата.
  // Нет файла ava_<id>.webp — под эмодзи остаётся градиент (как и в мелких аватарках)
  openAva(id){
    const c = GD.chars[id];
    if (!c) return;
    document.getElementById('pv-card').innerHTML =
      '<span class="ava-big" style="background:linear-gradient(135deg,' + c.c1 + ',' + c.c2 + ')">' + c.ava +
      '<img src="' + Photo.avaSrc(id) + '" alt="" onerror="this.remove()"></span>';
    document.getElementById('pv-caption').textContent = this.tname(id);
    document.getElementById('photo-viewer').hidden = false;
  },

  bindPhotoViewer(){
    document.querySelectorAll('#messages [data-pv]').forEach(el => {
      if (el._pvBound) return;
      el._pvBound = true;
      el.addEventListener('click', () => this.openPhoto(el.dataset.pv));
    });
    // аватарки у сообщений: stopPropagation, чтобы двойной тап по аватарке
    // не засчитался как лайк сообщения
    document.querySelectorAll('#messages [data-ava]').forEach(el => {
      if (el._avaBound) return;
      el._avaBound = true;
      el.addEventListener('click', e => { e.stopPropagation(); this.openAva(el.dataset.ava); });
    });
  },

  onChatUpdate(charId, isOpen, isIncoming){
    if (isIncoming) {
      Game.pop('in');
      if (navigator.vibrate) try { navigator.vibrate(12); } catch(e){}
    }
    if (isOpen && this.currentChat === charId) this.renderChat();
    if (this.currentScreen === 'chats') this.renderChatList();
    this.renderBadges();
  },

  notifyIncoming(charId, m){
    const c = GD.chars[charId];
    const text = m.who === 'photo' ? '📷 Фото' : (m.txt || '');
    this.notify(c.ava, c.c1, c.c2, this.tname(charId), text, charId);
  },

  notify(ava, c1, c2, name, text, tAvaId){
    // один слот: новое уведомление заменяет предыдущее, клик открывает чат
    const html = `<span class="t-ava" style="background:linear-gradient(135deg,${c1},${c2})">${ava}${Photo.avaImg(tAvaId)}</span>
      <span><b>${this.esc(name)}</b> · ${this.esc(text.length > 44 ? text.slice(0,44) + '…' : text)}</span>`;
    this._showToast(html, () => {
      if (!tAvaId) return;
      this.currentChat = tAvaId;
      Game.chat(tAvaId).unread = 0;
      this.show('chat');
    });
  },

  _showToast(html, onclick){
    const box = document.getElementById('toasts');
    clearTimeout(this._toastTimer);
    box.innerHTML = '';
    const el = document.createElement('div');
    el.className = 'toast';
    el.innerHTML = html;
    if (onclick){
      el.addEventListener('click', () => { this.hideToast(); onclick(); });
      el.style.pointerEvents = 'auto';
    }
    box.appendChild(el);
    this._toastTimer = setTimeout(() => this.hideToast(), 3200);
  },

  hideToast(){
    clearTimeout(this._toastTimer);
    const box = document.getElementById('toasts');
    const el = box.firstElementChild;
    if (el){ el.classList.add('out'); setTimeout(() => el.remove(), 300); }
  },

  toast(text){
    this._showToast(`<span>${this.esc(text)}</span>`);
  },

  /* ---------- галерея ---------- */

  galleryChipLabel(id){
    const c = GD.chars[id];
    if (!c) return id;
    const short = id === 'young' ? 'Е.А.' : (id === 'teach' ? 'Ольга Н.' : c.name.split(' ')[0]);
    return (c.ava ? c.ava + ' ' : '') + short;
  },

  renderGallery(){
    const s = Game.state;
    const grid = document.getElementById('gallery-grid');
    const filters = document.getElementById('gallery-filters');
    const items = s.gallery.filter(g => Photo.get(g.id));
    const chars = [];
    items.forEach(g => {
      const id = Photo.get(g.id).char;
      if (id && !chars.includes(id)) chars.push(id);
    });
    if (this.galleryFilter && !chars.includes(this.galleryFilter)) this.galleryFilter = '';
    if (filters){
      filters.hidden = items.length < 2 || chars.length < 2;
      if (!filters.hidden){
        const chip = (id, label) => `<button type="button" class="gal-chip${this.galleryFilter===id?' active':''}" data-gchar="${id}">${label}</button>`;
        filters.innerHTML = chip('', 'Все') + chars.map(id => chip(id, this.galleryChipLabel(id))).join('');
        filters.querySelectorAll('[data-gchar]').forEach(b => b.addEventListener('click', () => {
          this.galleryFilter = b.dataset.gchar;
          this.renderGallery();
        }));
      }
    }
    const shown = this.galleryFilter ? items.filter(g => Photo.get(g.id).char === this.galleryFilter) : items;
    if (!items.length){
      grid.innerHTML = '<div class="gallery-empty"><b>Галерея пока пуста 📷</b>Общайтесь с девчонками — и они пришлют фото.<br>Ещё сеты можно открыть в магазине.<br><button type="button" class="empty-cta" data-go-store>Смотреть фотосеты</button></div>';
      const go = grid.querySelector('[data-go-store]');
      if (go) go.addEventListener('click', () => { this.storeTab = 'packs'; this.show('store'); });
    } else {
      grid.innerHTML = shown.map(g => Photo.polaroid(g.id, false)).join('')
        || '<div class="gallery-empty"><b>В этом альбоме пусто</b>Попробуйте другой фильтр или откройте сеты в магазине.</div>';
      grid.querySelectorAll('[data-photo]').forEach(b => b.addEventListener('click', () => this.openPhoto(b.dataset.photo)));
    }
    this.renderBadges();
  },

  openPhoto(id){
    const def = Photo.get(id);
    if (!def) return;
    document.getElementById('pv-card').innerHTML = Photo.imgTag(id) + '<span class="pol-cap">' + this.esc(def.cap) + '</span>';
    document.getElementById('pv-caption').textContent = def.title + ' · день ' + (Game.state.gallery.find(g=>g.id===id)||{}).day;
    document.getElementById('photo-viewer').hidden = false;
  },

  /* ---------- магазин ---------- */

  renderStore(){
    const s = Game.state;
    const grid = document.getElementById('store-grid');
    document.querySelectorAll('.store-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === this.storeTab));
    document.getElementById('store-coins').textContent = s.coins;
    let html = '';
    if (this.storeTab === 'themes' || this.storeTab === 'cases'){
      const type = this.storeTab === 'themes' ? 'themes' : 'cases';
      const eqKey = this.storeTab === 'themes' ? 'theme' : 'case';
      html = STORE[type].map(item => {
        const owned = Store.owned(s, type, item);
        const equipped = s.equipped[eqKey] === item.id;
        let btn;
        if (owned && equipped) btn = '<button class="buy-btn owned" disabled>Включено ✓</button>';
        else if (owned) btn = `<button class="buy-btn" data-equip="${item.id}">Применить</button>`;
        else btn = `<button class="buy-btn" data-buy="${item.id}">🪙 ${item.price}</button>
                    <button class="buy-btn ad" data-adbuy="${item.id}">▶ За рекламу</button>`;
        return `<div class="store-card">
          <div class="store-prev" style="background:${item.prev}"></div>
          <div class="store-name">${item.name}</div>
          <div class="store-desc">${item.desc}</div>
          <div class="store-price">${btn}</div>
        </div>`;
      }).join('');
    } else {
      html = '<div class="store-banner"><b>Фотосеты</b> — секретные фотосессии для вашей галереи: за монеты или за рекламу. Сеты <b>✨ Premium</b> («Спустя 10 лет» и приватные фотосеты Елизаветы Андреевны) — только за монеты: героини взрослые, и фотосессии соответствующие.</div>' +
        STORE.packs.map(item => {
          const owned = Store.owned(s, 'packs', item);
          const preview = item.photos.slice(0,2).map(pid => `<span class="store-thumb">${Photo.imgTag(pid)}</span>`).join('');
          const btn = owned ? '<button class="buy-btn owned" disabled>В галерее ✓</button>'
            : `<button class="buy-btn" data-buy="${item.id}">🪙 ${item.price}</button>` +
              (item.vip ? '' : `<button class="buy-btn ad" data-adbuy="${item.id}">▶ За рекламу</button>`);
          return `<div class="store-card${item.vip ? ' vip' : ''}">
            <div class="store-prev" style="background:var(--panel2);gap:4px">${preview}</div>
            <div class="store-name">${item.vip ? '✨ ' : ''}${item.name}</div>
            <div class="store-desc">${item.desc}</div>
            <div class="store-price">${btn}</div>
          </div>`;
        }).join('');
    }
    grid.innerHTML = html;
    grid.querySelectorAll('[data-equip]').forEach(b => b.addEventListener('click', () => {
      const id = b.dataset.equip;
      if (this.storeTab === 'themes') s.equipped.theme = id; else s.equipped.case = id;
      this.applyLook(); Game.save(); this.renderStore();
    }));
    grid.querySelectorAll('[data-buy]').forEach(b => b.addEventListener('click', () => {
      const type = this.storeTab === 'themes' ? 'themes' : (this.storeTab === 'cases' ? 'cases' : 'packs');
      const item = Store.byId(type, b.dataset.buy);
      const res = Store.buyWithCoins(s, type, item);
      if (!res.ok){ this.toast(res.msg); return; }
      this.afterPurchase(type, item);
    }));
    grid.querySelectorAll('[data-adbuy]').forEach(b => b.addEventListener('click', () => {
      const type = this.storeTab === 'themes' ? 'themes' : (this.storeTab === 'cases' ? 'cases' : 'packs');
      const item = Store.byId(type, b.dataset.adbuy);
      this.showAdStub().then(ok => {
        if (!ok) return;
        const res = Store.buyWithAd(s, type, item);
        if (res.ok) this.afterPurchase(type, item);
      });
    }));
    this.renderBadges();
  },

  afterPurchase(type, item){
    Game.save();
    if (type === 'themes') Game.state.equipped.theme = item.id;
    if (type === 'cases') Game.state.equipped.case = item.id;
    if (type === 'packs') item.photos.forEach(pid => Game.addPhoto(pid));
    this.applyLook();
    this.renderStore();
    this.toast('Покупка оформлена: ' + item.name);
  },

  applyLook(){
    const s = Game.state;
    document.getElementById('phone').className = 'theme-' + s.equipped.theme + ' case-' + s.equipped.case;
  },

  initStore(){
    document.querySelectorAll('.store-tab').forEach(t => t.addEventListener('click', () => {
      this.storeTab = t.dataset.tab; this.renderStore();
    }));
    document.getElementById('btn-free-coins').addEventListener('click', () => {
      this.showAdStub().then(ok => {
        if (ok){
          Game.state.coins += STORE.FREE_COINS_REWARD;
          Game.save();
          this.toast('+' + STORE.FREE_COINS_REWARD + ' 🪙 за просмотр рекламы');
          this.renderBadges();
          if (this.currentScreen === 'store') this.renderStore();
        }
      });
    });
  },

  /* ---------- дневник ---------- */

  renderDiary(){
    const s = Game.state;
    const heartBar = n => {
      const pct = Math.max(0, Math.min(100, n));
      return `<div class="heart-bar" aria-hidden="true"><span class="heart-fill" style="width:${pct}%"></span></div>`;
    };
    const romance = ['katya','sveta','anya','vika'];
    const order = romance.concat(['dima','mama','alisa','teach','young']);
    const traits = [];
    const fl = s.fl;
    if (fl.kind >= 4) traits.push(['Добряк','good']);
    if (fl.calm >= 3) traits.push(['Спокойный','good']);
    if (fl.romance >= 3) traits.push(['Романтик','good']);
    if (fl.humor >= 4) traits.push(['Душа компании','good']);
    if (fl.bold >= 4) traits.push(['Смелый','good']);
    if (fl.sport >= 2) traits.push(['Спортсмен','good']);
    if (fl.honest >= 3) traits.push(['Честный','good']);
    if (fl.lie >= 2) traits.push(['Заметно врёшь','bad']);
    if (fl.mamaBoy >= 4) traits.push(['Маменькин сынок','bad']);
    const traitsHtml = traits.length
      ? '<div class="diary-row diary-traits"><div class="d-name">Слухи о тебе</div>' + traits.map(t=>`<span class="trait ${t[1]}">${t[0]}</span>`).join(' ') + '</div>'
      : '';
    document.getElementById('diary-body').innerHTML = `
      <div class="diary-head">Отношения на день ${s.day}. У каждого свой вкус — один ответ не понравится всем сразу.</div>
      ${traitsHtml}
      ${order.map(id => {
        const c = GD.chars[id];
        const rel = s.rel[id];
        let gf = '';
        if (Array.isArray(s.harem) && s.harem.includes(id)) gf = ' <span style="color:#ff3d6e">❤🔥 втроём</span>';
        else if (s.gf === id) gf = ' <span style="color:#ff3d6e">❤ встречаются</span>';
        else if (s.gf2 === id) gf = ' <span style="color:#ff3d6e">❤ тоже встречаются (она не знает)</span>';
        else if (id === 'young' && s.done['Y8love']) gf = ' <span style="color:#cbaee6">📖 особая история</span>';
        // у девушки в охлаждении тир «знакомая» противоречит отметке «встречаются» — честно пишем про период
        const tier = (gf && rel < 40) ? 'тяжёлый период, но вы вместе' : c.tiers[Math.min(c.tiers.length-1, Math.floor(rel/20))];
        return `<div class="diary-row">
          <span class="ava" style="background:linear-gradient(135deg,${c.c1},${c.c2})">${c.ava}${Photo.avaImg(id)}</span>
          <div class="d-body">
            <div class="d-name">${c.name} <span class="d-role">${c.role||''}</span> ${gf}</div>
            ${heartBar(rel)}
            <div class="d-note">${tier} · ${c.likes}</div>
          </div>
        </div>`;
      }).join('')}`;
  },

  /* ---------- настройки ---------- */

  initSettings(){
    const snd = document.getElementById('set-sound');
    snd.addEventListener('change', () => { Game.state.sound = snd.checked; Game.save(); });
    document.getElementById('btn-howto').addEventListener('click', () => this.howto());
    document.getElementById('btn-restart-keep').addEventListener('click', () => {
      this.confirm('Начать заново?', 'История, отношения и диалоги начнутся с нуля.\n\nСохранятся: галерея, покупки и монеты.', [
        { label:'Начать заново', cls:'primary', onClick:() => this.doRestart(true) },
        { label:'Отмена', cls:'', onClick:() => {} }
      ]);
    });
    document.getElementById('btn-restart-full').addEventListener('click', () => {
      this.confirm('Полный сброс?', 'Будет удалено ВСЁ: история, отношения,\nгалерея, покупки и монеты.', [
        { label:'Удалить всё', cls:'danger', onClick:() => this.doRestart(false) },
        { label:'Отмена', cls:'', onClick:() => {} }
      ]);
    });
  },

  doRestart(keep){
    Game.restart(keep);
    this.currentChat = null;
    this.applyLook();
    document.getElementById('set-sound').checked = Game.state.sound;
    this.show('home');
    this.renderHomeClock();
    Game.begin();
    this.toast(keep ? 'Новая история! Гардероб и фото при тебе' : 'Полностью новая игра. Удачи!');
  },

  howto(){
    this.modal({ title:'Как играть', html:
      '📞 <b>Общайся</b> — выбирай ответы внизу чата. От выбора зависит отношение каждого персонажа.<br><br>' +
      '❤ <b>Лайк</b> — двойное нажатие на сообщение: +1 к отношению (раз в день с каждым). Повторное двойное нажатие снимает лайк. Девушки иногда сами реагируют на твои ответы — у каждой свой характер.<br><br>' +
      '🎁 <b>Подарки</b> — кнопка 🎁 в чате: стикеры, цветы, мишки и кольца. Подарки НЕ бесплатные — монеты зарабатываются мини-играми, днями и рекламой.<br><br>' +
      '💔 <b>Осторожнее с сердцами:</b> если предложишь встречаться второй девушке, не расставшись с первой — первая узнает. И тогда будет общий чат, где придётся выбирать. Спокойные девчонки (Катя и Вика) могут согласиться и на «втроём» — но только при почти идеальных отношениях с обеими и честных ответах в общем чате.<br><br>' +
      '🎯 <b>У всех свой вкус:</b><br>• Катя любит добрых и спокойных<br>• Света не выносит «маменькиных сыночков»<br>• Аня падка на романтику (и ревнива)<br>• Вика ценит честность<br>• Елизавета Андреевна ценит ум и честность: флирт с ней — сразу в минус. Отношения с ней возможны: честность в её ветках + посвящение на литературном вечере (и не встречайся в это время ни с кем другой)<br><br>' +
      '🏆 <b>Достижения</b> — иконка 🏆 на домашнем экране: от «Первого фото» до «Кабеля» (встречаться с двумя). Часть открыта сразу — чтобы было к чему стремиться, часть — секретные.<br><br>' +
      '⏩ <b>Время листается</b> кнопкой в чатах, когда все ушли по делам.<br><br>' +
      '📷 <b>Фото</b> сохраняются в Галерею, когда отношения становятся теплее. Больше фото — в Магазине.<br><br>' +
      '🪙 <b>Монеты</b> — за дни, помощь друзьям, мини-игры и рекламу. Тратятся на темы, корпуса, фотосеты и подарки.', actions:[{label:'Понятно', cls:'primary'}]});
  },

  /* ---------- модалки ---------- */

  modal({title, html, actions}){
    const box = document.getElementById('modal-box');
    box.innerHTML = `<h3>${title}</h3><div class="modal-body">${html}</div><div class="modal-actions"></div>`;
    const act = box.querySelector('.modal-actions');
    (actions||[]).forEach(a => {
      const b = document.createElement('button');
      b.className = 'm-btn ' + (a.cls||'');
      b.textContent = a.label;
      b.addEventListener('click', () => { document.getElementById('modal').hidden = true; a.onClick && a.onClick(); });
      act.appendChild(b);
    });
    document.getElementById('modal').hidden = false;
  },

  confirm(title, text, actions){ this.modal({title, html:text.replace(/\n/g,'<br>'), actions}); },

  /* ---------- заглушка рекламы (меняется на YSDK автоматически) ---------- */

  showAdStub(label){
    if (this.adPlaying) return Promise.resolve(false);
    return new Promise(resolve => {
      const ov = document.getElementById('ad-overlay');
      const timer = document.getElementById('ad-timer');
      const btn = document.getElementById('ad-close');
      ov.querySelector('.ad-label').textContent = label || 'РЕКЛАМА';
      this.adPlaying = true;
      let t = 3;
      ov.hidden = false;
      btn.disabled = true; btn.textContent = 'Пропустить (' + t + ')'; btn.classList.remove('ready');
      timer.textContent = t;
      const iv = setInterval(() => {
        t--;
        timer.textContent = t > 0 ? t : 'Готово!';
        btn.textContent = t > 0 ? 'Пропустить (' + t + ')' : 'Закрыть ✓';
        if (t <= 0){
          clearInterval(iv);
          btn.disabled = false; btn.classList.add('ready');
        }
      }, 1000);
      btn.onclick = () => {
        if (t > 0) return;
        ov.hidden = true;
        this.adPlaying = false;
        resolve(true);
      };
    });
  },

  /* ---------- подарки ---------- */

  initGifts(){
    document.getElementById('btn-gift').addEventListener('click', () => {
      const id = this.currentChat;
      if (!id || !GD.chars[id] || GD.chars[id].dyn) return;
      const s = Game.state;
      const cards = Object.entries(Game.GIFTS).map(([gid, g]) => {
        const own = GD.chars[id].gifts && GD.chars[id].gifts[gid];
        const rel = typeof own === 'number' ? own : g.rel;
        const bad = typeof own === 'number' && own < 0;
        const poor = s.coins < g.price;
        return `<button type="button" class="gift-card${poor?' dim':''}${bad?' bad':''}" data-gift="${gid}">
          <span class="gift-emoji">${g.emoji}</span>
          <b>${g.name}</b>
          <span class="gift-meta">🪙 ${g.price} · ${rel>0?'+':''}${rel}</span>
          ${bad?'<span class="gift-warn">ей не понравится</span>':''}
        </button>`;
      }).join('');
      this.modal({
        title: 'Подарок · ' + this.tname(id),
        html: `<div class="gift-bal">У вас <b>🪙 ${s.coins}</b></div><div class="gift-grid">${cards}</div>`,
        actions: [{ label:'Отмена', cls:'' }]
      });
      document.querySelectorAll('#modal-box [data-gift]').forEach(b => {
        b.addEventListener('click', () => {
          document.getElementById('modal').hidden = true;
          Game.sendGift(id, b.dataset.gift);
        });
      });
    });
  },

  /* ---------- достижения ---------- */

  renderAch(){
    const s = Game.state;
    const all = Game.ACH;
    const got = all.filter(a => s.ach[a.id]);
    const pct = all.length ? Math.round(got.length / all.length * 100) : 0;
    const head = `<div class="ach-head">Открыто <b>${got.length}</b> из ${all.length}<div class="ach-bar"><span style="width:${pct}%"></span></div></div>`;
    const rows = all.map(a => {
      const done = s.ach[a.id];
      if (done){
        return `<div class="ach-row done">
          <span class="ach-ico">${a.ico}</span>
          <span class="ach-body"><b>${a.name}</b><span>${this.esc(a.desc)}</span></span>
          <span class="ach-day">день ${done}</span>
        </div>`;
      }
      if (a.secret){
        return `<div class="ach-row secret">
          <span class="ach-ico">🔒</span>
          <span class="ach-body"><b>Секретное достижение</b><span>Откроется, если всё сложится определённым образом…</span></span>
        </div>`;
      }
      return `<div class="ach-row">
        <span class="ach-ico">${a.ico}</span>
        <span class="ach-body"><b>${a.name}</b><span>${this.esc(a.desc)}</span></span>
      </div>`;
    }).join('');
    document.getElementById('ach-list').innerHTML = head + rows;
  },

  /* ---------- запуск ---------- */

  init(){
    this.initNav();
    this.initStore();
    this.initSettings();
    this.initGifts();
    document.querySelector('#photo-viewer .ov-close').addEventListener('click', () => {
      document.getElementById('photo-viewer').hidden = true;
    });
    document.getElementById('photo-viewer').addEventListener('click', e => {
      if (e.target.id === 'photo-viewer') e.target.hidden = true;
    });
    // аватарка в шапке открытого диалога — тот же увеличенный просмотр
    document.getElementById('chat-ava').addEventListener('click', () => this.openAva(this.currentChat));
    document.getElementById('btn-skip').addEventListener('click', () => Game.skipTime());
    document.getElementById('skip-hint').addEventListener('click', () => {
      if (Game.groupHold()){
        this.currentChat = 'group';
        Game.chat('group').unread = 0;
        this.show('chat');
        return;
      }
      Game.skipTime();
    });
    document.getElementById('sb-coins').addEventListener('click', () => this.show('store'));
    document.getElementById('set-sound').checked = Game.state.sound;
    this.applyLook();
    this.renderHomeClock();
    this.renderBadges();
  }
};
