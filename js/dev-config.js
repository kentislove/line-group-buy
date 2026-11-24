// 開發/測試環境專用設定
// 建新 Google Sheet + 新 Apps Script 後，把部署的網頁應用程式 URL 貼到 API_URL
// 現有 demo 的 config.js 不要動
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbx-zlq8PnOnyk5VKgj739_ajSz5w-xyFD1E43KoZWWMiaGrWglCtwpYL2hdsItKp6ulFw/exec',
  SITE_TITLE: '開發測試環境',
  OWNER_LINE_SHARE_PREFIX: '測試單：',
  TURNSTILE_SITE_KEY: '0x4AAAAAAGQeuxPWkm_fvSdu',
  // 新功能開關（正式版 config.js 沒有這段，等於全關）
  FEATURES: {
    templates: true,   // 後台「用範本一鍵建」
    onboarding: true,  // 後台新手導引
    bigText: true      // 大字大按鈕模式預設開啟
  }
};
