# LINE 團購代購網頁 v1

## 架構
- **前台**：`index.html` — 客人下單頁，手機瀏覽
- **後台**：`admin.html` — 兩組密碼（超管／團購主）
- **後端**：Google Apps Script（`apps-script/Code.gs`）
- **資料庫**：Google 試算表
- **部署**：GitHub Pages（靜態網頁）
- **推播**：LINE Messaging API（團購主端）＋ LINE 分享按鈕（客人端）

## 試算表結構（6 個分頁）

### 1. `Settings`（系統設定）
| 欄位 | 範例 |
|---|---|
| super_admin_password | kent2026 |
| admin_password | buyer2026 |
| line_channel_access_token | (LINE 官方帳號 token) |
| line_notify_to | (團購主 user id) |

### 2. `Weeks`（週期主檔）
| week_id | start_date | deadline | status |
|---|---|---|---|
| W20261130 | 2026-11-30 | 2026-12-06 17:00 | open |

### 3. `Vendors`（代購商家）
| vendor_id | name | has_fee | fee_amount | week_id_source | active |
|---|---|---|---|---|---|
| V001 | 阿嬤水餃 | TRUE | 30 | sticky | TRUE |

> `week_id_source=sticky` 表示沿用上一週設定。

### 4. `Stalls`（現場攤位排班）
| stall_id | week_id | weekday | name | active |
|---|---|---|---|---|
| S001 | W20261130 | 1 | 週一早餐車 | TRUE |

### 5. `Items`（商品）
| item_id | parent_type | parent_id | week_id | name | price | unit | active |
|---|---|---|---|---|---|---|---|
| I001 | vendor | V001 | W20261130 | 高麗菜水餃 | 120 | 包 | TRUE |
| I002 | stall | S001 | W20261130 | 蛋餅 | 40 | 份 | TRUE |

### 6. `Orders`（訂單）
| order_id | week_id | customer_name | phone | item_id | qty | subtotal | created_at | note |
|---|---|---|---|---|---|---|---|---|

## 部署步驟（第一次設定）

1. **建立 Google 試算表**：命名 `LINE團購代購-資料庫`，開 6 個分頁如上。
2. **Apps Script**：試算表 → 擴充功能 → Apps Script → 貼 `apps-script/Code.gs` → 部署為「網頁應用程式」，執行身分「我」、存取權「所有人」→ 取得 URL。
3. **設定 `js/config.js`**：把 Apps Script URL 貼進去。
4. **GitHub Pages**：把整個 v1 資料夾（不含 apps-script）推到 GitHub repo → Settings → Pages → main branch → 取得公開網址。
5. **LINE 官方帳號**（可晚點做）：
   - 到 LINE Developers 建 Messaging API channel
   - 取 Channel access token → 填進 Settings 分頁
   - 團購主加官方帳號為好友 → 用 webhook 抓到 user id → 填 line_notify_to

## 鎖單規則
- 下單當週（例：W20261130 代表 11/30 當週團購）
- 截止時間：該週日前一日 17:00（可在 Weeks 分頁的 `deadline` 調整）
- 超過 deadline 前台顯示「本週已截止」，無法送出
- 下一週（W20261207）不受影響

## 版本記錄
- v1（2026-11-24）：初版骨架完成
