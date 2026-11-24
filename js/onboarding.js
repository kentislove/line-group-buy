// 後台新手導引 + 複製下單網址（只在有開 FEATURES.onboarding 的頁面載入）
(function () {
  const F = (window.APP_CONFIG && window.APP_CONFIG.FEATURES) || {};
  if (!F.onboarding) return;

  const KEY = 'ob_' + (window.APP_CONFIG.API_URL || '').slice(-12);
  const store = {
    get(k) { try { return localStorage.getItem(KEY + k); } catch (e) { return null; } },
    set(k, v) { try { localStorage.setItem(KEY + k, v); } catch (e) {} }
  };

  // 後台頁 → 對應的下單頁
  function frontUrl() {
    const path = location.pathname;
    const page = /shop-admin\.html$/.test(path) ? 'shop.html'
               : /dev-admin\.html$/.test(path) ? 'dev.html' : 'index.html';
    const u = new URL(page, location.href);
    if (typeof SHOP_ID !== 'undefined' && SHOP_ID) u.searchParams.set('shop', SHOP_ID);
    return u.href;
  }
  function quickstartUrl() {
    const q = new URLSearchParams({ from: location.pathname.split('/').pop() || 'admin.html' });
    if (typeof SHOP_ID !== 'undefined' && SHOP_ID) q.set('shop', SHOP_ID);
    return 'quickstart.html?' + q.toString();
  }

  async function copyText(text) {
    try { await navigator.clipboard.writeText(text); return true; }
    catch (e) {
      const t = document.createElement('textarea');
      t.value = text; document.body.appendChild(t); t.select();
      const ok = document.execCommand('copy'); t.remove(); return ok;
    }
  }

  async function copyFrontLink(btn) {
    await copyText(frontUrl());
    store.set('copied', '1');
    if (btn) {
      const old = btn.textContent;
      btn.textContent = '✅ 已複製，去 LINE 貼上';
      setTimeout(() => { btn.textContent = old; }, 2200);
    }
    refreshWizard();
  }

  // 和 Code.gs currentWeekId 同一套算法：下一個週一
  function nextWeekId() {
    const d = new Date();
    const add = ((8 - d.getDay()) % 7) || 7;
    d.setDate(d.getDate() + add);
    const p = n => String(n).padStart(2, '0');
    return 'W' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate());
  }

  function progress() {
    const c = window.cache || (typeof cache !== 'undefined' ? cache : {});
    const wk = nextWeekId();
    const hasShop = (c.vendors || []).length > 0 || (c.stalls || []).length > 0;
    const scheduled = (c.weekVendors || []).some(r => r.week_id === wk) ||
                      (c.weekStalls || []).some(r => r.week_id === wk);
    const copied = store.get('copied') === '1';
    return { wk, hasShop, scheduled, copied };
  }

  function stepRow(no, done, title, desc, btnLabel, action) {
    return `
      <div class="ob-step ${done ? 'is-done' : ''}">
        <div class="ob-no">${done ? '✓' : no}</div>
        <div class="ob-body">
          <div class="ob-title">${title}</div>
          <div class="ob-desc">${desc}</div>
          <button class="btn ${done ? 'btn-ghost' : ''} ob-go" data-act="${action}">${done ? '再做一次' : btnLabel}</button>
        </div>
      </div>`;
  }

  function wizardHtml() {
    const p = progress();
    const allDone = p.hasShop && p.scheduled && p.copied;
    return `
      <div class="modal-content ob-box">
        <h3>${allDone ? '🎉 全部完成，可以開團了' : '🧭 3 步驟開團'}</h3>
        <div class="ob-lead">${allDone
          ? '之後每週只要做第 2、3 步。客人下單會出現在「🧾 訂單」。'
          : '照順序按下面的綠色按鈕，做完會自動打勾。'}</div>
        ${stepRow(1, p.hasShop, '把店和商品建好',
          '從範本選一個最像的，系統會先幫您建好 7 樣商品，再改名字和價格。',
          '開始建店', 'shop')}
        ${stepRow(2, p.scheduled, '勾選這週要賣的店',
          '沒打勾的店，客人看不到。',
          '去勾選', 'week')}
        ${stepRow(3, p.copied, '把下單網址丟到 LINE 群組',
          '按下去會複製網址，到 LINE 群組貼上送出就好。',
          '🔗 複製下單網址', 'copy')}
        <div class="ob-foot">
          <a href="${quickstartUrl()}" target="_blank">📄 看圖文版／印出來</a>
          <div class="ob-foot-btns">
            <button class="btn btn-ghost" data-act="later">下次再說</button>
            <button class="btn btn-ghost" data-act="never">我會了，不用再跳</button>
          </div>
        </div>
      </div>`;
  }

  let overlay = null;
  function openWizard() {
    if (!overlay) {
      overlay = document.createElement('div');
      overlay.className = 'modal show ob-overlay';
      overlay.addEventListener('click', onClick);
      document.body.appendChild(overlay);
    }
    overlay.classList.remove('no-anim');
    overlay.innerHTML = wizardHtml();
    overlay.style.display = 'flex';
  }
  function closeWizard() { if (overlay) overlay.style.display = 'none'; }
  function refreshWizard() {
    if (overlay && overlay.style.display !== 'none') {
      overlay.classList.add('no-anim'); // 更新打勾時不要重跑淡入動畫
      overlay.innerHTML = wizardHtml();
    }
  }

  function goTab(name) {
    const tab = document.querySelector('.tab[data-tab="' + name + '"]');
    if (tab) tab.click();
  }

  async function onClick(e) {
    if (e.target === overlay) return closeWizard();
    const act = e.target.closest('[data-act]')?.dataset.act;
    if (!act) return;
    if (act === 'shop') {
      closeWizard();
      goTab('vendors');
      if (F.templates && window.openTemplatePicker) window.openTemplatePicker();
      else if (window.openQuickForm) window.openQuickForm('Vendors');
    } else if (act === 'week') {
      closeWizard();
      goTab('weeks');
      const wk = progress().wk;
      const c = typeof cache !== 'undefined' ? cache : {};
      if ((c.weeks || []).some(w => w.week_id === wk) && window.toggleWeek) window.toggleWeek(wk);
    } else if (act === 'copy') {
      await copyFrontLink(e.target);
    } else if (act === 'later') {
      closeWizard();
    } else if (act === 'never') {
      store.set('never', '1');
      closeWizard();
    }
  }

  document.addEventListener('admin:ready', () => {
    const copyBtn = document.getElementById('copyLinkBtn');
    const guideBtn = document.getElementById('guideBtn');
    if (copyBtn) { copyBtn.style.display = ''; copyBtn.onclick = () => copyFrontLink(copyBtn); }
    if (guideBtn) { guideBtn.style.display = ''; guideBtn.onclick = openWizard; }
    const p = progress();
    const allDone = p.hasShop && p.scheduled && p.copied;
    if (store.get('never') !== '1' && !allDone) openWizard();
  });

  // 範本套用、排班儲存後畫面會重新整理，導引開著就跟著更新打勾
  const obs = new MutationObserver(() => refreshWizard());
  document.addEventListener('DOMContentLoaded', () => {
    const tc = document.getElementById('tabContent');
    if (tc) obs.observe(tc, { childList: true });
  });
})();
