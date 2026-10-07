(() => {
  "use strict";
  const $ = id => document.getElementById(id);
  const S = window.Sun;
  const { rad, deg, norm } = S;

  // ---------- 状態 ----------
  const iso = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  const state = {
    lat: 35.68123, lon: 139.76712, accuracy: null, located: false, // 初期値は東京駅付近
    rot: 180, w: 30, d: 20, ht: 20, face: 0,
    date: iso(new Date()), hour: 14, layer: "osm", tz: 9,
    cloud: null, cloudMsg: ""
  };

  // 共有できるよう、状態を URL のハッシュに保存する
  function loadHash() {
    const p = new URLSearchParams(location.hash.slice(1));
    const num = (k, lo, hi) => { const v = parseFloat(p.get(k)); return Number.isFinite(v) && v >= lo && v <= hi ? v : null; };
    const set = (k, key, lo, hi) => { const v = num(k, lo, hi); if (v !== null) state[key] = v; };
    set("lat", "lat", -85, 85); set("lon", "lon", -180, 180); set("r", "rot", 0, 360);
    set("w", "w", 6, 150); set("d", "d", 6, 150); set("ht", "ht", 3, 200); set("h", "hour", 0, 24);
    const f = num("f", 0, 3); if (f !== null) state.face = Math.round(f);
    if (/^\d{4}-\d{2}-\d{2}$/.test(p.get("t") || "")) state.date = p.get("t");
    if (p.get("l") === "gsi") state.layer = "gsi";
    if (p.has("lat") && p.has("lon")) state.located = true;
  }
  function saveHash() {
    const p = new URLSearchParams({
      lat: state.lat.toFixed(6), lon: state.lon.toFixed(6), r: Math.round(state.rot), w: Math.round(state.w), d: Math.round(state.d), ht: Math.round(state.ht),
      f: state.face, t: state.date, h: state.hour.toFixed(2), l: state.layer
    });
    history.replaceState(null, "", "#" + p.toString());
  }

  // ---------- 表示用ヘルパー ----------
  const COL = { f: "var(--front)", s: "var(--side)", b: "var(--back)", g: "var(--golden)", u: "var(--blue)" };
  const LABEL = { f: "順光", s: "斜光", g: "ゴールデンアワー", u: "ブルーアワー", b: "逆光・影" };
  const NOTE = {
    f: "面全体が均一に明るく、色が素直に出る", s: "凹凸の陰影が出て立体感が強まる",
    g: "暖色の低い光。壁面が色づく", u: "空の青と室内照明の明暗が映える"
  };
  const STAR = { f: "★★★", g: "★★★", s: "★★", u: "★★" };
  const COMPASS = ["北", "北東", "東", "南東", "南", "南西", "西", "北西"];
  const compass = b => COMPASS[Math.round(norm(b) / 45) % 8];
  const hhmm = h => { const m = Math.round(h * 60); return String(Math.floor(m / 60) % 24).padStart(2, "0") + ":" + String(m % 60).padStart(2, "0"); };
  const range = r => (r ? `${hhmm(r[0])}–${hhmm(r[1])}` : "—");
  const faceBearing = i => norm(state.rot + 90 * i);
  const d0 = b => Math.round(b) % 360; // 359.6° が「360°」と出ないように

  // 日本国内は +9、それ以外は経度からの推定（後で天気APIの値で上書きする）
  const estimateTz = (lat, lon) => (lat > 24 && lat < 46 && lon > 122 && lon < 146 ? 9 : Math.round(lon / 15));

  // ---------- 地図 ----------
  const map = L.map("map", { zoomControl: true, tap: false }).setView([state.lat, state.lon], 18);
  const layers = {
    osm: L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 19, attribution: "© OpenStreetMap" }),
    gsi: L.tileLayer("https://cyberjapandata.gsi.go.jp/xyz/seamlessphoto/{z}/{x}/{y}.jpg", { maxZoom: 19, maxNativeZoom: 18, attribution: "地理院タイル" })
  };
  function setLayer(name) {
    state.layer = name;
    Object.values(layers).forEach(l => map.removeLayer(l));
    layers[name].addTo(map);
    $("map").classList.toggle("dark", name === "osm");
    document.querySelectorAll(".layerbtns .chip").forEach(b => b.classList.toggle("on", b.dataset.layer === name));
  }

  const offset = (east, north) => [state.lat + north / 111320, state.lon + east / (111320 * Math.cos(rad(state.lat)))];
  // 面 i の外向き法線（東, 北）と、辺の両端・中点
  function faceGeom(i) {
    const th = rad(faceBearing(i));
    const n = [Math.sin(th), Math.cos(th)], p = [Math.cos(th), -Math.sin(th)];
    const half = (i % 2 === 0 ? state.w : state.d) / 2, dist = (i % 2 === 0 ? state.d : state.w) / 2;
    const c = [n[0] * dist, n[1] * dist];
    return {
      a: offset(c[0] - p[0] * half, c[1] - p[1] * half), b: offset(c[0] + p[0] * half, c[1] + p[1] * half), mid: offset(c[0], c[1])
    };
  }
  function cornerLatLngs() {
    const th = rad(state.rot), n = [Math.sin(th), Math.cos(th)], p = [Math.cos(th), -Math.sin(th)];
    const hw = state.w / 2, hd = state.d / 2;
    return [[-1, 1], [1, 1], [1, -1], [-1, -1]].map(([sx, sn]) =>
      offset(p[0] * hw * sx + n[0] * hd * sn, p[1] * hw * sx + n[1] * hd * sn));
  }
  // 画面上のピクセル距離で、中心から bearing 方向の座標を得る
  function pxPoint(bearing, px) {
    const c = map.latLngToContainerPoint([state.lat, state.lon]), th = rad(bearing);
    return map.containerPointToLatLng([c.x + Math.sin(th) * px, c.y - Math.cos(th) * px]);
  }
  function bearingFromCenter(latlng) {
    const c = map.latLngToContainerPoint([state.lat, state.lon]), q = map.latLngToContainerPoint(latlng);
    return norm(deg(Math.atan2(q.x - c.x, -(q.y - c.y))));
  }

  const FACE_COLOR = "#5d7fb8", FACE_SEL = "#e0883a";
  const poly = L.polygon([[0, 0], [0, 0], [0, 0]], { color: "#f0ebe3", weight: 1, fillColor: "#e0883a", fillOpacity: .18, interactive: false }).addTo(map);
  const edges = [0, 1, 2, 3].map(i =>
    L.polyline([[0, 0], [0, 0]], { color: FACE_COLOR, weight: 7, opacity: .95, lineCap: "round", bubblingMouseEvents: false })
      .on("click", () => { state.face = i; update(); }).addTo(map));
  const arrow = L.marker([0, 0], { interactive: false, keyboard: false }).addTo(map);
  const sunLine = L.polyline([[0, 0], [0, 0]], { color: "#f3c26b", weight: 2, dashArray: "4 6", opacity: .9, interactive: false }).addTo(map);
  const sunMark = L.marker([0, 0], { interactive: false, keyboard: false, zIndexOffset: 400 }).addTo(map);
  const center = L.marker([0, 0], { draggable: true, zIndexOffset: 800, icon: L.divIcon({ className: "", html: '<div class="pin"></div>', iconSize: [18, 18], iconAnchor: [9, 9] }) }).addTo(map);
  const handle = L.marker([0, 0], { draggable: true, zIndexOffset: 900, icon: L.divIcon({ className: "", html: '<div class="rhandle">⟳</div>', iconSize: [34, 34], iconAnchor: [17, 17] }) }).addTo(map);
  let dragging = null; // "center" | "handle" | null

  function drawMap() {
    poly.setLatLngs(cornerLatLngs());
    [0, 1, 2, 3].forEach(i => {
      const g = faceGeom(i);
      edges[i].setLatLngs([g.a, g.b]).setStyle(i === state.face ? { color: FACE_SEL, weight: 9 } : { color: FACE_COLOR, weight: 6 });
    });
    const g = faceGeom(state.face), b = faceBearing(state.face);
    arrow.setLatLng(g.mid).setIcon(L.divIcon({
      className: "", iconSize: [0, 0],
      html: `<div class="arrow" style="transform:rotate(${b}deg)"><svg width="24" height="52" viewBox="0 0 24 52"><path d="M12 0 L22 18 H15 V52 H9 V18 H2 Z" fill="#e0883a"/></svg></div>`
    }));
    if (dragging !== "center") center.setLatLng([state.lat, state.lon]);
    if (dragging !== "handle") handle.setLatLng(pxPoint(state.rot, 125));
    drawSun();
  }
  let sunDown = null;
  function drawSun() {
    const sun = S.position(S.localMs(state.date, state.hour, state.tz), state.lat, state.lon);
    const down = !(sun.alt > S.HORIZON), sp = pxPoint(sun.az, 150);
    sunMark.setLatLng(sp);
    if (down !== sunDown) {
      sunDown = down;
      sunMark.setIcon(L.divIcon({ className: "", iconSize: [26, 26], iconAnchor: [13, 13], html: `<div class="sunmark ${down ? "down" : ""}"></div>` }));
      sunLine.setStyle({ opacity: down ? .25 : .9 });
    }
    sunLine.setLatLngs([[state.lat, state.lon], sp]);
  }

  center.on("dragstart", () => { dragging = "center"; });
  center.on("drag", e => { state.lat = e.latlng.lat; state.lon = e.latlng.lng; drawMap(); });
  center.on("dragend", () => { dragging = null; state.accuracy = null; onLocationChanged(); });
  handle.on("dragstart", () => { dragging = "handle"; });
  handle.on("drag", e => { state.rot = bearingFromCenter(e.latlng); update(); });
  handle.on("dragend", () => { dragging = null; update(); });
  map.on("click", e => { state.lat = e.latlng.lat; state.lon = e.latlng.lng; state.accuracy = null; onLocationChanged(); });
  map.on("zoomend", drawMap);

  // ---------- 場所の変更（現在地・検索・地図タップ・ドラッグ） ----------
  // 現在地（GPS）なら端末のタイムゾーン、地図で指定した場所は経度からの推定（日本は+9）
  const browserTz = () => -new Date(state.date + "T12:00:00").getTimezoneOffset() / 60;
  function onLocationChanged() {
    state.tz = state.accuracy ? browserTz() : estimateTz(state.lat, state.lon);
    update();
  }
  function moveTo(lat, lon, zoom, accuracy) {
    state.lat = lat; state.lon = lon; state.accuracy = accuracy || null; state.located = true;
    map.setView([lat, lon], zoom || 18);
    $("locBox").open = false;
    onLocationChanged();
  }

  $("locBtn").addEventListener("click", () => {
    const btn = $("locBtn"), c = $("coord");
    if (!navigator.geolocation) { c.textContent = "この環境では位置情報を使えません。地図をタップして指定してください"; return; }
    btn.disabled = true; c.textContent = "現在地を取得中…";
    navigator.geolocation.getCurrentPosition(
      p => { btn.disabled = false; moveTo(p.coords.latitude, p.coords.longitude, 19, Math.round(p.coords.accuracy)); },
      e => { btn.disabled = false; update(); c.textContent = "現在地を取得できませんでした（" + e.message + "）。地図をタップして指定してください"; },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 10000 });
  });

  // ---------- 結果の描画 ----------
  function renderCoord() {
    const hint = state.accuracy ? `（精度 ±${state.accuracy}m）` : state.located ? "" : "（初期値：東京駅付近。現在地か地図で指定してください）";
    $("coord").innerHTML = `緯度 ${state.lat.toFixed(5)} / 経度 ${state.lon.toFixed(5)} <small>${hint} UTC${state.tz >= 0 ? "+" : ""}${state.tz}</small>`;
  }

  function renderFaces() {
    $("faces").innerHTML = [0, 1, 2, 3].map(i => {
      const b = faceBearing(i);
      return `<button class="face ${i === state.face ? "on" : ""}" data-i="${i}"><b>${compass(b)}</b><span>${d0(b)}°</span></button>`;
    }).join("");
  }

  const W = window.Weather;
  function cloudNote(w) {
    if (w.cloud == null) return "";
    const c = Math.round(w.cloud);
    if (w.k === "u") return `雲量 ${c}%`;
    return c >= 75 ? `雲量 ${c}%（曇りで光が拡散し、陰影は弱め）` : c >= 40 ? `雲量 ${c}%（雲の切れ間しだい）` : `雲量 ${c}%（直射が期待できる）`;
  }

  function renderCloud() {
    const el = $("cloud");
    el.hidden = !state.cloud;
    if (state.cloud) {
      el.innerHTML = state.cloud.map((v, h) => v == null
        ? `<span style="background:transparent;border:1px dashed var(--line)" title="${h}時 データなし"></span>`
        : `<span style="background:color-mix(in srgb, var(--sub) ${15 + v * 0.8}%, transparent)" title="${h}時 雲量 ${Math.round(v)}%"></span>`).join("");
    }
    $("cloudLabel").textContent = state.cloud ? "雲量（濃いほど曇り・点線はデータなし）" : state.cloudMsg;
  }

  let weatherKey = "", weatherTimer = null, weatherSeq = 0;
  function scheduleWeather() {
    const key = `${state.lat.toFixed(2)},${state.lon.toFixed(2)},${state.date},${state.tz}`;
    if (key === weatherKey) return;
    weatherKey = key; state.cloud = null; state.cloudMsg = "天気を取得中…";
    clearTimeout(weatherTimer);
    const seq = ++weatherSeq;
    weatherTimer = setTimeout(async () => {
      try {
        const r = await W.fetchCloud(state.lat, state.lon, state.date, state.tz);
        if (seq !== weatherSeq) return;
        state.cloud = r.cloud; state.cloudMsg = "";
      } catch (err) {
        if (seq !== weatherSeq) return;
        state.cloud = null; state.cloudMsg = "雲量を取得できません：" + err.message;
      }
      render();
    }, 350);
  }

  function renderResult() {
    const b = faceBearing(state.face);
    $("faceName").textContent = `${compass(b)}向きの面（${d0(b)}°）`;
    const prof = S.dayProfile(state.date, state.lat, state.lon, state.tz, b);
    const wins = S.windows(prof);
    const tl = $("tl"); tl.innerHTML = "";
    const day = prof.samples.filter(p => p.alt > S.HORIZON);
    if (day.length) {
      const i = document.createElement("i");
      i.style.cssText = `left:${day[0].h / 24 * 100}%;width:${(day[day.length - 1].h + prof.step - day[0].h) / 24 * 100}%;background:rgba(255,255,255,.10)`;
      tl.appendChild(i);
    }
    wins.forEach(w => {
      const i = document.createElement("i");
      i.style.left = (w.s / 24 * 100) + "%"; i.style.width = ((w.e - w.s) / 24 * 100) + "%"; i.style.background = COL[w.k];
      tl.appendChild(i);
    });

    wins.forEach(w => { w.cloud = W.average(state.cloud, w.s, w.e); });
    // 雲が多いと直射の陰影が弱まるので、順光・斜光は雲量で目減りさせて比較する
    const eff = w => (w.e - w.s) * (w.cloud == null || w.k === "u" ? 1 : 1 - 0.8 * w.cloud / 100);
    const longest = k => wins.filter(w => w.k === k && w.e - w.s >= 0.34).sort((a, c) => eff(c) - eff(a))[0];
    const best = longest("f") || longest("g") || longest("s") || longest("u");
    if (best) {
      $("bestTime").textContent = `${hhmm(best.s)}–${hhmm(best.e)}`;
      $("bestWhy").textContent = `${LABEL[best.k]}。${NOTE[best.k]}。${cloudNote(best)}`;
    } else {
      $("bestTime").textContent = "—";
      $("bestWhy").textContent = "この日は直射が当たりません。曇りの柔らかい光や、ブルーアワーの空との対比が狙い目です。";
    }
    const items = wins.filter(w => w.k !== "b" && w.e - w.s >= 0.34);
    $("list").innerHTML = items.length
      ? items.map(w => `<li><div>${LABEL[w.k]} ${hhmm(w.s)}–${hhmm(w.e)}<small>${NOTE[w.k]}${cloudNote(w) ? "。" + cloudNote(w) : ""}</small></div><div class="score">${STAR[w.k]}</div></li>`).join("")
      : "<li><div>該当する時間帯がありません</div></li>";
    return prof;
  }

  function renderTime() {
    const hr = state.hour;
    $("hour").value = Math.round(hr * 60); $("hourOut").textContent = hhmm(hr);
    $("now").style.left = `calc(${hr / 24 * 100}% - 1px)`;
    const sun = S.position(S.localMs(state.date, hr, state.tz), state.lat, state.lon);
    const k = S.classify(sun.alt, sun.az, faceBearing(state.face));
    const kind = k ? LABEL[k] : "夜";
    $("timeInfo").innerHTML = `太陽 高度 <b>${Math.round(sun.alt)}°</b>・方位 <b>${d0(sun.az)}°</b>（${compass(sun.az)}）→ この面は <b>${kind}</b>`;
  }

  function renderSun() {
    const e = S.events(state.date, state.lat, state.lon, state.tz);
    const one = h => (h == null ? "—" : hhmm(h));
    $("sun3").innerHTML = [
      [one(e.rise), "日の出"], [one(e.noon), `南中（高度 ${Math.round(e.noonAlt)}°）`], [one(e.set), "日の入り"],
      [range(e.goldenAM), "朝のゴールデンアワー"], [range(e.goldenPM), "夕のゴールデンアワー"],
      [range(e.blueAM), "朝のブルーアワー"], [range(e.bluePM), "夕のブルーアワー"]
    ].map(([a, b]) => `<div><b>${a}</b><span>${b}</span></div>`).join("");
  }

  function renderControls() {
    $("rot").value = Math.round(state.rot) % 360; $("rotOut").textContent = Math.round(state.rot) % 360 + "°";
    $("bw").value = state.w; $("bwOut").textContent = Math.round(state.w) + "m";
    $("bd").value = state.d; $("bdOut").textContent = Math.round(state.d) + "m";
    $("bh").value = state.ht; $("bhOut").textContent = Math.round(state.ht) + "m";
    $("date").value = state.date;
    const fb = faceBearing(state.face);
    $("bldSummary").textContent = `${compass(fb)}向きの面 ${d0(fb)}°・${Math.round(state.w)}×${Math.round(state.d)}×高${Math.round(state.ht)}m`;
    $("locSummary").textContent = `${state.lat.toFixed(4)}, ${state.lon.toFixed(4)}`;
  }

  function render() {
    renderControls(); renderCoord(); drawMap(); renderFaces(); renderResult(); renderCloud(); renderTime(); renderSide(); renderCurve(); renderSun(); saveHash();
  }
  function update() { scheduleWeather(); render(); }

  // ---------- 太陽の高さ：横から見た図と1日のグラフ ----------
  const svgNS = "http://www.w3.org/2000/svg";
  // 太陽方位に沿った方向の、建物の見かけの奥行き（m）
  function extentAlong(azDeg) {
    const u = [Math.sin(rad(azDeg)), Math.cos(rad(azDeg))], th = rad(state.rot);
    const n = [Math.sin(th), Math.cos(th)], t = [Math.cos(th), -Math.sin(th)];
    return state.w * Math.abs(u[0] * t[0] + u[1] * t[1]) + state.d * Math.abs(u[0] * n[0] + u[1] * n[1]);
  }

  function renderSide() {
    const sun = S.position(S.localMs(state.date, state.hour, state.tz), state.lat, state.lon);
    const b = faceBearing(state.face), diff = S.angleDiff(sun.az, b), up = sun.alt > S.HORIZON;
    const H = state.ht, GY = 200, CORNER_X = 96;
    const ext = extentAlong(sun.az);
    let html = `<rect width="480" height="230" fill="#15130f"/>`;
    if (!up) {
      html += `<rect x="0" y="${GY}" width="480" height="30" fill="#2a2823"/>
        <rect x="${CORNER_X}" y="${GY - Math.min(H, 90)}" width="${Math.max(40, Math.min(ext * 3, 200))}" height="${Math.min(H, 90)}" fill="#37332c" stroke="#5a554c"/>
        <text x="240" y="80" fill="#a39a8d" font-size="20" text-anchor="middle">太陽は地平線の下（${hhmm(state.hour)}）</text>`;
      $("side").innerHTML = html;
      $("sideNote").innerHTML = `太陽高度 <b>${Math.round(sun.alt)}°</b>。夜間のため直射はありません。`;
      return;
    }
    const tanA = Math.tan(rad(Math.max(sun.alt, 0.5)));
    const shadow = H / tanA, shadowC = Math.min(shadow, H * 2.5 + ext);
    const s = Math.min(330 / (ext + shadowC), 100 / H);
    const bw = Math.max(ext * s, 34), bh = H * s, x0 = CORNER_X, y0 = GY - bh;
    const lit = diff < 90; // 選択面が太陽側にあるか
    // 地面と影
    html += `<rect x="0" y="${GY}" width="480" height="30" fill="#2a2823"/>
      <polygon points="${x0 + bw},${GY} ${x0 + bw + shadowC * s},${GY} ${x0 + bw + shadowC * s * 0.98},${GY + 14} ${x0 + bw},${GY + 14}" fill="#000" opacity=".55"/>`;
    // 建物（左＝太陽側の壁、右＝日陰側の壁）
    const wallL = lit ? "#e8a33d" : "#4a463d", wallR = lit ? "#4a463d" : "#e8a33d";
    html += `<rect x="${x0}" y="${y0}" width="${bw}" height="${bh}" fill="#6b6558"/>
      <rect x="${x0}" y="${y0}" width="${bw}" height="${bh}" fill="#f3c26b" opacity=".18"/>
      <line x1="${x0}" y1="${y0}" x2="${x0}" y2="${GY}" stroke="${wallL}" stroke-width="7" ${lit ? "" : 'stroke-dasharray="6 5"'}/>
      <line x1="${x0 + bw}" y1="${y0}" x2="${x0 + bw}" y2="${GY}" stroke="${wallR}" stroke-width="7" ${lit ? 'stroke-dasharray="6 5"' : ""}/>`;
    // 太陽光線と高度角（屋根の太陽側の角から）
    const L = 66, ex = x0 - Math.cos(rad(sun.alt)) * L, ey = y0 - Math.sin(rad(sun.alt)) * L;
    html += `<line x1="${x0 - 70}" y1="${y0}" x2="${x0}" y2="${y0}" stroke="#a39a8d" stroke-dasharray="4 5"/>
      <line x1="${ex}" y1="${ey}" x2="${x0}" y2="${y0}" stroke="#f3c26b" stroke-width="3"/>
      <path d="M ${x0 - 32} ${y0} A 32 32 0 0 1 ${x0 - Math.cos(rad(sun.alt)) * 32} ${y0 - Math.sin(rad(sun.alt)) * 32}" fill="none" stroke="#f3c26b" stroke-width="2"/>
      <circle cx="${ex}" cy="${ey}" r="13" fill="#f3c26b" stroke="#e8a33d" stroke-width="3"/>
      <text x="${x0 - 38}" y="${y0 - 5}" fill="#f0ebe3" font-size="20" font-weight="700" text-anchor="end">${Math.round(sun.alt)}°</text>`;
    // 寸法
    html += `<line x1="${x0 + bw + 14}" y1="${y0}" x2="${x0 + bw + 14}" y2="${GY}" stroke="#a39a8d"/>
      <text x="${x0 + bw + 20}" y="${(y0 + GY) / 2 + 5}" fill="#c9c0b2" font-size="17">高さ ${Math.round(H)}m</text>
      <text x="${x0 + bw + (shadowC * s) / 2}" y="${GY + 22}" fill="#c9c0b2" font-size="15" text-anchor="middle">影 約${Math.round(shadow)}m${shadow > shadowC ? " →" : ""}</text>
      <text x="${x0 + bw / 2}" y="${GY + 22}" fill="#c9c0b2" font-size="15" text-anchor="middle">太陽方向 ${Math.round(ext)}m</text>`;
    $("side").innerHTML = html;
    const k = S.classify(sun.alt, sun.az, b);
    $("sideNote").innerHTML = `${hhmm(state.hour)} の太陽は高度 <b>${Math.round(sun.alt)}°</b>。建物の影は高さの約 <b>${(1 / tanA).toFixed(1)}倍</b>。`
      + `選択中の面は太陽に対して <b>${lit ? "光が当たる側" : "日陰の側"}</b>（角度差 ${Math.round(diff)}°${k ? "・" + LABEL[k] : ""}）。`
      + `<br><small>図は太陽の方向に沿った断面です。太陽は常に左、強調した壁が撮影面です。</small>`;
  }

  function renderCurve() {
    const X = h => 30 + h / 24 * 430, Ymin = -25, Ymax = 90, Y = a => 128 - (a - Ymin) / (Ymax - Ymin) * 110;
    let html = `<rect width="480" height="160" fill="#15130f"/>
      <rect x="30" y="${Y(S.GOLDEN)}" width="430" height="${Y(S.HORIZON) - Y(S.GOLDEN)}" fill="#f3c26b" opacity=".22"/>
      <rect x="30" y="${Y(S.HORIZON)}" width="430" height="${Y(S.BLUE) - Y(S.HORIZON)}" fill="#5d7fb8" opacity=".25"/>
      <line x1="30" y1="${Y(0)}" x2="460" y2="${Y(0)}" stroke="#a39a8d" stroke-width="1.5"/>`;
    [30, 60, 90].forEach(a => { html += `<line x1="30" y1="${Y(a)}" x2="460" y2="${Y(a)}" stroke="#38342d"/><text x="26" y="${Y(a) + 5}" fill="#a39a8d" font-size="13" text-anchor="end">${a}°</text>`; });
    html += `<text x="26" y="${Y(0) + 5}" fill="#a39a8d" font-size="13" text-anchor="end">0°</text>`;
    [0, 6, 12, 18, 24].forEach(h => { html += `<text x="${X(h)}" y="156" fill="#a39a8d" font-size="13" text-anchor="middle">${h}</text>`; });
    const pts = []; let peak = { alt: -99, h: 0 };
    for (let m = 0; m <= 1440; m += 10) {
      const h = m / 60, a = S.position(S.localMs(state.date, h, state.tz), state.lat, state.lon).alt;
      pts.push(`${X(h).toFixed(1)},${Y(a).toFixed(1)}`);
      if (a > peak.alt) peak = { alt: a, h };
    }
    html += `<polyline points="${pts.join(" ")}" fill="none" stroke="#f3c26b" stroke-width="3" stroke-linejoin="round"/>`;
    if (peak.alt > 0) html += `<text x="${X(peak.h)}" y="${Y(peak.alt) - 8}" fill="#f0ebe3" font-size="14" text-anchor="middle">南中 ${Math.round(peak.alt)}°</text>`;
    const cur = S.position(S.localMs(state.date, state.hour, state.tz), state.lat, state.lon).alt;
    html += `<line id="curveLine" x1="0" y1="10" x2="0" y2="132" stroke="#fff" stroke-width="2"/>
      <circle id="curveDot" cx="0" cy="0" r="6" fill="#fff" stroke="#e0883a" stroke-width="3"/>`;
    $("curve").innerHTML = html;
    curveXY = { X, Y };
    moveCurveMarker();
  }
  let curveXY = null;
  function moveCurveMarker() {
    const line = $("curveLine"), dot = $("curveDot");
    if (!curveXY || !line || !dot) return;
    const a = S.position(S.localMs(state.date, state.hour, state.tz), state.lat, state.lon).alt;
    const x = curveXY.X(state.hour);
    line.setAttribute("x1", x); line.setAttribute("x2", x);
    dot.setAttribute("cx", x); dot.setAttribute("cy", curveXY.Y(a));
  }

  // ---------- ベスト日探し ----------
  const WEEK = ["日", "月", "火", "水", "木", "金", "土"];
  const dur = m => (m >= 60 ? `${Math.floor(m / 60)}時間${Math.round(m % 60)}分` : `${Math.round(m)}分`);
  async function findBestDays() {
    const btn = $("findBtn"), ul = $("days"), note = $("daysNote");
    btn.disabled = true; ul.innerHTML = ""; note.textContent = "計算中…";
    await new Promise(r => setTimeout(r, 30)); // ボタンの無効化を先に描画させる
    const span = +$("spanSel").value, b = faceBearing(state.face);
    let daily = {};
    try { daily = await W.fetchDailyCloud(state.lat, state.lon, state.tz); } catch (e) { /* 雲量なしで続行 */ }
    const rows = [], start = new Date(); start.setHours(12, 0, 0, 0);
    for (let i = 0; i < span; i++) {
      const dt = new Date(start); dt.setDate(start.getDate() + i);
      const date = iso(dt), sc = S.dayScore(S.dayProfile(date, state.lat, state.lon, state.tz, b, 10));
      const cloud = daily[date] == null ? null : daily[date];
      rows.push({ date, dt, sc, cloud, total: sc.score * (cloud == null ? 1 : 1 - 0.6 * cloud / 100) });
    }
    const li = (r, i) => `<li><button data-date="${r.date}">
      <span class="rank">${i + 1}</span>
      <span style="flex:1">${r.dt.getMonth() + 1}/${r.dt.getDate()}（${WEEK[r.dt.getDay()]}）
        <small>順光 ${dur(r.sc.f)}・ゴールデン ${dur(r.sc.g)}・斜光 ${dur(r.sc.s)}${r.cloud == null ? "" : "・雲量予報 " + Math.round(r.cloud) + "%"}</small></span>
      <span class="go">この日にする ›</span></button></li>`;
    const head = t => `<li class="dhead">${t}</li>`;
    // 雲量予報がある日（約16日以内）と無い日を同じ順位で比べると不公平なので、分けて並べる
    const near = rows.filter(r => r.cloud != null && r.sc.score > 0).sort((x, y) => y.total - x.total).slice(0, 3);
    const all = rows.slice().sort((x, y) => y.sc.score - x.sc.score).filter(r => r.sc.score > 0).slice(0, 5);
    ul.innerHTML = (near.length ? head("近日のおすすめ（雲量予報込み）") + near.map(li).join("") : "")
      + (all.length ? head(near.length ? "期間内で太陽条件がよい日（雲量は考慮なし）" : "期間内で太陽条件がよい日") + all.map(li).join("") : "");
    note.textContent = all.length
      ? "順光の長さを主に、ゴールデンアワー・斜光を加点しています。雲量予報は約9日先まで。"
      : "この面は期間内に直射が当たりません。別の面を選ぶか、期間を延ばしてください。";
    btn.disabled = false;
  }
  $("findBtn").addEventListener("click", findBestDays);
  $("days").addEventListener("click", e => {
    const b = e.target.closest("button"); if (!b) return;
    state.date = b.dataset.date; update();
    $("faceName").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  // ---------- 操作 ----------
  $("rot").addEventListener("input", e => { state.rot = +e.target.value; update(); });
  $("m15").addEventListener("click", () => { state.rot = norm(state.rot - 15); update(); });
  $("p15").addEventListener("click", () => { state.rot = norm(state.rot + 15); update(); });
  $("bw").addEventListener("input", e => { state.w = +e.target.value; update(); });
  $("bd").addEventListener("input", e => { state.d = +e.target.value; update(); });
  $("bh").addEventListener("input", e => { state.ht = +e.target.value; update(); });
  $("faces").addEventListener("click", e => { const b = e.target.closest(".face"); if (b) { state.face = +b.dataset.i; update(); } });
  $("date").addEventListener("change", e => { if (e.target.value) { state.date = e.target.value; update(); } });
  $("today").addEventListener("click", () => { state.date = iso(new Date()); update(); });
  $("weekend").addEventListener("click", () => {
    const d = new Date(); d.setDate(d.getDate() + ((6 - d.getDay() + 7) % 7 || 7)); state.date = iso(d); update();
  });
  // 時刻だけが変わる操作は、重い再描画を避けて必要な部分だけ更新する（なめらかにドラッグするため）
  let hashTimer = null, rafId = 0;
  function renderTimeOnly() {
    rafId = 0;
    renderTime(); drawSun(); renderSide(); moveCurveMarker();
    clearTimeout(hashTimer); hashTimer = setTimeout(saveHash, 200);
  }
  function setHour(h) {
    state.hour = Math.max(0, Math.min(23.99, h));
    if (!rafId) rafId = requestAnimationFrame(renderTimeOnly);
  }
  // 要素の上を指でなぞって時刻を変える（タップでも反応。縦スクロールは妨げない）
  function scrub(el, toHour) {
    let active = false;
    el.addEventListener("pointerdown", e => { active = true; el.setPointerCapture(e.pointerId); setHour(toHour(e)); });
    el.addEventListener("pointermove", e => { if (active) setHour(toHour(e)); });
    const end = () => { active = false; };
    el.addEventListener("pointerup", end); el.addEventListener("pointercancel", end);
  }
  scrub($("tl"), e => { const r = $("tl").getBoundingClientRect(); return (e.clientX - r.left) / r.width * 24; });
  scrub($("curve"), e => { const r = $("curve").getBoundingClientRect(); return ((e.clientX - r.left) / r.width * 480 - 30) / 430 * 24; });
  $("hour").addEventListener("input", e => setHour(+e.target.value / 60));
  document.querySelectorAll(".layerbtns .chip").forEach(b => b.addEventListener("click", () => { setLayer(b.dataset.layer); saveHash(); }));

  // ---------- 起動 ----------
  loadHash();
  $("locBox").open = !state.located; // 場所が未指定のときだけ最初から開いておく
  state.tz = estimateTz(state.lat, state.lon);
  map.setView([state.lat, state.lon], 18);
  setLayer(state.layer);
  update();

  if ("serviceWorker" in navigator && (location.protocol === "https:" || location.hostname === "localhost")) {
    navigator.serviceWorker.register("sw.js").catch(() => { /* 登録できなくても通常動作 */ });
  }
})();
