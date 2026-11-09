// Платные «плюшки» доната DonatePay: картинка/гифка на весь экран перед алертом и эффект поверх алерта
// (сердечки, звёзды, конфетти, пузыри, Kappa, 4Head) — как в их виджете.
(function (D) {
  'use strict';

  const PREVIEW_MS = 5000;
  const FADE_MS = 500;
  const COLORS = ['#ED5565', '#DA4453', '#FC6E51', '#E9573F', '#FFCE54', '#F6BB42', '#A0D468', '#8CC152', '#48CFAD',
    '#37BC9B', '#4FC1E9', '#3BAFDA', '#5D9CEC', '#4A89DC', '#AC92EC', '#967ADC', '#EC87C0', '#D770AD'];
  const SHAPES = {
    heart: '<path d="M250 460C95 340 10 260 10 150 10 70 70 15 145 15c50 0 85 25 105 60 20-35 55-60 105-60 75 0 135 55 135 135 0 110-85 190-240 310z"/>',
    star: '<polygon points="250,10 316,170 490,180 356,292 400,470 250,374 100,470 144,292 10,180 184,170"/>',
    confetti: '<rect y="140" width="500" height="220"/>',
    bubble: '<circle cx="250" cy="250" r="250"/>',
  };
  const IMG = 'https://widget.donatepay.ru/assets/img/premium/effects';
  // Откуда летят частицы — диапазоны top/left в % рамки алерта.
  const FROM = {
    up: { top: [10, 90], left: [10, 90] },
    jump: { top: [40, 80], left: [10, 90] },
    down: { top: [0, 10], left: [10, 90] },
    bubbles: { top: [80, 100], left: [10, 90] },
    right: { top: [60, 90], left: [0, 30] },
  };
  const EFFECTS = {
    HeartUp: { animation: 'up', shape: 'heart', colors: [0, 1, 16, 17, 17] },
    ConfettiJump: { animation: 'jump', shape: 'confetti', colors: [1, 3, 5, 7, 9] },
    StarsDown: { animation: 'down', shape: 'star', colors: [2, 3, 4, 5, 5] },
    BubbleBubbles: { animation: 'bubbles', shape: 'bubble', colors: [10, 11, 12, 13, 13] },
    StarsRight: { animation: 'right', shape: 'star', colors: [1, 3, 5, 7, 9] },
    KappaUp: { animation: 'up', img: `${IMG}/Kappa.png` },
    '4headUp': { animation: 'up', img: `${IMG}/4Head.png` },
  };

  const between = (a, b) => a + Math.random() * (b - a);
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const isVideo = (src) => /\.(mp4|webm)(\?|$)/i.test(src);

  function shapeUrl(shape, color) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 500 500" fill="${color}">${SHAPES[shape]}</svg>`;
    return `url("data:image/svg+xml;base64,${btoa(svg)}")`;
  }

  /** Эффект поверх рамки алерта; возвращает функцию, которая его убирает. */
  function effect(box, name) {
    const fx = EFFECTS[name];
    if (!fx) return () => {};
    const layer = document.createElement('div');
    layer.className = 'premium-fx';
    layer.dataset.animation = fx.animation;
    // Размер и число частиц — от ширины рамки, как у DonatePay.
    let size = box.clientWidth / 16;
    let count = 10;
    if (size < 12) { count *= size / 12; size = 12; }
    if (size > 30) { count *= size / 30; size = 30; }
    const from = FROM[fx.animation];
    for (let i = 0; i < count; i += 1) {
      const lane = document.createElement('div');
      const bit = document.createElement('div');
      const delay = `${between(0, 6000)}ms`;
      const duration = `${4200 * between(0.8, 1.2)}ms`;
      const d = size * between(0.8, 1.1) + 4;
      lane.style.animationDelay = delay;
      lane.style.animationDuration = duration;
      Object.assign(bit.style, {
        width: `${d}px`, height: `${d}px`,
        top: `${between(from.top[0], from.top[1])}%`, left: `${between(from.left[0], from.left[1])}%`,
        animationDelay: delay, animationDuration: duration,
        backgroundImage: fx.img ? `url("${fx.img}")` : shapeUrl(fx.shape, COLORS[fx.colors[i % fx.colors.length]]),
      });
      lane.appendChild(bit);
      layer.appendChild(lane);
    }
    box.appendChild(layer);
    return () => layer.remove();
  }

  /** Картинка/гифка донатера на весь экран на 5 секунд. alive() — алерт ещё не пропустили. */
  async function preview(src, alive) {
    const node = document.createElement('div');
    node.className = 'premium-preview';
    if (isVideo(src)) {
      const v = document.createElement('video');
      Object.assign(v, { src, loop: true, muted: true, autoplay: true, playsInline: true });
      node.appendChild(v);
    } else {
      node.style.backgroundImage = `url("${src.replace(/"/g, '%22')}")`;
    }
    document.body.appendChild(node);
    requestAnimationFrame(() => node.classList.add('is-shown'));
    const until = Date.now() + PREVIEW_MS;
    while (Date.now() < until && alive()) await wait(100);
    node.classList.remove('is-shown');
    await wait(FADE_MS);
    node.remove();
  }

  D.premium = { effect, preview, isVideo, EFFECTS };
})(window.Dvor = window.Dvor || {});
