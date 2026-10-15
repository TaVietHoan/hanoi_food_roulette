/**
 * Hanoi Food Roulette — Commercial Ultra-Modern Frontend Engine
 * File: app.js
 */

// =========================================================================
// 1. CẤU HÌNH API BACKEND
// Dán URL Web App Google Apps Script của bạn vào đây (sau khi Deploy New Web App)
// =========================================================================
const APPS_SCRIPT_API_URL = 'https://script.google.com/macros/s/AKfycbyGWACPXXRgMousiB2-h2cxCY2K92TjVHWpSOabahOu6YLwIZf-GCIVdiKRSlnsMzNcmg/exec';

// =========================================================================
// 2. AUDIO SYNTHESIZER (Tạo âm thanh cơ khí chân thực bằng Web Audio API)
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

function playTickSound(freq = 700) {
  if (!soundEnabled || !audioCtx) return;
  try {
    const osc = audioCtx.createOscillator();
    const gain = audioCtx.createGain();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, audioCtx.currentTime);

    gain.gain.setValueAtTime(0.2, audioCtx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.035);

    osc.connect(gain);
    gain.connect(audioCtx.destination);

    osc.start();
    osc.stop(audioCtx.currentTime + 0.035);
  } catch (e) {}
}

function playWinChime() {
  if (!soundEnabled || !audioCtx) return;
  try {
    const chord = [523.25, 659.25, 783.99, 1046.50]; // Do - Mi - Sol - Do cao
    chord.forEach((freq, idx) => {
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, audioCtx.currentTime + idx * 0.1);

      gain.gain.setValueAtTime(0.25, audioCtx.currentTime + idx * 0.1);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + idx * 0.1 + 0.5);

      osc.connect(gain);
      gain.connect(audioCtx.destination);

      osc.start(audioCtx.currentTime + idx * 0.1);
      osc.stop(audioCtx.currentTime + idx * 0.1 + 0.55);
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

// Three.js Objects
let scene, camera, renderer, wheelGroup, wheelTexture;
let previousSectorPassed = -1;

// Luxury Gourmet Palette (Bộ màu Cyber Tokyo & Phố Cổ Dark Luxury)
const LUXE_PALETTE = [
  '#E11D48', '#2563EB', '#D97706', '#059669', '#7C3AED', 
  '#EA580C', '#0891B2', '#DB2777', '#4F46E5', '#65A30D'
];

// =========================================================================
// 4. KHỞI CHẠY HỆ THỐNG
// =========================================================================
window.addEventListener('DOMContentLoaded', () => {
  setupUIEvents();
  loadData();
});

function setupUIEvents() {
  // Âm thanh
  const soundBtn = document.getElementById('btnSoundToggle');
  soundBtn.addEventListener('click', () => {
    initAudio();
    soundEnabled = !soundEnabled;
    document.getElementById('soundIcon').textContent = soundEnabled ? '🔊' : '🔇';
    document.getElementById('soundText').textContent = soundEnabled ? 'Bật tiếng' : 'Tắt tiếng';
  });

  // Kích hoạt audio khi chạm
  window.addEventListener('touchstart', initAudio, { once: true });
  window.addEventListener('click', initAudio, { once: true });

  // Quick Chips (Ăn sáng, trưa, tối, nhậu...)
  const chipContainer = document.getElementById('quickChips');
  chipContainer.addEventListener('click', (e) => {
    const chip = e.target.closest('.filter-chip');
    if (!chip) return;
    chipContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chip.classList.add('active');
    activeQuickFilter = {
      type: chip.getAttribute('data-type'),
      val: chip.getAttribute('data-val') || ''
    };
    applyFilters();
  });

  // Bộ lọc
  document.getElementById('filterSearch').addEventListener('input', applyFilters);
  document.getElementById('filterDistrict').addEventListener('change', applyFilters);
  document.getElementById('filterCategory').addEventListener('change', applyFilters);
  document.getElementById('filterVeg').addEventListener('change', applyFilters);

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

  document.getElementById('btnResetFilters').addEventListener('click', () => {
    document.getElementById('filterSearch').value = '';
    document.getElementById('filterDistrict').value = '';
    document.getElementById('filterCategory').value = '';
    document.getElementById('filterVeg').checked = false;
    priceSlider.value = 300000;
    priceLabel.textContent = 'Không giới hạn';
    chipContainer.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
    chipContainer.querySelector('[data-type="all"]').classList.add('active');
    activeQuickFilter = { type: 'all', val: '' };
    applyFilters();
  });

  // Nút Quay
  document.getElementById('btnSpin').addEventListener('click', launchSpinRoulette);

  // Modal actions
  document.getElementById('resultModal').addEventListener('click', (e) => {
    if (e.target.id === 'resultModal') {
      document.getElementById('resultModal').style.display = 'none';
    }
  });

  document.getElementById('btnSpinAgain').addEventListener('click', () => {
    document.getElementById('resultModal').style.display = 'none';
    launchSpinRoulette();
  });

  document.getElementById('btnShareInvite').addEventListener('click', shareInvitation);

  // Lịch sử Modal
  document.getElementById('btnHistory').addEventListener('click', openHistoryModal);
  document.getElementById('btnCloseHistory').addEventListener('click', () => {
    document.getElementById('historyModal').style.display = 'none';
  });
  document.getElementById('btnClearHistory').addEventListener('click', () => {
    localStorage.removeItem('hanoi_roulette_history');
    renderHistoryList();
  });

  window.addEventListener('resize', handleWindowResize);
}

// =========================================================================
// 5. TẢI DỮ LIỆU TỪ GOOGLE APPS SCRIPT HOẶC LOCAL FALLBACK
// =========================================================================
async function loadData() {
  const loader = document.getElementById('loaderScreen');
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
      console.warn('Apps Script URL chưa cấu hình hoặc bị chặn CORS, sử dụng dữ liệu phong phú chuẩn hóa:', err);
    }
  }

  onDataReady(getFallBackHanoiDataset());
}

function onDataReady(payload) {
  masterFoods = payload.foods || [];

  // Điền Quận / Huyện
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

  // Điền Danh mục
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
// 6. LOGIC LỌC ĐA TIÊU CHÍ (CHÍNH XÁC KHOẢNG GIÁ & TÂM TRẠNG)
// =========================================================================
function applyFilters() {
  if (isSpinning) return;

  const search = document.getElementById('filterSearch').value.toLowerCase().trim();
  const selectedDistrict = document.getElementById('filterDistrict').value.toLowerCase().trim();
  const selectedCat = document.getElementById('filterCategory').value;
  const isVegOnly = document.getElementById('filterVeg').checked;
  const maxPrice = parseInt(document.getElementById('filterPrice').value, 10);

  filteredFoods = masterFoods.filter(item => {
    // 1. Tìm kiếm tên & tag
    if (search) {
      const matchName = item.name.toLowerCase().includes(search);
      const matchTag = item.tags && item.tags.toLowerCase().includes(search);
      if (!matchName && !matchTag) return false;
    }

    // 2. Lọc khu vực (so khớp mảng areas)
    if (selectedDistrict) {
      const hasDistrict = item.areas.some(area => area.toLowerCase().includes(selectedDistrict)) ||
                          (item.primaryArea && item.primaryArea.toLowerCase().includes(selectedDistrict));
      if (!hasDistrict) return false;
    }

    // 3. Lọc danh mục
    if (selectedCat && item.category !== selectedCat) return false;

    // 4. Lọc chay
    if (isVegOnly && !item.isVegetarian) return false;

    // 5. Lọc giá (dùng minPrice hoặc price trung bình để lọc)
    if (maxPrice < 300000) {
      const compPrice = item.minPrice || item.price || 0;
      if (compPrice > maxPrice) return false;
    }

    // 6. Quick Chips lọc thời gian & tâm trạng
    if (activeQuickFilter.type === 'time') {
      const mt = (item.mealTime || '').toLowerCase();
      if (!mt.includes(activeQuickFilter.val.toLowerCase()) && !mt.includes('cả ngày')) return false;
    } else if (activeQuickFilter.type === 'mood') {
      const md = (item.mood || '').toLowerCase();
      if (!md.includes(activeQuickFilter.val.toLowerCase()) && !md.includes('mọi dịp')) return false;
    }

    return true;
  });

  // Cập nhật số lượng
  const counterPill = document.getElementById('foodCountPill');
  counterPill.textContent = `${filteredFoods.length} món sẵn sàng`;

  const btnSpin = document.getElementById('btnSpin');
  if (filteredFoods.length === 0) {
    btnSpin.disabled = true;
    btnSpin.querySelector('.btn-spin-label').textContent = 'KHÔNG CÓ MÓN PHÙ HỢP';
  } else {
    btnSpin.disabled = false;
    btnSpin.querySelector('.btn-spin-label').textContent = 'QUAY NGAY HÔM NAY';
  }

  refreshWheelTexture();
}

// =========================================================================
// 7. KHỞI TẠO VÒNG QUAY 3D VỚI THREE.JS (TITANIUM & GOLD LUXURY)
// =========================================================================
function initThreeJsEngine() {
  const container = document.getElementById('viewport3d');
  const canvas = document.getElementById('roulette3d');
  const width = container.clientWidth;
  const height = container.clientHeight;

  scene = new THREE.Scene();

  camera = new THREE.PerspectiveCamera(40, width / height, 0.1, 100);
  camera.position.set(0, -6.0, 7.5);
  camera.lookAt(0, 0, 0);

  renderer = new THREE.WebGLRenderer({ canvas: canvas, antialias: true, alpha: true });
  renderer.setSize(width, height);
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

  // Studio Lighting
  const ambientLight = new THREE.AmbientLight(0xffffff, 1.1);
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight(0xfffaed, 1.5);
  keyLight.position.set(6, 8, 9);
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight(0x38bdf8, 0.6);
  fillLight.position.set(-6, -4, 4);
  scene.add(fillLight);

  // Wheel Group
  wheelGroup = new THREE.Group();
  scene.add(wheelGroup);

  // Thân đĩa (Cylinder bo vát cạnh mạ vàng champagne)
  const geom = new THREE.CylinderGeometry(3.35, 3.35, 0.32, 72);
  geom.rotateX(Math.PI / 2);

  wheelTexture = createUltraCanvasTexture();

  const materials = [
    new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.85, roughness: 0.25 }), // Cạnh đĩa kim loại
    new THREE.MeshStandardMaterial({ map: wheelTexture, roughness: 0.2, metalness: 0.1 }), // Mặt nan quạt
    new THREE.MeshStandardMaterial({ color: 0x07090e, roughness: 0.9 }) // Đáy sau
  ];

  const wheelMesh = new THREE.Mesh(geom, materials);
  wheelGroup.add(wheelMesh);

  // 24 Đinh tán mạ vàng kim phát quang
  const studGeom = new THREE.SphereGeometry(0.07, 16, 16);
  const studMat = new THREE.MeshStandardMaterial({ color: 0xffd700, metalness: 0.95, roughness: 0.1 });
  const totalStuds = 24;
  for (let i = 0; i < totalStuds; i++) {
    const angle = (i / totalStuds) * Math.PI * 2;
    const stud = new THREE.Mesh(studGeom, studMat);
    stud.position.set(Math.cos(angle) * 3.22, Math.sin(angle) * 3.22, 0.17);
    wheelGroup.add(stud);
  }

  // Trục xoay trung tâm huy hiệu hoàng gia
  const centerHubGeom = new THREE.CylinderGeometry(0.55, 0.68, 0.4, 36);
  centerHubGeom.rotateX(Math.PI / 2);
  const centerHubMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.95, roughness: 0.15 });
  const centerHub = new THREE.Mesh(centerHubGeom, centerHubMat);
  wheelGroup.add(centerHub);

  // Render Loop
  function render() {
    requestAnimationFrame(render);
    if (!isSpinning && wheelGroup) {
      wheelGroup.rotation.z += 0.0016; // Chuyển động xoay thư thái khi nhàn rỗi
    }
    renderer.render(scene, camera);
  }
  render();
}

// =========================================================================
// 8. TẠO TEXTURE ĐỒ HOẠ SIÊU NÉT (CANVAS 2048x2048 SẮC SẢO)
// =========================================================================
function createUltraCanvasTexture() {
  const canvas = document.createElement('canvas');
  canvas.width = 2048;
  canvas.height = 2048;
  const ctx = canvas.getContext('2d');
  drawSlicesOnCanvas(ctx, 2048, 2048);

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
  const radius = width / 2 - 24;

  ctx.clearRect(0, 0, width, height);

  const items = (filteredFoods && filteredFoods.length > 0) ? filteredFoods : [{ name: 'Đang lọc...' }];
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

    // Gradient màu tạo chiều sâu cho nan quạt
    const grad = ctx.createRadialGradient(cx, cy, 100, cx, cy, radius);
    grad.addColorStop(0, LUXE_PALETTE[i % LUXE_PALETTE.length]);
    grad.addColorStop(1, adjustColor(LUXE_PALETTE[i % LUXE_PALETTE.length], -30));
    ctx.fillStyle = grad;
    ctx.fill();

    // Viền nan quạt tinh xảo
    ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
    ctx.lineWidth = 4;
    ctx.stroke();

    // Vẽ chữ tên món
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(startA + anglePerSlice / 2);
    ctx.textAlign = 'right';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = '#ffffff';

    // Cỡ chữ động theo số lượng phần tử
    let fontSize = 54;
    if (count > 20) fontSize = 32;
    else if (count > 12) fontSize = 42;
    else if (count > 6) fontSize = 48;

    ctx.font = `700 ${fontSize}px 'Be Vietnam Pro', sans-serif`;
    ctx.shadowColor = 'rgba(0, 0, 0, 0.9)';
    ctx.shadowBlur = 10;
    ctx.shadowOffsetX = 2;
    ctx.shadowOffsetY = 2;

    let title = items[i].name;
    if (title.length > 18) title = title.substring(0, 16) + '...';
    ctx.fillText(title, radius - 90, 0);

    ctx.restore();
  }

  // Viền ngoài mặt đĩa mạ vàng sang trọng
  ctx.beginPath();
  ctx.arc(cx, cy, radius, 0, Math.PI * 2);
  ctx.strokeStyle = '#f59e0b';
  ctx.lineWidth = 16;
  ctx.stroke();

  // Vòng lõi trung tâm
  ctx.beginPath();
  ctx.arc(cx, cy, 170, 0, Math.PI * 2);
  ctx.fillStyle = '#0f172a';
  ctx.fill();
  ctx.strokeStyle = '#e2e8f0';
  ctx.lineWidth = 10;
  ctx.stroke();
}

function adjustColor(color, percent) {
  let num = parseInt(color.replace('#', ''), 16),
    amt = Math.round(2.55 * percent),
    r = (num >> 16) + amt,
    b = (num >> 8 & 0x00FF) + amt,
    g = (num & 0x0000FF) + amt;
  return '#' + (0x1000000 + (r < 255 ? r < 1 ? 0 : r : 255) * 0x10000 + (b < 255 ? b < 1 ? 0 : b : 255) * 0x100 + (g < 255 ? g < 1 ? 0 : g : 255)).toString(16).slice(1);
}

// =========================================================================
// 9. QUAY VÒNG QUAY 3D VỚI VẬT LÝ KIM LẮC (POINTER SPRING PHYSICS)
// =========================================================================
function launchSpinRoulette() {
  if (isSpinning || !filteredFoods || filteredFoods.length === 0) return;

  initAudio();
  const count = filteredFoods.length;

  if (count === 1) {
    recordHistory(filteredFoods[0]);
    showWinningModal(filteredFoods[0]);
    return;
  }

  isSpinning = true;
  const btn = document.getElementById('btnSpin');
  btn.disabled = true;
  btn.querySelector('.btn-spin-label').textContent = 'ĐANG TÌM MÓN NGON...';

  const pointerEl = document.getElementById('wheelPointer');

  // 1. Chọn ngẫu nhiên index
  const winIdx = Math.floor(Math.random() * count);
  winningFood = filteredFoods[winIdx];

  // 2. Góc dừng tuyệt đối khớp kim trên đỉnh (PI / 2)
  const sliceA = (Math.PI * 2) / count;
  const winCenterA = winIdx * sliceA + (sliceA / 2);

  const extraSpins = 9 + Math.floor(Math.random() * 3); // 9-11 vòng quay

  const currentZ = wheelGroup.rotation.z % (Math.PI * 2);
  const targetDelta = (Math.PI / 2 - winCenterA) - currentZ;
  let finalRot = wheelGroup.rotation.z + targetDelta + (extraSpins * Math.PI * 2);

  if (finalRot <= wheelGroup.rotation.z) {
    finalRot += Math.PI * 2;
  }

  const startRot = wheelGroup.rotation.z;
  const distance = finalRot - startRot;
  const duration = 5200; // 5.2 giây
  const startTime = performance.now();

  previousSectorPassed = -1;

  function frameUpdate(now) {
    const elapsed = now - startTime;
    const p = Math.min(elapsed / duration, 1);

    // Quintic Ease-Out cho cảm giác trớn xoay siêu mượt
    const ease = 1 - Math.pow(1 - p, 5);
    wheelGroup.rotation.z = startRot + distance * ease;

    // Tính toán nan quạt đi qua kim để kích hoạt rung kim + tiếng click
    const currentAngleNormalized = (wheelGroup.rotation.z % (Math.PI * 2) + (Math.PI * 2)) % (Math.PI * 2);
    const activeSector = Math.floor(currentAngleNormalized / sliceA);

    if (activeSector !== previousSectorPassed) {
      previousSectorPassed = activeSector;
      const pitch = 550 + (1 - p) * 350;
      playTickSound(pitch);

      // Hiệu ứng kim nảy lò xo khi nan gạt qua
      if (pointerEl) {
        pointerEl.style.transform = 'translateX(-50%) rotate(-18deg)';
        setTimeout(() => {
          pointerEl.style.transform = 'translateX(-50%) rotate(0deg)';
        }, 50);
      }
    }

    if (p < 1) {
      requestAnimationFrame(frameUpdate);
    } else {
      wheelGroup.rotation.z = finalRot;
      isSpinning = false;
      btn.disabled = false;
      btn.querySelector('.btn-spin-label').textContent = 'QUAY NGAY HÔM NAY';

      playWinChime();
      fireConfetti();
      recordHistory(winningFood);

      setTimeout(() => {
        showWinningModal(winningFood);
      }, 450);
    }
  }

  requestAnimationFrame(frameUpdate);
}

// =========================================================================
// 10. MODAL KẾT QUẢ, CHỈ ĐƯỜNG & TẠO THIỆP MỜI BẠN BÈ
// =========================================================================
function showWinningModal(food) {
  if (!food) return;

  document.getElementById('resCategory').textContent = food.category || 'Món ngon phố cổ';
  document.getElementById('resTitle').textContent = food.name;
  document.getElementById('resPrice').textContent = food.priceDisplay || 'Giá tham khảo';
  document.getElementById('resAreas').textContent = food.primaryArea || 'Hà Nội';
  document.getElementById('resDesc').textContent = food.description || 'Món ngon chuẩn vị truyền thống Hà Nội.';

  const container = document.getElementById('resRestaurantsContainer');
  container.innerHTML = '';

  if (food.restaurants && food.restaurants.length > 0) {
    food.restaurants.forEach(rest => {
      const card = document.createElement('div');
      card.className = 'restaurant-card';
      const mapsQuery = encodeURIComponent(rest.name + ' ' + rest.address + ' Hà Nội');
      card.innerHTML = `
        <div class="rest-row-head">
          <div class="rest-name">${escapeSafe(rest.name)}</div>
          <span class="rest-price">${escapeSafe(rest.priceRange)}</span>
        </div>
        <div class="rest-sub">📍 ${escapeSafe(rest.address)} (${escapeSafe(rest.district)})</div>
        <div class="rest-actions-row">
          <a href="${escapeSafe(rest.mapsUrl)}" target="_blank" rel="noopener noreferrer" class="btn-action-sm">
            <span>🗺️ Chỉ đường</span>
          </a>
          <a href="https://shopeefood.vn/ha-noi/danh-sach-quan-mon-${encodeURIComponent(food.name)}" target="_blank" rel="noopener noreferrer" class="btn-action-sm food-app">
            <span>🛵 Đặt ShopeeFood</span>
          </a>
        </div>
      `;
      container.appendChild(card);
    });
  } else {
    container.innerHTML = `
      <div style="padding:14px; background:rgba(255,255,255,0.03); border-radius:12px; font-size:0.88rem; color:var(--text-muted);">
        Chưa có quán chỉ định trong danh mục. Tìm nhanh ngay quanh bạn:
        <div style="margin-top:10px;">
          <a href="https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(food.name + ' ngon Hà Nội')}" target="_blank" rel="noopener noreferrer" class="btn-action-sm">
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
  const text = `🍜 Ê đi ăn không? Cỗ máy Vị Hà Nội vừa gợi ý món: *${winningFood.name}*!\n💰 Giá khoảng: ${winningFood.priceDisplay}\n📍 Khu vực: ${winningFood.primaryArea}\nLên đồ đi luôn nhé!`;

  if (navigator.clipboard) {
    navigator.clipboard.writeText(text).then(() => {
      alert('Đã copy lời mời vào Clipboard! Hãy dán vào Zalo/Messenger rủ bạn bè ngay nhé 🎉');
    }).catch(() => {
      prompt('Copy lời mời dưới đây:', text);
    });
  } else {
    prompt('Copy lời mời dưới đây:', text);
  }
}

// =========================================================================
// 11. QUẢN LÝ LỊCH SỬ LOCAL STORAGE
// =========================================================================
function recordHistory(food) {
  try {
    let hist = JSON.parse(localStorage.getItem('hanoi_roulette_history') || '[]');
    hist.unshift({
      name: food.name,
      category: food.category,
      price: food.priceDisplay,
      time: new Date().toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' })
    });
    if (hist.length > 20) hist = hist.slice(0, 20);
    localStorage.setItem('hanoi_roulette_history', JSON.stringify(hist));
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
    hist = JSON.parse(localStorage.getItem('hanoi_roulette_history') || '[]');
  } catch (e) {}

  if (hist.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted); text-align:center; padding:20px;">Chưa có lịch sử quay món nào.</p>';
    return;
  }

  container.innerHTML = hist.map(item => `
    <div style="display:flex; justify-content:space-between; align-items:center; padding:10px 0; border-bottom:1px solid rgba(255,255,255,0.06);">
      <div>
        <div style="font-weight:700; color:#fff;">${escapeSafe(item.name)}</div>
        <div style="font-size:0.75rem; color:var(--text-muted);">${escapeSafe(item.category)} • ${escapeSafe(item.price)}</div>
      </div>
      <span style="font-size:0.75rem; color:var(--gold); font-weight:600;">${escapeSafe(item.time)}</span>
    </div>
  `).join('');
}

function fireConfetti() {
  if (typeof confetti === 'function') {
    confetti({
      particleCount: 110,
      spread: 85,
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
// 12. DỮ LIỆU DỰ PHÒNG CHUẨN XÁC ĐẦY ĐỦ KHOẢNG GIÁ & BỮA ĂN
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
        description: 'Chả miếng chả băm nướng xém cạnh trên than hoa đượm hồng, chấm nước mắm cà cuống đu đủ chua ngọt.',
        restaurants: [{ name: 'Bún Chả Đắc Kim', address: '1 Hàng Mành', district: 'Hoàn Kiếm', priceRange: '60k - 100k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '3',
        name: 'Chả Cá Lã Vọng',
        category: 'Đặc sản Hà Nội',
        areas: ['Hoàn Kiếm', 'Tây Hồ'],
        primaryArea: 'Hoàn Kiếm, Tây Hồ',
        minPrice: 150000,
        maxPrice: 200000,
        price: 175000,
        priceDisplay: '150.000 đ – 200.000 đ',
        mealTime: 'Trưa, Tối',
        mood: 'Hẹn hò, Tiếp khách',
        isVegetarian: false,
        tags: 'cha ca, la vong',
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
        mealTime: 'Trưa',
        mood: 'Tụ tập, Bạn bè',
        isVegetarian: false,
        tags: 'bun dau, mam tom',
        description: 'Đậu Mơ lướt ván giòn vỏ ngậy ruột, chả cốm dẻo thơm, mắm tôm Thanh Hóa đánh sủi bọt quất ớt cay xè.',
        restaurants: [{ name: 'Bún Đậu Trung Hương', address: '49 Ngõ Phất Lộc', district: 'Hoàn Kiếm', priceRange: '45k - 70k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '5',
        name: 'Bánh Cuốn Nóng Cà Cuống',
        category: 'Bánh truyền thống',
        areas: ['Hoàn Kiếm', 'Hai Bà Trưng'],
        primaryArea: 'Hoàn Kiếm, Hai Bà Trưng',
        minPrice: 35000,
        maxPrice: 55000,
        price: 45000,
        priceDisplay: '35.000 đ – 55.000 đ',
        mealTime: 'Sáng, Đêm',
        mood: 'Đi 1 mình, Nhẹ nhàng',
        isVegetarian: false,
        tags: 'banh cuon, ca cuong',
        description: 'Bánh tráng mỏng tang thấy rõ nhân thịt băm mộc nhĩ giòn sần sật, điểm xuyết một giọt tinh dầu cà cuống quý giá.',
        restaurants: [{ name: 'Bánh Cuốn Bà Hoành', address: '66 Tô Hiến Thành', district: 'Hai Bà Trưng', priceRange: '40k - 60k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '6',
        name: 'Nộm Bò Khô Bờ Hồ',
        category: 'Ăn vặt phố cổ',
        areas: ['Hoàn Kiếm'],
        primaryArea: 'Hoàn Kiếm',
        minPrice: 35000,
        maxPrice: 50000,
        price: 40000,
        priceDisplay: '35.000 đ – 50.000 đ',
        mealTime: 'Tối, Đêm',
        mood: 'Hẹn hò, Ăn vặt',
        isVegetarian: false,
        tags: 'nom, bo kho',
        description: 'Đu đủ nạo giòn tanh tách quyện với thịt bò khô xé cay nồng và nước giấm đường ớt tỏi chua ngọt ngây ngất.',
        restaurants: [{ name: 'Nộm Bò Khô Long Vi Dung', address: '23 Hồ Hoàn Kiếm', district: 'Hoàn Kiếm', priceRange: '35k - 50k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '7',
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
        description: 'Lá phở bản vuông trắng muốt cuộn chặt thịt bò xào lửa lớn và rau thơm non mượt chấm mắm tỏi cay cay.',
        restaurants: [{ name: 'Phở Cuốn Hưng Bền', address: '33 Ngũ Xã', district: 'Ba Đình', priceRange: '60k - 100k', mapsUrl: 'https://maps.google.com' }]
      },
      {
        id: '8',
        name: 'Phở Nấm Chay Thanh Lương',
        category: 'Món chay',
        areas: ['Hoàn Kiếm', 'Tây Hồ'],
        primaryArea: 'Hoàn Kiếm, Tây Hồ',
        minPrice: 40000,
        maxPrice: 60000,
        price: 50000,
        priceDisplay: '40.000 đ – 60.000 đ',
        mealTime: 'Sáng, Trưa, Tối',
        mood: 'Thanh tịnh, Ăn chay',
        isVegetarian: true,
        tags: 'chay, vegetarian, pho nam',
        description: 'Nước dùng hầm từ mía lau, táo đỏ ngọt thanh tự nhiên, nấm đùi gà và nấm hương giòn ngọt sảng khoái.',
        restaurants: [{ name: 'Cơm Chay Nàng Tấm', address: '79A Trần Hưng Đạo', district: 'Hoàn Kiếm', priceRange: '50k - 80k', mapsUrl: 'https://maps.google.com' }]
      }
    ]
  };
}
