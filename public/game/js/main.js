/* ============ Точка входа ============ */
'use strict';

(async function main(){
  await YSDK.init();
  await Game.load();
  UI.init();
  Game.begin();

  // доставка сообщений (печатает… → пришло)
  setInterval(() => Game.tickDelivery(), 600);
  // планировщик событий (дуги + случайные)
  setInterval(() => { if (!UI.adPlaying) Game.triggerEvents(false); }, 6000);
  // часы
  setInterval(() => UI.onTick(), 1000);

  // сохранение при уходе
  document.addEventListener('visibilitychange', () => { if (document.hidden) Game.save(); });
  window.addEventListener('beforeunload', () => Game.save());

  YSDK.gameplayStart();
  console.info('[Game] Мой класс запущен. Персонажей:', Object.keys(GD.chars).length);
  // отладочный хук для локального тестирования (в игре не используется)
  window.__dbg = { Game, GD, UI, YSDK };
})();
