// =========================================================
// LINE 團購代購 — Google Apps Script 後端 v1.2
// 2026-11-24 重構：商家/攤位改成永久實體 + 每週排班勾選
// =========================================================

const SS = SpreadsheetApp.getActiveSpreadsheet();

// ---------- 入口 ----------
function doGet(e) { return handle(e.parameter); }
function doPost(e) {
  const params = JSON.parse(e.postData.contents || '{}');
  return handle(params);
}

function handle(params) {
  try {
    const action = params.action;
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

  const sh = sheet('Orders');
  const orderId = 'O' + new Date().getTime();
  const now = new Date();
  const rows = p.items.map(it => [
    orderId, weekId, p.customerName, p.phone || '',
    it.itemId, it.qty, it.subtotal, now, p.note || ''
  ]);
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);

  try { pushLineToOwner(p, orderId); } catch (e) {}
  return { orderId };
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

// ---------- 後台：登入 ----------
function adminLogin(p) {
  const s = settings();
  const pwd = String(p.password);
  if (pwd === String(s.super_admin_password)) return { role: 'super', token: pwd };
  if (pwd === String(s.admin_password))       return { role: 'admin', token: pwd };
  throw new Error('密碼錯誤');
}
function requireAuth(p) {
  const s = settings();
  const t = String(p.token);
  if (t !== String(s.super_admin_password) && t !== String(s.admin_password)) {
    throw new Error('請先登入');
  }
  return t === String(s.super_admin_password) ? 'super' : 'admin';
}

// ---------- 後台：取得全部資料 ----------
function adminGetAll(p) {
  requireAuth(p);
  return {
    settings:     readAll('Settings'),
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
function adminSave(p) {
  requireAuth(p);
  const sh = sheet(p.sheet);
  const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  const idKey = headers[0];
  const data = p.row;
  const rng = sh.getDataRange().getValues();

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

// ---------- 後台：刪除一筆 ----------
function adminDelete(p) {
  requireAuth(p);
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
  const folderName = 'LINE團購代購-圖片';
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
