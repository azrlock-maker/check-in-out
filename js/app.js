// Check IN/OUT Florist - Main Application Logic
// Menangani alur kerja penjemputan papan, deteksi keterlambatan, UI filter, dan interaksi pengguna

let appState = {
  activeTab: 'overdue',
  searchQuery: '',
  filterJenis: 'all',
  cachedBoards: [],
  hasPlayedInitialChime: false,
  driverMode: localStorage.getItem('inout_driver_mode') === 'true',
  isMultiSelect: false,
  selectedBoardIds: new Set()
};

// Inisialisasi Aplikasi saat Dokumen Siap
document.addEventListener('DOMContentLoaded', async () => {
  initTimePickers24();
  startLiveClock();
  setupEventListeners();
  initFirebaseSync();
  await ensureBoardTypesSeeded();   // Pastikan tipe papan sudah ada di DB
  await refreshBoardTypesDatalist(); // Isi datalist dari DB
  await loadAndRenderDashboard();

  // Set default form date ke hari ini
  const tglAntarInput = document.getElementById('form-tgl-antar');
  if (tglAntarInput) {
    tglAntarInput.value = getTodayDateStr();
  }
  
  // Set default jam antar 24 jam (misal jam sekarang atau 09:00 WIB)
  const now = new Date();
  const curH = String(now.getHours()).padStart(2, '0');
  setTime24('form-jam-antar', curH, '00');
  setTime24('form-target-jam', '18', '00');
  setTime24('checkin-jam', curH, '00');

  // Set default target jemput ke H+1
  applyEventPreset('pesta', 1);

  // Periksa interval berkala setiap 60 detik untuk memperbarui status keterlambatan
  setInterval(() => {
    renderDashboard();
  }, 60000);
});

// Isi Datalist Jenis Papan dari Database (Dinamis)
async function refreshBoardTypesDatalist() {
  const datalist = document.getElementById('list-jenis-papan');
  if (!datalist) return;
  const types = await getBoardTypes();
  datalist.innerHTML = types.map(t => `<option value="${escapeHtml(t.nama)}"></option>`).join('');
}

// Inisialisasi Komponen Pemilih Jam 24 Jam Eksplisit (Bebas Kebingungan AM/PM)
function initTimePickers24() {
  const hourLabels = [
    { val: '00', label: '00:00 (Tengah Malam)' },
    { val: '01', label: '01:00 (Dini Hari)' },
    { val: '02', label: '02:00 (Dini Hari)' },
    { val: '03', label: '03:00 (Dini Hari)' },
    { val: '04', label: '04:00 (Subuh)' },
    { val: '05', label: '05:00 (Pagi)' },
    { val: '06', label: '06:00 (Pagi)' },
    { val: '07', label: '07:00 (Pagi)' },
    { val: '08', label: '08:00 (Pagi)' },
    { val: '09', label: '09:00 (Pagi)' },
    { val: '10', label: '10:00 (Pagi)' },
    { val: '11', label: '11:00 (Siang)' },
    { val: '12', label: '12:00 (Siang)' },
    { val: '13', label: '13:00 (Siang)' },
    { val: '14', label: '14:00 (Siang)' },
    { val: '15', label: '15:00 (Sore)' },
    { val: '16', label: '16:00 (Sore)' },
    { val: '17', label: '17:00 (Sore)' },
    { val: '18', label: '18:00 (Petang/Malam)' },
    { val: '19', label: '19:00 (Malam)' },
    { val: '20', label: '20:00 (Malam)' },
    { val: '21', label: '21:00 (Malam)' },
    { val: '22', label: '22:00 (Larut Malam)' },
    { val: '23', label: '23:00 (Larut Malam)' }
  ];

  const minuteOptions = Array.from({ length: 60 }, (_, i) => String(i).padStart(2, '0'));
  const prefixes = ['form-jam-antar', 'form-target-jam', 'checkin-jam'];

  prefixes.forEach(prefix => {
    const hhSelect = document.getElementById(prefix + '-hh');
    const mmSelect = document.getElementById(prefix + '-mm');
    if (!hhSelect || !mmSelect) return;

    hhSelect.innerHTML = hourLabels.map(h => `<option value="${h.val}">${h.label}</option>`).join('');
    mmSelect.innerHTML = minuteOptions.map(m => `<option value="${m}">${m} Menit</option>`).join('');

    const updateHidden = () => {
      const hidden = document.getElementById(prefix);
      if (hidden) {
        hidden.value = `${hhSelect.value}:${mmSelect.value}`;
      }
    };

    hhSelect.addEventListener('change', updateHidden);
    mmSelect.addEventListener('change', updateHidden);
  });
}

// Helper Ubah Waktu 24 Jam dengan Cepat
function setTime24(fieldPrefix, hh, mm) {
  const hhSelect = document.getElementById(fieldPrefix + '-hh');
  const mmSelect = document.getElementById(fieldPrefix + '-mm');
  const hiddenInput = document.getElementById(fieldPrefix);

  const formattedH = String(hh).padStart(2, '0');
  const formattedM = String(mm).padStart(2, '0');

  if (hhSelect) hhSelect.value = formattedH;
  if (mmSelect) mmSelect.value = formattedM;
  if (hiddenInput) hiddenInput.value = `${formattedH}:${formattedM}`;
}

// Setup Seluruh Event Listener

function setupEventListeners() {
  // Tab Navigasi Desktop & Mobile
  const tabs = document.querySelectorAll('.tab-btn');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      appState.activeTab = tab.dataset.tab;
      renderBoardCards();

      // Sinkronkan ke bottom nav jika ada
      const bottomNavs = document.querySelectorAll('.nav-item');
      bottomNavs.forEach(bn => {
        if (bn.dataset.tab === appState.activeTab) {
          bn.classList.add('active');
        } else {
          bn.classList.remove('active');
        }
      });
    });
  });

  // Mobile Bottom Nav
  const bottomNavs = document.querySelectorAll('.nav-item');
  bottomNavs.forEach(bn => {
    bn.addEventListener('click', () => {
      const tabTarget = bn.dataset.tab;
      if (tabTarget) {
        appState.activeTab = tabTarget;
        bottomNavs.forEach(n => n.classList.remove('active'));
        bn.classList.add('active');

        tabs.forEach(t => {
          if (t.dataset.tab === tabTarget) {
            t.classList.add('active');
          } else {
            t.classList.remove('active');
          }
        });

        renderBoardCards();
      }
    });
  });

  // Pencarian
  const searchInput = document.getElementById('search-input');
  if (searchInput) {
    searchInput.addEventListener('input', (e) => {
      appState.searchQuery = e.target.value.toLowerCase().trim();
      renderBoardCards();
    });
  }

  // Filter Jenis Papan
  const filterPills = document.querySelectorAll('.pill-btn');
  filterPills.forEach(pill => {
    pill.addEventListener('click', () => {
      filterPills.forEach(p => p.classList.remove('active'));
      pill.classList.add('active');
      appState.filterJenis = pill.dataset.filter;
      renderBoardCards();
    });
  });

  // Modal Tambah Papan
  const btnOpenAdd = document.getElementById('btn-open-add');
  const fabAdd = document.getElementById('fab-add');
  if (btnOpenAdd) btnOpenAdd.addEventListener('click', () => openBoardModal());
  if (fabAdd) fabAdd.addEventListener('click', () => openBoardModal());

  // Form Submit
  const formBoard = document.getElementById('form-board');
  if (formBoard) {
    formBoard.addEventListener('submit', handleSaveBoard);
  }

  // Preset Buttons di Form
  const presetBtns = document.querySelectorAll('.preset-btn');
  presetBtns.forEach(btn => {
    btn.addEventListener('click', () => {
      presetBtns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const presetType = btn.dataset.preset;
      const duration = parseInt(btn.dataset.duration || '1', 10);
      applyEventPreset(presetType, duration);
    });
  });

  // Listener input tanggal antar untuk otomatis sesuaikan target jemput
  const tglAntarInput = document.getElementById('form-tgl-antar');
  if (tglAntarInput) {
    tglAntarInput.addEventListener('change', () => {
      const activePreset = document.querySelector('.preset-btn.active');
      const duration = activePreset ? parseInt(activePreset.dataset.duration || '1', 10) : 1;
      calculateTargetPickupDate(duration);
    });
  }

  // GPS Capture Button di Form
  const btnGps = document.getElementById('btn-capture-gps');
  if (btnGps) {
    btnGps.addEventListener('click', handleCaptureGps);
  }

  // Photo Upload Handler
  const photoInput = document.getElementById('form-photo-input');
  if (photoInput) {
    photoInput.addEventListener('change', handlePhotoSelect);
  }

  // Tombol Rekap Overdue ke WhatsApp
  const btnWaOverdue = document.getElementById('btn-wa-overdue');
  if (btnWaOverdue) {
    btnWaOverdue.addEventListener('click', handleWaOverdueSummary);
  }

  // Tombol Pengaturan
  const btnSettings = document.getElementById('btn-settings');
  if (btnSettings) {
    btnSettings.addEventListener('click', openSettingsModal);
  }

  // Tombol Izin Notifikasi Web
  const btnRequestNotif = document.getElementById('btn-request-notif');
  if (btnRequestNotif) {
    btnRequestNotif.addEventListener('click', async () => {
      const granted = await NotificationManager.requestPermission();
      if (granted) {
        showToast('✅ Izin notifikasi aktif! Anda akan menerima peringatan jika papan telat.', 'success');
        NotificationManager.sendNotification('Check IN/OUT Florist Aktif', 'Sistem pengingat penjemputan papan bunga siap memantau.');
      } else {
        showToast('⚠️ Izin notifikasi belum diizinkan pada browser.', 'warning');
      }
    });
  }

  // Tombol Impor dari Finance Akio
  const btnImportFinance = document.getElementById('btn-import-finance');
  if (btnImportFinance) {
    btnImportFinance.addEventListener('click', handleImportFinance);
  }

  // Tombol Kelola Tipe Papan
  const btnManageTypes = document.getElementById('btn-manage-types');
  if (btnManageTypes) {
    btnManageTypes.addEventListener('click', openManageBoardTypesModal);
  }
}

// Logika Terapkan Preset Acara
function applyEventPreset(presetType, durationDays) {
  const jenisAcaraInput = document.getElementById('form-jenis-acara');
  if (jenisAcaraInput) {
    if (presetType === 'pesta') jenisAcaraInput.value = 'Pesta / Pernikahan / Wisuda';
    else if (presetType === 'opening') jenisAcaraInput.value = 'Grand Opening / Peresmian Toko';
    else if (presetType === 'duka') jenisAcaraInput.value = 'Duka Cita / Rumah Duka';
    else if (presetType === 'kustom') jenisAcaraInput.value = 'Permintaan Khusus (Kustom)';
  }
  calculateTargetPickupDate(durationDays);
}

// Hitung Target Tanggal Jemput berdasarkan Tanggal Antar + Durasi
function calculateTargetPickupDate(durationDays) {
  const tglAntar = document.getElementById('form-tgl-antar').value || getTodayDateStr();
  const dateObj = new Date(tglAntar);
  dateObj.setDate(dateObj.getDate() + durationDays);

  const targetDateStr = dateObj.toISOString().split('T')[0];
  const targetTglInput = document.getElementById('form-target-tgl');
  if (targetTglInput) {
    targetTglInput.value = targetDateStr;
  }
  const targetJamInput = document.getElementById('form-target-jam');
  if (targetJamInput && !targetJamInput.value) {
    targetJamInput.value = '18:00';
  }
}

// Muat dan Render Seluruh Data
async function loadAndRenderDashboard() {
  try {
    appState.cachedBoards = await db.boards.toArray();
    renderDashboard();
  } catch (err) {
    console.error('[Load Dashboard Error]', err);
  }
}

// Render Dasbor & Statistik
function renderDashboard() {
  const boards = appState.cachedBoards || [];

  let countOverdue = 0;
  let countToday = 0;
  let countActive = 0;
  let countCompleted = 0;
  const overdueBoardsList = [];

  boards.forEach(b => {
    const statusInfo = calculateBoardStatus(b);
    if (statusInfo.status === 'OVERDUE') {
      countOverdue++;
      overdueBoardsList.push(b);
    } else if (statusInfo.status === 'TODAY') {
      countToday++;
    } else if (statusInfo.status === 'ACTIVE') {
      countActive++;
    } else if (statusInfo.status === 'SELESAI') {
      countCompleted++;
    }
  });

  // Perbarui Nilai Statistik UI
  const elOverdue = document.getElementById('stat-count-overdue');
  const elToday = document.getElementById('stat-count-today');
  const elActive = document.getElementById('stat-count-active');
  const elCompleted = document.getElementById('stat-count-completed');

  if (elOverdue) elOverdue.textContent = countOverdue;
  if (elToday) elToday.textContent = countToday;
  if (elActive) elActive.textContent = countActive;
  if (elCompleted) elCompleted.textContent = countCompleted;

  // Perbarui Tab Badges
  const badgeOverdue = document.getElementById('badge-tab-overdue');
  const badgeToday = document.getElementById('badge-tab-today');
  const badgeActive = document.getElementById('badge-tab-active');
  const badgeCompleted = document.getElementById('badge-tab-completed');
  const badgeAll = document.getElementById('badge-tab-all');

  if (badgeOverdue) badgeOverdue.textContent = countOverdue;
  if (badgeToday) badgeToday.textContent = countToday;
  if (badgeActive) badgeActive.textContent = countActive;
  if (badgeCompleted) badgeCompleted.textContent = countCompleted;
  if (badgeAll) badgeAll.textContent = boards.length;

  // Banner Peringatan Darurat Overdue
  const urgentBanner = document.getElementById('urgent-banner');
  const urgentText = document.getElementById('urgent-banner-text');
  if (urgentBanner) {
    if (countOverdue > 0) {
      urgentBanner.style.display = 'flex';
      if (urgentText) {
        urgentText.textContent = `Ada ${countOverdue} papan bunga yang telah melewati target batas jemput dan belum kembali ke toko!`;
      }
      // Bunyikan nada peringatan jika ada papan overdue saat pertama kali dibuka
      if (!appState.hasPlayedInitialChime) {
        NotificationManager.playChime(true);
        appState.hasPlayedInitialChime = true;
      }
    } else {
      urgentBanner.style.display = 'none';
    }
  }

  // Notifikasi dot di mobile bottom nav
  const dotOverdue = document.getElementById('nav-dot-overdue');
  if (dotOverdue) {
    dotOverdue.style.display = countOverdue > 0 ? 'block' : 'none';
  }

  renderBoardCards();
}

// Render Kartu-Kartu Papan Sesuai Tab & Filter
function renderBoardCards() {
  const container = document.getElementById('boards-container');
  if (!container) return;

  const boards = appState.cachedBoards || [];

  // Filter berdasarkan Tab
  let filtered = boards.filter(b => {
    const s = calculateBoardStatus(b);
    if (appState.activeTab === 'overdue') return s.status === 'OVERDUE';
    if (appState.activeTab === 'today') return s.status === 'TODAY';
    if (appState.activeTab === 'active') return s.status === 'ACTIVE';
    if (appState.activeTab === 'completed') return s.status === 'SELESAI';
    return true; // 'all'
  });

  // Filter berdasarkan Jenis Papan
  if (appState.filterJenis !== 'all') {
    filtered = filtered.filter(b => {
      const j = (b.jenis_papan || '').toLowerCase();
      if (appState.filterJenis === 'single') return j.includes('single') || j.includes('standar');
      if (appState.filterJenis === 'double') return j.includes('double') || j.includes('gandeng');
      if (appState.filterJenis === 'rustic') return j.includes('rustic') || j.includes('kayu') || j.includes('akrilik');
      return true;
    });
  }

  // Filter berdasarkan Kata Kunci Pencarian
  if (appState.searchQuery) {
    const q = appState.searchQuery;
    filtered = filtered.filter(b => {
      return (
        (b.no_nota && b.no_nota.toLowerCase().includes(q)) ||
        (b.nama_pemesan && b.nama_pemesan.toLowerCase().includes(q)) ||
        (b.lokasi && b.lokasi.toLowerCase().includes(q)) ||
        (b.ucapan && b.ucapan.toLowerCase().includes(q)) ||
        (b.jenis_papan && b.jenis_papan.toLowerCase().includes(q))
      );
    });
  }

  // Urutkan: Paling mendesak (overdue paling lama) berada paling atas
  filtered.sort((a, b) => {
    const statusA = calculateBoardStatus(a);
    const statusB = calculateBoardStatus(b);

    if (statusA.status === 'OVERDUE' && statusB.status !== 'OVERDUE') return -1;
    if (statusB.status === 'OVERDUE' && statusA.status !== 'OVERDUE') return 1;

    // Jika sama-sama overdue, bandingkan selisih keterlambatan
    if (statusA.status === 'OVERDUE' && statusB.status === 'OVERDUE') {
      return (statusB.diffHoursTotal || 0) - (statusA.diffHoursTotal || 0);
    }

    // Urutkan berdasarkan target jemput terdekat.
    // Papan tanpa target_tgl_jemput diurutkan berdasarkan tgl_antar + durasi default (bukan 9999)
    const getTargetTime = (board) => {
      if (board.target_tgl_jemput) {
        return new Date(`${board.target_tgl_jemput}T${board.target_jam_jemput || '18:00'}`).getTime();
      }
      // Fallback: pakai tgl_antar + 1 hari jika tidak ada target
      const base = new Date(board.tgl_antar || getTodayDateStr());
      base.setDate(base.getDate() + 1);
      return base.getTime();
    };
    return getTargetTime(a) - getTargetTime(b);
  });

  if (filtered.length === 0) {
    container.innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">${appState.activeTab === 'overdue' ? '🎉' : '📋'}</div>
        <div class="empty-title">${appState.activeTab === 'overdue' ? 'Alhamdulillah, Tidak Ada Papan yang Telat!' : 'Belum Ada Data Papan'}</div>
        <div class="empty-desc">${appState.activeTab === 'overdue' ? 'Semua papan di lapangan masih dalam masa sewa atau sudah dijemput tepat waktu.' : 'Tekan tombol "+ Catat Papan Antar" untuk menambahkan papan bunga baru.'}</div>
      </div>
    `;
    return;
  }

  container.innerHTML = filtered.map(board => createBoardCardHtml(board)).join('');
}

// Buat HTML Kartu Papan Bunga
function createBoardCardHtml(board) {
  const statusInfo = calculateBoardStatus(board);
  const mapsUrl = getMapsLink(board);
  const isCompleted = board.status_jemput === 'SELESAI';

  let cardClass = 'board-card';
  if (statusInfo.status === 'OVERDUE') cardClass += ' card-overdue';
  else if (statusInfo.status === 'TODAY') cardClass += ' card-today';
  else if (isCompleted) cardClass += ' card-completed';

  const safeNota = escapeHtml(board.no_nota || 'NOTA #' + board.id.slice(-4));
  const safePemesan = escapeHtml(board.nama_pemesan || 'Pemesan');
  const safeJenis = escapeHtml(board.jenis_papan || 'Papan Standar');
  const safeAcara = escapeHtml(board.jenis_acara || 'Acara');
  const safeLokasi = escapeHtml(board.lokasi || 'Lokasi belum diisi');
  const safeUcapan = board.ucapan ? escapeHtml(board.ucapan) : '';

  return `
    <div class="${cardClass}" id="card-${board.id}">
      <div class="card-top">
        <div style="display: flex; align-items: flex-start; gap: 10px; flex: 1;">
          ${(!isCompleted && appState.isMultiSelect) ? `
            <input type="checkbox" class="board-select-check" value="${board.id}" ${appState.selectedBoardIds.has(board.id) ? 'checked' : ''} onchange="toggleBoardSelect('${board.id}')" title="Pilih papan ini" />
          ` : ''}
          <div class="card-title-group">
            <div class="card-nota">🔖 ${safeNota}</div>
            <div class="card-pemesan">${safePemesan}</div>
            <div class="card-jenis-badge">🏷️ ${safeJenis}</div>
          </div>
        </div>
        <div>
          <span class="${statusInfo.badgeClass}">${statusInfo.label}</span>
        </div>
      </div>

      <div class="card-timeline">
        <div class="timeline-row">
          <span class="timeline-label">📤 Diantar (OUT):</span>
          <span class="timeline-val">${board.tgl_antar || '-'} ${board.jam_antar ? `• ${board.jam_antar} WIB` : ''}</span>
        </div>
        <div class="timeline-row">
          <span class="timeline-label">🎉 Acara:</span>
          <span class="timeline-val">${safeAcara}</span>
        </div>
        <div class="timeline-row">
          <span class="timeline-label">⏳ Batas Jemput:</span>
          <span class="timeline-val ${statusInfo.isOverdue ? 'highlight-red' : (statusInfo.isToday ? 'highlight-amber' : '')}">
            ${board.target_tgl_jemput || '-'} • ${board.target_jam_jemput ? `${board.target_jam_jemput} WIB` : '18:00 WIB'}
          </span>
        </div>
        ${isCompleted ? `
        <div class="timeline-row" style="color: #34d399; font-weight: bold;">
          <span class="timeline-label">📥 Dijemput (IN):</span>
          <span class="timeline-val">${board.tgl_jemput || '-'} ${board.jam_jemput ? `• ${board.jam_jemput} WIB` : ''} ${board.petugas_jemput ? `(${escapeHtml(board.petugas_jemput)})` : ''}</span>
        </div>` : ''}
      </div>

      <div class="card-meta">
        <div class="card-location">
          <span>📍</span>
          <span>${safeLokasi}</span>
        </div>
        ${safeUcapan ? `
        <div class="card-ucapan">
          💬 "${safeUcapan}"
        </div>` : ''}
        ${board.catatan ? `
        <div style="font-size:0.75rem; color:var(--text-dim); margin-top:2px;">
          📝 <b>Catatan:</b> ${escapeHtml(board.catatan)}
        </div>` : ''}
      </div>

      ${board.foto_antar ? `
      <div>
        <img src="${board.foto_antar}" alt="Foto Papan" class="card-photo-preview" onclick="viewFullImage('${board.foto_antar}')" title="Klik untuk perbesar foto" />
      </div>` : ''}

      <div class="card-actions">
        ${mapsUrl ? `
          <button class="btn-card btn-maps" onclick="window.open('${mapsUrl}', '_blank')" title="Navigasi Google Maps">
            📍 Maps
          </button>
        ` : `
          <button class="btn-card btn-maps" disabled style="opacity:0.4;">
            📍 No Maps
          </button>
        `}

        <button class="btn-card btn-wa-dispatch" onclick="handleSendWaTask('${board.id}')" title="Kirim Tugas Jemput ke WhatsApp">
          💬 WA Jemput
        </button>

        ${isCompleted ? `
          <button class="btn-card btn-checked" onclick="handleUndoCheckIn('${board.id}')" title="Batal Check IN jika keliru">
            ✅ Kembali
          </button>
        ` : `
          <button class="btn-card btn-checkin" onclick="quickCheckInCard('${board.id}')" title="Check IN langsung dengan waktu riil saat ini">
            📥 Check IN (Sekarang)
          </button>
          <button class="btn-card btn-secondary" onclick="openCheckInModal('${board.id}')" title="Buka form jika ingin atur jam/tanggal kustom" style="padding:6px; font-size:0.72rem;">
            ⚙️ Atur
          </button>
        `}
      </div>
    </div>
  `;
}

// Buka Modal Tambah Papan
function openBoardModal(board = null) {
  const modal = document.getElementById('modal-board');
  const title = document.getElementById('modal-board-title');
  const form = document.getElementById('form-board');

  form.reset();
  document.getElementById('form-board-id').value = board ? board.id : '';
  document.getElementById('form-gps-lat').value = board ? (board.gps_lat || '') : '';
  document.getElementById('form-gps-lng').value = board ? (board.gps_lng || '') : '';
  document.getElementById('form-photo-base64').value = board ? (board.foto_antar || '') : '';

  const photoPreviewWrap = document.getElementById('photo-preview-wrap');
  if (photoPreviewWrap) {
    if (board && board.foto_antar) {
      photoPreviewWrap.style.display = 'block';
      document.getElementById('photo-preview-img').src = board.foto_antar;
      document.getElementById('photo-upload-prompt').style.display = 'none';
    } else {
      photoPreviewWrap.style.display = 'none';
      document.getElementById('photo-upload-prompt').style.display = 'flex';
    }
  }

  if (board) {
    title.textContent = '✏️ Edit Papan Bunga';
    document.getElementById('form-no-nota').value = board.no_nota || '';
    document.getElementById('form-nama-pemesan').value = board.nama_pemesan || '';
    document.getElementById('form-no-wa').value = board.no_wa_pemesan || '';
    document.getElementById('form-jenis-papan').value = board.jenis_papan || 'Papan Standar (Single)';
    document.getElementById('form-jenis-acara').value = board.jenis_acara || 'Pesta / Pernikahan / Wisuda';
    document.getElementById('form-tgl-antar').value = board.tgl_antar || getTodayDateStr();
    
    const [antarH, antarM] = (board.jam_antar || '09:00').split(':');
    setTime24('form-jam-antar', antarH || '09', antarM || '00');

    document.getElementById('form-target-tgl').value = board.target_tgl_jemput || getTodayDateStr();
    
    const [targetH, targetM] = (board.target_jam_jemput || '18:00').split(':');
    setTime24('form-target-jam', targetH || '18', targetM || '00');

    document.getElementById('form-lokasi').value = board.lokasi || '';
    document.getElementById('form-ucapan').value = board.ucapan || '';
    document.getElementById('form-catatan').value = board.catatan || '';
  } else {
    title.textContent = '📤 Catat Papan Keluar (Check OUT)';
    document.getElementById('form-tgl-antar').value = getTodayDateStr();
    const now = new Date();
    const curH = String(now.getHours()).padStart(2, '0');
    setTime24('form-jam-antar', curH, '00');
    setTime24('form-target-jam', '18', '00');
    applyEventPreset('pesta', 1);
  }

  modal.classList.add('active');
}

function closeBoardModal() {
  document.getElementById('modal-board').classList.remove('active');
}

// Simpan Papan dari Form
async function handleSaveBoard(e) {
  e.preventDefault();

  const id = document.getElementById('form-board-id').value || ('B-' + Date.now());
  const noNota = document.getElementById('form-no-nota').value.trim();
  const namaPemesan = document.getElementById('form-nama-pemesan').value.trim();
  const noWa = document.getElementById('form-no-wa').value.trim();
  const jenisPapan = document.getElementById('form-jenis-papan').value;
  const jenisAcara = document.getElementById('form-jenis-acara').value;
  const tglAntar = document.getElementById('form-tgl-antar').value;
  const jamAntar = document.getElementById('form-jam-antar').value || '09:00';
  const targetTgl = document.getElementById('form-target-tgl').value;
  const targetJam = document.getElementById('form-target-jam').value || '18:00';
  const lokasi = document.getElementById('form-lokasi').value.trim();
  const ucapan = document.getElementById('form-ucapan').value.trim();
  const catatan = document.getElementById('form-catatan').value.trim();
  const photoBase64 = document.getElementById('form-photo-base64').value;
  const gpsLat = document.getElementById('form-gps-lat').value || null;
  const gpsLng = document.getElementById('form-gps-lng').value || null;

  const existing = await db.boards.get(id);

  const boardObj = {
    id: id,
    no_nota: noNota,
    nama_pemesan: namaPemesan,
    no_wa_pemesan: noWa,
    jenis_papan: jenisPapan,
    jenis_acara: jenisAcara,
    tgl_antar: tglAntar,
    jam_antar: jamAntar,
    target_tgl_jemput: targetTgl,
    target_jam_jemput: targetJam,
    lokasi: lokasi,
    ucapan: ucapan,
    catatan: catatan,
    foto_antar: photoBase64 || (existing ? existing.foto_antar : null),
    gps_lat: gpsLat ? parseFloat(gpsLat) : (existing ? existing.gps_lat : null),
    gps_lng: gpsLng ? parseFloat(gpsLng) : (existing ? existing.gps_lng : null),
    status_jemput: existing ? existing.status_jemput : 'BELUM',
    tgl_jemput: existing ? existing.tgl_jemput : null,
    jam_jemput: existing ? existing.jam_jemput : null,
    petugas_jemput: existing ? existing.petugas_jemput : null
  };

  const success = await saveBoardToCloud(boardObj);
  if (success) {
    showToast('✅ Data papan berhasil disimpan!', 'success');
    closeBoardModal();
    await loadAndRenderDashboard();
  } else {
    showToast('❌ Gagal menyimpan data papan.', 'error');
  }
}

// Rekam Titik GPS dari Form
async function handleCaptureGps() {
  const btn = document.getElementById('btn-capture-gps');
  btn.textContent = '⏳ Membaca Satelit GPS...';
  btn.disabled = true;

  const loc = await getCurrentLocationGPS();
  btn.disabled = false;

  if (loc) {
    document.getElementById('form-gps-lat').value = loc.lat;
    document.getElementById('form-gps-lng').value = loc.lng;
    btn.textContent = `📍 GPS Terkunci (${loc.lat.toFixed(5)}, ${loc.lng.toFixed(5)})`;
    btn.style.color = '#34d399';
    showToast('📍 Titik lokasi GPS berhasil direkam!', 'success');
  } else {
    btn.textContent = '📍 Rekam Titik GPS Pemasangan';
    showToast('⚠️ Gagal membaca GPS. Pastikan izin lokasi HP telah diizinkan.', 'warning');
  }
}

// Handler Pilih Foto & Auto Compress
async function handlePhotoSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  showToast('📸 Mengompres foto agar hemat kuota...', 'info');
  try {
    const compressed = await compressPhoto(file, 800, 0.65);
    if (compressed) {
      document.getElementById('form-photo-base64').value = compressed;
      document.getElementById('photo-preview-img').src = compressed;
      document.getElementById('photo-preview-wrap').style.display = 'block';
      document.getElementById('photo-upload-prompt').style.display = 'none';
      showToast('✅ Foto siap disimpan (~35 KB)!', 'success');
    }
  } catch (err) {
    showToast('❌ Gagal mengolah foto.', 'error');
  }
}

function removeSelectedPhoto(e) {
  e.stopPropagation();
  document.getElementById('form-photo-base64').value = '';
  document.getElementById('form-photo-input').value = '';
  document.getElementById('photo-preview-wrap').style.display = 'none';
  document.getElementById('photo-upload-prompt').style.display = 'flex';
}

// Modal Check IN (Tandai Sudah Dijemput)
let currentCheckInBoardId = null;

function openCheckInModal(boardId) {
  currentCheckInBoardId = boardId;
  const modal = document.getElementById('modal-checkin');
  const tglInput = document.getElementById('checkin-tgl');
  const petugasInput = document.getElementById('checkin-petugas');

  if (tglInput) tglInput.value = getTodayDateStr();
  
  // Waktu real-time detik ini secara presisi (tanpa pembulatan)
  const now = new Date();
  const curH = String(now.getHours()).padStart(2, '0');
  const curM = String(now.getMinutes()).padStart(2, '0');
  
  setTime24('checkin-jam', curH, curM);

  if (petugasInput && !petugasInput.value) {
    petugasInput.value = 'Saya Sendiri (Owner)';
  }

  modal.classList.add('active');
}

function closeCheckInModal() {
  document.getElementById('modal-checkin').classList.remove('active');
  currentCheckInBoardId = null;
}

// Eksekusi Konfirmasi Check IN
async function handleConfirmCheckIn() {
  if (!currentCheckInBoardId) return;

  const board = await db.boards.get(currentCheckInBoardId);
  if (!board) return;

  const tglJemput = document.getElementById('checkin-tgl').value || getTodayDateStr();
  const jamJemput = document.getElementById('checkin-jam').value || getCurrentTimeStr();
  const petugasJemput = document.getElementById('checkin-petugas').value.trim() || 'Driver';

  board.status_jemput = 'SELESAI';
  board.tgl_jemput = tglJemput;
  board.jam_jemput = jamJemput;
  board.petugas_jemput = petugasJemput;

  await saveBoardToCloud(board);
  NotificationManager.playChime(false); // Bunyikan nada sukses
  showToast(`📥 Papan #${board.no_nota || board.id} berhasil di-Check IN kembali ke toko!`, 'success');

  closeCheckInModal();
  await loadAndRenderDashboard();
}

// Batal Check IN (Undo)
async function handleUndoCheckIn(boardId) {
  if (!confirm('Kembalikan status papan ini menjadi "Belum Dijemput"?')) return;

  const board = await db.boards.get(boardId);
  if (!board) return;

  board.status_jemput = 'BELUM';
  board.tgl_jemput = null;
  board.jam_jemput = null;
  board.petugas_jemput = null;

  await saveBoardToCloud(board);
  showToast('Status papan dikembalikan menjadi Belum Dijemput.', 'info');
  await loadAndRenderDashboard();
}

// ─── Fitur Baru: Jam Berjalan Realtime & Check IN Sekaligus ───────────────────

// Live Clock Ticker setiap 1 detik
function startLiveClock() {
  const updateClock = () => {
    const now = new Date();
    const h = String(now.getHours()).padStart(2, '0');
    const m = String(now.getMinutes()).padStart(2, '0');
    const s = String(now.getSeconds()).padStart(2, '0');

    const fullClock = `${h}:${m}:${s} WIB`;
    const hmClock = `${h}:${m}`;

    const modalLive = document.getElementById('modal-live-clock-text');
    if (modalLive) modalLive.textContent = fullClock;

    const bulkLive = document.getElementById('bulk-live-time');
    if (bulkLive) bulkLive.textContent = hmClock;
  };

  updateClock();
  setInterval(updateClock, 1000);
}

// Set Waktu Modal Check IN langsung ke jam detik ini
function syncModalTimeToNow() {
  const now = new Date();
  const curH = String(now.getHours()).padStart(2, '0');
  const curM = String(now.getMinutes()).padStart(2, '0');
  setTime24('checkin-jam', curH, curM);
  showToast(`⏰ Jam Check IN diset ke waktu sekarang: ${curH}:${curM} WIB`, 'info');
}

// 1-Sentuhan Langsung Check IN dari Kartu Papan (Waktu Realtime Berjalan)
async function quickCheckInCard(boardId) {
  const board = await db.boards.get(boardId);
  if (!board) return;

  const now = new Date();
  const tglJemput = getTodayDateStr();
  const jamJemput = getCurrentTimeStr();

  board.status_jemput = 'SELESAI';
  board.tgl_jemput = tglJemput;
  board.jam_jemput = jamJemput;
  board.petugas_jemput = 'Saya Sendiri (Owner)';

  await saveBoardToCloud(board);
  NotificationManager.playChime(false);
  showToast(`📥 Papan #${board.no_nota || board.id} berhasil di-Check IN pada ${jamJemput} WIB!`, 'success');
  await loadAndRenderDashboard();
}

// Check IN SEMUA Papan Sekaligus berdasarkan Kategori (misal 'overdue' / Telat)
async function handleBulkCheckIn(filterType = 'overdue') {
  const allBoards = await db.boards.toArray();
  const targets = allBoards.filter(b => {
    if (b.status_jemput === 'SELESAI') return false;
    const s = calculateBoardStatus(b);
    if (filterType === 'overdue') return s.status === 'OVERDUE';
    if (filterType === 'today') return s.status === 'TODAY';
    return true;
  });

  if (targets.length === 0) {
    alert('Tidak ada papan yang perlu di-Check IN untuk kategori ini.');
    return;
  }

  const nowTime = getCurrentTimeStr();
  const confirmMsg = `Konfirmasi Check IN SEKALIGUS ${targets.length} papan bunga?\n\n• Waktu Check IN: Hari Ini, ${nowTime} WIB (Waktu Riil)\n• Petugas: Saya Sendiri (Owner)\n\nSemua papan telat ini akan ditandai sudah kembali ke toko. Lanjutkan?`;
  
  if (!confirm(confirmMsg)) return;

  const tglJemput = getTodayDateStr();
  for (const b of targets) {
    b.status_jemput = 'SELESAI';
    b.tgl_jemput = tglJemput;
    b.jam_jemput = nowTime;
    b.petugas_jemput = 'Saya Sendiri (Owner)';
    await saveBoardToCloud(b);
  }

  NotificationManager.playChime(false);
  showToast(`✅ ${targets.length} papan telat berhasil di-Check IN serentak pada ${nowTime} WIB!`, 'success');
  await loadAndRenderDashboard();
}

// Toggle Mode Pilih Banyak (Multi-Select Checkboxes)
function toggleMultiSelectMode() {
  appState.isMultiSelect = !appState.isMultiSelect;
  if (!appState.isMultiSelect) {
    appState.selectedBoardIds.clear();
  }
  const btnToggle = document.getElementById('btn-toggle-select');
  if (btnToggle) {
    btnToggle.textContent = appState.isMultiSelect ? '✕ Tutup Pilihan' : '☑️ Pilih Sekaligus';
    btnToggle.classList.toggle('active', appState.isMultiSelect);
  }
  updateBulkBarUI();
  renderBoardCards();
}

// Toggle checklist kartu individual
function toggleBoardSelect(boardId) {
  if (appState.selectedBoardIds.has(boardId)) {
    appState.selectedBoardIds.delete(boardId);
  } else {
    appState.selectedBoardIds.add(boardId);
  }
  updateBulkBarUI();
}

// Pilih Semua Papan yang Sedang Tampil di Layar
function toggleSelectAllVisible() {
  const visibleCheckboxes = document.querySelectorAll('.board-select-check');
  const allChecked = Array.from(visibleCheckboxes).every(cb => cb.checked);

  visibleCheckboxes.forEach(cb => {
    cb.checked = !allChecked;
    if (!allChecked) {
      appState.selectedBoardIds.add(cb.value);
    } else {
      appState.selectedBoardIds.delete(cb.value);
    }
  });

  const btnAll = document.getElementById('btn-select-all-text');
  if (btnAll) {
    btnAll.textContent = allChecked ? 'Pilih Semua' : 'Batal Semua';
  }
  updateBulkBarUI();
}

// Batalkan Pilihan Multi-Select
function cancelMultiSelect() {
  appState.isMultiSelect = false;
  appState.selectedBoardIds.clear();
  const btnToggle = document.getElementById('btn-toggle-select');
  if (btnToggle) {
    btnToggle.textContent = '☑️ Pilih Sekaligus';
    btnToggle.classList.remove('active');
  }
  updateBulkBarUI();
  renderBoardCards();
}

// Perbarui Tampilan Floating Bar Multi-Select
function updateBulkBarUI() {
  const bar = document.getElementById('bulk-action-bar');
  const countText = document.getElementById('bulk-count-text');
  if (!bar || !countText) return;

  const count = appState.selectedBoardIds.size;
  if (appState.isMultiSelect && count > 0) {
    bar.style.display = 'flex';
    countText.textContent = `${count} Papan`;
  } else {
    bar.style.display = 'none';
  }
}

// Eksekusi Check IN untuk Seluruh Papan yang Dicentang
async function handleExecuteBulkCheckIn() {
  if (appState.selectedBoardIds.size === 0) {
    showToast('Pilih minimal 1 papan untuk di-Check IN.', 'warning');
    return;
  }

  const count = appState.selectedBoardIds.size;
  const nowTime = getCurrentTimeStr();
  const confirmMsg = `Check IN ${count} papan terpilih sekaligus pada jam ${nowTime} WIB?`;
  if (!confirm(confirmMsg)) return;

  const tglJemput = getTodayDateStr();
  for (const id of appState.selectedBoardIds) {
    const b = await db.boards.get(id);
    if (b) {
      b.status_jemput = 'SELESAI';
      b.tgl_jemput = tglJemput;
      b.jam_jemput = nowTime;
      b.petugas_jemput = 'Saya Sendiri (Owner)';
      await saveBoardToCloud(b);
    }
  }

  NotificationManager.playChime(false);
  showToast(`✅ ${count} papan berhasil di-Check IN serentak pada ${nowTime} WIB!`, 'success');
  cancelMultiSelect();
  await loadAndRenderDashboard();
}

// Kirim Tugas Jemput via WhatsApp
function handleSendWaTask(boardId) {
  const board = appState.cachedBoards.find(b => b.id === boardId);
  if (!board) return;

  const targetWa = board.no_wa_pemesan || '';
  const waUrl = NotificationManager.getWaTaskUrl(board, targetWa);
  window.open(waUrl, '_blank');
}

// Kirim Rekap Papan Overdue Hari Ini ke WhatsApp
function handleWaOverdueSummary() {
  const overdueList = (appState.cachedBoards || []).filter(b => {
    const s = calculateBoardStatus(b);
    return s.status === 'OVERDUE';
  });

  if (overdueList.length === 0) {
    alert('Tidak ada papan yang telat / overdue saat ini. Luar biasa!');
    return;
  }

  const phonePrompt = prompt('Masukkan nomor WhatsApp tujuan (Kosongkan jika ingin memilih kontak langsung di WhatsApp):', '');
  const url = NotificationManager.getWaOverdueSummaryUrl(overdueList, phonePrompt);
  window.open(url, '_blank');
}

// Impor dari Finance Akio
async function handleImportFinance() {
  const btn = document.getElementById('btn-import-finance');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Membaca Cloud Finance...';
  }

  try {
    const result = await importFromAkioFinancePesanan();
    alert(result.message);
    await loadAndRenderDashboard();
  } catch (e) {
    alert('Gagal mengimpor dari Finance: ' + e.message);
  } finally {
    if (btn) {
      btn.disabled = false;
      btn.textContent = '📥 Impor dari Pesanan Finance';
    }
  }
}

// ─── Modal Kelola Tipe Papan (dari Database) ───────────────────────────────

function openManageBoardTypesModal() {
  const modal = document.getElementById('modal-manage-types');
  if (!modal) return;
  modal.classList.add('active');
  renderManageBoardTypesList();
}

function closeManageBoardTypesModal() {
  const modal = document.getElementById('modal-manage-types');
  if (modal) modal.classList.remove('active');
}

async function renderManageBoardTypesList() {
  const listEl = document.getElementById('manage-types-list');
  if (!listEl) return;

  const types = await getBoardTypes();

  if (types.length === 0) {
    listEl.innerHTML = `<div style="color:var(--text-dim); text-align:center; padding: 20px; font-size:0.85rem;">
      Belum ada tipe papan. Tambahkan di bawah atau klik Reset Default.
    </div>`;
    return;
  }

  listEl.innerHTML = types.map(t => `
    <div class="type-item" id="type-item-${t.id}">
      <span class="type-item-name" id="type-name-${t.id}">${escapeHtml(t.nama)}</span>
      <div class="type-item-actions">
        <button class="btn-type-edit" onclick="handleStartRenameBoardType(${t.id})" title="Ubah nama tipe ini">✏️</button>
        <button class="btn-type-delete" onclick="handleDeleteBoardType(${t.id}, '${escapeHtml(t.nama)}')" title="Hapus tipe ini">🗑️</button>
      </div>
    </div>
  `).join('');
}

async function handleAddBoardType() {
  const input = document.getElementById('input-new-board-type');
  if (!input) return;
  const nama = input.value.trim();
  if (!nama) {
    showToast('⚠️ Nama tipe papan tidak boleh kosong.', 'warning');
    return;
  }

  const id = await addBoardType(nama);
  if (id === null) {
    showToast(`⚠️ Tipe "${nama}" sudah ada dalam daftar.`, 'warning');
    return;
  }

  input.value = '';
  showToast(`✅ Tipe "${nama}" berhasil ditambahkan!`, 'success');
  // Sinkronisasi ke Firebase
  const updatedTypes = await getBoardTypes();
  await saveBoardTypesToCloud(updatedTypes);
  await refreshBoardTypesDatalist();
  renderManageBoardTypesList();
}

async function handleDeleteBoardType(id, nama) {
  if (!confirm(`Hapus tipe papan "${nama}"?\n\nData papan yang sudah menggunakan tipe ini tidak akan terpengaruh.`)) return;

  await deleteBoardType(id);
  showToast(`🗑️ Tipe "${nama}" dihapus.`, 'info');
  const updatedTypes = await getBoardTypes();
  await saveBoardTypesToCloud(updatedTypes);
  await refreshBoardTypesDatalist();
  renderManageBoardTypesList();
}

async function handleStartRenameBoardType(id) {
  const nameEl = document.getElementById(`type-name-${id}`);
  if (!nameEl) return;

  const currentName = nameEl.textContent;
  const newName = prompt(`Ubah nama tipe papan:\n\n"${currentName}"\n\nNama baru:`, currentName);
  if (!newName || newName.trim() === '' || newName.trim() === currentName) return;

  const ok = await renameBoardType(id, newName.trim());
  if (ok) {
    showToast(`✅ Nama tipe diubah menjadi "${newName.trim()}".`, 'success');
    const updatedTypes = await getBoardTypes();
    await saveBoardTypesToCloud(updatedTypes);
    await refreshBoardTypesDatalist();
    renderManageBoardTypesList();
  } else {
    showToast('❌ Gagal mengubah nama tipe.', 'error');
  }
}

async function handleResetBoardTypes() {
  if (!confirm('Reset semua tipe papan kembali ke daftar default bawaan?\n\nSeluruh tipe papan kustom Anda akan dihapus.')) return;

  await resetBoardTypesToDefault();
  showToast('🔄 Tipe papan direset ke default.', 'info');
  const updatedTypes = await getBoardTypes();
  await saveBoardTypesToCloud(updatedTypes);
  await refreshBoardTypesDatalist();
  renderManageBoardTypesList();
}

// Modal Pengaturan
function openSettingsModal() {
  const modal = document.getElementById('modal-settings');
  const inputPin = document.getElementById('setting-pin');
  if (inputPin) {
    inputPin.value = currentStorePin;
  }
  modal.classList.add('active');
}

function closeSettingsModal() {
  document.getElementById('modal-settings').classList.remove('active');
}

function handleSaveSettings() {
  const inputPin = document.getElementById('setting-pin');
  if (inputPin && inputPin.value.trim()) {
    const newPin = inputPin.value.trim().toUpperCase();
    localStorage.setItem('inout_store_pin', newPin);
    currentStorePin = newPin;
    initFirebaseSync();
    showToast(`✅ PIN Cloud diperbarui: ${newPin}`, 'success');
  }
  closeSettingsModal();
}

// Lihat Gambar Penuh
function viewFullImage(src) {
  const modal = document.getElementById('modal-image-view');
  const img = document.getElementById('image-full-display');
  if (modal && img) {
    img.src = src;
    modal.classList.add('active');
  }
}

function closeImageViewModal() {
  const modal = document.getElementById('modal-image-view');
  if (modal) modal.classList.remove('active');
}

// Toast Notification
function showToast(message, type = 'info') {
  const container = document.getElementById('toast-container');
  if (!container) return;

  const toast = document.createElement('div');
  toast.className = `toast ${type === 'error' ? 'toast-error' : (type === 'warning' ? 'toast-warning' : '')}`;
  toast.textContent = message;

  container.appendChild(toast);

  setTimeout(() => {
    toast.style.opacity = '0';
    toast.style.transform = 'translateY(10px)';
    toast.style.transition = 'all 0.3s';
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

// Helper Escape HTML
function escapeHtml(str) {
  if (!str) return '';
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
