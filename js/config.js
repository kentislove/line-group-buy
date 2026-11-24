// 部署 Apps Script 後，把網頁應用程式 URL 貼到這裡
// 注意：SITE_TITLE 和 OWNER_LINE_SHARE_PREFIX 會被試算表 Settings 分頁中的 site_title / share_prefix 覆蓋
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyJl4_NvOkNKIkrvVyiDRHQtJHe5E9depLkVI0pCe6O37Wpb8wiiCrwOLZf1mkwBUBmQw/exec',
  SITE_TITLE: '農安市集112宜蘭美食市集',
  OWNER_LINE_SHARE_PREFIX: '我剛剛下單囉：',
  // Cloudflare Turnstile sitekey；填空字串就不啟用人機驗證
  TURNSTILE_SITE_KEY: ''
};
