# v1.2 試算表結構遷移

**為什麼要改**：原本「商家＝一週綁一個 ID」的模型不符合實務，改成「商家永久存在、每週勾選是否出現」。

## 試算表要改的事（照順序做）

### 1. Vendors 分頁：刪一欄
- 點 `week_id_source` 那一欄（**E 欄**）→ 右鍵 → 刪除欄
- 改完剩 5 欄：`vendor_id | name | has_fee | fee_amount | active`

### 2. Stalls 分頁：刪兩欄
- 刪 `week_id`（**B 欄**）
- 刪 `weekday`（**原 C 欄，刪 B 後變 B 欄**）
- 改完剩 3 欄：`stall_id | name | active`

### 3. Items 分頁：刪一欄
- 刪 `week_id`（**D 欄**）
- 改完剩 7 欄：`item_id | parent_type | parent_id | name | price | unit | active`

### 4. 新開 WeekVendors 分頁
- 底下工作表加「➕」→ 改名 `WeekVendors`
- A1 貼標題列：
```
wv_id	week_id	vendor_id
```
- 測試資料（A2 開始，為了讓既有的 V001 阿嬤水餃能在 W20261130 出現）：
```
WV001	W20261130	V001
```

### 5. 新開 WeekStalls 分頁
- 加「➕」→ 改名 `WeekStalls`
- A1 貼標題列：
```
ws_id	week_id	stall_id
```
- 測試資料：
```
WS001	W20261130	S001
```

### 6. 重新部署 Apps Script
一樣的方法：
1. 回 Apps Script 編輯器，把 `Code.gs` 全部清空重貼最新版
2. 存檔
3. 部署 → 管理部署作業 → ✏️ → 新版本 → 部署
4. 網址**不變**

## 做完之後可以測什麼
- 進後台 `admin.html` → 📅 週期與排班
- 點 W20261130 的「設定排班」→ 看到阿嬤水餃、週一早餐車都被勾起來 ✅
- 進 🛒 代購商家 → 點「管理商品」→ 可以新增、編輯、刪除商品
- 新增/編輯任何東西時：跳出來的是「漂亮的彈窗表單」有真正的下拉選單
