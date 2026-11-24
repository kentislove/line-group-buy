# 資料保密與安全政策

## 目前保護機制（v1.6）

### 1. 密碼儲存
- Settings 分頁的密碼支援兩種存法：
  - 明文（向下相容舊資料）
  - SHA-256 雜湊：`sha256:{base64}`（**建議的新存法**）
- 登入時系統自動辨識，兩種都能用

#### 一鍵把明文密碼升級為雜湊
在 Apps Script 編輯器執行 `migratePasswordsToHash` 函式一次，就會把 Settings 裡的密碼轉成 `sha256:...` 格式。登入方式不變。

### 2. Session Token
- 登入成功後拿到的 token 是 `sa:{hash}` 或 `ad:{hash}`
- 存在瀏覽器 sessionStorage（關 tab 即消失）
- 每次 API 呼叫送 token 回後端驗

### 3. 人機驗證（Cloudflare Turnstile）
- 下單前客人要通過 Turnstile 驗證才能送單
- 是否啟用由 Settings 的 `turnstile_secret` 決定（空值不啟用）
- 前端 `config.js` 的 `TURNSTILE_SITE_KEY` 也要填
- 擋掉 90% 以上機器人灌單，完全免費

### 4. 防重複送單
- 同一姓名 10 秒內只能送一次單（Apps Script CacheService 記錄）
- 避免手滑雙擊或簡單腳本連續灌單

### 5. 訂單刪除保留紀錄
- 整張訂單刪除時，資料先備份到 `Orders_Archive` 分頁
- 誤刪可從 Archive 分頁救回
- 多一欄 `deleted_at` 記錄刪除時間

### 6. 自動備份
- 每週日 23:00 自動備份整份試算表到 Drive「LINE團購代購-備份」資料夾
- 保留最近 8 份，太舊的自動刪
- 在 Apps Script 執行 `installWeeklyBackupTrigger` 一次即可

### 7. 資料隱私
- 客人姓名、電話、訂單明細只有後台登入後能看
- 試算表檔案在您的 Google Drive，Google 帳號密碼就是最後一道鎖
- 商家、商品、照片本身是公開資料（給客人瀏覽用）

## 要怎麼啟用 Cloudflare Turnstile

1. 到 [Cloudflare Dashboard](https://dash.cloudflare.com/) 註冊（免費）
2. 左邊選單 → Turnstile → Add site
3. 填：
   - Widget name：隨便，例如「LINE 團購代購」
   - Hostnames：`kentislove.github.io`
   - Widget type：Managed（最寬鬆，使用者體驗最好）
4. 建立後拿到兩個 key：
   - **Site Key**（公開，貼到 `js/config.js` 的 `TURNSTILE_SITE_KEY`）
   - **Secret Key**（私密，貼到試算表 Settings 分頁新增 `turnstile_secret`）
5. 前台重整，下單時會跳出「我不是機器人」勾選框

## 商品化前還要補的

- Multi-tenant 架構（每家客戶獨立 Sheet）
- 隱私權政策／服務條款頁
- 個資法（PDPA）合規：告知客人資料用途、保存期限、刪除權
- 稽核日誌（誰在什麼時候改了什麼）
- 刪除客人訂單要有理由欄位
- 2FA（Google Authenticator）

## 風險與限制

- Apps Script URL 是公開的，任何人知道都能呼叫
  - 但有 Turnstile + 防灌 + token 保護，惡意成本高
- GitHub repo 是 public，程式碼對外公開
  - 不含任何客戶資料或密碼，只是程式邏輯
  - 商品化後，客戶識別改用 URL 參數不寫死
- Google 帳號密碼若外洩，所有資料都在裡面
  - 建議您的 Google 帳號要開 2FA
