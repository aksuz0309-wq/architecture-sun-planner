// 太陽位置と、建物の面に当たる光の分類（ブラウザ／Node 両用）
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.Sun = factory();
})(typeof self !== "undefined" ? self : this, function () {
  const rad = d => d * Math.PI / 180;
  const deg = r => r * 180 / Math.PI;
  const norm = a => ((a % 360) + 360) % 360;
  const angleDiff = (a, b) => Math.abs(norm(a - b + 180) - 180);

  const HORIZON = -0.833; // 日の出・日の入り（大気差と太陽半径を含む）
  const GOLDEN = 6;       // ゴールデンアワーの上限高度
  const BLUE = -6;        // ブルーアワーの下限高度

  // 太陽位置。方位は北=0°から時計回り、高度は水平線=0°
  function position(ms, lat, lon) {
    const d = ms / 86400000 + 2440587.5 - 2451545.0;
    const L = norm(280.460 + 0.9856474 * d);
    const g = rad(norm(357.528 + 0.9856003 * d));
    const lam = rad(L + 1.915 * Math.sin(g) + 0.020 * Math.sin(2 * g));
    const eps = rad(23.439 - 0.0000004 * d);
    const ra = Math.atan2(Math.cos(eps) * Math.sin(lam), Math.cos(lam));
    const dec = Math.asin(Math.sin(eps) * Math.sin(lam));
    const H = rad(norm(280.46061837 + 360.98564736629 * d + lon)) - ra;
    const phi = rad(lat);
    const alt = Math.asin(Math.sin(phi) * Math.sin(dec) + Math.cos(phi) * Math.cos(dec) * Math.cos(H));
    const az = Math.atan2(Math.sin(H), Math.cos(H) * Math.sin(phi) - Math.tan(dec) * Math.cos(phi));
    return { alt: deg(alt), az: norm(deg(az) + 180) };
  }

  // 現地日付(YYYY-MM-DD)・現地時刻(時, 小数可)・UTCとの時差(時間) → エポックms
  function localMs(dateStr, hour, tz) {
    const [y, m, d] = dateStr.split("-").map(Number);
    return Date.UTC(y, m - 1, d, 0, 0) + (hour - tz) * 3600000;
  }

  // 光の種類: f=順光 s=斜光 g=ゴールデン u=ブルー b=逆光・影 null=夜
  function classify(alt, az, faceBearing) {
    if (alt <= HORIZON) return alt > BLUE ? "u" : null;
    const diff = angleDiff(az, faceBearing);
    if (diff >= 90) return "b";
    if (alt <= GOLDEN) return "g";
    if (diff < 35) return "f";
    if (diff < 75) return "s";
    return "b";
  }

  function dayProfile(dateStr, lat, lon, tz, faceBearing, stepMin) {
    stepMin = stepMin || 5;
    const samples = [];
    for (let m = 0; m < 1440; m += stepMin) {
      const h = m / 60;
      const p = position(localMs(dateStr, h, tz), lat, lon);
      samples.push({ h, alt: p.alt, az: p.az, k: classify(p.alt, p.az, faceBearing) });
    }
    return { samples, step: stepMin / 60 };
  }

  // 同じ種類が続く区間にまとめる（夜は除く）
  function windows(profile) {
    const out = []; let cur = null;
    profile.samples.forEach(p => {
      if (cur && cur.k === p.k) cur.e = p.h + profile.step;
      else { cur = { k: p.k, s: p.h, e: p.h + profile.step }; out.push(cur); }
    });
    return out.filter(w => w.k);
  }

  // 日の出・日の入り・南中・朝夕のゴールデン／ブルーアワー（1分刻み）
  function events(dateStr, lat, lon, tz) {
    const alts = [];
    for (let m = 0; m < 1440; m++) alts.push(position(localMs(dateStr, m / 60, tz), lat, lon).alt);
    const cross = level => {
      const c = [];
      for (let i = 1; i < 1440; i++) {
        if ((alts[i - 1] < level) !== (alts[i] < level)) c.push({ m: i, up: alts[i] >= level });
      }
      return c;
    };
    const first = (c, up) => { const x = c.find(v => v.up === up); return x ? x.m / 60 : null; };
    const last = (c, up) => { const x = c.slice().reverse().find(v => v.up === up); return x ? x.m / 60 : null; };
    let noon = 0;
    alts.forEach((a, i) => { if (a > alts[noon]) noon = i; });
    const hz = cross(HORIZON), g6 = cross(GOLDEN), b6 = cross(BLUE);
    const rise = first(hz, true), set = last(hz, false);
    const rng = (a, b) => (a == null || b == null ? null : [a, b]);
    return {
      rise, set, noon: noon / 60, noonAlt: alts[noon],
      goldenAM: rng(rise, first(g6, true)), goldenPM: rng(last(g6, false), set),
      blueAM: rng(first(b6, true), rise), bluePM: rng(set, last(b6, false))
    };
  }

  // ベスト日探し用の点数（順光を主、ゴールデン・斜光を加点）
  function dayScore(profile) {
    const mins = { f: 0, s: 0, g: 0 };
    profile.samples.forEach(p => { if (mins[p.k] !== undefined) mins[p.k] += profile.step * 60; });
    return { score: mins.f + 0.8 * mins.g + 0.3 * mins.s, f: mins.f, s: mins.s, g: mins.g };
  }

  return { rad, deg, norm, angleDiff, position, localMs, classify, dayProfile, windows, events, dayScore, HORIZON, GOLDEN, BLUE };
});
