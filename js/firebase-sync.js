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
    throw new Error('Koneksi database cloud belum siap.');
  }

  const financePesananRef = firebaseDb.ref(`stores/${currentStorePin}/pesanan`);
  const snap = await financePesananRef.once('value');
  const financeData = snap.val();

  if (!financeData) {
    return { count: 0, message: 'Tidak ditemukan data pesanan di aplikasi Finance untuk PIN ini.' };
  }

  const orders = Object.values(financeData);
  let importedCount = 0;

  for (const ord of orders) {
    if (!ord) continue;

    // Cek apakah sudah pernah ada di database Check IN/OUT
    const existing = await db.boards.where('no_nota').equals(ord.no_nota || '').first();
    if (existing) continue;

    // Tentukan jenis acara dari ucapan/tipe
    let detectedAcara = 'Pesta / Pernikahan';
    let durationDays = 1;
    const lowerUcapan = (ord.ucapan || '').toLowerCase();
    const lowerJenis = (ord.jenis_papan || '').toLowerCase();

    if (lowerUcapan.includes('duka') || lowerUcapan.includes('belasungkawa') || lowerUcapan.includes('rip') || lowerUcapan.includes('meninggal')) {
      detectedAcara = 'Duka Cita';
      durationDays = 3;
    } else if (lowerUcapan.includes('opening') || lowerUcapan.includes('peresmian') || lowerUcapan.includes('sukses') || lowerUcapan.includes('buka')) {
      detectedAcara = 'Grand Opening';
      durationDays = 2;
    }

    // Hitung target tanggal jemput
    const tglAntar = ord.tanggal_antar || ord.tanggal || getTodayDateStr();
    const tglAntarDate = new Date(tglAntar);
    const targetDate = new Date(tglAntarDate);
    targetDate.setDate(targetDate.getDate() + durationDays);
    const targetDateStr = targetDate.toISOString().split('T')[0];

    const newBoard = {
      id: 'B-' + (ord.no_nota ? ord.no_nota.replace(/[^a-zA-Z0-9]/g, '') : Date.now()),
      no_nota: ord.no_nota || '',
      nama_pemesan: ord.nama_pemesan || 'Tanpa Nama',
      no_wa_pemesan: ord.no_wa || '',
      jenis_papan: ord.jenis_papan || 'Papan Standar',
      jenis_acara: detectedAcara,
      durasi_hari: durationDays,
      ucapan: ord.ucapan || '',
      lokasi: ord.lokasi_pengantaran || '',
      gps_lat: ord.gps_lat || null,
      gps_lng: ord.gps_lng || null,
      tgl_antar: tglAntar,
      jam_antar: '09:00',
      target_tgl_jemput: targetDateStr,
      target_jam_jemput: '18:00',
      status_jemput: ord.status_proses === 'Selesai' ? 'SELESAI' : 'BELUM',
      foto_antar: null,
      foto_jemput: null,
      petugas_antar: 'Armada',
      petugas_jemput: '',
      catatan: 'Diimpor otomatis dari Pesanan Finance'
    };

    await saveBoardToCloud(newBoard);
    importedCount++;
  }

  return {
    count: importedCount,
    message: `Berhasil mengimpor ${importedCount} data papan dari sistem Finance!`
  };
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
