/* ============ Фото: каталог и загрузка картинок ============ */
'use strict';

// ---- каталог фото ----
const PHOTOS = {
  // Катя
  k_ph1:{char:'katya', pose:'peace', cap:'закат с нашего двора, акварель', title:'Катя · закат'},
  k_ph2:{char:'katya', pose:'wink', cap:'моя первая выставка!', title:'Катя · выставка'},
  k_ph3:{char:'katya', pose:'wave', cap:'пикник у реки 🧺', title:'Катя · пикник'},
  k_ph5:{char:'katya', pose:'wink', cap:'ты в очереди за котлетами 😄', title:'Катя · набросок в столовой'},
  k_ph4:{char:'katya', pose:'hug', cap:'мы ❤', title:'Катя · мы', couple:true},
  // Света
  s_ph1:{char:'sveta', pose:'peace', cap:'после тренировки 💪', title:'Света · зал'},
  s_ph2:{char:'sveta', pose:'wave', cap:'золото! смотрели?', title:'Света · кубок'},
  s_ph3:{char:'sveta', pose:'wink', cap:'рассвет над новым городом 🌅', title:'Света · пробежка'},
  s_ph4:{char:'sveta', pose:'peace', cap:'каток с лучшим 💙', title:'Света · каток', couple:true},
  // Аня
  a_ph1:{char:'anya', pose:'wink', cap:'наш парк осенью 🍂', title:'Аня · осень'},
  a_ph5:{char:'anya', pose:'wink', cap:'змей, дерево и мы 🪁', title:'Аня · старое фото', couple:true},
  a_ph2:{char:'anya', pose:'sit', cap:'звездопад, помнишь?', title:'Аня · звёзды'},
  a_ph3:{char:'anya', pose:'wink', cap:'дождь + стихи = 🌧️📖', title:'Аня · вечер'},
  a_ph4:{char:'anya', pose:'hug', cap:'зонт на двоих ☔', title:'Аня · зонт', couple:true},
  // Вика
  v_ph1:{char:'vika', pose:'peace', cap:'мы с Барсиком 🐈', title:'Вика · Барсик'},
  v_ph2:{char:'vika', pose:'guitar', cap:'репетиция громче всех 🤘', title:'Вика · гараж'},
  v_ph3:{char:'vika', pose:'guitar', cap:'крыша поёт 🌙', title:'Вика · крыша'},
  v_ph4:{char:'vika', pose:'hug', cap:'наша крыша ❤', title:'Вика · мы', couple:true},
  // Прочие
  m_ph1:{char:'mama', pose:'wave', cap:'мамин пирог 🥧', title:'Мама · пирог'},
  d_ph1:{char:'dima', pose:'wave', cap:'мы на рыбалке 🎣', title:'Дима · рыбалка'},
  // Елизавета Андреевна
  y_ph1:{char:'young', pose:'stand', cap:'обложка «Чистовика» 📗', title:'Е.А. · альманах'},
  y_ph2:{char:'young', pose:'wink', cap:'со сцены видно всё. даже ваши лица 😄', title:'Е.А. · вечер'},
  y_ph3:{char:'young', pose:'wink', cap:'просто Лиза ☕', title:'Е.А. · кафе'},
  // Доп. фото новых сюжетов
  k_ph6:{char:'katya', pose:'stand', cap:'моя стена на выставке 🎨', title:'Катя · на выставке'},
  k_ph7:{char:'katya', pose:'peace', cap:'набросок с натуры: это ты)', title:'Катя · набросок героя'},
  s_ph5:{char:'sveta', pose:'peace', cap:'золото и мы 💪', title:'Света · победа'},
  a_ph6:{char:'anya', pose:'hug', cap:'качели — официально наши 🍂', title:'Аня · качели', couple:true},
  v_ph5:{char:'vika', pose:'guitar', cap:'дубль один и пожизненный 🎧', title:'Вика · студия'},
  m_ph2:{char:'mama', pose:'wave', cap:'блинный переполох 🥞', title:'Мама · блины'},
  // Фотосеты (магазин)
  k_sum:{char:'katya', pose:'wink', cap:'лето-лето 🌊', title:'Катя · пляж', pack:'summer'},
  s_sum:{char:'sveta', pose:'peace', cap:'воланы и волны 🏐', title:'Света · пляж', pack:'summer'},
  a_sum:{char:'anya', pose:'wink', cap:'закатное море 🌅', title:'Аня · пляж', pack:'summer'},
  v_sum:{char:'vika', pose:'guitar', cap:'акустика на песке 🎸', title:'Вика · пляж', pack:'summer'},
  k_night:{char:'katya', pose:'wave', cap:'ночные скетчи 🌃', title:'Катя · ночь', pack:'nightcity'},
  s_night:{char:'sveta', pose:'peace', cap:'после матча гуляли 🌃', title:'Света · ночь', pack:'nightcity'},
  a_night:{char:'anya', pose:'wink', cap:'город в фонарях ✨', title:'Аня · ночь', pack:'nightcity'},
  v_night:{char:'vika', pose:'peace', cap:'мы с Барсиком шалим 🌃', title:'Вика · ночь', pack:'nightcity'},
  k_win:{char:'katya', pose:'wink', cap:'горячий чай после горки ☕', title:'Катя · зима', pack:'winter'},
  s_win:{char:'sveta', pose:'peace', cap:'снежный чемпионат ❄', title:'Света · зима', pack:'winter'},
  a_win:{char:'anya', pose:'wink', cap:'первый снег ❄❤', title:'Аня · зима', pack:'winter'},
  v_win:{char:'vika', pose:'wave', cap:'Барсик против снеговика ⛄', title:'Вика · зима', pack:'winter'},
  // Премиум-серия «Спустя 10 лет»: героини взрослые (~27)
  k_reu:{char:'katya', pose:'peace', cap:'десять лет спустя — а я всё рисую 😊', title:'Катя · 10 лет: встреча', pack:'reu'},
  s_reu:{char:'sveta', pose:'wave', cap:'десять лет — а кубки всё тяжелее 🏆', title:'Света · 10 лет: встреча', pack:'reu'},
  a_reu:{char:'anya', pose:'wink', cap:'моя первая книга выходит в сентябре ✍️', title:'Аня · 10 лет: встреча', pack:'reu'},
  v_reu:{char:'vika', pose:'peace', cap:'наша группа наконец в туре 🎤', title:'Вика · 10 лет: встреча', pack:'reu'},
  k_bch:{char:'katya', pose:'wink', cap:'то же море. я — взрослая версия 😄', title:'Катя · 10 лет: пляж', pack:'bch'},
  s_bch:{char:'sveta', pose:'peace', cap:'теперь я тренер — значит, бегаю за тобой 😉', title:'Света · 10 лет: пляж', pack:'bch'},
  a_bch:{char:'anya', pose:'sit', cap:'собираю ракушки на стихи 🐚', title:'Аня · 10 лет: пляж', pack:'bch'},
  v_bch:{char:'vika', pose:'wave', cap:'вечером — аккустика на закате 🎸', title:'Вика · 10 лет: пляж', pack:'bch'},
  k_sau:{char:'katya', pose:'peace', cap:'после парной — в озеро! смелее?', title:'Катя · 10 лет: сауна', pack:'sau'},
  s_sau:{char:'sveta', pose:'wink', cap:'сорок минут парной — рекорд не побит 💨', title:'Света · 10 лет: сауна', pack:'sau'},
  a_sau:{char:'anya', pose:'sit', cap:'травяной чай после бани — святое 🫖', title:'Аня · 10 лет: сауна', pack:'sau'},
  v_sau:{char:'vika', pose:'peace', cap:'кто первый в сугроб после парной? 🪵', title:'Вика · 10 лет: сауна', pack:'sau'},
  k_htl:{char:'katya', pose:'wink', cap:'пена, полотенце и ни одной встречи ☁️', title:'Катя · 10 лет: отель', pack:'htl'},
  s_htl:{char:'sveta', pose:'peace', cap:'утро чемпионки начинается с кофе ☕', title:'Света · 10 лет: отель', pack:'htl'},
  a_htl:{char:'anya', pose:'wave', cap:'ванная — лучшее место для стихов 🕯️', title:'Аня · 10 лет: отель', pack:'htl'},
  v_htl:{char:'vika', pose:'wink', cap:'в душе пою лучше, чем в студии, честно 🎵', title:'Вика · 10 лет: отель', pack:'htl'},
  k_wnd:{char:'katya', pose:'wave', cap:'ветер снова украл мою шляпу 🌬️', title:'Катя · 10 лет: ветер', pack:'wnd'},
  s_wnd:{char:'sveta', pose:'peace', cap:'паруса и я — кто быстрее ⛵', title:'Света · 10 лет: ветер', pack:'wnd'},
  a_wnd:{char:'anya', pose:'wink', cap:'юбка против ветра. счёт 5:0 в его пользу 🍃', title:'Аня · 10 лет: ветер', pack:'wnd'},
  v_wnd:{char:'vika', pose:'wave', cap:'струны на ветру звучат иначе 🎶', title:'Вика · 10 лет: ветер', pack:'wnd'},
  k_dch:{char:'katya', pose:'sit', cap:'шезлонг, мольберт, лимонад — день удался 🍋', title:'Катя · 10 лет: уикенд', pack:'dch'},
  s_dch:{char:'sveta', pose:'wave', cap:'загород — лучший тренерский отпуск 🏡', title:'Света · 10 лет: уикенд', pack:'dch'},
  a_dch:{char:'anya', pose:'peace', cap:'в тени яблони пишу новую главу 🌿', title:'Аня · 10 лет: уикенд', pack:'dch'},
  v_dch:{char:'vika', pose:'wink', cap:'гитара работает и на даче 🔌', title:'Вика · 10 лет: уикенд', pack:'dch'},
  k_poo:{char:'katya', pose:'peace', cap:'наконец научилась плавать. смеёшься?) 🏊', title:'Катя · 10 лет: бассейн', pack:'poo'},
  s_poo:{char:'sveta', pose:'wave', cap:'шесть утра, восемь дорожек — как всегда 💪', title:'Света · 10 лет: бассейн', pack:'poo'},
  a_poo:{char:'anya', pose:'wink', cap:'под водой все стихи звучат лучше 🤿', title:'Аня · 10 лет: бассейн', pack:'poo'},
  v_poo:{char:'vika', pose:'peace', cap:'плейлист для заплывов прилагается 💦', title:'Вика · 10 лет: бассейн', pack:'poo'},
  k_crs:{char:'katya', pose:'wave', cap:'море с палубы — как с мольберта 🛳️', title:'Катя · 10 лет: круиз', pack:'crs'},
  s_crs:{char:'sveta', pose:'peace', cap:'капитан разрешил подержать штурвал 🧭', title:'Света · 10 лет: круиз', pack:'crs'},
  a_crs:{char:'anya', pose:'wink', cap:'закат в открытом море — это на всю жизнь 🌅', title:'Аня · 10 лет: круиз', pack:'crs'},
  v_crs:{char:'vika', pose:'peace', cap:'вечерний концерт на палубе 🎶', title:'Вика · 10 лет: круиз', pack:'crs'},
  k_bar:{char:'katya', pose:'wink', cap:'город внизу, а мы — наверху 🍸', title:'Катя · 10 лет: крыша', pack:'bar'},
  s_bar:{char:'sveta', pose:'peace', cap:'за десять лет — и конечно за нас 🌃', title:'Света · 10 лет: крыша', pack:'bar'},
  a_bar:{char:'anya', pose:'sit', cap:'тост без стихов не считается ✨', title:'Аня · 10 лет: крыша', pack:'bar'},
  v_bar:{char:'vika', pose:'wave', cap:'джаз на крыше — и это не репетиция 🎷', title:'Вика · 10 лет: крыша', pack:'bar'},
  k_pic:{char:'katya', pose:'sit', cap:'рисую закат быстрее, чем он гаснет 🧺', title:'Катя · 10 лет: пикник', pack:'pic'},
  s_pic:{char:'sveta', pose:'peace', cap:'бадминтон до последнего луча ☀️', title:'Света · 10 лет: пикник', pack:'pic'},
  a_pic:{char:'anya', pose:'wave', cap:'читаю вслух — слушай и не перебивай) 🌾', title:'Аня · 10 лет: пикник', pack:'pic'},
  v_pic:{char:'vika', pose:'wink', cap:'арбуз, струны и ни одной заботы 🍉', title:'Вика · 10 лет: пикник', pack:'pic'},
  // Взрослая серия «Елизавета Андреевна: приватные фотосеты» — все сцены для взрослой героини (~27 лет)
  // Пак «Лазурный берег» (lashore)
  y_be1:{char:'young', pose:'wave', cap:'шляпа, купальник и ни одного урока ☀', title:'Е.А. · лазурный берег', pack:'lashore'},
  y_be2:{char:'young', pose:'sit', cap:'закат у моря — лучший урок поэзии 🌅', title:'Е.А. · лазурный берег', pack:'lashore'},
  y_be3:{char:'young', pose:'wink', cap:'волны запутались в подоле 😉', title:'Е.А. · лазурный берег', pack:'lashore'},
  // Пак «Пена и шёлк» (labath)
  y_ba1:{char:'young', pose:'wink', cap:'пена, свечи и тишина 🕯', title:'Е.А. · пена и шёлк', pack:'labath'},
  y_ba2:{char:'young', pose:'stand', cap:'полотенце и утренний кофе ☕', title:'Е.А. · пена и шёлк', pack:'labath'},
  y_ba3:{char:'young', pose:'sit', cap:'книга в пене — я не утонула 📖', title:'Е.А. · пена и шёлк', pack:'labath'},
  // Пак «После душа» (ladew)
  y_sh1:{char:'young', pose:'wink', cap:'пар, полотенце и никаких пар 🚿', title:'Е.А. · после душа', pack:'ladew'},
  y_sh2:{char:'young', pose:'stand', cap:'мокрые волосы, шёлковый халат 💧', title:'Е.А. · после душа', pack:'ladew'},
  y_sh3:{char:'young', pose:'peace', cap:'полотенце держится честно 😄', title:'Е.А. · после душа', pack:'ladew'},
  // Пак «Ветер у моря» (lawind)
  y_wn1:{char:'young', pose:'wave', cap:'ветер поднял юбку — я поймала 🍃', title:'Е.А. · ветер у моря', pack:'lawind'},
  y_wn2:{char:'young', pose:'wink', cap:'шляпа летит — я — нет 🎩', title:'Е.А. · ветер у моря', pack:'lawind'},
  y_wn3:{char:'young', pose:'peace', cap:'сомнения улетели с шарфом 🌬', title:'Е.А. · ветер у моря', pack:'lawind'},
  // Пак «Утро в номере» (lahotel)
  y_ht1:{char:'young', pose:'stand', cap:'шёлк, кофе и большое окно ☀', title:'Е.А. · утро в номере', pack:'lahotel'},
  y_ht2:{char:'young', pose:'wink', cap:'халат соскальзывает, закат за стеклом 🥂', title:'Е.А. · утро в номере', pack:'lahotel'},
  y_ht3:{char:'young', pose:'sit', cap:'номер с видом на утро 🏨', title:'Е.А. · утро в номере', pack:'lahotel'},
  // Пак «Парная» (lasauna)
  y_sa1:{char:'young', pose:'peace', cap:'мята, пар и махровые облака 🌿', title:'Е.А. · парная', pack:'lasauna'},
  y_sa2:{char:'young', pose:'wink', cap:'полотенце от плеч до колен — регламент 😉', title:'Е.А. · парная', pack:'lasauna'},
  y_sa3:{char:'young', pose:'sit', cap:'пар был добр к нам 🌫', title:'Е.А. · парная', pack:'lasauna'},
  // Пак «Лазурь бассейна» (lapool)
  y_pl1:{char:'young', pose:'wave', cap:'дорожка свободна — плыву к тебе 🏊', title:'Е.А. · бассейн', pack:'lapool'},
  y_pl2:{char:'young', pose:'wink', cap:'влажный шёлк волос и солнечные блики ✨', title:'Е.А. · бассейн', pack:'lapool'},
  y_pl3:{char:'young', pose:'peace', cap:'брызги для тех, кто опоздал 💦', title:'Е.А. · бассейн', pack:'lapool'},
  // Пак «Палуба на закате» (ladeck)
  y_dk1:{char:'young', pose:'wave', cap:'платье развевается — ветер тоже читал стихи 🌊', title:'Е.А. · палуба', pack:'ladeck'},
  y_dk2:{char:'young', pose:'wink', cap:'закат по краю мира 🌅', title:'Е.А. · палуба', pack:'ladeck'},
  y_dk3:{char:'young', pose:'stand', cap:'платье и шампанское — минимум осадки 🥂', title:'Е.А. · палуба', pack:'ladeck'},
  // Пак «Неон над городом» (labar)
  y_rf1:{char:'young', pose:'wink', cap:'город в огнях, а мы выше 🌃', title:'Е.А. · неон над городом', pack:'labar'},
  y_rf2:{char:'young', pose:'stand', cap:'вечернее платье и первый коктейль 🍸', title:'Е.А. · неон над городом', pack:'labar'},
  y_rf3:{char:'young', pose:'sit', cap:'неона нет — только неон и музыка 🎷', title:'Е.А. · неон над городом', pack:'labar'},
  // Пак «Шёлк и подсвечник» (lanight)
  y_br1:{char:'young', pose:'sit', cap:'свечи, шёлк и тихая страница 🕯', title:'Е.А. · шёлк и свечи', pack:'lanight'},
  y_br2:{char:'young', pose:'wink', cap:'ночное окно лучше любого романа 🌉', title:'Е.А. · шёлк и свечи', pack:'lanight'},
  y_br3:{char:'young', pose:'peace', cap:'шёлк, луна и чашка чая ☕', title:'Е.А. · шёлк и свечи', pack:'lanight'}
};

const Photo = {
  get(id){ return PHOTOS[id] || null; },

  // фото лежат рядом с игрой: photos/<id>.webp — свои картинки просто
  // кладутся в папку с этими именами. Нет файла — простая заглушка-карточка.
  src(id){ return 'photos/' + id + '.webp'; },
  avaSrc(id){ return 'photos/ava_' + id + '.webp'; },

  imgTag(id){
    const def = PHOTOS[id];
    if (!def) return '';
    return `<img class="ph-img" src="${this.src(id)}" data-ph="${id}" alt="${this.esc(def.title)}" onerror="Photo.fallback(this)">`;
  },

  esc(t){ const d = document.createElement('div'); d.textContent = t; return d.innerHTML; },

  // если своего файла нет — подставляем простую карточку-заглушку (без SVG)
  fallback(img){
    const id = img.dataset.ph;
    const def = PHOTOS[id] || {};
    const card = document.createElement('div');
    card.className = 'ph-ph';
    card.innerHTML = '<span class="ph-ph-ico">🖼️</span><span class="ph-ph-name">' + this.esc(def.title || id) + '</span>';
    img.replaceWith(card);
  },

  // аватарка-картинка поверх цветного круга; нет файла — остаётся эмодзи
  avaImg(id){
    return `<img class="ava-img" src="${this.avaSrc(id)}" alt="" onerror="this.remove()">`;
  },

  // маленькая превью-карточка-полароид
  polaroid(id, locked){
    const def = PHOTOS[id];
    if (!def) return '';
    const rot = ((id.length*7)%9-4)*0.8;
    return `<button class="pol-wrap" data-photo="${id}" data-char="${def.char||''}">
      <span class="polaroid ${locked?'locked':''}" style="--rot:${rot}deg">
        ${this.imgTag(id)}
        <span class="pol-cap">${def.cap}</span>
      </span>
      ${locked?'<span class="pol-lock">🔒<small>Магазин</small></span>':''}
    </button>`;
  }
};
