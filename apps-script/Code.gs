// =========================================================
// LINE 團購代購 — Google Apps Script 後端 v1.2
// 2026-11-24 重構：商家/攤位改成永久實體 + 每週排班勾選
// =========================================================

// MASTER：這支 Apps Script 綁定的試算表（總部，放店家名冊 Shops）
// SS：這次請求要讀寫的試算表；帶 shop 參數時會換成那家店自己的試算表
const MASTER = SpreadsheetApp.getActiveSpreadsheet();
let SS = MASTER;
let CURRENT_SHOP = '';

// 只能在總部操作、不能帶 shop 參數的動作
const PLATFORM_ACTIONS = ['createShop', 'listShops', 'setShopStatus', 'resetShopPassword'];

// ---------- 入口 ----------
function doGet(e) { return handle(e.parameter); }
function doPost(e) {
  const params = JSON.parse(e.postData.contents || '{}');
  return handle(params);
}

function handle(params) {
  try {
    const action = params.action;
    routeShop(params);
    let result;
    switch (action) {
      case 'getPublic':         result = getPublic(params); break;
      case 'submitOrder':       result = submitOrder(params); break;
      case 'adminLogin':        result = adminLogin(params); break;
      case 'adminGetAll':       result = adminGetAll(params); break;
      case 'adminSave':         result = adminSave(params); break;
      case 'adminDelete':       result = adminDelete(params); break;
      case 'adminReport':       result = adminReport(params); break;
      case 'setWeekSchedule':   result = setWeekSchedule(params); break;
      case 'uploadImage':       result = uploadImage(params); break;
      case 'seedDemoData':      result = seedDemoData(params); break;
      case 'deleteOrder':       result = deleteOrder(params); break;
      case 'applyTemplate':     result = applyTemplate(params); break;
      case 'createShop':        result = createShop(params); break;
      case 'listShops':         result = listShops(params); break;
      case 'setShopStatus':     result = setShopStatus(params); break;
      case 'resetShopPassword': result = resetShopPassword(params); break;
      default: throw new Error('未知的 action：' + action);
    }
    return json({ ok: true, data: result });
  } catch (err) {
    return json({ ok: false, error: String(err.message || err) });
  }
}
function json(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ---------- 多店路由：依 shop 參數切到那家店的試算表 ----------
function routeShop(p) {
  SS = MASTER;
  CURRENT_SHOP = '';
  const shop = String(p.shop || '').trim();
  if (!shop) return;
  if (PLATFORM_ACTIONS.indexOf(p.action) !== -1) throw new Error('這個動作只能在總部使用');
  const row = findShop(shop);
  if (!row) throw new Error('找不到這家店，請確認網址是否完整');
  if (row.status !== 'active') throw new Error('這家店目前暫停使用，請聯絡開通的人');
  SS = SpreadsheetApp.openById(row.sheet_id);
  CURRENT_SHOP = shop;
}
function shopsSheet() {
  let sh = MASTER.getSheetByName('Shops');
  if (!sh) {
    sh = MASTER.insertSheet('Shops');
    sh.getRange(1, 1, 1, 9).setValues([['shop_id', 'name', 'sheet_id', 'owner_name', 'owner_phone', 'status', 'plan', 'created_at', 'note']]);
  }
  return sh;
}
function readShops() {
  const rng = shopsSheet().getDataRange().getValues();
  if (rng.length < 2) return [];
  const h = rng[0];
  return rng.slice(1).map(r => {
    const o = {};
    h.forEach((k, i) => o[k] = r[i] instanceof Date ? Utilities.formatDate(r[i], 'Asia/Taipei', 'yyyy-MM-dd HH:mm') : r[i]);
    return o;
  });
}
function findShop(shopId) {
  return readShops().find(r => String(r.shop_id) === String(shopId)) || null;
}
function masterSetting(key) {
  const sh = MASTER.getSheetByName('Settings');
  if (!sh) return '';
  const row = sh.getDataRange().getValues().find(r => r[0] === key);
  return row ? row[1] : '';
}
function setSetting(key, value) {
  const sh = sheet('Settings');
  const rng = sh.getDataRange().getValues();
  for (let i = 1; i < rng.length; i++) {
    if (rng[i][0] === key) { sh.getRange(i + 1, 2).setValue(value); return; }
  }
  sh.appendRow([key, value]);
}

// ---------- 自動建本期週期 + 代購商家沿用上週勾選 ----------
// 店家不用每週手動新增週期；攤位不沿用（攤商每週要重新勾）
function ensureCurrentWeek() {
  if (String(settings().auto_week).toUpperCase() === 'FALSE') return;
  const weekId = currentWeekId();
  if (readAll('Weeks').some(w => w.week_id === weekId)) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return;
  try {
    if (readAll('Weeks').some(w => w.week_id === weekId)) return;
    const y = +weekId.substr(1, 4), m = +weekId.substr(5, 2), d = +weekId.substr(7, 2);
    const fmt = (dd) => Utilities.formatDate(new Date(Date.UTC(y, m - 1, dd, 4)), 'Asia/Taipei', 'yyyy-MM-dd');
    sheet('Weeks').appendRow([weekId, fmt(d), fmt(d - 1) + ' 17:00:00', 'open']);
    const prevId = 'W' + fmt(d - 7).replace(/-/g, '');
    const wvSheet = sheet('WeekVendors');
    readAll('WeekVendors').filter(r => r.week_id === prevId).forEach((r, i) => {
      wvSheet.appendRow(['WV' + new Date().getTime() + i, weekId, r.vendor_id]);
    });
  } finally { lock.releaseLock(); }
}

// ---------- 開通：建一家新店 ----------
function newShopId() {
  const exist = new Set(readShops().map(r => String(r.shop_id)));
  for (let i = 0; i < 20; i++) {
    const id = 's' + Math.random().toString(36).slice(2, 8);
    if (id.length === 7 && !exist.has(id)) return id;
  }
  throw new Error('產生店家代碼失敗，請再試一次');
}
function createShop(p) {
  requireSuper(p);
  const name = String(p.shopName || '').trim();
  const pwd = String(p.adminPassword || '').trim();
  if (!name) throw new Error('請填店名');
  if (pwd.length < 6) throw new Error('團購主密碼至少 6 碼');
  if (p.template && !TEMPLATES[p.template]) throw new Error('沒有這個範本');

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const shopId = newShopId();
    const newSS = SpreadsheetApp.create('團購｜' + name + '｜' + shopId);
    newSS.setSpreadsheetTimeZone('Asia/Taipei');
    DriveApp.getFileById(newSS.getId()).moveTo(getOrCreateFolder('LINE團購代購-店家資料'));

    // 切到新店的試算表做初始化
    SS = newSS; CURRENT_SHOP = shopId;
    initFreshSchema();
    newSS.getSheets().forEach(sh => {
      if (/^(工作表|Sheet)\s?1$/.test(sh.getName()) && newSS.getSheets().length > 1) newSS.deleteSheet(sh);
    });
    setSetting('site_title', name);
    setSetting('admin_password', 'sha256:' + hashPwd(pwd));
    // 店家層級的超級管理者密碼用亂數、不給任何人；要改設定由總部處理
    setSetting('super_admin_password', 'sha256:' + hashPwd(Utilities.getUuid()));
    if (p.template) applyTemplateCore(p.template);

    SS = MASTER; CURRENT_SHOP = '';
    shopsSheet().appendRow([
      shopId, name, newSS.getId(), String(p.ownerName || ''), "'" + String(p.ownerPhone || ''),
      'active', 'free', new Date(), String(p.note || '')
    ]);
    return { shopId: shopId, name: name };
  } finally {
    SS = MASTER; CURRENT_SHOP = '';
    lock.releaseLock();
  }
}
function listShops(p) {
  requireSuper(p);
  return readShops().map(r => Object.assign({}, r, {
    sheet_url: 'https://docs.google.com/spreadsheets/d/' + r.sheet_id
  }));
}
function setShopStatus(p) {
  requireSuper(p);
  if (['active', 'suspended'].indexOf(p.status) === -1) throw new Error('狀態不正確');
  const sh = shopsSheet();
  const rng = sh.getDataRange().getValues();
  const col = rng[0].indexOf('status') + 1;
  for (let i = 1; i < rng.length; i++) {
    if (String(rng[i][0]) === String(p.shopId)) { sh.getRange(i + 1, col).setValue(p.status); return { ok: true }; }
  }
  throw new Error('找不到這家店');
}
function resetShopPassword(p) {
  requireSuper(p);
  const pwd = String(p.adminPassword || '').trim();
  if (pwd.length < 6) throw new Error('密碼至少 6 碼');
  const row = findShop(p.shopId);
  if (!row) throw new Error('找不到這家店');
  try {
    SS = SpreadsheetApp.openById(row.sheet_id);
    setSetting('admin_password', 'sha256:' + hashPwd(pwd));
  } finally { SS = MASTER; }
  return { ok: true };
}

// ---------- 工具 ----------
function sheet(name) {
  const sh = SS.getSheetByName(name);
  if (!sh) throw new Error('找不到分頁：' + name);
  return sh;
}
function readAll(name) {
  const sh = SS.getSheetByName(name);
  if (!sh) return [];
  const rng = sh.getDataRange().getValues();
  if (rng.length < 2) return [];
  const headers = rng[0];
  return rng.slice(1).map(row => {
    const obj = {};
    headers.forEach((h, i) => {
      const v = row[i];
      if (v instanceof Date) {
        obj[h] = Utilities.formatDate(v, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss');
      } else if (h === 'phone' && typeof v === 'number') {
        // 試算表自動把 0912345678 當數字→補回前 0
        const s = String(v);
        obj[h] = (s.length === 9) ? '0' + s : s;
      } else {
        obj[h] = v;
      }
    });
    return obj;
  });
}
function settings() {
  const rows = readAll('Settings');
  const map = {};
  rows.forEach(r => map[r.key] = r.value);
  return map;
}
function currentWeekId() {
  const d = new Date();
  const dow = d.getDay();
  const daysUntilNextMon = ((8 - dow) % 7) || 7;
  const nextMon = new Date(d);
  nextMon.setDate(d.getDate() + daysUntilNextMon);
  return 'W' + Utilities.formatDate(nextMon, 'Asia/Taipei', 'yyyyMMdd');
}
function parseAsTaipei(s) {
  if (!s) return new Date(0);
  const m = String(s).match(/(\d{4})-(\d{1,2})-(\d{1,2})[ T](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?/);
  if (!m) return new Date(s);
  const utc = Date.UTC(+m[1], +m[2]-1, +m[3], +m[4]-8, +m[5], +m[6]||0);
  return new Date(utc);
}
function isWeekLocked(weekId) {
  const w = readAll('Weeks').find(r => r.week_id === weekId);
  if (!w) return true;
  const deadline = parseAsTaipei(w.deadline);
  return new Date() > deadline;
}
function isTrue(v) { return v === true || v === 'TRUE' || v === 'true'; }

// ---------- 前台：取得公開資料 ----------
function getPublic() {
  ensureCurrentWeek();
  const weekId = currentWeekId();
  const week = readAll('Weeks').find(r => r.week_id === weekId) || null;
  // 公開的網站設定（不含密碼與 token）
  const s = settings();
  const publicSettings = {
    site_title:     s.site_title     || 'LINE 團購代購',
    site_subtitle:  s.site_subtitle  || '',
    share_prefix:   s.share_prefix   || '我剛剛下單囉：'
  };

  const allVendors = readAll('Vendors').filter(r => isTrue(r.active));
  const allStalls  = readAll('Stalls').filter(r => isTrue(r.active));
  const allItems   = readAll('Items').filter(r => isTrue(r.active));

  // 本週有排班的商家 / 攤位（透過 join table）
  const wv = readAll('WeekVendors').filter(r => r.week_id === weekId);
  const activeVendorIds = new Set(wv.map(r => r.vendor_id));
  const vendors = allVendors.filter(v => activeVendorIds.has(v.vendor_id));

  const ws = readAll('WeekStalls').filter(r => r.week_id === weekId);
  const activeStallIds = new Set(ws.map(r => r.stall_id));
  const stalls = allStalls.filter(s => activeStallIds.has(s.stall_id));

  // 商品只保留「parent 本週有出現」的
  const activeParentIds = new Set([...activeVendorIds, ...activeStallIds]);
  const items = allItems.filter(it => activeParentIds.has(it.parent_id));

  return {
    weekId, week, vendors, stalls, items,
    locked: week ? isWeekLocked(weekId) : true,
    publicSettings
  };
}

// ---------- 前台：送出訂單 ----------
function submitOrder(p) {
  const weekId = p.weekId;
  if (isWeekLocked(weekId)) throw new Error('本週已截止，無法下單');
  if (!p.customerName) throw new Error('請輸入購買人姓名');
  if (!p.items || !p.items.length) throw new Error('購物車是空的');
  // 驗證 Turnstile token（人機驗證）
  verifyTurnstile(p.turnstileToken);
  // 粗略 rate limit：同一人姓名 10 秒內不能重複送單
  antiFlood(p.customerName);

  const sh = sheet('Orders');
  const orderId = 'O' + new Date().getTime();
  const now = new Date();
  const rows = p.items.map(it => [
    orderId, weekId, p.customerName, p.phone || '',
    it.itemId, it.qty, it.subtotal, now, p.note || ''
  ]);
  const startRow = sh.getLastRow() + 1;
  // 先把 phone 欄（col 4）設為文字格式，避免 0912… 被存成數字 912…
  sh.getRange(startRow, 4, rows.length, 1).setNumberFormat('@');
  sh.getRange(startRow, 1, rows.length, rows[0].length).setValues(rows);

  try { pushLineToOwner(p, orderId); } catch (e) {}
  return { orderId };
}

// ---------- 保密：Turnstile 人機驗證 ----------
function verifyTurnstile(token) {
  const s = settings();
  // 店家自己沒設就用總部的密鑰（新開通的店不用各自申請 Cloudflare）
  const secret = s.turnstile_secret || masterSetting('turnstile_secret');
  if (!secret) return; // 未啟用 Turnstile 就跳過
  if (!token) throw new Error('請先完成人機驗證');
  const res = UrlFetchApp.fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
    method: 'post',
    payload: { secret: secret, response: token },
    muteHttpExceptions: true
  });
  const d = JSON.parse(res.getContentText());
  if (!d.success) throw new Error('人機驗證失敗，請重試');
}

// ---------- 保密：防灌單 ----------
function antiFlood(customerName) {
  const cache = CacheService.getScriptCache();
  const key = 'flood_' + CURRENT_SHOP + '_' + customerName.replace(/\s/g, '');
  if (cache.get(key)) throw new Error('請稍候再試（避免重複送單）');
  cache.put(key, '1', 10); // 10 秒
}

function pushLineToOwner(p, orderId) {
  const s = settings();
  if (!s.line_channel_access_token || !s.line_notify_to) return;
  const total = p.items.reduce((a, b) => a + Number(b.subtotal), 0);
  const lines = p.items.map(it => `・${it.name} x${it.qty} = ${it.subtotal}`);
  const text = `📦 新訂單 ${orderId}\n👤 ${p.customerName}${p.phone ? ' (' + p.phone + ')' : ''}\n\n${lines.join('\n')}\n\n合計：${total}`;
  UrlFetchApp.fetch('https://api.line.me/v2/bot/message/push', {
    method: 'post',
    contentType: 'application/json',
    headers: { Authorization: 'Bearer ' + s.line_channel_access_token },
    payload: JSON.stringify({ to: s.line_notify_to, messages: [{ type: 'text', text }] }),
    muteHttpExceptions: true
  });
}

// ---------- 後台：登入（支援明文或 hash 兩種存法） ----------
function hashPwd(pwd, salt) {
  const raw = String(pwd) + '|' + (salt || 'line-group-buy-2026');
  const bytes = Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, raw);
  return Utilities.base64Encode(bytes);
}
function pwdMatch(input, stored) {
  if (!stored) return false;
  const s = String(stored);
  // 如果以 "sha256:" 開頭就當作雜湊值比對
  if (s.indexOf('sha256:') === 0) {
    return hashPwd(input) === s.substring(7);
  }
  // 否則當作明文（向下相容）
  return String(input) === s;
}
// 登入憑證：綁「哪一家店」＋「哪一天」
// - 綁店：A 店的登入狀態拿去 B 店用不了（就算兩家密碼一樣）
// - 綁日期：最多兩天就失效，要重新登入
function credHash(stored) {
  const s = String(stored || '');
  return s.indexOf('sha256:') === 0 ? s.substring(7) : hashPwd(s);
}
function dayStamp(offsetDays) {
  const d = new Date(Date.now() - (offsetDays || 0) * 86400000);
  return Utilities.formatDate(d, 'Asia/Taipei', 'yyyyMMdd');
}
function makeToken(prefix, stored, offsetDays) {
  return prefix + hashPwd(credHash(stored), 'tok|' + (CURRENT_SHOP || 'master') + '|' + dayStamp(offsetDays));
}
function adminLogin(p) {
  // 防猜密碼：同一家店 10 分鐘內錯 8 次就先鎖住
  const cache = CacheService.getScriptCache();
  const failKey = 'loginfail_' + (CURRENT_SHOP || 'master');
  const fails = Number(cache.get(failKey) || 0);
  if (fails >= 8) throw new Error('密碼錯太多次，請 10 分鐘後再試');
  const s = settings();
  const pwd = String(p.password);
  if (pwdMatch(pwd, s.super_admin_password)) return { role: 'super', token: makeToken('sa:', s.super_admin_password) };
  if (pwdMatch(pwd, s.admin_password))       return { role: 'admin', token: makeToken('ad:', s.admin_password) };
  cache.put(failKey, String(fails + 1), 600);
  throw new Error('密碼錯誤');
}
function requireAuth(p) {
  const s = settings();
  const t = String(p.token || '');
  for (let off = 0; off <= 1; off++) { // 今天或昨天發的都算
    if (s.super_admin_password && t === makeToken('sa:', s.super_admin_password, off)) return 'super';
    if (s.admin_password && t === makeToken('ad:', s.admin_password, off)) return 'admin';
  }
  throw new Error('登入已過期，請重新登入');
}
function requireSuper(p) {
  if (requireAuth(p) !== 'super') throw new Error('權限不足');
}

// Settings 裡不能外流的項目
const SECRET_KEYS = ['super_admin_password', 'admin_password', 'line_channel_access_token', 'turnstile_secret'];
const MASK = '••••••••';

// ---------- 把明文密碼轉成 sha256 格式（跑一次） ----------
function migratePasswordsToHash() {
  const s = settings();
  const sh = sheet('Settings');
  const rng = sh.getDataRange().getValues();
  let fixed = 0;
  for (let i = 1; i < rng.length; i++) {
    const key = rng[i][0];
    const val = String(rng[i][1] || '');
    if ((key === 'super_admin_password' || key === 'admin_password') && val && val.indexOf('sha256:') !== 0) {
      sh.getRange(i + 1, 2).setValue('sha256:' + hashPwd(val));
      fixed++;
    }
  }
  return '✅ 已將 ' + fixed + ' 組密碼轉成 sha256 格式\n登入方式不變（還是用原本密碼），只是存法變安全了';
}

// ---------- 後台：取得全部資料 ----------
function adminGetAll(p) {
  const role = requireAuth(p);
  ensureCurrentWeek();
  // 只有超級管理者拿得到 Settings，而且密碼、金鑰一律遮起來
  const safeSettings = role === 'super'
    ? readAll('Settings').map(r => SECRET_KEYS.indexOf(r.key) !== -1 && r.value ? { key: r.key, value: MASK } : r)
    : [];
  return {
    settings:     safeSettings,
    weeks:        readAll('Weeks'),
    vendors:      readAll('Vendors'),
    stalls:       readAll('Stalls'),
    items:        readAll('Items'),
    orders:       readAll('Orders'),
    weekVendors:  readAll('WeekVendors'),
    weekStalls:   readAll('WeekStalls')
  };
}

// ---------- 後台：新增／更新一筆 ----------
// 後台可以直接改的分頁（店家名冊 Shops、刪單備份 Orders_Archive 不開放）
const EDITABLE_SHEETS = ['Weeks', 'Vendors', 'Stalls', 'Items', 'Orders', 'Settings', 'WeekVendors', 'WeekStalls'];
function checkEditable(p, role) {
  if (EDITABLE_SHEETS.indexOf(p.sheet) === -1) throw new Error('這個分頁不能從後台修改');
  if (p.sheet === 'Settings' && role !== 'super') throw new Error('權限不足');
}

function adminSave(p) {
  const role = requireAuth(p);
  checkEditable(p, role);
  const sh = sheet(p.sheet);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idKey = headers[0];
  const data = p.row;
  const rng = sh.getDataRange().getValues();

  // Settings：沒改的遮罩值不要寫回去；新密碼自動加密
  if (p.sheet === 'Settings') {
    if (data.value === MASK) return { updated: data.key, unchanged: true };
    if ((data.key === 'super_admin_password' || data.key === 'admin_password') &&
        data.value && String(data.value).indexOf('sha256:') !== 0) {
      data.value = 'sha256:' + hashPwd(data.value);
    }
  }

  for (let i = 1; i < rng.length; i++) {
    if (String(rng[i][0]) === String(data[idKey])) {
      const newRow = headers.map(h => data[h] !== undefined ? data[h] : rng[i][headers.indexOf(h)]);
      sh.getRange(i + 1, 1, 1, headers.length).setValues([newRow]);
      return { updated: data[idKey] };
    }
  }

  if (!data[idKey]) {
    if (p.sheet === 'Orders') {
      data[idKey] = 'O' + new Date().getTime();
    } else {
      const prefix = idKey.charAt(0).toUpperCase();
      let max = 0;
      for (let i = 1; i < rng.length; i++) {
        const m = String(rng[i][0]).match(new RegExp('^' + prefix + '(\\d{3,})$'));
        if (m) max = Math.max(max, parseInt(m[1]));
      }
      data[idKey] = prefix + String(max + 1).padStart(3, '0');
    }
  }
  const newRow = headers.map(h => data[h] !== undefined ? data[h] : '');
  sh.appendRow(newRow);
  return { inserted: data[idKey] };
}

// ---------- 後台：整張訂單一次刪（多列同 order_id） ----------
// 刪除前先把資料備份到 Orders_Archive，萬一誤刪可救回
function deleteOrder(p) {
  requireAuth(p);
  const sh = sheet('Orders');
  const rng = sh.getDataRange().getValues();
  const headers = rng[0];
  const archive = ensureArchiveSheet(headers);
  let deleted = 0;
  // 從下往上刪，索引才不會跑掉
  for (let i = rng.length - 1; i >= 1; i--) {
    if (String(rng[i][0]) === String(p.orderId)) {
      // 先備份到 Orders_Archive，多加一欄 deleted_at
      const backup = rng[i].concat([Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss')]);
      archive.appendRow(backup);
      sh.deleteRow(i + 1);
      deleted++;
    }
  }
  if (!deleted) throw new Error('找不到訂單：' + p.orderId);
  return { deleted };
}
function ensureArchiveSheet(headers) {
  let sh = SS.getSheetByName('Orders_Archive');
  if (!sh) {
    sh = SS.insertSheet('Orders_Archive');
    sh.getRange(1, 1, 1, headers.length + 1).setValues([headers.concat(['deleted_at'])]);
  }
  return sh;
}

// ---------- 自動備份：每週日 23:00 跑一次 ----------
// 總部試算表 + 名冊裡每一家使用中的店，各自備份、各留最近 8 份
function weeklyBackup() {
  const root = getOrCreateFolder('LINE團購代購-備份');
  const log = [backupOne(MASTER.getId(), MASTER.getName(), root)];
  readShops().filter(r => r.status === 'active').forEach(r => {
    try {
      const sub = getOrCreateFolder(r.shop_id + ' ' + r.name, root);
      log.push(backupOne(r.sheet_id, r.name, sub));
    } catch (e) { log.push('⚠️ ' + r.shop_id + ' 備份失敗：' + e.message); }
  });
  return log.join('\n');
}
function getOrCreateFolder(name, parent) {
  const it = parent ? parent.getFoldersByName(name) : DriveApp.getFoldersByName(name);
  if (it.hasNext()) return it.next();
  return parent ? parent.createFolder(name) : DriveApp.createFolder(name);
}
function backupOne(sheetId, label, folder) {
  const stamp = Utilities.formatDate(new Date(), 'Asia/Taipei', 'yyyy-MM-dd HHmm');
  DriveApp.getFileById(sheetId).makeCopy(label + ' (' + stamp + ')', folder);
  const files = folder.getFiles();
  const arr = [];
  while (files.hasNext()) arr.push(files.next());
  arr.sort((a, b) => b.getLastUpdated() - a.getLastUpdated());
  for (let i = 8; i < arr.length; i++) arr[i].setTrashed(true);
  return '✅ ' + label;
}
// 一鍵安裝每週備份觸發器（只要跑一次）
function installWeeklyBackupTrigger() {
  // 先清掉舊的
  ScriptApp.getProjectTriggers().forEach(t => {
    if (t.getHandlerFunction() === 'weeklyBackup') ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('weeklyBackup')
    .timeBased().everyWeeks(1).onWeekDay(ScriptApp.WeekDay.SUNDAY).atHour(23).create();
  return '✅ 每週日 23:00 會自動備份整份試算表到 Drive「LINE團購代購-備份」資料夾';
}

// ---------- 後台：刪除一筆 ----------
function adminDelete(p) {
  checkEditable(p, requireAuth(p));
  const sh = sheet(p.sheet);
  const rng = sh.getDataRange().getValues();
  for (let i = 1; i < rng.length; i++) {
    if (String(rng[i][0]) === String(p.id)) {
      sh.deleteRow(i + 1);
      return { deleted: p.id };
    }
  }
  throw new Error('找不到資料');
}

// ---------- 後台：設定某週的商家/攤位排班 ----------
function setWeekSchedule(p) {
  requireAuth(p);
  const weekId = p.weekId;
  if (!weekId) throw new Error('缺週期編號');

  function wipe(sheetName) {
    const sh = SS.getSheetByName(sheetName);
    if (!sh) return;
    const rng = sh.getDataRange().getValues();
    for (let i = rng.length - 1; i >= 1; i--) {
      if (String(rng[i][1]) === String(weekId)) sh.deleteRow(i + 1);
    }
  }
  wipe('WeekVendors');
  wipe('WeekStalls');

  const wv = sheet('WeekVendors');
  (p.vendorIds || []).forEach(vid => {
    const id = 'WV' + new Date().getTime() + Math.floor(Math.random()*1000);
    wv.appendRow([id, weekId, vid]);
    Utilities.sleep(1);
  });
  const ws = sheet('WeekStalls');
  (p.stallIds || []).forEach(sid => {
    const id = 'WS' + new Date().getTime() + Math.floor(Math.random()*1000);
    ws.appendRow([id, weekId, sid]);
    Utilities.sleep(1);
  });
  return { ok: true, weekId };
}

// =========================================================
// 一鍵遷移（v1.2）：您在 Apps Script 編輯器執行這個函式即可
// 1. Vendors 刪 week_id_source
// 2. Stalls 刪 week_id, weekday
// 3. Items 刪 week_id
// 4. 新增 WeekVendors / WeekStalls 分頁
// 5. 自動帶入當週測試資料（W20261130 ← V001 + S001）
// =========================================================
function migrateSchema_v1_2() {
  const log = [];

  function removeCol(sheetName, headerName) {
    const sh = SS.getSheetByName(sheetName);
    if (!sh) { log.push(`⚠️ 找不到 ${sheetName}，略過`); return; }
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    const idx = headers.indexOf(headerName);
    if (idx === -1) { log.push(`✓ ${sheetName} 已無 ${headerName} 欄`); return; }
    sh.deleteColumn(idx + 1);
    log.push(`✅ ${sheetName} 刪除 ${headerName} 欄`);
  }

  function ensureSheet(sheetName, headers) {
    let sh = SS.getSheetByName(sheetName);
    if (!sh) {
      sh = SS.insertSheet(sheetName);
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      log.push(`✅ 新建分頁 ${sheetName}（含標題）`);
      return sh;
    }
    const first = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
    if (first[0] !== headers[0]) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      log.push(`✅ ${sheetName} 補上標題`);
    } else {
      log.push(`✓ ${sheetName} 已存在`);
    }
    return sh;
  }

  // 1~3：刪欄
  removeCol('Vendors', 'week_id_source');
  removeCol('Stalls',  'week_id');
  removeCol('Stalls',  'weekday');
  removeCol('Items',   'week_id');

  // 4：新增兩張 join 表
  const wv = ensureSheet('WeekVendors', ['wv_id', 'week_id', 'vendor_id']);
  const ws = ensureSheet('WeekStalls',  ['ws_id', 'week_id', 'stall_id']);

  // 5：為目前測試週 W20261130 自動帶入排班（如果資料表裡有 V001 跟 S001）
  const wvRows = readAll('WeekVendors');
  const hasV001 = wvRows.some(r => r.week_id === 'W20261130' && r.vendor_id === 'V001');
  if (!hasV001) {
    const vendorExists = readAll('Vendors').some(v => v.vendor_id === 'V001');
    if (vendorExists) {
      wv.appendRow(['WV001', 'W20261130', 'V001']);
      log.push('✅ WeekVendors 加入測試：W20261130 ← V001');
    }
  } else { log.push('✓ W20261130 ← V001 已存在'); }

  const wsRows = readAll('WeekStalls');
  const hasS001 = wsRows.some(r => r.week_id === 'W20261130' && r.stall_id === 'S001');
  if (!hasS001) {
    const stallExists = readAll('Stalls').some(s => s.stall_id === 'S001');
    if (stallExists) {
      ws.appendRow(['WS001', 'W20261130', 'S001']);
      log.push('✅ WeekStalls 加入測試：W20261130 ← S001');
    }
  } else { log.push('✓ W20261130 ← S001 已存在'); }

  const msg = '🎉 遷移完成！\n\n' + log.join('\n');
  Logger.log(msg);
  return msg;
}

// ---------- 後台：上傳圖片到 Drive ----------
function uploadImage(p) {
  requireAuth(p);
  if (!p.base64) throw new Error('沒有收到圖片');
  const folderName = 'LINE團購代購-圖片' + (CURRENT_SHOP ? '-' + CURRENT_SHOP : '');
  let folder;
  const it = DriveApp.getFoldersByName(folderName);
  if (it.hasNext()) folder = it.next();
  else folder = DriveApp.createFolder(folderName);
  try { folder.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}

  const base64 = String(p.base64).split(',').pop();
  const bytes = Utilities.base64Decode(base64);
  const mime = p.mimeType || 'image/jpeg';
  const filename = (p.filename || ('img_' + new Date().getTime())).replace(/[^a-zA-Z0-9._-]/g, '_');
  const blob = Utilities.newBlob(bytes, mime, filename);
  const file = folder.createFile(blob);
  try { file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW); } catch (e) {}
  const id = file.getId();
  // 用 lh3 googleusercontent 格式最穩（避免 thumbnail 的 CORS/rate limit）
  return { url: 'https://lh3.googleusercontent.com/d/' + id + '=w800', fileId: id };
}

// ---------- v1.5 遷移：Orders 電話欄位改成文字格式 + 補回被吃掉的 0 ----------
function migrateSchema_v1_5() {
  const sh = SS.getSheetByName('Orders');
  if (!sh) return '⚠️ 找不到 Orders 分頁';
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const phoneIdx = headers.indexOf('phone');
  if (phoneIdx === -1) return '⚠️ Orders 找不到 phone 欄';
  const col = phoneIdx + 1;
  // 1. 整欄設文字格式
  sh.getRange(1, col, sh.getMaxRows(), 1).setNumberFormat('@');
  // 2. 掃現有列，把被吃掉 0 的電話補回去
  const rows = sh.getLastRow();
  let fixed = 0;
  if (rows > 1) {
    const rng = sh.getRange(2, col, rows - 1, 1);
    const vals = rng.getValues();
    const newVals = vals.map(([v]) => {
      if (typeof v === 'number' && !isNaN(v)) {
        const s = String(v);
        if (s.length === 9) { fixed++; return ['0' + s]; }
        return [s];
      }
      return [v];
    });
    rng.setValues(newVals);
  }
  return `🎉 Orders 電話欄位處理完成\n✅ 整欄已改文字格式\n✅ 補回 ${fixed} 筆被吃 0 的電話`;
}

// ---------- v1.4 遷移：Vendors 加 fee_type（flat/percent） ----------
function migrateSchema_v1_4() {
  const log = [];
  const sh = SS.getSheetByName('Vendors');
  if (!sh) { return '⚠️ 找不到 Vendors'; }
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  if (headers.indexOf('fee_type') === -1) {
    // 插到 fee_amount 右邊
    const feeAmountIdx = headers.indexOf('fee_amount');
    const insertAt = feeAmountIdx >= 0 ? feeAmountIdx + 2 : sh.getLastColumn() + 1;
    sh.insertColumnBefore(insertAt);
    sh.getRange(1, insertAt).setValue('fee_type');
    // 既有的列全部填 'flat'
    const rows = sh.getLastRow() - 1;
    if (rows > 0) {
      const vals = Array(rows).fill(['flat']);
      sh.getRange(2, insertAt, rows, 1).setValues(vals);
    }
    log.push('✅ Vendors 新增 fee_type 欄（預設 flat）');
  } else {
    log.push('✓ Vendors 已有 fee_type 欄');
  }
  return '🎉 v1.4 遷移完成！\n\n' + log.join('\n');
}

// ---------- 一鍵初始化全新試算表（新環境用） ----------
// 跑一次就把所有分頁、欄位、初始 Settings 都建好
function initFreshSchema() {
  const log = [];
  function ensureSheet(name, headers) {
    let sh = SS.getSheetByName(name);
    if (!sh) {
      sh = SS.insertSheet(name);
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      log.push('✅ 建立分頁 ' + name);
    } else {
      // 補齊缺的欄位
      const first = sh.getRange(1, 1, 1, Math.max(1, sh.getLastColumn())).getValues()[0];
      const missing = headers.filter(h => first.indexOf(h) === -1);
      if (missing.length) {
        const start = sh.getLastColumn() + 1;
        sh.getRange(1, start, 1, missing.length).setValues([missing]);
        log.push('✅ ' + name + ' 補欄位：' + missing.join(', '));
      } else {
        log.push('✓ ' + name + ' 已存在');
      }
    }
    return sh;
  }
  ensureSheet('Settings', ['key', 'value']);
  ensureSheet('Weeks', ['week_id', 'start_date', 'deadline', 'status']);
  ensureSheet('Vendors', ['vendor_id', 'name', 'has_fee', 'fee_amount', 'fee_type', 'active', 'image_url']);
  ensureSheet('Stalls', ['stall_id', 'name', 'active', 'image_url']);
  ensureSheet('Items', ['item_id', 'parent_type', 'parent_id', 'name', 'price', 'unit', 'active', 'image_url']);
  ensureSheet('Orders', ['order_id', 'week_id', 'customer_name', 'phone', 'item_id', 'qty', 'subtotal', 'created_at', 'note']);
  ensureSheet('WeekVendors', ['wv_id', 'week_id', 'vendor_id']);
  ensureSheet('WeekStalls', ['ws_id', 'week_id', 'stall_id']);
  ensureSheet('Orders_Archive', ['order_id', 'week_id', 'customer_name', 'phone', 'item_id', 'qty', 'subtotal', 'created_at', 'note', 'deleted_at']);

  // Settings 預設值（只在沒有時加）
  const existing = new Set(readAll('Settings').map(r => r.key));
  const sh = sheet('Settings');
  const defaults = [
    ['super_admin_password', 'change_me_super'],
    ['admin_password', 'change_me_admin'],
    ['site_title', '我的團購'],
    ['site_subtitle', ''],
    ['share_prefix', '我剛剛下單囉：'],
    ['line_channel_access_token', ''],
    ['line_notify_to', ''],
    ['turnstile_secret', ''],
    ['auto_week', 'TRUE']
  ];
  defaults.forEach(([k, v]) => {
    if (!existing.has(k)) { sh.appendRow([k, v]); log.push('✅ Settings：' + k); }
  });

  // 只建本期週期；之後每週由 ensureCurrentWeek 自動建，並沿用上週的代購商家勾選
  const d = new Date();
  const dow = d.getDay();
  const daysToNextMon = ((8 - dow) % 7) || 7;
  for (let n = 0; n < 1; n++) {
    const monday = new Date(d);
    monday.setDate(d.getDate() + daysToNextMon + n * 7);
    const weekId = 'W' + Utilities.formatDate(monday, 'Asia/Taipei', 'yyyyMMdd');
    const exists = readAll('Weeks').some(w => w.week_id === weekId);
    if (!exists) {
      const deadline = new Date(monday);
      deadline.setDate(monday.getDate() - 1); // 前一天週日
      deadline.setHours(17, 0, 0);
      sheet('Weeks').appendRow([
        weekId,
        Utilities.formatDate(monday, 'Asia/Taipei', 'yyyy-MM-dd'),
        Utilities.formatDate(deadline, 'Asia/Taipei', 'yyyy-MM-dd HH:mm:ss'),
        'open'
      ]);
      log.push('✅ 建立週期 ' + weekId);
    }
  }

  // phone 欄位設文字格式
  const ordersSh = SS.getSheetByName('Orders');
  if (ordersSh) ordersSh.getRange(1, 4, ordersSh.getMaxRows(), 1).setNumberFormat('@');

  return '🎉 全新試算表初始化完成\n\n' + log.join('\n') +
    '\n\n下一步：\n1. 到 Settings 分頁改密碼\n2. 部署網頁應用程式 → 拿到網址貼給老師\n3. 老師幫您連進前後台';
}

// ---------- 一鍵套用範本：早餐/水果/烘焙 ----------
const TEMPLATES = {
  breakfast: {
    name: '早餐店範本',
    vendor: { id: 'V_tpl_bf', name: '早安早餐店', has_fee: 'FALSE', fee_amount: 0, fee_type: 'flat' },
    items: [
      ['I_bf01', '鮪魚三明治', 35, '份'],
      ['I_bf02', '火腿蛋三明治', 45, '份'],
      ['I_bf03', '培根蛋吐司', 40, '份'],
      ['I_bf04', '原味蛋餅', 35, '份'],
      ['I_bf05', '蘿蔔糕', 30, '份'],
      ['I_bf06', '冰奶茶', 30, '杯'],
      ['I_bf07', '熱豆漿', 25, '杯']
    ]
  },
  fruit: {
    name: '水果箱範本',
    vendor: { id: 'V_tpl_fr', name: '四季水果箱', has_fee: 'FALSE', fee_amount: 0, fee_type: 'flat' },
    items: [
      ['I_fr01', '綜合水果小箱', 350, '箱'],
      ['I_fr02', '富士蘋果（5 顆）', 200, '袋'],
      ['I_fr03', '愛文芒果（3 顆）', 180, '袋'],
      ['I_fr04', '巨峰葡萄', 220, '盒'],
      ['I_fr05', '香蕉', 60, '把'],
      ['I_fr06', '奇異果（6 顆）', 150, '袋'],
      ['I_fr07', '進口橘子（10 顆）', 180, '袋']
    ]
  },
  bakery: {
    name: '烘焙坊範本',
    vendor: { id: 'V_tpl_bk', name: '手作烘焙坊', has_fee: 'TRUE', fee_amount: 10, fee_type: 'percent' },
    items: [
      ['I_bk01', '歐式鄉村麵包', 85, '條'],
      ['I_bk02', '鮮奶吐司', 120, '條'],
      ['I_bk03', '可頌', 45, '個'],
      ['I_bk04', '肉鬆麵包', 35, '個'],
      ['I_bk05', '蔥花麵包', 35, '個'],
      ['I_bk06', '乳酪蛋糕', 380, '盒'],
      ['I_bk07', '檸檬磅蛋糕', 220, '條']
    ]
  }
};

function applyTemplate(p) {
  requireAuth(p);
  return applyTemplateCore(p.template);
}
function applyTemplateCore(key) {
  const tpl = TEMPLATES[key];
  if (!tpl) throw new Error('沒有這個範本：' + key);
  const log = [];
  const vSheet = sheet('Vendors');
  const iSheet = sheet('Items');
  const vHeaders = vSheet.getRange(1, 1, 1, vSheet.getLastColumn()).getValues()[0];
  const iHeaders = iSheet.getRange(1, 1, 1, iSheet.getLastColumn()).getValues()[0];

  // 建商家
  const existingV = readAll('Vendors').find(v => v.vendor_id === tpl.vendor.id);
  if (!existingV) {
    const row = {
      vendor_id: tpl.vendor.id, name: tpl.vendor.name,
      has_fee: tpl.vendor.has_fee, fee_amount: tpl.vendor.fee_amount,
      fee_type: tpl.vendor.fee_type, active: 'TRUE', image_url: ''
    };
    vSheet.appendRow(vHeaders.map(h => row[h] !== undefined ? row[h] : ''));
    log.push('✅ 商家：' + tpl.vendor.name);
  } else {
    log.push('✓ 商家 ' + tpl.vendor.name + ' 已存在，略過');
  }

  // 建商品
  const existingI = new Set(readAll('Items').map(x => x.item_id));
  tpl.items.forEach(([iid, name, price, unit]) => {
    if (existingI.has(iid)) { log.push('✓ ' + iid + ' 已存在，略過'); return; }
    const row = {
      item_id: iid, parent_type: 'vendor', parent_id: tpl.vendor.id,
      name: name, price: price, unit: unit, active: 'TRUE', image_url: ''
    };
    iSheet.appendRow(iHeaders.map(h => row[h] !== undefined ? row[h] : ''));
    log.push('✅ 商品：' + name);
  });

  // 自動勾選到目前的週期
  const weekId = currentWeekId();
  const weekExists = readAll('Weeks').some(w => w.week_id === weekId);
  if (weekExists) {
    const wv = readAll('WeekVendors').some(r => r.week_id === weekId && r.vendor_id === tpl.vendor.id);
    if (!wv) {
      sheet('WeekVendors').appendRow(['WV' + new Date().getTime(), weekId, tpl.vendor.id]);
      log.push('✅ 已勾選到本週排班（' + weekId + '）');
    }
  }

  return '🎉 範本套用完成\n\n' + log.join('\n');
}

// ---------- 一鍵填入 Demo 資料（阿賢+亦順軒 2 家 17 商品） ----------
function seedDemoData(p) {
  requireAuth(p);
  const imageMap = p.imageMap || {}; // { 'alias': 'https://drive...url' }
  const log = [];
  const vSheet = sheet('Vendors');
  const iSheet = sheet('Items');

  function findOrInsertVendor(vendor_id, row) {
    const data = readAll('Vendors');
    if (data.find(r => r.vendor_id === vendor_id)) {
      log.push(`✓ ${vendor_id} 已存在，略過`);
      return;
    }
    const headers = vSheet.getRange(1, 1, 1, vSheet.getLastColumn()).getValues()[0];
    const r = headers.map(h => row[h] !== undefined ? row[h] : '');
    vSheet.appendRow(r);
    log.push(`✅ Vendors 加入 ${vendor_id} ${row.name}`);
  }
  function findOrInsertItem(item_id, row) {
    const data = readAll('Items');
    if (data.find(r => r.item_id === item_id)) {
      log.push(`✓ ${item_id} 已存在，略過`);
      return;
    }
    const headers = iSheet.getRange(1, 1, 1, iSheet.getLastColumn()).getValues()[0];
    const r = headers.map(h => row[h] !== undefined ? row[h] : '');
    iSheet.appendRow(r);
    log.push(`✅ Items 加入 ${item_id} ${row.name}`);
  }

  // === 阿賢碳烤燒餅店 ===
  findOrInsertVendor('V_axian', {
    vendor_id: 'V_axian', name: '阿賢碳烤燒餅店',
    has_fee: 'FALSE', fee_amount: 0, fee_type: 'flat',
    active: 'TRUE', image_url: imageMap.axian_cover || ''
  });
  const axianItems = [
    ['I_ax01', '鮮肉餅', 30, '個', 'axian_01'],
    ['I_ax02', '高麗菜餅', 30, '個', 'axian_02'],
    ['I_ax03', '韭菜餅', 30, '個', 'axian_03'],
    ['I_ax04', '碳烤燒餅（蔥燒餅）', 35, '個', 'axian_04'],
    ['I_ax05', '小蔥餅🏆熱銷NO.1', 19, '個', 'axian_05'],
    ['I_ax06', '蘿蔔絲餅', 19, '個', 'axian_06'],
    ['I_ax07', '紅豆餅', 19, '個', 'axian_07'],
    ['I_ax08', '芝麻餅', 19, '個', 'axian_08'],
    ['I_ax09', '花生餅', 19, '個', 'axian_09']
  ];
  axianItems.forEach(([iid, name, price, unit, imgKey]) => {
    findOrInsertItem(iid, {
      item_id: iid, parent_type: 'vendor', parent_id: 'V_axian',
      name, price, unit, active: 'TRUE', image_url: imageMap[imgKey] || ''
    });
  });

  // === 亦順軒（10% 代購費）===
  findOrInsertVendor('V_yishun', {
    vendor_id: 'V_yishun', name: '亦順軒',
    has_fee: 'TRUE', fee_amount: 10, fee_type: 'percent',
    active: 'TRUE', image_url: imageMap.yishun_cover || ''
  });
  const yishunItems = [
    ['I_ys01', '紅酒莓果', 60, '條', 'yishun_01'],
    ['I_ys02', '芙令尬小蛋糕', 210, '盒', 'yishun_02'],
    ['I_ys03', '7吋布丁蛋糕', 120, '顆', 'yishun_03'],
    ['I_ys04', '港式菠蘿', 40, '個', 'yishun_04'],
    ['I_ys05', '三星蔥燒', 55, '個', 'yishun_05'],
    ['I_ys06', '歐克', 55, '個', 'yishun_06'],
    ['I_ys07', '椰子捲', 35, '個', 'yishun_07'],
    ['I_ys08', '大塊乳酪', 50, '個', 'yishun_08']
  ];
  yishunItems.forEach(([iid, name, price, unit, imgKey]) => {
    findOrInsertItem(iid, {
      item_id: iid, parent_type: 'vendor', parent_id: 'V_yishun',
      name, price, unit, active: 'TRUE', image_url: imageMap[imgKey] || ''
    });
  });

  // 幫 W20261130 本週自動勾選排班
  const wvRows = readAll('WeekVendors');
  const wv = sheet('WeekVendors');
  if (!wvRows.find(r => r.week_id === 'W20261130' && r.vendor_id === 'V_axian')) {
    wv.appendRow(['WV_demo_ax', 'W20261130', 'V_axian']);
    log.push('✅ W20261130 ← 阿賢');
  }
  if (!wvRows.find(r => r.week_id === 'W20261130' && r.vendor_id === 'V_yishun')) {
    wv.appendRow(['WV_demo_ys', 'W20261130', 'V_yishun']);
    log.push('✅ W20261130 ← 亦順軒');
  }

  return '🎉 Demo 資料匯入完成！\n\n' + log.join('\n');
}

// ---------- v1.3 遷移：Vendors/Stalls/Items 加 image_url 欄位 ----------
function migrateSchema_v1_3() {
  const log = [];
  function ensureCol(sheetName, headerName) {
    const sh = SS.getSheetByName(sheetName);
    if (!sh) { log.push(`⚠️ 找不到 ${sheetName}`); return; }
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
    if (headers.indexOf(headerName) !== -1) { log.push(`✓ ${sheetName} 已有 ${headerName} 欄`); return; }
    const lastCol = sh.getLastColumn();
    sh.getRange(1, lastCol + 1).setValue(headerName);
    log.push(`✅ ${sheetName} 新增 ${headerName} 欄`);
  }
  ensureCol('Vendors', 'image_url');
  ensureCol('Stalls',  'image_url');
  ensureCol('Items',   'image_url');
  const msg = '🎉 v1.3 遷移完成！\n\n' + log.join('\n');
  Logger.log(msg);
  return msg;
}

// ---------- 後台：報表 ----------
function adminReport(p) {
  requireAuth(p);
  const weekId = p.weekId || currentWeekId();
  const orders = readAll('Orders').filter(r => r.week_id === weekId);
  const items  = readAll('Items');
  const vendors = readAll('Vendors');
  const stalls  = readAll('Stalls');
  const itemMap = {};
  items.forEach(it => itemMap[it.item_id] = it);

  const byCustomer = {};
  orders.forEach(o => {
    const key = o.customer_name + '|' + (o.phone || '');
    if (!byCustomer[key]) byCustomer[key] = { name: o.customer_name, phone: o.phone, rows: [], total: 0 };
    const item = itemMap[o.item_id] || {};
    let source = '';
    if (item.parent_type === 'vendor') {
      const v = vendors.find(x => x.vendor_id === item.parent_id);
      source = '代購 - ' + (v ? v.name : '?');
    } else if (item.parent_type === 'stall') {
      const s = stalls.find(x => x.stall_id === item.parent_id);
      source = '攤位 - ' + (s ? s.name : '?');
    }
    byCustomer[key].rows.push({
      orderId: o.order_id, source,
      itemName: item.name || o.item_id, qty: o.qty, subtotal: o.subtotal
    });
    byCustomer[key].total += Number(o.subtotal || 0);
  });
  return { weekId, customers: Object.values(byCustomer) };
}
