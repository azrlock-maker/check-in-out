// Check IN/OUT Florist - Firebase Realtime Synchronization Manager
// Menghubungkan Laptop dan HP secara instan (< 1 detik) melalui Cloud Realtime DB
// Jalur Cloud Aman: stores/{PIN}/check_in_out/ (Terisolasi dari data Finance)

const DEFAULT_STORE_PIN = 'AKIOFLORIST';
const DEFAULT_FIREBASE_CONFIG = {
  databaseURL: "https://akio-florist-finance-default-rtdb.asia-southeast1.firebasedatabase.app"
};

let firebaseDb = null;
let currentStorePin = localStorage.getItem('inout_store_pin') || DEFAULT_STORE_PIN;
let isPullingFromCloud = false;

const syncState = {
  isOnline: navigator.onLine,
  isConnected: false,
  lastSyncTime: localStorage.getItem('inout_last_sync') || null,
  activeConnectionsCount: 0
};

// Inisialisasi Firebase
function initFirebaseSync() {
  if (typeof firebase === 'undefined') {
    console.warn('[Realtime Sync] SDK Firebase belum dimuat.');
    updateSyncUI();
    return;
  }

  try {
    const customUrl = localStorage.getItem('custom_firebase_url');
    const config = customUrl ? { databaseURL: customUrl } : DEFAULT_FIREBASE_CONFIG;

    if (!firebase.apps.length) {
      firebase.initializeApp(config);
    } else {
      const currentUrl = firebase.app().options.databaseURL;
      if (currentUrl !== config.databaseURL) {
        firebase.app().delete();
        firebase.initializeApp(config);
      }
    }

    firebaseDb = firebase.database();
    currentStorePin = localStorage.getItem('inout_store_pin') || DEFAULT_STORE_PIN;

    // Monitor status koneksi real-time
    const connectedRef = firebaseDb.ref('.info/connected');
    connectedRef.on('value', (snap) => {
      syncState.isConnected = snap.val() === true;
      updateSyncUI();
      if (syncState.isConnected) {
        console.log(`[Realtime Sync] Terhubung ke Cloud DB (PIN: ${currentStorePin})`);
      }
    });

    attachCloudListeners();
  } catch (err) {
    console.error('[Firebase Init Error]', err);
    updateSyncUI();
  }
}

// Pasang Listener Realtime untuk mendengarkan perubahan dari HP / Laptop lain
function attachCloudListeners() {
  if (!firebaseDb) return;

  const boardsRef = firebaseDb.ref(`stores/${currentStorePin}/check_in_out/boards`);

  boardsRef.on('value', async (snapshot) => {
    const cloudBoardsObj = snapshot.val();
    if (!cloudBoardsObj || isPullingFromCloud) return;

    try {
      isPullingFromCloud = true;
      const cloudBoardsList = Object.values(cloudBoardsObj);
      const cloudIdSet = new Set(cloudBoardsList.map(b => String(b.id)));

      let hasChanges = false;

      // 1. Perbarui / masukkan data dari cloud ke IndexedDB lokal
      for (const cb of cloudBoardsList) {
        if (!cb || !cb.id) continue;
        const localB = await db.boards.get(cb.id);
        if (!localB || JSON.stringify(localB) !== JSON.stringify(cb)) {
          await db.boards.put(cb);
          hasChanges = true;
        }
      }

      // 2. Jika ada data yang dihapus di cloud, hapus juga di lokal
      const allLocalBoards = await db.boards.toArray();
      for (const lb of allLocalBoards) {
        if (lb.id && !cloudIdSet.has(String(lb.id))) {
          await db.boards.delete(lb.id);
          hasChanges = true;
        }
      }

      if (hasChanges) {
        const nowTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
        syncState.lastSyncTime = nowTime;
        localStorage.setItem('inout_last_sync', nowTime);
        updateSyncUI();

        if (typeof renderDashboard === 'function') {
          renderDashboard();
        }

        // Cek apakah ada notifikasi darurat keterlambatan baru
        if (typeof checkAndNotifyOverdue === 'function') {
          checkAndNotifyOverdue();
        }
      }
    } catch (e) {
      console.error('[Realtime Sync Pull Error]', e);
    } finally {
      setTimeout(() => { isPullingFromCloud = false; }, 300);
    }
  });

  // Listener realtime untuk tipe papan (board_types)
  const typesRef = firebaseDb.ref(`stores/${currentStorePin}/check_in_out/board_types`);
  typesRef.on('value', async (snapshot) => {
    const cloudTypes = snapshot.val();
    if (!cloudTypes) return;
    try {
      const typesList = Object.values(cloudTypes).filter(t => t && t.nama);
      await db.board_types.clear();
      await db.board_types.bulkAdd(typesList);
      // Perbarui datalist di form jika sedang terbuka
      if (typeof refreshBoardTypesDatalist === 'function') {
        await refreshBoardTypesDatalist();
      }
    } catch (e) {
      console.error('[Board Types Sync Pull Error]', e);
    }
  });

  // 3. Listener Realtime Otomatis: Pantau Pesanan dari Finance Akio (Auto-Sync < 1 detik)
  attachFinanceAutoSyncListener();
}

// Simpan atau Perbarui Data Papan ke Cloud & IndexedDB
async function saveBoardToCloud(board) {
  try {
    board.updated_at = new Date().toISOString();
    if (!board.created_at) board.created_at = board.updated_at;

    // 1. Simpan ke IndexedDB lokal (Offline-First)
    await db.boards.put(board);

    // 2. Simpan ke Firebase Realtime DB jika terhubung
    if (firebaseDb && syncState.isConnected) {
      const boardRef = firebaseDb.ref(`stores/${currentStorePin}/check_in_out/boards/${board.id}`);
      await boardRef.set(board);
    }

    const nowTime = new Date().toLocaleTimeString('id-ID', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    syncState.lastSyncTime = nowTime;
    localStorage.setItem('inout_last_sync', nowTime);
    updateSyncUI();

    return true;
  } catch (err) {
    console.error('[Save Board Error]', err);
    return false;
  }
}

// Hapus Papan dari Cloud & IndexedDB
async function deleteBoardFromCloud(boardId) {
  try {
    await db.boards.delete(boardId);
    if (firebaseDb && syncState.isConnected) {
      const boardRef = firebaseDb.ref(`stores/${currentStorePin}/check_in_out/boards/${boardId}`);
      await boardRef.remove();
    }
    return true;
  } catch (err) {
    console.error('[Delete Board Error]', err);
    return false;
  }
}

// Simpan semua tipe papan ke Firebase Cloud (sync Laptop ⇄ HP)
async function saveBoardTypesToCloud(types) {
  if (!firebaseDb || !syncState.isConnected) return;
  try {
    const typesObj = {};
    types.forEach((t, i) => {
      typesObj[`type_${t.id || i}`] = { id: t.id, nama: t.nama, urutan: t.urutan || i + 1, created_at: t.created_at || new Date().toISOString() };
    });
    const typesRef = firebaseDb.ref(`stores/${currentStorePin}/check_in_out/board_types`);
    await typesRef.set(typesObj);
  } catch (err) {
    console.error('[Save Board Types Error]', err);
  }
}

// Helper: Cek apakah status pesanan Finance adalah sedang diantar
function isOrderAntar(status) {
  if (!status) return false;
  const s = String(status).trim().toLowerCase();
  return (
    s === 'papan di antar' ||
    s === 'papan diantar' ||
    s === 'antar' ||
    s === 'diantar' ||
    s === 'siap diantar' ||
    s.includes('di antar') ||
    s.includes('diantar') ||
    s.includes('antar')
  );
}

let isSyncingFinanceOrders = false;

// ─── Listener Realtime Otomatis dari Database Finance (< 1 Detik) ────────────
// Berjalan di latar belakang: ketika Finance mengubah status pesanan menjadi "Papan Di Antar",
// data otomatis masuk ke IN OUT Florist secara instan tanpa perlu klik tombol impor!
function attachFinanceAutoSyncListener() {
  if (!firebaseDb) return;

  const financePesananRef = firebaseDb.ref(`stores/${currentStorePin}/pesanan`);

  financePesananRef.on('value', async (snapshot) => {
    const financeData = snapshot.val();
    if (!financeData || isSyncingFinanceOrders) return;

    try {
      isSyncingFinanceOrders = true;
      const res = await processFinanceOrders(financeData, true /* isAuto */);

      if (res && res.importedCount > 0) {
        console.log(`[Finance Auto-Sync] ✅ ${res.importedCount} papan baru otomatis diterima dari Finance.`);
        if (typeof showToast === 'function') {
          showToast(`📥 ${res.importedCount} Papan baru otomatis masuk dari Finance!`, 'success');
        }
        if (typeof NotificationManager !== 'undefined' && NotificationManager.playChime) {
          NotificationManager.playChime(false);
        }
        if (typeof loadAndRenderDashboard === 'function') {
          await loadAndRenderDashboard();
        }
      } else if (res && res.updatedCount > 0) {
        if (typeof loadAndRenderDashboard === 'function') {
          await loadAndRenderDashboard();
        }
      }
    } catch (e) {
      console.warn('[Finance Auto-Sync Error]', e);
    } finally {
      setTimeout(() => { isSyncingFinanceOrders = false; }, 400);
    }
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// Proses Penyelarasan Pesanan Finance (Dipakai Bersama: Auto-Sync & Manual Impor)
// 100% Aman & Read-Only: Hanya membaca data pesanan Finance tanpa mengubah datanya
//
// PERLINDUNGAN 3 LAPIS agar papan SELESAI tidak pernah muncul ulang di tab Telat:
//   Lapis 1: localStorage blacklist (tanpa akses DB sama sekali, tercepat)
//   Lapis 2: Pencocokan berlapis (finance_id → ID papan → nota fuzzy → nota mentah)
//   Lapis 3: Cek status_jemput === 'SELESAI' + tambah ke blacklist jika ditemukan
// ─────────────────────────────────────────────────────────────────────────────
async function processFinanceOrders(financeData, isAuto = false) {
  if (!financeData) {
    return { count: 0, importedCount: 0, updatedCount: 0, message: 'Tidak ditemukan data pesanan di Finance.' };
  }

  const orders = Object.values(financeData).filter(o => o && o.id);

  // Filter pesanan yang berstatus Antar / Papan Di Antar
  const antarOrders = orders.filter(o => isOrderAntar(o.status_proses));

  if (antarOrders.length === 0) {
    return {
      count: 0,
      importedCount: 0,
      updatedCount: 0,
      message: `Tidak ada pesanan berstatus "Papan Di Antar" di Finance saat ini.\nTotal pesanan di Finance: ${orders.length} pesanan.`
    };
  }

  // ── LAPIS 1: Muat Blacklist SELESAI dari localStorage ────────────────────────
  // Menyimpan ID pesanan Finance yang sudah pernah di-Check IN agar tidak diulang
  const FINISHED_KEY = 'inout_finished_finance_ids';
  let finishedIds = {};
  try { finishedIds = JSON.parse(localStorage.getItem(FINISHED_KEY) || '{}'); } catch (_) {}

  let importedCount = 0;
  let updatedCount = 0;

  for (const ord of antarOrders) {
    const ordIdStr = String(ord.id || '').trim();

    // ── CEK LAPIS 1: Blacklist localStorage (instant, tanpa akses DB) ──────────
    if (finishedIds[ordIdStr]) {
      // Sudah pernah Check IN sebelumnya → lewati sepenuhnya
      console.log(`[Finance Sync] ⏭️ Skip pesanan ${ordIdStr} (ada di blacklist SELESAI)`);
      continue;
    }

    // Tentukan jenis acara dari ucapan/tipe papan secara otomatis
    let detectedAcara = 'Pesta / Pernikahan';
    let durationDays = 1;
    const lowerUcapan = (ord.ucapan || '').toLowerCase();

    if (lowerUcapan.includes('duka') || lowerUcapan.includes('belasungkawa') ||
        lowerUcapan.includes('rip') || lowerUcapan.includes('meninggal') ||
        lowerUcapan.includes('berpulang') || lowerUcapan.includes('wafat')) {
      detectedAcara = 'Duka Cita / Rumah Duka';
      durationDays = 3;
    } else if (lowerUcapan.includes('opening') || lowerUcapan.includes('peresmian') ||
               lowerUcapan.includes('grand') || lowerUcapan.includes('buka') ||
               lowerUcapan.includes('launching')) {
      detectedAcara = 'Grand Opening / Peresmian Toko';
      durationDays = 2;
    } else if (lowerUcapan.includes('sukses') || lowerUcapan.includes('selamat') ||
               lowerUcapan.includes('pelantikan') || lowerUcapan.includes('sertijab') ||
               lowerUcapan.includes('wisuda') || lowerUcapan.includes('khatam') ||
               lowerUcapan.includes('tasyakuran') || lowerUcapan.includes('syukuran')) {
      detectedAcara = 'Selamat & Sukses / Acara';
      durationDays = 1;
    } else if (lowerUcapan.includes('wedding') || lowerUcapan.includes('nikah') ||
               lowerUcapan.includes('pernikahan') || lowerUcapan.includes('barakallah') ||
               lowerUcapan.includes('pengantin')) {
      detectedAcara = 'Pesta / Pernikahan';
      durationDays = 1;
    }

    const tglAntar = ord.tanggal_antar || ord.tanggal || getTodayDateStr();
    const tglAntarDate = new Date(tglAntar);
    const targetDate = new Date(tglAntarDate);
    targetDate.setDate(targetDate.getDate() + durationDays);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    // Hitung semua varian ID & nota untuk pencocokan berlapis
    const noNotaRaw = (ord.no_nota || '').trim();
    // Fuzzy: strip semua karakter non-alfanumerik, lowercase
    const noNotaFuzzy = noNotaRaw
      ? noNotaRaw.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
      : ordIdStr.toLowerCase();
    const boardId     = 'FIN-' + (noNotaRaw ? noNotaRaw.replace(/[^a-zA-Z0-9]/g, '') : ordIdStr);
    const boardIdLama = 'B-'   + (noNotaRaw ? noNotaRaw.replace(/[^a-zA-Z0-9]/g, '') : ordIdStr);
    const cleanNota   = noNotaRaw.toLowerCase();

    // ── CEK LAPIS 2: Cari papan yang cocok di IndexedDB ──────────────────────
    const allMatches = await db.boards.filter(b => {
      // Prioritas 1: finance_id — paling andal setelah import pertama (BARU)
      if (b.finance_id && b.finance_id === ordIdStr) return true;
      // Prioritas 2: ID papan format FIN- dan B-
      if (b.id === boardId || b.id === boardIdLama) return true;
      if (b.id === 'B-' + ordIdStr || b.id === 'FIN-' + ordIdStr) return true;
      // Prioritas 3: nota fuzzy (strip karakter khusus dari kedua sisi)
      const bNotaFuzzy = (b.no_nota || '').replace(/[^a-zA-Z0-9]/g, '').toLowerCase();
      if (noNotaFuzzy && bNotaFuzzy && bNotaFuzzy === noNotaFuzzy) return true;
      // Prioritas 4: nota mentah case-insensitive
      if (cleanNota && (b.no_nota || '').trim().toLowerCase() === cleanNota) return true;
      // Prioritas 5: ID Finance tersimpan sebagai no_nota (data lama)
      if (ordIdStr && (b.no_nota || '').trim() === ordIdStr) return true;
      return false;
    }).toArray();

    // ── CEK LAPIS 3: Status SELESAI + tambah ke blacklist ──────────────────────
    const isCompleted = allMatches.some(b => b.status_jemput === 'SELESAI');
    if (isCompleted) {
      // Catat ke blacklist localStorage → sinkronisasi berikutnya langsung skip tanpa akses DB
      finishedIds[ordIdStr] = new Date().toISOString();
      try { localStorage.setItem(FINISHED_KEY, JSON.stringify(finishedIds)); } catch (_) {}
      console.log(`[Finance Sync] ✅ Papan dari pesanan ${ordIdStr} sudah Check IN → ditambah ke blacklist.`);

      // Hapus duplikat yang belum SELESAI jika ada
      for (const b of allMatches) {
        if (b.status_jemput !== 'SELESAI') {
          await deleteBoardFromCloud(b.id);
        }
      }
      continue;
    }

    // Jika belum SELESAI, ambil data existing pertama dan hapus duplikat ekstra
    let existing = allMatches.length > 0 ? allMatches[0] : null;
    if (allMatches.length > 1) {
      for (let i = 1; i < allMatches.length; i++) {
        await deleteBoardFromCloud(allMatches[i].id);
      }
    }

    const finalBoardId = existing ? existing.id : boardId;

    const boardObj = {
      id: finalBoardId,
      finance_id: ordIdStr,                              // ← Simpan ID Finance (kunci pencocokan andal)
      no_nota: noNotaRaw || ordIdStr,
      nama_pemesan: ord.nama_pemesan || 'Tanpa Nama',
      no_wa_pemesan: ord.no_wa || '',
      jenis_papan: ord.jenis_papan || 'Papan Bunga',
      jenis_acara: detectedAcara,
      durasi_hari: durationDays,
      ucapan: ord.ucapan || '',
      lokasi: ord.lokasi_pengantaran || '',
      gps_lat: ord.gps_lat ? parseFloat(ord.gps_lat) : null,
      gps_lng: ord.gps_lng ? parseFloat(ord.gps_lng) : null,
      tgl_antar: tglAntar,
      jam_antar: ord.jam_antar || '09:00',
      target_tgl_jemput: existing ? (existing.target_tgl_jemput || targetDateStr) : targetDateStr,
      target_jam_jemput: existing ? (existing.target_jam_jemput || '18:00') : '18:00',
      status_jemput: existing ? existing.status_jemput : 'BELUM',
      foto_antar: existing ? existing.foto_antar : null,
      foto_jemput: null,
      petugas_antar: '',
      petugas_jemput: existing ? existing.petugas_jemput : '',
      tgl_jemput: existing ? existing.tgl_jemput : null,
      jam_jemput: existing ? existing.jam_jemput : null,
      catatan: existing ? existing.catatan : 'Tersinkron otomatis dari Pesanan Finance'
    };

    await saveBoardToCloud(boardObj);

    if (existing) {
      updatedCount++;
    } else {
      importedCount++;
    }
  }

  let msg = '';
  if (importedCount > 0 && updatedCount > 0) {
    msg = `✅ Sinkronisasi selesai!\n• ${importedCount} data baru ditambahkan\n• ${updatedCount} data yang sudah ada diperbarui\n\nTotal di Finance (Papan Di Antar): ${antarOrders.length}`;
  } else if (importedCount > 0) {
    msg = `✅ Berhasil menerima ${importedCount} data papan baru dari Finance!`;
  } else if (updatedCount > 0) {
    msg = `🔄 ${updatedCount} data papan sudah ada dan berhasil diperbarui dari Finance.`;
  } else {
    msg = `ℹ️ Semua ${antarOrders.length} papan dari Finance sudah ada di daftar dan sudah di-Check IN.`;
  }

  return { count: importedCount + updatedCount, importedCount, updatedCount, message: msg };
}

// Fitur Baca / Impor Manual dari Pesanan Finance Akio (Read-Only)
async function importFromAkioFinancePesanan() {
  if (!firebaseDb) {
    throw new Error('Koneksi database cloud belum siap. Pastikan terhubung ke internet.');
  }

  const financePesananRef = firebaseDb.ref(`stores/${currentStorePin}/pesanan`);
  const snap = await financePesananRef.once('value');
  const financeData = snap.val();

  return await processFinanceOrders(financeData, false /* isAuto = false */);
}

// Update tampilan badge status sinkronisasi di UI
function updateSyncUI() {
  const syncBadge = document.getElementById('sync-badge');
  const syncText = document.getElementById('sync-text');
  if (!syncBadge || !syncText) return;

  if (syncState.isConnected) {
    syncBadge.classList.remove('offline');
    syncText.textContent = `Online (PIN: ${currentStorePin})`;
    syncBadge.title = `Terhubung ke Cloud. Terakhir sinkron: ${syncState.lastSyncTime || '-'}`;
  } else {
    syncBadge.classList.add('offline');
    syncText.textContent = navigator.onLine ? 'Menghubungkan...' : 'Offline (Tersimpan Lokal)';
    syncBadge.title = 'Bekerja secara offline. Data tersimpan di memori perangkat dan akan tersinkronisasi otomatis saat online.';
  }
}

// ─── Dipanggil setiap kali papan di-Check IN (SELESAI) ───────────────────────
// Langsung tambahkan finance_id papan ini ke blacklist agar tidak pernah di-import ulang
function markFinanceOrderAsFinished(board) {
  if (!board) return;
  const finId = board.finance_id || '';
  if (!finId) return; // Papan tidak berasal dari Finance, tidak perlu blacklist
  try {
    const FINISHED_KEY = 'inout_finished_finance_ids';
    const finishedIds = JSON.parse(localStorage.getItem(FINISHED_KEY) || '{}');
    finishedIds[finId] = new Date().toISOString();
    localStorage.setItem(FINISHED_KEY, JSON.stringify(finishedIds));
    console.log(`[Finance Sync] 🔒 Pesanan Finance ${finId} ditandai SELESAI di blacklist.`);
  } catch (_) {}
}

// ─── Dipanggil saat UndoCheckIn ──────────────────────────────────────────────
// Hapus dari blacklist agar papan bisa di-import ulang dari Finance jika diperlukan
function unmarkFinanceOrderAsFinished(board) {
  if (!board) return;
  const finId = board.finance_id || '';
  if (!finId) return;
  try {
    const FINISHED_KEY = 'inout_finished_finance_ids';
    const finishedIds = JSON.parse(localStorage.getItem(FINISHED_KEY) || '{}');
    delete finishedIds[finId];
    localStorage.setItem(FINISHED_KEY, JSON.stringify(finishedIds));
    console.log(`[Finance Sync] 🔓 Pesanan Finance ${finId} dihapus dari blacklist (Undo Check IN).`);
  } catch (_) {}
}

// ─── Registrasi Awal (Startup) ────────────────────────────────────────────────
// Saat aplikasi pertama kali dibuka, daftarkan semua papan SELESAI yang sudah ada
// ke blacklist agar sinkronisasi berikutnya langsung skip tanpa perlu akses DB
async function seedFinishedBlacklist() {
  try {
    const FINISHED_KEY = 'inout_finished_finance_ids';
    const finishedIds = JSON.parse(localStorage.getItem(FINISHED_KEY) || '{}');
    const completedBoards = await db.boards.filter(b => b.status_jemput === 'SELESAI' && b.finance_id).toArray();
    let added = 0;
    for (const b of completedBoards) {
      if (!finishedIds[b.finance_id]) {
        finishedIds[b.finance_id] = b.tgl_jemput || new Date().toISOString();
        added++;
      }
    }
    if (added > 0) {
      localStorage.setItem(FINISHED_KEY, JSON.stringify(finishedIds));
      console.log(`[Finance Sync] 🌱 ${added} papan SELESAI didaftarkan ke blacklist saat startup.`);
    }
  } catch (_) {}
}

window.addEventListener('online', () => {
  syncState.isOnline = true;
  updateSyncUI();
});

window.addEventListener('offline', () => {
  syncState.isOnline = false;
  syncState.isConnected = false;
  updateSyncUI();
});

