document.addEventListener('DOMContentLoaded', () => {
  // ── Refresh page buttons ──
  document.querySelectorAll('[data-refresh-page]').forEach((button) => {
    button.addEventListener('click', () => {
      window.location.reload();
    });
  });

  // ── Mobile navigation toggle ──
  const navToggle = document.querySelector('[data-nav-toggle]');
  const nav = document.querySelector('[data-nav]');

  if (navToggle && nav) {
    navToggle.addEventListener('click', () => {
      const isOpen = nav.classList.toggle('is-open');
      navToggle.classList.toggle('is-open', isOpen);
      navToggle.setAttribute('aria-expanded', String(isOpen));
    });

    // Close on nav link click
    nav.querySelectorAll('a').forEach((link) => {
      link.addEventListener('click', () => {
        nav.classList.remove('is-open');
        navToggle.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
      });
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (!nav.contains(e.target) && !navToggle.contains(e.target)) {
        nav.classList.remove('is-open');
        navToggle.classList.remove('is-open');
        navToggle.setAttribute('aria-expanded', 'false');
      }
    });
  }

  // ── Header scroll effect ──
  const header = document.querySelector('[data-header]');
  if (header) {
    let ticking = false;
    const updateHeader = () => {
      header.classList.toggle('scrolled', window.scrollY > 10);
      ticking = false;
    };
    window.addEventListener('scroll', () => {
      if (!ticking) {
        requestAnimationFrame(updateHeader);
        ticking = true;
      }
    }, { passive: true });
  }
});
