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

// Fitur Baca / Impor Aman dari Pesanan Finance Akio (Read-Only)
// 100% Aman: Hanya menyalin data papan yang sedang 'Papan Di Antar' tanpa mengubah database Finance
async function importFromAkioFinancePesanan() {
  if (!firebaseDb) {
    throw new Error('Koneksi database cloud belum siap. Pastikan terhubung ke internet.');
  }

  // Baca dari node pesanan Finance (jalur: stores/{PIN}/pesanan)
  const financePesananRef = firebaseDb.ref(`stores/${currentStorePin}/pesanan`);
  const snap = await financePesananRef.once('value');
  const financeData = snap.val();

  if (!financeData) {
    return { count: 0, message: `Tidak ditemukan data pesanan di aplikasi Finance.\n\nPastikan:\n• PIN Cloud sama dengan PIN di Finance (sekarang: ${currentStorePin})\n• Aplikasi Finance sudah pernah disinkronkan ke cloud` };
  }

  const orders = Object.values(financeData).filter(o => o && o.id);

  // Filter hanya pesanan yang berstatus 'Papan Di Antar' (belum dijemput kembali)
  const antarOrders = orders.filter(o => o.status_proses === 'Papan Di Antar');

  if (antarOrders.length === 0) {
    return {
      count: 0,
      message: `Tidak ada pesanan berstatus "Papan Di Antar" di Finance saat ini.\n\nTotal pesanan di Finance: ${orders.length} pesanan.\nImpor hanya dilakukan untuk papan yang sudah diantar dan belum dijemput.`
    };
  }

  let importedCount = 0;
  let updatedCount = 0;

  for (const ord of antarOrders) {
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
    }

    // Gunakan field name yang tepat sesuai skema Finance DB:
    // tanggal_antar, no_wa (bukan no_wa_pemesan), lokasi_pengantaran
    const tglAntar = ord.tanggal_antar || ord.tanggal || getTodayDateStr();
    const tglAntarDate = new Date(tglAntar);
    const targetDate = new Date(tglAntarDate);
    targetDate.setDate(targetDate.getDate() + durationDays);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    // ID unik berdasarkan no_nota / ID Finance agar konsisten
    const noNotaClean = ord.no_nota ? ord.no_nota.replace(/[^a-zA-Z0-9]/g, '') : String(ord.id);
    const boardId = 'FIN-' + noNotaClean;
    const boardIdLama = 'B-' + noNotaClean;
    const ordIdStr = String(ord.id || '').trim();
    const cleanNota = (ord.no_nota || '').trim().toLowerCase();

    // ─── Cek SEMUA data yang cocok di database (ID baru, ID lama, no_nota) ───
    const allMatches = await db.boards.filter(b => {
      if (b.id === boardId || b.id === boardIdLama) return true;
      if (b.id === 'B-' + ordIdStr || b.id === 'FIN-' + ordIdStr) return true;
      if (cleanNota && (b.no_nota || '').trim().toLowerCase() === cleanNota) return true;
      if (ordIdStr && (b.no_nota || '').trim() === ordIdStr) return true;
      return false;
    }).toArray();

    // Jika SALAH SATU papan yang cocok sudah di-Check IN (SELESAI) → SKIP!
    // Papan ini sudah diambil oleh tim florist.
    const isCompleted = allMatches.some(b => b.status_jemput === 'SELESAI');
    if (isCompleted) {
      // Bersihkan data duplikat 'BELUM' jika sempat terbuat akibat bug impor sebelumnya
      for (const b of allMatches) {
        if (b.status_jemput !== 'SELESAI') {
          await deleteBoardFromCloud(b.id);
        }
      }
      continue;
    }

    // Jika belum SELESAI, ambil data existing pertama dan hapus duplikat ekstra jika ada
    let existing = allMatches.length > 0 ? allMatches[0] : null;
    if (allMatches.length > 1) {
      for (let i = 1; i < allMatches.length; i++) {
        await deleteBoardFromCloud(allMatches[i].id);
      }
    }

    // Gunakan ID yang sudah ada jika ketemu (supaya tidak buat entri baru)
    const finalBoardId = existing ? existing.id : boardId;

    const boardObj = {
      id: finalBoardId,
      no_nota: ord.no_nota || String(ord.id),
      nama_pemesan: ord.nama_pemesan || 'Tanpa Nama',
      no_wa_pemesan: ord.no_wa || '',                    // field 'no_wa' di Finance
      jenis_papan: ord.jenis_papan || 'Papan Bunga',
      jenis_acara: detectedAcara,
      durasi_hari: durationDays,
      ucapan: ord.ucapan || '',
      lokasi: ord.lokasi_pengantaran || '',               // field 'lokasi_pengantaran' di Finance
      gps_lat: ord.gps_lat ? parseFloat(ord.gps_lat) : null,
      gps_lng: ord.gps_lng ? parseFloat(ord.gps_lng) : null,
      tgl_antar: tglAntar,
      jam_antar: ord.jam_antar || '09:00',
      // Pertahankan target jemput yang sudah diatur manual oleh user, jika sudah ada
      target_tgl_jemput: existing ? (existing.target_tgl_jemput || targetDateStr) : targetDateStr,
      target_jam_jemput: existing ? (existing.target_jam_jemput || '18:00') : '18:00',
      // Pertahankan status & data check-in yang sudah ada
      status_jemput: existing ? existing.status_jemput : 'BELUM',
      foto_antar: existing ? existing.foto_antar : null,
      foto_jemput: null,
      petugas_antar: '',
      petugas_jemput: existing ? existing.petugas_jemput : '',
      tgl_jemput: existing ? existing.tgl_jemput : null,
      jam_jemput: existing ? existing.jam_jemput : null,
      catatan: existing ? existing.catatan : 'Diimpor otomatis dari Pesanan Finance'
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
    msg = `✅ Impor selesai!\n• ${importedCount} data baru ditambahkan\n• ${updatedCount} data yang sudah ada diperbarui\n\nTotal di Finance (Papan Di Antar): ${antarOrders.length}`;
  } else if (importedCount > 0) {
    msg = `✅ Berhasil mengimpor ${importedCount} data papan baru dari Finance!`;
  } else if (updatedCount > 0) {
    msg = `🔄 ${updatedCount} data papan sudah ada dan berhasil diperbarui dari Finance.`;
  } else {
    msg = `ℹ️ Semua ${antarOrders.length} papan dari Finance sudah ada di daftar dan sudah di-Check IN. Tidak ada yang perlu diperbarui.`;
  }

  return { count: importedCount + updatedCount, message: msg };
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

window.addEventListener('online', () => {
  syncState.isOnline = true;
  updateSyncUI();
});

window.addEventListener('offline', () => {
  syncState.isOnline = false;
  syncState.isConnected = false;
  updateSyncUI();
});
