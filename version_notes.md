# v1 版本說明（2026-11-24）

## 完成項目
- 專案資料夾結構建立
- Apps Script 後端（CRUD + 報表 + LINE 推播骨架）
- 前台 `index.html`（團購＋攤位分區、購物車、代購費自動加計、鎖單判定、分享到 LINE）
- 後台 `admin.html`（兩組密碼、7 個分頁管理、報表）
- 試算表結構文件（`README.md`）

## 已做的設計決策
- 代購費以「每家一筆」計算（一單只收一次），自動加到小計。
- 「加購不可減購」的規則：前台購物車在**送出前**都可以自由調整；**送出後**只能由後台改。
- 鎖單依 `Weeks.deadline` 時間判定，當週截止後即禁止寫入。
- 商品的 `week_id` 可以填具體週（如 `W20261130`）或 `sticky`（沿用，適合代購商家）。

## 未完成／下一版再做
- Apps Script URL 尚未部署，`js/config.js` 內是佔位字串
- LINE Messaging API 尚未設定 token / user id
- 後台的「新增/編輯」目前用 `prompt`，v2 可改為漂亮的表單
- 攤位排班的視覺化週曆（v2）
- 客人下單後重複檢查同名訂單的整併（v2）

## 檔案清單
```
v1/
├── README.md              # 部署步驟、試算表結構
├── version_notes.md       # 本檔
├── index.html             # 前台
├── admin.html             # 後台
├── css/style.css
├── js/
│   ├── config.js          # ⚠️ 需填入 Apps Script URL
│   ├── api.js
│   ├── app.js             # 前台
│   └── admin.js           # 後台
└── apps-script/
    └── Code.gs            # 貼到 Google Apps Script
```
