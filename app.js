/**
 * Hanoi Food Roulette — Ultra Modern Frontend Engine
 * File: app.js
 */

// =========================================================================
// 1. CẤU HÌNH API BACKEND
// Dán URL Web App Google Apps Script của bạn vào đây (sau khi đã Deploy New Web App)
// =========================================================================
const APPS_SCRIPT_API_URL = 'https://script.google.com/macros/s/AKfycbyGWACPXXRgMousiB2-h2cxCY2K92TjVHWpSOabahOu6YLwIZf-GCIVdiKRSlnsMzNcmg/exec';

// =========================================================================
// 2. AUDIO SYNTHESIZER (Tạo âm thanh cơ học chân thực bằng Web Audio API)
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

function playTickSound(frequency = 600) {
  if (!soundEnabled || !audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(frequency, audioCtx.currentTime);

    gain.gain.setValueAtTime(0.15, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.04);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.04);
  } catch (e) {
    // Bỏ qua nếu trình duyệt chặn tự phát âm
  }
}

function playWinFanfare() {
  if (!soundEnabled || !audioCtx) return;
  try {
    const notes = [440, 554, 659, 880];
    notes.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime + idx * 0.12);

      gain.gain.setValueAtTime(0.2, audioCtx.currentTime + idx * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + idx * 0.12 + 0.35);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(audioCtx.currentTime + idx * 0.12);
      osc.stop(audioCtx.currentTime + idx * 0.12 + 0.4);
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

// Three.js Objects
let scene, camera, renderer, wheelGroup, wheelTexture;
let previousSectorPassed = -1;

// Bảng màu hiện đại cho nan quạt (Cyberpunk Gourmet Palette)
const WHEEL_PALETTE = [
  '#FF4B2B', '#FF416C', '#10B981', '#06B6D4', '#8B5CF6',
  '#F59E0B', '#EC4899', '#3B82F6', '#14B8A6', '#F97316'
];

// =========================================================================
// 4. KHỞI CHẠY HỆ THỐNG
// =========================================================================
window.addEventListener('DOMContentLoaded', () => {
  setupUIEvents();
  loadData();
});

function setupUIEvents() {
  // Bật/tắt âm thanh
  const soundBtn = document.getElementById('btnSoundToggle');
  soundBtn.addEventListener('click', () => {
    initAudio();
    soundEnabled = !soundEnabled;
    document.getElementById('soundIcon').textContent = soundEnabled ? '🔊' : '🔇';
    document.getElementById('soundText').textContent = soundEnabled ? 'Bật tiếng' : 'Tắt tiếng';
  });

  // Tương tác chạm đầu tiên để mở khóa Web Audio trên điện thoại
  window.addEventListener('touchstart', initAudio, { once: true });
  window.addEventListener('click', initAudio, { once: true });

  // Bộ lọc
  document.getElementById('filterSearch').addEventListener('input', applyFilters);
  document.getElementById('filterDistrict').addEventListener('change', applyFilters);
  document.getElementById('filterCategory').addEventListener('change', applyFilters);
  document.getElementById('filterVeg').addEventListener('change', applyFilters);

  const priceSlider = document.getElementById('filterPrice');
  const priceLabel = document.getElementById('priceLabel');
  priceSlider.addEventListener('input', (e) => {
    const val = parseInt(e.target.value, 10);
    if (val >= 500000) {
      priceLabel.textContent = 'Không giới hạn';
    } else {
      priceLabel.textContent = '≤ ' + val.toLocaleString('vi-VN') + ' đ';
    }
    applyFilters();
  });

  document.getElementById('btnResetFilters').addEventListener('click', () => {
    document.getElementById('filterSearch').value = '';
    document.getElementById('filterDistrict').value = '';
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterVeg').checked = false;
    priceSlider.value = 500000;
    priceLabel.textContent = 'Không giới hạn';
    applyFilters();
  });

  document.getElementById('btnSpin').addEventListener('click', launchSpinRoulette);
  document.getElementById('btnDismissModal').addEventListener('click', () => {
    document.getElementById('resultModal').style.display = 'none';
  });
  document.getElementById('btnSpinAgain').addEventListener('click', () => {
    document.getElementById('resultModal').style.display = 'none';
    launchSpinRoulette();
  });

  window.addEventListener('resize', handleWindowResize);
}

// =========================================================================
// 5. TẢI DỮ LIỆU TỪ GOOGLE APPS SCRIPT HOẶC FALLBACK
// =========================================================================
async function loadData() {
  const loader = document.getElementById('loaderScreen');
  const loaderMsg = document.getElementById('loaderStatus');

  if (APPS_SCRIPT_API_URL && APPS_SCRIPT_API_URL.startsWith('http')) {
    try {
      loaderMsg.textContent = 'Đang tải danh sách món ăn từ Google Sheets...';
      const res = await fetch(APPS_SCRIPT_API_URL, { redirect: 'follow' });
      const json = await res.json();
      if (json && json.success) {
        onDataReady(json.data);
        return;
      }
    } catch (err) {
      console.warn('Không thể gọi trực tiếp Apps Script URL, chuyển sang dự phòng cục bộ:', err);
    }
  }

  // Dữ liệu mẫu hoàn chỉnh dự phòng nếu chưa cấu hình APPS_SCRIPT_API_URL
  console.info('Sử dụng dữ liệu mẫu chuẩn hóa đặc sản Hà Nội (Đã hỗ trợ phân tách dấu ;)');
  onDataReady(getFallBackHanoiDataset());
}

function onDataReady(payload) {
  masterFoods = payload.foods || [];

  // Điền dữ liệu vào bộ lọc Khu vực (Tách từ suggested_areas và district_area)
  const distSelect = document.getElementById('filterDistrict');
  distSelect.innerHTML = '<option value="">Tất cả khu vực thủ đô</option>';
  if (payload.districts) {
    payload.districts.forEach(dst => {
      const opt = document.createElement('option');
      opt.value = dst;
      opt.textContent = dst;
      distSelect.appendChild(opt);
    });
  }

  // Điền dữ liệu Danh mục
  const catSelect = document.getElementById('filterCategory');
  catSelect.innerHTML = '<option value="">Tất cả danh mục</option>';
  if (payload.categories) {
    payload.categories.forEach(cat => {
      const opt = document.createElement('option');
      opt.value = cat;
      opt.textContent = cat;
      catSelect.appendChild(opt);
    });
  }

  applyFilters();
  initThreeJsEngine();
  document.getElementById('loaderScreen').style.display = 'none';
}

// =========================================================================
// 6. LOGIC LỌC ĐA TIÊU CHÍ (HỖ TRỢ ĐẶC BIỆT CHO SUGGESTED_AREAS DẤU ;)
// =========================================================================
function applyFilters() {
  if (isSpinning) return;

  const search = document.getElementById('filterSearch').value.toLowerCase().trim();
  const selectedDistrict = document.getElementById('filterDistrict').value.toLowerCase().trim();
  const selectedCat = document.getElementById('filterCategory').value;
  const isVegOnly = document.getElementById('filterVeg').checked;
  const maxPrice = parseInt(document.getElementById('filterPrice').value, 10);

  filteredFoods = masterFoods.filter(item => {
    // 1. Tìm kiếm tên / tag
    if (search) {
      const matchName = item.name.toLowerCase().includes(search);
      const matchTag = item.tags && item.tags.toLowerCase().includes(search);
      if (!matchName && !matchTag) return false;
    }

    // 2. LỌC KHU VỰC: Kiểm tra mảng areas (đã parse từ suggested_areas và district_area)
    if (selectedDistrict) {
      const hasDistrict = item.areas.some(area => area.toLowerCase().includes(selectedDistrict)) ||
                          (item.primaryArea && item.primaryArea.toLowerCase().includes(selectedDistrict));
      if (!hasDistrict) return false;
    }

    // 3. Lọc danh mục
    if (selectedCat && item.category !== selectedCat) return false;

    // 4. Lọc chay
    if (isVegOnly && !item.isVegetarian) return false;

    // 5. Lọc giá
    if (maxPrice < 500000 && item.price > 0 && item.price > maxPrice) return false;

    return true;
  });

  // Cập nhật số lượng hiển thị
  const counterPill = document.getElementById('foodCountPill');
  counterPill.textContent = `${filteredFoods.length} món`;

  const btnSpin = document.getElementById('btnSpin');
  if (filteredFoods.length === 0) {
    btnSpin.disabled = true;
    btnSpin.querySelector('span').textContent = 'KHÔNG CÓ MÓN PHÙ HỢP';
  } else {
    btnSpin.disabled = false;
    btnSpin.querySelector('span').textContent = 'QUAY NGAY HÔM NAY';
  }

  refreshWheelTexture();
}

// =========================================================================
// 7. KHỞI TẠO VÒNG QUAY 3D VỚI THREE.JS (HIỆN ĐẠI, BÓNG BẨY)
// =========================================================================
function initThreeJsEngine() {
  const container = document.getElementById('viewport3d');
  const canvas = document.getElementById('roulette3d');
  const width = container.clientWidth;
  const height = container.clientHeight;

  // Scene
  scene = new THREE.Scene();

  // Camera
  camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
  camera.position.set(0, -5.8, 7.2);
  camera.lookAt(0, 0, 0);

  // Renderer
  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Ánh sáng cao cấp (Studio Lighting)
  const ambientLight = new THREE.AmbientLight(0xffffff, 0.9);
  scene.add(ambientLight);

  const mainLight = new THREE.DirectionalLight(0xfff5e6, 1.2);
  mainLight.position.set(5, 8, 10);
  scene.add(mainLight);

  const neonRimLight = new THREE.PointLight(0xff4b2b, 1.5, 12);
  neonRimLight.position.set(0, 0, 3.5);
  scene.add(neonRimLight);

  // Nhóm xoay trung tâm
  wheelGroup = new THREE.Group();
  scene.add(wheelGroup);

  // 1. Thân đĩa (Cylinder 3D)
  const geom = new THREE.CylinderGeometry(3.3, 3.3, 0.28, 64);
  geom.rotateX(Math.PI / 2);

  wheelTexture = createDynamicWheelCanvasTexture();

  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.8, roughness: 0.2 }), // Viền kim loại hông
    new THREE.MeshStandardMaterial({ map: wheelTexture, roughness: 0.2, metalness: 0.1 }), // Mặt trên
    new THREE.MeshStandardMaterial({ color: 0x0b0f17, roughness: 0.8 }) // Mặt sau
  ];

  const wheelMesh = new THREE.Mesh(geom, materials);
  wheelGroup.add(wheelMesh);

  // 2. Viền ngoài phát sáng với các đinh tán vàng kim loại (Metallic Studs)
  const studGeom = new THREE.SphereGeometry(0.065, 16, 16);
  const studMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.9, roughness: 0.1 });
  const totalStuds = 24;
  for (let i = 0; i < totalStuds; i++) {
    const angle = (i / totalStuds) * Math.PI * 2;
    const stud = new THREE.Mesh(studGeom, studMat);
    stud.position.set(Math.cos(angle) * 3.2, Math.sin(angle) * 3.2, 0.15);
    wheelGroup.add(stud);
  }

  // 3. Trục trung tâm huy hiệu mạ vàng
  const centerCapGeom = new THREE.CylinderGeometry(0.55, 0.65, 0.38, 32);
  centerCapGeom.rotateX(Math.PI / 2);
  const centerCapMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.95, roughness: 0.15 });
  const centerCap = new THREE.Mesh(centerCapGeom, centerCapMat);
  wheelGroup.add(centerCap);

  // Render loop
  function render() {
    requestAnimationFrame(render);
    if (!isSpinning && wheelGroup) {
      wheelGroup.rotation.z += 0.0018; // Hiệu ứng xoay lượn nhẹ khi rảnh
    }
    renderer.render(scene, camera);
  }
  render();
}

// =========================================================================
// 8. TẠO TEXTURE ĐỒ HỌA MẶT ĐĨA NÉT CĂNG (CANVAS 2D 1024x1024)
// =========================================================================
function createDynamicWheelCanvasTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 1024;
  canvas.height = 1024;
  const ctx = canvas.getContext('2d');
  drawSlicesOnCanvas(ctx, 1024, 1024);

  const texture = new THREE.CanvasTexture(canvas);
  texture.needsUpdate = true;
  return texture;
}

function refreshWheelTexture() {
  if (!wheelTexture) return;
  const canvas = wheelTexture.image;
  const ctx = canvas.getContext('2d');
  drawSlicesOnCanvas(ctx, canvas.width, canvas.height);
  wheelTexture.needsUpdate = true;
}

function drawSlicesOnCanvas(ctx, width, height) {
  const cx = width / 2;
  const cy = height / 2;
  const radius = width / 2 - 12;

  ctx.clearRect(0, 0, width, height);

  const items = (filteredFoods && filteredFoods.length > 0) ? filteredFoods : [{ name: 'Trống' }];
  const count = items.length;
  const anglePerSlice = (Math.PI * 2) / count;

  for (let i = 0; i < count; i++) {
    const startA = i * anglePerSlice;
    const endA = startA + anglePerSlice;

    // Vẽ nan quạt
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.arc(cx, cy, radius, startA, endA);
    ctx.closePath();
    ctx.fillStyle = WHEEL_PALETTE[i % WHEEL_PALETTE.length];
    ctx.fill();

    // Viền trắng mảnh sắc nét
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.4)';
    ctx.lineWidth = 3;
    ctx.stroke();

    // Chữ tên món ăn
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(startA + anglePerSlice / 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';

    let fontSize = 28;
    if (count > 20) fontSize = 16;
    else if (count > 12) fontSize = 20;
    else if (count > 6) fontSize = 24;

    ctx.font = `bold ${fontSize}px 'Be Vietnam Pro', sans-serif`;
    ctx.shadowColor = 'rgba(0,0,0,0.85)';
    ctx.shadowBlur = 6;

    let title = items[i].name;
    if (title.length > 17) title = title.substring(0, 15) + '..';
    ctx.fillText(title, radius - 45, 0);

    ctx.restore();
  }

  // Vòng trung tâm thẩm mỹ
  ctx.beginPath();
  ctx.arc(cx, cy, 90, 0, Math.PI * 2);
  ctx.fillStyle = '#0f172a';
  ctx.fill();
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 8;
  ctx.stroke();
}

// =========================================================================
// 9. QUAY VÒNG QUAY 3D & KHỚP KIM CHỈ TOÁN HỌC CHÍNH XÁC
// =========================================================================
function launchSpinRoulette() {
  if (isSpinning || !filteredFoods || filteredFoods.length === 0) return;

  initAudio();
  const count = filteredFoods.length;

  if (count === 1) {
    showWinningModal(filteredFoods[0]);
    return;
  }

  isSpinning = true;
  const btn = document.getElementById('btnSpin');
  btn.disabled = true;
  btn.querySelector('span').textContent = 'ĐANG TÌM MÓN NGON...';

  // 1. Chọn ngẫu nhiên index trúng giải
  const winIdx = Math.floor(Math.random() * count);
  winningFood = filteredFoods[winIdx];

  // 2. Tính toán góc dừng tuyệt đối: Kim chỉ nằm ở góc đỉnh trên (PI / 2)
  const sliceA = (Math.PI * 2) / count;
  const winCenterA = winIdx * sliceA + (sliceA / 2);

  // Số vòng quay tạo kịch tính (8 đến 11 vòng)
  const extraSpins = 8 + Math.floor(Math.random() * 3);

  const currentZ = wheelGroup.rotation.z % (Math.PI * 2);
  const targetDelta = (Math.PI / 2 - winCenterA) - currentZ;
  let finalRot = wheelGroup.rotation.z + targetDelta + (extraSpins * Math.PI * 2);

  if (finalRot <= wheelGroup.rotation.z) {
    finalRot += Math.PI * 2;
  }

  const startRot = wheelGroup.rotation.z;
  const distance = finalRot - startRot;
  const duration = 5400; // 5.4 giây xoay mượt mà
  const startTime = performance.now();

  previousSectorPassed = -1;

  function frameUpdate(now) {
    const elapsed = now - startTime;
    const p = Math.min(elapsed / duration, 1);

    // Quartic Ease-Out cho cảm giác lực ly tâm chân thực
    const ease = 1 - Math.pow(1 - p, 4);
    wheelGroup.rotation.z = startRot + distance * ease;

    // Phát âm thanh tiếng "tách" khi kim chạm qua nan quạt
    const currentAngleNormalized = (wheelGroup.rotation.z % (Math.PI * 2) + (Math.PI * 2)) % (Math.PI * 2);
    const activeSector = Math.floor(currentAngleNormalized / sliceA);
    if (activeSector !== previousSectorPassed) {
      previousSectorPassed = activeSector;
      const pitch = 500 + (1 - p) * 350; // Giảm dần cao độ khi vòng quay chậm lại
      playTickSound(pitch);
    }

    if (p < 1) {
      requestAnimationFrame(frameUpdate);
    } else {
      wheelGroup.rotation.z = finalRot;
      isSpinning = false;
      btn.disabled = false;
      btn.querySelector('span').textContent = 'QUAY NGAY HÔM NAY';

      playWinFanfare();
      fireConfetti();
      setTimeout(() => {
        showWinningModal(winningFood);
      }, 400);
    }
  }

  requestAnimationFrame(frameUpdate);
}

// =========================================================================
// 10. HIỂN THỊ MODAL KẾT QUẢ & QUÁN ĂN LIÊN KẾT
// =========================================================================
function showWinningModal(food) {
  if (!food) return;

  document.getElementById('resCategory').textContent = food.category || 'Món ngon Hà Nội';
  document.getElementById('resTitle').textContent = food.name;
  document.getElementById('resPrice').textContent = 'Giá: ' + (food.priceDisplay || 'Giá tham khảo');
  document.getElementById('resAreas').textContent = food.primaryArea || 'Hà Nội';
  document.getElementById('resDesc').textContent = food.description || 'Đặc sản ẩm thực trứ danh Hà Nội.';

  const container = document.getElementById('resRestaurantsContainer');
  container.innerHTML = '';

  if (food.restaurants && food.restaurants.length > 0) {
    food.restaurants.forEach(rest => {
      const card = document.createElement('div');
      card.className = 'restaurant-card';
      card.innerHTML = `
        <div class="rest-title-row">
          <div class="rest-name">${escapeSafe(rest.name)}</div>
          <span style="font-size:0.8rem; color:#f59e0b; font-weight:700;">${escapeSafe(rest.priceRange)}</span>
        </div>
        <div class="rest-sub">📍 ${escapeSafe(rest.address)} (${escapeSafe(rest.district)})</div>
        <a href="${escapeSafe(rest.mapsUrl)}" target="_blank" rel="noopener noreferrer" class="btn-maps-action">
          <span>🗺️ Chỉ đường Google Maps</span>
        </a>
      `;
      container.appendChild(card);
    });
  } else {
    container.innerHTML = `
      <div style="padding:14px; background:rgba(255,255,255,0.03); border-radius:12px; font-size:0.9rem; color:var(--text-muted);">
        Chưa có quán cụ thể trong dữ liệu liên kết. Bạn có thể tìm nhanh quán ngon gần nhất:
        <div style="margin-top:10px;">
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(food.name + ' ngon Hà Nội')}" target="_blank" rel="noopener noreferrer" class="btn-maps-action">
            <span>🔍 Mở Google Maps tìm "${escapeSafe(food.name)}"</span>
          </a>
        </div>
      </div>
    `;
  }

  document.getElementById('resultModal').style.display = 'flex';
}

function fireConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 90,
      spread: 80,
      origin: { y: 0.6 }
    });
  }
}

function handleWindowResize() {
  if (!camera || !renderer) return;
  const container = document.getElementById('viewport3d');
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
// 11. DỮ LIỆU DỰ PHÒNG CHUẨN XÁC VỚI CÁC TRƯỜNG SUGGESTED_AREAS DẤU ;
// =========================================================================
function getFallBackHanoiDataset() {
  return {
    categories: ['Bún / Phở', 'Bánh truyền thống', 'Ăn vặt phố cổ', 'Đặc sản Hà Nội', 'Món chay'],
    districts: ['Ba Đình', 'Cầu Giấy', 'Đống Đa', 'Hai Bà Trưng', 'Hoàn Kiếm', 'Tây Hồ', 'Thanh Xuân'],
    foods: [
      {
        id: '1',
        name: 'Phở Bò Tái Lăn',
        category: 'Bún / Phở',
        areas: ['Hai Bà Trưng', 'Hoàn Kiếm', 'Đống Đa'],
        primaryArea: 'Hai Bà Trưng, Hoàn Kiếm, Đống Đa',
        price: 65000,
        priceDisplay: '65.000 đ (tham khảo)',
        isVegetarian: false,
        tags: 'pho, bo, tai lan',
        description: 'Bò xào lửa lớn thơm lừng mùi tỏi đập dập, nước dùng đậm đà béo ngậy.',
        restaurants: [{ name: 'Phở Thìn Lò Đúc', address: '13 Lò Đúc', district: 'Hai Bà Trưng', priceRange: '65k - 90k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '2',
        name: 'Bún Chả Nướng Than',
        category: 'Bún / Phở',
        areas: ['Hoàn Kiếm', 'Ba Đình'],
        primaryArea: 'Hoàn Kiếm, Ba Đình',
        price: 60000,
        priceDisplay: '60.000 đ (tham khảo)',
        isVegetarian: false,
        tags: 'bun cha, thit nuong',
        description: 'Chả miếng chả băm nướng xém cạnh thơm phức, chấm nước mắm đu đủ chua ngọt.',
        restaurants: [{ name: 'Bún Chả Đắc Kim', address: '1 Hàng Mành', district: 'Hoàn Kiếm', priceRange: '60k - 100k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '3',
        name: 'Chả Cá Lã Vọng',
        category: 'Đặc sản Hà Nội',
        areas: ['Hoàn Kiếm', 'Tây Hồ'],
        primaryArea: 'Hoàn Kiếm, Tây Hồ',
        price: 150000,
        priceDisplay: '150.000 đ (tham khảo)',
        isVegetarian: false,
        tags: 'cha ca, la vong',
        description: 'Cá lăng chiên vàng ươm cùng thì là, hành hoa ngập chảo mỡ ăn kèm mắm tôm.',
        restaurants: [{ name: 'Chả Cá Thăng Long', address: '19 Đường Thành', district: 'Hoàn Kiếm', priceRange: '150k - 200k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '4',
        name: 'Bún Đậu Mẹt Mắm Tôm',
        category: 'Bún / Phở',
        areas: ['Đống Đa', 'Hoàn Kiếm', 'Cầu Giấy'],
        primaryArea: 'Đống Đa, Hoàn Kiếm, Cầu Giấy',
        price: 45000,
        priceDisplay: '45.000 đ (tham khảo)',
        isVegetarian: false,
        tags: 'bun dau, mam tom',
        description: 'Đậu Mơ lướt ván giòn rụm bên ngoài béo ngậy bên trong, mắm tôm đánh sủi bọt quất ớt.',
        restaurants: [{ name: 'Bún Đậu Trung Hương', address: '49 Ngõ Phất Lộc', district: 'Hoàn Kiếm', priceRange: '45k - 70k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '5',
        name: 'Bánh Cuốn Nóng Cà Cuống',
        category: 'Bánh truyền thống',
        areas: ['Hoàn Kiếm', 'Hai Bà Trưng'],
        primaryArea: 'Hoàn Kiếm, Hai Bà Trưng',
        price: 40000,
        priceDisplay: '40.000 đ (tham khảo)',
        isVegetarian: false,
        tags: 'banh cuon, ca cuong',
        description: 'Bánh tráng mỏng tang, nhân thịt mộc nhĩ giòn sần sật điểm xuyết tinh dầu cà cuống.',
        restaurants: [{ name: 'Bánh Cuốn Bà Hoành', address: '66 Tô Hiến Thành', district: 'Hai Bà Trưng', priceRange: '40k - 60k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '6',
        name: 'Nộm Bò Khô Bờ Hồ',
        category: 'Ăn vặt phố cổ',
        areas: ['Hoàn Kiếm'],
        primaryArea: 'Hoàn Kiếm',
        price: 35000,
        priceDisplay: '35.000 đ (tham khảo)',
        isVegetarian: false,
        tags: 'nom, bo kho',
        description: 'Đu đủ nạo sợi giòn rụm, thịt bò khô thơm cay quyện nước trộn chua ngọt thanh tao.',
        restaurants: [{ name: 'Nộm Bò Khô Long Vi Dung', address: '23 Hồ Hoàn Kiếm', district: 'Hoàn Kiếm', priceRange: '35k - 50k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '7',
        name: 'Bún Thang Phố Cổ',
        category: 'Bún / Phở',
        areas: ['Hoàn Kiếm', 'Ba Đình'],
        primaryArea: 'Hoàn Kiếm, Ba Đình',
        price: 55000,
        priceDisplay: '55.000 đ (tham khảo)',
        isVegetarian: false,
        tags: 'bun thang, tinh te',
        description: 'Bức tranh ngũ sắc với giò lụa, trứng tráng mỏng, thịt gà xé và củ cải dầm.',
        restaurants: [{ name: 'Bún Thang Bà Đức', address: '48 Cầu Gỗ', district: 'Hoàn Kiếm', priceRange: '50k - 70k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '8',
        name: 'Phở Cuốn Ngũ Xã',
        category: 'Đặc sản Hà Nội',
        areas: ['Ba Đình', 'Tây Hồ'],
        primaryArea: 'Ba Đình, Tây Hồ',
        price: 65000,
        priceDisplay: '65.000 đ (tham khảo)',
        isVegetarian: false,
        tags: 'pho cuon, ngu xa',
        description: 'Bánh phở tươi cuộn chặt thịt bò xào và rau thơm chấm mắm tỏi ớt cay nồng.',
        restaurants: [{ name: 'Phở Cuốn Hưng Bền', address: '33 Ngũ Xã', district: 'Ba Đình', priceRange: '60k - 100k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '9',
        name: 'Phở Nấm Chay Thanh Tịnh',
        category: 'Món chay',
        areas: ['Tây Hồ', 'Đống Đa'],
        primaryArea: 'Tây Hồ, Đống Đa',
        price: 45000,
        priceDisplay: '45.000 đ (tham khảo)',
        isVegetarian: true,
        tags: 'chay, vegetarian, pho nam',
        description: 'Nước dùng ninh từ củ quả ngọt dịu tự nhiên, các loại nấm đùi gà, nấm hương tươi giòn ngọt.',
        restaurants: [{ name: 'Cơm Chay Nàng Tấm', address: '79A Trần Hưng Đạo', district: 'Hoàn Kiếm', priceRange: '50k - 80k', mapsUrl: 'https://maps.google.com' }]
      }
    ]
  };
}