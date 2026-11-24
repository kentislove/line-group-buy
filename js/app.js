// 前台邏輯
const state = {
  weekId: null,
  locked: true,
  vendors: [],
  stalls: [],
  items: [],
  cart: {} // { itemId: qty }
};

document.title = window.APP_CONFIG.SITE_TITLE;
document.getElementById('siteTitle').textContent = window.APP_CONFIG.SITE_TITLE;

init();

async function init() {
  try {
    const data = await API.call('getPublic');
    Object.assign(state, data);
    render();
  } catch (e) {
    document.getElementById('main').innerHTML = `<div class="card" style="color:#e74c3c">載入失敗：${e.message}</div>`;
  }
}

function render() {
  const main = document.getElementById('main');
  const week = state.week;
  document.getElementById('weekLabel').textContent = week
    ? `📅 下單截止 ${fmtDate(week.deadline)}｜${fmtDate(week.start_date)} 起到現場領取`
    : '目前無開放中的團購';

  let html = '';
  if (state.locked) {
    html += `<div class="locked-banner">⏰ 本週已截止下單，僅供瀏覽</div>`;
  }

  // 代購商家
  html += `<div class="section-title">🛒 團購代購（事先預訂，到現場領取）</div>`;
  if (!state.vendors.length) html += `<div class="card">目前無代購商家</div>`;
  state.vendors.forEach(v => {
    const its = state.items.filter(it => it.parent_type === 'vendor' && it.parent_id === v.vendor_id);
    if (!its.length) return;
    const hasFee = (v.has_fee === true || v.has_fee === 'TRUE');
    let feeLabel = '';
    if (hasFee) {
      const amt = Number(v.fee_amount) || 0;
      feeLabel = v.fee_type === 'percent' ? `代購費 ${amt}%` : `代購費 $${amt}/單`;
    }
    html += `<div class="card vendor-card">
      <div class="parent-head">
        ${v.image_url ? `<img src="${v.image_url}" class="parent-pic" referrerpolicy="no-referrer">` : '<div class="parent-pic placeholder">🛒</div>'}
        <div class="parent-title">
          <div class="parent-name">${v.name}</div>
          ${feeLabel ? `<span class="tag fee">${feeLabel}</span>` : '<span class="tag free">免代購費</span>'}
        </div>
      </div>
      ${its.map(renderItem).join('')}
    </div>`;
  });

  // 現場攤位（本週一擺攤）
  html += `<div class="section-title">🏪 現場攤位預訂（取貨當天直接買）</div>`;
  if (!state.stalls.length) html += `<div class="card">本週無攤位排班</div>`;
  state.stalls.forEach(s => {
    const its = state.items.filter(it => it.parent_type === 'stall' && it.parent_id === s.stall_id);
    if (!its.length) return;
    html += `<div class="card">
      <div class="parent-head">
        ${s.image_url ? `<img src="${s.image_url}" class="parent-pic" referrerpolicy="no-referrer">` : '<div class="parent-pic placeholder">🏪</div>'}
        <div class="parent-title">${s.name}</div>
      </div>
      ${its.map(renderItem).join('')}
    </div>`;
  });

  main.innerHTML = html;
  bindQty();
  updateTotal();
}

function renderItem(it) {
  const qty = state.cart[it.item_id] || 0;
  return `<div class="item-row">
    ${it.image_url ? `<img src="${it.image_url}" class="item-pic" referrerpolicy="no-referrer" onclick="zoomPic('${it.image_url}')">` : '<div class="item-pic placeholder">📦</div>'}
    <div class="item-info">
      <div class="item-name">${it.name}${it.unit ? `<small>／${it.unit}</small>` : ''}</div>
      <div class="item-price">$${it.price}</div>
    </div>
    <div class="qty-ctrl">
      <button data-id="${it.item_id}" data-op="-" ${state.locked?'disabled':''}>−</button>
      <input type="number" min="0" value="${qty}" data-id="${it.item_id}" ${state.locked?'disabled':''}>
      <button data-id="${it.item_id}" data-op="+" ${state.locked?'disabled':''}>+</button>
    </div>
  </div>`;
}

window.zoomPic = function(url) {
  const o = document.createElement('div');
  o.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,0.9);z-index:999;display:flex;align-items:center;justify-content:center;cursor:zoom-out;';
  o.innerHTML = `<img src="${url}" referrerpolicy="no-referrer" style="max-width:95%;max-height:95%;border-radius:8px;">`;
  o.onclick = () => o.remove();
  document.body.appendChild(o);
};

function bindQty() {
  document.querySelectorAll('.qty-ctrl button').forEach(b => {
    b.onclick = () => {
      const id = b.dataset.id;
      const cur = state.cart[id] || 0;
      const next = b.dataset.op === '+' ? cur + 1 : Math.max(0, cur - 1);
      // 加購不可減：這裡「-」只是允許下單前調整，送單前都可改；送單後後台才能動
      state.cart[id] = next;
      render();
    };
  });
  document.querySelectorAll('.qty-ctrl input').forEach(inp => {
    inp.onchange = () => {
      const id = inp.dataset.id;
      state.cart[id] = Math.max(0, parseInt(inp.value) || 0);
      updateTotal();
    };
  });
}

function updateTotal() {
  // 分商家先算小計，再按 fee_type 算代購費
  const vendorSubtotals = {};
  let total = 0;
  Object.entries(state.cart).forEach(([id, qty]) => {
    if (!qty) return;
    const it = state.items.find(x => x.item_id === id);
    if (!it) return;
    const line = it.price * qty;
    total += line;
    if (it.parent_type === 'vendor') {
      vendorSubtotals[it.parent_id] = (vendorSubtotals[it.parent_id] || 0) + line;
    }
  });
  // 加代購費
  Object.entries(vendorSubtotals).forEach(([vid, sub]) => {
    const v = state.vendors.find(x => x.vendor_id === vid);
    if (!v) return;
    if (!(v.has_fee === true || v.has_fee === 'TRUE')) return;
    const amt = Number(v.fee_amount) || 0;
    if (v.fee_type === 'percent') total += Math.round(sub * amt / 100);
    else total += amt;
  });
  document.getElementById('totalAmt').textContent = `$${total}`;
  document.getElementById('summary').style.display = total > 0 && !state.locked ? 'flex' : 'none';
}

document.getElementById('checkoutBtn').onclick = () => {
  const list = buildCartList();
  if (!list.length) return alert('購物車是空的');
  const html = list.map(l => `<div class="item-row"><span>${l.name} x${l.qty}</span><b>$${l.subtotal}</b></div>`).join('')
    + `<div class="item-row"><b>總計</b><b style="color:#06C755;">$${list.reduce((a,b)=>a+b.subtotal,0)}</b></div>`;
  document.getElementById('checkoutItems').innerHTML = html;
  document.getElementById('modal').style.display = 'flex';
};

function closeModal() { document.getElementById('modal').style.display = 'none'; }
window.closeModal = closeModal;

function buildCartList() {
  const result = [];
  const vendorSubtotals = {};
  Object.entries(state.cart).forEach(([id, qty]) => {
    if (!qty) return;
    const it = state.items.find(x => x.item_id === id);
    if (!it) return;
    const subtotal = it.price * qty;
    result.push({ itemId: id, name: it.name, qty, subtotal });
    if (it.parent_type === 'vendor') {
      vendorSubtotals[it.parent_id] = (vendorSubtotals[it.parent_id] || 0) + subtotal;
    }
  });
  Object.entries(vendorSubtotals).forEach(([vid, sub]) => {
    const v = state.vendors.find(x => x.vendor_id === vid);
    if (!v || !(v.has_fee === true || v.has_fee === 'TRUE')) return;
    const amt = Number(v.fee_amount) || 0;
    let feeAmt = 0, label = '';
    if (v.fee_type === 'percent') {
      feeAmt = Math.round(sub * amt / 100);
      label = `${v.name} 代購費（${amt}%）`;
    } else {
      feeAmt = amt;
      label = `${v.name} 代購費`;
    }
    if (feeAmt > 0) {
      result.push({ itemId: '__FEE_' + vid, name: label, qty: 1, subtotal: feeAmt });
    }
  });
  return result;
}

document.getElementById('submitOrderBtn').onclick = async () => {
  const name = document.getElementById('custName').value.trim();
  if (!name) return alert('請輸入購買人姓名');
  const phone = document.getElementById('custPhone').value.trim();
  const note = document.getElementById('custNote').value.trim();
  const items = buildCartList();
  const btn = document.getElementById('submitOrderBtn');
  btn.disabled = true; btn.textContent = '送出中…';
  try {
    const res = await API.call('submitOrder', {
      weekId: state.weekId, customerName: name, phone, note, items
    });
    const total = items.reduce((a,b)=>a+b.subtotal,0);
    const summary = `${window.APP_CONFIG.OWNER_LINE_SHARE_PREFIX}\n訂單 ${res.orderId}\n${items.map(i=>`・${i.name} x${i.qty} = $${i.subtotal}`).join('\n')}\n合計 $${total}`;
    const shareUrl = 'https://line.me/R/share?text=' + encodeURIComponent(summary);
    if (confirm('下單成功！要把訂單明細分享到你的 LINE 嗎？')) {
      window.open(shareUrl, '_blank');
    }
    state.cart = {};
    closeModal();
    render();
  } catch (e) {
    alert('送單失敗：' + e.message);
  } finally {
    btn.disabled = false; btn.textContent = '確認送出';
  }
};

function fmtDate(d) {
  if (!d) return '';
  // 後端已改成 "yyyy-MM-dd HH:mm:ss" 字串，直接字串切割避免時區再次轉換
  const m = String(d).match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?/);
  if (!m) return d;
  const mm = parseInt(m[2]), dd = parseInt(m[3]);
  const hh = m[4], mi = m[5];
  // 00:00 不顯示時間
  if (!hh || (hh === '00' && mi === '00')) return `${mm}/${dd}`;
  return `${mm}/${dd} ${hh}:${mi}`;
}
