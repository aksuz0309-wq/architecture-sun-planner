// Open-Meteo（APIキー不要）から、指定日の1時間ごとの雲量(%)を取得する
window.Weather = (() => {
  const cache = new Map();

  async function fetchCloud(lat, lon, date) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)},${date}`;
    if (cache.has(key)) return cache.get(key);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const [y, m, d] = date.split("-").map(Number);
    const past = new Date(y, m - 1, d) < today;
    const base = past ? "https://archive-api.open-meteo.com/v1/archive" : "https://api.open-meteo.com/v1/forecast";
    const url = `${base}?latitude=${lat.toFixed(4)}&longitude=${lon.toFixed(4)}&hourly=cloud_cover&start_date=${date}&end_date=${date}&timezone=auto`;
    const r = await fetch(url);
    if (!r.ok) {
      // 予報の範囲外（約16日先まで）や、直近の過去日は 400 になる
      throw new Error(past ? "過去日の観測データがまだありません" : "予報は約16日先までです");
    }
    const j = await r.json();
    const cloud = j.hourly && j.hourly.cloud_cover;
    if (!cloud || cloud.length < 24 || cloud.every(v => v == null)) throw new Error("この日の雲量データがありません");
    const res = { cloud: cloud.slice(0, 24), utcOffsetH: (j.utc_offset_seconds || 0) / 3600, past };
    cache.set(key, res);
    return res;
  }

  // 区間 [s, e)（時）の平均雲量。データが無ければ null
  function average(cloud, s, e) {
    if (!cloud) return null;
    const from = Math.floor(s), to = Math.max(from + 1, Math.ceil(e));
    const v = cloud.slice(from, to).filter(x => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }

  return { fetchCloud, average };
})();
