/**
 * ============================================================================
 * DỰ ÁN: ĂN GÌ ĐÂY? (SMART FOOD ENGINE)
 * File: app.js - Xử lý Logic Gộp Món, 3D Cloche Scene, Confetti & Micro-interactions
 * ============================================================================
 */

(function () {
  'use strict';

  // 1. CẤU HÌNH TẬP TRUNG
  const CONFIG = {
    APP_NAME: "Ăn Gì Đây?",
    API_URL: "https://script.google.com/macros/s/AKfycbxoKW24CyLJCYxNpy-fL6-WvsJTYbDjZRbYW0DHGnKNlHKoaLfMBKjQvi0Oa3SZS_9A/exec",
    STORAGE_KEYS: {
      FAVORITES: "agd_favorites_v3",
      HISTORY: "agd_history_v3",
      SAVED_FILTERS: "agd_saved_filters_v3"
    },
    HISTORY_MAX_ITEMS: 30,
    REQUEST_TIMEOUT_MS: 16000
  };

  // 2. STATE QUẢN LÝ
  const state = {
    foods: [],
    filteredFoods: [],
    currentFood: null,
    favorites: [],
    history: [],
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
    isSpinning: false
  };

  // 3. BẢO MẬT & ĐỊNH DẠNG
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
    }
  };

  // 4. STORAGE VỚI SILENT NOTIFIER (UX TRỤ CỘT 3)
  const Storage = {
    get(key, fallback) {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : fallback;
      } catch (e) {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        this.flashSilentIndicator();
      } catch (e) {
        console.warn("Storage error", e);
      }
    },
    flashSilentIndicator() {
      const el = document.getElementById("silent-save-indicator");
      if (!el) return;
      el.classList.remove("opacity-0");
      setTimeout(() => el.classList.add("opacity-0"), 1800);
    }
  };

  // 5. API CLIENT JSONP
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
          reject(new Error("Quá thời gian phản hồi từ máy chủ Google Apps Script!"));
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

  // 6. THREE.JS 3D CLOCHE STAGE (TRỤ CỘT 2: SINH ĐỘNG)
  const ThreeClocheStage = {
    scene: null,
    camera: null,
    renderer: null,
    cloche: null,
    plate: null,
    steamParticles: null,
    isOpen: false,
    liftAnim: 0,

    init() {
      const container = document.getElementById("three-stage-container");
      if (!container || typeof THREE === "undefined") return;

      const width = container.clientWidth || 340;
      const height = container.clientHeight || 340;

      this.scene = new THREE.Scene();
      this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 100);
      this.camera.position.set(0, 3.4, 5.2);
      this.camera.lookAt(0, 0.4, 0);

      this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      this.renderer.setSize(width, height);
      this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      container.appendChild(this.renderer.domElement);

      // Studio Lighting
      const ambLight = new THREE.AmbientLight(0xffffff, 0.85);
      this.scene.add(ambLight);

      const mainLight = new THREE.DirectionalLight(0xfff7ed, 1.6);
      mainLight.position.set(5, 10, 6);
      this.scene.add(mainLight);

      const rimLight = new THREE.DirectionalLight(0xdbeafe, 0.8);
      rimLight.position.set(-5, 4, -4);
      this.scene.add(rimLight);

      // Materials
      const chromeMaterial = new THREE.MeshStandardMaterial({
        color: 0xf1f5f9,
        metalness: 0.9,
        roughness: 0.15
      });

      const goldTrimMaterial = new THREE.MeshStandardMaterial({
        color: 0xff5722,
        metalness: 0.4,
        roughness: 0.25
      });

      // 1. Đĩa Bạc (Plate)
      this.plate = new THREE.Group();
      const basePlate = new THREE.Mesh(new THREE.CylinderGeometry(2, 1.6, 0.1, 48), chromeMaterial);
      this.plate.add(basePlate);

      const rimTorus = new THREE.Mesh(new THREE.TorusGeometry(2.02, 0.05, 16, 48), goldTrimMaterial);
      rimTorus.rotation.x = Math.PI / 2;
      this.plate.add(rimTorus);
      this.scene.add(this.plate);

      // 2. Lồng Bàn Bạc (Cloche Dome)
      this.cloche = new THREE.Group();
      this.cloche.position.y = 0.05;

      const dome = new THREE.Mesh(
        new THREE.SphereGeometry(1.5, 36, 24, 0, Math.PI * 2, 0, Math.PI / 2),
        chromeMaterial
      );
      this.cloche.add(dome);

      // Tay cầm nắp
      const handleTop = new THREE.Mesh(new THREE.SphereGeometry(0.22, 20, 20), goldTrimMaterial);
      handleTop.position.y = 1.68;
      this.cloche.add(handleTop);

      const handleNeck = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.16, 0.18, 16), chromeMaterial);
      handleNeck.position.y = 1.55;
      this.cloche.add(handleNeck);

      this.scene.add(this.cloche);

      // 3. Khói hơi ẩm thực (Particles)
      const pCount = 50;
      const pGeo = new THREE.BufferGeometry();
      const pPos = new Float32Array(pCount * 3);

      for (let i = 0; i < pCount * 3; i += 3) {
        pPos[i] = (Math.random() - 0.5) * 1.5;
        pPos[i + 1] = Math.random() * 0.4;
        pPos[i + 2] = (Math.random() - 0.5) * 1.5;
      }
      pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));
      const pMat = new THREE.PointsMaterial({
        size: 0.09,
        color: 0xff7043,
        transparent: true,
        opacity: 0
      });
      this.steamParticles = new THREE.Points(pGeo, pMat);
      this.scene.add(this.steamParticles);

      // Render Loop
      const render = () => {
        requestAnimationFrame(render);

        if (!this.isOpen) {
          this.cloche.rotation.y += 0.006;
          this.plate.rotation.y += 0.006;
          this.cloche.position.y = 0.05 + Math.sin(Date.now() * 0.003) * 0.025;
        } else {
          if (this.liftAnim < 1) {
            this.liftAnim += 0.035;
            const ease = Math.sin(this.liftAnim * Math.PI / 2);
            this.cloche.position.y = 0.05 + ease * 2.3;
            this.cloche.rotation.y += 0.12;
            this.cloche.rotation.z = Math.sin(this.liftAnim * Math.PI) * 0.25;
            this.steamParticles.material.opacity = Math.sin(this.liftAnim * Math.PI) * 0.85;
            this.steamParticles.position.y = ease * 1.5;
          }
        }

        this.renderer.render(this.scene, this.camera);
      };
      render();

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
      if (!this.cloche) {
        if (callback) callback();
        return;
      }

      this.isOpen = true;
      this.liftAnim = 0;
      const caption = document.getElementById("stage-status-caption");
      if (caption) caption.textContent = "✨ Đang mở nắp khui món...";

      // Rung lắc trước khi mở
      let shakes = 0;
      const shakeTimer = setInterval(() => {
        this.cloche.position.x = (Math.random() - 0.5) * 0.08;
        shakes++;
        if (shakes > 6) {
          clearInterval(shakeTimer);
          this.cloche.position.x = 0;
        }
      }, 40);

      setTimeout(() => {
        if (callback) callback();
        if (caption) caption.textContent = "Món ngon đã mở!";

        // Đóng nắp tự động sau 3.2s
        setTimeout(() => {
          const closeTimer = setInterval(() => {
            this.liftAnim -= 0.04;
            const ease = Math.max(0, this.liftAnim);
            this.cloche.position.y = 0.05 + ease * 2.3;
            this.steamParticles.material.opacity = ease * 0.5;

            if (this.liftAnim <= 0) {
              clearInterval(closeTimer);
              this.isOpen = false;
              this.cloche.position.y = 0.05;
              this.cloche.rotation.z = 0;
              this.steamParticles.material.opacity = 0;
              if (caption) caption.textContent = "Lồng bàn ẩm thực sẵn sàng";
            }
          }, 30);
        }, 3200);
      }, 700);
    }
  };

  // 7. TOAST NOTIFICATIONS
  function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "flex items-center gap-3 px-4 py-3.5 rounded-2xl text-xs sm:text-sm font-semibold shadow-2xl backdrop-blur-md border transition-all duration-300 pointer-events-auto transform translate-y-4 opacity-0";

    if (type === "success") {
      toast.classList.add("bg-slate-900/90", "text-white", "border-emerald-500/50");
      toast.innerHTML = `<i data-lucide="check-circle" class="w-4 h-4 text-emerald-400"></i><span>${Utils.escapeHTML(message)}</span>`;
    } else if (type === "error") {
      toast.classList.add("bg-rose-950/90", "text-rose-100", "border-rose-500/50");
      toast.innerHTML = `<i data-lucide="alert-circle" class="w-4 h-4 text-rose-400"></i><span>${Utils.escapeHTML(message)}</span>`;
    } else {
      toast.classList.add("bg-slate-900/90", "text-white", "border-slate-700");
      toast.innerHTML = `<i data-lucide="info" class="w-4 h-4 text-brand-400"></i><span>${Utils.escapeHTML(message)}</span>`;
    }

    container.appendChild(toast);
    lucide.createIcons();

    requestAnimationFrame(() => {
      toast.classList.remove("translate-y-4", "opacity-0");
    });

    setTimeout(() => {
      toast.classList.add("translate-y-2", "opacity-0");
      setTimeout(() => toast.remove(), 300);
    }, 3200);
  }

  // 8. CELEBRATION CONFETTI
  function fireConfetti() {
    if (typeof confetti === "function") {
      confetti({
        particleCount: 80,
        spread: 70,
        origin: { y: 0.65 },
        colors: ['#ff5722', '#10b981', '#f59e0b', '#3b82f6', '#ec4899']
      });
    }
  }

  // 9. LOGIC CHỌN MÓN NGẪU NHIÊN
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

  // 10. GIAO DIỆN & TƯƠNG TÁC
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
        randomSection: document.getElementById("random-result-section"),
        resName: document.getElementById("res-food-name"),
        resDesc: document.getElementById("res-food-desc"),
        resMetaChips: document.getElementById("res-meta-chips"),
        resVenuesCount: document.getElementById("res-venues-count"),
        resVenuesContainer: document.getElementById("res-venues-container"),
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
        this.dom.filterGroup.innerHTML = '<option value="all">Tất cả nhóm</option>' +
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
          <div class="relative overflow-hidden bg-white/70 backdrop-blur-md rounded-3xl p-6 border border-slate-200/80 shadow-card-soft h-64 flex flex-col justify-between">
            <div class="skeleton-shimmer absolute inset-0"></div>
            <div class="space-y-3">
              <div class="w-24 h-5 bg-slate-200 rounded-full"></div>
              <div class="w-3/4 h-7 bg-slate-200 rounded-xl"></div>
              <div class="w-full h-4 bg-slate-100 rounded-md"></div>
              <div class="w-2/3 h-4 bg-slate-100 rounded-md"></div>
            </div>
            <div class="w-28 h-6 bg-slate-200 rounded-full"></div>
          </div>
        `;
      }
      this.dom.foodsGrid.innerHTML = html;
    },

    renderFoodsList(foods) {
      if (!foods || foods.length === 0) {
        this.dom.foodsGrid.innerHTML = `
          <div class="col-span-full text-center py-16 px-4 bg-white/80 rounded-3xl border border-dashed border-slate-200">
            <div class="w-14 h-14 bg-amber-50 text-amber-500 rounded-2xl flex items-center justify-center mx-auto mb-3">
              <i data-lucide="utensils-crossed" class="w-7 h-7"></i>
            </div>
            <h3 class="text-lg font-bold text-slate-800">Không tìm thấy món ăn phù hợp</h3>
            <p class="text-sm text-slate-600 mt-1 max-w-sm mx-auto">Hãy thử chọn lại khu vực hoặc tăng hạn mức ngân sách bạn nhé!</p>
            <button onclick="document.getElementById('btn-reset-filters').click()" class="mt-4 px-5 py-2.5 rounded-2xl bg-slate-100 text-slate-700 font-bold text-xs hover:bg-slate-200 active:scale-95 transition-all">
              Đặt lại bộ lọc
            </button>
          </div>
        `;
        this.dom.foodCountLabel.textContent = "0 món ăn khả dụng";
        lucide.createIcons();
        return;
      }

      this.dom.foodCountLabel.textContent = `Khám phá ${foods.length} món ngon đặc sắc`;

      const cardsHtml = foods.map(item => {
        const isFav = state.favorites.some(f => f.id === item.id);
        const venueCount = item.venues ? item.venues.length : 0;
        const priceText = item.minPrice !== null && item.maxPrice !== null
          ? (item.minPrice === item.maxPrice ? Utils.formatCurrency(item.minPrice) : `${Utils.formatCurrency(item.minPrice)} - ${Utils.formatCurrency(item.maxPrice)}`)
          : (item.minPrice ? Utils.formatCurrency(item.minPrice) : "Giá bình dân");

        return `
          <div class="group food-card bg-white/85 hover:bg-white backdrop-blur-md rounded-3xl p-6 border border-slate-200/80 hover:border-brand-500/40 shadow-card-soft hover:shadow-card-hover hover:-translate-y-1.5 transition-all duration-300 flex flex-col justify-between cursor-pointer" data-id="${Utils.escapeHTML(item.id)}">
            <div class="space-y-3">
              <div class="flex items-center justify-between gap-2">
                <span class="px-3 py-1 rounded-full bg-slate-100 text-slate-700 text-xs font-bold tracking-wide">${Utils.escapeHTML(item.group)}</span>
                <button class="btn-card-fav w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${isFav ? 'text-rose-500 bg-rose-50' : 'text-slate-400 hover:text-rose-500 hover:bg-slate-50'}" data-id="${Utils.escapeHTML(item.id)}" title="Lưu món">
                  <i data-lucide="heart" class="w-4 h-4 ${isFav ? 'fill-current' : ''}"></i>
                </button>
              </div>

              <h3 class="font-heading font-extrabold text-xl text-slate-900 group-hover:text-brand-600 transition-colors line-clamp-1">${Utils.escapeHTML(item.name)}</h3>
              <p class="text-xs sm:text-sm text-slate-600 line-clamp-2 leading-relaxed">${Utils.escapeHTML(item.description || "Hương vị hấp dẫn khó cưỡng đậm bản sắc Việt.")}</p>

              ${venueCount > 0 ? `
                <div class="inline-flex items-center gap-1.5 text-xs font-bold text-emerald-600 bg-emerald-50 px-2.5 py-1 rounded-full">
                  <i data-lucide="map-pin" class="w-3.5 h-3.5"></i>
                  <span>${venueCount} quán gợi ý</span>
                </div>
              ` : ''}
            </div>

            <div class="mt-5 pt-4 border-t border-slate-100 flex items-center justify-between">
              <span class="text-xs sm:text-sm font-extrabold text-brand-600 bg-brand-50 px-3 py-1 rounded-full border border-brand-100/60">${Utils.escapeHTML(priceText)}</span>
              <span class="text-xs font-bold text-slate-600 group-hover:text-brand-600 flex items-center gap-1 transition-colors">
                Chi tiết <i data-lucide="arrow-right" class="w-3.5 h-3.5 group-hover:translate-x-1 transition-transform"></i>
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
      this.dom.resDesc.textContent = food.description || "Món ăn tuyệt hảo tiếp thêm trọn vẹn năng lượng cho ngày của bạn.";

      // Render Chips
      let chipsHtml = `<span class="px-3 py-1 rounded-full bg-slate-100 text-slate-800 text-xs font-bold">${Utils.escapeHTML(food.group)}</span>`;
      if (food.purposes) {
        food.purposes.forEach(p => {
          chipsHtml += `<span class="px-3 py-1 rounded-full bg-amber-50 text-amber-700 text-xs font-bold">${Utils.escapeHTML(p)}</span>`;
        });
      }
      const priceText = food.minPrice !== null && food.maxPrice !== null
        ? (food.minPrice === food.maxPrice ? Utils.formatCurrency(food.minPrice) : `${Utils.formatCurrency(food.minPrice)} - ${Utils.formatCurrency(food.maxPrice)}`)
        : "Giá bình dân";
      chipsHtml += `<span class="px-3 py-1 rounded-full bg-brand-500 text-white text-xs font-extrabold shadow-xs">${Utils.escapeHTML(priceText)}</span>`;
      this.dom.resMetaChips.innerHTML = chipsHtml;

      // Render Venues
      const venues = food.venues || [];
      this.dom.resVenuesCount.textContent = venues.length;

      if (!venues.length) {
        this.dom.resVenuesContainer.innerHTML = `<p class="col-span-full text-xs text-slate-600 py-2">Món phổ biến, dễ dàng tìm thấy tại các hàng quán quanh khu vực của bạn.</p>`;
      } else {
        this.dom.resVenuesContainer.innerHTML = venues.map(v => `
          <div class="bg-white rounded-2xl p-4 border border-slate-200/90 shadow-2xs hover:border-brand-500/40 transition-all flex items-start justify-between gap-3">
            <div class="space-y-1">
              <div class="font-bold text-sm text-slate-800">${Utils.escapeHTML(v.restaurant)} ${v.district ? `<span class="text-xs font-normal text-slate-600">(${Utils.escapeHTML(v.district)})</span>` : ''}</div>
              <div class="text-xs text-slate-600 leading-snug">${Utils.escapeHTML(v.address || "Địa chỉ cập nhật trực tiếp tại quán")}</div>
              ${v.notes ? `<div class="text-[11px] font-semibold text-brand-600">* ${Utils.escapeHTML(v.notes)}</div>` : ''}
            </div>
            ${v.mapUrl && Utils.isValidUrl(v.mapUrl) ? `
              <a href="${Utils.escapeHTML(v.mapUrl)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-brand-50 hover:text-brand-600 text-slate-700 text-xs font-bold flex items-center gap-1 shrink-0 transition-colors" title="Xem trên Google Maps">
                <i data-lucide="map" class="w-3.5 h-3.5"></i> Chỉ đường
              </a>
            ` : ''}
          </div>
        `).join("");
      }

      // Nút fav
      const isFav = state.favorites.some(f => f.id === food.id);
      this.updateFavBtn(this.dom.btnToggleFavRes, isFav);

      // Mở Card và Cuộn mượt
      this.dom.randomSection.classList.remove("hidden");
      this.dom.randomSection.scrollIntoView({ behavior: "smooth", block: "center" });

      this.addToHistory(food);
      fireConfetti();
      lucide.createIcons();
    },

    updateFavBtn(btn, isFav) {
      if (!btn) return;
      if (isFav) {
        btn.classList.add("text-rose-500", "border-rose-300");
        btn.querySelector("svg")?.classList.add("fill-current");
      } else {
        btn.classList.remove("text-rose-500", "border-rose-300");
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
      Storage.set(CONFIG.STORAGE_KEYS.HISTORY, state.history);
    },

    openFoodModal(food) {
      if (!food) return;
      this.dom.modalTitle.textContent = food.name;

      const priceText = food.minPrice !== null && food.maxPrice !== null
        ? (food.minPrice === food.maxPrice ? Utils.formatCurrency(food.minPrice) : `${Utils.formatCurrency(food.minPrice)} - ${Utils.formatCurrency(food.maxPrice)}`)
        : "Giá bình dân";

      const venues = food.venues || [];
      const venuesHtml = venues.length > 0 ? venues.map(v => `
        <div class="bg-slate-50 rounded-2xl p-4 border border-slate-200/80 flex items-start justify-between gap-3">
          <div class="space-y-1">
            <div class="font-bold text-sm text-slate-800">${Utils.escapeHTML(v.restaurant)} ${v.district ? `<span class="text-xs font-normal text-slate-600">(${Utils.escapeHTML(v.district)})</span>` : ''}</div>
            <div class="text-xs text-slate-600">${Utils.escapeHTML(v.address || "Địa chỉ cập nhật")}</div>
            ${v.notes ? `<div class="text-[11px] font-semibold text-brand-600">* ${Utils.escapeHTML(v.notes)}</div>` : ''}
          </div>
          ${v.mapUrl && Utils.isValidUrl(v.mapUrl) ? `
            <a href="${Utils.escapeHTML(v.mapUrl)}" target="_blank" rel="noopener noreferrer" class="px-3 py-1.5 rounded-xl bg-white border border-slate-200 hover:border-brand-500 hover:text-brand-600 text-slate-700 text-xs font-bold shrink-0 transition-colors">
              Bản đồ
            </a>
          ` : ''}
        </div>
      `).join("") : '<p class="text-xs text-slate-600">Chưa có thông tin quán cụ thể.</p>';

      this.dom.modalBody.innerHTML = `
        <div class="flex flex-wrap gap-2">
          <span class="px-3 py-1 rounded-full bg-slate-100 text-slate-800 text-xs font-bold">${Utils.escapeHTML(food.group)}</span>
          <span class="px-3 py-1 rounded-full bg-brand-50 text-brand-700 border border-brand-200 text-xs font-bold">${Utils.escapeHTML(priceText)}</span>
        </div>
        <p class="text-slate-600 text-sm leading-relaxed">${Utils.escapeHTML(food.description || "Hương vị tuyệt ngon đậm vị truyền thống.")}</p>
        <div class="space-y-3 pt-2">
          <div class="font-bold text-sm text-slate-800">Địa điểm phục vụ (${venues.length})</div>
          <div class="space-y-2.5 max-h-60 overflow-y-auto pr-1">${venuesHtml}</div>
        </div>
      `;

      this.dom.modal.classList.add("modal-active");
      lucide.createIcons();
    },

    openFavoritesModal() {
      this.dom.modalTitle.textContent = `Món Đã Lưu (${state.favorites.length})`;
      if (state.favorites.length === 0) {
        this.dom.modalBody.innerHTML = `
          <div class="text-center py-12 px-4">
            <i data-lucide="heart" class="w-12 h-12 text-slate-300 mx-auto mb-3"></i>
            <p class="text-sm font-semibold text-slate-700">Chưa có món ăn nào trong mục yêu thích</p>
            <p class="text-xs text-slate-600 mt-1">Bấm vào biểu tượng trái tim trên thẻ món ăn để lưu lại nhé!</p>
          </div>
        `;
      } else {
        this.dom.modalBody.innerHTML = `
          <div class="divide-y divide-slate-100 max-h-96 overflow-y-auto pr-1">
            ${state.favorites.map(f => `
              <div class="py-3 flex items-center justify-between gap-3">
                <div>
                  <h4 class="font-bold text-sm text-slate-800">${Utils.escapeHTML(f.name)}</h4>
                  <span class="text-xs text-slate-600">${Utils.escapeHTML(f.group)}</span>
                </div>
                <div class="flex items-center gap-2">
                  <button class="btn-quick-view px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold active:scale-95 transition-all" data-id="${Utils.escapeHTML(f.id)}">Xem</button>
                  <button class="btn-del-fav px-3 py-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 text-rose-600 text-xs font-bold active:scale-95 transition-all" data-id="${Utils.escapeHTML(f.id)}">Xóa</button>
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
          <div class="text-center py-12 px-4">
            <i data-lucide="clock" class="w-12 h-12 text-slate-300 mx-auto mb-3"></i>
            <p class="text-sm font-semibold text-slate-700">Chưa có lịch sử chọn món</p>
            <p class="text-xs text-slate-600 mt-1">Hãy nhấn "Khui món ngẫu nhiên" để khám phá bữa ăn ngay!</p>
          </div>
        `;
      } else {
        this.dom.modalBody.innerHTML = `
          <div class="flex justify-end pb-2">
            <button id="btn-clear-history" class="text-xs font-bold text-rose-600 hover:text-rose-700 underline">Xóa lịch sử</button>
          </div>
          <div class="divide-y divide-slate-100 max-h-96 overflow-y-auto pr-1">
            ${state.history.map(h => `
              <div class="py-3 flex items-center justify-between gap-3">
                <div>
                  <h4 class="font-bold text-sm text-slate-800">${Utils.escapeHTML(h.name)}</h4>
                  <span class="text-xs text-slate-600">${Utils.escapeHTML(h.group)} • ${Utils.escapeHTML(h.time)} (${Utils.escapeHTML(h.date)})</span>
                </div>
                <button class="btn-quick-view px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-bold active:scale-95 transition-all" data-id="${Utils.escapeHTML(h.id)}">Xem lại</button>
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

  // 11. BỘ ĐIỀU KHIỂN CHÍNH (APP CONTROLLER)
  const App = {
    async init() {
      UI.initElements();
      UI.renderSkeleton();

      state.favorites = Storage.get(CONFIG.STORAGE_KEYS.FAVORITES, []);
      state.history = Storage.get(CONFIG.STORAGE_KEYS.HISTORY, []);
      UI.updateFavBadge();

      this.setupSmartTime();
      ThreeClocheStage.init();
      this.bindEvents();

      await this.loadData();
    },

    setupSmartTime() {
      const h = new Date().getHours();
      let label = "Bữa chính";
      if (h >= 5 && h < 10) label = "Bữa sáng";
      else if (h >= 10 && h < 14) label = "Bữa trưa";
      else if (h >= 14 && h < 17) label = "Ăn vặt / Xế chiều";
      else if (h >= 17 && h < 22) label = "Bữa tối";
      else label = "Ăn đêm";

      UI.dom.smartTimeText.textContent = `Giờ chuẩn: ${label} (Bấm lọc nhanh)`;
      UI.dom.smartTimePill.setAttribute("data-purpose", label);
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
          showToast("Đã cập nhật thực đơn mới nhất từ Google Sheets!", "success");
        }
      } catch (err) {
        UI.dom.foodsGrid.innerHTML = `
          <div class="col-span-full text-center py-16 px-4 bg-white/80 rounded-3xl border border-rose-200">
            <h3 class="text-base font-bold text-rose-600 mb-2">Không thể tải thực đơn từ máy chủ</h3>
            <p class="text-xs text-slate-600 mb-4">${Utils.escapeHTML(err.message)}</p>
            <button onclick="location.reload()" class="px-6 py-2.5 rounded-2xl bg-brand-600 text-white font-bold text-xs shadow-md">Thử lại</button>
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
      UI.dom.candidatesCounter.textContent = `${eligible.length} món sẵn sàng quay`;
    },

    bindEvents() {
      // 1. Khui lồng bàn ngẫu nhiên
      const triggerSpin = () => {
        if (state.isSpinning || state.foods.length === 0) return;
        state.isSpinning = true;

        UI.dom.btnHeroSpin.disabled = true;
        UI.dom.spinBtnLabel.textContent = "Đang khui lồng bàn...";

        ThreeClocheStage.triggerOpen(() => {
          const picked = FoodEngine.spin();
          UI.dom.btnHeroSpin.disabled = false;
          UI.dom.spinBtnLabel.textContent = "Khui món ngẫu nhiên";
          state.isSpinning = false;

          if (picked) {
            UI.displayRandomResult(picked);
            showToast(`Gợi ý chuẩn vị: ${picked.name}!`, "success");
          } else {
            showToast("Không tìm thấy món ăn khớp bộ lọc!", "error");
          }
        });
      };

      UI.dom.btnHeroSpin.addEventListener("click", triggerSpin);
      UI.dom.btnSpinAgain.addEventListener("click", triggerSpin);

      // Phím Space
      window.addEventListener("keydown", (e) => {
        if (e.code === "Space" && e.target === document.body && !UI.dom.modal.classList.contains("modal-active")) {
          e.preventDefault();
          triggerSpin();
        }
      });

      // 2. Smart time pill click
      UI.dom.smartTimePill.addEventListener("click", () => {
        const target = UI.dom.smartTimePill.getAttribute("data-purpose");
        const options = Array.from(UI.dom.filterPurpose.options).map(o => o.value);
        const matched = options.find(opt => opt.toLowerCase().includes(target.toLowerCase()));
        if (matched) {
          UI.dom.filterPurpose.value = matched;
          state.activeFilters.purpose = matched;
          this.applyFilters();
          showToast(`Đã áp dụng khung giờ: ${matched}`, "info");
        }
      });

      // 3. Thay đổi bộ lọc
      const onFilterChange = () => {
        state.activeFilters.purpose = UI.dom.filterPurpose.value;
        state.activeFilters.group = UI.dom.filterGroup.value;
        state.activeFilters.district = UI.dom.filterDistrict.value;
        state.activeFilters.maxBudget = UI.dom.filterBudget.value;
        state.activeFilters.excludeRecent = UI.dom.chkExcludeRecent.checked;
        this.applyFilters();
      };

      UI.dom.filterPurpose.addEventListener("change", onFilterChange);
      UI.dom.filterGroup.addEventListener("change", onFilterChange);
      UI.dom.filterDistrict.addEventListener("change", onFilterChange);
      UI.dom.filterBudget.addEventListener("change", onFilterChange);
      UI.dom.chkExcludeRecent.addEventListener("change", onFilterChange);

      // Reset
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
        showToast("Đã đưa các bộ lọc về mặc định", "info");
      });

      // Search box debounce
      let searchTimeout = null;
      UI.dom.searchBox.addEventListener("input", (e) => {
        clearTimeout(searchTimeout);
        searchTimeout = setTimeout(() => {
          state.activeFilters.keyword = e.target.value;
          this.applyFilters();
        }, 220);
      });

      // Scroll menu
      UI.dom.btnScrollMenu.addEventListener("click", () => {
        document.getElementById("explore-view").scrollIntoView({ behavior: "smooth" });
      });

      // Favorite toggle từ thẻ spotlight
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
          title: `Hôm nay ăn ${f.name}!`,
          text: `Gợi ý chuẩn vị: ${f.name} - ${f.description || ''}`,
          url: window.location.href
        };
        if (navigator.share) {
          try { await navigator.share(shareData); } catch (_) {}
        } else {
          try {
            await navigator.clipboard.writeText(`${shareData.title}\n${shareData.text}`);
            showToast("Đã sao chép nội dung gợi ý vào Clipboard!", "success");
          } catch (e) {
            showToast("Không thể sao chép tự động", "error");
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
            favBtn.className = `btn-card-fav w-9 h-9 rounded-xl flex items-center justify-center transition-colors ${isFav ? 'text-rose-500 bg-rose-50' : 'text-slate-400 hover:text-rose-500 hover:bg-slate-50'}`;
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

      // Thao tác trong Modal
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
          Storage.set(CONFIG.STORAGE_KEYS.HISTORY, []);
          UI.openHistoryModal();
          showToast("Đã xóa toàn bộ lịch sử", "info");
        }
      });

      // Nút ép tải lại từ Google Sheets
      UI.dom.btnForceRefresh.addEventListener("click", () => {
        this.loadData(true);
      });

      // Mobile Bottom Bar Navigation
      UI.dom.tabNavRandom.addEventListener("click", () => {
        window.scrollTo({ top: 0, behavior: 'smooth' });
        triggerSpin();
      });
      UI.dom.tabNavExplore.addEventListener("click", () => {
        document.getElementById("explore-view").scrollIntoView({ behavior: 'smooth' });
      });
      UI.dom.tabNavFav.addEventListener("click", () => UI.openFavoritesModal());
      UI.dom.tabNavHist.addEventListener("click", () => UI.openHistoryModal());
    },

    toggleFavorite(food) {
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
      Storage.set(CONFIG.STORAGE_KEYS.FAVORITES, state.favorites);
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

  // Khởi động
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => App.init());
  } else {
    App.init();
  }

})();
