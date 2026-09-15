(() => {
  'use strict';

  const STORAGE_KEY = 'modpanelTheme';
  const DEFAULT_THEME = 'current';
  const THEMES = new Set(['current', 'blood', 'matrix', 'hud', 'opsdeck', 'signalhud', 'onair']);
  const THEME_COLORS = { current: '#071117', blood: '#0b0d10', matrix: '#030a05', hud: '#05131a', opsdeck: '#0a141a', signalhud: '#0f0c1c', onair: '#171008' };
  const root = document.documentElement;

  function savedTheme() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      return THEMES.has(saved) ? saved : DEFAULT_THEME;
    } catch {
      return DEFAULT_THEME;
    }
  }

  function applyTheme(theme, { persist = false, announce = false } = {}) {
    const next = THEMES.has(theme) ? theme : DEFAULT_THEME;
    root.dataset.themeSwitching = '';
    root.dataset.theme = next;
    document.querySelector('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[next]);

    const select = document.getElementById('themeSelect');
    if (select) select.value = next;
    if (persist) {
      try { localStorage.setItem(STORAGE_KEY, next); } catch { /* storage can be unavailable */ }
    }
    if (announce) {
      const label = select?.selectedOptions[0]?.textContent || 'الهوية المختارة';
      window.ModPanelUI?.announce?.(`تم تطبيق ${label}`);
    }
    requestAnimationFrame(() => requestAnimationFrame(() => delete root.dataset.themeSwitching));
  }

  applyTheme(savedTheme());
  document.addEventListener('DOMContentLoaded', () => {
    const select = document.getElementById('themeSelect');
    if (!select) return;
    select.value = root.dataset.theme || DEFAULT_THEME;
    select.addEventListener('change', () => {
      // لون مميز مخصّص (accentPicker) بيتكتب inline على الجذر وبيغلب أي هوية جديدة —
      // لازم نمسحه لما المستخدم يختار هوية تانية يدويًا، وإلا الهوية الجديدة هتفضل نص متطبّقة.
      root.style.removeProperty('--accent');
      try { localStorage.removeItem('accentColor'); } catch { /* storage قد يكون غير متاح */ }
      applyTheme(select.value, { persist: true, announce: true });
      requestAnimationFrame(() => {
        const picker = document.getElementById('accentPicker');
        if (picker) picker.value = getComputedStyle(root).getPropertyValue('--accent').trim() || picker.value;
      });
    });
  });
})();
