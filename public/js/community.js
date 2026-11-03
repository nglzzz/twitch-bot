'use strict';

document.addEventListener('error', (event) => {
  const image = event.target;
  if (!(image instanceof HTMLImageElement) || !image.hasAttribute('data-community-avatar')) return;
  image.remove();
}, true);

document.querySelectorAll('img[data-community-avatar]').forEach((image) => {
  if (image.complete && image.naturalWidth === 0) image.remove();
});
