// Read before styles paint so navigation never flashes the opposite theme.
(() => {
  const key = 'squishy-studio-theme';
  try {
    const saved = localStorage.getItem(key);
    if (saved === 'day' || saved === 'night') document.documentElement.dataset.theme = saved;
  } catch { /* A disabled store must not prevent browsing. */ }
  const night = document.documentElement.dataset.theme === 'night';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', night ? '#241849' : '#f9f3f4');
  document.addEventListener('DOMContentLoaded', () => {
    const toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;
    toggle.setAttribute('aria-pressed', String(night));
    toggle.setAttribute('aria-label', night ? '切换到白天' : '切换到夜晚');
    toggle.querySelector('.theme-toggle__label').textContent = night ? '夜晚' : '白天';
    toggle.addEventListener('click', () => {
      try { localStorage.setItem(key, document.documentElement.dataset.theme); } catch { /* Keep the current page usable. */ }
    });
  });
})();
