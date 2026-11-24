// 共用 API 層
// 網址帶 ?shop=店家代碼 時，每次呼叫都會自動附上，後端就會讀那家店的資料
const SHOP_ID = new URLSearchParams(location.search).get('shop') || '';
const API = {
  async call(action, params = {}) {
    if (window.APP_CONFIG.REQUIRE_SHOP && !SHOP_ID) {
      throw new Error('網址少了店家代碼，請跟幫您開通的人確認網址');
    }
    const url = window.APP_CONFIG.API_URL;
    const body = { action, ...params };
    if (SHOP_ID) body.shop = SHOP_ID;
    const res = await fetch(url, { method: 'POST', body: JSON.stringify(body) });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '伺服器錯誤');
    return data.data;
  }
};
