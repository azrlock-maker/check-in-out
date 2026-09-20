// Check IN/OUT Florist - IndexedDB Manager (Offline-First Storage)
// Database: CheckInOutFloristDB (Terisolasi dari database finance lain)

const db = new Dexie('CheckInOutFloristDB');

// Versi 1 - Schema awal (dipertahankan untuk migrasi aman)
db.version(1).stores({
  boards: 'id, no_nota, nama_pemesan, jenis_papan, jenis_acara, tgl_antar, target_tgl_jemput, status_jemput, created_at, updated_at',
  settings: 'key'
});

// Tipe papan default (dipakai saat pertama kali install atau reset)
// PENTING: harus dideklarasikan SEBELUM db.version(2).upgrade() memakainya
const DEFAULT_BOARD_TYPES = [
  'Papan Standar (Single)',
  'Papan Gandeng (Double)',
  'Papan Mahkota / Jumbo',
  'Papan Rustic / Kayu',
  'Papan Kertas / Printing',
];

// Versi 2 - Tambah tabel tipe papan yang bisa dikelola user
db.version(2).stores({
  boards: 'id, no_nota, nama_pemesan, jenis_papan, jenis_acara, tgl_antar, target_tgl_jemput, status_jemput, created_at, updated_at',
  settings: 'key',
  board_types: '++id, nama, urutan, created_at'
}).upgrade(async tx => {
  // Seed data tipe papan default saat pertama kali upgrade
  const existingCount = await tx.table('board_types').count();
  if (existingCount === 0) {
    await tx.table('board_types').bulkAdd(DEFAULT_BOARD_TYPES.map((nama, i) => ({
      nama,
      urutan: i + 1,
      created_at: new Date().toISOString()
    })));
  }
});

// ─── Fungsi CRUD Tipe Papan ─────────────────────────────────────────────────

// Ambil semua tipe papan dari database, diurutkan
async function getBoardTypes() {
  try {
    const types = await db.board_types.orderBy('urutan').toArray();
    return types;
  } catch (e) {
    console.error('[getBoardTypes]', e);
    return [];
  }
}

// Tambah tipe papan baru
async function addBoardType(nama) {
  nama = (nama || '').trim();
  if (!nama) return null;

  // Cegah duplikat (case-insensitive)
  const existing = await db.board_types.filter(t => t.nama.toLowerCase() === nama.toLowerCase()).first();
  if (existing) return null;

  const maxUrutan = await db.board_types.orderBy('urutan').last();
  const newUrutan = maxUrutan ? (maxUrutan.urutan + 1) : 1;

  const id = await db.board_types.add({
    nama,
    urutan: newUrutan,
    created_at: new Date().toISOString()
  });
  return id;
}

// Hapus tipe papan berdasarkan id
async function deleteBoardType(id) {
  try {
    await db.board_types.delete(id);
    return true;
  } catch (e) {
    return false;
  }
}

// Edit nama tipe papan
async function renameBoardType(id, newNama) {
  newNama = (newNama || '').trim();
  if (!newNama) return false;
  try {
    await db.board_types.update(id, { nama: newNama });
    return true;
  } catch (e) {
    return false;
  }
}

// Reset ke tipe default
async function resetBoardTypesToDefault() {
  await db.board_types.clear();
  await db.board_types.bulkAdd(DEFAULT_BOARD_TYPES.map((nama, i) => ({
    nama,
    urutan: i + 1,
    created_at: new Date().toISOString()
  })));
}

// Inisialisasi tipe papan pertama kali jika tabel kosong
async function ensureBoardTypesSeeded() {
  const count = await db.board_types.count();
  if (count === 0) {
    await db.board_types.bulkAdd(DEFAULT_BOARD_TYPES.map((nama, i) => ({
      nama,
      urutan: i + 1,
      created_at: new Date().toISOString()
    })));
  }
}

// Helper: Ambil tanggal lokal hari ini (YYYY-MM-DD)
function getTodayDateStr() {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

// Helper: Ambil jam lokal sekarang (HH:mm)
function getCurrentTimeStr() {
  const now = new Date();
  const h = String(now.getHours()).padStart(2, '0');
  const m = String(now.getMinutes()).padStart(2, '0');
  return `${h}:${m}`;
}

// Helper: Hitung Status Keterlambatan Papan (Overdue Calculator)
function calculateBoardStatus(board) {
  if (board.status_jemput === 'SELESAI') {
    return {
      status: 'SELESAI',
      label: '✅ Selesai Check IN',
      badgeClass: 'completed-tag',
      isOverdue: false,
      isToday: false,
      overdueText: ''
    };
  }

  const now = new Date();
  const targetDateStr = board.target_tgl_jemput || board.tgl_antar || getTodayDateStr();
  const targetTimeStr = board.target_jam_jemput || '18:00';
  const targetDateTime = new Date(`${targetDateStr}T${targetTimeStr}:00`);

  const todayStr = getTodayDateStr();

  // Jika target waktu sudah lewat dari waktu saat ini
  if (now > targetDateTime) {
    const diffMs = now - targetDateTime;
    const diffHoursTotal = Math.floor(diffMs / (1000 * 60 * 60));
    const diffDays = Math.floor(diffHoursTotal / 24);
    const diffRemainingHours = diffHoursTotal % 24;

    let overdueText = '';
    if (diffDays > 0) {
      overdueText = `Lewat ${diffDays} Hari ${diffRemainingHours > 0 ? `${diffRemainingHours} Jam` : ''}`;
    } else if (diffHoursTotal > 0) {
      overdueText = `Lewat ${diffHoursTotal} Jam`;
    } else {
      const diffMins = Math.floor(diffMs / (1000 * 60));
      overdueText = `Lewat ${diffMins} Menit`;
    }

    return {
      status: 'OVERDUE',
      label: `🚨 ${overdueText}`,
      badgeClass: 'overdue-tag',
      isOverdue: true,
      isToday: false,
      diffDays,
      diffHoursTotal,
      overdueText
    };
  }

  // Jika target jemput adalah hari ini tapi belum lewat jamnya
  if (targetDateStr === todayStr) {
    return {
      status: 'TODAY',
      label: `⏰ Jemput Hari Ini (${targetTimeStr})`,
      badgeClass: 'today-tag',
      isOverdue: false,
      isToday: true,
      overdueText: ''
    };
  }

  // Jika masih masa aktif sewa
  return {
    status: 'ACTIVE',
    label: '🌿 Masih Terpasang',
    badgeClass: 'active-tag',
    isOverdue: false,
    isToday: false,
    overdueText: ''
  };
}

// Helper: Kompresi Gambar Ekstrem di Sisi Browser (Smart Canvas Compressor)
// Mengubah foto HP 5MB -> ~35KB JPEG agar kuota Firebase awet bertahun-tahun
function compressPhoto(file, maxWidth = 800, quality = 0.65) {
  return new Promise((resolve, reject) => {
    if (!file || !file.type.startsWith('image/')) {
      resolve(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      const img = new Image();
      img.onload = () => {
        let width = img.width;
        let height = img.height;

        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }

        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;

        const ctx = canvas.getContext('2d');
        ctx.drawImage(img, 0, 0, width, height);

        // Ekspor ke format JPEG dengan kompresi terukur
        const compressedBase64 = canvas.toDataURL('image/jpeg', quality);
        resolve(compressedBase64);
      };
      img.onerror = () => reject(new Error('Gagal memuat gambar'));
      img.src = e.target.result;
    };
    reader.onerror = () => reject(new Error('Gagal membaca berkas'));
    reader.readAsDataURL(file);
  });
}

// Helper: Tangkap Koordinat GPS Browser
function getCurrentLocationGPS() {
  return new Promise((resolve) => {
    if (!navigator.geolocation) {
      resolve(null);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        resolve({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          timestamp: new Date().toISOString()
        });
      },
      (err) => {
        console.warn('[GPS] Geolocation error:', err);
        resolve(null);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );
  });
}

// Helper: Dapatkan URL Google Maps
function getMapsLink(board) {
  if (board.gps_lat && board.gps_lng) {
    return `https://www.google.com/maps/search/?api=1&query=${board.gps_lat},${board.gps_lng}`;
  }
  if (board.lokasi) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(board.lokasi)}`;
  }
  return '';
}
