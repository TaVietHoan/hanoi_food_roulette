/**
 * ============================================================================
 * DỰ ÁN: ĂN GÌ ĐÂY? (SMART FOOD PICKER)
 * File: app.js - Xử lý Logic Client-side, Three.js 3D, LocalStorage & API Engine
 * ============================================================================
 */

(function () {
  'use strict';

  // 1. CẤU HÌNH TẬP TRUNG (CONFIG)
  const CONFIG = {
    APP_NAME: "Ăn Gì Đây?",
    // Điền URL Google Apps Script Web App (/exec) của bạn tại đây:
    // Ví dụ: "https://script.google.com/macros/s/AKfycbzxxxxxx/exec"
    API_URL: "https://script.google.com/macros/s/AKfycbw63l0xLd0H71b2V6i7k4o1B4Q8y5e2p_EXAMPLE/exec",
    STORAGE_KEYS: {
      FAVORITES: "agd_favorites_v1",
      HISTORY: "agd_history_v1",
      CONFIG: "agd_user_prefs_v1"
    },
    HISTORY_MAX_ITEMS: 30,
    REQUEST_TIMEOUT_MS: 15000,
    ANIMATION_ROLL_DURATION: 1200, // Thời gian roll tạo cảm giác hồi hộp
    DEFAULT_PAGE_SIZE: 50,
    FEATURE_FLAGS: {
      enablePremiumTier: false, // Chuẩn bị cho kiến trúc SaaS tương lai
      maxRandomPerDayForFree: 100
    }
  };

  // 2. STATE TOÀN CỤC CỦA CLIENT
  const state = {
    foods: [],
    filteredFoods: [],
    currentFood: null,
    favorites: [],
    history: [],
    filtersMeta: {
      groups: [],
      purposes: [],
      districts: [],
      priceRange: { min: 0, max: 200000 }
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
    viewMode: "home" // "home" | "favorites" | "history"
  };

  // 3. TIỆN ÍCH AN TOÀN & BẢO MẬT
  const Security = {
    escapeHTML(str) {
      if (!str) return "";
      return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#039;");
    },
    isValidHttpUrl(string) {
      if (!string || typeof string !== "string") return false;
      try {
        const url = new URL(string);
        return url.protocol === "http:" || url.protocol === "https:";
      } catch (_) {
        return false;
      }
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
      if (val === null || val === undefined || isNaN(val)) return "Đang cập nhật";
      return new Intl.NumberFormat("vi-VN", { style: "currency", currency: "VND" }).format(val);
    }
  };

  // 4. API CLIENT TẬP TRUNG (Hỗ trợ JSONP an toàn cho Google Apps Script)
  const ApiClient = {
    jsonp(url, params = {}) {
      return new Promise((resolve, reject) => {
        const callbackName = "jsonp_cb_" + Math.random().toString(36).substring(2, 9) + "_" + Date.now();
        params.callback = callbackName;

        const queryString = Object.keys(params)
          .map(k => encodeURIComponent(k) + "=" + encodeURIComponent(params[k]))
          .join("&");

        const fullUrl = url + (url.indexOf("?") === -1 ? "?" : "&") + queryString;
        const script = document.createElement("script");
        script.src = fullUrl;
        script.async = true;

        const cleanup = () => {
          if (window[callbackName]) {
            delete window[callbackName];
          }
          if (script.parentNode) {
            script.parentNode.removeChild(script);
          }
        };

        const timeoutId = setTimeout(() => {
          cleanup();
          reject(new Error("Yêu cầu quá thời gian phản hồi (" + (CONFIG.REQUEST_TIMEOUT_MS / 1000) + "s)."));
        }, CONFIG.REQUEST_TIMEOUT_MS);

        window[callbackName] = function (data) {
          clearTimeout(timeoutId);
          cleanup();
          if (data && data.success) {
            resolve(data);
          } else {
            reject(new Error(data && data.error ? data.error : "Không thể lấy dữ liệu."));
          }
        };

        script.onerror = function () {
          clearTimeout(timeoutId);
          cleanup();
          reject(new Error("Lỗi mạng hoặc Google Apps Script từ chối kết nối. Hãy kiểm tra URL deployment."));
        };

        document.head.appendChild(script);
      });
    },

    async fetchFoods(forceRefresh = false) {
      if (!CONFIG.API_URL || CONFIG.API_URL.includes("EXAMPLE")) {
        throw new Error("Vui lòng cấu hình CONFIG.API_URL trong file app.js với deployment URL thật của Apps Script.");
      }
      return await this.jsonp(CONFIG.API_URL, {
        action: "getFoods",
        limit: 100,
        refresh: forceRefresh ? "true" : "false"
      });
    },

    async fetchFilters() {
      if (!CONFIG.API_URL || CONFIG.API_URL.includes("EXAMPLE")) return null;
      try {
        return await this.jsonp(CONFIG.API_URL, { action: "getFilters" });
      } catch (e) {
        return null;
      }
    }
  };

  // 5. STORAGE SERVICE (LocalStorage có try/catch)
  const Storage = {
    get(key, defaultValue) {
      try {
        const item = localStorage.getItem(key);
        return item ? JSON.parse(item) : defaultValue;
      } catch (e) {
        return defaultValue;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
      } catch (e) {
        console.warn("LocalStorage bị vô hiệu hóa hoặc đầy bộ nhớ.");
      }
    }
  };

  // 6. THREE.JS 3D HERO CONTROLLER
  const ThreeScene = {
    renderer: null,
    scene: null,
    camera: null,
    bowlGroup: null,
    animFrameId: null,

    init() {
      const container = document.getElementById("three-canvas-container");
      const fallback = document.getElementById("three-fallback");
      if (!container || typeof THREE === "undefined") {
        if (fallback) fallback.style.display = "flex";
        return;
      }

      try {
        const width = container.clientWidth || 320;
        const height = container.clientHeight || 300;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        this.camera.position.set(0, 3.2, 5.5);
        this.camera.lookAt(0, 0, 0);

        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        // Ánh sáng dịu ấm
        const ambientLight = new THREE.AmbientLight(0xfff6ea, 0.85);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xffeedd, 1.2);
        dirLight.position.set(5, 8, 6);
        this.scene.add(dirLight);

        // Tạo mô hình đại diện: Bát súp/phở 3D dễ thương
        this.bowlGroup = new THREE.Group();

        // 1. Thân bát
        const bowlGeo = new THREE.CylinderGeometry(1.6, 0.9, 1.1, 32, 1, false);
        const bowlMat = new THREE.MeshStandardMaterial({
          color: 0xFFFFFF,
          roughness: 0.25,
          metalness: 0.05
        });
        const bowlMesh = new THREE.Mesh(bowlGeo, bowlMat);
        this.bowlGroup.add(bowlMesh);

        // Viền bát cam san hô
        const rimGeo = new THREE.TorusGeometry(1.61, 0.06, 16, 32);
        const rimMat = new THREE.MeshStandardMaterial({ color: 0xFF6B4A, roughness: 0.3 });
        const rimMesh = new THREE.Mesh(rimGeo, rimMat);
        rimMesh.rotation.x = Math.PI / 2;
        rimMesh.position.y = 0.55;
        this.bowlGroup.add(rimMesh);

        // 2. Mặt nước dùng súp vàng óng
        const soupGeo = new THREE.CircleGeometry(1.5, 32);
        const soupMat = new THREE.MeshStandardMaterial({
          color: 0xE8A638,
          roughness: 0.1,
          metalness: 0.15
        });
        const soupMesh = new THREE.Mesh(soupGeo, soupMat);
        soupMesh.rotation.x = -Math.PI / 2;
        soupMesh.position.y = 0.48;
        this.bowlGroup.add(soupMesh);

        // 3. Topping nổi (thịt viên, rau thơm)
        const toppingGeo1 = new THREE.DodecahedronGeometry(0.3, 0);
        const toppingMat1 = new THREE.MeshStandardMaterial({ color: 0x8C4A32, roughness: 0.8 });
        for (let i = 0; i < 3; i++) {
          const tMesh = new THREE.Mesh(toppingGeo1, toppingMat1);
          tMesh.position.set(Math.cos(i * 2) * 0.7, 0.55, Math.sin(i * 2) * 0.6);
          this.bowlGroup.add(tMesh);
        }

        const herbGeo = new THREE.ConeGeometry(0.18, 0.3, 5);
        const herbMat = new THREE.MeshStandardMaterial({ color: 0x38B29C, roughness: 0.5 });
        const herb = new THREE.Mesh(herbGeo, herbMat);
        herb.position.set(0, 0.6, 0);
        this.bowlGroup.add(herb);

        this.scene.add(this.bowlGroup);

        // Tương tác chạm/di chuột nhẹ
        let mouseX = 0;
        let targetRotation = 0;
        window.addEventListener("pointermove", (e) => {
          mouseX = (e.clientX / window.innerWidth) * 2 - 1;
          targetRotation = mouseX * 0.4;
        });

        const animate = () => {
          this.animFrameId = requestAnimationFrame(animate);
          if (this.bowlGroup) {
            this.bowlGroup.rotation.y += 0.008;
            this.bowlGroup.rotation.y += (targetRotation - this.bowlGroup.rotation.y) * 0.05;
            this.bowlGroup.position.y = Math.sin(Date.now() * 0.002) * 0.08;
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

      } catch (err) {
        if (fallback) fallback.style.display = "flex";
      }
    }
  };

  // 7. TOAST NOTIFICATION
  function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast-item";
    
    let iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    if (type === "success") {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#38B29C" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    } else if (type === "error") {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF6B4A" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    }

    toast.innerHTML = iconSvg + "<span>" + Security.escapeHTML(message) + "</span>";
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transition = "opacity 0.3s ease";
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3200);
  }

  // 8. LOGIC RANDOM CHỌN MÓN NGUYÊN BẢN (CORE ENGINE)
  const FoodEngine = {
    /**
     * Lọc danh sách ứng viên dựa trên bộ lọc hiện tại
     */
    getEligibleCandidates() {
      const f = state.activeFilters;
      let list = state.foods.slice();

      // 1. Lọc theo mục đích (exact match theo mảng purposes)
      if (f.purpose && f.purpose !== "all") {
        list = list.filter(item => item.purposes && item.purposes.includes(f.purpose));
      }

      // 2. Lọc theo nhóm món
      if (f.group && f.group !== "all") {
        list = list.filter(item => item.group === f.group);
      }

      // 3. Lọc theo quận
      if (f.district && f.district !== "all") {
        list = list.filter(item => item.district === f.district);
      }

      // 4. Lọc theo ngân sách (giao nhau hợp lệ giữa minPrice/maxPrice và ngân sách người dùng)
      if (f.maxBudget && f.maxBudget !== "all") {
        const budgetLimit = parseInt(f.maxBudget, 10);
        list = list.filter(item => {
          if (item.minPrice === null && item.maxPrice === null) return true; // Chưa rõ giá thì vẫn cho cơ hội
          if (item.minPrice !== null && item.minPrice > budgetLimit) return false;
          return true;
        });
      }

      // 5. Loại trừ các món vừa chọn gần đây (5 món gần nhất trong lịch sử)
      if (f.excludeRecent && state.history.length > 0) {
        const recentIds = state.history.slice(0, 5).map(h => h.id);
        const withoutRecent = list.filter(item => !recentIds.includes(item.id));
        // Nếu sau khi loại trừ vẫn còn món thì áp dụng, nếu hết sạch món thì dùng lại danh sách đầy đủ
        if (withoutRecent.length > 0) {
          list = withoutRecent;
        }
      }

      return list;
    },

    /**
     * Quay ngẫu nhiên công bằng, không thiên vị hàng đầu Sheet
     */
    spinRandom() {
      const candidates = this.getEligibleCandidates();
      if (!candidates || candidates.length === 0) {
        return null;
      }
      // Chọn ngẫu nhiên đều
      const randomIndex = Math.floor(Math.random() * candidates.length);
      return candidates[randomIndex];
    }
  };

  // 9. RENDER GIAO DIỆN & TƯƠNG TÁC DOM
  const UI = {
    initElements() {
      this.dom = {
        foodsGrid: document.getElementById("foods-grid-container"),
        foodCountLabel: document.getElementById("food-count-label"),
        searchBox: document.getElementById("search-box"),
        filterPurpose: document.getElementById("filter-purpose"),
        filterGroup: document.getElementById("filter-group"),
        filterDistrict: document.getElementById("filter-district"),
        filterBudget: document.getElementById("filter-budget"),
        chkExcludeRecent: document.getElementById("chk-exclude-recent"),
        btnResetFilters: document.getElementById("btn-reset-filters"),
        btnHeroSpin: document.getElementById("btn-hero-spin"),
        btnSpinAgain: document.getElementById("btn-spin-again"),
        btnExploreScroll: document.getElementById("btn-explore-scroll"),
        randomSection: document.getElementById("random-result-section"),
        resName: document.getElementById("res-food-name"),
        resDesc: document.getElementById("res-food-desc"),
        resMetaChips: document.getElementById("res-meta-chips"),
        resVenueBox: document.getElementById("res-venue-box"),
        resVenueName: document.getElementById("res-venue-name"),
        resVenueAddress: document.getElementById("res-venue-address"),
        btnOpenMapRes: document.getElementById("btn-open-map-res"),
        btnShareRes: document.getElementById("btn-share-res"),
        btnToggleFavRes: document.getElementById("btn-toggle-fav-res"),
        modal: document.getElementById("detail-modal"),
        modalTitle: document.getElementById("modal-title"),
        modalBody: document.getElementById("modal-body-content"),
        modalCloseBtn: document.getElementById("modal-close-btn"),
        favBadge: document.getElementById("fav-count-badge"),
        btnOpenFavorites: document.getElementById("btn-open-favorites"),
        btnOpenHistory: document.getElementById("btn-open-history"),
        navTabRandom: document.getElementById("tab-nav-random"),
        navTabExplore: document.getElementById("tab-nav-explore"),
        navTabFav: document.getElementById("tab-nav-favorites"),
        navTabHist: document.getElementById("tab-nav-history")
      };
    },

    populateFilterOptions() {
      const { groups, purposes, districts } = state.filtersMeta;

      // Populate Mục đích
      if (purposes && purposes.length) {
        this.dom.filterPurpose.innerHTML = '<option value="all">Tất cả mục đích</option>' +
          purposes.map(p => `<option value="${Security.escapeHTML(p)}">${Security.escapeHTML(p)}</option>`).join("");
      }

      // Populate Nhóm món
      if (groups && groups.length) {
        this.dom.filterGroup.innerHTML = '<option value="all">Tất cả nhóm</option>' +
          groups.map(g => `<option value="${Security.escapeHTML(g)}">${Security.escapeHTML(g)}</option>`).join("");
      }

      // Populate Quận
      if (districts && districts.length) {
        this.dom.filterDistrict.innerHTML = '<option value="all">Tất cả quận</option>' +
          districts.map(d => `<option value="${Security.escapeHTML(d)}">${Security.escapeHTML(d)}</option>`).join("");
      }
    },

    renderSkeleton() {
      let html = "";
      for (let i = 0; i < 6; i++) {
        html += `
          <div class="skeleton-card">
            <div class="skeleton-line" style="width: 40%; height: 20px;"></div>
            <div class="skeleton-line" style="width: 80%;"></div>
            <div class="skeleton-line" style="width: 60%;"></div>
            <div class="skeleton-line" style="width: 50%; margin-top: 30px;"></div>
          </div>
        `;
      }
      this.dom.foodsGrid.innerHTML = html;
    },

    renderFoodsList(foodsToRender) {
      if (!foodsToRender || foodsToRender.length === 0) {
        this.dom.foodsGrid.innerHTML = `
          <div class="state-box" style="grid-column: 1 / -1;">
            <div class="state-icon">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="8" y1="12" x2="16" y2="12"></line></svg>
            </div>
            <h3 class="state-title">Không tìm thấy món ăn phù hợp</h3>
            <p class="state-desc">Hãy thử nới lỏng ngân sách, chọn 'Tất cả quận' hoặc tìm kiếm với từ khóa khác xem sao nhé!</p>
            <button class="btn-sub" onclick="document.getElementById('btn-reset-filters').click()">Xóa toàn bộ bộ lọc</button>
          </div>
        `;
        this.dom.foodCountLabel.textContent = "Không có kết quả";
        return;
      }

      this.dom.foodCountLabel.textContent = `Hiển thị ${foodsToRender.length} món ngon sẵn sàng phục vụ`;

      const cardsHtml = foodsToRender.map(item => {
        const isFav = state.favorites.some(f => f.id === item.id);
        const priceDisplay = item.minPrice !== null && item.maxPrice !== null
          ? `${Security.formatCurrency(item.minPrice)} - ${Security.formatCurrency(item.maxPrice)}`
          : (item.minPrice ? Security.formatCurrency(item.minPrice) : "Giá bình dân");

        return `
          <div class="food-card" data-id="${Security.escapeHTML(item.id)}">
            <div class="food-card-top">
              <div style="display: flex; justify-content: space-between; align-items: flex-start; gap: 8px;">
                <span class="tag-chip">${Security.escapeHTML(item.group || "Món ngon")}</span>
                <button class="btn-card-fav" data-id="${Security.escapeHTML(item.id)}" style="color: ${isFav ? 'var(--primary)' : 'var(--text-light)'};">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                </button>
              </div>
              <h3 class="food-card-title">${Security.escapeHTML(item.name)}</h3>
              <p class="food-card-desc">${Security.escapeHTML(item.description || "Hương vị hấp dẫn, không thể bỏ qua.")}</p>
              ${item.restaurant ? `<div class="food-card-venue"><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg> <span>${Security.escapeHTML(item.restaurant)} ${item.district ? `(${Security.escapeHTML(item.district)})` : ''}</span></div>` : ''}
            </div>
            <div class="food-card-bottom">
              <span class="price-chip">${Security.escapeHTML(priceDisplay)}</span>
              <button class="btn-sub btn-card-detail" data-id="${Security.escapeHTML(item.id)}" style="padding: 6px 14px; font-size: 13px;">Chi tiết</button>
            </div>
          </div>
        `;
      }).join("");

      this.dom.foodsGrid.innerHTML = cardsHtml;
    },

    displayRandomResult(food) {
      if (!food) {
        showToast("Không tìm thấy món ăn khớp với bộ lọc hiện tại!", "error");
        return;
      }

      state.currentFood = food;

      // Cập nhật giao diện thẻ kết quả
      this.dom.resName.textContent = food.name;
      this.dom.resDesc.textContent = food.description || "Món ăn tuyệt vời được cộng đồng gợi ý cho bữa ăn hôm nay.";

      // Meta chips
      let chipsHtml = `<span class="tag-chip">${Security.escapeHTML(food.group)}</span>`;
      if (food.purposes && food.purposes.length) {
        food.purposes.forEach(p => {
          chipsHtml += `<span class="tag-chip">${Security.escapeHTML(p)}</span>`;
        });
      }
      const priceText = food.minPrice !== null && food.maxPrice !== null
        ? `${Security.formatCurrency(food.minPrice)} - ${Security.formatCurrency(food.maxPrice)}`
        : (food.minPrice ? Security.formatCurrency(food.minPrice) : "Giá hợp lý");
      chipsHtml += `<span class="price-chip">${Security.escapeHTML(priceText)}</span>`;
      this.dom.resMetaChips.innerHTML = chipsHtml;

      // Quán & địa chỉ
      if (food.restaurant || food.address) {
        this.dom.resVenueBox.style.display = "block";
        this.dom.resVenueName.textContent = food.restaurant || "Quán ăn địa phương gợi ý";
        this.dom.resVenueAddress.textContent = (food.address || "") + (food.district ? ` (${food.district})` : "");
      } else {
        this.dom.resVenueBox.style.display = "none";
      }

      // Link Google Maps
      if (food.mapUrl && Security.isValidHttpUrl(food.mapUrl)) {
        this.dom.btnOpenMapRes.style.display = "inline-flex";
        this.dom.btnOpenMapRes.href = food.mapUrl;
      } else {
        this.dom.btnOpenMapRes.style.display = "none";
      }

      // Nút Favorite trên result
      const isFav = state.favorites.some(f => f.id === food.id);
      this.updateFavIconState(this.dom.btnToggleFavRes, isFav);

      // Hiển thị khung kết quả & cuộn nhẹ tới nó
      this.dom.randomSection.classList.add("active");
      this.dom.randomSection.scrollIntoView({ behavior: "smooth", block: "center" });

      // Lưu vào Lịch sử
      this.addToHistory(food);
    },

    updateFavIconState(btn, isFav) {
      if (!btn) return;
      btn.style.color = isFav ? "var(--primary)" : "var(--text-muted)";
      const svg = btn.querySelector("svg");
      if (svg) {
        svg.setAttribute("fill", isFav ? "currentColor" : "none");
      }
    },

    updateFavBadge() {
      const count = state.favorites.length;
      if (count > 0) {
        this.dom.favBadge.style.display = "flex";
        this.dom.favBadge.textContent = count > 99 ? "99+" : count;
      } else {
        this.dom.favBadge.style.display = "none";
      }
    },

    addToHistory(food) {
      // Tránh duplicate id kề nhau
      const newEntry = {
        id: food.id,
        name: food.name,
        group: food.group,
        restaurant: food.restaurant,
        district: food.district,
        time: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
        date: new Date().toLocaleDateString("vi-VN")
      };

      state.history.unshift(newEntry);
      if (state.history.length > CONFIG.HISTORY_MAX_ITEMS) {
        state.history.pop();
      }
      Storage.set(CONFIG.STORAGE_KEYS.HISTORY, state.history);
    },

    openFoodModal(food) {
      if (!food) return;
      this.dom.modalTitle.textContent = food.name;

      const isFav = state.favorites.some(f => f.id === food.id);
      const priceText = food.minPrice !== null && food.maxPrice !== null
        ? `${Security.formatCurrency(food.minPrice)} - ${Security.formatCurrency(food.maxPrice)}`
        : (food.minPrice ? Security.formatCurrency(food.minPrice) : "Đang cập nhật");

      let mapsBtnHtml = "";
      if (food.mapUrl && Security.isValidHttpUrl(food.mapUrl)) {
        mapsBtnHtml = `
          <a href="${Security.escapeHTML(food.mapUrl)}" target="_blank" rel="noopener noreferrer" class="btn-main" style="margin-top: 15px; width: 100%; justify-content: center;">
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
            Mở trên Google Maps
          </a>
        `;
      }

      this.dom.modalBody.innerHTML = `
        <div style="margin-bottom: 14px;">
          <span class="tag-chip">${Security.escapeHTML(food.group)}</span>
          <span class="price-chip">${Security.escapeHTML(priceText)}</span>
        </div>
        <p style="font-size: 15px; color: var(--text-main); margin-bottom: 16px; line-height: 1.6;">
          ${Security.escapeHTML(food.description || "Món ăn ngon đậm đà, được nhiều người yêu thích.")}
        </p>
        ${food.notes ? `
          <div style="background: var(--yellow-light); border-left: 4px solid var(--yellow-butter); padding: 10px 14px; border-radius: 6px; font-size: 13px; color: #855500; margin-bottom: 16px;">
            <strong>Lưu ý:</strong> ${Security.escapeHTML(food.notes)}
          </div>
        ` : ''}
        <div class="result-venue-box">
          <div class="venue-title">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M3 9l9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"></path></svg>
            ${Security.escapeHTML(food.restaurant || "Quán phục vụ")}
          </div>
          <div class="venue-address">${Security.escapeHTML(food.address || "Chưa cập nhật địa chỉ")} ${food.district ? `(${Security.escapeHTML(food.district)})` : ""}</div>
        </div>
        ${mapsBtnHtml}
      `;

      this.dom.modal.classList.add("active");
    },

    openFavoritesModal() {
      this.dom.modalTitle.textContent = `Món Đã Thích (${state.favorites.length})`;
      if (state.favorites.length === 0) {
        this.dom.modalBody.innerHTML = `
          <div class="state-box">
            <p class="state-desc">Bạn chưa thả tim món ăn nào. Hãy bấm biểu tượng trái tim ở các món ăn để lưu lại nhé!</p>
          </div>
        `;
      } else {
        const listHtml = state.favorites.map(f => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border-color);">
            <div>
              <h4 style="font-size: 15px; margin-bottom: 2px;">${Security.escapeHTML(f.name)}</h4>
              <span style="font-size: 12px; color: var(--text-muted);">${Security.escapeHTML(f.group)} ${f.district ? '• ' + Security.escapeHTML(f.district) : ''}</span>
            </div>
            <div style="display: flex; gap: 8px;">
              <button class="btn-sub btn-quick-pick" data-id="${Security.escapeHTML(f.id)}" style="padding: 6px 12px; font-size: 12px;">Xem</button>
              <button class="btn-sub btn-remove-fav" data-id="${Security.escapeHTML(f.id)}" style="padding: 6px 10px; color: var(--primary);">Xóa</button>
            </div>
          </div>
        `).join("");
        this.dom.modalBody.innerHTML = listHtml;
      }
      this.dom.modal.classList.add("active");
    },

    openHistoryModal() {
      this.dom.modalTitle.textContent = "Lịch Sử Chọn Món";
      if (state.history.length === 0) {
        this.dom.modalBody.innerHTML = `
          <div class="state-box">
            <p class="state-desc">Bạn chưa quay món nào hôm nay. Hãy bấm "Chọn món cho tôi" để bắt đầu!</p>
          </div>
        `;
      } else {
        const listHtml = `
          <div style="text-align: right; margin-bottom: 10px;">
            <button id="btn-clear-history" style="font-size: 12px; color: var(--primary); text-decoration: underline;">Xóa toàn bộ lịch sử</button>
          </div>
          <div>
            ${state.history.map(h => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed var(--border-color);">
                <div>
                  <h4 style="font-size: 14px;">${Security.escapeHTML(h.name)}</h4>
                  <span style="font-size: 12px; color: var(--text-muted);">${Security.escapeHTML(h.restaurant || h.group)} • ${Security.escapeHTML(h.time)}</span>
                </div>
                <button class="btn-sub btn-quick-pick" data-id="${Security.escapeHTML(h.id)}" style="padding: 4px 10px; font-size: 12px;">Chi tiết</button>
              </div>
            `).join("")}
          </div>
        `;
        this.dom.modalBody.innerHTML = listHtml;
      }
      this.dom.modal.classList.add("active");
    },

    closeModal() {
      this.dom.modal.classList.remove("active");
    }
  };

  // 10. APP CONTROLLER & EVENTS BINDING
  const App = {
    async init() {
      UI.initElements();
      UI.renderSkeleton();

      // Khôi phục favorites & history từ LocalStorage
      state.favorites = Storage.get(CONFIG.STORAGE_KEYS.FAVORITES, []);
      state.history = Storage.get(CONFIG.STORAGE_KEYS.HISTORY, []);
      UI.updateFavBadge();

      // Khởi động Three.js Scene
      ThreeScene.init();

      // Gắn sự kiện giao diện
      this.bindEvents();

      // Nạp dữ liệu từ Google Sheets Backend
      try {
        state.isLoading = true;
        const res = await ApiClient.fetchFoods();
        state.foods = res.data || [];
        state.filteredFoods = state.foods.slice();

        // Lấy bộ filter dynamic
        this.extractFiltersMeta(state.foods);
        UI.populateFilterOptions();
        UI.renderFoodsList(state.filteredFoods);

      } catch (err) {
        UI.dom.foodsGrid.innerHTML = `
          <div class="state-box" style="grid-column: 1 / -1;">
            <div class="state-icon" style="background: #FFE5E0; color: #D9381E;">
              <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12" y2="12"></line><line x1="12" y1="16" x2="12.01" y2="16"></line></svg>
            </div>
            <h3 class="state-title">Chưa kết nối được với Google Sheets</h3>
            <p class="state-desc">${Security.escapeHTML(err.message)}</p>
            <button class="btn-main" onclick="location.reload()" style="margin: 0 auto;">Thử lại</button>
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
        if (f.district) dSet.add(f.district);
        if (f.purposes) f.purposes.forEach(p => pSet.add(p));
      });

      state.filtersMeta.groups = Array.from(gSet).sort();
      state.filtersMeta.purposes = Array.from(pSet).sort();
      state.filtersMeta.districts = Array.from(dSet).sort();
    },

    bindEvents() {
      // 1. Nút Random chính & Nút "Đổi món khác"
      const handleSpin = () => {
        if (state.foods.length === 0) {
          showToast("Đang tải dữ liệu, vui lòng đợi giây lát...", "info");
          return;
        }

        // Tạo hiệu ứng lắc xúc xắc / roll nhanh
        UI.dom.btnHeroSpin.disabled = true;
        UI.dom.btnHeroSpin.querySelector("span").textContent = "Đang chọn món ngon...";

        setTimeout(() => {
          const picked = FoodEngine.spinRandom();
          UI.dom.btnHeroSpin.disabled = false;
          UI.dom.btnHeroSpin.querySelector("span").textContent = "Chọn món cho tôi";

          if (picked) {
            UI.displayRandomResult(picked);
            showToast(`Đã chọn: ${picked.name}!`, "success");
          } else {
            showToast("Không có món nào phù hợp với các tiêu chí này. Hãy nới lỏng bộ lọc nhé!", "error");
          }
        }, 500);
      };

      UI.dom.btnHeroSpin.addEventListener("click", handleSpin);
      UI.dom.btnSpinAgain.addEventListener("click", handleSpin);

      // 2. Filter change events
      const onFilterChange = () => {
        state.activeFilters.purpose = UI.dom.filterPurpose.value;
        state.activeFilters.group = UI.dom.filterGroup.value;
        state.activeFilters.district = UI.dom.filterDistrict.value;
        state.activeFilters.maxBudget = UI.dom.filterBudget.value;
        state.activeFilters.excludeRecent = UI.dom.chkExcludeRecent.checked;
        this.applyFrontendFilters();
      };

      UI.dom.filterPurpose.addEventListener("change", onFilterChange);
      UI.dom.filterGroup.addEventListener("change", onFilterChange);
      UI.dom.filterDistrict.addEventListener("change", onFilterChange);
      UI.dom.filterBudget.addEventListener("change", onFilterChange);
      UI.dom.chkExcludeRecent.addEventListener("change", onFilterChange);

      // Reset filters
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
        this.applyFrontendFilters();
        showToast("Đã đặt lại tất cả bộ lọc", "info");
      });

      // 3. Search box với debounce
      let searchDebounceTimer = null;
      UI.dom.searchBox.addEventListener("input", (e) => {
        clearTimeout(searchDebounceTimer);
        searchDebounceTimer = setTimeout(() => {
          state.activeFilters.keyword = e.target.value;
          this.applyFrontendFilters();
        }, 250);
      });

      // 4. Scroll to explore
      UI.dom.btnExploreScroll.addEventListener("click", () => {
        document.getElementById("explore-view").scrollIntoView({ behavior: "smooth" });
      });

      // 5. Thích / Bỏ thích từ kết quả Random
      UI.dom.btnToggleFavRes.addEventListener("click", () => {
        if (!state.currentFood) return;
        this.toggleFavorite(state.currentFood);
        const isFav = state.favorites.some(f => f.id === state.currentFood.id);
        UI.updateFavIconState(UI.dom.btnToggleFavRes, isFav);
      });

      // 6. Chia sẻ kết quả qua Web Share API hoặc Clipboard
      UI.dom.btnShareRes.addEventListener("click", async () => {
        if (!state.currentFood) return;
        const f = state.currentFood;
        const shareData = {
          title: `Hôm nay ăn: ${f.name}!`,
          text: `Mình vừa chọn được món "${f.name}" tại ${f.restaurant || "quán ngon gần đây"} qua ứng dụng Ăn Gì Đây?`,
          url: window.location.href
        };

        if (navigator.share) {
          try {
            await navigator.share(shareData);
          } catch (_) {
            // Người dùng hủy chia sẻ
          }
        } else {
          // Fallback copy vào clipboard
          try {
            await navigator.clipboard.writeText(`${shareData.title} - ${shareData.text} \nXem tại: ${shareData.url}`);
            showToast("Đã sao chép nội dung gợi ý vào bộ nhớ tạm!", "success");
          } catch (e) {
            showToast("Trình duyệt không hỗ trợ chia sẻ tự động.", "error");
          }
        }
      });

      // 7. Click events trên danh sách món ăn (Ủy quyền sự kiện)
      UI.dom.foodsGrid.addEventListener("click", (e) => {
        const detailBtn = e.target.closest(".btn-card-detail");
        if (detailBtn) {
          const id = detailBtn.getAttribute("data-id");
          const food = state.foods.find(item => item.id === id);
          if (food) UI.openFoodModal(food);
          return;
        }

        const favBtn = e.target.closest(".btn-card-fav");
        if (favBtn) {
          const id = favBtn.getAttribute("data-id");
          const food = state.foods.find(item => item.id === id);
          if (food) {
            this.toggleFavorite(food);
            const isFav = state.favorites.some(f => f.id === food.id);
            favBtn.style.color = isFav ? "var(--primary)" : "var(--text-light)";
            favBtn.querySelector("svg").setAttribute("fill", isFav ? "currentColor" : "none");
          }
        }
      });

      // 8. Modals: Favorites & History
      UI.dom.btnOpenFavorites.addEventListener("click", () => UI.openFavoritesModal());
      UI.dom.btnOpenHistory.addEventListener("click", () => UI.openHistoryModal());
      UI.dom.modalCloseBtn.addEventListener("click", () => UI.closeModal());
      UI.dom.modal.addEventListener("click", (e) => {
        if (e.target === UI.dom.modal) UI.closeModal();
      });

      window.addEventListener("keydown", (e) => {
        if (e.key === "Escape" && UI.dom.modal.classList.contains("active")) {
          UI.closeModal();
        }
      });

      // Thao tác trong Modal (Xóa món yêu thích / Chi tiết món từ modal)
      UI.dom.modalBody.addEventListener("click", (e) => {
        const removeFavBtn = e.target.closest(".btn-remove-fav");
        if (removeFavBtn) {
          const id = removeFavBtn.getAttribute("data-id");
          const food = state.foods.find(f => f.id === id);
          if (food) {
            this.toggleFavorite(food);
            UI.openFavoritesModal(); // Render lại modal
          }
          return;
        }

        const quickPickBtn = e.target.closest(".btn-quick-pick");
        if (quickPickBtn) {
          const id = quickPickBtn.getAttribute("data-id");
          const food = state.foods.find(f => f.id === id);
          if (food) {
            UI.closeModal();
            UI.openFoodModal(food);
          }
          return;
        }

        const clearHistoryBtn = e.target.closest("#btn-clear-history");
        if (clearHistoryBtn) {
          state.history = [];
          Storage.set(CONFIG.STORAGE_KEYS.HISTORY, []);
          UI.openHistoryModal();
          showToast("Đã xóa toàn bộ lịch sử", "info");
        }
      });

      // 9. Mobile Bottom Nav Tabs
      UI.dom.navTabRandom.addEventListener("click", () => {
        this.switchTab(UI.dom.navTabRandom);
        document.getElementById("hero-view").scrollIntoView({ behavior: "smooth" });
      });
      UI.dom.navTabExplore.addEventListener("click", () => {
        this.switchTab(UI.dom.navTabExplore);
        document.getElementById("explore-view").scrollIntoView({ behavior: "smooth" });
      });
      UI.dom.navTabFav.addEventListener("click", () => {
        this.switchTab(UI.dom.navTabFav);
        UI.openFavoritesModal();
      });
      UI.dom.navTabHist.addEventListener("click", () => {
        this.switchTab(UI.dom.navTabHist);
        UI.openHistoryModal();
      });
    },

    switchTab(activeBtn) {
      document.querySelectorAll(".nav-tab-btn").forEach(btn => btn.classList.remove("active"));
      activeBtn.classList.add("active");
    },

    toggleFavorite(food) {
      const index = state.favorites.findIndex(f => f.id === food.id);
      if (index > -1) {
        state.favorites.splice(index, 1);
        showToast(`Đã bỏ thích món ${food.name}`, "info");
      } else {
        state.favorites.push({
          id: food.id,
          name: food.name,
          group: food.group,
          district: food.district
        });
        showToast(`Đã thêm "${food.name}" vào yêu thích!`, "success");
      }
      Storage.set(CONFIG.STORAGE_KEYS.FAVORITES, state.favorites);
      UI.updateFavBadge();
    },

    applyFrontendFilters() {
      const f = state.activeFilters;
      let result = state.foods.slice();

      // Từ khóa không dấu
      if (f.keyword) {
        const normKey = Security.normalizeVietnamese(f.keyword);
        result = result.filter(item => {
          const searchContent = Security.normalizeVietnamese(
            (item.name || "") + " " + (item.group || "") + " " + (item.restaurant || "") + " " + (item.district || "")
          );
          return searchContent.includes(normKey);
        });
      }

      // Mục đích
      if (f.purpose && f.purpose !== "all") {
        result = result.filter(item => item.purposes && item.purposes.includes(f.purpose));
      }

      // Nhóm
      if (f.group && f.group !== "all") {
        result = result.filter(item => item.group === f.group);
      }

      // Quận
      if (f.district && f.district !== "all") {
        result = result.filter(item => item.district === f.district);
      }

      // Giá tối đa
      if (f.maxBudget && f.maxBudget !== "all") {
        const budgetLimit = parseInt(f.maxBudget, 10);
        result = result.filter(item => {
          if (item.minPrice === null && item.maxPrice === null) return true;
          if (item.minPrice !== null && item.minPrice > budgetLimit) return false;
          return true;
        });
      }

      state.filteredFoods = result;
      UI.renderFoodsList(state.filteredFoods);
    }
  };

  // Khởi động toàn bộ ứng dụng khi DOM tải xong
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => App.init());
  } else {
    App.init();
  }

})();
