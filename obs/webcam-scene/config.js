// Настройки двора под большой вебкой. После правки обнови источник «Вебка · двор» в OBS.
window.SCENE_CONFIG = {
  mode: 'webcam',
  // Бот: сначала прод, если он не отвечает — локальный контейнер.
  websocket: ['wss://nglzzz.xyz/ws', 'ws://localhost:86'],
  channel: 'nglzzz',

  // Сообщения чата и так видны справа — над головами их не дублируем. true — включить.
  bubbles: false,

  // Сценарии, которым тут нет места (нет дороги и гаражей).
  disableEvents: ['car', 'bomb'],

  maxPeople: 18,
  snow: false,
};
