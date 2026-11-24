// 開通給店家用的設定（shop.html / shop-admin.html / provision.html）
// 後端是「總部」那支 Apps Script，靠網址的 ?shop=店家代碼 分辨是哪一家店
window.APP_CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbx-zlq8PnOnyk5VKgj739_ajSz5w-xyFD1E43KoZWWMiaGrWglCtwpYL2hdsItKp6ulFw/exec',
  SITE_TITLE: '團購下單',
  OWNER_LINE_SHARE_PREFIX: '我剛剛下單囉：',
  TURNSTILE_SITE_KEY: '0x4AAAAAAGQeuxPWkm_fvSdu',
  REQUIRE_SHOP: true,
  FEATURES: { templates: true, onboarding: true, bigText: true }
};
