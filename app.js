/**
 * ĂN GÌ ĐÂY? v3.1 - Mobile-first
 * 3D tô mì bốc khói • Vuốt chọn món • Thực đơn tuần • Lắc để chọn • Trending
 * MỚI: Giờ/vị trí/thời tiết • Gợi ý đi ăn hay đặt về • Đặt đồ ShopeeFood/GrabFood/beFood • Món hợp thời tiết
 */
(function () {
  'use strict';

  /* ============================ 1. CẤU HÌNH ============================ */
  const CONFIG = {
    APP_NAME: "Ăn Gì Đây?",
    API_URL: "https://script.google.com/macros/s/AKfycbxoKW24CyLJCYxNpy-fL6-WvsJTYbDjZRbYW0DHGnKNlHKoaLfMBKjQvi0Oa3SZS_9A/exec",
    KEYS: {
      FAV: "agd_favorites_v4", HIST: "agd_history_v4", BLOCK: "agd_blocked_v4", FILTERS: "agd_filters_v4",
      SETTINGS: "agd_settings_v4", PLAN: "agd_plan_v4", CACHE: "agd_foods_cache_v4",
      LOC: "agd_location_v1", WX: "agd_weather_v1"
    },
    HISTORY_MAX: 60,
    REQUEST_TIMEOUT_MS: 16000,
    CACHE_MAX_AGE_MS: 10 * 60 * 1000,
    EXPLORE_PAGE: 30,
    RECENT_EXCLUDE: 5,
    // Vị trí mặc định khi người dùng chưa cho phép định vị
    DEFAULT_LOC: { lat: 21.0285, lon: 105.8542, name: "Hà Nội" },
    LOC_MAX_AGE_MS: 6 * 60 * 60 * 1000,
    WX_MAX_AGE_MS: 15 * 60 * 1000,
    // Các app đặt đồ. {q} = tên món đã encode. Sửa link ở đây nếu app đổi đường dẫn.
    ORDER_APPS: [
      { id: "shopee", name: "ShopeeFood", color: "#ee4d2d", fg: "#fff", url: "https://shopeefood.vn/search?q={q}" },
      { id: "grab", name: "GrabFood", color: "#00b14f", fg: "#fff", url: "https://food.grab.com/vn/vi/restaurants?search={q}" },
      { id: "be", name: "beFood", color: "#fed600", fg: "#2b2b2b", url: "https://food.be.com.vn/search?q={q}" }
    ]
  };

  const BUDGETS = [
    ["all", "Mọi mức giá"], ["max:35000", "Dưới 35k"], ["max:50000", "Dưới 50k"],
    ["max:100000", "Dưới 100k"], ["max:200000", "Dưới 200k"], ["min:100000", "Từ 100k (chiêu đãi)"]
  ];
  const SORTS = [
    ["default", "Mặc định"], ["price-asc", "Giá thấp → cao"], ["price-desc", "Giá cao → thấp"],
    ["venues", "Nhiều quán nhất"], ["name", "Tên A → Z"]
  ];
  const MEALS = [
    { k: "sang", label: "Sáng", icon: "🌅", kw: ["sang"] },
    { k: "trua", label: "Trưa", icon: "☀️", kw: ["trua"] },
    { k: "toi", label: "Tối", icon: "🌙", kw: ["toi"] }
  ];
  const DAYS = ["Thứ 2", "Thứ 3", "Thứ 4", "Thứ 5", "Thứ 6", "Thứ 7", "Chủ nhật"];

  /* ============================== 2. STATE ============================== */
  const state = {
    foods: [], byId: new Map(), meta: { groups: [], purposes: [], districts: [] },
    favorites: [], history: [], blocked: [], trending: [],
    filters: { purpose: "all", group: "all", district: "all", budget: "all", sort: "default", excludeRecent: true },
    keyword: "", exploreLimit: CONFIG.EXPLORE_PAGE,
    settings: { theme: "dark", haptics: true, shake: true, favBoost: true, weatherBoost: true },
    plan: { week: "", slots: {} },
    view: "home", meTab: "fav", current: null, venues: [], busy: false
  };

  const $ = (id) => document.getElementById(id);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const icons = () => { try { window.lucide && lucide.createIcons(); } catch (e) {} };
  const isFav = (id) => state.favorites.some(f => f.id === id);
  const isBlocked = (id) => state.blocked.some(f => f.id === id);

  /* ============================== 3. UTILS ============================== */
  const EMOJI_RULES = [
    [/banh mi/, "🥖"], [/cafe|ca phe/, "☕"], [/tra sua|tran chau|sinh to|nuoc ep|\btra\b/, "🧋"],
    [/lau|hotpot|nhung/, "🍲"], [/pho|bun|mien|hu tieu|banh canh|cao lau|my quang|\bmi\b|nui|mi goi/, "🍜"],
    [/xoi/, "🍙"], [/com|chao/, "🍚"], [/pizza/, "🍕"], [/burger|hamburger/, "🍔"], [/sushi|nhat|han quoc|japan|korea/, "🍣"],
    [/hai san|tom|cua|\boc\b|ngheu|so diep/, "🦐"], [/\bca\b/, "🐟"], [/\bga\b|vit|ga ran/, "🍗"],
    [/nuong|bbq|suon|thit|bo\b/, "🍖"], [/che|kem|sua chua|trang mieng/, "🍧"],
    [/salad|rau|chay|healthy/, "🥗"], [/an vat|xien|snack|bap|banh trang/, "🍢"],
    [/banh|goi cuon|nem|cha gio|bao/, "🥟"]
  ];

  const U = {
    esc(s) {
      if (s === null || s === undefined) return "";
      return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#039;");
    },
    norm(s) {
      if (!s) return "";
      return String(s).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/đ/g, "d").trim();
    },
    isUrl(s) {
      if (!s || typeof s !== "string") return false;
      try { const u = new URL(s); return u.protocol === "http:" || u.protocol === "https:"; } catch (_) { return false; }
    },
    shuffle(arr) {
      const a = arr.slice();
      for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
      return a;
    },
    hash(s) { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return Math.abs(h); },
    hue(food) { return U.hash(U.norm(food.group || food.name || "")) % 360; },
    grad(food) { const h = U.hue(food); return `linear-gradient(135deg,hsl(${h},85%,60%),hsl(${(h + 48) % 360},85%,50%))`; },
    emoji(food) {
      const s = U.norm((food.name || "") + " " + (food.group || ""));
      for (const [re, e] of EMOJI_RULES) if (re.test(s)) return e;
      return "🍽️";
    },
    money(v) {
      if (v === null || v === undefined || isNaN(v)) return "";
      if (v < 1000) return v + "đ";
      const k = v / 1000;
      return (Number.isInteger(k) ? k : k.toFixed(1).replace(".", ",")) + "k";
    },
    priceText(min, max, fallback = "Bình dân") {
      const hasMin = min !== null && min !== undefined, hasMax = max !== null && max !== undefined;
      if (!hasMin && !hasMax) return fallback;
      if (hasMin && hasMax) return min === max ? U.money(min) : `${U.money(min)} – ${U.money(max)}`;
      return hasMin ? "từ " + U.money(min) : "≤ " + U.money(max);
    },
    dateKey(d = new Date()) {
      const p = (n) => String(n).padStart(2, "0");
      return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
    },
    monday(d = new Date()) {
      const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
      x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
      return x;
    },
    buzz(p) { if (state.settings.haptics && navigator.vibrate) { try { navigator.vibrate(p); } catch (e) {} } },
    async getJson(url, ms = 8000) {
      const ctl = new AbortController();
      const t = setTimeout(() => ctl.abort(), ms);
      try {
        const r = await fetch(url, { signal: ctl.signal });
        if (!r.ok) throw new Error("HTTP " + r.status);
        return await r.json();
      } finally { clearTimeout(t); }
    }
  };

  function timeInfo() {
    const h = new Date().getHours();
    if (h >= 5 && h < 10) return { label: "Bữa sáng", icon: "🌅", kw: ["sang"], hello: "Chào buổi sáng ☀️" };
    if (h >= 10 && h < 14) return { label: "Bữa trưa", icon: "☀️", kw: ["trua"], hello: "Chào buổi trưa 😋" };
    if (h >= 14 && h < 17) return { label: "Xế chiều", icon: "🧋", kw: ["vat", "xe", "chieu"], hello: "Chiều rồi, đói chưa? 🧋" };
    if (h >= 17 && h < 22) return { label: "Bữa tối", icon: "🌙", kw: ["toi"], hello: "Chào buổi tối 🌙" };
    return { label: "Ăn đêm", icon: "🌃", kw: ["dem"], hello: "Khuya rồi, ăn nhẹ nhé 🌃" };
  }
  function findPurposeFor(t) { return state.meta.purposes.find(p => t.kw.some(k => U.norm(p).includes(k))) || null; }

  /* ============================= 4. STORAGE ============================= */
  const Store = {
    get(key, fallback) { try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; } catch (e) { return fallback; } },
    set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { console.warn("Storage error", e); } }
  };

  /* ============================== 5. API ============================== */
  const Api = {
    jsonp(params = {}) {
      return new Promise((resolve, reject) => {
        const cb = "agd_cb_" + Math.random().toString(36).slice(2, 9) + "_" + Date.now();
        const q = Object.assign({}, params, { callback: cb });
        const query = Object.keys(q).map(k => encodeURIComponent(k) + "=" + encodeURIComponent(q[k])).join("&");
        const script = document.createElement("script");
        script.src = CONFIG.API_URL + (CONFIG.API_URL.indexOf("?") === -1 ? "?" : "&") + query;
        script.async = true;
        const cleanup = () => { try { delete window[cb]; } catch (e) { window[cb] = undefined; } if (script.parentNode) script.parentNode.removeChild(script); };
        const timer = setTimeout(() => { cleanup(); reject(new Error("Máy chủ phản hồi quá lâu, thử lại nhé!")); }, CONFIG.REQUEST_TIMEOUT_MS);
        window[cb] = (data) => {
          clearTimeout(timer); cleanup();
          if (data && data.success) resolve(data); else reject(new Error(data && data.error ? data.error : "Không thể lấy dữ liệu"));
        };
        script.onerror = () => { clearTimeout(timer); cleanup(); reject(new Error("Lỗi mạng khi kết nối máy chủ")); };
        document.head.appendChild(script);
      });
    },
    async fetchAll(force) {
      let page = 1, totalPages = 1, all = [];
      do {
        const res = await this.jsonp({ action: "getFoods", page, limit: 150, refresh: force && page === 1 ? "true" : "false" });
        all = all.concat(res.data || []);
        totalPages = (res.meta && res.meta.pagination && res.meta.pagination.totalPages) || 1;
        page++;
      } while (page <= totalPages && page <= 10);
      return all;
    },
    getTrending() { return this.jsonp({ action: "getTrending" }); },
    track(id, type) { this.jsonp({ action: "track", id, type }).catch(() => {}); }
  };

  /* ====================== 6. TOAST + CONFETTI + SHEET ====================== */
  function toast(msg, type = "info") {
    const c = $("toast-container"); if (!c) return;
    const t = document.createElement("div");
    t.className = "toast " + type;
    t.innerHTML = `<span>${type === "success" ? "✅" : type === "error" ? "⚠️" : "💡"}</span><span>${U.esc(msg)}</span>`;
    c.appendChild(t);
    while (c.children.length > 3) c.firstChild.remove();
    setTimeout(() => { t.classList.add("out"); setTimeout(() => t.remove(), 300); }, 2600);
  }

  function celebrate(emoji) {
    if (typeof confetti !== "function" || window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    const base = { spread: 85, origin: { y: 0.7 }, ticks: 170, zIndex: 300 };
    try {
      if (confetti.shapeFromText) {
        const shape = confetti.shapeFromText({ text: emoji, scalar: 2 });
        confetti(Object.assign({}, base, { shapes: [shape], scalar: 2, particleCount: 26 }));
      }
    } catch (e) {}
    confetti(Object.assign({}, base, { particleCount: 60, colors: ["#ff6b3d", "#ff4d8d", "#ffb347", "#34d399", "#8b5cf6"] }));
  }

  const Sheet = {
    open: false, pushed: false, mode: null,
    show(title, html, mode) {
      $("sheet-title").textContent = title;
      $("sheet-body").innerHTML = html;
      this.mode = mode;
      if (!this.open) {
        this.open = true;
        $("sheet").classList.add("open");
        $("sheet").setAttribute("aria-hidden", "false");
        document.body.classList.add("no-scroll");
        try { history.pushState({ agdSheet: 1 }, ""); this.pushed = true; } catch (e) {}
      }
      $("sheet-body").scrollTop = 0;
      icons();
    },
    close(fromPop) {
      if (!this.open) return;
      this.open = false;
      $("sheet").classList.remove("open");
      $("sheet").setAttribute("aria-hidden", "true");
      document.body.classList.remove("no-scroll");
      if (this.pushed) {
        this.pushed = false;
        if (!fromPop) { try { history.back(); } catch (e) {} }
      }
    }
  };
  window.addEventListener("popstate", () => { if (Sheet.open) { Sheet.pushed = false; Sheet.close(true); } });

  /* ============ 6b. NGỮ CẢNH: GIỜ • VỊ TRÍ • THỜI TIẾT • GỢI Ý ĂN/ĐẶT ============ */
  const WARM_RE = /lau|pho|bun|chao|hu tieu|banh canh|mi\b|nuong|sup|nhung|xoi|cao lau|my quang|mien/;
  const COOL_RE = /che|kem|tra|sinh to|nuoc|sua chua|salad|goi cuon|bun cha|bun dau|banh mi|an vat/;
  const normCache = new Map();
  const foodNorm = (f) => { let s = normCache.get(f.id); if (s === undefined) { s = U.norm(`${f.name} ${f.group}`); normCache.set(f.id, s); } return s; };

  function wxInfo(code, isDay) {
    if (code === 0) return { icon: isDay ? "☀️" : "🌙", text: isDay ? "Trời nắng" : "Trời quang", rain: false };
    if (code === 1 || code === 2) return { icon: isDay ? "🌤️" : "☁️", text: "Ít mây", rain: false };
    if (code === 3) return { icon: "☁️", text: "Nhiều mây", rain: false };
    if (code === 45 || code === 48) return { icon: "🌫️", text: "Sương mù", rain: false };
    if (code >= 51 && code <= 57) return { icon: "🌦️", text: "Mưa phùn", rain: true };
    if (code >= 61 && code <= 67) return { icon: "🌧️", text: "Trời mưa", rain: true };
    if (code >= 71 && code <= 77) return { icon: "❄️", text: "Có tuyết", rain: true };
    if (code >= 80 && code <= 82) return { icon: "🌧️", text: "Mưa rào", rain: true };
    if (code >= 95) return { icon: "⛈️", text: "Có dông", rain: true };
    return { icon: "🌡️", text: "Thời tiết", rain: false };
  }

  const Ctx = {
    loc: Object.assign({ def: true }, CONFIG.DEFAULT_LOC),
    wx: null, aqi: null, rainSoon: 0, advice: null, hour: -1, loading: false,

    async init() {
      const c = Store.get(CONFIG.KEYS.LOC, null);
      if (c && c.lat && Date.now() - c.ts < CONFIG.LOC_MAX_AGE_MS) this.loc = Object.assign({}, c, { def: false });
      this.hour = new Date().getHours();
      this.computeAdvice();
      this.render();
      setInterval(() => this.tick(), 20000);

      // Nếu đã từng cho phép → tự định vị im lặng. Nếu chưa → hiện nút để người dùng chủ động bấm.
      let granted = false;
      try {
        if (navigator.permissions && navigator.permissions.query) {
          const p = await navigator.permissions.query({ name: "geolocation" });
          granted = p.state === "granted";
        }
      } catch (e) {}
      if (granted) await this.locate(true); else await this.refreshWeather();
    },

    tick() {
      this.renderClock();
      const h = new Date().getHours();
      if (h !== this.hour) { this.hour = h; this.computeAdvice(); this.render(); UI.renderHome(); }
    },

    locate(silent) {
      if (!navigator.geolocation) { if (!silent) toast("Thiết bị không hỗ trợ định vị", "error"); return Promise.resolve(); }
      if (!silent) toast("Đang xác định vị trí...");
      return new Promise((resolve) => {
        navigator.geolocation.getCurrentPosition(async (pos) => {
          const lat = +pos.coords.latitude.toFixed(4), lon = +pos.coords.longitude.toFixed(4);
          let name = "Vị trí của bạn";
          try {
            const d = await U.getJson(`https://api.bigdatacloud.net/data/reverse-geocode-client?latitude=${lat}&longitude=${lon}&localityLanguage=vi`, 7000);
            const parts = [d.locality, d.city || d.principalSubdivision].filter(Boolean);
            const uniq = parts.filter((x, i) => parts.indexOf(x) === i);
            if (uniq.length) name = uniq.join(", ");
          } catch (e) {}
          this.loc = { lat, lon, name, def: false, ts: Date.now() };
          Store.set(CONFIG.KEYS.LOC, this.loc);
          Store.set(CONFIG.KEYS.WX, null);
          await this.refreshWeather();
          if (!silent) toast("Đã cập nhật vị trí & thời tiết", "success");
          resolve();
        }, async (err) => {
          if (!silent) toast(err && err.code === 1 ? "Bạn chưa cho phép vị trí, đang dùng khu vực mặc định" : "Không lấy được vị trí", "error");
          await this.refreshWeather();
          resolve();
        }, { enableHighAccuracy: false, timeout: 10000, maximumAge: 10 * 60 * 1000 });
      });
    },

    async refreshWeather(force) {
      if (this.loading) return;
      const key = `${this.loc.lat},${this.loc.lon}`;
      const c = Store.get(CONFIG.KEYS.WX, null);
      if (!force && c && c.key === key && Date.now() - c.ts < CONFIG.WX_MAX_AGE_MS) {
        this.wx = c.wx; this.aqi = c.aqi; this.rainSoon = c.rainSoon || 0;
        this.computeAdvice(); this.render(); return;
      }
      this.loading = true;
      const { lat, lon } = this.loc;
      const [w, a] = await Promise.allSettled([
        U.getJson(`https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,apparent_temperature,relative_humidity_2m,precipitation,weather_code,wind_speed_10m,is_day&hourly=precipitation_probability&forecast_hours=3&timezone=auto`),
        U.getJson(`https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi&timezone=auto`)
      ]);
      this.loading = false;
      if (w.status === "fulfilled" && w.value && w.value.current) {
        const cur = w.value.current;
        const probs = (w.value.hourly && w.value.hourly.precipitation_probability) || [];
        this.rainSoon = probs.length ? Math.max.apply(null, probs.map(Number).filter(n => !isNaN(n)).concat([0])) : 0;
        const info = wxInfo(cur.weather_code, cur.is_day === 1);
        this.wx = {
          temp: Math.round(cur.temperature_2m), feels: Math.round(cur.apparent_temperature),
          humidity: cur.relative_humidity_2m, precip: cur.precipitation || 0, wind: cur.wind_speed_10m || 0,
          code: cur.weather_code, isDay: cur.is_day === 1, icon: info.icon, text: info.text, rain: info.rain || (cur.precipitation || 0) > 0.1
        };
      }
      if (a.status === "fulfilled" && a.value && a.value.current && a.value.current.us_aqi != null) this.aqi = Math.round(a.value.current.us_aqi);
      if (this.wx) Store.set(CONFIG.KEYS.WX, { key, ts: Date.now(), wx: this.wx, aqi: this.aqi, rainSoon: this.rainSoon });
      this.computeAdvice(); this.render();
    },

    /* Tính điểm: nghiêng về "đặt về" khi mưa/nóng gắt/lạnh/ô nhiễm/khuya; ngược lại nên ra quán */
    computeAdvice() {
      const h = new Date().getHours(), w = this.wx;
      let d = 0; const why = [];
      if (w) {
        if (w.rain) { d += 3; why.push("Trời đang mưa"); }
        else if (this.rainSoon >= 60) { d += 2; why.push(`Sắp mưa (khoảng ${this.rainSoon}%)`); }
        if (w.feels >= 37) { d += 2; why.push(`Nắng nóng, cảm giác ${w.feels}°C`); }
        else if (w.feels >= 34) { d += 1; why.push(`Khá oi, cảm giác ${w.feels}°C`); }
        if (w.temp <= 15) { d += 2; why.push(`Trời lạnh ${w.temp}°C`); }
        if (w.wind >= 35) { d += 1; why.push("Gió khá mạnh"); }
      }
      if (this.aqi != null) {
        if (this.aqi >= 150) { d += 2; why.push(`Không khí kém (AQI ${this.aqi})`); }
        else if (this.aqi >= 100) { d += 1; why.push(`Không khí hơi ô nhiễm (AQI ${this.aqi})`); }
      }
      if (h >= 22 || h < 5) { d += 2; why.push("Đã khuya"); }
      else if (h >= 21) { d += 1; why.push("Sắp khuya"); }

      let mode, title, sub;
      if (d >= 2) { mode = "in"; title = "🛵 Nên đặt về nhà"; sub = "Ngồi nhà cho khỏe, để shipper lo!"; }
      else if (d === 1) { mode = "either"; title = "🤔 Đi hay ở đều được"; sub = "Có chút bất tiện, lười thì đặt về nhé."; }
      else {
        mode = "out"; title = "🍜 Nên ra quán ăn";
        sub = w ? "Thời tiết dễ chịu, ra quán ăn nóng ngon hơn nhiều!" : "Ra quán ăn cho đúng vị nhé!";
        if (w) why.push(`Trời ${w.text.toLowerCase()}, ${w.temp}°C`);
      }
      this.advice = { mode, title, sub, why };
    },

    mood() {
      const w = this.wx; if (!w) return null;
      if (w.rain || w.temp <= 20) return "warm";
      if (w.feels >= 33) return "cool";
      return null;
    },
    mul(food) {
      if (!state.settings.weatherBoost) return 1;
      const m = this.mood(); if (!m) return 1;
      return (m === "warm" ? WARM_RE : COOL_RE).test(foodNorm(food)) ? 2 : 1;
    },
    tipFor(food) {
      const w = this.wx; if (!w || !state.settings.weatherBoost) return "";
      const m = this.mood(), s = foodNorm(food);
      if (m === "warm" && WARM_RE.test(s)) return `${w.icon} Trời ${w.rain ? "mưa" : "se lạnh"} ${w.temp}°C — món nóng hổi này rất hợp!`;
      if (m === "cool" && COOL_RE.test(s)) return `${w.icon} Trời nóng ${w.temp}°C — món này giải nhiệt cực đã!`;
      return "";
    },

    renderClock() {
      const n = new Date();
      const t = $("ctx-time"), d = $("ctx-date");
      if (t) t.textContent = n.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", hour12: false });
      if (d) d.textContent = n.toLocaleDateString("vi-VN", { weekday: "long", day: "2-digit", month: "2-digit" });
    },

    render() {
      if (!$("ctx-card")) return;
      this.renderClock();
      const w = this.wx;
      $("ctx-wx-ico").textContent = w ? w.icon : (this.loading ? "⏳" : "🌡️");
      $("ctx-wx-temp").textContent = w ? `${w.temp}°C` : "--°";
      $("ctx-wx-text").textContent = w
        ? `${w.text} · cảm giác ${w.feels}°${this.aqi != null ? " · AQI " + this.aqi : ""}`
        : (this.loading ? "Đang lấy thời tiết..." : "Chưa có dữ liệu · chạm để thử lại");
      $("ctx-loc-name").textContent = this.loc.def ? `${this.loc.name} (mặc định)` : this.loc.name;
      $("ctx-locate").hidden = !this.loc.def;

      const a = this.advice, box = $("ctx-advice");
      if (!a) { box.hidden = true; return; }
      box.hidden = false;
      box.className = "ctx-advice " + a.mode;
      const why = a.why.length ? `<p>${a.why.map(U.esc).join(" · ")}</p>` : "";
      const act = a.mode === "in"
        ? `<button class="btn-primary" style="padding:10px 14px;font-size:13px;border-radius:14px" data-ctx-spin="1"><i data-lucide="sparkles"></i>Khui món rồi đặt về</button>`
        : a.mode === "out"
          ? `<a class="btn-soft sm" href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent("quán ăn gần tôi")}" target="_blank" rel="noopener noreferrer"><i data-lucide="map-pin"></i>Quán ăn gần tôi</a><button class="btn-soft sm" data-ctx-spin="1"><i data-lucide="sparkles"></i>Khui món</button>`
          : `<button class="btn-soft sm" data-ctx-spin="1"><i data-lucide="sparkles"></i>Khui món</button>`;
      box.innerHTML = `<h4>${U.esc(a.title)}</h4><p>${U.esc(a.sub)}</p>${why}<div class="ctx-actions">${act}</div>`;
      icons();
    }
  };

  /* ===================== 7. 3D: TÔ MÌ BỐC KHÓI ===================== */
  const Stage = {
    ok: false, visible: true, time: 0, last: 0, vel: 0, dragging: false, moved: 0, lastX: 0,
    anim: null, orbitAngle: 0, steam: 0.8, orbitItems: [], sprites: [],

    init() {
      this.box = $("three-stage");
      if (!this.box) return;
      try { this.build(); this.ok = true; }
      catch (err) { console.warn("3D fallback:", err); this.fallback(); }
    },

    fallback() {
      this.box.innerHTML = '<div class="stage-fallback" id="stage-fb">🍜</div>';
      $("stage-fb").addEventListener("click", () => App.spin());
    },

    caption(t) { const el = $("stage-caption"); if (el) el.textContent = t; },

    tint(hue) { if (this.ok) this.tintColor.setHSL(hue / 360, 0.78, 0.55); },

    build() {
      if (typeof THREE === "undefined") throw new Error("THREE missing");
      const box = this.box;
      const w = box.clientWidth || 340, h = box.clientHeight || 300;

      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setSize(w, h);
      box.appendChild(renderer.domElement);
      this.renderer = renderer;

      const scene = new THREE.Scene();
      this.scene = scene;
      this.camera = new THREE.PerspectiveCamera(38, w / h, 0.1, 60);

      // Ánh sáng
      scene.add(new THREE.HemisphereLight(0xfff1e6, 0x2a1a3a, 0.95));
      const key = new THREE.DirectionalLight(0xffffff, 1.35); key.position.set(4, 8, 6); scene.add(key);
      const rim = new THREE.DirectionalLight(0x8b5cf6, 0.8); rim.position.set(-5, 3, -4); scene.add(rim);
      const warm = new THREE.PointLight(0xff7a3d, 1.1, 12); warm.position.set(0, 0.6, 2.4); scene.add(warm);

      const rig = new THREE.Group(); scene.add(rig); this.rig = rig;
      const bowl = new THREE.Group(); rig.add(bowl); this.bowl = bowl;

      // Bóng đổ
      const sc = document.createElement("canvas"); sc.width = sc.height = 128;
      const sx = sc.getContext("2d");
      const grd = sx.createRadialGradient(64, 64, 4, 64, 64, 62);
      grd.addColorStop(0, "rgba(0,0,0,.5)"); grd.addColorStop(1, "rgba(0,0,0,0)");
      sx.fillStyle = grd; sx.fillRect(0, 0, 128, 128);
      const shadow = new THREE.Mesh(new THREE.PlaneGeometry(5, 5), new THREE.MeshBasicMaterial({ map: new THREE.CanvasTexture(sc), transparent: true, depthWrite: false }));
      shadow.rotation.x = -Math.PI / 2; shadow.position.y = 0.01; scene.add(shadow);

      // Tô (Lathe)
      const prof = [[0, 0], [0.6, 0], [0.68, 0.07], [0.95, 0.32], [1.38, 0.78], [1.64, 1.16], [1.72, 1.32], [1.67, 1.34], [1.6, 1.22], [1.3, 0.8], [0.9, 0.42], [0, 0.3]]
        .map(p => new THREE.Vector2(p[0], p[1]));
      this.bowlMat = new THREE.MeshStandardMaterial({ color: 0xff6b3d, roughness: 0.32, metalness: 0.08, side: THREE.DoubleSide });
      this.tintColor = new THREE.Color(0xff6b3d);
      bowl.add(new THREE.Mesh(new THREE.LatheGeometry(prof, 56), this.bowlMat));

      const cream = new THREE.MeshStandardMaterial({ color: 0xfff3df, roughness: 0.4 });
      [[1.695, 1.33, 0.045], [1.522, 0.98, 0.035], [1.236, 0.62, 0.03]].forEach(([r, y, t]) => {
        const tor = new THREE.Mesh(new THREE.TorusGeometry(r, t, 10, 64), cream);
        tor.rotation.x = Math.PI / 2; tor.position.y = y; bowl.add(tor);
      });

      // Nước dùng + mì
      const broth = new THREE.Mesh(new THREE.CircleGeometry(1.42, 48),
        new THREE.MeshStandardMaterial({ color: 0xf0a23a, roughness: 0.2, emissive: 0x7a3a00, emissiveIntensity: 0.35 }));
      broth.rotation.x = -Math.PI / 2; broth.position.y = 1.02; bowl.add(broth);

      const noodleMat = new THREE.MeshStandardMaterial({ color: 0xfde7b0, roughness: 0.55 });
      const mound = new THREE.Mesh(new THREE.SphereGeometry(0.95, 24, 16), noodleMat);
      mound.scale.set(1, 0.38, 1); mound.position.y = 1.03; bowl.add(mound);
      for (let i = 0; i < 6; i++) {
        const t = new THREE.Mesh(new THREE.TorusGeometry(0.25 + i * 0.15, 0.045, 8, 40), noodleMat);
        t.rotation.x = Math.PI / 2 + (Math.random() - 0.5) * 0.25; t.rotation.y = (Math.random() - 0.5) * 0.25;
        t.position.y = 1.12 + (i % 2) * 0.03; bowl.add(t);
      }

      // Topping: trứng, thịt, hành, ớt, rau
      const egg = new THREE.Mesh(new THREE.SphereGeometry(0.32, 20, 14), new THREE.MeshStandardMaterial({ color: 0xfffaf0, roughness: 0.3 }));
      egg.scale.set(1, 0.55, 1); egg.position.set(-0.55, 1.28, 0.4); bowl.add(egg);
      const yolk = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), new THREE.MeshStandardMaterial({ color: 0xffb300, roughness: 0.25 }));
      yolk.scale.set(1, 0.8, 1); yolk.position.set(-0.55, 1.45, 0.4); bowl.add(yolk);

      [[0.5, 1.3, 0.45, 0.2], [0.72, 1.27, -0.12, -0.15], [0.22, 1.34, 0.12, 0.1]].forEach(([x, y, z, r], i) => {
        const m = new THREE.Mesh(new THREE.CylinderGeometry(0.34, 0.34, 0.05, 20), new THREE.MeshStandardMaterial({ color: i % 2 ? 0xc96a4f : 0xb5523b, roughness: 0.5 }));
        m.position.set(x, y, z); m.rotation.set(r, i, r * 0.6); bowl.add(m);
      });
      const green = new THREE.MeshStandardMaterial({ color: 0x4ade80, roughness: 0.5 });
      for (let i = 0; i < 12; i++) {
        const a = Math.random() * Math.PI * 2, r = Math.random() * 0.95;
        const s = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.035, 0.15, 8), green);
        s.position.set(Math.cos(a) * r, 1.36 + Math.random() * 0.05, Math.sin(a) * r);
        s.rotation.set(Math.random() * 3, Math.random() * 3, Math.random() * 3); bowl.add(s);
      }
      const chili = new THREE.Mesh(new THREE.TorusGeometry(0.09, 0.03, 8, 16), new THREE.MeshStandardMaterial({ color: 0xdc2626 }));
      chili.rotation.x = Math.PI / 2; chili.position.set(0.1, 1.4, -0.5); bowl.add(chili);
      [[-0.3, 1.33, -0.5], [0.15, 1.35, -0.7], [-0.75, 1.3, -0.2]].forEach(([x, y, z]) => {
        const lf = new THREE.Mesh(new THREE.SphereGeometry(0.2, 12, 8), new THREE.MeshStandardMaterial({ color: 0x22a45d, roughness: 0.6 }));
        lf.scale.set(1, 0.15, 0.6); lf.position.set(x, y, z); lf.rotation.y = x * 4; bowl.add(lf);
      });

      // Đũa gác ngang miệng tô
      const wood = new THREE.MeshStandardMaterial({ color: 0xe0a96d, roughness: 0.6 });
      const chop = new THREE.Group();
      [0.55, 0.72].forEach(z => {
        const c = new THREE.Mesh(new THREE.CylinderGeometry(0.035, 0.026, 3.5, 10), wood);
        c.rotation.z = Math.PI / 2; c.position.z = z; chop.add(c);
      });
      chop.position.set(0, 1.55, 0); chop.rotation.set(0, 0.35, 0.16); bowl.add(chop);

      // Hơi nước
      const stc = document.createElement("canvas"); stc.width = stc.height = 64;
      const sctx = stc.getContext("2d");
      const sg = sctx.createRadialGradient(32, 32, 2, 32, 32, 30);
      sg.addColorStop(0, "rgba(255,255,255,.9)"); sg.addColorStop(1, "rgba(255,255,255,0)");
      sctx.fillStyle = sg; sctx.fillRect(0, 0, 64, 64);
      const steamTex = new THREE.CanvasTexture(stc);
      for (let i = 0; i < 16; i++) {
        const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: steamTex, transparent: true, opacity: 0, depthWrite: false }));
        sp.userData = { life: Math.random(), speed: 0.22 + Math.random() * 0.18, x0: (Math.random() - 0.5) * 1.3, z0: (Math.random() - 0.5) * 1.3, ph: Math.random() * 6 };
        bowl.add(sp); this.sprites.push(sp);
      }

      // Nguyên liệu bay quanh
      const defs = [
        [new THREE.SphereGeometry(0.26, 20, 16), 0xef4444, [1, 0.92, 1]],
        [new THREE.ConeGeometry(0.12, 0.55, 12), 0xdc2626, [1, 1, 1]],
        [new THREE.SphereGeometry(0.24, 18, 14), 0x84cc16, [1, 0.8, 1]],
        [new THREE.SphereGeometry(0.22, 18, 14), 0xfafafa, [0.85, 1.15, 0.85]],
        [new THREE.TorusGeometry(0.2, 0.07, 10, 24), 0xfbbf24, [1, 1, 1]],
        [new THREE.OctahedronGeometry(0.22), 0xa855f7, [1, 1, 1]]
      ];
      defs.forEach(([geo, color, sc2]) => {
        const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color, roughness: 0.4, metalness: 0.05 }));
        m.scale.set(sc2[0], sc2[1], sc2[2]); rig.add(m); this.orbitItems.push(m);
      });

      this.fit();
      if (window.ResizeObserver) new ResizeObserver(() => this.fit()).observe(box);
      else window.addEventListener("resize", () => this.fit());
      if (window.IntersectionObserver) new IntersectionObserver((es) => { this.visible = es[0].isIntersecting; }).observe(box);

      // Kéo để xoay / chạm để khui
      const el = renderer.domElement;
      el.addEventListener("pointerdown", (e) => {
        this.dragging = true; this.moved = 0; this.lastX = e.clientX;
        try { el.setPointerCapture(e.pointerId); } catch (_) {}
      });
      el.addEventListener("pointermove", (e) => {
        if (!this.dragging) return;
        const dx = e.clientX - this.lastX; this.lastX = e.clientX;
        this.moved += Math.abs(dx); this.vel = dx * 0.012; this.rig.rotation.y += this.vel;
      });
      const up = () => { if (!this.dragging) return; this.dragging = false; if (this.moved < 8) App.spin(); };
      el.addEventListener("pointerup", up);
      el.addEventListener("pointercancel", () => { this.dragging = false; });

      this.loop = this.loop.bind(this);
      requestAnimationFrame(this.loop);
    },

    fit() {
      if (!this.renderer) return;
      const w = this.box.clientWidth, h = this.box.clientHeight;
      if (!w || !h) return;
      this.renderer.setSize(w, h);
      const aspect = w / h;
      this.camera.aspect = aspect;
      const d = 8.4 * Math.max(1, 1.12 / aspect);
      this.camera.position.set(0, d * 0.37, d * 0.93);
      this.camera.lookAt(0, 1.15, 0);
      this.camera.updateProjectionMatrix();
    },

    play(onReveal, onDone) {
      if (!this.ok || !this.visible) {
        const fb = $("stage-fb"); if (fb) fb.classList.add("bounce");
        setTimeout(() => { onReveal && onReveal(); if (fb) fb.classList.remove("bounce"); onDone && onDone(); }, this.ok ? 50 : 900);
        return;
      }
      this.anim = { t: 0, dur: 1.55, fired: false, onReveal, onDone };
    },

    loop(now) {
      requestAnimationFrame(this.loop);
      if (!this.visible || document.hidden) { this.last = now; return; }
      const dt = Math.min(0.05, (now - this.last) / 1000 || 0.016);
      this.last = now; this.time += dt;

      let lift = 0, squash = 0, spinY = 0, wob = 0, boost = 0;
      const a = this.anim;
      if (a) {
        a.t = Math.min(1, a.t + dt / a.dur);
        const t = a.t;
        if (t < 0.18) {
          const u = t / 0.18; squash = 0.14 * Math.sin(u * Math.PI / 2); this.bowl.position.x = Math.sin(u * 40) * 0.04 * u;
        } else if (t < 0.78) {
          const u = (t - 0.18) / 0.6;
          lift = Math.sin(u * Math.PI) * 1.7;
          spinY = (u < 0.5 ? 2 * u * u : 1 - Math.pow(-2 * u + 2, 2) / 2) * Math.PI * 2;
          wob = Math.sin(u * Math.PI * 2) * 0.16; boost = Math.sin(u * Math.PI); this.bowl.position.x = 0;
        } else {
          const u = (t - 0.78) / 0.22; squash = 0.1 * Math.sin(u * Math.PI) * (1 - u); spinY = Math.PI * 2;
        }
        if (!a.fired && t >= 0.8) { a.fired = true; a.onReveal && a.onReveal(); }
        if (t >= 1) { this.anim = null; spinY = 0; this.bowl.position.x = 0; a.onDone && a.onDone(); }
      }

      // Xoay theo ngón tay + quán tính
      if (!this.dragging) { this.vel *= 0.95; this.rig.rotation.y += this.vel + dt * (a ? 0 : 0.3); }

      this.bowl.position.y = Math.sin(this.time * 1.8) * 0.05 + lift;
      this.bowl.rotation.y = spinY; this.bowl.rotation.z = wob;
      this.bowl.scale.set(1 + squash * 0.5, 1 - squash, 1 + squash * 0.5);
      this.bowlMat.color.lerp(this.tintColor, Math.min(1, dt * 4));

      // Nguyên liệu bay vòng quanh
      this.orbitAngle += dt * (0.55 + boost * 7);
      const n = this.orbitItems.length, R = 2.45 + boost * 0.5;
      this.orbitItems.forEach((m, i) => {
        const ang = this.orbitAngle + i * (Math.PI * 2 / n);
        m.position.set(Math.cos(ang) * R, 1.9 + Math.sin(this.time * 1.5 + i * 1.3) * 0.18 + lift * 0.4, Math.sin(ang) * R);
        m.rotation.x += dt * (1 + i * 0.2); m.rotation.y += dt * 1.3;
      });

      // Hơi nước
      this.steam += ((a ? 2.2 : 0.8) - this.steam) * Math.min(1, dt * 3);
      this.sprites.forEach(sp => {
        const d = sp.userData;
        d.life += dt * d.speed * (0.8 + this.steam * 0.5);
        if (d.life > 1) { d.life = 0; d.x0 = (Math.random() - 0.5) * 1.3; d.z0 = (Math.random() - 0.5) * 1.3; }
        sp.position.set(d.x0 + Math.sin(d.life * 6 + d.ph) * 0.15, 1.5 + d.life * 2.3, d.z0);
        const s = 0.5 + d.life * 1.1; sp.scale.set(s, s, 1);
        sp.material.opacity = Math.sin(d.life * Math.PI) * 0.26 * this.steam;
      });

      this.renderer.render(this.scene, this.camera);
    }
  };

  /* ===================== 8. LẮC ĐIỆN THOẠI ===================== */
  const Shake = (() => {
    let on = false, last = 0, prev = null;
    function handler(e) {
      const a = e.accelerationIncludingGravity; if (!a) return;
      const m = Math.abs(a.x || 0) + Math.abs(a.y || 0) + Math.abs(a.z || 0);
      if (prev !== null && Math.abs(m - prev) > 26) {
        const now = Date.now();
        if (now - last > 1500 && state.settings.shake && state.view === "home" && !Sheet.open && !state.busy) { last = now; App.spin(); }
      }
      prev = m;
    }
    return {
      async enable() {
        if (on || typeof DeviceMotionEvent === "undefined") return;
        try {
          if (typeof DeviceMotionEvent.requestPermission === "function") {
            const r = await DeviceMotionEvent.requestPermission();
            if (r !== "granted") return;
          }
          window.addEventListener("devicemotion", handler); on = true;
        } catch (e) {}
      }
    };
  })();

  /* ============================ 9. ENGINE ============================ */
  const Engine = {
    priceOk(i, b) {
      if (!b || b === "all") return true;
      const [k, v] = b.split(":"), n = Number(v);
      if (k === "max") return i.minPrice === null || i.minPrice === undefined || i.minPrice <= n;
      if (k === "min") { const top = i.maxPrice != null ? i.maxPrice : (i.minPrice != null ? i.minPrice : 0); return top >= n; }
      return true;
    },
    matches(i, { purpose = true } = {}) {
      const f = state.filters;
      if (purpose && f.purpose !== "all" && !(i.purposes || []).includes(f.purpose)) return false;
      if (f.group !== "all" && i.group !== f.group) return false;
      if (f.district !== "all" && !(i.districts || []).includes(f.district)) return false;
      return this.priceOk(i, f.budget);
    },
    pool({ recent = false } = {}) {
      let list = state.foods.filter(i => !isBlocked(i.id) && this.matches(i));
      if (recent && state.filters.excludeRecent) {
        const ids = new Set(state.history.slice(0, CONFIG.RECENT_EXCLUDE).map(h => h.id));
        const fresh = list.filter(i => !ids.has(i.id));
        if (fresh.length) list = fresh;
      }
      return list;
    },
    // Món yêu thích ×2, món hợp thời tiết ×2 (nhân với nhau)
    pick(list) {
      if (!list.length) return null;
      const boost = state.settings.favBoost;
      const w = list.map(i => (boost && isFav(i.id) ? 2 : 1) * Ctx.mul(i));
      let r = Math.random() * w.reduce((a, b) => a + b, 0);
      for (let k = 0; k < list.length; k++) { r -= w[k]; if (r <= 0) return list[k]; }
      return list[list.length - 1];
    },
    exploreList() {
      const kw = U.norm(state.keyword);
      let list = state.foods.filter(i => !isBlocked(i.id) && this.matches(i));
      if (kw) list = list.filter(i => U.norm(`${i.name} ${i.group} ${(i.districts || []).join(" ")} ${(i.purposes || []).join(" ")}`).includes(kw));
      const s = state.filters.sort;
      if (s === "price-asc") list.sort((a, b) => (a.minPrice ?? 1e12) - (b.minPrice ?? 1e12));
      else if (s === "price-desc") list.sort((a, b) => (b.maxPrice ?? -1) - (a.maxPrice ?? -1));
      else if (s === "venues") list.sort((a, b) => (b.venues || []).length - (a.venues || []).length);
      else if (s === "name") list.sort((a, b) => a.name.localeCompare(b.name, "vi"));
      return list;
    }
  };

  /* ====================== 10. FAVORITES / BLOCK / HISTORY ====================== */
  function setFav(food, on, silent) {
    const idx = state.favorites.findIndex(f => f.id === food.id);
    if (on && idx === -1) {
      state.favorites.unshift({ id: food.id, name: food.name, group: food.group });
      Api.track(food.id, "save");
      if (!silent) toast(`Đã lưu "${food.name}"`, "success");
    } else if (!on && idx > -1) {
      state.favorites.splice(idx, 1);
      if (!silent) toast(`Đã bỏ lưu "${food.name}"`);
    }
    Store.set(CONFIG.KEYS.FAV, state.favorites);
    syncFavButtons();
    if (state.view === "me") UI.renderMe();
    U.buzz(12);
  }
  function syncFavButtons() {
    $$("[data-fav]").forEach(b => b.classList.toggle("on", isFav(b.dataset.fav)));
    $$('[data-act="fav"]').forEach(b => b.classList.toggle("on", state.current && isFav(state.current.id)));
  }
  function setBlock(food, on) {
    const idx = state.blocked.findIndex(f => f.id === food.id);
    if (on && idx === -1) state.blocked.unshift({ id: food.id, name: food.name, group: food.group });
    if (!on && idx > -1) state.blocked.splice(idx, 1);
    Store.set(CONFIG.KEYS.BLOCK, state.blocked);
    onFiltersChanged(true);
  }
  function addHistory(food) {
    state.history.unshift({ id: food.id, name: food.name, group: food.group, ts: Date.now() });
    if (state.history.length > CONFIG.HISTORY_MAX) state.history.length = CONFIG.HISTORY_MAX;
    Store.set(CONFIG.KEYS.HIST, state.history);
    Api.track(food.id, "pick");
  }
  function calcStreak() {
    const days = new Set(state.history.map(h => U.dateKey(new Date(h.ts))));
    const d = new Date();
    if (!days.has(U.dateKey(d))) { d.setDate(d.getDate() - 1); if (!days.has(U.dateKey(d))) return 0; }
    let n = 0;
    while (days.has(U.dateKey(d))) { n++; d.setDate(d.getDate() - 1); }
    return n;
  }
  async function shareFood(food) {
    const v = food.venues && food.venues[0];
    const text = `Hôm nay mình ăn ${food.name}${v ? " ở " + v.restaurant : ""}! 😋`;
    const data = { title: `Hôm nay ăn ${food.name}!`, text, url: location.href };
    if (navigator.share) { try { await navigator.share(data); } catch (_) {} }
    else { try { await navigator.clipboard.writeText(`${text} ${location.href}`); toast("Đã sao chép nội dung chia sẻ", "success"); } catch (_) { toast("Không thể sao chép tự động", "error"); } }
  }

  /* ============================ 11. UI ============================ */
  const UI = {
    rowHtml(item) {
      const vc = item.venues ? item.venues.length : 0;
      return `
        <article class="row" data-open="${U.esc(item.id)}">
          <div class="row-emoji" style="background:${U.grad(item)}">${U.emoji(item)}</div>
          <div class="row-main">
            <h4>${U.esc(item.name)}</h4>
            <p>${U.esc(item.description || item.group)}</p>
            <div class="row-meta"><span class="price">${U.esc(U.priceText(item.minPrice, item.maxPrice))}</span>${vc ? `<span>📍 ${vc} quán</span>` : ""}<span>${U.esc(item.group)}</span></div>
          </div>
          <button class="fav-btn ${isFav(item.id) ? "on" : ""}" data-fav="${U.esc(item.id)}" aria-label="Lưu món"><i data-lucide="heart"></i></button>
        </article>`;
    },

    renderSkeleton() {
      $("foods-grid-container").innerHTML = '<div class="skeleton"></div>'.repeat(6);
    },

    /* ---- HOME ---- */
    renderHome() {
      const t = timeInfo();
      $("greeting").textContent = t.hello;
      $("smart-time-text").textContent = `${t.icon} Đang là ${t.label} · bấm để lọc nhanh`;
      const n = Engine.pool({ recent: true }).length;
      $("filtered-candidates-counter").textContent = state.foods.length ? `🍽️ ${n} món sẵn sàng` : "Đang tải thực đơn...";
      this.renderMoodChips();
    },
    renderMoodChips() {
      const f = state.filters, t = timeInfo(), tp = findPurposeFor(t);
      const none = f.purpose === "all" && f.group === "all" && f.district === "all" && f.budget === "all";
      const chips = [
        ["all", "🎲 Tất cả", none], ["time", `${t.icon} ${t.label}`, !!tp && f.purpose === tp],
        ["cheap", "💸 Dưới 50k", f.budget === "max:50000"], ["treat", "🥂 Chiêu đãi", f.budget === "min:100000"]
      ];
      $("mood-chips").innerHTML = chips.map(([id, label, on]) => `<button class="chip ${on ? "on" : ""}" data-mood="${id}">${label}</button>`).join("");
    },
    renderTrending() {
      const wrap = $("trending-wrap");
      if (!state.trending.length) { wrap.hidden = true; return; }
      wrap.hidden = false;
      $("trending-list").innerHTML = state.trending.map(t => {
        const f = state.byId.get(t.id);
        return `<button class="chip" data-open="${U.esc(t.id)}">${U.emoji(f)} ${U.esc(f.name)}</button>`;
      }).join("");
    },

    /* ---- EXPLORE ---- */
    renderGroupChips() {
      const g = state.filters.group;
      $("group-chips").innerHTML = `<button class="chip ${g === "all" ? "on" : ""}" data-group="all">Tất cả</button>` +
        state.meta.groups.map(x => `<button class="chip ${g === x ? "on" : ""}" data-group="${U.esc(x)}">${U.esc(x)}</button>`).join("");
    },
    renderExplore() {
      if (!state.foods.length) return;
      const grid = $("foods-grid-container");
      const list = Engine.exploreList();
      $("food-count-label").textContent = `${list.length} món ngon`;
      if (!list.length) {
        grid.innerHTML = `<div class="empty"><span class="big">🍽️</span>Không có món nào phù hợp.<br>Thử đổi bộ lọc hoặc từ khóa nhé!<br><br><button class="btn-soft" data-act-reset="1">Đặt lại bộ lọc</button></div>`;
        $("btn-load-more").hidden = true; icons(); return;
      }
      const shown = list.slice(0, state.exploreLimit);
      grid.innerHTML = shown.map(i => this.rowHtml(i)).join("");
      const more = list.length - shown.length;
      $("btn-load-more").hidden = more <= 0;
      $("btn-load-more").textContent = `Xem thêm (${more} món)`;
      icons();
    },
    renderFilterBadges() {
      const f = state.filters;
      const n = ["purpose", "group", "district", "budget"].filter(k => f[k] !== "all").length;
      $$(".js-filter-badge").forEach(b => { b.hidden = n === 0; b.textContent = n; });
    },

    /* ---- SHEET: FILTER ---- */
    filterSheet() {
      const f = state.filters, m = state.meta;
      const opts = (list, cur) => list.map(([v, t]) => `<option value="${U.esc(v)}" ${cur === v ? "selected" : ""}>${U.esc(t)}</option>`).join("");
      const arr = (all, items) => [["all", all]].concat(items.map(x => [x, x]));
      const html = `
        <label class="field"><span>Bữa ăn</span><select data-filter="purpose">${opts(arr("Tất cả bữa ăn", m.purposes), f.purpose)}</select></label>
        <label class="field"><span>Nhóm món</span><select data-filter="group">${opts(arr("Tất cả nhóm", m.groups), f.group)}</select></label>
        <label class="field"><span>Khu vực</span><select data-filter="district">${opts(arr("Tất cả khu vực", m.districts), f.district)}</select></label>
        <label class="field"><span>Mức giá</span><select data-filter="budget">${opts(BUDGETS, f.budget)}</select></label>
        <label class="field"><span>Sắp xếp (tab Thực đơn)</span><select data-filter="sort">${opts(SORTS, f.sort)}</select></label>
        <label class="switch-row"><div><b>Tránh trùng món gần đây</b><small>Không quay lại ${CONFIG.RECENT_EXCLUDE} món vừa chọn</small></div>
          <input type="checkbox" data-filter="excludeRecent" ${f.excludeRecent ? "checked" : ""}><i class="sw"></i></label>
        <div class="act-row" style="margin-top:18px">
          <button class="btn-soft" data-act="filter-reset">Đặt lại</button>
          <button class="btn-primary grow" data-act="filter-done" id="filter-apply-btn">Xem ${Engine.pool().length} món</button>
        </div>`;
      Sheet.show("Bộ lọc thông minh", html, "filter");
    },

    /* ---- Khối đặt đồ ---- */
    orderHtml(food) {
      const q = encodeURIComponent(food.name);
      const a = Ctx.advice;
      const rec = a && a.mode === "in";
      const btns = CONFIG.ORDER_APPS.map(app => `
        <a class="ord-btn" href="${U.esc(app.url.replace("{q}", q))}" target="_blank" rel="noopener noreferrer"
           data-act="order" data-app="${U.esc(app.id)}" style="--c:${app.color};--fg:${app.fg || "#fff"}">
          <i data-lucide="shopping-bag"></i>${U.esc(app.name)}
        </a>`).join("");
      const why = rec ? `<span class="tag price" style="white-space:nowrap">Gợi ý hôm nay</span>` : "";
      const sub = rec && a.why.length ? `<p class="order-note" style="margin-top:6px">${U.esc(a.why.join(" · "))}</p>` : "";
      return `
        <div class="order-box ${rec ? "rec" : ""}">
          <h4><span>🛵 Đặt về nhà</span>${why}</h4>
          ${sub}
          <div class="order-grid">${btns}</div>
          <p class="order-note">Mở app và tìm “<b>${U.esc(food.name)}</b>”. Tên món được chép sẵn, nếu app mở ra trang chủ thì chỉ cần dán vào ô tìm kiếm.</p>
        </div>`;
    },

    /* ---- SHEET: FOOD ---- */
    foodSheet(food, mode) {
      state.current = food;
      const df = state.filters.district;
      const venues = (food.venues || []).slice().sort((a, b) => (b.district === df ? 1 : 0) - (a.district === df ? 1 : 0));
      state.venues = venues;
      const mapsQ = `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(food.name)}`;
      const tags = [`<span class="tag">${U.esc(food.group)}</span>`]
        .concat((food.purposes || []).map(p => `<span class="tag">${U.esc(p)}</span>`))
        .concat([`<span class="tag price">${U.esc(U.priceText(food.minPrice, food.maxPrice))}</span>`]).join("");
      const primary = mode === "result"
        ? `<button class="btn-primary grow" data-act="reroll"><i data-lucide="refresh-cw"></i>Đổi món khác</button>`
        : `<button class="btn-primary grow" data-act="choose"><i data-lucide="check"></i>Chốt món này</button>`;
      const venuesHtml = venues.length ? venues.map((v, i) => {
        const pt = U.priceText(v.minPrice, v.maxPrice, "");
        return `
          <div class="venue" data-vi="${i}">
            <div>
              <b>${U.esc(v.restaurant)}</b>${v.district ? `<em>${U.esc(v.district)}</em>` : ""}
              <p>${U.esc(v.address || "Địa chỉ cập nhật tại quán")}</p>
              ${v.notes ? `<small>* ${U.esc(v.notes)}</small>` : ""}${pt ? `<small>${U.esc(pt)}</small>` : ""}
            </div>
            <div class="venue-act">
              ${U.isUrl(v.mapUrl) ? `<a class="btn-soft sm" href="${U.esc(v.mapUrl)}" target="_blank" rel="noopener noreferrer"><i data-lucide="navigation"></i>Chỉ đường</a>` : ""}
              ${v.address ? `<button class="btn-soft sm" data-act="copy-addr" data-vi="${i}"><i data-lucide="copy"></i>Chép</button>` : ""}
            </div>
          </div>`;
      }).join("") : `<div class="empty" style="padding:18px 0">Món phổ biến, dễ tìm quanh bạn. Thử tìm trên bản đồ nhé 👇</div>`;

      const venueBlock = `
        <div class="sec-row"><h4>📍 Quán gợi ý (${venues.length})</h4>
          ${venues.length > 1 ? `<button class="btn-soft sm" data-act="venue-random"><i data-lucide="sparkles"></i>Chọn giúp quán</button>` : ""}
        </div>
        ${venuesHtml}
        <a class="btn-soft wide" href="${mapsQ}" target="_blank" rel="noopener noreferrer"><i data-lucide="map-pin"></i>Tìm quán gần tôi trên Maps</a>`;
      const orderBlock = this.orderHtml(food);
      // Nếu hôm nay nên đặt về → đưa khối đặt đồ lên trước danh sách quán
      const preferOrder = Ctx.advice && Ctx.advice.mode === "in";
      const tip = Ctx.tipFor(food);

      const html = `
        <div class="food-hero" style="--g:${U.grad(food)};background:${U.grad(food)}">
          <div class="food-emoji">${U.emoji(food)}</div>
          ${mode === "result" ? '<span class="kicker">✨ HÔM NAY ĂN</span>' : ""}
          <h2 class="food-name">${U.esc(food.name)}</h2>
        </div>
        <div class="tags">${tags}</div>
        ${tip ? `<div class="wx-tip">${U.esc(tip)}</div>` : ""}
        <p class="food-desc">${U.esc(food.description || "Hương vị hấp dẫn, đậm bản sắc Việt. Ăn một lần là nhớ mãi!")}</p>
        <div class="act-row">
          ${primary}
          <button class="sq fav ${isFav(food.id) ? "on" : ""}" data-act="fav" aria-label="Lưu món"><i data-lucide="heart"></i></button>
          <button class="sq bad ${isBlocked(food.id) ? "on" : ""}" data-act="block" aria-label="Không thích món này"><i data-lucide="ban"></i></button>
          <button class="sq" data-act="share" aria-label="Chia sẻ"><i data-lucide="share-2"></i></button>
        </div>
        ${preferOrder ? orderBlock + venueBlock : venueBlock + orderBlock}`;
      Sheet.show(mode === "result" ? "Gợi ý cho bạn" : "Chi tiết món", html, mode);
    },

    /* ---- ME ---- */
    renderMe() {
      const hist = state.history, streak = calcStreak();
      const counts = {};
      hist.forEach(h => { counts[h.group] = (counts[h.group] || 0) + 1; });
      const top = Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 3);
      const max = top.length ? top[0][1] : 1;
      $("me-stats").innerHTML = `
        <div class="stats">
          <div class="stat"><b>${streak}🔥</b><span>Ngày liên tiếp</span></div>
          <div class="stat"><b>${hist.length}</b><span>Lần khui món</span></div>
          <div class="stat"><b>${state.favorites.length}</b><span>Món đã lưu</span></div>
        </div>
        ${top.length ? `<div class="card"><h4>Bạn hay ăn nhất</h4>${top.map(([g, c]) => `<div class="bar"><em>${U.esc(g)}</em><i style="width:${Math.max(8, (c / max) * 100)}%"></i><span>${c}</span></div>`).join("")}</div>` : ""}`;

      $$("#me-seg button").forEach(b => b.classList.toggle("on", b.dataset.tab === state.meTab));

      const rowSimple = (it, action, icon, extra = "") => {
        const f = state.byId.get(it.id) || it;
        return `<article class="row" data-open="${U.esc(it.id)}">
          <div class="row-emoji" style="background:${U.grad(f)}">${U.emoji(f)}</div>
          <div class="row-main"><h4>${U.esc(it.name)}</h4><div class="row-meta"><span>${U.esc(it.group)}</span>${extra}</div></div>
          ${action ? `<button class="fav-btn" ${action} aria-label="Xóa"><i data-lucide="${icon}"></i></button>` : ""}
        </article>`;
      };
      let body = "";
      if (state.meTab === "fav") {
        body = state.favorites.length
          ? `<div class="list">${state.favorites.map(f => rowSimple(f, `data-unfav="${U.esc(f.id)}"`, "x")).join("")}</div>`
          : `<div class="empty"><span class="big">💝</span>Chưa có món nào được lưu.<br>Bấm ❤️ hoặc vuốt phải ở tab Vuốt nhé!</div>`;
      } else if (state.meTab === "hist") {
        body = hist.length
          ? `<div class="list">${hist.map(h => rowSimple(h, "", "", `<span>${new Date(h.ts).toLocaleString("vi-VN", { hour: "2-digit", minute: "2-digit", day: "2-digit", month: "2-digit" })}</span>`)).join("")}</div>
             <button class="btn-soft wide danger" data-clear-hist="1"><i data-lucide="trash-2"></i>Xóa lịch sử</button>`
          : `<div class="empty"><span class="big">🕘</span>Chưa có lịch sử.<br>Khui món đầu tiên của bạn đi!</div>`;
      } else {
        body = state.blocked.length
          ? `<div class="list">${state.blocked.map(f => rowSimple(f, `data-unblock="${U.esc(f.id)}"`, "rotate-ccw")).join("")}</div>`
          : `<div class="empty"><span class="big">🙌</span>Chưa chặn món nào.<br>Món bị chặn sẽ không bao giờ xuất hiện khi quay.</div>`;
      }
      $("me-body").innerHTML = body;

      const sw = (key, title, sub) => `<label class="switch-row"><div><b>${title}</b><small>${sub}</small></div><input type="checkbox" data-set="${key}" ${state.settings[key] ? "checked" : ""}><i class="sw"></i></label>`;
      $("me-settings").innerHTML =
        sw("haptics", "Rung phản hồi", "Rung nhẹ khi khui món, lưu món") +
        sw("shake", "Lắc để chọn món", "Lắc điện thoại ở tab Chọn món") +
        sw("favBoost", "Ưu tiên món đã lưu", "Món yêu thích có cơ hội xuất hiện cao hơn") +
        sw("weatherBoost", "Gợi ý món hợp thời tiết", "Trời mưa/lạnh ưu tiên món nóng, trời nóng ưu tiên món mát") +
        `<div style="padding:14px 0 0"><button class="btn-soft wide" style="margin:0" data-ctx-locate="1"><i data-lucide="locate-fixed"></i>Cập nhật vị trí & thời tiết</button></div>` +
        `<div style="padding:10px 0 6px"><button class="btn-soft wide danger" style="margin:0" data-clear-all="1"><i data-lucide="trash-2"></i>Xóa toàn bộ dữ liệu trên máy</button></div>`;
      icons();
    }
  };

  /* ============================ 12. SWIPE ============================ */
  const Swipe = {
    deck: [], idx: 0, dirty: true, drag: null, lock: false,
    cardHtml(food, pos) {
      return `
        <div class="swipe-card pos-${pos}" data-id="${U.esc(food.id)}">
          <div class="sc-top" style="background:${U.grad(food)}">
            <div class="sc-emoji">${U.emoji(food)}</div>
            <span class="lbl lbl-like">LƯU</span><span class="lbl lbl-nope">BỎ QUA</span>
          </div>
          <div class="sc-body">
            <h3>${U.esc(food.name)}</h3>
            <div class="sc-tags"><span class="tag">${U.esc(food.group)}</span><span class="tag price">${U.esc(U.priceText(food.minPrice, food.maxPrice))}</span>${food.venues && food.venues.length ? `<span class="tag">📍 ${food.venues.length} quán</span>` : ""}</div>
            <p>${U.esc(food.description || "Hương vị hấp dẫn, đậm bản sắc Việt.")}</p>
          </div>
        </div>`;
    },
    build() {
      this.deck = U.shuffle(Engine.pool()).slice(0, 40); this.idx = 0; this.dirty = false; this.render();
    },
    render() {
      const st = $("swipe-stage");
      if (!state.foods.length) { st.innerHTML = `<div class="empty"><span class="big">⏳</span>Đang tải thực đơn...</div>`; return; }
      if (this.idx >= this.deck.length) {
        st.innerHTML = `<div class="empty" style="padding-top:70px"><span class="big">🎉</span>${this.deck.length ? "Bạn đã vuốt hết bộ bài!" : "Không có món nào khớp bộ lọc."}<br><br><button class="btn-primary" id="sw-reshuffle">Xáo bộ bài mới</button></div>`;
        $("swipe-count").textContent = ""; return;
      }
      st.innerHTML = [2, 1, 0].map(p => { const f = this.deck[this.idx + p]; return f ? this.cardHtml(f, p) : ""; }).join("");
      $("swipe-count").textContent = `${this.idx + 1} / ${this.deck.length}`;
    },
    top() { return this.deck[this.idx]; },
    commit(dir) {
      if (this.lock || this.idx >= this.deck.length) return;
      const card = $("swipe-stage").querySelector(".swipe-card.pos-0"); if (!card) return;
      this.lock = true;
      const food = this.top();
      card.style.transition = "transform .28s ease, opacity .28s ease";
      card.style.transform = `translate(${dir * 130}%, -20px) rotate(${dir * 18}deg)`;
      card.style.opacity = "0";
      if (dir > 0) setFav(food, true); else U.buzz(8);
      setTimeout(() => { this.idx++; this.lock = false; this.render(); }, 260);
    },
    bind() {
      const st = $("swipe-stage");
      const reset = (d) => {
        d.c.style.transition = "transform .25s ease"; d.c.style.transform = "";
        d.c.querySelectorAll(".lbl").forEach(l => (l.style.opacity = 0));
      };
      st.addEventListener("pointerdown", (e) => {
        const c = e.target.closest(".swipe-card.pos-0"); if (!c || this.lock) return;
        this.drag = { c, x: e.clientX, y: e.clientY, dx: 0, dy: 0, id: e.pointerId };
        c.style.transition = "none";
        try { c.setPointerCapture(e.pointerId); } catch (_) {}
      });
      st.addEventListener("pointermove", (e) => {
        const d = this.drag; if (!d || e.pointerId !== d.id) return;
        d.dx = e.clientX - d.x; d.dy = e.clientY - d.y;
        d.c.style.transform = `translate(${d.dx}px,${d.dy * 0.4}px) rotate(${d.dx / 18}deg)`;
        const p = Math.min(1, Math.abs(d.dx) / 110);
        d.c.querySelector(".lbl-like").style.opacity = d.dx > 0 ? p : 0;
        d.c.querySelector(".lbl-nope").style.opacity = d.dx < 0 ? p : 0;
      });
      const end = () => {
        const d = this.drag; if (!d) return; this.drag = null;
        if (Math.abs(d.dx) > 110) this.commit(d.dx > 0 ? 1 : -1);
        else if (Math.abs(d.dx) < 6 && Math.abs(d.dy) < 6) { reset(d); const f = this.top(); if (f) UI.foodSheet(f, "detail"); }
        else reset(d);
      };
      st.addEventListener("pointerup", end);
      st.addEventListener("pointercancel", end);
      st.addEventListener("click", (e) => { if (e.target.closest("#sw-reshuffle")) this.build(); });
      $("sw-skip").addEventListener("click", () => this.commit(-1));
      $("sw-like").addEventListener("click", () => this.commit(1));
      $("sw-info").addEventListener("click", () => { const f = this.top(); if (f) UI.foodSheet(f, "detail"); });
    }
  };

  /* ============================ 13. THỰC ĐƠN TUẦN ============================ */
  const Plan = {
    load() {
      const p = Store.get(CONFIG.KEYS.PLAN, null), wk = U.dateKey(U.monday());
      state.plan = p && p.week === wk && p.slots ? p : { week: wk, slots: {} };
    },
    save() { Store.set(CONFIG.KEYS.PLAN, state.plan); },
    pool(meal, used) {
      const base = state.foods.filter(i => !isBlocked(i.id) && Engine.matches(i, { purpose: false }));
      const byMeal = base.filter(i => (i.purposes || []).some(p => meal.kw.some(k => U.norm(p).includes(k))));
      const list = byMeal.length ? byMeal : (base.length ? base : state.foods.filter(i => !isBlocked(i.id)));
      const fresh = list.filter(i => !used.has(i.id));
      return fresh.length ? fresh : list;
    },
    usedIds(except) {
      const s = new Set();
      Object.keys(state.plan.slots).forEach(k => { if (k !== except && state.plan.slots[k]) s.add(state.plan.slots[k].id); });
      return s;
    },
    generate() {
      if (!state.foods.length) { toast("Thực đơn đang tải, đợi xíu nhé!"); return; }
      const slots = state.plan.slots, used = new Set();
      Object.keys(slots).forEach(k => { if (slots[k] && slots[k].locked) used.add(slots[k].id); });
      for (let d = 0; d < 7; d++) MEALS.forEach(m => {
        const key = d + "-" + m.k;
        if (slots[key] && slots[key].locked) return;
        const f = Engine.pick(this.pool(m, used));
        if (f) { slots[key] = { id: f.id, locked: false }; used.add(f.id); }
      });
      this.save(); this.render(); U.buzz(20); toast("Đã lên thực đơn cho cả tuần! 🎉", "success");
    },
    reroll(d, mk) {
      const key = d + "-" + mk, slot = state.plan.slots[key], meal = MEALS.find(m => m.k === mk);
      if (slot && slot.locked) { toast("Món đang được khóa 🔒"); return; }
      const f = Engine.pick(this.pool(meal, this.usedIds(key)));
      if (!f) { toast("Không có món phù hợp", "error"); return; }
      state.plan.slots[key] = { id: f.id, locked: false }; this.save(); this.render(); U.buzz(10);
    },
    toggleLock(d, mk) {
      const key = d + "-" + mk, slot = state.plan.slots[key];
      if (!slot) return;
      slot.locked = !slot.locked; this.save(); this.render();
    },
    text() {
      const mon = U.monday();
      return "🍽️ Thực đơn tuần này\n" + DAYS.map((name, d) => {
        const dt = new Date(mon); dt.setDate(mon.getDate() + d);
        const parts = MEALS.map(m => { const s = state.plan.slots[d + "-" + m.k]; const f = s && state.byId.get(s.id); return f ? `${m.icon} ${f.name}` : null; }).filter(Boolean);
        return parts.length ? `${name} (${dt.getDate()}/${dt.getMonth() + 1}): ${parts.join(" · ")}` : null;
      }).filter(Boolean).join("\n");
    },
    render() {
      const mon = U.monday(), today = (new Date().getDay() + 6) % 7;
      $("plan-list").innerHTML = DAYS.map((name, d) => {
        const dt = new Date(mon); dt.setDate(mon.getDate() + d);
        const rows = MEALS.map(m => {
          const key = d + "-" + m.k, s = state.plan.slots[key], f = s && state.byId.get(s.id);
          return `<div class="slot">
            <div class="slot-ico"><span>${m.icon}</span>${m.label}</div>
            ${f ? `<button class="slot-main" data-pa="open" data-id="${U.esc(f.id)}">${U.emoji(f)} ${U.esc(f.name)}</button>`
                : `<button class="slot-main empty-slot" data-pa="reroll" data-d="${d}" data-m="${m.k}">＋ Chọn món</button>`}
            ${f ? `<button class="mini ${s.locked ? "on" : ""}" data-pa="lock" data-d="${d}" data-m="${m.k}" aria-label="Khóa"><i data-lucide="lock"></i></button>
                   <button class="mini" data-pa="reroll" data-d="${d}" data-m="${m.k}" aria-label="Đổi món"><i data-lucide="refresh-cw"></i></button>` : ""}
          </div>`;
        }).join("");
        return `<div class="plan-day ${d === today ? "today" : ""}"><h4>${name}${d === today ? " · Hôm nay" : ""}<small>${dt.getDate()}/${dt.getMonth() + 1}</small></h4>${rows}</div>`;
      }).join("");
      icons();
    },
    bind() {
      $("btn-plan-gen").addEventListener("click", () => this.generate());
      $("btn-plan-clear").addEventListener("click", () => {
        if (!Object.keys(state.plan.slots).length) return;
        if (!confirm("Xóa toàn bộ thực đơn tuần này?")) return;
        state.plan.slots = {}; this.save(); this.render();
      });
      $("btn-plan-share").addEventListener("click", async () => {
        if (!Object.keys(state.plan.slots).length) { toast("Hãy tạo thực đơn trước nhé!"); return; }
        const text = this.text();
        if (navigator.share) { try { await navigator.share({ title: "Thực đơn tuần này", text }); } catch (_) {} }
        else { try { await navigator.clipboard.writeText(text); toast("Đã sao chép thực đơn tuần", "success"); } catch (_) { toast("Không thể sao chép", "error"); } }
      });
      $("plan-list").addEventListener("click", (e) => {
        const b = e.target.closest("[data-pa]"); if (!b) return;
        const a = b.dataset.pa;
        if (a === "open") { const f = state.byId.get(b.dataset.id); if (f) UI.foodSheet(f, "detail"); }
        else if (a === "reroll") this.reroll(Number(b.dataset.d), b.dataset.m);
        else if (a === "lock") this.toggleLock(Number(b.dataset.d), b.dataset.m);
      });
    }
  };

  /* ============================ 14. APP ============================ */
  function applyTheme() {
    document.documentElement.setAttribute("data-theme", state.settings.theme);
    const meta = $("meta-theme"); if (meta) meta.setAttribute("content", state.settings.theme === "dark" ? "#0d0912" : "#fff7f1");
    $("btn-theme").innerHTML = `<i data-lucide="${state.settings.theme === "dark" ? "sun" : "moon"}"></i>`;
    icons();
  }

  function switchView(name) {
    state.view = name;
    $$(".view").forEach(v => v.classList.toggle("active", v.id === "view-" + name));
    $$(".tab").forEach(t => t.classList.toggle("on", t.dataset.view === name));
    window.scrollTo({ top: 0 });
    if (name === "swipe" && (Swipe.dirty || !Swipe.deck.length)) Swipe.build();
    if (name === "explore") UI.renderExplore();
    if (name === "plan") Plan.render();
    if (name === "me") UI.renderMe();
    if (name === "home") UI.renderHome();
    icons();
  }

  function onFiltersChanged(silentSheet) {
    Store.set(CONFIG.KEYS.FILTERS, state.filters);
    Swipe.dirty = true; state.exploreLimit = CONFIG.EXPLORE_PAGE;
    UI.renderHome(); UI.renderGroupChips(); UI.renderFilterBadges();
    if (state.view === "explore") UI.renderExplore();
    if (state.view === "swipe") Swipe.build();
    if (state.view === "me") UI.renderMe();
    const btn = $("filter-apply-btn"); if (btn) btn.textContent = `Xem ${Engine.pool().length} món`;
  }

  const App = {
    async init() {
      state.favorites = Store.get(CONFIG.KEYS.FAV, []);
      state.history = Store.get(CONFIG.KEYS.HIST, []);
      state.blocked = Store.get(CONFIG.KEYS.BLOCK, []);
      Object.assign(state.filters, Store.get(CONFIG.KEYS.FILTERS, {}));
      Object.assign(state.settings, Store.get(CONFIG.KEYS.SETTINGS, {}));
      Plan.load();
      applyTheme();
      UI.renderHome(); UI.renderSkeleton(); UI.renderFilterBadges();
      Stage.init(); Swipe.bind(); Plan.bind(); this.bindEvents();
      if (state.settings.shake && typeof DeviceMotionEvent !== "undefined" && typeof DeviceMotionEvent.requestPermission !== "function") Shake.enable();
      icons();
      Ctx.init();            // chạy song song, không chặn việc tải thực đơn
      await this.load(false);
    },

    setFoods(foods) {
      state.foods = foods; state.byId = new Map(foods.map(f => [f.id, f]));
      const g = new Set(), p = new Set(), d = new Set();
      foods.forEach(f => { if (f.group) g.add(f.group); (f.purposes || []).forEach(x => p.add(x)); (f.districts || []).forEach(x => d.add(x)); });
      state.meta = { groups: [...g].sort((a, b) => a.localeCompare(b, "vi")), purposes: [...p].sort(), districts: [...d].sort((a, b) => a.localeCompare(b, "vi")) };
      const f = state.filters;
      if (f.purpose !== "all" && !p.has(f.purpose)) f.purpose = "all";
      if (f.group !== "all" && !g.has(f.group)) f.group = "all";
      if (f.district !== "all" && !d.has(f.district)) f.district = "all";
      Swipe.dirty = true;
      UI.renderHome(); UI.renderGroupChips(); UI.renderExplore(); UI.renderFilterBadges(); UI.renderTrending();
      if (state.view === "plan") Plan.render();
      if (state.view === "me") UI.renderMe();
      icons();
    },

    async load(force) {
      const cached = Store.get(CONFIG.KEYS.CACHE, null);
      let usedCache = false;
      if (!force && cached && cached.foods && cached.foods.length) {
        this.setFoods(cached.foods); usedCache = true;
        if (Date.now() - cached.ts < CONFIG.CACHE_MAX_AGE_MS) { this.loadTrending(); return; }
      } else UI.renderSkeleton();

      try {
        const foods = await Api.fetchAll(force);
        this.setFoods(foods);
        Store.set(CONFIG.KEYS.CACHE, { ts: Date.now(), foods });
        if (force) toast("Đã cập nhật thực đơn mới nhất!", "success");
        this.loadTrending();
      } catch (err) {
        if (usedCache) { toast("Đang dùng dữ liệu đã lưu trên máy"); return; }
        $("foods-grid-container").innerHTML = `<div class="empty"><span class="big">😵</span>Không thể tải thực đơn<br><small>${U.esc(err.message)}</small><br><br><button class="btn-primary" id="btn-retry">Thử lại</button></div>`;
        $("food-count-label").textContent = "Lỗi kết nối";
        $("filtered-candidates-counter").textContent = "Chưa có dữ liệu";
      }
    },

    loadTrending() {
      Api.getTrending().then(res => {
        state.trending = (res.data || []).filter(t => state.byId.has(t.id)).slice(0, 8);
        UI.renderTrending();
      }).catch(() => {});
    },

    spin() {
      if (state.busy) return;
      if (!state.foods.length) { toast("Thực đơn đang tải, đợi xíu nhé!"); return; }
      if (state.view !== "home") { switchView("home"); setTimeout(() => App.spin(), 350); return; }
      const picked = Engine.pick(Engine.pool({ recent: true }));
      if (!picked) { toast("Không có món nào khớp bộ lọc 😢", "error"); return; }
      state.busy = true; U.buzz(25); Shake.enable();
      $("btn-hero-spin").disabled = true;
      $("spin-btn-label").textContent = "Đang trộn nguyên liệu...";
      Stage.caption("🔥 Đang nấu...");
      Stage.tint(U.hue(picked));
      Stage.play(
        () => App.reveal(picked),
        () => {
          state.busy = false;
          $("btn-hero-spin").disabled = false;
          $("spin-btn-label").textContent = "Khui món ngẫu nhiên";
          Stage.caption("Chạm vào tô để khui món");
        }
      );
    },

    reveal(food) {
      addHistory(food);
      celebrate(U.emoji(food));
      U.buzz([30, 40, 60]);
      UI.foodSheet(food, "result");
      UI.renderHome();
    },

    bindEvents() {
      $("btn-hero-spin").addEventListener("click", () => App.spin());
      window.addEventListener("keydown", (e) => {
        if (e.code === "Space" && (e.target === document.body) && !Sheet.open && state.view === "home") { e.preventDefault(); App.spin(); }
        if (e.key === "Escape" && Sheet.open) Sheet.close();
      });

      $("tabbar").addEventListener("click", (e) => { const t = e.target.closest(".tab"); if (t) switchView(t.dataset.view); });
      $("btn-theme").addEventListener("click", () => {
        state.settings.theme = state.settings.theme === "dark" ? "light" : "dark";
        Store.set(CONFIG.KEYS.SETTINGS, state.settings); applyTheme();
      });
      $("btn-force-refresh").addEventListener("click", () => { this.load(true); Ctx.refreshWeather(true); });

      // Thẻ ngữ cảnh (giờ/vị trí/thời tiết) + nút trong tab "Của tôi"
      document.addEventListener("click", (e) => {
        if (e.target.closest("[data-ctx-locate]")) { Ctx.locate(false); return; }
        if (e.target.closest("[data-ctx-refresh]")) { toast("Đang cập nhật thời tiết..."); Ctx.refreshWeather(true); return; }
        if (e.target.closest("[data-ctx-spin]")) { App.spin(); }
      });

      // Mở bộ lọc
      $$(".js-open-filter").forEach(b => b.addEventListener("click", () => UI.filterSheet()));

      // Sheet
      $("sheet-close").addEventListener("click", () => Sheet.close());
      $("sheet-backdrop").addEventListener("click", () => Sheet.close());

      // Mood chips + pill + trending
      $("mood-chips").addEventListener("click", (e) => { const c = e.target.closest("[data-mood]"); if (c) this.applyMood(c.dataset.mood); });
      $("smart-time-pill").addEventListener("click", () => this.applyMood("time"));
      $("trending-list").addEventListener("click", (e) => { const c = e.target.closest("[data-open]"); if (c) { const f = state.byId.get(c.dataset.open); if (f) UI.foodSheet(f, "detail"); } });

      // Explore
      let st = null;
      $("search-box").addEventListener("input", (e) => {
        clearTimeout(st);
        st = setTimeout(() => { state.keyword = e.target.value; state.exploreLimit = CONFIG.EXPLORE_PAGE; UI.renderExplore(); }, 220);
      });
      $("group-chips").addEventListener("click", (e) => {
        const c = e.target.closest("[data-group]"); if (!c) return;
        state.filters.group = c.dataset.group; onFiltersChanged();
      });
      $("btn-load-more").addEventListener("click", () => { state.exploreLimit += CONFIG.EXPLORE_PAGE; UI.renderExplore(); });
      $("foods-grid-container").addEventListener("click", (e) => {
        if (e.target.closest("#btn-retry")) { this.load(true); return; }
        if (e.target.closest("[data-act-reset]")) { this.resetFilters(); state.keyword = ""; $("search-box").value = ""; return; }
        const fb = e.target.closest("[data-fav]");
        if (fb) { e.stopPropagation(); const f = state.byId.get(fb.dataset.fav); if (f) setFav(f, !isFav(f.id)); return; }
        const row = e.target.closest("[data-open]");
        if (row) { const f = state.byId.get(row.dataset.open); if (f) UI.foodSheet(f, "detail"); }
      });

      // Me
      $("me-seg").addEventListener("click", (e) => { const b = e.target.closest("button[data-tab]"); if (b) { state.meTab = b.dataset.tab; UI.renderMe(); } });
      $("view-me").addEventListener("click", (e) => {
        const un = e.target.closest("[data-unfav]");
        if (un) { e.stopPropagation(); const id = un.dataset.unfav; const f = state.byId.get(id) || state.favorites.find(x => x.id === id); if (f) setFav(f, false); return; }
        const ub = e.target.closest("[data-unblock]");
        if (ub) { e.stopPropagation(); const f = state.blocked.find(x => x.id === ub.dataset.unblock); if (f) { setBlock(f, false); toast(`Đã bỏ chặn "${f.name}"`); UI.renderMe(); } return; }
        if (e.target.closest("[data-clear-hist]")) { state.history = []; Store.set(CONFIG.KEYS.HIST, []); UI.renderMe(); toast("Đã xóa lịch sử"); return; }
        if (e.target.closest("[data-clear-all]")) {
          if (!confirm("Xóa toàn bộ món đã lưu, lịch sử, món đã chặn và thực đơn tuần?")) return;
          Object.values(CONFIG.KEYS).forEach(k => { try { localStorage.removeItem(k); } catch (_) {} });
          state.favorites = []; state.history = []; state.blocked = []; state.plan = { week: U.dateKey(U.monday()), slots: {} };
          this.resetFilters(); UI.renderMe(); toast("Đã xóa dữ liệu trên máy", "success"); return;
        }
        const row = e.target.closest("[data-open]");
        if (row) { const f = state.byId.get(row.dataset.open); if (f) UI.foodSheet(f, "detail"); else toast("Món này không còn trong thực đơn"); }
      });
      $("view-me").addEventListener("change", (e) => {
        const s = e.target.closest("[data-set]"); if (!s) return;
        state.settings[s.dataset.set] = s.checked; Store.set(CONFIG.KEYS.SETTINGS, state.settings);
        if (s.dataset.set === "shake" && s.checked) Shake.enable();
      });

      // Sheet body: bộ lọc + hành động món
      $("sheet-body").addEventListener("change", (e) => {
        const el = e.target.closest("[data-filter]"); if (!el) return;
        state.filters[el.dataset.filter] = el.type === "checkbox" ? el.checked : el.value;
        onFiltersChanged();
      });
      $("sheet-body").addEventListener("click", (e) => {
        const el = e.target.closest("[data-act]"); if (!el) return;
        const act = el.dataset.act, food = state.current;
        switch (act) {
          case "filter-reset": this.resetFilters(); UI.filterSheet(); break;
          case "filter-done": Sheet.close(); break;
          case "reroll": Sheet.close(); setTimeout(() => App.spin(), 320); break;
          case "choose":
            if (food) { addHistory(food); celebrate(U.emoji(food)); U.buzz([20, 30, 40]); toast(`Chốt rồi: ${food.name}! Ăn ngon nhé 😋`, "success"); Sheet.close(); UI.renderHome(); }
            break;
          case "order":
            // Không preventDefault: để thẻ <a> tự mở app/web. Chép sẵn tên món để dán vào ô tìm kiếm.
            if (food) {
              try { navigator.clipboard && navigator.clipboard.writeText(food.name); } catch (_) {}
              Api.track(food.id, "order");
              U.buzz(15);
              toast(`Đã chép "${food.name}" — dán vào ô tìm kiếm nếu cần`, "success");
            }
            break;
          case "fav": if (food) setFav(food, !isFav(food.id)); break;
          case "block":
            if (!food) break;
            if (isBlocked(food.id)) { setBlock(food, false); el.classList.remove("on"); toast(`Đã bỏ chặn "${food.name}"`); }
            else {
              setBlock(food, true); el.classList.add("on"); toast(`Sẽ không gợi ý "${food.name}" nữa`);
              if (Sheet.mode === "result") { Sheet.close(); setTimeout(() => App.spin(), 320); }
            }
            break;
          case "share": if (food) shareFood(food); break;
          case "venue-random": {
            const els = $$(".venue", $("sheet-body")); if (!els.length) break;
            els.forEach(v => v.classList.remove("hl"));
            const pick = els[Math.floor(Math.random() * els.length)];
            pick.classList.add("hl"); pick.scrollIntoView({ behavior: "smooth", block: "center" }); U.buzz(20);
            break;
          }
          case "copy-addr": {
            const v = state.venues[Number(el.dataset.vi)];
            if (v) { navigator.clipboard.writeText(`${v.restaurant} - ${v.address}`).then(() => toast("Đã chép địa chỉ", "success")).catch(() => toast("Không thể sao chép", "error")); }
            break;
          }
        }
      });
    },

    applyMood(id) {
      const f = state.filters;
      if (id === "all") Object.assign(f, { purpose: "all", group: "all", district: "all", budget: "all" });
      else if (id === "time") {
        const p = findPurposeFor(timeInfo());
        if (!p) { toast("Chưa có món nào gắn với khung giờ này"); return; }
        f.purpose = f.purpose === p ? "all" : p;
        if (f.purpose !== "all") toast(`Đã lọc: ${p}`);
      }
      else if (id === "cheap") f.budget = f.budget === "max:50000" ? "all" : "max:50000";
      else if (id === "treat") f.budget = f.budget === "min:100000" ? "all" : "min:100000";
      U.buzz(10); onFiltersChanged();
    },

    resetFilters() {
      Object.assign(state.filters, { purpose: "all", group: "all", district: "all", budget: "all", sort: "default", excludeRecent: true });
      onFiltersChanged();
    }
  };

  window.AgdApp = App;
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", () => App.init());
  else App.init();
})();
