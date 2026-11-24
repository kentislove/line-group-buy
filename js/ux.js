// 大字大按鈕模式（只在有開 FEATURES.bigText 的頁面載入）
(function () {
  const F = (window.APP_CONFIG && window.APP_CONFIG.FEATURES) || {};
  if (!F.bigText) return;

  const KEY = 'bigText';
  let saved = null;
  try { saved = localStorage.getItem(KEY); } catch (e) {}
  let on = saved === null ? true : saved === '1';

  function apply() {
    document.documentElement.classList.toggle('big-ui', on);
    if (btn) btn.textContent = on ? 'Aa 一般字' : 'Aa 大字';
  }

  const btn = document.createElement('button');
  btn.className = 'big-ui-toggle';
  btn.type = 'button';
  btn.setAttribute('aria-label', '切換字體大小');
  btn.onclick = () => {
    on = !on;
    try { localStorage.setItem(KEY, on ? '1' : '0'); } catch (e) {}
    apply();
  };

  apply();
  if (document.body) document.body.appendChild(btn);
  else document.addEventListener('DOMContentLoaded', () => document.body.appendChild(btn));
})();
