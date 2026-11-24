// =========================================================
// LINE 團購代購 — 後台 v1.2
// 2026-11-24 重構：彈窗表單 + 每週排班勾選 + 商品改掛商家/攤位底下
// =========================================================

let token = sessionStorage.getItem('adm_token') || '';
let role = sessionStorage.getItem('adm_role') || '';
let cache = {};
let currentTab = 'weeks';
let expandedWeek = null;   // 週期分頁：目前展開的週 ID
let drillParent = null;    // 代購商家/攤位分頁：點進去管理商品時的父節點 {type, id, name}

// ---------- 中文對照 ----------
const LABELS = {
  Settings: { key: '項目', value: '內容' },
  Weeks:    { week_id: '週期編號', start_date: '取貨起日', deadline: '下單截止', status: '狀態' },
  Vendors:  { vendor_id: '商家編號', name: '商家名稱', has_fee: '收代購費', fee_amount: '代購費', fee_type: '費用模式', active: '啟用', image_url: '圖片' },
  Stalls:   { stall_id: '攤位編號', name: '攤位名稱', active: '啟用', image_url: '圖片' },
  Items:    { item_id: '品項編號', parent_type: '來源類型', parent_id: '來源', name: '品名', price: '單價', unit: '單位', active: '啟用', image_url: '圖片' },
  Orders:   { order_id: '訂單編號', week_id: '週期', customer_name: '客人', phone: '電話', item_id: '品項編號', qty: '數量', subtotal: '小計', created_at: '下單時間', note: '備註' }
};
const SHEET_TITLES = {
  Settings: '⚙️ 系統設定', Weeks: '📅 週期', Vendors: '🛒 代購商家',
  Stalls: '🏪 現場攤位', Items: '📦 商品', Orders: '🧾 訂單'
};

// 快速新增只問這幾樣，其他自動帶
const QUICK_FIELDS = {
  Vendors: ['name', 'has_fee', 'fee_amount', 'fee_type', 'image_url'],
  Stalls:  ['name', 'image_url'],
  Items:   ['name', 'price', 'unit', 'image_url']
};
const QUICK_DEFAULTS = {
  Vendors: { active: 'TRUE', has_fee: 'FALSE', fee_amount: 0, fee_type: 'flat' },
  Stalls:  { active: 'TRUE' },
  Items:   { active: 'TRUE', unit: '個' }
};

// ---------- 欄位型態（決定表單 input） ----------
const FIELD_META = {
  Weeks: {
    week_id:    { type: 'text',           hint: '留空會自動用「下個週一日期」產生，例：W20261130' },
    start_date: { type: 'date',           hint: '取貨開始日（通常填週一）' },
    deadline:   { type: 'datetime-local', hint: '下單截止時間（通常是前一週日 17:00）' },
    status:     { type: 'select',         options: [['open','開放中'],['closed','已結束']] }
  },
  Vendors: {
    vendor_id:  { type: 'text',   hint: '留空自動產生 V001、V002…' },
    name:       { type: 'text',   hint: '商家名稱' },
    has_fee:    { type: 'select', options: [['TRUE','收代購費'],['FALSE','不收']] },
    fee_amount: { type: 'number', hint: '不收請填 0；若為百分比請填數字（例如 10 代表 10%）' },
    fee_type:   { type: 'select', options: [['flat','定額（整單加 $X）'],['percent','百分比（按小計 %）']] },
    active:     { type: 'select', options: [['TRUE','啟用'],['FALSE','下架']] },
    image_url:  { type: 'image',  hint: '商家代表照（店面 / 招牌等）' }
  },
  Stalls: {
    stall_id:   { type: 'text',   hint: '留空自動產生 S001、S002…' },
    name:       { type: 'text',   hint: '攤位名稱，例：阿田早餐車' },
    active:     { type: 'select', options: [['TRUE','啟用'],['FALSE','下架']] },
    image_url:  { type: 'image',  hint: '攤位代表照' }
  },
  Items: {
    item_id:    { type: 'text',        hint: '留空自動產生 I001、I002…' },
    parent_type:{ type: 'select-fixed' },
    parent_id:  { type: 'select-fixed' },
    name:       { type: 'text',   hint: '商品名稱' },
    price:      { type: 'number', hint: '單價，例 120' },
    unit:       { type: 'text',   hint: '例：包、份、盒' },
    active:     { type: 'select', options: [['TRUE','啟用'],['FALSE','下架']] },
    image_url:  { type: 'image',  hint: '商品照片' }
  },
  Settings: {
    key:   { type: 'text', hint: '請勿亂改既有項目的名稱' },
    value: { type: 'text', hint: '對應的值' }
  }
};

// ---------- 值翻譯（顯示用） ----------
function translateValue(col, v) {
  if (col === 'parent_type') return v === 'vendor' ? '代購商家' : v === 'stall' ? '現場攤位' : v;
  if (col === 'status') return v === 'open' ? '開放中' : v === 'closed' ? '已結束' : v;
  if (col === 'fee_type') return v === 'percent' ? '百分比' : v === 'flat' ? '定額' : v;
  if (col === 'has_fee' || col === 'active') {
    if (v === true || v === 'TRUE' || v === 'true') return '✅';
    if (v === false || v === 'FALSE' || v === 'false' || v === '') return '—';
  }
  if (col === 'image_url') {
    return v ? `<img src="${v}" style="width:50px;height:50px;object-fit:cover;border-radius:6px;border:1px solid #eee;" loading="lazy" referrerpolicy="no-referrer">` : '—';
  }
  return v ?? '';
}
function label(sheet, col) { return (LABELS[sheet] && LABELS[sheet][col]) || col; }
function formatCell(v) {
  if (v instanceof Date) return v.toLocaleString('zh-TW');
  if (v === null || v === undefined) return '';
  return String(v);
}

// ---------- Loading / Logout ----------
function showLoading(msg) {
  document.getElementById('loadingText').textContent = msg || '載入中…';
  document.getElementById('loading').classList.add('show');
}
function hideLoading() { document.getElementById('loading').classList.remove('show'); }
function logout() {
  sessionStorage.removeItem('adm_token');
  sessionStorage.removeItem('adm_role');
  window.location.reload();
}
window.logout = logout;

// ---------- 登入 ----------
document.getElementById('loginBtn').onclick = login;
document.getElementById('pwd').onkeydown = e => { if (e.key === 'Enter') login(); };
if (token) { showAdmin(); }

async function login() {
  const pwd = document.getElementById('pwd').value.trim();
  if (!pwd) return;
  showLoading('驗證中…');
  try {
    const res = await API.call('adminLogin', { password: pwd });
    token = res.token; role = res.role;
    sessionStorage.setItem('adm_token', token);
    sessionStorage.setItem('adm_role', role);
    showAdmin();
  } catch (e) { alert(e.message); }
  finally { hideLoading(); }
}
async function showAdmin() {
  document.getElementById('loginBox').style.display = 'none';
  document.getElementById('adminArea').style.display = 'block';
  document.getElementById('roleLabel').textContent = role === 'super' ? '超級管理者' : '管理者（團購主）';
  document.getElementById('logoutBtn').style.display = '';
  document.getElementById('manualBtn').style.display = '';
  document.getElementById('tabSettings').style.display = role === 'super' ? '' : 'none';
  document.querySelectorAll('.tab').forEach(t => {
    t.onclick = () => {
      currentTab = t.dataset.tab;
      expandedWeek = null; drillParent = null;
      document.querySelectorAll('.tab').forEach(x => x.classList.remove('active'));
      t.classList.add('active');
      renderTab();
    };
  });
  await loadAll();
  renderTab();
}
async function loadAll() {
  showLoading('載入資料中…');
  try { cache = await API.call('adminGetAll', { token }); }
  finally { hideLoading(); }
}

// ---------- Tab 分發 ----------
function renderTab() {
  const el = document.getElementById('tabContent');
  if (currentTab === 'weeks')    return renderWeeks(el);
  if (currentTab === 'vendors') {
    // 讓 renderParents 用 FIELD_META 的欄位順序
    return renderParents(el, 'vendor');
  }
  if (currentTab === 'stalls')   return renderParents(el, 'stall');
  if (currentTab === 'orders')   return renderOrders(el);
  if (currentTab === 'report')   return renderReport(el);
  if (currentTab === 'settings') return renderSettings(el);
}

// ---------- 📅 週期 + 排班 ----------
function renderWeeks(el) {
  const weeks = [...(cache.weeks || [])].sort((a, b) => String(b.week_id).localeCompare(String(a.week_id)));
  let html = `<div class="card">
    <h3>📅 週期 <span style="font-size:0.75rem;color:#888;font-weight:normal;">(${weeks.length} 筆)</span></h3>
    <button class="btn" onclick="openForm('Weeks', ${JSON.stringify(Object.keys(FIELD_META.Weeks)).replace(/"/g,'&quot;')})">➕ 新增週期</button>
    <div style="margin-top:12px;">`;
  weeks.forEach(w => {
    const isOpen = expandedWeek === w.week_id;
    html += `<div class="order-card" style="border-left:4px solid ${w.status==='open'?'#06C755':'#999'};">
      <div style="display:flex;justify-content:space-between;align-items:center;">
        <div>
          <b>${w.week_id}</b>
          <span class="tag" style="margin-left:6px;">${translateValue('status', w.status)}</span>
          <div style="font-size:0.85rem;color:#666;margin-top:3px;">取貨 ${fmtOnly(w.start_date)}｜截止 ${fmtOnly(w.deadline)}</div>
        </div>
        <div style="display:flex;gap:6px;">
          <button class="btn btn-ghost" style="padding:4px 10px;font-size:0.8rem;" onclick='openForm("Weeks", ${JSON.stringify(Object.keys(FIELD_META.Weeks)).replace(/"/g,'&quot;')}, ${JSON.stringify(w).replace(/'/g,"&#39;")})'>編輯</button>
          <button class="btn" style="padding:4px 10px;font-size:0.8rem;" onclick="toggleWeek('${w.week_id}')">${isOpen?'收起':'設定排班'}</button>
        </div>
      </div>
      ${isOpen ? renderWeekSchedule(w.week_id) : ''}
    </div>`;
  });
  html += '</div></div>';
  el.innerHTML = html;
}

function renderWeekSchedule(weekId) {
  const wv = (cache.weekVendors || []).filter(r => r.week_id === weekId);
  const ws = (cache.weekStalls || []).filter(r => r.week_id === weekId);
  const activeV = new Set(wv.map(r => r.vendor_id));
  const activeS = new Set(ws.map(r => r.stall_id));

  const vendors = (cache.vendors || []).filter(v => v.active === true || v.active === 'TRUE');
  const stalls  = (cache.stalls || []).filter(s => s.active === true || s.active === 'TRUE');

  const vHtml = vendors.length
    ? vendors.map(v => `<div class="checkbox-row">
        <input type="checkbox" id="wv_${v.vendor_id}" ${activeV.has(v.vendor_id)?'checked':''}>
        <label for="wv_${v.vendor_id}">${v.name}${(v.has_fee===true||v.has_fee==='TRUE')?` <span class="tag fee">代購費 $${v.fee_amount}</span>`:''}</label>
      </div>`).join('')
    : '<div style="color:#888;padding:8px;">尚無代購商家，請先在「代購商家」分頁新增</div>';

  const sHtml = stalls.length
    ? stalls.map(s => `<div class="checkbox-row">
        <input type="checkbox" id="ws_${s.stall_id}" ${activeS.has(s.stall_id)?'checked':''}>
        <label for="ws_${s.stall_id}">${s.name}</label>
      </div>`).join('')
    : '<div style="color:#888;padding:8px;">尚無攤位，請先在「現場攤位」分頁新增</div>';

  return `
    <div class="schedule-box">
      <h4>🛒 本週代購商家｜勾起來的會在前台出現</h4>
      ${vHtml}
    </div>
    <div class="schedule-box" style="margin-top:8px;">
      <h4>🏪 本週擺攤攤位｜取貨當天來現場</h4>
      ${sHtml}
    </div>
    <div style="text-align:right;margin-top:10px;">
      <button class="btn" onclick="saveWeekSchedule('${weekId}')">💾 儲存這週排班</button>
    </div>`;
}

window.toggleWeek = function(weekId) {
  expandedWeek = expandedWeek === weekId ? null : weekId;
  renderTab();
};
window.saveWeekSchedule = async function(weekId) {
  const vendorIds = (cache.vendors || []).filter(v => document.getElementById('wv_' + v.vendor_id)?.checked).map(v => v.vendor_id);
  const stallIds  = (cache.stalls  || []).filter(s => document.getElementById('ws_' + s.stall_id )?.checked).map(s => s.stall_id);
  showLoading('儲存排班中…');
  try {
    await API.call('setWeekSchedule', { token, weekId, vendorIds, stallIds });
    await loadAll();
    renderTab();
  } catch (e) { alert(e.message); }
  finally { hideLoading(); }
};

// ---------- 🛒 代購商家 / 🏪 現場攤位 ----------
function renderParents(el, type) {
  const isVendor = type === 'vendor';
  const sheet = isVendor ? 'Vendors' : 'Stalls';
  const idKey = isVendor ? 'vendor_id' : 'stall_id';
  const list = isVendor ? (cache.vendors || []) : (cache.stalls || []);
  const title = isVendor ? '🛒 代購商家' : '🏪 現場攤位';
  const cols = Object.keys(FIELD_META[sheet]);

  if (drillParent && drillParent.type === type) {
    return renderItemsOfParent(el, type);
  }

  let html = `<div class="card">
    <h3>${title} <span style="font-size:0.75rem;color:#888;font-weight:normal;">(${list.length} 筆)</span></h3>
    <div style="color:#666;font-size:0.85rem;margin-bottom:10px;">這份是永久清單。哪週會出現在前台，去「📅 週期與排班」分頁勾選。</div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn" onclick='openQuickForm("${sheet}")'>⚡ 快速新增${isVendor?'商家':'攤位'}</button>
      <button class="btn btn-ghost" onclick='openForm("${sheet}", ${JSON.stringify(cols).replace(/"/g,'&quot;')})'>➕ 完整新增（進階）</button>
    </div>
    <div class="admin-list">`;

  if (!list.length) {
    html += `<div class="empty-state"><span class="icon">📭</span>還沒有${isVendor?'商家':'攤位'}</div>`;
  }

  list.forEach(r => {
    const itemCount = (cache.items || []).filter(it => it.parent_type === type && it.parent_id === r[idKey]).length;
    html += `<div class="admin-card">
      <div class="admin-card-head">
        ${r.image_url ? `<img src="${r.image_url}" class="admin-card-img" referrerpolicy="no-referrer">` : `<div class="admin-card-img placeholder">${isVendor?'🛒':'🏪'}</div>`}
        <div class="admin-card-title">${r.name || '(未命名)'}</div>
      </div>
      <dl class="admin-fields">
        ${cols.filter(c => c !== 'name' && c !== 'image_url').map(c => `
          <div class="field-row">
            <dt>${label(sheet, c)}<small>${describeField(sheet, c)}</small></dt>
            <dd>${formatCell(translateValue(c, r[c])) || '<span style="color:#bbb;">—</span>'}</dd>
          </div>`).join('')}
      </dl>
      <div class="admin-card-actions">
        <button class="btn" onclick="drillIn('${type}','${r[idKey]}','${(r.name||'').replace(/'/g,'')}')">📦 管理商品 (${itemCount})</button>
        <button class="btn btn-ghost" onclick='openForm("${sheet}", ${JSON.stringify(cols).replace(/"/g,'&quot;')}, ${JSON.stringify(r).replace(/'/g,"&#39;")})'>✏️ 編輯</button>
        <button class="btn btn-danger" onclick="delRow('${sheet}','${r[idKey]}')">🗑 刪除</button>
      </div>
    </div>`;
  });
  html += '</div></div>';
  el.innerHTML = html;
}

// 欄位附註：告訴使用者這欄位是什麼
function describeField(sheet, col) {
  const map = {
    Vendors: {
      vendor_id: '系統自動產生',
      has_fee: '',
      fee_amount: '',
      fee_type: '',
      active: ''
    },
    Stalls: {
      stall_id: '系統自動產生',
      active: ''
    },
    Items: {
      item_id: '系統自動產生',
      parent_type: '',
      parent_id: '',
      price: '元',
      unit: '',
      active: ''
    }
  };
  return (map[sheet] && map[sheet][col]) ? ` <span style="color:#bbb;">(${map[sheet][col]})</span>` : '';
}
window.drillIn = function(type, id, name) {
  drillParent = { type, id, name };
  renderTab();
};

function renderItemsOfParent(el, type) {
  const parentLabel = type === 'vendor' ? '代購商家' : '現場攤位';
  const items = (cache.items || []).filter(it => it.parent_type === type && it.parent_id === drillParent.id);
  const cols = Object.keys(FIELD_META.Items);
  const displayCols = cols.filter(c => !['parent_type','parent_id','name','image_url'].includes(c));

  let html = `<div class="card">
    <div style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;">
      <h3>📦 ${drillParent.name} 的商品 <span style="font-size:0.75rem;color:#888;font-weight:normal;">(${items.length} 筆)</span></h3>
      <button class="btn btn-ghost" onclick="drillParent=null; renderTab();">← 回${parentLabel}清單</button>
    </div>
    <div style="display:flex;gap:8px;flex-wrap:wrap;">
      <button class="btn" onclick='openQuickItemForm()'>⚡ 快速新增商品</button>
      <button class="btn btn-ghost" onclick='openItemForm()'>➕ 完整新增（進階）</button>
    </div>
    <div class="admin-list">`;

  if (!items.length) {
    html += `<div class="empty-state"><span class="icon">📦</span>還沒有商品</div>`;
  }

  items.forEach(it => {
    html += `<div class="admin-card">
      <div class="admin-card-head">
        ${it.image_url ? `<img src="${it.image_url}" class="admin-card-img" referrerpolicy="no-referrer">` : `<div class="admin-card-img placeholder">📦</div>`}
        <div class="admin-card-title">${it.name || '(未命名)'}</div>
      </div>
      <dl class="admin-fields">
        ${displayCols.map(c => `
          <div class="field-row">
            <dt>${label('Items', c)}<small>${describeField('Items', c)}</small></dt>
            <dd>${formatCell(translateValue(c, it[c])) || '<span style="color:#bbb;">—</span>'}</dd>
          </div>`).join('')}
      </dl>
      <div class="admin-card-actions">
        <button class="btn btn-ghost" onclick='openItemForm(${JSON.stringify(it).replace(/'/g,"&#39;")})'>✏️ 編輯</button>
        <button class="btn btn-danger" onclick="delRow('Items','${it.item_id}')">🗑 刪除</button>
      </div>
    </div>`;
  });
  html += '</div></div>';
  el.innerHTML = html;
}

window.openItemForm = function(row) {
  const cols = Object.keys(FIELD_META.Items);
  const r = {...(row || {})};
  r.parent_type = drillParent.type;
  r.parent_id = drillParent.id;
  openForm('Items', cols, r, { lockedFields: ['parent_type', 'parent_id'] });
};

// 🆕 快速新增商家/攤位
window.openQuickForm = function(sheet) {
  const cols = QUICK_FIELDS[sheet] || Object.keys(FIELD_META[sheet]);
  const defaults = QUICK_DEFAULTS[sheet] || {};
  openForm(sheet, cols, defaults, { quick: true });
};

// 🆕 快速新增商品（parent_type/id 自動帶）
window.openQuickItemForm = function() {
  const cols = QUICK_FIELDS.Items;
  const row = {
    ...QUICK_DEFAULTS.Items,
    parent_type: drillParent.type,
    parent_id: drillParent.id
  };
  openForm('Items', cols, row, { quick: true, hiddenDefaults: ['parent_type','parent_id','active'] });
};

// ---------- 彈窗表單 ----------
function openForm(sheetName, cols, row, opts) {
  opts = opts || {};
  const isEdit = !!(row && row[cols[0]]);
  const data = {...(row || {})};
  const titlePrefix = opts.quick ? '⚡ 快速新增' : (isEdit ? '編輯' : '新增');
  document.getElementById('formTitle').textContent = titlePrefix + '｜' + (SHEET_TITLES[sheetName] || sheetName);

  const fieldsHtml = cols.map(c => renderField(sheetName, c, data[c], opts.lockedFields && opts.lockedFields.includes(c))).join('');
  document.getElementById('formFields').innerHTML = fieldsHtml;

  document.getElementById('formSaveBtn').onclick = async () => {
    const row2 = {...data};
    cols.forEach(c => {
      const el = document.getElementById('f_' + c);
      if (!el) return;
      let v = el.value;
      if (el.tagName === 'INPUT' && el.type === 'datetime-local' && v) {
        v = v.replace('T', ' ') + ':00';
      }
      row2[c] = v;
    });
    if (!row2[cols[0]]) delete row2[cols[0]]; // 讓後端自動產生
    showLoading('儲存中…');
    try {
      await API.call('adminSave', { token, sheet: sheetName, row: row2 });
      await loadAll();
      renderTab();
      closeForm();
    } catch (e) { alert(e.message); }
    finally { hideLoading(); }
  };
  document.getElementById('formModal').classList.add('show');
}
function closeForm() { document.getElementById('formModal').classList.remove('show'); }
window.closeForm = closeForm;

// ---------- 圖片上傳 ----------
window.handleImageUpload = async function(input, col) {
  const file = input.files[0];
  if (!file) return;
  if (file.size > 5 * 1024 * 1024) { alert('圖片請小於 5MB'); return; }
  showLoading('上傳圖片中…');
  try {
    const base64 = await new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result);
      r.onerror = reject;
      r.readAsDataURL(file);
    });
    const res = await API.call('uploadImage', {
      token, base64, filename: file.name, mimeType: file.type
    });
    document.getElementById('f_' + col).value = res.url;
    document.getElementById('url_' + col).value = res.url;
    const prev = document.getElementById('prev_' + col);
    prev.style.backgroundImage = `url('${res.url}')`;
    prev.textContent = '';
  } catch (e) { alert('上傳失敗：' + e.message); }
  finally { hideLoading(); }
};
window.clearImage = function(col) {
  document.getElementById('f_' + col).value = '';
  document.getElementById('url_' + col).value = '';
  const prev = document.getElementById('prev_' + col);
  prev.style.backgroundImage = '';
  prev.textContent = '尚無圖片';
};
window.syncImageUrl = function(col) {
  const v = document.getElementById('url_' + col).value;
  document.getElementById('f_' + col).value = v;
  const prev = document.getElementById('prev_' + col);
  prev.style.backgroundImage = v ? `url('${v}')` : '';
  prev.textContent = v ? '' : '尚無圖片';
};

function renderField(sheetName, col, value, locked) {
  const meta = (FIELD_META[sheetName] && FIELD_META[sheetName][col]) || { type: 'text' };
  const name = label(sheetName, col);
  const hintText = meta.hint || '';
  let input = '';
  const val = value == null ? '' : String(value);
  const disabled = locked ? 'disabled' : '';

  if (meta.type === 'select') {
    input = `<select id="f_${col}" ${disabled}>${meta.options.map(([v,t]) => `<option value="${v}" ${v===val?'selected':''}>${t}</option>`).join('')}</select>`;
  } else if (meta.type === 'select-fixed') {
    // 固定值，純顯示但帶 hidden input
    let displayText = val;
    if (col === 'parent_type') displayText = val === 'vendor' ? '代購商家' : '現場攤位';
    else if (col === 'parent_id') {
      const list = (cache.vendors || []).concat(cache.stalls || []);
      const found = list.find(x => (x.vendor_id || x.stall_id) === val);
      if (found) displayText = `${found.name}（${val}）`;
    }
    input = `<input id="f_${col}" type="text" value="${val}" style="display:none"><div style="padding:8px 10px;background:#f0f3f5;border-radius:6px;">${displayText}</div>`;
  } else if (meta.type === 'date') {
    // 試算表存 "2026-11-30 00:00:00" → input date 需要 "2026-11-30"
    const d = val.match(/^(\d{4}-\d{2}-\d{2})/);
    input = `<input type="date" id="f_${col}" value="${d ? d[1] : ''}">`;
  } else if (meta.type === 'datetime-local') {
    // 試算表存 "2026-11-29 17:00:00" → "2026-11-29T17:00"
    const d = val.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2})/);
    input = `<input type="datetime-local" id="f_${col}" value="${d ? d[1]+'T'+d[2] : ''}">`;
  } else if (meta.type === 'number') {
    input = `<input type="number" id="f_${col}" value="${val}">`;
  } else if (meta.type === 'image') {
    input = `
      <input type="hidden" id="f_${col}" value="${val}">
      <div style="display:flex;gap:10px;align-items:flex-start;">
        <div id="prev_${col}" style="width:100px;height:100px;border:1px dashed #ccc;border-radius:8px;background:#f8f9fa center/cover no-repeat;${val?`background-image:url('${val}');`:''}display:flex;align-items:center;justify-content:center;color:#aaa;font-size:0.75rem;">${val ? '' : '尚無圖片'}</div>
        <div style="flex:1;">
          <label class="btn btn-ghost" style="padding:6px 12px;font-size:0.85rem;cursor:pointer;">
            📷 選擇照片
            <input type="file" accept="image/*" style="display:none;" onchange="handleImageUpload(this, '${col}')">
          </label>
          ${val ? `<button type="button" class="btn btn-danger" style="padding:6px 12px;font-size:0.85rem;margin-left:4px;" onclick="clearImage('${col}')">移除</button>` : ''}
          <div style="font-size:0.75rem;color:#888;margin-top:4px;">或直接貼網址：</div>
          <input type="text" id="url_${col}" value="${val}" placeholder="https://..." style="font-size:0.8rem;padding:6px;" oninput="syncImageUrl('${col}')">
        </div>
      </div>`;
  } else {
    input = `<input type="text" id="f_${col}" value="${val}">`;
  }

  return `<div class="form-field">
    <label>${name}${locked ? ' <span style="font-weight:normal;color:#888;font-size:0.75rem;">(自動帶入)</span>' : ''}</label>
    ${input}
    ${hintText ? `<div class="field-hint">${hintText}</div>` : ''}
  </div>`;
}

// ---------- 🧾 訂單（卡片式） ----------
function renderOrders(el) {
  const orders = [...(cache.orders || [])].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
  const itemMap = {}; (cache.items || []).forEach(it => itemMap[it.item_id] = it);
  const vMap = {}; (cache.vendors || []).forEach(v => vMap[v.vendor_id] = v);
  const sMap = {}; (cache.stalls || []).forEach(s => sMap[s.stall_id] = s);

  const groups = {};
  orders.forEach(o => {
    if (!groups[o.order_id]) {
      groups[o.order_id] = {
        orderId: o.order_id, weekId: o.week_id, name: o.customer_name,
        phone: o.phone, time: o.created_at, note: o.note, rows: [], total: 0
      };
    }
    const it = itemMap[o.item_id] || {};
    let src = '';
    if (it.parent_type === 'vendor') src = vMap[it.parent_id]?.name || '?';
    else if (it.parent_type === 'stall') src = sMap[it.parent_id]?.name || '?';
    groups[o.order_id].rows.push({ name: it.name || o.item_id, qty: o.qty, subtotal: o.subtotal, src });
    groups[o.order_id].total += Number(o.subtotal || 0);
  });

  let html = `<div class="card"><h3>🧾 訂單 <span style="font-size:0.75rem;color:#888;font-weight:normal;">(${Object.keys(groups).length} 筆)</span></h3>`;
  if (!Object.keys(groups).length) html += '<p style="color:#888;">目前無訂單</p>';
  Object.values(groups).forEach(g => {
    html += `<div class="order-card">
      <div class="order-head">
        <div><b>${g.name}</b> ${g.phone ? `<span style="color:#888;">${g.phone}</span>` : ''}</div>
        <div>${g.time ? String(g.time).slice(5,16).replace('T',' ') : ''}｜${g.weekId}</div>
      </div>
      <ul class="order-items">
        ${g.rows.map(r => `<li><span>${r.src ? `[${r.src}] ` : ''}${r.name} × ${r.qty}</span><span>$${r.subtotal}</span></li>`).join('')}
      </ul>
      ${g.note ? `<div style="font-size:0.8rem;color:#888;margin-top:4px;">備註：${g.note}</div>` : ''}
      <div class="order-total">總計 $${g.total}</div>
      <div style="margin-top:6px;text-align:right;">
        <button class="btn btn-danger" style="padding:4px 10px;font-size:0.75rem;" onclick="delOrder('${g.orderId}')">整筆刪除</button>
      </div>
    </div>`;
  });
  html += '</div>';
  el.innerHTML = html;
}
window.delOrder = async function(orderId) {
  if (!confirm(`確定要整筆刪除訂單 ${orderId}？`)) return;
  showLoading('刪除中…');
  try {
    await API.call('deleteOrder', { token, orderId });
    await loadAll();
    renderTab();
  } catch (e) { alert(e.message); }
  finally { hideLoading(); }
};

// ---------- 📊 報表 ----------
async function renderReport(el) {
  el.innerHTML = '<div class="card">報表載入中…</div>';
  showLoading('產生報表中…');
  try {
    const r = await API.call('adminReport', { token });
    hideLoading();
    window._lastReport = r; // 暫存給匯出用
    const grandTotal = r.customers.reduce((a,c)=>a+c.total,0);
    let html = `<div class="card report-card">
      <div class="report-head no-print" style="display:flex;justify-content:space-between;align-items:center;flex-wrap:wrap;gap:8px;margin-bottom:10px;">
        <h3 style="margin:0;">📊 本週報表 <small style="color:#888;font-weight:normal;">(${r.weekId})</small></h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap;">
          <button class="btn" onclick="printReport()">🖨️ 列印 / 存 PDF</button>
          <button class="btn btn-ghost" onclick="exportReportCsv()">📊 匯出 Excel</button>
        </div>
      </div>
      <div class="report-print-head" style="display:none;text-align:center;margin-bottom:16px;">
        <h2 style="margin:4px 0;">本週團購訂單報表</h2>
        <div style="color:#666;">週期：${r.weekId}　列印時間：${new Date().toLocaleString('zh-TW')}</div>
      </div>`;
    if (!r.customers.length) { html += '<p style="color:#888;padding:20px;text-align:center;">本週尚無訂單</p>'; }
    r.customers.forEach(c => {
      html += `<div class="report-customer" style="margin-top:14px;border-top:1px dashed #ccc;padding-top:10px;">
        <div style="font-weight:700;font-size:1.05rem;">
          ${c.name}
          ${c.phone ? `<span style="color:#666;font-weight:400;margin-left:8px;">📞 ${c.phone}</span>` : ''}
        </div>
        <table class="report-table" style="margin-top:8px;width:100%;">
          <thead><tr><th>來源</th><th>品項</th><th style="text-align:right;">數量</th><th style="text-align:right;">小計</th></tr></thead>
          <tbody>
          ${c.rows.map(x => `<tr>
            <td style="color:#666;font-size:0.88rem;">${x.source}</td>
            <td>${x.itemName}</td>
            <td style="text-align:right;">${x.qty}</td>
            <td style="text-align:right;">$${x.subtotal}</td>
          </tr>`).join('')}
          </tbody>
        </table>
        <div style="text-align:right;margin-top:6px;font-weight:700;">
          個人總計：<span style="color:#5F7D5C;font-size:1.15rem;">$${c.total}</span>
        </div>
      </div>`;
    });
    if (r.customers.length) {
      html += `<div style="margin-top:18px;padding-top:12px;border-top:2px solid #5F7D5C;text-align:right;font-weight:800;font-size:1.1rem;">
        🧾 本週總營收：<span style="color:#5F7D5C;font-size:1.4rem;">$${grandTotal}</span>
      </div>`;
    }
    html += '</div>';
    el.innerHTML = html;
  } catch (e) {
    hideLoading();
    el.innerHTML = `<div class="card" style="color:#e74c3c">載入失敗：${e.message}</div>`;
  }
}

window.printReport = function() {
  const r = window._lastReport;
  if (!r) return alert('沒有報表資料');
  // 檢測是否為手機/內建瀏覽器
  const isMobile = /Mobi|Android|iPhone|iPad|Line\/|FB|Instagram/.test(navigator.userAgent);
  const grand = r.customers.reduce((a,c)=>a+c.total,0);
  const customerHtml = r.customers.map(c => `
    <div class="cust">
      <div class="cust-head"><b>${c.name}</b>${c.phone ? ` <span class="phone">📞 ${c.phone}</span>` : ''}</div>
      <table>
        <thead><tr><th>來源</th><th>品項</th><th class="r">數量</th><th class="r">小計</th></tr></thead>
        <tbody>${c.rows.map(x => `<tr><td class="src">${x.source}</td><td>${x.itemName}</td><td class="r">${x.qty}</td><td class="r">$${x.subtotal}</td></tr>`).join('')}</tbody>
      </table>
      <div class="sub">個人總計 <b>$${c.total}</b></div>
    </div>`).join('');
  const docHtml = `<!DOCTYPE html>
<html lang="zh-TW"><head>
<meta charset="UTF-8"><title>團購報表 ${r.weekId}</title>
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  * { box-sizing: border-box; }
  body { font-family:"Noto Sans TC","Microsoft JhengHei",sans-serif; color:#222; padding:20px; max-width:800px; margin:0 auto; background:#fff; }
  h1 { margin:4px 0; font-size:1.3rem; text-align:center; }
  .meta { text-align:center; color:#666; font-size:0.85rem; margin-bottom:16px; }
  .cust { border-top:1px dashed #bbb; padding:12px 0; page-break-inside:avoid; }
  .cust-head { font-size:1.05rem; margin-bottom:6px; }
  .cust-head .phone { color:#555; font-weight:400; margin-left:8px; font-size:0.9rem; }
  table { width:100%; border-collapse:collapse; font-size:0.9rem; }
  th,td { padding:5px 8px; border:1px solid #ccc; }
  th { background:#f3f3f3; }
  td.r, th.r { text-align:right; }
  td.src { color:#666; font-size:0.85rem; }
  .sub { text-align:right; margin-top:6px; }
  .sub b { color:#2d8f4f; font-size:1.1rem; }
  .grand { border-top:2px solid #2d8f4f; margin-top:16px; padding-top:10px; text-align:right; font-size:1.1rem; }
  .grand b { color:#2d8f4f; font-size:1.3rem; }
  .btns { position:fixed; top:10px; right:10px; display:flex; gap:8px; }
  .btn { padding:10px 18px; border:none; border-radius:10px; background:#5F7D5C; color:#fff; font-size:0.95rem; font-weight:600; cursor:pointer; box-shadow:0 2px 8px rgba(0,0,0,0.15); }
  .btn.g { background:#fff; color:#5F7D5C; border:1.5px solid #5F7D5C; }
  @media print { .btns { display:none; } body { padding:0; } }
</style>
</head><body>
<div class="btns">
  <button class="btn" onclick="window.print()">🖨️ 列印 / 存 PDF</button>
  <button class="btn g" onclick="window.close()">關閉</button>
</div>
<h1>本週團購訂單報表</h1>
<div class="meta">週期 ${r.weekId}　列印時間 ${new Date().toLocaleString('zh-TW')}</div>
${customerHtml || '<div style="text-align:center;padding:40px;color:#888;">本週尚無訂單</div>'}
<div class="grand">🧾 本週總營收 <b>$${grand}</b></div>
<script>
  // 桌機自動彈列印；手機讓使用者手動按
  if (!/Mobi|Android|iPhone|iPad/.test(navigator.userAgent)) {
    setTimeout(() => window.print(), 400);
  }
</script>
</body></html>`;
  const blob = new Blob([docHtml], { type: 'text/html;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const w = window.open(url, '_blank');
  if (!w) {
    // 彈窗被擋，改成下載
    const a = document.createElement('a');
    a.href = url; a.download = `團購報表_${r.weekId}.html`; a.click();
    alert('列印頁被瀏覽器擋，已改下載 HTML 檔，請打開後按右上角列印');
  }
  setTimeout(() => URL.revokeObjectURL(url), 30000);
};

window.exportReportCsv = function() {
  const r = window._lastReport;
  if (!r) return alert('沒有報表資料');
  // 欄位順序：週期, 客人, 電話, 來源, 品項, 數量, 小計, 個人總計
  const lines = [['週期','客人','電話','來源','品項','數量','小計','個人總計'].join(',')];
  r.customers.forEach(c => {
    const phone = String(c.phone || '');
    c.rows.forEach((row, idx) => {
      lines.push([
        r.weekId, csvEsc(c.name), csvEsc(phone),
        csvEsc(row.source), csvEsc(row.itemName),
        row.qty, row.subtotal,
        idx === c.rows.length - 1 ? c.total : ''
      ].join(','));
    });
  });
  const grand = r.customers.reduce((a,c)=>a+c.total,0);
  lines.push(['','','','','','','本週總營收', grand].join(','));
  const bom = '﻿'; // Excel 認得的 UTF-8 BOM
  const blob = new Blob([bom + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = `團購報表_${r.weekId}.csv`;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
};
function csvEsc(v) {
  if (v == null) return '';
  const s = String(v);
  // 電話欄位尤其要保 0 → 加 =""... Excel 才不會把 0912 當數字
  if (/^0\d{8,}$/.test(s)) return `="${s}"`;
  if (/[",\n]/.test(s)) return `"${s.replace(/"/g,'""')}"`;
  return s;
}

// ---------- ⚙️ 系統設定 ----------
function renderSettings(el) {
  if (role !== 'super') {
    el.innerHTML = '<div class="card">僅超級管理者可查看</div>';
    return;
  }
  const rows = cache.settings || [];
  const cols = ['key', 'value'];
  const descriptions = {
    super_admin_password: '超級管理者密碼（您用的）',
    admin_password: '管理者密碼（團購主用的）',
    line_channel_access_token: 'LINE Messaging API token（進階，付費版用）',
    line_notify_to: 'LINE 官方帳號接收者 userId（進階）',
    site_title: '網站主標題（會顯示在前台 header）',
    site_subtitle: '網站副標題（保留，未來使用）',
    share_prefix: '客人分享到 LINE 時的訊息開頭'
  };
  let html = `<div class="card">
    <h3>⚙️ 系統設定</h3>
    <div style="color:#666;font-size:0.85rem;margin-bottom:12px;">密碼和 LINE token 這類項目只建議修改，不要新增或刪掉。</div>
    <div class="admin-list">`;
  rows.forEach(r => {
    const desc = descriptions[r.key] || '';
    const isSecret = /password|token/.test(r.key);
    const displayValue = isSecret && r.value ? '••••••••' : (r.value || '<span style="color:#bbb;">—</span>');
    html += `<div class="admin-card">
      <dl class="admin-fields">
        <div class="field-row">
          <dt>項目名稱<small style="color:#bbb;">(key)</small></dt>
          <dd><code style="background:#f0f3f5;padding:2px 6px;border-radius:4px;font-size:0.85rem;">${r.key}</code></dd>
        </div>
        <div class="field-row">
          <dt>目前值</dt>
          <dd>${displayValue}</dd>
        </div>
        ${desc ? `<div class="field-row">
          <dt>說明</dt>
          <dd style="color:#666;font-size:0.85rem;font-weight:normal;">${desc}</dd>
        </div>` : ''}
      </dl>
      <div class="admin-card-actions">
        <button class="btn btn-ghost" onclick='openForm("Settings", ${JSON.stringify(cols).replace(/"/g,'&quot;')}, ${JSON.stringify(r).replace(/'/g,"&#39;")})'>✏️ 編輯</button>
      </div>
    </div>`;
  });
  html += '</div></div>';
  el.innerHTML = html;
}

// ---------- 共用 ----------
window.delRow = async function(sheet, id) {
  if (!confirm(`確定刪除 ${id}？`)) return;
  showLoading('刪除中…');
  try {
    await API.call('adminDelete', { token, sheet, id });
    await loadAll();
    renderTab();
  } catch (e) { alert(e.message); }
  finally { hideLoading(); }
};

function fmtOnly(d) {
  if (!d) return '—';
  const m = String(d).match(/(\d{4})-(\d{1,2})-(\d{1,2})(?:[ T](\d{1,2}):(\d{1,2}))?/);
  if (!m) return d;
  const mm = parseInt(m[2]), dd = parseInt(m[3]);
  const hh = m[4], mi = m[5];
  if (!hh || (hh === '00' && mi === '00')) return `${mm}/${dd}`;
  return `${mm}/${dd} ${hh}:${mi}`;
}
