/**
 * ============================================================================
 * DỰ ÁN: ĂN GÌ ĐÂY? (SMART FOOD PICKER)
 * File: app.js - Logic Gộp Món, Hiệu Ứng 3D Khui Lồng Bàn, Dynamic Filter
 * ============================================================================
 */

(function () {
  'use strict';

  // 1. CẤU HÌNH TẬP TRUNG (CONFIG)
  const CONFIG = {
    APP_NAME: "Ăn Gì Đây?",
    API_URL: "https://script.google.com/macros/s/AKfycbxoKW24CyLJCYxNpy-fL6-WvsJTYbDjZRbYW0DHGnKNlHKoaLfMBKjQvi0Oa3SZS_9A/exec",
    STORAGE_KEYS: {
      FAVORITES: "agd_favorites_v2",
      HISTORY: "agd_history_v2"
    },
    HISTORY_MAX_ITEMS: 30,
    REQUEST_TIMEOUT_MS: 15000
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
    isRolling: false
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

  // 4. API CLIENT TẬP TRUNG (JSONP AN TOÀN VỚI APPS SCRIPT)
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
          if (window[callbackName]) delete window[callbackName];
          if (script.parentNode) script.parentNode.removeChild(script);
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
          reject(new Error("Lỗi kết nối tới máy chủ Google Apps Script."));
        };

        document.head.appendChild(script);
      });
    },

    async fetchFoods(forceRefresh = false) {
      return await this.jsonp(CONFIG.API_URL, {
        action: "getFoods",
        limit: 150,
        refresh: forceRefresh ? "true" : "false"
      });
    }
  };

  // 5. STORAGE SERVICE (LocalStorage)
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
        console.warn("LocalStorage không khả dụng:", e);
      }
    }
  };

  // 6. THREE.JS 3D CLOCHE ENGINE (Mô hình Lồng bàn mạ bạc bật nắp kịch tính)
  const ThreeScene = {
    renderer: null,
    scene: null,
    camera: null,
    clocheGroup: null,
    platterGroup: null,
    particles: null,
    isOpening: false,
    openProgress: 0,

    init() {
      const container = document.getElementById("three-canvas-container");
      if (!container || typeof THREE === "undefined") return;

      try {
        const width = container.clientWidth || 360;
        const height = container.clientHeight || 320;

        this.scene = new THREE.Scene();
        this.camera = new THREE.PerspectiveCamera(45, width / height, 0.1, 1000);
        this.camera.position.set(0, 3.2, 5.8);
        this.camera.lookAt(0, 0.4, 0);

        this.renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
        this.renderer.setSize(width, height);
        this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
        container.appendChild(this.renderer.domElement);

        // Ánh sáng Studio chuyên nghiệp (Kim loại Chrome phản xạ đẹp mắt)
        const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
        this.scene.add(ambientLight);

        const dirLight = new THREE.DirectionalLight(0xfff5ea, 1.5);
        dirLight.position.set(6, 10, 8);
        this.scene.add(dirLight);

        const fillLight = new THREE.DirectionalLight(0xddeeff, 0.8);
        fillLight.position.set(-6, 4, -4);
        this.scene.add(fillLight);

        // Vật liệu Chrome/Bạc mạ bóng
        const silverMaterial = new THREE.MeshStandardMaterial({
          color: 0xEEEEF2,
          metalness: 0.88,
          roughness: 0.18
        });

        const accentGoldMaterial = new THREE.MeshStandardMaterial({
          color: 0xFF532A, // Điểm xuyết viền cam Ember nhận diện thương hiệu
          metalness: 0.4,
          roughness: 0.2
        });

        // 1. KHAY ĐĨA TRÒN (PLATTER)
        this.platterGroup = new THREE.Group();
        const plateGeo = new THREE.CylinderGeometry(2.1, 1.7, 0.12, 48);
        const plateMesh = new THREE.Mesh(plateGeo, silverMaterial);
        this.platterGroup.add(plateMesh);

        const rimGeo = new THREE.TorusGeometry(2.12, 0.05, 16, 48);
        const rimMesh = new THREE.Mesh(rimGeo, accentGoldMaterial);
        rimMesh.rotation.x = Math.PI / 2;
        this.platterGroup.add(rimMesh);

        this.scene.add(this.platterGroup);

        // 2. NẮP LỒNG BÀN (CLOCHE LID)
        this.clocheGroup = new THREE.Group();
        this.clocheGroup.position.y = 0.06;

        // Vòm nắp bán cầu
        const domeGeo = new THREE.SphereGeometry(1.6, 32, 24, 0, Math.PI * 2, 0, Math.PI / 2);
        const domeMesh = new THREE.Mesh(domeGeo, silverMaterial);
        this.clocheGroup.add(domeMesh);

        // Tay cầm trên đỉnh lồng bàn
        const handleGeo = new THREE.SphereGeometry(0.24, 20, 20);
        const handleMesh = new THREE.Mesh(handleGeo, accentGoldMaterial);
        handleMesh.position.y = 1.75;
        this.clocheGroup.add(handleMesh);

        const handleBaseGeo = new THREE.CylinderGeometry(0.1, 0.18, 0.2, 16);
        const handleBaseMesh = new THREE.Mesh(handleBaseGeo, silverMaterial);
        handleBaseMesh.position.y = 1.62;
        this.clocheGroup.add(handleBaseMesh);

        this.scene.add(this.clocheGroup);

        // 3. HỆ THỐNG HẠT SÁNG & KHÓI BỐC LÊN (STEAM PARTICLES)
        const particleCount = 45;
        const particleGeo = new THREE.BufferGeometry();
        const posArray = new Float32Array(particleCount * 3);

        for (let i = 0; i < particleCount * 3; i += 3) {
          posArray[i] = (Math.random() - 0.5) * 1.6;
          posArray[i + 1] = Math.random() * 0.5;
          posArray[i + 2] = (Math.random() - 0.5) * 1.6;
        }

        particleGeo.setAttribute('position', new THREE.BufferAttribute(posArray, 3));
        const particleMat = new THREE.PointsMaterial({
          size: 0.08,
          color: 0xFF7A51,
          transparent: true,
          opacity: 0
        });

        this.particles = new THREE.Points(particleGeo, particleMat);
        this.scene.add(this.particles);

        // Animation Loop
        const animate = () => {
          requestAnimationFrame(animate);

          // Xoay nhẹ tự nhiên khi nghỉ
          if (!this.isOpening) {
            this.clocheGroup.rotation.y += 0.005;
            this.platterGroup.rotation.y += 0.005;
            this.clocheGroup.position.y = 0.06 + Math.sin(Date.now() * 0.003) * 0.03;
          } else {
            // Khi mở nắp lồng bàn
            if (this.openProgress < 1) {
              this.openProgress += 0.04;
              const ease = Math.sin(this.openProgress * Math.PI / 2);
              this.clocheGroup.position.y = 0.06 + ease * 2.4;
              this.clocheGroup.rotation.y += 0.15;
              this.clocheGroup.rotation.z = Math.sin(this.openProgress * Math.PI) * 0.35;

              // Hiện hạt khói hơi nóng
              this.particles.material.opacity = Math.sin(this.openProgress * Math.PI) * 0.85;
              this.particles.position.y = ease * 1.4;
            }
          }

          this.renderer.render(this.scene, this.camera);
        };
        animate();

        // Responsive Resize
        window.addEventListener("resize", () => {
          if (!container || !this.camera || !this.renderer) return;
          const w = container.clientWidth;
          const h = container.clientHeight;
          this.camera.aspect = w / h;
          this.camera.updateProjectionMatrix();
          this.renderer.setSize(w, h);
        });

      } catch (err) {
        console.warn("Không khởi tạo được Three.js:", err);
      }
    },

    triggerReveal(onComplete) {
      if (!this.clocheGroup) {
        if (onComplete) onComplete();
        return;
      }

      this.isOpening = true;
      this.openProgress = 0;
      const statusText = document.getElementById("stage-status-text");
      if (statusText) statusText.textContent = "✨ Đang mở nắp khui món...";

      // Rung lắc hồi hộp trước khi nhấc bổng
      let shakes = 0;
      const shakeInterval = setInterval(() => {
        this.clocheGroup.position.x = (Math.random() - 0.5) * 0.12;
        shakes++;
        if (shakes > 8) {
          clearInterval(shakeInterval);
          this.clocheGroup.position.x = 0;
        }
      }, 40);

      setTimeout(() => {
        if (onComplete) onComplete();
        if (statusText) statusText.textContent = "Món ngon đã sẵn sàng!";
        
        // Sau 2.8s đóng nắp lại nhẹ nhàng
        setTimeout(() => {
          const closeInterval = setInterval(() => {
            this.openProgress -= 0.05;
            const ease = Math.max(0, this.openProgress);
            this.clocheGroup.position.y = 0.06 + ease * 2.4;
            this.clocheGroup.rotation.z = ease * 0.35;
            this.particles.material.opacity = ease * 0.5;

            if (this.openProgress <= 0) {
              clearInterval(closeInterval);
              this.isOpening = false;
              this.clocheGroup.position.y = 0.06;
              this.clocheGroup.rotation.z = 0;
              this.particles.material.opacity = 0;
              if (statusText) statusText.textContent = "Lồng bàn ẩm thực sẵn sàng";
            }
          }, 30);
        }, 2800);
      }, 700);
    }
  };

  // 7. TOAST THÔNG BÁO
  function showToast(message, type = "info") {
    const container = document.getElementById("toast-container");
    if (!container) return;

    const toast = document.createElement("div");
    toast.className = "toast-pill";
    
    let iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="16" x2="12" y2="12"></line><line x1="12" y1="8" x2="12.01" y2="8"></line></svg>';
    if (type === "success") {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#2A9D8F" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg>';
    } else if (type === "error") {
      iconSvg = '<svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#FF532A" stroke-width="2.5"><circle cx="12" cy="12" r="10"></circle><line x1="15" y1="9" x2="9" y2="15"></line><line x1="9" y1="9" x2="15" y2="15"></line></svg>';
    }

    toast.innerHTML = iconSvg + "<span>" + Security.escapeHTML(message) + "</span>";
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.opacity = "0";
      toast.style.transform = "translateY(10px)";
      toast.style.transition = "all 0.3s ease";
      setTimeout(() => {
        if (toast.parentNode) toast.parentNode.removeChild(toast);
      }, 300);
    }, 3000);
  }

  // 8. LOGIC CHỌN MÓN NGẪU NHIÊN (CORE ENGINE)
  const FoodEngine = {
    getEligibleCandidates() {
      const f = state.activeFilters;
      let list = state.foods.slice();

      // 1. Lọc theo mục đích
      if (f.purpose && f.purpose !== "all") {
        list = list.filter(item => item.purposes && item.purposes.includes(f.purpose));
      }

      // 2. Lọc theo nhóm
      if (f.group && f.group !== "all") {
        list = list.filter(item => item.group === f.group);
      }

      // 3. Lọc theo quận (kiểm tra trong mảng districts)
      if (f.district && f.district !== "all") {
        list = list.filter(item => item.districts && item.districts.includes(f.district));
      }

      // 4. Lọc theo ngân sách (minPrice hợp lệ)
      if (f.maxBudget && f.maxBudget !== "all") {
        const budgetLimit = parseInt(f.maxBudget, 10);
        list = list.filter(item => {
          if (item.minPrice === null) return true;
          return item.minPrice <= budgetLimit;
        });
      }

      // 5. Loại trừ 5 món vừa chọn gần đây
      if (f.excludeRecent && state.history.length > 0) {
        const recentIds = state.history.slice(0, 5).map(h => h.id);
        const withoutRecent = list.filter(item => !recentIds.includes(item.id));
        if (withoutRecent.length > 0) {
          list = withoutRecent;
        }
      }

      return list;
    },

    spinRandom() {
      const candidates = this.getEligibleCandidates();
      if (!candidates || candidates.length === 0) return null;
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
        navTabRandom: document.getElementById("tab-nav-random"),
        navTabExplore: document.getElementById("tab-nav-explore"),
        navTabFav: document.getElementById("tab-nav-favorites"),
        navTabHist: document.getElementById("tab-nav-history")
      };
    },

    populateFilterOptions() {
      const { groups, purposes, districts } = state.filtersMeta;

      if (purposes && purposes.length) {
        this.dom.filterPurpose.innerHTML = '<option value="all">Tất cả mục đích</option>' +
          purposes.map(p => `<option value="${Security.escapeHTML(p)}">${Security.escapeHTML(p)}</option>`).join("");
      }

      if (groups && groups.length) {
        this.dom.filterGroup.innerHTML = '<option value="all">Tất cả nhóm</option>' +
          groups.map(g => `<option value="${Security.escapeHTML(g)}">${Security.escapeHTML(g)}</option>`).join("");
      }

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
            <div class="skeleton-line" style="width: 30%;"></div>
            <div class="skeleton-line" style="width: 75%; height: 22px;"></div>
            <div class="skeleton-line" style="width: 90%;"></div>
            <div class="skeleton-line" style="width: 45%; margin-top: 26px;"></div>
          </div>
        `;
      }
      this.dom.foodsGrid.innerHTML = html;
    },

    renderFoodsList(foodsToRender) {
      if (!foodsToRender || foodsToRender.length === 0) {
        this.dom.foodsGrid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; background: var(--bg-surface); border-radius: var(--radius-lg); border: 1px dashed var(--border-subtle);">
            <h3 style="font-size: 1.25rem; margin-bottom: 8px;">Không tìm thấy món ăn nào</h3>
            <p style="color: var(--text-muted); font-size: 14px; margin-bottom: 16px;">Hãy thử nới lỏng ngân sách hoặc chọn 'Tất cả quận' xem sao nhé!</p>
            <button class="btn-sub" onclick="document.getElementById('btn-reset-filters').click()">Xóa bộ lọc</button>
          </div>
        `;
        this.dom.foodCountLabel.textContent = "0 món ăn";
        return;
      }

      this.dom.foodCountLabel.textContent = `Hiển thị ${foodsToRender.length} món ăn đặc sắc`;

      const cardsHtml = foodsToRender.map(item => {
        const isFav = state.favorites.some(f => f.id === item.id);
        const venueCount = item.venues ? item.venues.length : 0;
        const priceDisplay = item.minPrice !== null && item.maxPrice !== null
          ? (item.minPrice === item.maxPrice ? Security.formatCurrency(item.minPrice) : `${Security.formatCurrency(item.minPrice)} - ${Security.formatCurrency(item.maxPrice)}`)
          : (item.minPrice ? Security.formatCurrency(item.minPrice) : "Giá bình dân");

        return `
          <div class="food-card" data-id="${Security.escapeHTML(item.id)}">
            <div class="card-top">
              <div class="card-meta-line">
                <span class="chip">${Security.escapeHTML(item.group || "Món ngon")}</span>
                <button class="btn-card-fav" data-id="${Security.escapeHTML(item.id)}" style="color: ${isFav ? 'var(--primary)' : 'var(--text-subtle)'};">
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="${isFav ? 'currentColor' : 'none'}" stroke="currentColor" stroke-width="2"><path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z"></path></svg>
                </button>
              </div>
              <h3 class="food-card-title">${Security.escapeHTML(item.name)}</h3>
              <p class="food-card-desc">${Security.escapeHTML(item.description || "Món ngon đậm vị, khó cưỡng dành cho bạn.")}</p>
              ${venueCount > 0 ? `
                <span class="venue-badge-pill">
                  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"></path><circle cx="12" cy="10" r="3"></circle></svg>
                  ${venueCount} quán gợi ý
                </span>
              ` : ''}
            </div>
            <div class="card-bottom">
              <span class="chip chip-price">${Security.escapeHTML(priceDisplay)}</span>
              <span style="font-size: 13px; font-weight: 700; color: var(--primary);">Xem chi tiết &rarr;</span>
            </div>
          </div>
        `;
      }).join("");

      this.dom.foodsGrid.innerHTML = cardsHtml;
    },

    displayRandomResult(food) {
      if (!food) {
        showToast("Không tìm thấy món nào khớp tiêu chí lọc!", "error");
        return;
      }

      state.currentFood = food;

      this.dom.resName.textContent = food.name;
      this.dom.resDesc.textContent = food.description || "Món ăn ngon miệng giàu năng lượng cho ngày mới.";

      // Chips
      let chipsHtml = `<span class="chip">${Security.escapeHTML(food.group)}</span>`;
      if (food.purposes) {
        food.purposes.forEach(p => { chipsHtml += `<span class="chip">${Security.escapeHTML(p)}</span>`; });
      }
      const priceText = food.minPrice !== null && food.maxPrice !== null
        ? (food.minPrice === food.maxPrice ? Security.formatCurrency(food.minPrice) : `${Security.formatCurrency(food.minPrice)} - ${Security.formatCurrency(food.maxPrice)}`)
        : "Giá bình dân";
      chipsHtml += `<span class="chip chip-price">${Security.escapeHTML(priceText)}</span>`;
      this.dom.resMetaChips.innerHTML = chipsHtml;

      // Danh sách venues của món gộp
      const venues = food.venues || [];
      this.dom.resVenuesCount.textContent = venues.length;

      if (venues.length === 0) {
        this.dom.resVenuesContainer.innerHTML = `<p style="font-size: 13.5px; color: var(--text-muted);">Món ăn phổ biến, dễ dàng tìm thấy tại các hàng quán gần bạn.</p>`;
      } else {
        this.dom.resVenuesContainer.innerHTML = venues.map(v => `
          <div class="venue-item-card">
            <div>
              <div class="venue-name">${Security.escapeHTML(v.restaurant)} ${v.district ? `<span style="font-size:12px; font-weight:normal; color:var(--text-muted);">(${Security.escapeHTML(v.district)})</span>` : ''}</div>
              <div class="venue-address">${Security.escapeHTML(v.address || "Địa chỉ đang cập nhật")}</div>
              ${v.notes ? `<div style="font-size: 11.5px; color: var(--primary); margin-top: 3px;">* ${Security.escapeHTML(v.notes)}</div>` : ''}
            </div>
            <div style="display: flex; gap: 8px;">
              ${v.mapUrl && Security.isValidHttpUrl(v.mapUrl) ? `
                <a href="${Security.escapeHTML(v.mapUrl)}" target="_blank" rel="noopener noreferrer" class="btn-sub" style="padding: 6px 12px; font-size: 12px;">
                  Bản đồ
                </a>
              ` : ''}
            </div>
          </div>
        `).join("");
      }

      // Nút Favorite
      const isFav = state.favorites.some(f => f.id === food.id);
      this.updateFavIconState(this.dom.btnToggleFavRes, isFav);

      // Hiển thị khung kết quả & cuộn mượt
      this.dom.randomSection.classList.add("active");
      this.dom.randomSection.scrollIntoView({ behavior: "smooth", block: "center" });

      this.addToHistory(food);
    },

    updateFavIconState(btn, isFav) {
      if (!btn) return;
      btn.style.color = isFav ? "var(--primary)" : "var(--text-subtle)";
      const svg = btn.querySelector("svg");
      if (svg) svg.setAttribute("fill", isFav ? "currentColor" : "none");
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
      const newEntry = {
        id: food.id,
        name: food.name,
        group: food.group,
        venuesCount: food.venues ? food.venues.length : 0,
        time: new Date().toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }),
        date: new Date().toLocaleDateString("vi-VN")
      };

      state.history.unshift(newEntry);
      if (state.history.length > CONFIG.HISTORY_MAX_ITEMS) state.history.pop();
      Storage.set(CONFIG.STORAGE_KEYS.HISTORY, state.history);
    },

    openFoodModal(food) {
      if (!food) return;
      this.dom.modalTitle.textContent = food.name;

      const priceText = food.minPrice !== null && food.maxPrice !== null
        ? (food.minPrice === food.maxPrice ? Security.formatCurrency(food.minPrice) : `${Security.formatCurrency(food.minPrice)} - ${Security.formatCurrency(food.maxPrice)}`)
        : "Giá bình dân";

      const venues = food.venues || [];
      const venuesHtml = venues.length > 0 ? venues.map(v => `
        <div class="venue-item-card">
          <div>
            <div class="venue-name">${Security.escapeHTML(v.restaurant)} ${v.district ? `<span style="font-size:12px; font-weight:normal; color:var(--text-muted);">(${Security.escapeHTML(v.district)})</span>` : ''}</div>
            <div class="venue-address">${Security.escapeHTML(v.address || "Địa chỉ cập nhật tại quán")}</div>
            ${v.notes ? `<div style="font-size: 12px; color: var(--primary); margin-top: 4px;">* ${Security.escapeHTML(v.notes)}</div>` : ''}
          </div>
          <div style="display:flex; gap:6px;">
            ${v.mapUrl && Security.isValidHttpUrl(v.mapUrl) ? `
              <a href="${Security.escapeHTML(v.mapUrl)}" target="_blank" rel="noopener noreferrer" class="btn-sub" style="padding: 6px 12px; font-size: 12px;">
                Chỉ đường
              </a>
            ` : ''}
          </div>
        </div>
      `).join("") : '<p style="color:var(--text-muted); font-size:13px;">Chưa có quán cụ thể được lưu trữ cho món này.</p>';

      this.dom.modalBody.innerHTML = `
        <div style="margin-bottom: 14px;">
          <span class="chip">${Security.escapeHTML(food.group)}</span>
          <span class="chip chip-price">${Security.escapeHTML(priceText)}</span>
        </div>
        <p style="font-size: 15px; color: var(--text-main); margin-bottom: 20px; line-height: 1.6;">
          ${Security.escapeHTML(food.description || "Hương vị thơm ngon truyền thống khó quên.")}
        </p>
        <div style="font-size: 14.5px; font-weight: 800; margin-bottom: 12px;">Các quán phục vụ món này (${venues.length})</div>
        <div>${venuesHtml}</div>
      `;

      this.dom.modal.classList.add("active");
    },

    openFavoritesModal() {
      this.dom.modalTitle.textContent = `Món Đã Thích (${state.favorites.length})`;
      if (state.favorites.length === 0) {
        this.dom.modalBody.innerHTML = `
          <div style="text-align: center; padding: 36px 16px;">
            <p style="color: var(--text-muted);">Bạn chưa lưu món ăn nào. Hãy bấm biểu tượng trái tim để lưu lại nhé!</p>
          </div>
        `;
      } else {
        const listHtml = state.favorites.map(f => `
          <div style="display: flex; justify-content: space-between; align-items: center; padding: 12px 0; border-bottom: 1px solid var(--border-subtle);">
            <div>
              <h4 style="font-size: 15px;">${Security.escapeHTML(f.name)}</h4>
              <span style="font-size: 12.5px; color: var(--text-muted);">${Security.escapeHTML(f.group)}</span>
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
          <div style="text-align: center; padding: 36px 16px;">
            <p style="color: var(--text-muted);">Chưa có lịch sử quay hôm nay. Hãy bấm "Chọn món cho tôi" để bắt đầu!</p>
          </div>
        `;
      } else {
        const listHtml = `
          <div style="text-align: right; margin-bottom: 12px;">
            <button id="btn-clear-history" style="font-size: 12.5px; color: var(--primary); text-decoration: underline;">Xóa toàn bộ lịch sử</button>
          </div>
          <div>
            ${state.history.map(h => `
              <div style="display: flex; justify-content: space-between; align-items: center; padding: 10px 0; border-bottom: 1px dashed var(--border-subtle);">
                <div>
                  <h4 style="font-size: 14.5px;">${Security.escapeHTML(h.name)}</h4>
                  <span style="font-size: 12px; color: var(--text-muted);">${Security.escapeHTML(h.group)} • ${Security.escapeHTML(h.time)}</span>
                </div>
                <button class="btn-sub btn-quick-pick" data-id="${Security.escapeHTML(h.id)}" style="padding: 4px 10px; font-size: 12px;">Xem lại</button>
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

  // 10. APP CONTROLLER
  const App = {
    async init() {
      UI.initElements();
      UI.renderSkeleton();

      state.favorites = Storage.get(CONFIG.STORAGE_KEYS.FAVORITES, []);
      state.history = Storage.get(CONFIG.STORAGE_KEYS.HISTORY, []);
      UI.updateFavBadge();

      // Cập nhật text khung giờ thông minh
      this.setupSmartMealTime();

      // Khởi động 3D Scene
      ThreeScene.init();

      this.bindEvents();

      try {
        state.isLoading = true;
        const res = await ApiClient.fetchFoods();
        state.foods = res.data || [];
        state.filteredFoods = state.foods.slice();

        this.extractFiltersMeta(state.foods);
        UI.populateFilterOptions();
        UI.renderFoodsList(state.filteredFoods);

      } catch (err) {
        UI.dom.foodsGrid.innerHTML = `
          <div style="grid-column: 1 / -1; text-align: center; padding: 48px 20px; background: var(--bg-surface); border-radius: var(--radius-lg); border: 1px dashed var(--border-subtle);">
            <h3 style="font-size: 1.3rem; margin-bottom: 8px;">Không thể tải dữ liệu từ Google Sheets</h3>
            <p style="color: var(--text-muted); margin-bottom: 16px;">${Security.escapeHTML(err.message)}</p>
            <button class="btn-main" onclick="location.reload()" style="margin: 0 auto;">Thử lại</button>
          </div>
        `;
      } finally {
        state.isLoading = false;
      }
    },

    setupSmartMealTime() {
      const hour = new Date().getHours();
      let label = "Bữa chính";
      if (hour >= 5 && hour < 10) label = "Bữa sáng";
      else if (hour >= 10 && hour < 14) label = "Bữa trưa";
      else if (hour >= 14 && hour < 17) label = "Ăn vặt / Xế chiều";
      else if (hour >= 17 && hour < 22) label = "Bữa tối";
      else label = "Ăn đêm";

      UI.dom.smartTimeText.textContent = `Đang là giờ: ${label} (Bấm để áp dụng)`;
      UI.dom.smartTimePill.setAttribute("data-purpose", label);
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

    bindEvents() {
      // 1. Roll ngẫu nhiên với hiệu ứng 3D khui lồng bàn
      const handleSpinWith3D = () => {
        if (state.isRolling || state.foods.length === 0) return;
        state.isRolling = true;

        UI.dom.btnHeroSpin.disabled = true;
        UI.dom.btnHeroSpin.querySelector("span").textContent = "Đang khui món...";

        ThreeScene.triggerReveal(() => {
          const picked = FoodEngine.spinRandom();
          UI.dom.btnHeroSpin.disabled = false;
          UI.dom.btnHeroSpin.querySelector("span").textContent = "Chọn món cho tôi";
          state.isRolling = false;

          if (picked) {
            UI.displayRandomResult(picked);
            showToast(`Gợi ý chuẩn vị: ${picked.name}!`, "success");
          } else {
            showToast("Không tìm thấy món phù hợp với bộ lọc hiện tại!", "error");
          }
        });
      };

      UI.dom.btnHeroSpin.addEventListener("click", handleSpinWith3D);
      UI.dom.btnSpinAgain.addEventListener("click", handleSpinWith3D);

      // Phím tắt Spacebar để roll nhanh
      window.addEventListener("keydown", (e) => {
        if (e.code === "Space" && e.target === document.body && !UI.dom.modal.classList.contains("active")) {
          e.preventDefault();
          handleSpinWith3D();
        }
      });

      // 2. Click smart meal time pill
      UI.dom.smartTimePill.addEventListener("click", () => {
        const targetPurp = UI.dom.smartTimePill.getAttribute("data-purpose");
        // Kiểm tra xem mục đích có trong options không
        const options = Array.from(UI.dom.filterPurpose.options).map(o => o.value);
        const match = options.find(opt => opt.toLowerCase().includes(targetPurp.toLowerCase()));
        if (match) {
          UI.dom.filterPurpose.value = match;
          state.activeFilters.purpose = match;
          this.applyFrontendFilters();
          showToast(`Đã áp dụng bộ lọc: ${match}`, "info");
        } else {
          showToast(`Hiện thực đơn chưa có tag: ${targetPurp}`, "info");
        }
      });

      // 3. Filter change events
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
        showToast("Đã khôi phục tất cả bộ lọc", "info");
      });

      // Search box debounce
      let debounceTimer = null;
      UI.dom.searchBox.addEventListener("input", (e) => {
        clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
          state.activeFilters.keyword = e.target.value;
          this.applyFrontendFilters();
        }, 220);
      });

      UI.dom.btnExploreScroll.addEventListener("click", () => {
        document.getElementById("explore-view").scrollIntoView({ behavior: "smooth" });
      });

      // Favorite từ card kết quả
      UI.dom.btnToggleFavRes.addEventListener("click", () => {
        if (!state.currentFood) return;
        this.toggleFavorite(state.currentFood);
        const isFav = state.favorites.some(f => f.id === state.currentFood.id);
        UI.updateFavIconState(UI.dom.btnToggleFavRes, isFav);
      });

      // Chia sẻ
      UI.dom.btnShareRes.addEventListener("click", async () => {
        if (!state.currentFood) return;
        const f = state.currentFood;
        const shareData = {
          title: `Hôm nay ăn gì: ${f.name}!`,
          text: `Hôm nay mình sẽ ăn món "${f.name}". Có tới ${f.venues ? f.venues.length : 0} quán gợi ý ngon lành!`,
          url: window.location.href
        };

        if (navigator.share) {
          try { await navigator.share(shareData); } catch (_) {}
        } else {
          try {
            await navigator.clipboard.writeText(`${shareData.title} - ${shareData.text}`);
            showToast("Đã sao chép nội dung gợi ý vào Clipboard!", "success");
          } catch (e) {
            showToast("Trình duyệt không hỗ trợ chia sẻ tự động.", "error");
          }
        }
      });

      // Click event ủy quyền trên danh sách món
      UI.dom.foodsGrid.addEventListener("click", (e) => {
        const favBtn = e.target.closest(".btn-card-fav");
        if (favBtn) {
          e.stopPropagation();
          const id = favBtn.getAttribute("data-id");
          const food = state.foods.find(item => item.id === id);
          if (food) {
            this.toggleFavorite(food);
            const isFav = state.favorites.some(f => f.id === food.id);
            favBtn.style.color = isFav ? "var(--primary)" : "var(--text-subtle)";
            favBtn.querySelector("svg").setAttribute("fill", isFav ? "currentColor" : "none");
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
        if (e.key === "Escape" && UI.dom.modal.classList.contains("active")) {
          UI.closeModal();
        }
      });

      // Thao tác trong Modal
      UI.dom.modalBody.addEventListener("click", (e) => {
        const removeFavBtn = e.target.closest(".btn-remove-fav");
        if (removeFavBtn) {
          const id = removeFavBtn.getAttribute("data-id");
          const food = state.foods.find(f => f.id === id);
          if (food) {
            this.toggleFavorite(food);
            UI.openFavoritesModal();
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
          showToast("Đã dọn sạch lịch sử", "info");
        }
      });

      // Mobile Bottom Nav
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
      document.querySelectorAll(".nav-tab").forEach(btn => btn.classList.remove("active"));
      activeBtn.classList.add("active");
    },

    toggleFavorite(food) {
      const index = state.favorites.findIndex(f => f.id === food.id);
      if (index > -1) {
        state.favorites.splice(index, 1);
        showToast(`Đã bỏ lưu món "${food.name}"`, "info");
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
    },

    applyFrontendFilters() {
      const f = state.activeFilters;
      let result = state.foods.slice();

      if (f.keyword) {
        const normKey = Security.normalizeVietnamese(f.keyword);
        result = result.filter(item => {
          const searchContent = Security.normalizeVietnamese(
            (item.name || "") + " " + (item.group || "") + " " + (item.districts ? item.districts.join(" ") : "")
          );
          return searchContent.includes(normKey);
        });
      }

      if (f.purpose && f.purpose !== "all") {
        result = result.filter(item => item.purposes && item.purposes.includes(f.purpose));
      }

      if (f.group && f.group !== "all") {
        result = result.filter(item => item.group === f.group);
      }

      if (f.district && f.district !== "all") {
        result = result.filter(item => item.districts && item.districts.includes(f.district));
      }

      if (f.maxBudget && f.maxBudget !== "all") {
        const budgetLimit = parseInt(f.maxBudget, 10);
        result = result.filter(item => {
          if (item.minPrice === null) return true;
          return item.minPrice <= budgetLimit;
        });
      }

      state.filteredFoods = result;
      UI.renderFoodsList(state.filteredFoods);
    }
  };

  // Tự động khởi động khi trang sẵn sàng
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => App.init());
  } else {
    App.init();
  }

})();
