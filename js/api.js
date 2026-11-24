// 共用 API 層
const API = {
  async call(action, params = {}) {
    const url = window.APP_CONFIG.API_URL;
    const res = await fetch(url, {
      method: 'POST',
      body: JSON.stringify({ action, ...params })
    });
    const data = await res.json();
    if (!data.ok) throw new Error(data.error || '伺服器錯誤');
    return data.data;
  }
};
