// Тема: «Авто» (как в системе) → «Светлая» → «Тёмная». Выбор хранится локально.
(() => {
  const K = 'pvzTheme', mq = matchMedia('(prefers-color-scheme: light)');
  const ICON = {
    auto: '<circle cx="12" cy="12" r="8"/><path d="M12 4a8 8 0 0 1 0 16z" fill="currentColor"/>',
    light: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    dark: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>'
  };
  const NAME = { auto: 'Авто', light: 'Светлая', dark: 'Тёмная' };
  let mode; try { mode = localStorage.getItem(K) || 'auto'; } catch (e) { mode = 'auto'; }
  function apply() {
    const t = mode === 'auto' ? (mq.matches ? 'light' : 'dark') : mode;
    const was = document.documentElement.dataset.theme;
    document.documentElement.dataset.theme = t;
    document.querySelectorAll('[data-theme-btn]').forEach(b => { b.querySelector('svg').innerHTML = ICON[mode]; b.querySelector('span').textContent = NAME[mode]; b.title = 'Тема: ' + NAME[mode] + ' (нажмите, чтобы сменить)'; });
    if (was && was !== t) window.dispatchEvent(new Event('pvz-theme'));
  }
  apply();
  mq.addEventListener('change', () => mode === 'auto' && apply());
  document.addEventListener('DOMContentLoaded', () => {
    apply();
    document.querySelectorAll('[data-theme-btn]').forEach(b => (b.onclick = () => {
      mode = { auto: 'light', light: 'dark', dark: 'auto' }[mode];
      try { localStorage.setItem(K, mode); } catch (e) {}
      apply();
    }));
  });
})();
