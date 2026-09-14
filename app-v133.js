const API = '/api/gas';
const API_TIMEOUT_MS = 25000;
const FRONTEND_VERSION = '1.3.3';

let token = localStorage.getItem('abs_token') || '';
let currentUser = null;
let homeData = null;
let currentAttendance = null;
let currentPosition = null;
let selfieDataUrl = '';
let cameraStream = null;
let loginBusy = false;
let adminGeoWatchId = null;
let adminGeoTimeout = null;

const $ = (id) => document.getElementById(id);

function toast(message) {
  const t = $('toast');
  if (!t) { console.warn(message); return; }
  t.textContent = message;
  t.classList.add('show');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => t.classList.remove('show'), 3000);
}

function safeHTML(target, html) {
  const el = typeof target === 'string' ? $(target) : target;
  if (!el) return false;
  el.innerHTML = html;
  return true;
}

function safeText(target, text) {
  const el = typeof target === 'string' ? $(target) : target;
  if (!el) return false;
  el.textContent = text ?? '';
  return true;
}

function setLoginLoading(active, text) {
  const btn = $('loginBtn');
  const btnText = $('loginBtnText');
  const status = $('loginStatus');
  const statusText = $('loginStatusText');

  if (btn) {
    btn.disabled = active;
    btn.classList.toggle('loading', active);
  }
  if (btnText) btnText.textContent = active ? 'Memproses...' : 'Masuk';
  if (status) status.classList.toggle('hidden', !active);
  if (statusText) statusText.textContent = text || 'Menghubungkan ke server...';
}

async function api(action, payload = {}) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action, token, payload }),
      signal: controller.signal
    });

    let json;
    try { json = await response.json(); }
    catch (_) { throw new Error('Respons server tidak dapat dibaca.'); }

    if (!response.ok && json?.message) throw new Error(json.message);
    if (!json.ok) throw new Error(json.message || 'Proses gagal.');
    return json.data;

  } catch (e) {
    if (e?.name === 'AbortError') throw new Error('Server terlalu lama merespons. Coba lagi.');
    throw e;
  } finally {
    clearTimeout(timeoutId);
  }
}

function setView(loggedIn) {
  $('loginView')?.classList.toggle('hidden', loggedIn);
  $('appView')?.classList.toggle('hidden', !loggedIn);
}

async function login() {
  if (loginBusy) return;

  const username = $('username')?.value?.trim() || '';
  const pin = $('pin')?.value?.trim() || '';

  if (!username || !pin) {
    toast('Username/ID/NIP dan PIN wajib diisi.');
    return;
  }

  loginBusy = true;
  setLoginLoading(true, 'Menghubungkan ke server...');

  const slowTimer = setTimeout(() => {
    safeText('loginStatusText', 'Masih memproses, mohon tunggu...');
  }, 4000);

  try {
    const data = await api('login', {
      username,
      pin,
      deviceInfo: navigator.userAgent
    });

    safeText('loginStatusText', 'Login berhasil, membuka aplikasi...');
    token = data.token;
    currentUser = data.user;
    localStorage.setItem('abs_token', token);

    setView(true);
    await afterLogin();

  } catch (e) {
    console.error('login:', e);
    toast(e.message);
    setView(false);
  } finally {
    clearTimeout(slowTimer);
    loginBusy = false;
    setLoginLoading(false);
  }
}

async function logout() {
  try { if (token) await api('logout', {}); } catch (_) {}
  stopAdminGeoWatch();
  token = '';
  currentUser = null;
  homeData = null;
  localStorage.removeItem('abs_token');
  setView(false);
}

async function afterLogin() {
  if (!currentUser) currentUser = await api('me', {});
  safeText('helloName', currentUser?.nama || 'Pegawai');

  const adminNav = $('navAdmin');
  if (adminNav) {
    adminNav.classList.toggle('hidden', !['ADMIN', 'SUPER_ADMIN'].includes(currentUser?.role));
  }

  await showHome();
}

function navActive(id) {
  document.querySelectorAll('.bottom-nav button').forEach((btn) => btn.classList.remove('active'));
  $(id)?.classList.add('active');
}

function actionCard(type, title, subtitle, ref = '') {
  const safeTitle = String(title).replace(/'/g, "\\'");
  return `
    <div class="action-card active">
      <h3>${title}</h3>
      <div class="muted">${subtitle || ''}</div>
      <div style="height:10px"></div>
      <button class="btn primary" onclick="openAttendance('${type}','${ref}','${safeTitle}')">
        Mulai Absen
      </button>
    </div>
  `;
}

async function showHome() {
  stopAdminGeoWatch();
  navActive('navHome');
  const m = $('mainContent');
  if (!m) return;

  safeHTML(m, '<div class="card">Memuat...</div>');

  try {
    homeData = await api('home', {});
    const s = homeData?.schedule || null;
    const a = homeData?.attendance || {};
    const server = homeData?.server || {};

    let html = `
      <div class="hero">
        <div class="small">${server.day || '-'}</div>
        <div class="time">${(server.time || '--:--').slice(0,5)}</div>
        <div class="date">${server.date || '-'}</div>
      </div>
    `;

    html += `
      <div class="card">
        <h3>Jadwal Hari Ini</h3>
        ${s ? `
          <div class="grid2">
            <div class="stat"><span class="muted">Masuk</span><b>${s.jamMasuk || '-'}</b></div>
            <div class="stat"><span class="muted">Pulang</span><b>${s.jamPulang || '-'}</b></div>
          </div>
        ` : '<div class="muted">Belum ada jadwal aktif untuk hari ini.</div>'}
      </div>
    `;

    html += `
      <div class="card">
        <h3>Status Hari Ini</h3>
        <div class="grid2">
          <div class="stat"><span class="muted">Masuk</span><b>${a?.masuk?.waktu ? a.masuk.waktu.slice(11,16) : '--:--'}</b></div>
          <div class="stat"><span class="muted">Pulang</span><b>${a?.pulang?.waktu ? a.pulang.waktu.slice(11,16) : '--:--'}</b></div>
        </div>
      </div>
    `;

    if (s) {
      if (!a?.masuk) html += actionCard('MASUK', 'Absen Masuk', 'GPS + selfie');
      else if (!a?.pulang) html += actionCard('PULANG', 'Absen Pulang', 'GPS + selfie');
    }

    (homeData?.activeActivities || []).forEach((x) => {
      html += actionCard('KEGIATAN', `Absen Kegiatan: ${x.nama}`,
        `${x.jamMulai || '-'} - ${x.jamSelesai || '-'}`, x.idKegiatan);
    });

    (homeData?.assignments || []).forEach((x) => {
      html += actionCard(
        x.jenisTugas,
        `${x.jenisTugas === 'DINAS_LUAR' ? 'Dinas Luar' : 'Tugas Lapangan'}: ${x.namaTugas}`,
        x.modeLokasi === 'LOKASI_AKTUAL' ? 'Lokasi aktual' : 'Radius lokasi',
        x.idTugas
      );
    });

    safeHTML(m, html);
  } catch (e) {
    safeHTML(m, `<div class="card">${e.message}</div>`);
    toast(e.message);
  }
}

async function openAttendance(type, ref, title) {
  currentAttendance = { type, ref, title };
  currentPosition = null;
  selfieDataUrl = '';

  const modal = $('attendanceModal');
  const camera = $('camera');
  const preview = $('preview');
  const submit = $('submitAttendBtn');

  if (!modal || !camera || !preview || !submit) {
    toast('Komponen absensi belum lengkap.');
    return;
  }

  preview.classList.add('hidden');
  camera.classList.remove('hidden');
  safeText('attTitle', title || 'Absensi');
  modal.classList.remove('hidden');
  submit.disabled = true;
  safeText('gpsStatus', 'Mencari lokasi...');
  safeText('gpsInfo', '');

  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'user' },
      audio: false
    });
    camera.srcObject = cameraStream;
  } catch (e) {
    toast('Kamera tidak dapat dibuka.');
  }

  if (!navigator.geolocation) {
    safeText('gpsStatus', 'GPS tidak didukung perangkat.');
    return;
  }

  navigator.geolocation.getCurrentPosition(
    (pos) => {
      currentPosition = pos.coords;
      safeText('gpsStatus', 'GPS ditemukan');
      safeText('gpsInfo', `Akurasi ±${Math.round(pos.coords.accuracy)} meter`);
      updateSubmitState();
    },
    (err) => safeText('gpsStatus', 'GPS gagal: ' + err.message),
    { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
  );
}

function captureSelfie() {
  const video = $('camera');
  const canvas = $('snapshot');
  const preview = $('preview');

  if (!video || !canvas || !preview) {
    toast('Kamera belum siap.');
    return;
  }

  if (!video.videoWidth || !video.videoHeight) {
    toast('Tunggu kamera siap beberapa detik.');
    return;
  }

  canvas.width = 720;
  canvas.height = Math.round((720 * video.videoHeight) / video.videoWidth);
  canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);

  selfieDataUrl = canvas.toDataURL('image/jpeg', 0.72);
  preview.src = selfieDataUrl;
  preview.classList.remove('hidden');
  video.classList.add('hidden');
  updateSubmitState();
}

function updateSubmitState() {
  const submit = $('submitAttendBtn');
  if (submit) submit.disabled = !(currentPosition && selfieDataUrl);
}

async function submitAttendance() {
  const btn = $('submitAttendBtn');
  if (!btn || !currentAttendance || !currentPosition) return;

  btn.disabled = true;
  btn.textContent = 'Menyimpan...';

  try {
    const data = await api('attend', {
      jenisAbsen: currentAttendance.type,
      idReferensi: currentAttendance.ref,
      latitude: currentPosition.latitude,
      longitude: currentPosition.longitude,
      accuracy: currentPosition.accuracy,
      selfieDataUrl,
      deviceTime: new Date().toISOString(),
      userAgent: navigator.userAgent
    });

    toast(`Berhasil: ${data.status}`);
    closeAttendance();
    await showHome();
  } catch (e) {
    toast(e.message);
    btn.disabled = false;
  } finally {
    btn.textContent = 'Simpan Absen';
  }
}

function closeAttendance() {
  $('attendanceModal')?.classList.add('hidden');
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
}

async function showHistory() {
  stopAdminGeoWatch();
  navActive('navHistory');
  const m = $('mainContent');
  if (!m) return;
  safeHTML(m, '<div class="card">Memuat...</div>');

  try {
    const rows = await api('history', { limit: 50 });
    safeHTML(m, `<div class="card"><h3>Riwayat Absensi</h3>${
      rows.length ? rows.map((r) => `
        <div class="list-item">
          <b>${r.jenis}</b>
          <span class="badge ${r.status === 'TERLAMBAT' ? 'warn' : 'ok'}">${r.status}</span>
          <div class="muted">${r.tanggal} • ${(r.waktu || '').slice(11,16)}</div>
        </div>`).join('') : '<div class="muted">Belum ada data.</div>'
    }</div>`);
  } catch (e) {
    safeHTML(m, `<div class="card">${e.message}</div>`);
  }
}

async function showLeave() {
  stopAdminGeoWatch();
  navActive('navLeave');
  const m = $('mainContent');
  if (!m) return;

  safeHTML(m, `
    <div class="card">
      <h3>Pengajuan Izin / Sakit / Cuti</h3>
      <select id="lvJenis"><option>IZIN</option><option>SAKIT</option><option>CUTI</option></select>
      <input id="lvMulai" type="date">
      <input id="lvSelesai" type="date">
      <textarea id="lvAlasan" placeholder="Alasan"></textarea>
      <button class="btn primary" onclick="submitLeave()">Kirim Pengajuan</button>
    </div>
    <div id="leaveList" class="card"><h3>Riwayat Pengajuan</h3><div class="muted">Memuat...</div></div>
  `);

  try {
    const rows = await api('my_leaves', {});
    safeHTML('leaveList', `<h3>Riwayat Pengajuan</h3>${
      rows.length ? rows.map((r) => `
        <div class="list-item">
          <b>${r.jenis}</b> <span class="badge">${r.status}</span>
          <div class="muted">${r.mulai} s.d. ${r.selesai}</div>
          <div>${r.alasan || ''}</div>
        </div>`).join('') : '<div class="muted">Belum ada pengajuan.</div>'
    }`);
  } catch (e) {
    safeHTML('leaveList', `<h3>Riwayat Pengajuan</h3><div>${e.message}</div>`);
  }
}

async function submitLeave() {
  try {
    await api('submit_leave', {
      jenis: $('lvJenis')?.value || '',
      tanggalMulai: $('lvMulai')?.value || '',
      tanggalSelesai: $('lvSelesai')?.value || '',
      alasan: $('lvAlasan')?.value || ''
    });
    toast('Pengajuan dikirim.');
    await showLeave();
  } catch (e) { toast(e.message); }
}

async function showAdmin() {
  stopAdminGeoWatch();
  navActive('navAdmin');

  const m = $('mainContent');
  if (!m) return;

  safeHTML(m, '<div class="card">Memuat pengaturan admin...</div>');

  try {
    const [d, locations, employees, schedules] = await Promise.all([
      api('admin_dashboard', {}),
      api('admin_locations', {}),
      api('admin_employees', {}),
      api('admin_schedules', {})
    ]);

    const kantor = locations.find((x) => x.tipe === 'KANTOR') || null;
    window.__adminSchedules = schedules || [];

    safeHTML(m, `
      <div class="card">
        <h3>Dashboard Admin</h3>
        <div class="grid2">
          <div class="stat"><span class="muted">Pegawai</span><b>${d.totalPegawai}</b></div>
          <div class="stat"><span class="muted">Absen Hari Ini</span><b>${d.totalTransaksiHariIni}</b></div>
          <div class="stat"><span class="muted">Masuk</span><b>${d.masuk}</b></div>
          <div class="stat"><span class="muted">Terlambat</span><b>${d.terlambat}</b></div>
        </div>
      </div>

      <div class="card">
        <div style="display:flex;justify-content:space-between;gap:8px;align-items:center">
          <h3 style="margin:0">Lokasi Kantor & Radius</h3>
          <span style="font-size:11px;background:#eef5ff;padding:5px 8px;border-radius:10px">v${FRONTEND_VERSION}</span>
        </div>

        <div style="height:16px"></div>
        <input id="cfgLocId" type="hidden" value="${kantor?.id || ''}">
        <input id="cfgLocName" placeholder="Nama lokasi" value="${kantor?.nama || 'Kantor DPUPR KSB'}">
        <textarea id="cfgLocAddress" placeholder="Alamat">${kantor?.alamat || ''}</textarea>

        <button
          id="cfgGetLocationBtn"
          type="button"
          onclick="getAdminCurrentLocation()"
          style="width:100%;margin:12px 0;padding:16px;border:0;border-radius:14px;background:#FFD600;color:#12375b;font-size:16px;font-weight:800">
          📍 Ambil Lokasi Saya Sekarang
        </button>

        <div id="cfgGeoStatus" style="margin:0 0 14px;color:#607089;font-size:14px">
          Tekan tombol kuning saat berada di titik kantor.
        </div>

        <div class="grid2">
          <input id="cfgLat" placeholder="Latitude" inputmode="decimal" value="${kantor?.latitude ?? ''}">
          <input id="cfgLon" placeholder="Longitude" inputmode="decimal" value="${kantor?.longitude ?? ''}">
        </div>
        <div class="grid2">
          <input id="cfgRadius" placeholder="Radius meter" inputmode="numeric" value="${kantor?.radius ?? 100}">
          <input id="cfgAccuracy" placeholder="Batas akurasi GPS (m)" inputmode="numeric" value="${kantor?.akurasi ?? 30}">
        </div>

        <button class="btn primary" onclick="saveOfficeLocation()">Simpan Lokasi & Radius</button>
      </div>

      <div class="card">
        <h3>Jadwal Kerja</h3>
        <select id="cfgScheduleSelect" onchange="loadScheduleToForm()">
          <option value="">+ Buat jadwal baru</option>
          ${(schedules || []).map((x, i) => `<option value="${i}">${x.hari} • ${x.jamMasuk}-${x.jamPulang}</option>`).join('')}
        </select>
        <input id="cfgScheduleId" type="hidden">
        <input id="cfgScheduleName" placeholder="Nama jadwal" value="Reguler">
        <select id="cfgDay">
          ${['SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU','MINGGU'].map(x => `<option>${x}</option>`).join('')}
        </select>
        <div class="grid2">
          <input id="cfgIn" type="time">
          <input id="cfgOut" type="time">
        </div>
        <input id="cfgTolerance" type="number" min="0" placeholder="Toleransi terlambat (menit)" value="0">
        <div class="muted" style="margin:8px 0">Jendela Absen Masuk</div>
        <div class="grid2">
          <input id="cfgInStart" type="time">
          <input id="cfgInEnd" type="time">
        </div>
        <div class="muted" style="margin:8px 0">Jendela Absen Pulang</div>
        <div class="grid2">
          <input id="cfgOutStart" type="time">
          <input id="cfgOutEnd" type="time">
        </div>
        <select id="cfgScheduleStatus">
          <option value="AKTIF">AKTIF</option>
          <option value="NONAKTIF">NONAKTIF</option>
        </select>
        <button class="btn primary" onclick="saveSchedule()">Simpan Jadwal</button>
      </div>

      <div class="card">
        <h3>Buat Kegiatan</h3>
        <input id="adNama" placeholder="Nama kegiatan">
        <input id="adTanggal" type="date">
        <div class="grid2"><input id="adMulai" type="time"><input id="adSelesai" type="time"></div>
        <select id="adLokasi">
          ${(locations || []).map(x => `<option value="${x.id}">${x.nama}</option>`).join('')}
        </select>
        <button class="btn primary" onclick="createActivity()">Aktifkan Kegiatan</button>
      </div>

      <div class="card">
        <h3>Buat Tugas Lapangan / Dinas Luar</h3>
        <select id="tgPegawai">
          ${(employees || []).map(x => `<option value="${x.idPegawai}">${x.nama}</option>`).join('')}
        </select>
        <select id="tgJenis">
          <option value="TUGAS_LAPANGAN">TUGAS LAPANGAN</option>
          <option value="DINAS_LUAR">DINAS LUAR</option>
        </select>
        <input id="tgNama" placeholder="Nama tugas">
        <div class="grid2"><input id="tgMulai" type="date"><input id="tgSelesai" type="date"></div>
        <select id="tgMode">
          <option value="LOKASI_AKTUAL">Lokasi Aktual</option>
          <option value="RADIUS">Radius Lokasi</option>
        </select>
        <select id="tgLokasi">
          <option value="">-- lokasi opsional --</option>
          ${(locations || []).map(x => `<option value="${x.id}">${x.nama}</option>`).join('')}
        </select>
        <button class="btn primary" onclick="createAssignment()">Simpan Penugasan</button>
      </div>
    `);

  } catch (e) {
    safeHTML(m, `<div class="card">${e.message}</div>`);
    toast(e.message);
  }
}

function stopAdminGeoWatch() {
  if (adminGeoWatchId !== null && navigator.geolocation) {
    navigator.geolocation.clearWatch(adminGeoWatchId);
  }
  adminGeoWatchId = null;
  if (adminGeoTimeout) clearTimeout(adminGeoTimeout);
  adminGeoTimeout = null;
}

function resetAdminGeoButton() {
  const btn = $('cfgGetLocationBtn');
  if (!btn) return;
  btn.disabled = false;
  btn.textContent = '📍 Ambil Lokasi Saya Sekarang';
}

function getAdminCurrentLocation() {
  if (!navigator.geolocation) {
    toast('GPS tidak didukung perangkat ini.');
    return;
  }

  stopAdminGeoWatch();

  const btn = $('cfgGetLocationBtn');
  if (btn) {
    btn.disabled = true;
    btn.textContent = '⏳ Mencari lokasi...';
  }

  safeText('cfgGeoStatus', 'Mengaktifkan GPS dan mencari titik terbaik...');

  let best = null;
  const targetAccuracy = Math.max(5, Number($('cfgAccuracy')?.value || 30));

  const acceptPosition = (pos) => {
    if (!best || pos.coords.accuracy < best.coords.accuracy) {
      best = pos;

      if ($('cfgLat')) $('cfgLat').value = Number(pos.coords.latitude).toFixed(7);
      if ($('cfgLon')) $('cfgLon').value = Number(pos.coords.longitude).toFixed(7);

      safeText('cfgGeoStatus',
        `Lokasi ditemukan • akurasi ±${Math.round(pos.coords.accuracy)} meter`);
    }

    if (pos.coords.accuracy <= targetAccuracy) {
      stopAdminGeoWatch();
      resetAdminGeoButton();
      toast(`Lokasi berhasil diambil. Akurasi ±${Math.round(pos.coords.accuracy)} m`);
    }
  };

  const failPosition = (err) => {
    stopAdminGeoWatch();
    resetAdminGeoButton();

    let msg = 'Lokasi tidak dapat diambil.';
    if (err.code === 1) msg = 'Izin lokasi ditolak. Izinkan akses lokasi pada browser.';
    if (err.code === 2) msg = 'Sinyal GPS belum tersedia. Coba di area lebih terbuka.';
    if (err.code === 3) msg = 'Pencarian lokasi terlalu lama. Coba lagi.';

    safeText('cfgGeoStatus', msg);
    toast(msg);
  };

  adminGeoWatchId = navigator.geolocation.watchPosition(
    acceptPosition,
    failPosition,
    { enableHighAccuracy: true, maximumAge: 0, timeout: 12000 }
  );

  adminGeoTimeout = setTimeout(() => {
    stopAdminGeoWatch();
    resetAdminGeoButton();

    if (best) {
      safeText('cfgGeoStatus',
        `Lokasi digunakan • akurasi terbaik ±${Math.round(best.coords.accuracy)} meter`);
      toast('Lokasi terbaik sudah diambil.');
    } else {
      safeText('cfgGeoStatus', 'GPS belum menemukan lokasi. Coba lagi.');
      toast('GPS belum menemukan lokasi.');
    }
  }, 15000);
}

function loadScheduleToForm() {
  const index = $('cfgScheduleSelect')?.value;

  if (index === '') {
    if ($('cfgScheduleId')) $('cfgScheduleId').value = '';
    if ($('cfgScheduleName')) $('cfgScheduleName').value = 'Reguler';
    if ($('cfgTolerance')) $('cfgTolerance').value = 0;
    return;
  }

  const s = (window.__adminSchedules || [])[Number(index)];
  if (!s) return;

  $('cfgScheduleId').value = s.id || '';
  $('cfgScheduleName').value = s.nama || 'Reguler';
  $('cfgDay').value = s.hari || 'SENIN';
  $('cfgIn').value = s.jamMasuk || '';
  $('cfgOut').value = s.jamPulang || '';
  $('cfgTolerance').value = s.toleransiMenit ?? 0;
  $('cfgInStart').value = s.mulaiMasuk || '';
  $('cfgInEnd').value = s.batasMasuk || '';
  $('cfgOutStart').value = s.mulaiPulang || '';
  $('cfgOutEnd').value = s.batasPulang || '';
  $('cfgScheduleStatus').value = s.status || 'AKTIF';
}

async function saveOfficeLocation() {
  try {
    const lat = $('cfgLat')?.value || '';
    const lon = $('cfgLon')?.value || '';

    if (!lat || !lon || Number(lat) === 0 || Number(lon) === 0) {
      toast('Tekan Ambil Lokasi Saya Sekarang terlebih dahulu.');
      return;
    }

    await api('admin_upsert_location', {
      id: $('cfgLocId')?.value || '',
      nama: $('cfgLocName')?.value || '',
      alamat: $('cfgLocAddress')?.value || '',
      latitude: lat,
      longitude: lon,
      radius: $('cfgRadius')?.value || 100,
      akurasi: $('cfgAccuracy')?.value || 30,
      tipe: 'KANTOR',
      status: 'AKTIF'
    });

    stopAdminGeoWatch();
    toast('Lokasi kantor & radius tersimpan.');
    await showAdmin();
  } catch (e) { toast(e.message); }
}

async function saveSchedule() {
  try {
    await api('admin_upsert_schedule', {
      id: $('cfgScheduleId')?.value || '',
      nama: $('cfgScheduleName')?.value || 'Reguler',
      hari: $('cfgDay')?.value || '',
      jamMasuk: $('cfgIn')?.value || '',
      jamPulang: $('cfgOut')?.value || '',
      toleransiMenit: $('cfgTolerance')?.value || 0,
      mulaiMasuk: $('cfgInStart')?.value || '',
      batasMasuk: $('cfgInEnd')?.value || '',
      mulaiPulang: $('cfgOutStart')?.value || '',
      batasPulang: $('cfgOutEnd')?.value || '',
      status: $('cfgScheduleStatus')?.value || 'AKTIF'
    });

    toast('Jadwal kerja tersimpan.');
    await showAdmin();
  } catch (e) { toast(e.message); }
}

async function createActivity() {
  try {
    await api('admin_create_activity', {
      nama: $('adNama')?.value || '',
      tanggal: $('adTanggal')?.value || '',
      jamMulai: $('adMulai')?.value || '',
      jamSelesai: $('adSelesai')?.value || '',
      modeLokasi: 'RADIUS',
      idLokasi: $('adLokasi')?.value || '',
      wajibSelfie: true,
      aktif: true
    });

    toast('Kegiatan aktif.');
    await showAdmin();
  } catch (e) { toast(e.message); }
}

async function createAssignment() {
  try {
    await api('admin_create_assignment', {
      idPegawai: $('tgPegawai')?.value || '',
      jenisTugas: $('tgJenis')?.value || '',
      namaTugas: $('tgNama')?.value || '',
      tanggalMulai: $('tgMulai')?.value || '',
      tanggalSelesai: $('tgSelesai')?.value || '',
      modeLokasi: $('tgMode')?.value || 'LOKASI_AKTUAL',
      idLokasi: $('tgLokasi')?.value || '',
      wajibSelfie: true
    });

    toast('Penugasan disimpan.');
    await showAdmin();
  } catch (e) { toast(e.message); }
}

function showAccount() {
  stopAdminGeoWatch();
  navActive('navAccount');
  const m = $('mainContent');
  if (!m) return;

  safeHTML(m, `
    <div class="card">
      <h3>${currentUser?.nama || '-'}</h3>
      <div>${currentUser?.jabatan || '-'}</div>
      <div class="muted">${currentUser?.bidang || ''}</div>
      <div style="height:14px"></div>
      <div class="list-item">ID/NIP: ${currentUser?.nip || currentUser?.idPegawai || '-'}</div>
      <div class="list-item">Role: ${currentUser?.role || '-'}</div>
    </div>
  `);
}

async function init() {
  if (token) {
    setView(true);
    try {
      await afterLogin();
    } catch (_) {
      token = '';
      currentUser = null;
      localStorage.removeItem('abs_token');
      setView(false);
    }
  } else {
    setView(false);
  }
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
