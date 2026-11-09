// Подключение к боту и демо-режим (index.html#demo — для проверки в браузере).
(function (D) {
  'use strict';

  const scene = D.scene;
  const stage = document.getElementById('stage');

  // В OBS источник 2560×1440; в обычном браузере подгоняем под окно.
  function fit() {
    const k = Math.min(window.innerWidth / 2560, window.innerHeight / 1440);
    stage.style.transform = k < 0.999 || k > 1.001 ? `scale(${k})` : '';
  }
  window.addEventListener('resize', fit);
  fit();

  function handle(data) {
    switch (data.type) {
      case 'presence': scene.onPresence(data.viewers || []); break;
      case 'chat': if (data.platform === 'twitch' || !data.platform) scene.onChat(data); break;
      case 'scene:action': scene.onAction(data); break;
      case 'raid': scene.onRaid(data); break;
      case 'emotes': scene.setEmotes(data.emotes); break;
      case 'chat:clear-user': scene.removeMessagesOf(data.login); break;
      case 'stream:summary': scene.setSummary(data.summary); break;
      default: break;
    }
  }

  // Итоги эфира для титров: при подключении, раз в минуту и при показе сцены.
  let bot = null;
  function requestSummary() {
    if (D.config.mode === 'end' && bot) bot.send({ type: 'stream:summary' });
  }
  setInterval(requestSummary, 60000);

  function connect() {
    bot = D.connectBot({ onOpen: requestSummary, onMessage: handle });
  }

  function demo() {
    const names = ['Krolik_Bandit', 'DedInside', 'lenochka', 'kotletka228', 'Sasha_Pro', 'mira_moon', 'TurboDed', 'xX_Nagib_Xx',
      'Gena_Bukin', 'pelmen', 'Valera_Sila', 'nastya_mur', 'Shrek_Na_Raione', 'vovan'];
    // в демо часть костюмов закреплена, чтобы все сценарии могли сработать
    const fixed = { Valera_Sila: 'dovah', vovan: 'terror', pelmen: 'ct', Gena_Bukin: 'freeman', Shrek_Na_Raione: 'gopnik' };
    const viewers = names.map((name) => ({ login: name.toLowerCase(), name, outfit: fixed[name] }));
    handle({ type: 'presence', viewers: viewers.slice(0, 11) });
    setTimeout(() => handle({ type: 'presence', viewers }), 6000);
    if (D.config.mode === 'end') {
      handle({ type: 'stream:summary', summary: {
        totals: { chatters: 37, messages: 1243 },
        topChatters: [['DedInside', 212], ['lenochka', 160], ['kotletka228', 98], ['Gena_Bukin', 75], ['mira_moon', 41]].map(([name, messages]) => ({ login: name.toLowerCase(), name, messages })),
        followers: [{ name: 'pelmen' }, { name: 'nastya_mur' }], subscribers: [{ name: 'vovan' }], donors: [{ name: 'Valera_Sila' }],
      } });
    }
    const lines = D.config.mode === 'end'
      ? ['Спасибо за стрим!', 'всем спокойной ночи', 'было топ', 'завтра во сколько?', 'я последний ухожу', 'пока-пока', 'бабка тоже ушла?', 'ну всё, спать']
      : ['Привет всем', 'О, стрим скоро', 'кто во что сегодня играет?', 'это я в оранжевом костюме', 'ахаха гопник сел на корточки',
      'го драться у гаражей', 'бабка опять на лавке', 'Kappa', 'у меня тоже снег пошёл', 'сколько ждать ещё?'];
    let i = 0;
    if (!location.hash.includes('quiet')) setInterval(() => {
      const v = viewers[i % viewers.length];
      handle({ type: 'chat', login: v.login, nickname: v.name, message: lines[i % lines.length] });
      i += 1;
    }, 3200);
    if (!/events=/.test(location.hash)) {
      setTimeout(() => handle({ type: 'scene:action', action: 'hug', actor: viewers[1], target: viewers[2] }), 4000);
      setTimeout(() => handle({ type: 'scene:action', action: 'kill', actor: viewers[3], target: viewers[4] }), 9000);
    }
  }

  // OBS сообщает, когда источник выходит в эфир.
  window.addEventListener('obsSourceActiveChanged', (event) => {
    if (event.detail && event.detail.active) { scene.restart(); requestSummary(); }
  });

  scene.start();
  const events = /events=([\w,]+)/.exec(location.hash);
  if (events) scene.force(events[1].split(','));
  if (location.hash.includes('demo')) demo();
  else connect();
})(window.Dvor = window.Dvor || {});
