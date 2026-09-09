// Check IN/OUT Florist - Notification & Audio Alert Manager
// Mendukung Browser Web Push Notification, Audio Chime (Web Audio API), dan WhatsApp Dispatch

const NotificationManager = {
  audioCtx: null,

  // Inisialisasi Audio Context
  initAudio() {
    if (!this.audioCtx) {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (AudioContext) {
        this.audioCtx = new AudioContext();
      }
    }
  },

  // Bunyikan Nada Peringatan Ramah (Synth Bell Chime) tanpa butuh file MP3 eksternal
  playChime(isUrgent = false) {
    try {
      this.initAudio();
      if (!this.audioCtx) return;
      if (this.audioCtx.state === 'suspended') {
        this.audioCtx.resume();
      }

      const ctx = this.audioCtx;
      const now = ctx.currentTime;

      if (isUrgent) {
        // 3-Tone Alert Chime untuk Papan Overdue (Darurat)
        const tones = [587.33, 739.99, 880.00]; // D5, F#5, A5
        tones.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'sine';
          osc.frequency.setValueAtTime(freq, now + idx * 0.12);

          gain.gain.setValueAtTime(0, now + idx * 0.12);
          gain.gain.linearRampToValueAtTime(0.25, now + idx * 0.12 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.12 + 0.4);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now + idx * 0.12);
          osc.stop(now + idx * 0.12 + 0.45);
        });
      } else {
        // 2-Tone Melodi Ramah (Check IN Sukses)
        const tones = [523.25, 659.25]; // C5, E5
        tones.forEach((freq, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();

          osc.type = 'triangle';
          osc.frequency.setValueAtTime(freq, now + idx * 0.15);

          gain.gain.setValueAtTime(0, now + idx * 0.15);
          gain.gain.linearRampToValueAtTime(0.2, now + idx * 0.15 + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + idx * 0.15 + 0.35);

          osc.connect(gain);
          gain.connect(ctx.destination);

          osc.start(now + idx * 0.15);
          osc.stop(now + idx * 0.15 + 0.4);
        });
      }
    } catch (e) {
      console.warn('[Audio Alert] Gagal memainkan suara:', e);
    }
  },

  // Minta Izin Notifikasi Browser (Web Push Notification)
  async requestPermission() {
    if (!('Notification' in window)) {
      alert('Browser ini tidak mendukung notifikasi sistem desktop/HP.');
      return false;
    }

    if (Notification.permission === 'granted') {
      return true;
    }

    if (Notification.permission !== 'denied') {
      const permission = await Notification.requestPermission();
      return permission === 'granted';
    }

    return false;
  },

  // Kirim Notifikasi Sistem Browser (HP Status Bar / Desktop Pop-up)
  sendNotification(title, body, tag = 'check-in-out-alert') {
    if (!('Notification' in window) || Notification.permission !== 'granted') {
      return;
    }

    try {
      const options = {
        body: body,
        icon: 'icons/icon-192.png',
        badge: 'icons/icon-192.png',
        tag: tag,
        vibrate: [200, 100, 200],
        renotify: true
      };

      if (navigator.serviceWorker && navigator.serviceWorker.controller) {
        navigator.serviceWorker.ready.then((reg) => {
          reg.showNotification(title, options);
        });
      } else {
        new Notification(title, options);
      }
    } catch (e) {
      console.warn('[Notification] Gagal mengirim notifikasi:', e);
    }
  },

  // Helper Pembuat Link WhatsApp Tugas Jemput Papan
  getWaTaskUrl(board, targetPhone = '') {
    const mapsLink = getMapsLink(board);
    const statusInfo = calculateBoardStatus(board);

    const lines = [
      `🚚 *TUGAS PENJEMPUTAN PAPAN BUNGA*`,
      `*Check IN/OUT Florist*`,
      `---------------------------------`,
      `🔖 *No. Nota / ID:* ${board.no_nota || '-'}`,
      `👤 *Pemesan:* ${board.nama_pemesan || '-'}`,
      `🏷️ *Jenis Papan:* ${board.jenis_papan || 'Papan Bunga'}`,
      `🎉 *Acara:* ${board.jenis_acara || '-'}`,
      `⏳ *Target Batas Jemput:* ${board.target_tgl_jemput || '-'} (${board.target_jam_jemput || '18:00'})`,
      `⚠️ *Status:* ${statusInfo.label}`,
      `📍 *Lokasi Acara:* ${board.lokasi || '-'}`,
      board.catatan ? `📝 *Catatan:* ${board.catatan}` : '',
      mapsLink ? `🗺️ *Rute Google Maps:*\n${mapsLink}` : '',
      `---------------------------------`,
      `_Harap konfirmasi jika papan sudah dinaikkan ke kendaraan / sudah di-Check IN._`
    ].filter(Boolean);

    const text = encodeURIComponent(lines.join('\n'));
    if (targetPhone) {
      let cleanPhone = targetPhone.replace(/[^0-9]/g, '');
      if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
      return `https://wa.me/${cleanPhone}?text=${text}`;
    }
    return `https://wa.me/?text=${text}`;
  },

  // Helper Pembuat Rekap Seluruh Papan Overdue ke WhatsApp
  getWaOverdueSummaryUrl(overdueBoards, targetPhone = '') {
    if (!overdueBoards || overdueBoards.length === 0) return '';

    const lines = [
      `🚨 *DAFTAR PAPAN WAJIB DIJEMPUT HARI INI*`,
      `*Check IN/OUT Florist* (${overdueBoards.length} Papan Lewat Batas)`,
      `Tanggal: ${new Date().toLocaleDateString('id-ID', { dateStyle: 'full' })}`,
      `=================================`
    ];

    overdueBoards.forEach((b, idx) => {
      const statusInfo = calculateBoardStatus(b);
      const maps = getMapsLink(b);
      lines.push(
        `\n*${idx + 1}. [${b.no_nota || 'Tanpa Nota'}] - ${b.nama_pemesan || '-'}*`,
        `   • Papan: ${b.jenis_papan || 'Papan Bunga'} (${b.jenis_acara || '-'})`,
        `   • Keterlambatan: ${statusInfo.overdueText || statusInfo.label}`,
        `   • Lokasi: ${b.lokasi || '-'}`,
        maps ? `   • Maps: ${maps}` : ''
      );
    });

    lines.push(
      `\n=================================`,
      `_Mohon segera koordinasikan armada untuk penjemputan._`
    );

    const text = encodeURIComponent(lines.join('\n'));
    if (targetPhone) {
      let cleanPhone = targetPhone.replace(/[^0-9]/g, '');
      if (cleanPhone.startsWith('0')) cleanPhone = '62' + cleanPhone.slice(1);
      return `https://wa.me/${cleanPhone}?text=${text}`;
    }
    return `https://wa.me/?text=${text}`;
  }
};
