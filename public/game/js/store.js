/* ============ Каталог магазина ============ */
'use strict';

const STORE = {
  themes: [
    { id:'classic',  name:'Классика',    price:0,   prev:'linear-gradient(135deg,#eef1f6,#4f7cff)', desc:'Родная тема телефона' },
    { id:'ocean',    name:'Океан',       price:150, prev:'linear-gradient(135deg,#0f4c5c,#2ec4d6)', desc:'Глубина и спокойствие' },
    { id:'sunset',   name:'Закат',       price:200, prev:'linear-gradient(135deg,#ff7a55,#ffb35e)', desc:'Для романтиков в чате' },
    { id:'neon',     name:'Неон',        price:250, prev:'linear-gradient(135deg,#0d0f1a,#00e5a0)', desc:'Тёмная сторона ярких слов' },
    { id:'midnight', name:'Полночь',     price:300, prev:'linear-gradient(135deg,#0e1220,#d8a740)', desc:'Тихий люкс для ночных диалогов' },
    { id:'sakura',   name:'Сакура',      price:250, prev:'linear-gradient(135deg,#f2679d,#ffb7d5)', desc:'Катя одобрит. Наверное.' }
  ],
  cases: [
    { id:'carbon',  name:'Графит',   price:0,   prev:'linear-gradient(160deg,#3a4152,#12151d)', desc:'Стандартный корпус' },
    { id:'arctic',  name:'Арктика',  price:120, prev:'linear-gradient(160deg,#8fc6ff,#3a6ea8)', desc:'Прохладный и чистый' },
    { id:'rose',    name:'Роза',     price:120, prev:'linear-gradient(160deg,#ffb3c7,#e05e86)', desc:'Заметен из космоса' },
    { id:'gold',    name:'Золото',   price:300, prev:'linear-gradient(160deg,#ffe29a,#c9962e)', desc:'Блестит скромно. Совсем нет' },
    { id:'forest',  name:'Хвоя',     price:150, prev:'linear-gradient(160deg,#9fd8b4,#2f7d52)', desc:'Тихий, как вечер в парке' },
    { id:'lava',    name:'Лава',     price:300, prev:'linear-gradient(160deg,#ff8a5c,#8a1f3d)', desc:'Света оценит дерзость' }
  ],
  packs: [
    // Premium-серия «Спустя 10 лет»: героини взрослые, покупка только за монеты (vip:true)
    { id:'reu', name:'Выпускной: 10 лет 🥂', price:900,  vip:true, photos:['k_reu','s_reu','a_reu','v_reu'], desc:'Premium · встреча выпускников: вечерние платья и шампанское' },
    { id:'bch', name:'Пляж: 10 лет 🌊',      price:1000, vip:true, photos:['k_bch','s_bch','a_bch','v_bch'], desc:'Premium · взрослое лето: море, песок и купальники' },
    { id:'sau', name:'Сауна: 10 лет 🔥',     price:1200, vip:true, photos:['k_sau','s_sau','a_sau','v_sau'], desc:'Premium · пар, дерево и махровые полотенца' },
    { id:'htl', name:'Утро в отеле ☕',      price:1100, vip:true, photos:['k_htl','s_htl','a_htl','v_htl'], desc:'Premium · пена, полотенце и утренний кофе' },
    { id:'wnd', name:'Ветер у моря 🌬️',     price:1000, vip:true, photos:['k_wnd','s_wnd','a_wnd','v_wnd'], desc:'Premium · прибрежный ветер против лёгких платьев' },
    { id:'dch', name:'Загородный уикенд 🏡', price:900,  vip:true, photos:['k_dch','s_dch','a_dch','v_dch'], desc:'Premium · шезлонги, сарафаны и лимонад' },
    { id:'poo', name:'Бассейн 🏊',           price:1000, vip:true, photos:['k_poo','s_poo','a_poo','v_poo'], desc:'Premium · купальники и восемь дорожек' },
    { id:'crs', name:'Круиз 🛳️',            price:1100, vip:true, photos:['k_crs','s_crs','a_crs','v_crs'], desc:'Premium · палуба, закат и лёгкие платья' },
    { id:'bar', name:'Коктейли на крыше 🍸', price:1000, vip:true, photos:['k_bar','s_bar','a_bar','v_bar'], desc:'Premium · вечерние платья над городом в огнях' },
    { id:'pic', name:'Пикник на закате 🧺',  price:900,  vip:true, photos:['k_pic','s_pic','a_pic','v_pic'], desc:'Premium · сарафаны, плед и золотой час' },
    // Взрослая серия «Елизавета Андреевна: приватные фотосеты» — учительница взрослая (~27 лет), фотосеты только за монеты (vip:true)
    { id:'lashore', name:'Е.А. · Лазурный берег 🏖️',   price:1500, vip:true, photos:['y_be1','y_be2','y_be3'], desc:'Premium · южное море, купальник и шляпа' },
    { id:'labath',  name:'Е.А. · Пена и шёлк 🕯️',      price:1700, vip:true, photos:['y_ba1','y_ba2','y_ba3'], desc:'Premium · пена, свечи и махровый халат' },
    { id:'ladew',   name:'Е.А. · После душа 🚿',        price:1700, vip:true, photos:['y_sh1','y_sh2','y_sh3'], desc:'Premium · пар, полотенце и зеркало' },
    { id:'lawind',  name:'Е.А. · Ветер у моря 🍃',      price:1800, vip:true, photos:['y_wn1','y_wn2','y_wn3'], desc:'Premium · ветер играет с лёгким подолом' },
    { id:'lahotel', name:'Е.А. · Утро в номере ☀️',     price:2000, vip:true, photos:['y_ht1','y_ht2','y_ht3'], desc:'Premium · шёлк, кофе и большое окно' },
    { id:'lasauna', name:'Е.А. · Парная 🌿',            price:2100, vip:true, photos:['y_sa1','y_sa2','y_sa3'], desc:'Premium · мята, пар и махровые облака' },
    { id:'lapool',  name:'Е.А. · Лазурь бассейна 🏊‍♀️', price:2200, vip:true, photos:['y_pl1','y_pl2','y_pl3'], desc:'Premium · купальник и солнечные блики' },
    { id:'ladeck',  name:'Е.А. · Палуба на закате 🌅',  price:2300, vip:true, photos:['y_dk1','y_dk2','y_dk3'], desc:'Premium · вечернее платье и ветер у борта' },
    { id:'labar',   name:'Е.А. · Неон над городом 🌃',  price:2450, vip:true, photos:['y_rf1','y_rf2','y_rf3'], desc:'Premium · вечернее платье и первый коктейль' },
    { id:'lanight', name:'Е.А. · Шёлк и подсвечник 🕯️', price:2600, vip:true, photos:['y_br1','y_br2','y_br3'], desc:'Premium · свечи, шёлк и лунный свет' },
    { id:'summer',    name:'Летний сезон 🌊',  price:250, photos:['k_sum','s_sum','a_sum','v_sum'],  desc:'4 пляжных фото из чатов' },
    { id:'nightcity', name:'Ночной город 🌃',  price:300, photos:['k_night','s_night','a_night','v_night'], desc:'4 фото вечерних прогулок' },
    { id:'winter',    name:'Зимние каникулы ❄', price:250, photos:['k_win','s_win','a_win','v_win'],  desc:'4 зимних фото для галереи' }
  ],
  FREE_COINS_REWARD: 50
};

const Store = {
  get(tab){ return STORE[tab] || []; },
  byId(type, id){ return (STORE[type]||[]).find(i=>i.id===id) || null; },

  owned(state, type, item){
    if (item.price === 0) return true;
    return !!state.purchased[type + ':' + item.id];
  },

  buyWithCoins(state, type, item){
    if (this.owned(state, type, item)) return { ok:false, msg:'Уже приобретено' };
    if (state.coins < item.price) return { ok:false, msg:'Не хватает монет' };
    state.coins -= item.price;
    state.purchased[type + ':' + item.id] = 'coins';
    return { ok:true };
  },

  buyWithAd(state, type, item){
    if (this.owned(state, type, item)) return { ok:false, msg:'Уже приобретено' };
    if (item.vip) return { ok:false, msg:'Premium-сеты — только за монеты' };
    state.purchased[type + ':' + item.id] = 'ad';
    return { ok:true };
  }
};
