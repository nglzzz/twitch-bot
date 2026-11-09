// Настройки сцены окончания стрима. После правки обнови источник в OBS.
window.SCENE_CONFIG = {
  mode: 'end',

  // Websocket бота (docker: порт DOCKER_WEBSOCKET_PORT из .env).
  // Бот: сначала прод, если он не отвечает — локальный контейнер.
  websocket: ['wss://nglzzz.xyz/ws', 'ws://localhost:86'],
  channel: 'nglzzz',

  // За сколько минут двор пустеет: все прощаются и расходятся, окна гаснут.
  closeMinutes: 5,

  // Табло на крыше. credits — титры из итогов эфира (топ чата, новые фолловеры, сабы, донатеры).
  board: [
    { text: 'СПАСИБО ЗА СТРИМ', hold: 7 },
    { credits: true, speed: 30 },
    { text: 'ДО ВСТРЕЧИ', hold: 6 },
    // Анонс следующего стрима — допиши текст или удали строку.
    { text: 'СЛЕДУЮЩИЙ СТРИМ: СКОРО В TG T.ME/NGLZZZTV', speed: 26 },
  ],
  countdownMinutes: 0,

  maxPeople: 26,
  snow: true,
};
