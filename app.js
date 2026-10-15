/**
 * Hanoi Food Engine — Royal 3D Cloche & Modern Mobile Frontend
 * File: app.js
 */

// =========================================================================
// 1. CẤU HÌNH API BACKEND GOOGLE APPS SCRIPT
// =========================================================================
const APPS_SCRIPT_API_URL = 'https://script.google.com/macros/s/AKfycbyGWACPXXRgMousiB2-h2cxCY2K92TjVHWpSOabahOu6YLwIZf-GCIVdiKRSlnsMzNcmg/exec';

// =========================================================================
// 2. AUDIO SYNTHESIZER (Tạo âm thanh cơ khí & ẩm thực bằng Web Audio API)
// =========================================================================
let audioCtx = null;
let soundEnabled = true;

function initAudio() {
  if (!audioCtx) {
    const AudioContext = window.AudioContext || window.webkitAudioContext;
    if (AudioContext) audioCtx = new AudioContext();
  }
  if (audioCtx && audioCtx.state === 'suspended') {
    audioCtx.resume();
  }
}

function playClocheRattleSound(progress = 0) {
  if (!soundEnabled || !audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(400 + progress * 600, audioCtx.currentTime);

    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.04);
  } catch (e) {}
}

function playWinChime() {
  if (!soundEnabled || !audioCtx) return;
  try {
    const notes = [523.25, 659.25, 783.99, 1046.50, 1318.51]; // C5, E5, G5, C6, E6
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime + idx * 0.08);

      gain.gain.setValueAtTime(0.25, audioCtx.currentTime + idx * 0.08);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + idx * 0.08 + 0.6);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(audioCtx.currentTime + idx * 0.08);
      osc.stop(audioCtx.currentTime + idx * 0.08 + 0.65);
    });
  } catch (e) {}
}

// =========================================================================
// 3. STATE ỨNG DỤNG
// =========================================================================
let masterFoods = [];
let filteredFoods = [];
let isSpinning = false;
let winningFood = null;
let activeQuickFilter = { type: 'all', val: '' };
let favorites = [];

// Three.js 3D Objects
let scene, camera, renderer, tableGroup, clocheDomeGroup, innerDishMesh, steamParticles;
let isDragging = false;
let previousPointerX = 0;
let tableRotationSpeed = 0.005;

// =========================================================================
// 4. KHỞI CHẠY HỆ THỐNG
// =========================================================================
window.addEventListener('DOMContentLoaded', () => {
  loadFavorites();
  setupUIEvents();
  setupMotionSensors();
  loadData();
});

function setupUIEvents() {
  // Âm thanh
  const soundBtn = document.getElementById('btnSoundToggle');
  soundBtn.addEventListener('click', () => {
    initAudio();
    soundEnabled = !soundEnabled;
    document.getElementById('soundIcon').textContent = soundEnabled ? '🔊' : '🔇';
  });

  // Khởi động Audio khi chạm bất kỳ
  window.addEventListener('touchstart', initAudio, { once: true });
  window.addEventListener('click', initAudio, { once: true });

  // Quick Chips
  const chipContainer = document.getElementById('quickChips');
  chipContainer.addEventListener('click', (e) => {
    const chip = e.target.closest('.q-chip');
    if (!chip) return;
    chipContainer.querySelectorAll('.q-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeQuickFilter = {
      type: chip.getAttribute('data-type'),
      val: chip.getAttribute('data-val') || ''
    };
    applyFilters();
  });

  // Tìm kiếm & Bộ lọc
  document.getElementById('filterSearch').addEventListener('input', applyFilters);
  document.getElementById('filterDistrict').addEventListener('change', applyFilters);
  document.getElementById('filterCategory').addEventListener('change', applyFilters);
  document.getElementById('filterVeg').addEventListener('change', applyFilters);

  // Slider giá
  const priceSlider = document.getElementById('filterPrice');
  const priceLabel = document.getElementById('priceLabel');
  priceSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 300000) {
      priceLabel.textContent = 'Không giới hạn';
    } else {
      priceLabel.textContent = '≤ ' + val.toLocaleString('vi-VN') + ' đ';
    }
    applyFilters();
  });

  // Đặt lại bộ lọc
  document.getElementById('btnResetFilters').addEventListener('click', () => {
    document.getElementById('filterSearch').value = '';
    document.getElementById('filterDistrict').value = '';
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterVeg').checked = false;
    priceSlider.value = 300000;
    priceLabel.textContent = 'Không giới hạn';
    chipContainer.querySelectorAll('.q-chip').forEach(c => c.classList.remove('active'));
    chipContainer.querySelector('[data-type="all"]').classList.add('active');
    activeQuickFilter = { type: 'all', val: '' };
    applyFilters();
  });

  // Thu gọn / Mở rộng bảng bộ lọc
  const toggleBtn = document.getElementById('btnToggleFilter');
  const filterContent = document.getElementById('filterContent');
  const chevron = document.getElementById('filterChevron');
  toggleBtn.addEventListener('click', () => {
    if (filterContent.style.display === 'none') {
      filterContent.style.display = 'flex';
      chevron.textContent = 'Thu gọn ▲';
    } else {
      filterContent.style.display = 'none';
      chevron.textContent = 'Mở rộng ▼';
    }
  });

  // Nút mở nắp / Bốc món
  document.getElementById('btnSpin').addEventListener('click', launchClocheReveal);
  document.getElementById('btnSpinAgain').addEventListener('click', () => {
    document.getElementById('resultModal').style.display = 'none';
    launchClocheReveal();
  });

  // Nút bói quẻ nhanh
  document.getElementById('btnRandomFortune').addEventListener('click', () => {
    launchClocheReveal();
  });

  // Lắc điện thoại thủ công
  document.getElementById('btnShakeMotion').addEventListener('click', () => {
    launchClocheReveal();
  });

  // Modal actions
  document.getElementById('btnCloseResult').addEventListener('click', () => {
    document.getElementById('resultModal').style.display = 'none';
  });
  document.getElementById('resultModal').addEventListener('click', (e) => {
    if (e.target.id === 'resultModal') {
      document.getElementById('resultModal').style.display = 'none';
    }
  });

  document.getElementById('btnShareInvite').addEventListener('click', shareInvitation);
  document.getElementById('btnToggleFavorite').addEventListener('click', toggleWinningFoodFavorite);

  // Yêu thích Modal
  document.getElementById('btnWishlist').addEventListener('click', openWishlistModal);
  document.getElementById('btnCloseWishlist').addEventListener('click', () => {
    document.getElementById('wishlistModal').style.display = 'none';
  });

  // Lịch sử Modal
  document.getElementById('btnHistory').addEventListener('click', openHistoryModal);
  document.getElementById('btnCloseHistory').addEventListener('click', () => {
    document.getElementById('historyModal').style.display = 'none';
  });
  document.getElementById('btnClearHistory').addEventListener('click', () => {
    localStorage.removeItem('hanoi_food_history');
    renderHistoryList();
  });

  window.addEventListener('resize', handleWindowResize);
}

// =========================================================================
// 5. TẢI DỮ LIỆU
// =========================================================================
async function loadData() {
  const loaderMsg = document.getElementById('loaderStatus');

  if (APPS_SCRIPT_API_URL && APPS_SCRIPT_API_URL.startsWith('http')) {
    try {
      loaderMsg.textContent = 'Đang đồng bộ thực đơn từ Google Sheets...';
      const res = await fetch(APPS_SCRIPT_API_URL, { redirect: 'follow' });
      const json = await res.json();
      if (json && json.success) {
        onDataReady(json.data);
        return;
      }
    } catch (err) {
      console.warn('Apps Script URL chưa cấu hình hoặc bị chặn CORS, sử dụng danh mục chuẩn hóa 25+ món:', err);
    }
  }

  onDataReady(getFallBackHanoiDataset());
}

function onDataReady(payload) {
  masterFoods = payload.foods || [];

  // Điền Quận / Huyện
  const distSelect = document.getElementById('filterDistrict');
  distSelect.innerHTML = '<option value="">Toàn bộ 36 phố phường & Thủ đô</option>';
  if (payload.districts) {
    payload.districts.forEach(dst => {
      const opt = document.createElement('option');
      opt.value = dst;
      opt.textContent = dst;
      distSelect.appendChild(opt);
    });
  }

  // Điền Danh mục
  const catSelect = document.getElementById('filterCategory');
  catSelect.innerHTML = '<option value="">Tất cả danh mục món</option>';
  if (payload.categories) {
    payload.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      catSelect.appendChild(opt);
    });
  }

  applyFilters();
  initRoyalCloche3DEngine();
  document.getElementById('loaderScreen').style.display = 'none';
}

// =========================================================================
// 6. LOGIC LỌC ĐA TIÊU CHÍ (CHÍNH XÁC KHOẢNG GIÁ & TÂM TRẠNG)
// =========================================================================
function applyFilters() {
  if (isSpinning) return;

  const search = document.getElementById('filterSearch').value.toLowerCase().trim();
  const selectedDistrict = document.getElementById('filterDistrict').value.toLowerCase().trim();
  const selectedCat = document.getElementById('filterCategory').value;
  const isVegOnly = document.getElementById('filterVeg').checked;
  const maxPriceFilter = parseInt(document.getElementById('filterPrice').value, 10);

  filteredFoods = masterFoods.filter(item => {
    // 1. Tìm kiếm tên món, từ khóa và mô tả
    if (search) {
      const matchName = item.name.toLowerCase().includes(search);
      const matchTag = item.tags && item.tags.toLowerCase().includes(search);
      const matchDesc = item.description && item.description.toLowerCase().includes(search);
      if (!matchName && !matchTag && !matchDesc) return false;
    }

    // 2. Lọc khu vực
    if (selectedDistrict) {
      const hasDistrict = (item.areas && item.areas.some(area => area.toLowerCase().includes(selectedDistrict))) ||
                          (item.primaryArea && item.primaryArea.toLowerCase().includes(selectedDistrict));
      if (!hasDistrict) return false;
    }

    // 3. Lọc danh mục
    if (selectedCat && item.category !== selectedCat) return false;

    // 4. Lọc chay
    if (isVegOnly && !item.isVegetarian) return false;

    // 5. Lọc mức giá chính xác (kiểm tra minPrice của món với ngân sách người dùng)
    if (maxPriceFilter < 300000) {
      const itemPriceToCompare = item.minPrice || item.price || 0;
      if (itemPriceToCompare > maxPriceFilter) return false;
    }

    // 6. Quick Chips lọc thời gian & tâm trạng
    if (activeQuickFilter.type === 'time') {
      const mt = (item.mealTime || '').toLowerCase();
      if (!mt.includes(activeQuickFilter.val.toLowerCase()) && !mt.includes('cả ngày')) return false;
    } else if (activeQuickFilter.type === 'mood') {
      const md = (item.mood || '').toLowerCase();
      if (!md.includes(activeQuickFilter.val.toLowerCase()) && !md.includes('mọi dịp')) return false;
    } else if (activeQuickFilter.type === 'budget' && activeQuickFilter.val === 'cheap') {
      const p = item.minPrice || item.price || 0;
      if (p > 45000) return false;
    }

    return true;
  });

  // Cập nhật số lượng
  const counterPill = document.getElementById('foodCountPill');
  counterPill.textContent = `${filteredFoods.length} món sẵn sàng`;

  const btnSpin = document.getElementById('btnSpin');
  const btnLabel = document.getElementById('btnSpinLabel');
  if (filteredFoods.length === 0) {
    btnSpin.disabled = true;
    btnLabel.textContent = 'KHÔNG CÓ MÓN PHÙ HỢP';
  } else {
    btnSpin.disabled = false;
    btnLabel.textContent = 'MỞ NẮP CHỌN MÓN NGAY';
  }
}

// =========================================================================
// 7. KHỞI TẠO BÀN TIỆC 3D HOÀNG KIM & NẮP ĐẬY CLOCHE BÍ ẨN (THREE.JS)
// =========================================================================
function initRoyalCloche3DEngine() {
  const container = document.getElementById('arenaContainer');
  const canvas = document.getElementById('cloche3dCanvas');
  const width = container.clientWidth;
  const height = container.clientHeight;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
  camera.position.set(0, 3.8, 6.2);
  camera.lookAt(0, 0.5, 0);

  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.2;

  // Ánh sáng Studio hoàng gia
  const ambientLight = new THREE.AmbientLight(0xfff7ed, 1.2);
  scene.add(ambientLight);

  const mainLight = new THREE.DirectionalLight(0xffeedd, 2.0);
  mainLight.position.set(5, 8, 6);
  scene.add(mainLight);

  const rimLight = new THREE.PointLight(0xff6b2b, 2.5, 12);
  rimLight.position.set(-4, 3, -3);
  scene.add(rimLight);

  const goldSpot = new THREE.SpotLight(0xf59e0b, 3.0, 15, Math.PI / 4, 0.4);
  goldSpot.position.set(0, 7, 0);
  goldSpot.target.position.set(0, 0, 0);
  scene.add(goldSpot);
  scene.add(goldSpot.target);

  // Group toàn bộ bàn tiệc
  tableGroup = new THREE.Group();
  scene.add(tableGroup);

  // 1. Đế khay mạ vàng Champagne sang trọng
  const trayGeom = new THREE.CylinderGeometry(2.4, 2.55, 0.14, 64);
  const trayMat = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    metalness: 0.92,
    roughness: 0.18
  });
  const trayMesh = new THREE.Mesh(trayGeom, trayMat);
  trayMesh.position.y = 0.07;
  tableGroup.add(trayMesh);

  // Vành khay nổi bo viền
  const rimGeom = new THREE.TorusGeometry(2.45, 0.08, 16, 64);
  rimGeom.rotateX(Math.PI / 2);
  const rimMesh = new THREE.Mesh(rimGeom, trayMat);
  rimMesh.position.y = 0.15;
  tableGroup.add(rimMesh);

  // Đĩa sứ trắng ngọc bên trong
  const plateGeom = new THREE.CylinderGeometry(2.0, 1.8, 0.08, 64);
  const plateMat = new THREE.MeshStandardMaterial({
    color: 0x1a2236,
    metalness: 0.2,
    roughness: 0.3
  });
  const plateMesh = new THREE.Mesh(plateGeom, plateMat);
  plateMesh.position.y = 0.16;
  tableGroup.add(plateMesh);

  // 2. Món ăn phát quang tượng trưng bên trong đĩa
  const foodCoreGeom = new THREE.CylinderGeometry(1.2, 1.4, 0.25, 32);
  const foodCoreMat = new THREE.MeshStandardMaterial({
    color: 0xff4d29,
    emissive: 0xff3300,
    emissiveIntensity: 0.4,
    roughness: 0.4
  });
  innerDishMesh = new THREE.Mesh(foodCoreGeom, foodCoreMat);
  innerDishMesh.position.y = 0.32;
  tableGroup.add(innerDishMesh);

  // 3. Nắp Đậy Bí Ẩn Hoàng Gia (Cloche Dome Group)
  clocheDomeGroup = new THREE.Group();
  clocheDomeGroup.position.y = 0.18;
  tableGroup.add(clocheDomeGroup);

  // Thân vòm nắp Cloche (Kim loại sáng bóng)
  const clocheGeom = new THREE.SphereGeometry(2.05, 48, 32, 0, Math.PI * 2, 0, Math.PI / 2);
  const clocheMat = new THREE.MeshStandardMaterial({
    color: 0xffdf73,
    metalness: 0.95,
    roughness: 0.12,
    side: THREE.DoubleSide
  });
  const domeMesh = new THREE.Mesh(clocheGeom, clocheMat);
  clocheDomeGroup.add(domeMesh);

  // Viền gờ chân nắp
  const clocheLipGeom = new THREE.TorusGeometry(2.05, 0.07, 16, 64);
  clocheLipGeom.rotateX(Math.PI / 2);
  const lipMesh = new THREE.Mesh(clocheLipGeom, clocheMat);
  clocheDomeGroup.add(lipMesh);

  // Tay nắm mạ vàng đỉnh nắp
  const handleStemGeom = new THREE.CylinderGeometry(0.12, 0.16, 0.3, 16);
  const handleStem = new THREE.Mesh(handleStemGeom, clocheMat);
  handleStem.position.y = 2.15;
  clocheDomeGroup.add(handleStem);

  const handleRingGeom = new THREE.TorusGeometry(0.24, 0.07, 16, 32);
  handleRingGeom.rotateY(Math.PI / 2);
  const handleRing = new THREE.Mesh(handleRingGeom, clocheMat);
  handleRing.position.y = 2.4;
  clocheDomeGroup.add(handleRing);

  // 4. Hạt khói / Hào quang thơm bốc lên (Steam Particle System)
  const particleCount = 45;
  const steamGeom = new THREE.BufferGeometry();
  const steamPositions = new Float32Array(particleCount * 3);
  for (let i = 0; i < particleCount * 3; i += 3) {
    steamPositions[i] = (Math.random() - 0.5) * 1.8;
    steamPositions[i + 1] = Math.random() * 2.5 + 0.5;
    steamPositions[i + 2] = (Math.random() - 0.5) * 1.8;
  }
  steamGeom.setAttribute('position', new THREE.BufferAttribute(steamPositions, 3));

  const steamMat = new THREE.PointsMaterial({
    color: 0xffaa44,
    size: 0.12,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending
  });
  steamParticles = new THREE.Points(steamGeom, steamMat);
  tableGroup.add(steamParticles);

  // Thiết lập sự kiện chạm / vuốt 3D mượt mà
  setupPointerControls(canvas);

  // Render loop
  function animate() {
    requestAnimationFrame(animate);

    if (!isSpinning && !isDragging) {
      tableGroup.rotation.y += tableRotationSpeed;
    }

    // Chuyển động nhẹ của hạt khói ẩm thực
    if (steamParticles) {
      const positions = steamParticles.geometry.attributes.position.array;
      for (let i = 1; i < positions.length; i += 3) {
        positions[i] += 0.012;
        if (positions[i] > 3.2) {
          positions[i] = 0.5;
        }
      }
      steamParticles.geometry.attributes.position.needsUpdate = true;
    }

    renderer.render(scene, camera);
  }
  animate();
}

// Hỗ trợ vuốt xoay 3D trên cả điện thoại (Touch) và máy tính (Mouse)
function setupPointerControls(canvas) {
  const onPointerDown = (e) => {
    isDragging = true;
    previousPointerX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
  };

  const onPointerMove = (e) => {
    if (!isDragging) return;
    const clientX = e.clientX || (e.touches && e.touches[0].clientX) || 0;
    const deltaX = clientX - previousPointerX;
    tableGroup.rotation.y += deltaX * 0.008;
    previousPointerX = clientX;
  };

  const onPointerUp = () => {
    isDragging = false;
  };

  canvas.addEventListener('mousedown', onPointerDown);
  window.addEventListener('mousemove', onPointerMove);
  window.addEventListener('mouseup', onPointerUp);

  canvas.addEventListener('touchstart', onPointerDown, { passive: true });
  window.addEventListener('touchmove', onPointerMove, { passive: true });
  window.addEventListener('touchend', onPointerUp);
}

// =========================================================================
// 8. CƠ CHẾ MỞ NẮP 3D HOÀNG KIM (THE CLOCHE REVEAL DYNAMICS)
// =========================================================================
function launchClocheReveal() {
  if (isSpinning || !filteredFoods || filteredFoods.length === 0) return;

  initAudio();
  isSpinning = true;

  const btnSpin = document.getElementById('btnSpin');
  const btnLabel = document.getElementById('btnSpinLabel');
  btnSpin.disabled = true;
  btnLabel.textContent = 'ĐANG MỞ NẮP BÍ ẨN...';

  const tickerSub = document.getElementById('tickerSub');
  const tickerTitle = document.getElementById('tickerTitle');
  tickerSub.textContent = '✨ MÓN NGON ĐANG ĐƯỢC CHỌN';

  // Chọn ngẫu nhiên món chiến thắng
  const winIdx = Math.floor(Math.random() * filteredFoods.length);
  winningFood = filteredFoods[winIdx];

  const duration = 3800; // 3.8s
  const startTime = performance.now();
  let lastShuffleTime = 0;

  function frameUpdate(now) {
    const elapsed = now - startTime;
    const p = Math.min(elapsed / duration, 1);

    // 1. Nhảy tên món liên tục trên Ticker tạo kịch tính
    if (now - lastShuffleTime > 75 && p < 0.85) {
      lastShuffleTime = now;
      const tempFood = filteredFoods[Math.floor(Math.random() * filteredFoods.length)];
      tickerTitle.textContent = tempFood.name;
      playClocheRattleSound(p);
    }

    // 2. Chuyển động vật lý nắp Cloche
    if (p < 0.45) {
      // Giai đoạn 1: Rung lắc cơ học nắp đậy báo hiệu món đang sôi sục
      const shakeAmp = 0.07 * (p / 0.45);
      clocheDomeGroup.position.x = (Math.random() - 0.5) * shakeAmp;
      clocheDomeGroup.position.z = (Math.random() - 0.5) * shakeAmp;
      clocheDomeGroup.rotation.z = (Math.random() - 0.5) * shakeAmp;
      tableGroup.rotation.y += 0.035;
    } else {
      // Giai đoạn 2: Nắp Cloche bay vút lên cao hé lộ đĩa thức ăn vàng kim
      const liftProgress = (p - 0.45) / 0.55;
      const easeLift = 1 - Math.pow(1 - liftProgress, 3);

      clocheDomeGroup.position.x = 0;
      clocheDomeGroup.position.z = 0;
      clocheDomeGroup.position.y = 0.18 + easeLift * 3.6;
      clocheDomeGroup.rotation.x = -easeLift * 0.4;
      clocheDomeGroup.rotation.z = easeLift * 0.2;

      tableGroup.rotation.y += 0.02 * (1 - liftProgress);

      // Món ăn bên trong phát quang rực rỡ
      if (innerDishMesh) {
        innerDishMesh.material.emissiveIntensity = 0.4 + easeLift * 1.5;
      }
    }

    if (p < 1) {
      requestAnimationFrame(frameUpdate);
    } else {
      // Hoàn tất
      tickerTitle.textContent = winningFood.name;
      tickerSub.textContent = '🎉 ĐÃ TÌM THẤY MÓN NGON HOÀN HẢO!';

      playWinChime();
      fireConfetti();
      recordHistory(winningFood);

      setTimeout(() => {
        showWinningModal(winningFood);
        isSpinning = false;
        btnSpin.disabled = false;
        btnLabel.textContent = 'MỞ NẮP CHỌN MÓN NGAY';

        // Đậy nắp lại từ từ sau khi xem
        setTimeout(() => {
          resetClocheDome();
        }, 800);
      }, 500);
    }
  }

  requestAnimationFrame(frameUpdate);
}

function resetClocheDome() {
  if (!clocheDomeGroup) return;
  const startY = clocheDomeGroup.position.y;
  const startTime = performance.now();
  const resetDuration = 600;

  function lower(now) {
    const elapsed = now - startTime;
    const progress = Math.min(elapsed / resetDuration, 1);
    const ease = 1 - Math.pow(1 - progress, 2);

    clocheDomeGroup.position.y = startY - (startY - 0.18) * ease;
    clocheDomeGroup.rotation.x *= (1 - ease);
    clocheDomeGroup.rotation.z *= (1 - ease);

    if (innerDishMesh) {
      innerDishMesh.material.emissiveIntensity = 0.4;
    }

    if (progress < 1) {
      requestAnimationFrame(lower);
    } else {
      clocheDomeGroup.position.set(0, 0.18, 0);
      clocheDomeGroup.rotation.set(0, 0, 0);
    }
  }
  requestAnimationFrame(lower);
}

// =========================================================================
// 9. MODAL KẾT QUẢ, QUẺ BÓI & ĐẶT MÓN
// =========================================================================
function showWinningModal(food) {
  if (!food) return;

  document.getElementById('resCategory').textContent = food.category || 'Món ngon phố cổ';
  document.getElementById('resTitle').textContent = food.name;
  document.getElementById('resPrice').textContent = food.priceDisplay || 'Giá bình dân';
  document.getElementById('resDesc').textContent = food.description || 'Món ngon chuẩn vị truyền thống Hà Nội.';
  document.getElementById('resAreaTag').textContent = '📍 ' + (food.primaryArea || 'Hà Nội');
  document.getElementById('resTimeTag').textContent = '⏰ ' + (food.mealTime || 'Mọi thời điểm');
  document.getElementById('resVegTag').textContent = food.isVegetarian ? '🥗 Món chay thanh tịnh' : '🥩 Món mặn đậm đà';

  // Quẻ bói ẩm thực theo món
  const fortuneQuotes = [
    `✨ Hôm nay số hưởng, húp một ngụm nước dùng đậm đà của ${food.name} là cả ngày công việc hanh thông, gặp nhiều vận đỏ!`,
    `🍜 Nạp ngay năng lượng với ${food.name}. Hương vị phố cổ sẽ giúp bạn đánh tan áp lực, tâm trạng vui tươi cả ngày!`,
    `🥢 Điềm lành ẩm thực: Hôm nay đừng do dự, món ${food.name} chính là chân ái được định sẵn cho chiếc bụng đói của bạn!`,
    `✨ Tinh hoa hội tụ! Bữa ăn này sẽ đem lại nhiều cảm hứng sáng tạo và cuộc trò chuyện rôm rả bên bạn bè.`
  ];
  document.getElementById('resFortune').innerHTML = fortuneQuotes[Math.floor(Math.random() * fortuneQuotes.length)];

  // Cập nhật trạng thái nút Thích
  updateFavoriteButtonState(food);

  // Render quán ăn
  const container = document.getElementById('resRestaurantsContainer');
  container.innerHTML = '';

  if (food.restaurants && food.restaurants.length > 0) {
    food.restaurants.forEach(rest => {
      const card = document.createElement('div');
      card.className = 'restaurant-card';
      card.innerHTML = `
        <div class="rest-head">
          <span class="rest-title">${escapeSafe(rest.name)}</span>
          <span class="rest-price-pill">${escapeSafe(rest.priceRange)}</span>
        </div>
        <div class="rest-addr">📍 ${escapeSafe(rest.address)} (${escapeSafe(rest.district)})</div>
        <div class="rest-links">
          <a href="${escapeSafe(rest.mapsUrl)}" target="_blank" rel="noopener noreferrer" class="btn-link-action btn-link-maps">
            <span>🗺️ Chỉ đường</span>
          </a>
          <a href="https://shopeefood.vn/ha-noi/danh-sach-quan-mon-${encodeURIComponent(food.name)}" target="_blank" rel="noopener noreferrer" class="btn-link-action btn-link-food">
            <span>🛵 Đặt giao tận nơi</span>
          </a>
        </div>
      `;
      container.appendChild(card);
    });
  } else {
    container.innerHTML = `
      <div style="padding:14px; background:rgba(255,255,255,0.03); border-radius:12px; font-size:0.85rem; color:var(--text-muted);">
        Chưa có quán chỉ định sẵn trong cơ sở dữ liệu. Tìm kiếm quán chuẩn vị gần nhất:
        <div style="margin-top:8px;">
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(food.name + ' ngon Hà Nội')}" target="_blank" rel="noopener noreferrer" class="btn-link-action btn-link-maps">
            <span>🔍 Mở Google Maps tìm "${escapeSafe(food.name)}"</span>
          </a>
        </div>
      </div>
    `;
  }

  document.getElementById('resultModal').style.display = 'flex';
}

function shareInvitation() {
  if (!winningFood) return;
  const text = `🍜 Ê đi ăn không? Cỗ máy Vị Hà Nội 3D vừa chọn ra món cực phẩm: *${winningFood.name}*!\n💰 Giá khoảng: ${winningFood.priceDisplay}\n📍 Khu vực: ${winningFood.primaryArea}\nLên đồ ghé quán ngay nhé!`;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      alert('Đã sao chép lời mời vào bộ nhớ tạm! Bạn có thể dán vào Zalo/Messenger rủ bạn bè ngay 🎉');
    }).catch(() => {
      prompt('Sao chép lời mời dưới đây:', text);
    });
  } else {
    prompt('Sao chép lời mời dưới đây:', text);
  }
}

// =========================================================================
// 10. DANH SÁCH YÊU THÍCH (WISHLIST) & CẢM BIẾN LẮC ĐIỆN THOẠI
// =========================================================================
function loadFavorites() {
  try {
    favorites = JSON.parse(localStorage.getItem('hanoi_food_favorites') || '[]');
    updateFavoriteCountUI();
  } catch (e) {
    favorites = [];
  }
}

function updateFavoriteCountUI() {
  const badge = document.getElementById('favCount');
  if (badge) badge.textContent = favorites.length;
}

function toggleWinningFoodFavorite() {
  if (!winningFood) return;
  const existsIdx = favorites.findIndex(f => f.name === winningFood.name);

  if (existsIdx >= 0) {
    favorites.splice(existsIdx, 1);
  } else {
    favorites.unshift({
      name: winningFood.name,
      category: winningFood.category,
      price: winningFood.priceDisplay,
      primaryArea: winningFood.primaryArea
    });
  }

  localStorage.setItem('hanoi_food_favorites', JSON.stringify(favorites));
  updateFavoriteCountUI();
  updateFavoriteButtonState(winningFood);
}

function updateFavoriteButtonState(food) {
  const isFav = favorites.some(f => f.name === food.name);
  const icon = document.getElementById('favIcon');
  if (icon) {
    icon.textContent = isFav ? '❤️' : '🤍';
  }
}

function openWishlistModal() {
  const container = document.getElementById('wishlistContainer');
  if (favorites.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:30px;">Bạn chưa lưu món yêu thích nào. Hãy bấm "Thích" sau khi mở nắp nhé!</p>';
  } else {
    container.innerHTML = favorites.map((item, idx) => `
      <div style="display:flex; justify-content:space-between; align-items:center; padding:12px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
        <div>
          <div style="font-weight:700; color:#fff; font-size:0.95rem;">${escapeSafe(item.name)}</div>
          <div style="font-size:0.75rem; color:var(--text-muted);">${escapeSafe(item.category)} • ${escapeSafe(item.price)}</div>
        </div>
        <button onclick="removeFavoriteItem(${idx})" style="background:transparent; border:none; color:var(--accent); font-size:1.1rem; cursor:pointer;">✕</button>
      </div>
    `).join('');
  }
  document.getElementById('wishlistModal').style.display = 'flex';
}

window.removeFavoriteItem = function(idx) {
  favorites.splice(idx, 1);
  localStorage.setItem('hanoi_food_favorites', JSON.stringify(favorites));
  updateFavoriteCountUI();
  openWishlistModal();
};

// Cảm biến rung lắc điện thoại (Shake to Reveal)
function setupMotionSensors() {
  if (window.DeviceMotionEvent) {
    let lastX, lastY, lastZ;
    let lastUpdate = 0;
    const SHAKE_THRESHOLD = 800;

    window.addEventListener('devicemotion', (event) => {
      const current = event.accelerationIncludingGravity;
      if (!current) return;

      const curTime = performance.now();
      if ((curTime - lastUpdate) > 100) {
        const diffTime = curTime - lastUpdate;
        lastUpdate = curTime;

        const speed = Math.abs(current.x + current.y + current.z - lastX - lastY - lastZ) / diffTime * 10000;
        if (speed > SHAKE_THRESHOLD) {
          if (!isSpinning) {
            launchClocheReveal();
          }
        }
        lastX = current.x;
        lastY = current.y;
        lastZ = current.z;
      }
    }, false);
  }
}

// =========================================================================
// 11. QUẢN LÝ LỊCH SỬ LOCAL STORAGE
// =========================================================================
function recordHistory(food) {
  try {
    let hist = JSON.parse(localStorage.getItem('hanoi_food_history') || '[]');
    hist.unshift({
      name: food.name,
      category: food.category,
      price: food.priceDisplay,
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    });
    if (hist.length > 25) hist = hist.slice(0, 25);
    localStorage.setItem('hanoi_food_history', JSON.stringify(hist));
  } catch (e) {}
}

function openHistoryModal() {
  renderHistoryList();
  document.getElementById('historyModal').style.display = 'flex';
}

function renderHistoryList() {
  const container = document.getElementById('historyListContainer');
  let hist = [];
  try {
    hist = JSON.parse(localStorage.getItem('hanoi_food_history') || '[]');
  } catch (e) {}

  if (hist.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:30px;">Chưa có lịch sử mở nắp món nào.</p>';
    return;
  }

  container.innerHTML = hist.map(item => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div>
        <div style="font-weight:700; color:#fff; font-size:0.92rem;">${escapeSafe(item.name)}</div>
        <div style="font-size:0.75rem; color:var(--text-muted);">${escapeSafe(item.category)} • ${escapeSafe(item.price)}</div>
      </div>
      <span style="font-size:0.75rem; color:var(--gold); font-weight:600;">${escapeSafe(item.time)}</span>
    </div>
  `).join('');
}

function fireConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 100,
      spread: 75,
      origin: { y: 0.65 }
    });
  }
}

function handleWindowResize() {
  if (!camera || !renderer) return;
  const container = document.getElementById('arenaContainer');
  const width = container.clientWidth;
  const height = container.clientHeight;
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
  renderer.setSize(width, height);
}

function escapeSafe(str) {
  if (!str) return '';
  return str.toString()
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

// =========================================================================
// 12. DỮ LIỆU DỰ PHÒNG CHUẨN XÁC 20+ ĐẶC SẢN NỔI TIẾNG HÀ NỘI
// =========================================================================
function getFallBackHanoiDataset() {
  return {
    categories: ['Bún / Phở', 'Bánh truyền thống', 'Ăn vặt phố cổ', 'Đặc sản Hà Nội', 'Món chay thanh tịnh'],
    districts: ['Ba Đình', 'Cầu Giấy', 'Đống Đa', 'Hai Bà Trưng', 'Hoàn Kiếm', 'Tây Hồ', 'Thanh Xuân', 'Long Biên'],
    foods: [
      {
        id: '1',
        name: 'Phở Bò Tái Lăn',
        category: 'Bún / Phở',
        areas: ['Hai Bà Trưng', 'Hoàn Kiếm', 'Đống Đa'],
        primaryArea: 'Hai Bà Trưng, Hoàn Kiếm, Đống Đa',
        minPrice: 65000,
        maxPrice: 90000,
        price: 75000,
        priceDisplay: '65.000 đ – 90.000 đ',
        mealTime: 'Sáng, Trưa, Tối',
        mood: 'Mọi dịp, Đi 1 mình',
        isVegetarian: false,
        tags: 'pho, bo, tai lan',
        description: 'Bò xào lửa lớn thơm lừng mùi tỏi đập dập, nước dùng đậm đà béo ngậy đặc trưng phố Lò Đúc.',
        restaurants: [{ name: 'Phở Thìn Lò Đúc', address: '13 Lò Đúc', district: 'Hai Bà Trưng', priceRange: '65k - 90k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '2',
        name: 'Bún Chả Nướng Than Hoa',
        category: 'Bún / Phở',
        areas: ['Hoàn Kiếm', 'Ba Đình'],
        primaryArea: 'Hoàn Kiếm, Ba Đình',
        minPrice: 50000,
        maxPrice: 80000,
        price: 65000,
        priceDisplay: '50.000 đ – 80.000 đ',
        mealTime: 'Trưa',
        mood: 'Hẹn hò, Bạn bè',
        isVegetarian: false,
        tags: 'bun cha, thit nuong',
        description: 'Chả miếng chả băm nướng xém cạnh trên than hoa đượm hồng, chấm nước mắm giấm tỏi đu đủ chua ngọt.',
        restaurants: [{ name: 'Bún Chả Đắc Kim', address: '1 Hàng Mành', district: 'Hoàn Kiếm', priceRange: '60k - 90k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '3',
        name: 'Chả Cá Lã Vọng',
        category: 'Đặc sản Hà Nội',
        areas: ['Hoàn Kiếm', 'Tây Hồ'],
        primaryArea: 'Hoàn Kiếm, Tây Hồ',
        minPrice: 150000,
        maxPrice: 220000,
        price: 185000,
        priceDisplay: '150.000 đ – 220.000 đ',
        mealTime: 'Trưa, Tối',
        mood: 'Hẹn hò, Tiếp khách, Tụ tập',
        isVegetarian: false,
        tags: 'cha ca, la vong, ca lang',
        description: 'Cá lăng chiên vàng ươm cùng thì là, hành hoa ngập chảo mỡ sôi xèo xèo, ăn kèm bún, đậu phộng và mắm tôm.',
        restaurants: [{ name: 'Chả Cá Thăng Long', address: '19 Đường Thành', district: 'Hoàn Kiếm', priceRange: '150k - 200k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '4',
        name: 'Bún Đậu Mẹt Mắm Tôm',
        category: 'Bún / Phở',
        areas: ['Đống Đa', 'Hoàn Kiếm', 'Cầu Giấy'],
        primaryArea: 'Đống Đa, Hoàn Kiếm, Cầu Giấy',
        minPrice: 35000,
        maxPrice: 65000,
        price: 50000,
        priceDisplay: '35.000 đ – 65.000 đ',
        mealTime: 'Trưa, Tối',
        mood: 'Tụ tập, Bạn bè',
        isVegetarian: false,
        tags: 'bun dau, mam tom, cha com',
        description: 'Đậu Mơ lướt ván giòn vỏ ngậy béo, chả cốm dẻo thơm, mắm tôm Thanh Hóa đánh sủi bọt quất ớt cay xè.',
        restaurants: [{ name: 'Bún Đậu Trung Hương', address: '49 Ngõ Phất Lộc', district: 'Hoàn Kiếm', priceRange: '45k - 70k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '5',
        name: 'Bún Thang Phố Cổ',
        category: 'Bún / Phở',
        areas: ['Hoàn Kiếm', 'Ba Đình'],
        primaryArea: 'Hoàn Kiếm, Ba Đình',
        minPrice: 50000,
        maxPrice: 70000,
        price: 60000,
        priceDisplay: '50.000 đ – 70.000 đ',
        mealTime: 'Sáng, Trưa',
        mood: 'Nhẹ nhàng, Mọi dịp',
        isVegetarian: false,
        tags: 'bun thang, pho co, thanh lich',
        description: 'Được mệnh danh là "bông hoa ngũ sắc", gồm giò lụa, trứng tráng mỏng, thịt gà xé và củ cải dầm trên nền nước dùng tôm ngọt trong vắt.',
        restaurants: [{ name: 'Bún Thang Bà Đức', address: '48 Cầu Gỗ', district: 'Hoàn Kiếm', priceRange: '50k - 70k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '6',
        name: 'Bún Ốc Nguội Giấm Bỗng',
        category: 'Bún / Phở',
        areas: ['Hoàn Kiếm', 'Hai Bà Trưng'],
        primaryArea: 'Hoàn Kiếm, Hai Bà Trưng',
        minPrice: 40000,
        maxPrice: 60000,
        price: 50000,
        priceDisplay: '40.000 đ – 60.000 đ',
        mealTime: 'Trưa, Chiều',
        mood: 'Ăn vặt, Nhẹ nhàng',
        isVegetarian: false,
        tags: 'bun oc, giam bong',
        description: 'Ốc nhồi giòn sần sật trong nước dùng chua thanh dìu dịu của giấm bỗng nếp, chấm bún lá con nhỏ xinh.',
        restaurants: [{ name: 'Bún Ốc Nguội Ô Quan Chưởng', address: '1 Hàng Chiếu', district: 'Hoàn Kiếm', priceRange: '40k - 60k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '7',
        name: 'Ngan Cháy Tỏi Phố Hàng Thiếc',
        category: 'Đặc sản Hà Nội',
        areas: ['Hoàn Kiếm', 'Đống Đa'],
        primaryArea: 'Hoàn Kiếm, Đống Đa',
        minPrice: 120000,
        maxPrice: 200000,
        price: 160000,
        priceDisplay: '120.000 đ – 200.000 đ',
        mealTime: 'Trưa, Tối, Đêm',
        mood: 'Tụ tập, Nhậu, Bạn bè',
        isVegetarian: false,
        tags: 'ngan chay toi, nhau, dac san',
        description: 'Thịt ngan mềm ngọt tẩm ướp đậm đà xào xém cùng những tép tỏi ta phi vàng giòn ruộm thơm nức mũi.',
        restaurants: [{ name: 'Ngan Cháy Tỏi Thủy Béo', address: '51 Hàng Lược', district: 'Hoàn Kiếm', priceRange: '120k - 200k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '8',
        name: 'Phở Cuốn Ngũ Xã',
        category: 'Đặc sản Hà Nội',
        areas: ['Ba Đình', 'Tây Hồ'],
        primaryArea: 'Ba Đình, Tây Hồ',
        minPrice: 60000,
        maxPrice: 90000,
        price: 75000,
        priceDisplay: '60.000 đ – 90.000 đ',
        mealTime: 'Trưa, Tối',
        mood: 'Hẹn hò, Tụ tập',
        isVegetarian: false,
        tags: 'pho cuon, ngu xa',
        description: 'Lá phở bản vuông trắng muốt cuộn chặt thịt bò xào lửa lớn cùng rau thơm non mượt chấm mắm ớt cay cay.',
        restaurants: [{ name: 'Phở Cuốn Hưng Bền', address: '33 Ngũ Xã', district: 'Ba Đình', priceRange: '60k - 100k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '9',
        name: 'Lẩu Riêu Cua Bắp Bò Sườn Sụn',
        category: 'Đặc sản Hà Nội',
        areas: ['Đống Đa', 'Hai Bà Trưng', 'Cầu Giấy'],
        primaryArea: 'Đống Đa, Hai Bà Trưng, Cầu Giấy',
        minPrice: 250000,
        maxPrice: 400000,
        price: 320000,
        priceDisplay: '250.000 đ – 400.000 đ',
        mealTime: 'Tối, Đêm',
        mood: 'Tụ tập, Nhậu, Gia đình',
        isVegetarian: false,
        tags: 'lau rieu, bap bo, suon sun',
        description: 'Nồi lẩu đầy ắp gạch cua đồng đỏ au, vị chua thanh từ giấm bỗng nếp nhúng cùng bắp bò giòn sần sật và rau sống thái sợi.',
        restaurants: [{ name: 'Lẩu Riêu Cua Phó Đức Chính', address: '66 Phó Đức Chính', district: 'Ba Đình', priceRange: '250k - 450k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '10',
        name: 'Bánh Cuốn Nóng Cà Cuống',
        category: 'Bánh truyền thống',
        areas: ['Hoàn Kiếm', 'Hai Bà Trưng'],
        primaryArea: 'Hoàn Kiếm, Hai Bà Trưng',
        minPrice: 35000,
        maxPrice: 60000,
        price: 45000,
        priceDisplay: '35.000 đ – 60.000 đ',
        mealTime: 'Sáng, Đêm',
        mood: 'Đi 1 mình, Nhẹ nhàng',
        isVegetarian: false,
        tags: 'banh cuon, ca cuong',
        description: 'Bánh tráng mỏng tang thấy rõ nhân thịt băm mộc nhĩ giòn rụm, điểm xuyết giọt tinh dầu cà cuống thơm quý hiếm.',
        restaurants: [{ name: 'Bánh Cuốn Bà Hoành', address: '66 Tô Hiến Thành', district: 'Hai Bà Trưng', priceRange: '40k - 65k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '11',
        name: 'Bánh Mì Sốt Vang Đình Ngang',
        category: 'Đặc sản Hà Nội',
        areas: ['Hoàn Kiếm', 'Đống Đa'],
        primaryArea: 'Hoàn Kiếm, Đống Đa',
        minPrice: 45000,
        maxPrice: 65000,
        price: 55000,
        priceDisplay: '45.000 đ – 65.000 đ',
        mealTime: 'Sáng, Tối, Đêm',
        mood: 'Đi 1 mình, Bạn bè',
        isVegetarian: false,
        tags: 'banh mi, sot vang',
        description: 'Bò hầm gân mềm sánh quyện hương rượu vang, quế hồi ngào ngạt, chấm bánh mì nóng giòn rụm.',
        restaurants: [{ name: 'Bánh Mì Sốt Vang Trâm', address: '30 Đình Ngang', district: 'Hoàn Kiếm', priceRange: '50k - 70k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '12',
        name: 'Nộm Bò Khô Bờ Hồ',
        category: 'Ăn vặt phố cổ',
        areas: ['Hoàn Kiếm'],
        primaryArea: 'Hoàn Kiếm',
        minPrice: 35000,
        maxPrice: 50000,
        price: 40000,
        priceDisplay: '35.000 đ – 50.000 đ',
        mealTime: 'Chiều, Tối, Đêm',
        mood: 'Hẹn hò, Ăn vặt',
        isVegetarian: false,
        tags: 'nom, bo kho, bo ho',
        description: 'Đu đủ nạo giòn mát quyện với bò khô xé cay, lá kinh giới và nước giấm đường ớt tỏi chua cay mặn ngọt đậm đà.',
        restaurants: [{ name: 'Nộm Long Vi Dung', address: '23 Hồ Hoàn Kiếm', district: 'Hoàn Kiếm', priceRange: '35k - 50k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '13',
        name: 'Xôi Xéo Mỡ Hành Ruốc Hành Phi',
        category: 'Bánh truyền thống',
        areas: ['Hoàn Kiếm', 'Hai Bà Trưng', 'Đống Đa'],
        primaryArea: 'Hoàn Kiếm, Hai Bà Trưng, Đống Đa',
        minPrice: 20000,
        maxPrice: 40000,
        price: 30000,
        priceDisplay: '20.000 đ – 40.000 đ',
        mealTime: 'Sáng',
        mood: 'Nhanh gọn, Đi 1 mình',
        isVegetarian: false,
        tags: 'xoi xeo, mo hanh, an sang',
        description: 'Hạt xôi nếp cái hoa vàng óng ả bọc trong lá chuối, xắt từng lát đỗ xanh bùi ngậy rưới mỡ gà thơm nức mũi.',
        restaurants: [{ name: 'Xôi Mây Hàng Bài', address: '35 Lý Thường Kiệt', district: 'Hoàn Kiếm', priceRange: '20k - 40k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '14',
        name: 'Cà Phê Trứng Giảng',
        category: 'Ăn vặt phố cổ',
        areas: ['Hoàn Kiếm', 'Ba Đình'],
        primaryArea: 'Hoàn Kiếm, Ba Đình',
        minPrice: 35000,
        maxPrice: 50000,
        price: 40000,
        priceDisplay: '35.000 đ – 50.000 đ',
        mealTime: 'Sáng, Chiều, Tối',
        mood: 'Hẹn hò, Thư giãn',
        isVegetarian: true,
        tags: 'ca phe trung, do uong, pho co',
        description: 'Lớp kem trứng đánh bông mịn như mây béo ngậy phủ trên nền cà phê Robusta nguyên chất nóng hổi.',
        restaurants: [{ name: 'Cafe Giảng', address: '39 Nguyễn Hữu Huân', district: 'Hoàn Kiếm', priceRange: '35k - 50k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '15',
        name: 'Phở Nấm Chay Thanh Lương',
        category: 'Món chay thanh tịnh',
        areas: ['Hoàn Kiếm', 'Tây Hồ', 'Đống Đa'],
        primaryArea: 'Hoàn Kiếm, Tây Hồ, Đống Đa',
        minPrice: 40000,
        maxPrice: 60000,
        price: 50000,
        priceDisplay: '40.000 đ – 60.000 đ',
        mealTime: 'Sáng, Trưa, Tối',
        mood: 'Thanh tịnh, Ăn chay',
        isVegetarian: true,
        tags: 'chay, vegetarian, pho nam',
        description: 'Nước dùng ninh từ củ quả ngọt lịm tự nhiên, kết hợp nấm hương rừng và đậu hũ non thanh khiết tâm hồn.',
        restaurants: [{ name: 'Cơm Chay Nàng Tấm', address: '79A Trần Hưng Đạo', district: 'Hoàn Kiếm', priceRange: '50k - 80k', mapsUrl: 'https://maps.google.com' }]
      }
    ]
  };
}
