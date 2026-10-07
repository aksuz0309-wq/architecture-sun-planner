// 実行: node tests/sun.test.js
const assert = require("assert");
const Sun = require("../js/sun.js");

const near = (actual, expected, tol, label) =>
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} (期待 ${expected} ±${tol})`);
const hm = (h, m) => h + m / 60;

// 東京駅付近・2026-10-24（日の出5:56 / 日の入り16:55 前後、南中高度 約43°）
const T = { lat: 35.68123, lon: 139.76712, tz: 9, date: "2026-10-24" };
const ev = Sun.events(T.date, T.lat, T.lon, T.tz);
near(ev.rise, hm(5, 57), 4 / 60, "東京 日の出");
near(ev.set, hm(16, 55), 4 / 60, "東京 日の入り");
near(ev.noonAlt, 43, 1, "東京 南中高度");

// 南中時の方位は真南、正午の影は北向き
const noon = Sun.position(Sun.localMs(T.date, ev.noon, T.tz), T.lat, T.lon);
near(noon.az, 180, 3, "南中時の方位");

// 春分の日の赤道・経度0 の正午（UTC）は、ほぼ真上
near(Sun.position(Date.UTC(2026, 2, 20, 12, 0), 0, 0).alt, 89, 2, "春分 赤道正午");

// 朝は東、夕は西
const am = Sun.position(Sun.localMs(T.date, 8, T.tz), T.lat, T.lon);
const pm = Sun.position(Sun.localMs(T.date, 15, T.tz), T.lat, T.lon);
assert.ok(am.az > 90 && am.az < 150, `朝8時は南東寄り: ${am.az}`);
assert.ok(pm.az > 210 && pm.az < 270, `午後3時は南西寄り: ${pm.az}`);

// 分類：南向きの面は昼に順光、北向きの面は直射なし
const south = Sun.windows(Sun.dayProfile(T.date, T.lat, T.lon, T.tz, 180));
assert.ok(south.some(w => w.k === "f" && w.e - w.s > 2), "南面は2時間以上の順光がある");
const north = Sun.windows(Sun.dayProfile(T.date, T.lat, T.lon, T.tz, 0));
assert.ok(!north.some(w => w.k === "f"), "北面（10月・東京）に順光はない");
const west = Sun.windows(Sun.dayProfile(T.date, T.lat, T.lon, T.tz, 270));
assert.ok(west.some(w => w.k === "g"), "西面は夕方にゴールデンアワーがある");

// 夏至の東京の北面は、早朝と夕方にだけ光が回る
const summerNorth = Sun.windows(Sun.dayProfile("2026-06-21", T.lat, T.lon, T.tz, 0));
assert.ok(summerNorth.some(w => w.k === "s" || w.k === "g"), "夏至の北面は朝夕に光が当たる");

// ベスト日スコア：南面は冬の方が順光が長い（太陽が低い）
const winter = Sun.dayScore(Sun.dayProfile("2026-12-21", T.lat, T.lon, T.tz, 180));
const summer = Sun.dayScore(Sun.dayProfile("2026-06-21", T.lat, T.lon, T.tz, 180));
assert.ok(winter.f > summer.f, `南面の順光は冬(${winter.f}分) > 夏(${summer.f}分)`);

// 時差が小数のタイムゾーン（インド）でも日の出が現地の朝に出る
const delhi = Sun.events("2026-10-24", 28.6139, 77.209, 5.5);
assert.ok(delhi.rise > 5.5 && delhi.rise < 7, `デリーの日の出: ${delhi.rise}`);

console.log("OK: 太陽計算のテストがすべて通りました");
