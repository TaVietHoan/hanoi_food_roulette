/**
 * ============================================================================
 * DỰ ÁN: ĂN GÌ ĐÂY? (SMART FOOD ENGINE v3.0 - MOBILE EDITION)
 * File: app.js - Xử lý Logic Hộp Bí Ẩn 3D, GPS Geolocation, Lắc Điện Thoại,
 *                Đồng Hồ Thực, Đặt Đồ 1-Chạm ShopeeFood/GrabFood/Be
 * ============================================================================
 */

(function () {
  'use strict';

  // 1. CẤU HÌNH HỆ THỐNG
  const CONFIG = {
    APP_NAME: "Ăn Gì Đây?",
    API_URL: "https://script.google.com/macros/s/AKfycbxoKW24CyLJCYxNpy-fL6-WvsJTYbDjZRbYW0DHGnKNlHKoaLfMBKjQvi0Oa3SZS_9A/exec",
    STORAGE_KEYS: {
      FAVORITES: "agd_fav_v3_dark",
      HISTORY: "agd_hist_v3_dark",
      USER_LOCATION: "agd_user_loc_v3"
    },
    HISTORY_MAX_ITEMS: 30,
    REQUEST_TIMEOUT_MS: 16000,
    SHAKE_THRESHOLD: 18 // Ngưỡng gia tốc lắc điện thoại
  };

  // 2. TRẠNG THÁI TOÀN CỤC
  const state = {
    foods: [],
    filteredFoods: [],
    currentFood: null,
    favorites: [],
    history: [],
    userLocation: null, // { lat, lng, district, addressName }
    filtersMeta: {
      groups: [],
      purposes: [],
      districts: []
    },
    activeFilters: {
      purpose: "all",
      group: "all",
      district: "all",
      maxBudget: "all",
      keyword: "",
      excludeRecent: true
    },
    isLoading: false,
    isSpinning: false,
    lastShakeTime: 0
  };

  // 3. TIỆN ÍCH HỖ TRỢ
  const Utils = {
    escapeHTML(str) {
      if (!str) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    },
    normalizeVietnamese(str) {
      if (!str) return "";
      return str
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .replace(/đ/g, "d")
        .replace(/Đ/g, "d")
        .trim();
    },
    formatCurrency(val) {
      if (val === null || val === undefined || isNaN(val)) return "Bình dân";
      return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(val);
    },
    isValidUrl(string) {
      if (!string || typeof string !== "string") return false;
      try {
        const u = new URL(string);
        return u.protocol === "http:" || u.protocol === "https:";
      } catch (_) {
        return false;
      }
    },
    vibrate(pattern = 40) {
      if ("vibrate" in navigator) {
        try { navigator.vibrate(pattern); } catch (_) {}
      }
    },
    // Tạo link app đặt món trực tiếp
    getDeliveryLinks(foodName, restaurantName = "") {
      const q = encodeURIComponent((restaurantName ? restaurantName + " " : "") + foodName);
      return {
        shopeeFood: `https://shopeefood.vn/search?q=${q}`,
        grabFood: `https://food.grab.com/vn/vi/restaurants?search=${q}`,
        beFood: `https://be.com.vn/`
      };
    }
  };

  // 4. STORAGE VỚI HIỆU ỨNG THÔNG BÁO TỐI GIẢN
  const Storage = {
    get(key, fallback) {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value, message = "Đã lưu tùy chọn") {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        this.flashSilentIndicator(message);
      } catch (e) {
        console.warn("Storage error", e);
      }
    },
    flashSilentIndicator(message) {
      const el = document.getElementById("silent-save-indicator");
      const txt = document.getElementById("silent-save-text");
      if (!el) return;
      if (txt && message) txt.textContent = message;
      el.classList.remove("opacity-0");
      setTimeout(() => el.classList.add("opacity-0"), 1600);
    }
  };

  // 5. API CLIENT JSONP CHO GOOGLE APPS SCRIPT
  const ApiClient = {
    fetchWithJsonp(url, params = {}) {
      return new Promise((resolve, reject) => {
        const cbName = "agd_cb_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now();
        params.callback = cbName;

        const query = Object.keys(params)
          .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
          .join("&");

        const fullUrl = url + (url.indexOf("?") === -1 ? "?" : "&") + query;
        const script = document.createElement("script");
        script.src = fullUrl;
        script.async = true;

        const cleanup = () => {
          if (window[cbName]) delete window[cbName];
          if (script.parentNode) script.parentNode.removeChild(script);
        };

        const timer = setTimeout(() => {
          cleanup();
          reject(new Error("Quá thời gian phản hồi từ máy chủ Apps Script!"));
        }, CONFIG.REQUEST_TIMEOUT_MS);

        window[cbName] = function (data) {
          clearTimeout(timer);
          cleanup();
          if (data && data.success) {
            resolve(data);
          } else {
            reject(new Error(data && data.error ? data.error : "Không thể lấy dữ liệu"));
          }
        };

        script.onerror = function () {
          clearTimeout(timer);
          cleanup();
          reject(new Error("Lỗi mạng khi kết nối tới máy chủ Google Apps Script"));
        };

        document.head.appendChild(script);
      });
    },

    async getFoods(forceRefresh = false) {
      return await this.fetchWithJsonp(CONFIG.API_URL, {
        action: "getFoods",
        limit: 150,
        refresh: forceRefresh ? "true" : "false"
      });
    }
  };

  // 6. THREE.JS 3D MYSTERY BOX STAGE (HỘP BÍ ẨN ẨM THỰC THAY CHO LỒNG BÀN)
  const ThreeMysteryStage = {
    scene: null,
    camera: null,
    renderer: null,
    boxGroup: null,
    boxLid: null,
    innerCore: null,
    particles: null,
    isOpen: false,
    openProgress: 0,

    init() {
      const container = document.getElementById("three-stage-container");
      if (!container || typeof THREE === "undefined") return;

      const width = container.clientWidth || 300;
      const height = container.clientHeight || 300;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
      this.camera.position.set(0, 3.2, 5.0);
      this.camera.lookAt(0, 0.2, 0);

      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(this.renderer.domElement);

      // Studio Neon Lighting
      const ambLight = new THREE.AmbientLight(0xffffff, 0.8);
      this.scene.add(ambLight);

      const pointOrange = new THREE.PointLight(0xff5722, 2.8, 12);
      pointOrange.position.set(2, 3, 3);
      this.scene.add(pointOrange);

      const pointCyan = new THREE.PointLight(0x06b6d4, 2.0, 10);
      pointCyan.position.set(-3, -1, -2);
      this.scene.add(pointCyan);

      // Nhóm khối hộp bí ẩn
      this.boxGroup = new THREE.Group();
      this.scene.add(this.boxGroup);

      // Vật liệu thân hộp & nắp
      const boxMat = new THREE.MeshStandardMaterial({
        color: 0x161f36,
        metalness: 0.85,
        roughness: 0.2,
      });

      const goldTrimMat = new THREE.MeshStandardMaterial({
        color: 0xffa000,
        metalness: 0.95,
        roughness: 0.15,
        emissive: 0xff6f00,
        emissiveIntensity: 0.25
      });

      // 1. Thân hộp (Base)
      const baseGeo = new THREE.BoxGeometry(2.0, 1.2, 2.0);
      const baseMesh = new THREE.Mesh(baseGeo, boxMat);
      baseMesh.position.y = -0.1;
      this.boxGroup.add(baseMesh);

      // Đai vàng viền thân hộp
      const rimGeo = new THREE.BoxGeometry(2.05, 0.15, 2.05);
      const rimMesh = new THREE.Mesh(rimGeo, goldTrimMat);
      rimMesh.position.y = 0.45;
      this.boxGroup.add(rimMesh);

      // 2. Nắp hộp (Lid)
      this.boxLid = new THREE.Group();
      this.boxLid.position.y = 0.55;

      const lidGeo = new THREE.BoxGeometry(2.1, 0.35, 2.1);
      const lidMesh = new THREE.Mesh(lidGeo, boxMat);
      this.boxLid.add(lidMesh);

      const lidKnob = new THREE.Mesh(new THREE.OctahedronGeometry(0.3, 0), goldTrimMat);
      lidKnob.position.y = 0.35;
      this.boxLid.add(lidKnob);

      this.boxGroup.add(this.boxLid);

      // 3. Lõi năng lượng ngọc ẩm thực (Inner glowing food core)
      const coreGeo = new THREE.IcosahedronGeometry(0.48, 1);
      const coreMat = new THREE.MeshStandardMaterial({
        color: 0xff5722,
        emissive: 0xff7043,
        emissiveIntensity: 0.8,
        wireframe: false
      });
      this.innerCore = new THREE.Mesh(coreGeo, coreMat);
      this.innerCore.position.y = 0.2;
      this.innerCore.scale.set(0.01, 0.01, 0.01);
      this.boxGroup.add(this.innerCore);

      // 4. Hạt bụi ánh sáng thần kỳ (Particles)
      const pCount = 60;
      const pGeo = new THREE.BufferGeometry();
      const pPos = new Float32Array(pCount * 3);
      for (let i = 0; i < pCount * 3; i += 3) {
        pPos[i] = (Math.random() - 0.5) * 2.8;
        pPos[i + 1] = Math.random() * 2.0;
        pPos[i + 2] = (Math.random() - 0.5) * 2.8;
      }
      pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
      const pMat = new THREE.PointsMaterial({
        size: 0.08,
        color: 0xffb74d,
        transparent: true,
        opacity: 0.2
      });
      this.particles = new THREE.Points(pGeo, pMat);
      this.scene.add(this.particles);

      // Vòng lặp Render Animation
      const animate = () => {
        requestAnimationFrame(animate);

        this.particles.rotation.y += 0.003;

        if (!this.isOpen) {
          // Xoay nhẹ nhàng chờ mở
          this.boxGroup.rotation.y += 0.008;
          this.boxGroup.position.y = Math.sin(Date.now() * 0.003) * 0.06;
          this.innerCore.scale.set(0.01, 0.01, 0.01);
        } else {
          // Hiệu ứng mở nắp giật tung bay lên cao
          if (this.openProgress < 1) {
            this.openProgress += 0.045;
            const ease = Math.sin(this.openProgress * Math.PI / 2);
            
            this.boxLid.position.y = 0.55 + ease * 2.2;
            this.boxLid.rotation.x = -ease * 0.6;
            this.boxLid.rotation.y += 0.15;

            const coreScale = THREE.MathUtils.lerp(0.01, 1.25, ease);
            this.innerCore.scale.set(coreScale, coreScale, coreScale);
            this.innerCore.rotation.x += 0.05;
            this.innerCore.rotation.y += 0.08;

            this.particles.material.opacity = 0.9;
          }
        }

        this.renderer.render(this.scene, this.camera);
      };
      animate();

      window.addEventListener("resize", () => {
        if (!container || !this.camera || !this.renderer) return;
        const w = container.clientWidth;
        const h = container.clientHeight;
        this.camera.aspect = w / h;
        this.camera.updateProjectionMatrix();
        this.renderer.setSize(w, h);
      });
    },

    triggerOpen(callback) {
      if (!this.boxLid) {
        if (callback) callback();
        return;
      }

      this.isOpen = true;
      this.openProgress = 0;
      Utils.vibrate([60, 40, 80]);

      const caption = document.getElementById("stage-status-caption");
      if (caption) caption.textContent = "⚡ Đang mở hộp báu vật...";

      // Rung lắc kích thích trước khi nắp bật lên
      let shakes = 0;
      const shakeTimer = setInterval(() => {
        this.boxGroup.position.x = (Math.random() - 0.5) * 0.12;
        shakes++;
        if (shakes > 6) {
          clearInterval(shakeTimer);
          this.boxGroup.position.x = 0;
        }
      }, 40);

      setTimeout(() => {
        if (callback) callback();
        if (caption) caption.textContent = "Báu vật ẩm thực đã xuất hiện!";

        // Tự động đóng nắp lại sau 3.5s để sẵn sàng cho lần quay tiếp
        setTimeout(() => {
          const closeTimer = setInterval(() => {
            this.openProgress -= 0.05;
            const ease = Math.max(0, this.openProgress);
            this.boxLid.position.y = 0.55 + ease * 2.2;
            this.boxLid.rotation.x = -ease * 0.6;

            const coreScale = THREE.MathUtils.lerp(0.01, 1.25, ease);
            this.innerCore.scale.set(coreScale, coreScale, coreScale);

            if (this.openProgress <= 0) {
              clearInterval(closeTimer);
              this.isOpen = false;
              this.boxLid.position.y = 0.55;
              this.boxLid.rotation.x = 0;
              this.particles.material.opacity = 0.2;
              if (caption) caption.textContent = "Hộp Thần Bí Đang Chờ Mở";
            }
          }, 25);
        }, 3600);
      }, 600);
    }
  };

  // 7. TOAST THÔNG BÁO HIỆN ĐẠI
  function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "flex items-center gap-3 px-4 py-3 rounded-2xl text-xs font-bold shadow-2xl backdrop-blur-xl border transition-all duration-300 pointer-events-auto transform translate-y-4 opacity-0";

    if (type === "success") {
      toast.classList.add("bg-dark-900/95", "text-emerald-300", "border-emerald-500/50");
      toast.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i><span>${Utils.escapeHTML(message)}</span>`;
    } else if (type === "error") {
      toast.classList.add("bg-rose-950/95", "text-rose-200", "border-rose-500/50");
      toast.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 text-rose-400"></i><span>${Utils.escapeHTML(message)}</span>`;
    } else {
      toast.classList.add("bg-dark-900/95", "text-white", "border-brand-500/40");
      toast.innerHTML = `<i data-lucide="sparkles" class="w-4 h-4 text-brand-400"></i><span>${Utils.escapeHTML(message)}</span>`;
    }

    container.appendChild(toast);
    lucide.createIcons();

    requestAnimationFrame(() => toast.classList.remove("translate-y-4", "opacity-0"));

    setTimeout(() => {
      toast.classList.add("translate-y-2", "opacity-0");
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // 8. BẮN PHÁO HOA ĂN MỪNG
  function fireConfetti() {
    if (typeof confetti === "function") {
      confetti({
        particleCount: 70,
        spread: 60,
        origin: { y: 0.7 },
        colors: ['#ff5722', '#10b981', '#f59e0b', '#06b6d4', '#ec4899']
      });
    }
  }

  // 9. THUẬT TOÁN CHỌN MÓN THÔNG MINH
  const FoodEngine = {
    getCandidates() {
      const f = state.activeFilters;
      let list = state.foods.slice();

      if (f.purpose && f.purpose !== "all") {
        list = list.filter(item => item.purposes && item.purposes.includes(f.purpose));
      }

      if (f.group && f.group !== "all") {
        list = list.filter(item => item.group === f.group);
      }

      if (f.district && f.district !== "all") {
        list = list.filter(item => item.districts && item.districts.includes(f.district));
      }

      if (f.maxBudget && f.maxBudget !== "all") {
        const budget = parseInt(f.maxBudget, 10);
        list = list.filter(item => {
          if (item.minPrice === null) return true;
          return item.minPrice <= budget;
        });
      }

      // Loại trừ các món vừa ăn gần đây
      if (f.excludeRecent && state.history.length > 0) {
        const recentIds = state.history.slice(0, 5).map(h => h.id);
        const filtered = list.filter(item => !recentIds.includes(item.id));
        if (filtered.length > 0) list = filtered;
      }

      return list;
    },

    spin() {
      const candidates = this.getCandidates();
      if (!candidates.length) return null;
      const index = Math.floor(Math.random() * candidates.length);
      return candidates[index];
    }
  };

  // 10. GIAO DIỆN & TƯƠNG TÁC NGƯỜI DÙNG (MOBILE-FIRST)
  const UI = {
    initElements() {
      this.dom = {
        foodsGrid: document.getElementById("foods-grid-container"),
        foodCountLabel: document.getElementById("food-count-label"),
        searchBox: document.getElementById("search-box"),
        candidatesCounter: document.getElementById("filtered-candidates-counter"),
        filterPurpose: document.getElementById("filter-purpose"),
        filterGroup: document.getElementById("filter-group"),
        filterDistrict: document.getElementById("filter-district"),
        filterBudget: document.getElementById("filter-budget"),
        chkExcludeRecent: document.getElementById("chk-exclude-recent"),
        btnResetFilters: document.getElementById("btn-reset-filters"),
        btnHeroSpin: document.getElementById("btn-hero-spin"),
        spinBtnLabel: document.getElementById("spin-btn-label"),
        btnSpinAgain: document.getElementById("btn-spin-again"),
        btnScrollMenu: document.getElementById("btn-scroll-menu"),
        smartTimePill: document.getElementById("smart-time-pill"),
        smartTimeText: document.getElementById("smart-time-text"),
        liveClock: document.getElementById("live-clock"),
        btnRequestGps: document.getElementById("btn-request-gps"),
        gpsLocationText: document.getElementById("gps-location-text"),
        randomSection: document.getElementById("random-result-section"),
        resName: document.getElementById("res-food-name"),
        resDesc: document.getElementById("res-food-desc"),
        resMetaChips: document.getElementById("res-meta-chips"),
        resVenuesCount: document.getElementById("res-venues-count"),
        resVenuesContainer: document.getElementById("res-venues-container"),
        linkShopeeFood: document.getElementById("link-shopeefood"),
        linkGrabFood: document.getElementById("link-grabfood"),
        linkBeFood: document.getElementById("link-befood"),
        btnShareRes: document.getElementById("btn-share-res"),
        btnToggleFavRes: document.getElementById("btn-toggle-fav-res"),
        modal: document.getElementById("detail-modal"),
        modalTitle: document.getElementById("modal-title"),
        modalBody: document.getElementById("modal-body-content"),
        modalCloseBtn: document.getElementById("modal-close-btn"),
        favBadge: document.getElementById("fav-count-badge"),
        btnOpenFavorites: document.getElementById("btn-open-favorites"),
        btnOpenHistory: document.getElementById("btn-open-history"),
        btnForceRefresh: document.getElementById("btn-force-refresh"),
        tabNavRandom: document.getElementById("tab-nav-random"),
        tabNavExplore: document.getElementById("tab-nav-explore"),
        tabNavFav: document.getElementById("tab-nav-favorites"),
        tabNavHist: document.getElementById("tab-nav-history")
      };
    },

    populateFilterOptions() {
      const { groups, purposes, districts } = state.filtersMeta;

      if (purposes?.length) {
        this.dom.filterPurpose.innerHTML = '<option value="all">Tất cả bữa ăn</option>' +
          purposes.map(p => `<option value="${Utils.escapeHTML(p)}">${Utils.escapeHTML(p)}</option>`).join("");
      }

      if (groups?.length) {
        this.dom.filterGroup.innerHTML = '<option value="all">Tất cả nhóm món</option>' +
          groups.map(g => `<option value="${Utils.escapeHTML(g)}">${Utils.escapeHTML(g)}</option>`).join("");
      }

      if (districts?.length) {
        this.dom.filterDistrict.innerHTML = '<option value="all">Tất cả khu vực</option>' +
          districts.map(d => `<option value="${Utils.escapeHTML(d)}">${Utils.escapeHTML(d)}</option>`).join("");
      }
    },

    renderSkeleton() {
      let html = "";
      for (let i = 0; i < 6; i++) {
        html += `
          <div class="relative overflow-hidden glass-panel rounded-2xl p-5 h-48 flex flex-col justify-between">
            <div class="skeleton-dark absolute inset-0"></div>
            <div class="space-y-3">
              <div class="w-20 h-4 bg-white/10 rounded-full"></div>
              <div class="w-3/4 h-6 bg-white/10 rounded-xl"></div>
              <div class="w-full h-3 bg-white/5 rounded"></div>
            </div>
            <div class="w-24 h-5 bg-white/10 rounded-full"></div>
          </div>
        `;
      }
      this.dom.foodsGrid.innerHTML = html;
    },

    renderFoodsList(foods) {
      if (!foods || foods.length === 0) {
        this.dom.foodsGrid.innerHTML = `
          <div class="col-span-full text-center py-12 px-4 glass-panel rounded-2xl border border-dashed border-white/10">
            <i data-lucide="soup" class="w-10 h-10 text-slate-500 mx-auto mb-2"></i>
            <h3 class="text-sm font-bold text-white">Không tìm thấy món ăn phù hợp</h3>
            <p class="text-xs text-slate-400 mt-1">Hãy thử xóa bộ lọc hoặc mở rộng ngân sách bạn nhé!</p>
            <button onclick="document.getElementById('btn-reset-filters').click()" class="mt-3 px-4 py-2 rounded-xl bg-brand-600 text-white font-bold text-xs active:scale-95 transition-all">
              Đặt lại bộ lọc
            </button>
          </div>
        `;
        this.dom.foodCountLabel.textContent = "0 món ăn";
        lucide.createIcons();
        return;
      }

      this.dom.foodCountLabel.textContent = `Hiển thị ${foods.length} món ngon chuẩn vị`;

      const cardsHtml = foods.map(item => {
        const isFav = state.favorites.some(f => f.id === item.id);
        const venueCount = item.venues ? item.venues.length : 0;
        const priceText = item.minPrice !== null && item.maxPrice !== null
          ? (item.minPrice === item.maxPrice ? Utils.formatCurrency(item.minPrice) : `${Utils.formatCurrency(item.minPrice)} - ${Utils.formatCurrency(item.maxPrice)}`)
          : (item.minPrice ? Utils.formatCurrency(item.minPrice) : "Giá bình dân");

        return `
          <div class="group food-card glass-panel hover:bg-dark-800/90 rounded-2xl p-4 sm:p-5 border border-white/10 hover:border-brand-500/50 active:scale-[0.99] transition-all duration-200 flex flex-col justify-between cursor-pointer" data-id="${Utils.escapeHTML(item.id)}">
            <div class="space-y-2.5">
              <div class="flex items-center justify-between gap-2">
                <span class="px-2.5 py-0.5 rounded-md bg-white/5 text-slate-300 text-[11px] font-bold">${Utils.escapeHTML(item.group)}</span>
                <button class="btn-card-fav w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isFav ? 'text-rose-500 bg-rose-500/10' : 'text-slate-400 hover:text-rose-400'}" data-id="${Utils.escapeHTML(item.id)}">
                  <i data-lucide="heart" class="w-4 h-4 ${isFav ? 'fill-current' : ''}"></i>
                </button>
              </div>

              <h3 class="font-heading font-black text-lg text-white group-hover:text-brand-400 transition-colors line-clamp-1">${Utils.escapeHTML(item.name)}</h3>
              <p class="text-xs text-slate-400 line-clamp-2 leading-relaxed">${Utils.escapeHTML(item.description || "Hương vị hấp dẫn tuyệt hảo khó cưỡng.")}</p>

              ${venueCount > 0 ? `
                <div class="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded-md">
                  <i data-lucide="map-pin" class="w-3 h-3"></i>
                  <span>${venueCount} quán quanh đây</span>
                </div>
              ` : ''}
            </div>

            <div class="mt-4 pt-3 border-t border-white/5 flex items-center justify-between">
              <span class="text-xs font-black text-amber-400">${Utils.escapeHTML(priceText)}</span>
              <span class="text-[11px] font-bold text-slate-400 group-hover:text-brand-400 flex items-center gap-1">
                Xem ngay <i data-lucide="chevron-right" class="w-3.5 h-3.5"></i>
              </span>
            </div>
          </div>
        `;
      }).join("");

      this.dom.foodsGrid.innerHTML = cardsHtml;
      lucide.createIcons();
    },

    displayRandomResult(food) {
      if (!food) {
        showToast("Không tìm thấy món ăn phù hợp với bộ lọc!", "error");
        return;
      }

      state.currentFood = food;
      this.dom.resName.textContent = food.name;
      this.dom.resDesc.textContent = food.description || "Món ăn tuyệt hảo tiếp thêm năng lượng tràn trề cho ngày của bạn.";

      // Metadata chips
      let chipsHtml = `<span class="px-2.5 py-1 rounded-lg bg-white/10 text-slate-200 text-xs font-bold">${Utils.escapeHTML(food.group)}</span>`;
      if (food.purposes) {
        food.purposes.forEach(p => {
          chipsHtml += `<span class="px-2.5 py-1 rounded-lg bg-amber-500/15 text-amber-300 text-xs font-bold">${Utils.escapeHTML(p)}</span>`;
        });
      }
      const priceText = food.minPrice !== null && food.maxPrice !== null
        ? (food.minPrice === food.maxPrice ? Utils.formatCurrency(food.minPrice) : `${Utils.formatCurrency(food.minPrice)} - ${Utils.formatCurrency(food.maxPrice)}`)
        : "Giá bình dân";
      chipsHtml += `<span class="px-2.5 py-1 rounded-lg bg-brand-500 text-white text-xs font-black">${Utils.escapeHTML(priceText)}</span>`;
      this.dom.resMetaChips.innerHTML = chipsHtml;

      // Cập nhật link đặt đồ ăn tự động (ShopeeFood / GrabFood / Be)
      const delivery = Utils.getDeliveryLinks(food.name, food.venues?.[0]?.restaurant || "");
      this.dom.linkShopeeFood.href = delivery.shopeeFood;
      this.dom.linkGrabFood.href = delivery.grabFood;
      this.dom.linkBeFood.href = delivery.beFood;

      // Render danh sách quán gợi ý
      const venues = food.venues || [];
      this.dom.resVenuesCount.textContent = venues.length;

      if (!venues.length) {
        this.dom.resVenuesContainer.innerHTML = `<p class="col-span-full text-xs text-slate-400 py-2">Món phổ biến, dễ dàng tìm thấy tại các quán quanh khu vực của bạn.</p>`;
      } else {
        this.dom.resVenuesContainer.innerHTML = venues.map(v => `
          <div class="glass-panel p-3 rounded-xl border border-white/10 hover:border-brand-500/40 transition-all flex items-start justify-between gap-2.5">
            <div class="space-y-1 overflow-hidden">
              <div class="font-bold text-xs text-white truncate">${Utils.escapeHTML(v.restaurant)} ${v.district ? `<span class="text-slate-400 font-normal">(${Utils.escapeHTML(v.district)})</span>` : ''}</div>
              <div class="text-[11px] text-slate-400 leading-snug line-clamp-1">${Utils.escapeHTML(v.address || "Địa chỉ cập nhật trực tiếp tại quán")}</div>
              ${v.notes ? `<div class="text-[10px] font-semibold text-brand-400 truncate">* ${Utils.escapeHTML(v.notes)}</div>` : ''}
            </div>
            ${v.mapUrl && Utils.isValidUrl(v.mapUrl) ? `
              <a href="${Utils.escapeHTML(v.mapUrl)}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-brand-500 text-slate-200 hover:text-white text-[11px] font-bold shrink-0 transition-colors flex items-center gap-1" title="Chỉ đường Google Maps">
                <i data-lucide="map" class="w-3 h-3"></i> Đường đi
              </a>
            ` : ''}
          </div>
        `).join("");
      }

      // Nút Favorite
      const isFav = state.favorites.some(f => f.id === food.id);
      this.updateFavBtn(this.dom.btnToggleFavRes, isFav);

      // Hiển thị Spotlight Card & Cuộn mượt
      this.dom.randomSection.classList.remove("hidden");
      this.dom.randomSection.scrollIntoView({ behavior: "smooth", block: "center" });

      this.addToHistory(food);
      fireConfetti();
      lucide.createIcons();
    },

    updateFavBtn(btn, isFav) {
      if (!btn) return;
      if (isFav) {
        btn.classList.add("text-rose-500", "border-rose-500/50", "bg-rose-500/10");
        btn.querySelector("svg")?.classList.add("fill-current");
      } else {
        btn.classList.remove("text-rose-500", "border-rose-500/50", "bg-rose-500/10");
        btn.querySelector("svg")?.classList.remove("fill-current");
      }
    },

    updateFavBadge() {
      const count = state.favorites.length;
      if (count > 0) {
        this.dom.favBadge.classList.remove("scale-0");
        this.dom.favBadge.textContent = count > 99 ? "99+" : count;
      } else {
        this.dom.favBadge.classList.add("scale-0");
      }
    },

    addToHistory(food) {
      const item = {
        id: food.id,
        name: food.name,
        group: food.group,
        venuesCount: food.venues ? food.venues.length : 0,
        time: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
        date: new Date().toLocaleDateString("vi-VN")
      };
      state.history.unshift(item);
      if (state.history.length > CONFIG.HISTORY_MAX_ITEMS) state.history.pop();
      Storage.set(CONFIG.STORAGE_KEYS.HISTORY, state.history, "Đã lưu lịch sử");
    },

    openFoodModal(food) {
      if (!food) return;
      this.dom.modalTitle.textContent = food.name;

      const priceText = food.minPrice !== null && food.maxPrice !== null
        ? (food.minPrice === food.maxPrice ? Utils.formatCurrency(food.minPrice) : `${Utils.formatCurrency(food.minPrice)} - ${Utils.formatCurrency(food.maxPrice)}`)
        : "Giá bình dân";

      const delivery = Utils.getDeliveryLinks(food.name, food.venues?.[0]?.restaurant || "");
      const venues = food.venues || [];

      const venuesHtml = venues.length > 0 ? venues.map(v => `
        <div class="glass-panel p-3 rounded-xl border border-white/10 flex items-start justify-between gap-3">
          <div class="space-y-1 overflow-hidden">
            <div class="font-bold text-xs text-white truncate">${Utils.escapeHTML(v.restaurant)} ${v.district ? `<span class="text-slate-400 font-normal">(${Utils.escapeHTML(v.district)})</span>` : ''}</div>
            <div class="text-[11px] text-slate-400">${Utils.escapeHTML(v.address || "Địa chỉ quán")}</div>
            ${v.notes ? `<div class="text-[10px] font-semibold text-brand-400">* ${Utils.escapeHTML(v.notes)}</div>` : ''}
          </div>
          ${v.mapUrl && Utils.isValidUrl(v.mapUrl) ? `
            <a href="${Utils.escapeHTML(v.mapUrl)}" target="_blank" rel="noopener noreferrer" class="px-2.5 py-1 rounded-lg bg-white/10 hover:bg-brand-500 text-slate-200 text-[11px] font-bold shrink-0 transition-colors">
              Chỉ đường
            </a>
          ` : ''}
        </div>
      `).join("") : '<p class="text-xs text-slate-400">Chưa có thông tin quán cụ thể.</p>';

      this.dom.modalBody.innerHTML = `
        <div class="flex flex-wrap gap-2">
          <span class="px-2.5 py-0.5 rounded-md bg-white/10 text-slate-300 text-xs font-bold">${Utils.escapeHTML(food.group)}</span>
          <span class="px-2.5 py-0.5 rounded-md bg-brand-500/20 text-brand-300 border border-brand-500/30 text-xs font-black">${Utils.escapeHTML(priceText)}</span>
        </div>
        <p class="text-slate-300 text-xs sm:text-sm leading-relaxed">${Utils.escapeHTML(food.description || "Hương vị hấp dẫn đặc sắc khó quên.")}</p>

        <!-- Nút đặt giao nhanh trong Modal -->
        <div class="p-3.5 rounded-2xl bg-dark-950 border border-white/10 space-y-2">
          <div class="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
            <i data-lucide="bike" class="w-3.5 h-3.5"></i> Đặt giao đồ ăn ngay:
          </div>
          <div class="grid grid-cols-3 gap-2">
            <a href="${delivery.shopeeFood}" target="_blank" rel="noopener noreferrer" class="py-2 px-2 text-center rounded-xl bg-orange-600/20 border border-orange-500/30 text-orange-300 text-xs font-bold active:scale-95">ShopeeFood</a>
            <a href="${delivery.grabFood}" target="_blank" rel="noopener noreferrer" class="py-2 px-2 text-center rounded-xl bg-emerald-600/20 border border-emerald-500/30 text-emerald-300 text-xs font-bold active:scale-95">GrabFood</a>
            <a href="${delivery.beFood}" target="_blank" rel="noopener noreferrer" class="py-2 px-2 text-center rounded-xl bg-yellow-500/20 border border-yellow-400/30 text-yellow-300 text-xs font-bold active:scale-95">Be Food</a>
          </div>
        </div>

        <div class="space-y-2.5 pt-2">
          <div class="font-bold text-xs text-slate-300 uppercase tracking-wider">Địa điểm phục vụ (${venues.length})</div>
          <div class="space-y-2 max-h-56 overflow-y-auto pr-1">${venuesHtml}</div>
        </div>
      `;

      this.dom.modal.classList.add("modal-active");
      lucide.createIcons();
    },

    openFavoritesModal() {
      this.dom.modalTitle.textContent = `Món Đã Lưu (${state.favorites.length})`;
      if (state.favorites.length === 0) {
        this.dom.modalBody.innerHTML = `
          <div class="text-center py-10 px-4">
            <i data-lucide="heart" class="w-10 h-10 text-slate-600 mx-auto mb-2"></i>
            <p class="text-xs font-bold text-slate-300">Chưa có món ăn nào trong mục yêu thích</p>
            <p class="text-[11px] text-slate-500 mt-1">Bấm biểu tượng trái tim để lưu lại bạn nhé!</p>
          </div>
        `;
      } else {
        this.dom.modalBody.innerHTML = `
          <div class="divide-y divide-white/5 max-h-80 overflow-y-auto pr-1">
            ${state.favorites.map(f => `
              <div class="py-2.5 flex items-center justify-between gap-3">
                <div>
                  <h4 class="font-bold text-xs text-white">${Utils.escapeHTML(f.name)}</h4>
                  <span class="text-[10px] text-slate-400">${Utils.escapeHTML(f.group)}</span>
                </div>
                <div class="flex items-center gap-1.5">
                  <button class="btn-quick-view px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 text-[11px] font-bold active:scale-95 transition-all" data-id="${Utils.escapeHTML(f.id)}">Xem</button>
                  <button class="btn-del-fav px-2.5 py-1 rounded-lg bg-rose-500/20 text-rose-300 text-[11px] font-bold active:scale-95 transition-all" data-id="${Utils.escapeHTML(f.id)}">Xóa</button>
                </div>
              </div>
            `).join("")}
          </div>
        `;
      }
      this.dom.modal.classList.add("modal-active");
      lucide.createIcons();
    },

    openHistoryModal() {
      this.dom.modalTitle.textContent = "Lịch Sử Chọn Món";
      if (state.history.length === 0) {
        this.dom.modalBody.innerHTML = `
          <div class="text-center py-10 px-4">
            <i data-lucide="history" class="w-10 h-10 text-slate-600 mx-auto mb-2"></i>
            <p class="text-xs font-bold text-slate-300">Chưa có lịch sử quay món</p>
            <p class="text-[11px] text-slate-500 mt-1">Hãy nhấn "Mở Hộp Bí Ẩn" để khám phá bữa ăn ngay!</p>
          </div>
        `;
      } else {
        this.dom.modalBody.innerHTML = `
          <div class="flex justify-end pb-1">
            <button id="btn-clear-history" class="text-[11px] font-bold text-rose-400 hover:underline">Xóa tất cả</button>
          </div>
          <div class="divide-y divide-white/5 max-h-80 overflow-y-auto pr-1">
            ${state.history.map(h => `
              <div class="py-2.5 flex items-center justify-between gap-3">
                <div>
                  <h4 class="font-bold text-xs text-white">${Utils.escapeHTML(h.name)}</h4>
                  <span class="text-[10px] text-slate-400">${Utils.escapeHTML(h.group)} • ${Utils.escapeHTML(h.time)}</span>
                </div>
                <button class="btn-quick-view px-2.5 py-1 rounded-lg bg-white/10 hover:bg-white/20 text-slate-200 text-[11px] font-bold active:scale-95 transition-all" data-id="${Utils.escapeHTML(h.id)}">Xem lại</button>
              </div>
            `).join("")}
          </div>
        `;
      }
      this.dom.modal.classList.add("modal-active");
      lucide.createIcons();
    },

    closeModal() {
      this.dom.modal.classList.remove("modal-active");
    }
  };

  // 11. BỘ ĐIỀU KHIỂN TRUNG TÂM (APP CONTROLLER)
  const App = {
    async init() {
      UI.initElements();
      UI.renderSkeleton();

      state.favorites = Storage.get(CONFIG.STORAGE_KEYS.FAVORITES, []);
      state.history = Storage.get(CONFIG.STORAGE_KEYS.HISTORY, []);
      state.userLocation = Storage.get(CONFIG.STORAGE_KEYS.USER_LOCATION, null);
      UI.updateFavBadge();

      this.startLiveClockAndMeal();
      this.initLocationFromStorage();
      ThreeMysteryStage.init();
      this.bindEvents();
      this.initShakeSensor();

      await this.loadData();
    },

    // 11.1 Đồng hồ thời gian thực & Phân tích bữa ăn
    startLiveClockAndMeal() {
      const updateClock = () => {
        const now = new Date();
        const timeStr = now.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
        if (UI.dom.liveClock) UI.dom.liveClock.textContent = timeStr;

        const h = now.getHours();
        let mealLabel = "Bữa chính";
        if (h >= 5 && h < 10) mealLabel = "Bữa sáng";
        else if (h >= 10 && h < 14) mealLabel = "Bữa trưa";
        else if (h >= 14 && h < 17) mealLabel = "Ăn vặt / Xế chiều";
        else if (h >= 17 && h < 22) mealLabel = "Bữa tối";
        else mealLabel = "Ăn đêm";

        if (UI.dom.smartTimeText) UI.dom.smartTimeText.textContent = `Giờ chuẩn: ${mealLabel}`;
        if (UI.dom.smartTimePill) UI.dom.smartTimePill.setAttribute("data-purpose", mealLabel);
      };

      updateClock();
      setInterval(updateClock, 1000);
    },

    // 11.2 Định vị GPS Geolocation trên điện thoại
    initLocationFromStorage() {
      if (state.userLocation && state.userLocation.addressName) {
        UI.dom.gpsLocationText.textContent = state.userLocation.addressName;
      }
    },

    async requestUserLocation() {
      if (!("geolocation" in navigator)) {
        showToast("Thiết bị không hỗ trợ định vị GPS", "error");
        return;
      }

      UI.dom.gpsLocationText.textContent = "Đang quét vệ tinh GPS...";
      Utils.vibrate(30);

      navigator.geolocation.getCurrentPosition(
        async (position) => {
          const lat = position.coords.latitude;
          const lng = position.coords.longitude;

          try {
            // Reverse Geocoding qua OpenStreetMap Nominatim
            const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=14&addressdetails=1`, {
              headers: { "Accept-Language": "vi" }
            });
            const data = await res.json();

            const addr = data.address || {};
            const district = addr.city_district || addr.district || addr.suburb || addr.quarter || addr.town || addr.city || "Gần bạn";
            const city = addr.city || addr.state || "";
            const displayLoc = `${district}${city ? ', ' + city : ''}`;

            state.userLocation = { lat, lng, district, addressName: displayLoc };
            Storage.set(CONFIG.STORAGE_KEYS.USER_LOCATION, state.userLocation, "Đã lưu vị trí GPS");

            UI.dom.gpsLocationText.textContent = displayLoc;
            showToast(`Đã định vị: ${displayLoc}`, "success");
            Utils.vibrate([40, 40]);

            // Tự động gắn bộ lọc khu vực nếu tên quận khớp với dữ liệu
            this.autoMatchDistrictFilter(district);

          } catch (err) {
            UI.dom.gpsLocationText.textContent = `Vị trí: ${lat.toFixed(2)}, ${lng.toFixed(2)}`;
            showToast("Đã lấy tọa độ GPS thành công!", "info");
          }
        },
        (error) => {
          UI.dom.gpsLocationText.textContent = "Bấm để cấp quyền vị trí";
          showToast("Vui lòng bật quyền truy cập vị trí trên điện thoại", "error");
        },
        { timeout: 10000, enableHighAccuracy: true }
      );
    },

    autoMatchDistrictFilter(districtName) {
      if (!districtName || !UI.dom.filterDistrict) return;
      const normUser = Utils.normalizeVietnamese(districtName);
      const options = Array.from(UI.dom.filterDistrict.options);
      
      const matched = options.find(opt => {
        const normOpt = Utils.normalizeVietnamese(opt.value);
        return normOpt !== "all" && (normUser.includes(normOpt) || normOpt.includes(normUser));
      });

      if (matched) {
        UI.dom.filterDistrict.value = matched.value;
        state.activeFilters.district = matched.value;
        this.applyFilters();
        showToast(`Đã ưu tiên quán tại khu vực ${matched.value}`, "success");
      }
    },

    // 11.3 Cảm biến Lắc Điện Thoại (Shake to Pick)
    initShakeSensor() {
      if (typeof window.DeviceMotionEvent !== "undefined") {
        let lastX = null, lastY = null, lastZ = null;

        window.addEventListener("devicemotion", (e) => {
          const acc = e.accelerationIncludingGravity;
          if (!acc || acc.x === null) return;

          if (lastX === null) {
            lastX = acc.x;
            lastY = acc.y;
            lastZ = acc.z;
            return;
          }

          const deltaX = Math.abs(acc.x - lastX);
          const deltaY = Math.abs(acc.y - lastY);
          const deltaZ = Math.abs(acc.z - lastZ);

          lastX = acc.x;
          lastY = acc.y;
          lastZ = acc.z;

          const speed = deltaX + deltaY + deltaZ;
          const now = Date.now();

          if (speed > CONFIG.SHAKE_THRESHOLD && (now - state.lastShakeTime > 2500)) {
            state.lastShakeTime = now;
            Utils.vibrate([50, 50, 100]);
            this.triggerRandomSpin();
          }
        }, false);
      }
    },

    async loadData(forceRefresh = false) {
      try {
        state.isLoading = true;
        const res = await ApiClient.getFoods(forceRefresh);
        state.foods = res.data || [];
        state.filteredFoods = state.foods.slice();

        this.extractFiltersMeta(state.foods);
        UI.populateFilterOptions();
        UI.renderFoodsList(state.filteredFoods);
        this.updateCandidatesCounter();

        if (forceRefresh) {
          showToast("Đã đồng bộ thực đơn mới từ Google Sheets!", "success");
        }
      } catch (err) {
        UI.dom.foodsGrid.innerHTML = `
          <div class="col-span-full text-center py-12 px-4 glass-panel rounded-2xl border border-rose-500/30">
            <h3 class="text-sm font-bold text-rose-400 mb-1">Không thể kết nối máy chủ dữ liệu</h3>
            <p class="text-xs text-slate-400 mb-3">${Utils.escapeHTML(err.message)}</p>
            <button onclick="location.reload()" class="px-5 py-2 rounded-xl bg-brand-600 text-white font-bold text-xs">Thử lại</button>
          </div>
        `;
      } finally {
        state.isLoading = false;
      }
    },

    extractFiltersMeta(foods) {
      const gSet = new Set();
      const pSet = new Set();
      const dSet = new Set();

      foods.forEach(f => {
        if (f.group) gSet.add(f.group);
        if (f.purposes) f.purposes.forEach(p => pSet.add(p));
        if (f.districts) f.districts.forEach(d => dSet.add(d));
      });

      state.filtersMeta.groups = Array.from(gSet).sort();
      state.filtersMeta.purposes = Array.from(pSet).sort();
      state.filtersMeta.districts = Array.from(dSet).sort();
    },

    updateCandidatesCounter() {
      const eligible = FoodEngine.getCandidates();
      UI.dom.candidatesCounter.textContent = `${eligible.length} món sẵn sàng`;
    },

    triggerRandomSpin() {
      if (state.isSpinning || state.foods.length === 0) return;
      state.isSpinning = true;

      UI.dom.btnHeroSpin.disabled = true;
      UI.dom.spinBtnLabel.textContent = "ĐANG KHUI HỘP...";

      ThreeMysteryStage.triggerOpen(() => {
        const picked = FoodEngine.spin();
        UI.dom.btnHeroSpin.disabled = false;
        UI.dom.spinBtnLabel.textContent = "MỞ HỘP BÍ ẨN ẨM THỰC";
        state.isSpinning = false;

        if (picked) {
          UI.displayRandomResult(picked);
          showToast(`Lựa chọn định mệnh: ${picked.name}!`, "success");
        } else {
          showToast("Không có món ăn nào khớp với bộ lọc!", "error");
        }
      });
    },

    bindEvents() {
      // 1. Khui Hộp Bí Ẩn
      UI.dom.btnHeroSpin.addEventListener("click", () => this.triggerRandomSpin());
      UI.dom.btnSpinAgain.addEventListener("click", () => this.triggerRandomSpin());

      // Phím Space
      window.addEventListener("keydown", (e) => {
        if (e.code === "Space" && e.target === document.body && !UI.dom.modal.classList.contains("modal-active")) {
          e.preventDefault();
          this.triggerRandomSpin();
        }
      });

      // 2. Định vị GPS
      UI.dom.btnRequestGps.addEventListener("click", () => this.requestUserLocation());

      // 3. Smart time pill click
      UI.dom.smartTimePill.addEventListener("click", () => {
        const target = UI.dom.smartTimePill.getAttribute("data-purpose");
        const options = Array.from(UI.dom.filterPurpose.options).map(o => o.value);
        const matched = options.find(opt => opt.toLowerCase().includes(target.toLowerCase()));
        if (matched) {
          UI.dom.filterPurpose.value = matched;
          state.activeFilters.purpose = matched;
          this.applyFilters();
          showToast(`Đã lọc theo khung giờ: ${matched}`, "info");
        }
      });

      // 4. Lắng nghe thay đổi bộ lọc
      const onFilterChange = () => {
        state.activeFilters.purpose = UI.dom.filterPurpose.value;
        state.activeFilters.group = UI.dom.filterGroup.value;
        state.activeFilters.district = UI.dom.filterDistrict.value;
        state.activeFilters.maxBudget = UI.dom.filterBudget.value;
        state.activeFilters.excludeRecent = UI.dom.chkExcludeRecent.checked;
        this.applyFilters();
        Utils.vibrate(20);
      };

      UI.dom.filterPurpose.addEventListener("change", onFilterChange);
      UI.dom.filterGroup.addEventListener("change", onFilterChange);
      UI.dom.filterDistrict.addEventListener("change", onFilterChange);
      UI.dom.filterBudget.addEventListener("change", onFilterChange);
      UI.dom.chkExcludeRecent.addEventListener("change", onFilterChange);

      // Đặt lại bộ lọc
      UI.dom.btnResetFilters.addEventListener("click", () => {
        UI.dom.filterPurpose.value = "all";
        UI.dom.filterGroup.value = "all";
        UI.dom.filterDistrict.value = "all";
        UI.dom.filterBudget.value = "all";
        UI.dom.searchBox.value = "";
        UI.dom.chkExcludeRecent.checked = true;
        state.activeFilters = {
          purpose: "all",
          group: "all",
          district: "all",
          maxBudget: "all",
          keyword: "",
          excludeRecent: true
        };
        this.applyFilters();
        showToast("Đã đưa bộ lọc về mặc định", "info");
      });

      // Ô tìm kiếm Debounce
      let searchTimeout = null;
      UI.dom.searchBox.addEventListener("input", (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          state.activeFilters.keyword = e.target.value;
          this.applyFilters();
        }, 200);
      });

      // Scroll menu
      UI.dom.btnScrollMenu.addEventListener("click", () => {
        document.getElementById("explore-view").scrollIntoView({ behavior: "smooth" });
      });

      // Favorite toggle từ Spotlight
      UI.dom.btnToggleFavRes.addEventListener("click", () => {
        if (!state.currentFood) return;
        this.toggleFavorite(state.currentFood);
        const isFav = state.favorites.some(f => f.id === state.currentFood.id);
        UI.updateFavBtn(UI.dom.btnToggleFavRes, isFav);
      });

      // Chia sẻ
      UI.dom.btnShareRes.addEventListener("click", async () => {
        if (!state.currentFood) return;
        const f = state.currentFood;
        const shareData = {
          title: `Hôm nay ăn món ${f.name}!`,
          text: `Gợi ý chuẩn vị hôm nay: ${f.name} - ${f.description || ''}`,
          url: window.location.href
        };
        if (navigator.share) {
          try { await navigator.share(shareData); } catch (_) {}
        } else {
          try {
            await navigator.clipboard.writeText(`${shareData.title}\n${shareData.text}`);
            showToast("Đã chép nội dung vào Clipboard!", "success");
          } catch (e) {
            showToast("Không thể tự động sao chép", "error");
          }
        }
      });

      // Thao tác trên Cards
      UI.dom.foodsGrid.addEventListener("click", (e) => {
        const favBtn = e.target.closest(".btn-card-fav");
        if (favBtn) {
          e.stopPropagation();
          const id = favBtn.getAttribute("data-id");
          const food = state.foods.find(item => item.id === id);
          if (food) {
            this.toggleFavorite(food);
            const isFav = state.favorites.some(f => f.id === food.id);
            favBtn.className = `btn-card-fav w-8 h-8 rounded-lg flex items-center justify-center transition-colors ${isFav ? 'text-rose-500 bg-rose-500/10' : 'text-slate-400 hover:text-rose-400'}`;
            favBtn.innerHTML = `<i data-lucide="heart" class="w-4 h-4 ${isFav ? 'fill-current' : ''}"></i>`;
            lucide.createIcons();
          }
          return;
        }

        const card = e.target.closest(".food-card");
        if (card) {
          const id = card.getAttribute("data-id");
          const food = state.foods.find(item => item.id === id);
          if (food) UI.openFoodModal(food);
        }
      });

      // Modals
      UI.dom.btnOpenFavorites.addEventListener("click", () => UI.openFavoritesModal());
      UI.dom.btnOpenHistory.addEventListener("click", () => UI.openHistoryModal());
      UI.dom.modalCloseBtn.addEventListener("click", () => UI.closeModal());
      UI.dom.modal.addEventListener("click", (e) => {
        if (e.target === UI.dom.modal) UI.closeModal();
      });

      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && UI.dom.modal.classList.contains("modal-active")) {
          UI.closeModal();
        }
      });

      // Thao tác bên trong Modal
      UI.dom.modalBody.addEventListener("click", (e) => {
        const delBtn = e.target.closest(".btn-del-fav");
        if (delBtn) {
          const id = delBtn.getAttribute("data-id");
          const food = state.foods.find(f => f.id === id);
          if (food) {
            this.toggleFavorite(food);
            UI.openFavoritesModal();
          }
          return;
        }

        const viewBtn = e.target.closest(".btn-quick-view");
        if (viewBtn) {
          const id = viewBtn.getAttribute("data-id");
          const food = state.foods.find(f => f.id === id);
          if (food) {
            UI.closeModal();
            UI.openFoodModal(food);
          }
          return;
        }

        const clearHist = e.target.closest("#btn-clear-history");
        if (clearHist) {
          state.history = [];
          Storage.set(CONFIG.STORAGE_KEYS.HISTORY, [], "Đã xóa lịch sử");
          UI.openHistoryModal();
          showToast("Đã xóa toàn bộ lịch sử", "info");
        }
      });

      // Làm mới từ Sheets
      UI.dom.btnForceRefresh.addEventListener("click", () => this.loadData(true));

      // Mobile Bottom Nav Bar
      UI.dom.tabNavRandom.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        this.triggerRandomSpin();
      });
      UI.dom.tabNavExplore.addEventListener("click", () => {
        document.getElementById("explore-view").scrollIntoView({ behavior: 'smooth' });
      });
      UI.dom.tabNavFav.addEventListener("click", () => UI.openFavoritesModal());
      UI.dom.tabNavHist.addEventListener("click", () => UI.openHistoryModal());
    },

    toggleFavorite(food) {
      Utils.vibrate(30);
      const idx = state.favorites.findIndex(f => f.id === food.id);
      if (idx > -1) {
        state.favorites.splice(idx, 1);
        showToast(`Đã bỏ lưu "${food.name}"`, "info");
      } else {
        state.favorites.push({
          id: food.id,
          name: food.name,
          group: food.group
        });
        showToast(`Đã lưu "${food.name}" vào yêu thích!`, "success");
      }
      Storage.set(CONFIG.STORAGE_KEYS.FAVORITES, state.favorites, "Đã cập nhật yêu thích");
      UI.updateFavBadge();
      UI.renderFoodsList(state.filteredFoods);
    },

    applyFilters() {
      const f = state.activeFilters;
      let res = state.foods.slice();

      if (f.keyword) {
        const normKey = Utils.normalizeVietnamese(f.keyword);
        res = res.filter(item => {
          const searchStr = Utils.normalizeVietnamese(
            (item.name || "") + " " + (item.group || "") + " " + (item.districts ? item.districts.join(" ") : "")
          );
          return searchStr.includes(normKey);
        });
      }

      if (f.purpose && f.purpose !== "all") {
        res = res.filter(item => item.purposes && item.purposes.includes(f.purpose));
      }

      if (f.group && f.group !== "all") {
        res = res.filter(item => item.group === f.group);
      }

      if (f.district && f.district !== "all") {
        res = res.filter(item => item.districts && item.districts.includes(f.district));
      }

      if (f.maxBudget && f.maxBudget !== "all") {
        const budget = parseInt(f.maxBudget, 10);
        res = res.filter(item => {
          if (item.minPrice === null) return true;
          return item.minPrice <= budget;
        });
      }

      state.filteredFoods = res;
      UI.renderFoodsList(state.filteredFoods);
      this.updateCandidatesCounter();
    }
  };

  // Khởi chạy ứng dụng
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => App.init());
  } else {
    App.init();
  }

})();
