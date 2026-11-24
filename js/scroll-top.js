// 回最上面的小鈕
(function() {
  const btn = document.createElement('button');
  btn.className = 'scroll-top-btn';
  btn.setAttribute('aria-label', '回到最上面');
  btn.innerHTML = '↑';
  btn.onclick = () => window.scrollTo({ top: 0, behavior: 'smooth' });
  function attach() {
    document.body.appendChild(btn);
    function toggle() {
      btn.classList.toggle('show', window.scrollY > 300);
    }
    window.addEventListener('scroll', toggle, { passive: true });
    toggle();
  }
  if (document.body) attach();
  else document.addEventListener('DOMContentLoaded', attach);
})();
