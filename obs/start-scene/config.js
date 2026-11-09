// Настройки стартовой сцены. Файл можно править руками — после сохранения обнови источник в OBS.
window.SCENE_CONFIG = {
  // Websocket бота (docker: порт DOCKER_WEBSOCKET_PORT из .env).
  // Бот: сначала прод, если он не отвечает — локальный контейнер.
  websocket: ['wss://nglzzz.xyz/ws', 'ws://localhost:86'],

  // Ник канала: стример получает свой костюм и подпись.
  channel: 'nglzzz',

  // Отсчёт на табло, минут от момента, когда сцена появилась в эфире. 0 — без отсчёта.
  countdownMinutes: 5,

  // Что показывает табло на крыше. {timer} заменяется на оставшееся время.
  board: [
    { text: 'СКОРО НАЧНЁМ', hold: 7 },
    { text: 'ДО СТАРТА {timer}', hold: 7, onlyWithTimer: true },
    { text: 'TG: T.ME/NGLZZZTV  *  BOOSTY.TO/NGLZZZ  *  !SR ЗАКАЗАТЬ ТРЕК', scroll: true },
  ],
  boardAfterTimer: 'УЖЕ НАЧИНАЕМ',

  // Сколько зрителей одновременно гуляет во дворе.
  maxPeople: 26,

  // Падающий снег.
  snow: true,
};
