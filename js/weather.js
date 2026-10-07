// MET Norway（ノルウェー気象局）Locationforecast から雲量(%)を取得する。
// 商用利用可・無料・APIキー不要（CC BY 4.0、出典表示が必要）。ブラウザからは Origin ヘッダで識別される。
// 予報は約9〜10日先まで。最初の約60時間は1時間ごと、その先は6時間ごとの値。過去の日付は取得できない。
// 位置は小数2桁（約1km）に丸めて送る（建物の正確な場所を外部に送らない。規約の上限は4桁）。
window.Weather = (() => {
  const TTL = 10 * 60 * 1000; // 同じ地点の予報は10分間使い回す
  const cache = new Map();

  async function loadSeries(lat, lon) {
    const key = `${lat.toFixed(2)},${lon.toFixed(2)}`;
    const hit = cache.get(key);
    if (hit && Date.now() - hit.at < TTL) return hit.series;
    const r = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat.toFixed(2)}&lon=${lon.toFixed(2)}`);
    if (!r.ok) throw new Error("天気サーバーに接続できません（" + r.status + "）");
    const j = await r.json();
    // 時刻(UTC, 1時間単位の通し番号) → 雲量
    const series = (j.properties.timeseries || [])
      .map(t => ({ hour: Math.floor(Date.parse(t.time) / 3600000), v: t.data.instant.details.cloud_area_fraction }))
      .filter(t => t.v != null);
    if (!series.length) throw new Error("雲量データがありません");
    cache.set(key, { at: Date.now(), series });
    return series;
  }

  // 現地日付 date の 0〜23 時の雲量。tz は UTC との時差（時間）
  function hourlyFor(series, date, tz) {
    const [y, m, d] = date.split("-").map(Number);
    const startUtcHour = Math.floor((Date.UTC(y, m - 1, d) - tz * 3600000) / 3600000);
    const byHour = new Map(series.map(s => [s.hour, s.v]));
    const lastHour = series[series.length - 1].hour;
    const out = [];
    for (let h = 0; h < 24; h++) {
      const t = startUtcHour + h;
      let v = byHour.get(t);
      if (v == null && t <= lastHour) { // 6時間ごとの区間では、直前の値を使う
        for (let back = 1; back <= 5 && v == null; back++) v = byHour.get(t - back);
      }
      out.push(v == null ? null : v);
    }
    return out;
  }

  async function fetchCloud(lat, lon, date, tz) {
    const series = await loadSeries(lat, lon);
    const cloud = hourlyFor(series, date, tz);
    if (cloud.filter(v => v != null).length < 4) {
      const [y, m, d] = date.split("-").map(Number);
      const past = Date.UTC(y, m - 1, d) - tz * 3600000 < series[0].hour * 3600000 - 86400000;
      throw new Error(past ? "過去の日付の雲量は取得できません" : "予報は約9日先までです");
    }
    return { cloud };
  }

  // 約9日先までの、日ごとの日中（6〜18時）の平均雲量(%)。{ "YYYY-MM-DD": 値 }
  async function fetchDailyCloud(lat, lon, tz) {
    const series = await loadSeries(lat, lon);
    const sums = {};
    series.forEach(s => {
      const local = new Date(s.hour * 3600000 + tz * 3600000); // UTC として読めば現地時刻
      const hr = local.getUTCHours();
      if (hr < 6 || hr > 18) return;
      const k = `${local.getUTCFullYear()}-${String(local.getUTCMonth() + 1).padStart(2, "0")}-${String(local.getUTCDate()).padStart(2, "0")}`;
      (sums[k] = sums[k] || []).push(s.v);
    });
    const out = {};
    Object.keys(sums).forEach(k => { if (sums[k].length >= 3) out[k] = sums[k].reduce((a, b) => a + b, 0) / sums[k].length; });
    return out;
  }

  // 区間 [s, e)（時）の平均雲量。データが無ければ null
  function average(cloud, s, e) {
    if (!cloud) return null;
    const from = Math.floor(s), to = Math.max(from + 1, Math.ceil(e));
    const v = cloud.slice(from, to).filter(x => x != null);
    return v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
  }

  return { fetchCloud, fetchDailyCloud, average };
})();
