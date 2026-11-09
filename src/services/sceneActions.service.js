/**
 * Действия чат-команд (!обнять, !шлёп, …) для сцены OBS: кто, что и с кем сделал.
 * Websocket подключается лениво, чтобы команды можно было тестировать без сервера.
 */
const ACTIONS = new Set(['hug', 'slap', 'kill', 'bite', 'spit', 'kiss']);

function cleanName(value) {
  return String(value || '').trim().replace(/^@/, '').split(/\s+/)[0].slice(0, 60);
}

function publishSceneAction(action, actor, target) {
  if (!ACTIONS.has(action)) return;
  const actorName = cleanName(actor);
  const targetName = cleanName(target);
  if (!actorName) return;
  try {
    require('../app/websocket').broadcast({
      type: 'scene:action',
      action,
      actor: { login: actorName.toLowerCase(), name: actorName },
      target: targetName ? { login: targetName.toLowerCase(), name: targetName } : null,
    });
  } catch (error) {
    console.warn('[Scene] Could not publish action:', error.message);
  }
}

module.exports = { publishSceneAction, ACTIONS };
