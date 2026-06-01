document.addEventListener('DOMContentLoaded', () => {
  document.querySelectorAll('[data-refresh-page]').forEach((button) => {
    button.addEventListener('click', () => {
      window.location.reload();
    });
  });
});

