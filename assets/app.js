const APP = {
  version: '2.7.0',
  api: '/api/gas',
  timeout: 30000,
  token: localStorage.getItem('abs_token') || '',
  user: null,
  home: null,
  homeFetchedAt: 0,
  heroClockTimer: null,
  activitiesFetchedAt: 0,
  assignmentsFetchedAt: 0,
  monthlyRecap: null,
  recapMonth: '',
  route: 'home',
  adminTab: 'overview',
  cameraStream: null,
  currentAttendance: null,
  currentCoords: null,
  currentLocationCheck: null,
  selfieData: '',
  busyCount: 0,
  adminData: {
    dashboard:null,
    employees:[],
    locations:[],
    schedules:[],
    apelSchedules:[],
    settings:[]
  }
};

const $ = (id) => document.getElementById(id);

const DEVICE = getOrCreateAttendanceDevice();

function randomHex(bytes=24){
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return [...arr].map(x => x.toString(16).padStart(2,'0')).join('');
}

function getOrCreateAttendanceDevice(){
  let id = localStorage.getItem('abs_device_id') || '';
  let key = localStorage.getItem('abs_device_key') || '';

  if(!id){
    id = (crypto.randomUUID ? crypto.randomUUID() : randomHex(16));
    localStorage.setItem('abs_device_id', id);
  }

  if(!key){
    key = randomHex(32);
    localStorage.setItem('abs_device_key', key);
  }

  return {id,key};
}

const qsa = (sel, root=document) => [...root.querySelectorAll(sel)];
const esc = (v='') => String(v ?? '').replace(/[&<>"']/g, s => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[s]));
const roleIsAdmin = () => ['ADMIN','SUPER_ADMIN'].includes(String(APP.user?.role || '').toUpperCase());

function toast(message, type='default', ms=2800){
  const root = $('toastRoot');
  if(!root) return;
  const el = document.createElement('div');
  el.className = `toast ${type === 'default' ? '' : type}`;
  el.textContent = message;
  root.appendChild(el);
  setTimeout(() => el.remove(), ms);
}

function setGlobalLoading(active, text='Memproses...'){
  const wrap = $('globalLoader');
  if(!wrap) return;
  if(active){
    APP.busyCount++;
    $('globalLoaderText').textContent = text;
    wrap.classList.remove('hidden');
  }else{
    APP.busyCount = Math.max(0, APP.busyCount - 1);
    if(APP.busyCount === 0) wrap.classList.add('hidden');
  }
}

async function api(action, payload={}, options={}){
  const controller = new AbortController();
  const timeoutMs =
    options.timeout ||
    (action === 'login' ? 35000 : 45000);
  const tid = setTimeout(() => controller.abort(), timeoutMs);
  if(options.loading) setGlobalLoading(true, options.loading);

  try{
    const res = await fetch(APP.api, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body:JSON.stringify({ action, token:APP.token, payload }),
      signal:controller.signal
    });

    let json;
    try{ json = await res.json(); }
    catch{ throw new Error('Respons server tidak dapat dibaca.'); }

    if(!json.ok) throw new Error(json.message || 'Proses gagal.');
    return json.data;
  }catch(e){
    if(e.name === 'AbortError') throw new Error('Server terlalu lama merespons.');
    throw e;
  }finally{
    clearTimeout(tid);
    if(options.loading) setGlobalLoading(false);
  }
}

function hideSplash(){
  const s=$('splash');
  if(!s || s.dataset.hiding==='1') return;

  s.dataset.hiding='1';

  // Beri sedikit waktu agar transisi terasa seperti aplikasi native,
  // tetapi jangan menghambat UI yang sudah siap.
  setTimeout(()=>{
    s.style.opacity='0';
    s.style.visibility='hidden';
    setTimeout(()=>s.remove(),300);
  },120);
}

function showLogin(){
  $('loginView').classList.remove('hidden');
  $('appView').classList.add('hidden');
  $('loginHint').textContent = `Aplikasi siap • V${APP.version}`;
  setTimeout(() => $('loginUser')?.focus(), 80);
}

function showApp(){
  $('loginView').classList.add('hidden');
  $('appView').classList.remove('hidden');
  $('headerAction').textContent = (APP.user?.nama || 'A').trim().slice(0,1).toUpperCase();
}

function setHeader(title){
  $('headerTitle').textContent = title;
}

function setActiveNav(route){
  qsa('.nav-item').forEach(b => b.classList.toggle('active', b.dataset.route === route));
}

function page(html){
  const root = $('pageRoot');
  root.innerHTML = html;
  root.style.animation='none';
  void root.offsetWidth;
  root.style.animation='';
  window.scrollTo({top:0,behavior:'smooth'});
}

function skeletonPage(){
  return `
    <div class="hero skeleton skel-big"></div>
    <div class="card">
      <div class="skeleton skel-line" style="width:42%"></div>
      <div class="skeleton skel-line"></div>
      <div class="skeleton skel-line" style="width:70%"></div>
    </div>`;
}

function fmtTime(v){
  if(!v) return '--:--';
  const s = String(v);
  const m = s.match(/(\d{1,2}):(\d{2})/);
  return m ? `${m[1].padStart(2,'0')}:${m[2]}` : s.slice(0,5);
}

function fmtDate(v){
  if(!v) return '-';

  const raw = String(v).slice(0,10);
  const parts = raw.split('-');
  if(parts.length !== 3) return raw;

  const [year, month, day] = parts;
  const months = [
    'Januari','Februari','Maret','April','Mei','Juni',
    'Juli','Agustus','September','Oktober','November','Desember'
  ];
  const idx = Number(month) - 1;
  if(idx < 0 || idx > 11) return raw;

  return `${Number(day)} ${months[idx]} ${year}`;
}


function haversineMeters(lat1,lon1,lat2,lon2){
  const R=6371000;
  const toRad=x=>x*Math.PI/180;
  const dLat=toRad(lat2-lat1);
  const dLon=toRad(lon2-lon1);
  const a=
    Math.sin(dLat/2)**2+
    Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLon/2)**2;

  return Math.round(2*R*Math.asin(Math.sqrt(a)));
}

function formatMeters(v){
  const n=Number(v);
  if(!Number.isFinite(n)) return '-';
  if(n>=1000) return `${(n/1000).toFixed(n>=10000 ? 0 : 1)} km`;
  return `${Math.round(n)} m`;
}

function getAttendanceLocationRule(type,ref){
  const t=String(type || '').toUpperCase();

  if(t==='MASUK' || t==='PULANG'){
    return APP.home?.attendanceLocation || null;
  }

  if(t==='APEL_PAGI' || t==='APEL_SORE'){
    const wanted=t==='APEL_SORE' ? 'SORE' : 'PAGI';
    const row=(APP.home?.apel || []).find(x=>
      String(x.idApel || '')===String(ref || '') ||
      String(x.jenisApel || '').toUpperCase()===wanted
    );
    return row?.locationRule || null;
  }

  if(t==='KEGIATAN'){
    const row=(APP.home?.todayActivities || []).find(
      x=>String(x.idKegiatan || '')===String(ref || '')
    );
    return row?.locationRule || null;
  }

  return null;
}

function evaluateAttendanceLocation(coords,rule){
  if(!coords){
    return {ok:false,reason:'GPS_INVALID'};
  }

  const accuracy=Math.round(Number(coords.accuracy) || 0);

  if(!rule){
    return {
      ok:true,
      reason:'RULE_SERVER',
      accuracy,
      distance:null,
      radius:null,
      locationName:'Lokasi absensi'
    };
  }

  const accuracyLimit=Number(rule.batasAkurasiMeter);
  const accuracyOk=
    !Number.isFinite(accuracyLimit) ||
    accuracy<=accuracyLimit;

  if(!accuracyOk){
    return {
      ok:false,
      reason:'ACCURACY',
      accuracy,
      accuracyLimit,
      distance:null,
      radius:Number(rule.radiusMeter),
      locationName:rule.locationName || 'Lokasi absensi'
    };
  }

  if(String(rule.mode || '').toUpperCase()==='LOKASI_AKTUAL'){
    return {
      ok:true,
      reason:'OK',
      accuracy,
      accuracyLimit,
      distance:null,
      radius:null,
      locationName:rule.locationName || 'Lokasi aktual'
    };
  }

  const lat=Number(rule.latitude);
  const lon=Number(rule.longitude);
  const radius=Number(rule.radiusMeter);

  if(!Number.isFinite(lat) || !Number.isFinite(lon)){
    return {
      ok:true,
      reason:'RULE_SERVER',
      accuracy,
      accuracyLimit,
      distance:null,
      radius:Number.isFinite(radius) ? radius : null,
      locationName:rule.locationName || 'Lokasi absensi'
    };
  }

  const distance=haversineMeters(
    Number(coords.latitude),
    Number(coords.longitude),
    lat,
    lon
  );

  if(Number.isFinite(radius) && distance>radius){
    return {
      ok:false,
      reason:'OUTSIDE',
      accuracy,
      accuracyLimit,
      distance,
      radius,
      locationName:rule.locationName || 'Lokasi absensi'
    };
  }

  return {
    ok:true,
    reason:'OK',
    accuracy,
    accuracyLimit,
    distance,
    radius:Number.isFinite(radius) ? radius : null,
    locationName:rule.locationName || 'Lokasi absensi'
  };
}

async function login(){
  const username = $('loginUser').value.trim();
  const pin = $('loginPin').value.trim();

  if(!username || !pin){
    toast('Username/ID/NIP dan PIN wajib diisi.','warning');
    return;
  }

  const btn = $('loginBtn');
  const old = btn.innerHTML;
  btn.disabled = true;
  btn.innerHTML = `<span class="spinner"></span><span>Memproses...</span>`;
  $('loginHint').textContent = 'Memeriksa akun...';

  try{
    const data = await api(
      'login',
      {
        username,
        pin,
        deviceInfo:navigator.userAgent
      },
      {timeout:35000}
    );

    APP.token = data.token;
    APP.user = data.user;
    APP.home = null;
    APP.homeFetchedAt = 0;

    localStorage.setItem('abs_token',APP.token);

    // Begitu autentikasi sukses, langsung masuk aplikasi.
    // Beranda diambil pada request terpisah agar login tidak timeout.
    showApp();
    setHeader('Beranda');
    setActiveNav('home');
    page(skeletonPage());

    toast('Login berhasil.','success');

    // Tidak menahan proses login.
    renderHome(true);

  }catch(e){
    toast(e.message,'error');
    $('loginHint').textContent = e.message;
  }finally{
    btn.disabled = false;
    btn.innerHTML = old;
  }
}

async function logout(){
  try{ if(APP.token) await api('logout',{},{}); }catch(_){}
  closeModal();
  APP.token='';
  APP.user=null;
  APP.home=null;
  localStorage.removeItem('abs_token');
  showLogin();
  toast('Anda sudah keluar.');
}

async function boot(){
  const splashSlowTimer=setTimeout(()=>{
    const t=$('splashText');
    if(t) t.textContent='Menghubungkan ke server...';
  },2500);

  $('loginBtn').addEventListener('click',login);
  $('loginPin').addEventListener('keydown',e=>{
    if(e.key==='Enter') login();
  });

  $('togglePinBtn').addEventListener('click',()=>{
    const i=$('loginPin');
    i.type=i.type==='password' ? 'text' : 'password';
  });

  $('headerAction').addEventListener('click',()=>navigate('account'));

  $('bottomNav').addEventListener('click',e=>{
    const b=e.target.closest('[data-route]');
    if(b) navigate(b.dataset.route);
  });

  document.addEventListener('pointerdown',e=>{
    const b=e.target.closest('button,.btn');
    if(!b || b.disabled) return;
    try{ navigator.vibrate?.(8); }catch(_){}
  },{passive:true});

  if(!APP.token){
    showLogin();
    clearTimeout(splashSlowTimer);
    hideSplash();
    return;
  }

  // Tampilkan shell aplikasi dulu supaya tidak terlihat blank.
  showApp();
  setHeader('Beranda');
  setActiveNav('home');
  page(skeletonPage());
  clearTimeout(splashSlowTimer);
  hideSplash();

  try{
    APP.home=await api('home',{}, {timeout:45000});
    APP.homeFetchedAt=Date.now();
    APP.user=APP.home?.user || APP.user;
    paintHome(APP.home);
  }catch(e){
    // Sesi invalid -> kembali ke login.
    if(/sesi|akun tidak aktif|login/i.test(String(e.message || ''))){
      APP.token='';
      APP.user=null;
      APP.home=null;
      localStorage.removeItem('abs_token');
      showLogin();
      toast('Silakan login kembali.','warning');
      return;
    }

    page(`
      <div class="card">
        <div class="inline-note bad">${esc(e.message)}</div>
        <button id="retryHomeBtn" class="btn primary block" type="button" style="margin-top:12px">
          Coba Lagi
        </button>
      </div>
    `);

    $('retryHomeBtn')?.addEventListener('click',()=>renderHome(true));
  }
}

async function navigate(route){
  if(route === 'admin' && !roleIsAdmin()){
    toast('Menu ini hanya untuk Admin/Super Admin.','warning');
    return;
  }
  APP.route = route;
  setActiveNav(route);

  if(route === 'home'){ setHeader('Beranda'); return renderHome(false); }
  if(route === 'history'){ setHeader('Rekap'); return renderHistory(); }
  if(route === 'leave'){ setHeader('Izin / Sakit'); return renderLeave(); }
  if(route === 'admin'){ setHeader('Admin'); return renderAdmin(); }
  if(route === 'account'){ setHeader('Akun'); return renderAccount(); }
}

async function renderHome(force=false){
  const freshEnough =
    APP.home &&
    (Date.now()-APP.homeFetchedAt < 30000);

  if(APP.home && !force){
    paintHome(APP.home);

    if(freshEnough) return;

    api('home',{}, {timeout:45000})
      .then(data=>{
        APP.home=data;
        APP.homeFetchedAt=Date.now();
        APP.user={...APP.user,...(data?.user||{})};

        if(APP.route==='home') paintHome(APP.home);
      })
      .catch(()=>{});

    return;
  }

  page(skeletonPage());

  try{
    APP.home=await api('home',{}, {timeout:45000});
    APP.homeFetchedAt=Date.now();
    paintHome(APP.home);
  }catch(e){
    page(`
      <div class="card">
        <div class="inline-note bad">${esc(e.message)}</div>
        <button id="retryHomeBtn" class="btn primary block" type="button" style="margin-top:12px">
          Coba Lagi
        </button>
      </div>
    `);
    $('retryHomeBtn')?.addEventListener('click',()=>renderHome(true));
  }
}

function paintHome(data){
  const d=data || {};
  const server=d.server || {};
  const schedule=d.schedule || null;
  const att=d.attendance || {};
  const user=d.user || APP.user || {};
  const isTplp=!!user.isTplp;

  APP.user={...APP.user,...user};

  const regularCard=isTplp ? `
    <div class="card schedule-summary-card">
      <div class="card-title-row">
        <h2>${esc(schedule?.nama || 'Jadwal Hari Ini')}</h2>
        <span class="badge info">${schedule ? 'AKTIF' : 'BELUM ADA'}</span>
      </div>

      ${schedule ? `
        <div class="schedule-main">
          <div>
            <div class="muted small">Jadwal Reguler TPLP</div>
            <div class="schedule-hours">${esc(fmtTime(schedule.jamMasuk))} - ${esc(fmtTime(schedule.jamPulang))}</div>
          </div>
          <div class="schedule-date">${esc(server.day || '-')}<br>${esc(fmtDate(server.date))}</div>
        </div>

        <div class="today-status-line">
          <div><span>Masuk</span><b>${att.masuk?.waktu ? esc(fmtTime(att.masuk.waktu)) : '-'}</b></div>
          <div><span>Pulang</span><b>${att.pulang?.waktu ? esc(fmtTime(att.pulang.waktu)) : '-'}</b></div>
        </div>
      ` : `<div class="empty-state"><div class="empty-icon">◷</div>Belum ada jadwal reguler TPLP hari ini.</div>`}
    </div>
  ` : '';

  page(`
    <div class="home-profile">
      <div class="home-profile-avatar">${esc((user.nama || 'A').slice(0,1).toUpperCase())}</div>
      <div class="home-profile-copy">
        <div class="home-profile-name">${esc(user.nama || '-')}</div>
        <div class="home-profile-id">${esc(user.bidang || '-')}</div>
      </div>
    </div>

    <div class="hero">
      <div class="hero-day">${esc(server.day || '-')}</div>
      <div class="hero-time" id="liveHeroClock">${esc(fmtTime(server.time))}</div>
      <div class="hero-date">${esc(fmtDate(server.date))}</div>
    </div>

    ${regularCard}

    <div class="main-menu-section">
      <div class="main-menu-title">Menu Utama</div>
      <div class="main-menu-grid core-focus ${isTplp ? 'tplp-core' : 'asn-core'}">
        ${isTplp ? mainMenuTile('ABSEN','🗓️','Absen') : ''}
        ${isTplp ? mainMenuTile('APEL','👥','Apel') : ''}
        ${mainMenuTile('KEGIATAN','✅','Kegiatan')}
        ${inactiveMenuTile('DINAS','💼','Dinas')}
        ${inactiveMenuTile('IZIN','📄','Izin')}
        ${inactiveMenuTile('DIKLAT','🎓','Diklat')}
      </div>
    </div>
  `);

  qsa('[data-main-menu]').forEach(btn=>{
    btn.addEventListener('click',()=>openMainMenu(btn.dataset.mainMenu));
  });

  qsa('[data-disabled-menu]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      toast('Fitur ini belum diaktifkan.','warning');
    });
  });

  startLocalHeroClock(server.time);
}

function startLocalHeroClock(serverTime){
  clearInterval(APP.heroClockTimer);

  const parts=String(serverTime||'').match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
  if(!parts) return;

  const baseSeconds=
    Number(parts[1])*3600+
    Number(parts[2])*60+
    Number(parts[3]||0);

  const started=Date.now();

  const tick=()=>{
    const el=$('liveHeroClock');
    if(!el || APP.route!=='home') return;

    const elapsed=Math.floor((Date.now()-started)/1000);
    const total=(baseSeconds+elapsed)%86400;
    const hh=String(Math.floor(total/3600)).padStart(2,'0');
    const mm=String(Math.floor((total%3600)/60)).padStart(2,'0');
    el.textContent=`${hh}:${mm}`;
  };

  tick();
  APP.heroClockTimer=setInterval(tick,1000);
}

function mainMenuTile(key,icon,label){
  return `
    <button class="main-menu-item" data-main-menu="${esc(key)}" type="button">
      <span class="main-menu-icon">${icon}</span>
      <span class="main-menu-label">${label}</span>
    </button>`;
}

function inactiveMenuTile(key,icon,label){
  return `
    <button class="main-menu-tile inactive" type="button"
      data-disabled-menu="${esc(key)}"
      aria-label="${esc(label)} belum aktif">
      <span class="main-menu-icon">${icon}</span>
      <span class="main-menu-label">${esc(label)}</span>
      <span class="main-menu-badge">Belum Aktif</span>
    </button>
  `;
}

function normalizeActivityType(x){
  const explicit = String(x?.jenisKegiatan || '').toUpperCase().trim();
  if(['RAPAT','DIKLAT'].includes(explicit)) return explicit;

  const name = String(x?.nama || '').toUpperCase();
  if(name.includes('RAPAT')) return 'RAPAT';
  if(name.includes('DIKLAT') || name.includes('PELATIHAN') || name.includes('BIMTEK')) return 'DIKLAT';
  return 'KEGIATAN';
}

function openMainMenu(key){
  if(key==='ABSEN') return openRegularAttendanceMenu();
  if(key==='APEL') return openApelMenu();
  if(key==='KEGIATAN') return openActivityMenu();
}

function openRegularAttendanceMenu(){
  const isTplp = !!(APP.home?.user?.isTplp ?? APP.user?.isTplp);
  if(!isTplp){
    toast('Absen harian hanya digunakan untuk TPLP.','warning');
    return;
  }

  const schedule = APP.home?.schedule;
  const att = APP.home?.attendance || {};

  if(!schedule){
    toast('Jadwal kerja hari ini belum tersedia.','warning');
    return;
  }

  if(!att.masuk){
    return confirmAttendance('MASUK','', 'Absen Masuk');
  }

  if(!att.pulang){
    return confirmAttendance('PULANG','', 'Absen Pulang');
  }

  toast('Absen masuk dan pulang hari ini sudah lengkap.','success');
}

function confirmAttendance(type,ref,title){
  openModal(`
    <div class="confirm-box">
      <div class="confirm-icon">ⓘ</div>
      <h2>${esc(title)}</h2>
      <p>Apakah Anda yakin akan melanjutkan ${esc(title.toLowerCase())}?</p>
      <div class="form-actions">
        <button id="confirmNoBtn" class="btn ghost" type="button">Tidak</button>
        <button id="confirmYesBtn" class="btn primary" type="button">Ya</button>
      </div>
    </div>
  `);

  $('confirmNoBtn').addEventListener('click', closeModal);
  $('confirmYesBtn').addEventListener('click', async()=>{
    closeModal();
    await openAttendance(type,ref,title);
  });
}


function apelStatusLabel(status){
  const s = String(status || '');
  if(s === 'SUDAH_ABSEN') return 'Sudah Absen';
  if(s === 'AKTIF') return 'Absen Sekarang';
  if(s === 'BELUM_DIBUKA') return 'Belum Dibuka';
  if(s === 'SELESAI') return 'Sudah Ditutup';
  return 'Belum Diatur';
}

function apelStatusClass(status){
  const s = String(status || '');
  if(s === 'SUDAH_ABSEN') return 'success';
  if(s === 'AKTIF') return 'info';
  if(s === 'SELESAI') return 'danger';
  return 'warning';
}

function openApelMenu(){
  const isTplp=!!(APP.home?.user?.isTplp ?? APP.user?.isTplp);

  if(!isTplp){
    toast('Apel saat ini khusus TPLP.','warning');
    return;
  }

  const rows = APP.home?.apel || [];

  if(!rows.length){
    toast('Jadwal Apel belum diatur oleh Admin.','warning');
    return;
  }

  const order = {PAGI:1,SORE:2};
  const sorted = [...rows].sort((a,b)=>(order[a.jenisApel]||9)-(order[b.jenisApel]||9));

  openModal(`
    <div class="modal-head">
      <h2>Absensi Apel</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>

    <div class="apel-user-list">
      ${sorted.map((x,i)=>`
        <div class="apel-user-card">
          <div class="apel-user-top">
            <div>
              <div class="apel-user-title">${esc(x.nama || ('Apel '+x.jenisApel))}</div>
              <div class="list-meta">${esc(x.lokasiNama || '-')}</div>
            </div>
            <span class="badge ${apelStatusClass(x.status)}">${apelStatusLabel(x.status)}</span>
          </div>

          <div class="apel-user-time">
            ${esc(fmtTime(x.jamMulai))} - ${esc(fmtTime(x.jamBatas))}
          </div>

          <button
            class="btn ${x.status === 'AKTIF' ? 'primary' : 'ghost'} block apel-attend-btn"
            type="button"
            data-apel-index="${i}"
            ${x.status === 'AKTIF' ? '' : 'disabled'}>
            ${x.status === 'AKTIF' ? 'Mulai Apel' : apelStatusLabel(x.status)}
          </button>
        </div>
      `).join('')}
    </div>
  `);

  qsa('[data-apel-index]', $('modalRoot')).forEach(btn=>{
    btn.addEventListener('click', ()=>{
      const x = sorted[Number(btn.dataset.apelIndex)];
      if(!x || x.status !== 'AKTIF') return;

      closeModal();
      const type = x.jenisApel === 'SORE' ? 'APEL_SORE' : 'APEL_PAGI';
      confirmAttendance(type, x.idApel, x.nama || `Apel ${x.jenisApel}`);
    });
  });
}

async function ensureActivitiesLoaded(){
  const fresh =
    APP.home?.todayActivities &&
    (Date.now()-APP.activitiesFetchedAt < 60000);

  if(fresh) return APP.home.todayActivities;

  const rows=await api(
    'today_activities',
    {},
    {loading:'Memuat kegiatan...',timeout:45000}
  );

  APP.home=APP.home || {};
  APP.home.todayActivities=rows || [];
  APP.home.activeActivities=(rows || []).filter(
    x=>x.statusWaktu==='AKTIF' || !x.statusWaktu
  );
  APP.activitiesFetchedAt=Date.now();

  return APP.home.todayActivities;
}

async function openActivityMenu(){
  let allToday=[];

  try{
    allToday=await ensureActivitiesLoaded();
  }catch(e){
    toast(e.message,'error');
    return;
  }

  if(!allToday.length){
    toast('Tidak ada kegiatan yang ditugaskan untuk Anda hari ini.','warning');
    return;
  }

  const active=allToday.filter(
    x=>(x.statusWaktu==='AKTIF' || !x.statusWaktu) && !x.sudahAbsen
  );

  if(active.length===1){
    const x=active[0];
    return confirmAttendance(
      'KEGIATAN',
      x.idKegiatan,
      x.nama
    );
  }

  openModal(`
    <div class="modal-head">
      <h2>Kegiatan Hari Ini</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>

    <div class="list">
      ${allToday.map((x,i)=>{
        const done=!!x.sudahAbsen;
        const activeNow=(x.statusWaktu==='AKTIF' || !x.statusWaktu) && !done;

        let status='Belum Dibuka';
        let cls='warning';

        if(done){
          status='Sudah Absen';
          cls='success';
        }else if(activeNow){
          status='Absen Sekarang';
          cls='info';
        }else if(x.statusWaktu==='SELESAI'){
          status='Ditutup';
          cls='danger';
        }

        return `
          <div class="list-item">
            <div class="list-top">
              <div>
                <div class="list-title">${esc(x.nama)}</div>
                <div class="list-meta">${esc(fmtTime(x.jamMulai))} - ${esc(fmtTime(x.jamSelesai))}</div>
              </div>
              <span class="badge ${cls}">${status}</span>
            </div>

            ${activeNow ? `
              <button class="btn primary block activity-attend-btn"
                type="button"
                data-activity-index="${i}"
                style="margin-top:10px">
                Absen Kegiatan
              </button>
            ` : ''}
          </div>
        `;
      }).join('')}
    </div>
  `);

  qsa('[data-activity-index]',$('modalRoot')).forEach(btn=>{
    btn.addEventListener('click',()=>{
      const x=allToday[Number(btn.dataset.activityIndex)];
      if(!x) return;

      closeModal();
      confirmAttendance(
        'KEGIATAN',
        x.idKegiatan,
        x.nama
      );
    });
  });
}

async function ensureAssignmentsLoaded(){
  const fresh =
    APP.home?.assignments &&
    (Date.now()-APP.assignmentsFetchedAt < 60000);

  if(fresh) return APP.home.assignments;

  const rows=await api(
    'my_assignments',
    {},
    {loading:'Memuat dinas...',timeout:45000}
  );

  APP.home=APP.home || {};
  APP.home.assignments=rows || [];
  APP.assignmentsFetchedAt=Date.now();

  return APP.home.assignments;
}

async function openAssignmentMenu(){
  let list=[];

  try{
    list=await ensureAssignmentsLoaded();
  }catch(e){
    toast(e.message,'error');
    return;
  }

  if(!list.length){
    toast('Tidak ada Dinas/Tugas Lapangan aktif untuk Anda.','warning');
    return;
  }

  if(list.length===1){
    const x=list[0];
    const title=
      x.jenisTugas==='DINAS_LUAR'
        ? `Dinas: ${x.namaTugas}`
        : `Tugas Lapangan: ${x.namaTugas}`;

    return confirmAttendance(
      x.jenisTugas,
      x.idTugas,
      title
    );
  }

  openModal(`
    <div class="modal-head">
      <h2>Pilih Dinas / Tugas</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>
    <div class="list">
      ${list.map((x,i)=>`
        <button class="list-item activity-choice" type="button" data-task-index="${i}">
          <div class="list-title">${esc(x.namaTugas)}</div>
          <div class="list-meta">${esc(x.jenisTugas==='DINAS_LUAR' ? 'Dinas Luar' : 'Tugas Lapangan')}</div>
        </button>`).join('')}
    </div>
  `);

  qsa('[data-task-index]',$('modalRoot')).forEach(btn=>{
    btn.addEventListener('click',()=>{
      const x=list[Number(btn.dataset.taskIndex)];
      const title=
        x.jenisTugas==='DINAS_LUAR'
          ? `Dinas: ${x.namaTugas}`
          : `Tugas Lapangan: ${x.namaTugas}`;

      closeModal();
      confirmAttendance(
        x.jenisTugas,
        x.idTugas,
        title
      );
    });
  });
}

function currentRecapMonth(){
  if(APP.recapMonth) return APP.recapMonth;

  const serverDate=APP.home?.server?.date || '';
  if(/^\d{4}-\d{2}-\d{2}$/.test(serverDate)){
    return serverDate.slice(0,7);
  }

  const d=new Date();
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`;
}

function fmtMonthYear(monthKey){
  const months=[
    'Januari','Februari','Maret','April','Mei','Juni',
    'Juli','Agustus','September','Oktober','November','Desember'
  ];

  const m=String(monthKey || '').match(/^(\d{4})-(\d{2})$/);
  if(!m) return monthKey || '-';

  return `${months[Number(m[2])-1]} ${m[1]}`;
}

function recapMetric(label,value,sub,kind='blue'){
  return `
    <div class="recap-metric ${kind}">
      <div class="recap-metric-label">${esc(label)}</div>
      <div class="recap-metric-value">${esc(String(value ?? 0))}</div>
      <div class="recap-metric-sub">${esc(sub || '')}</div>
      <div class="recap-metric-bar"></div>
    </div>
  `;
}

function recapAction(icon,title,sub,key){
  return `
    <button class="recap-action" type="button" data-recap-detail="${esc(key)}">
      <span class="recap-action-icon">${icon}</span>
      <span class="recap-action-copy">
        <b>${esc(title)}</b>
        <small>${esc(sub)}</small>
      </span>
      <span class="recap-action-arrow">›</span>
    </button>
  `;
}

async function renderHistory(){
  APP.recapMonth=currentRecapMonth();
  page(skeletonPage());
  await loadMonthlyRecap(APP.recapMonth);
}

async function loadMonthlyRecap(monthKey){
  APP.recapMonth=monthKey;

  try{
    const data=await api(
      'monthly_recap',
      {month:monthKey},
      {loading:'Memuat rekap...',timeout:45000}
    );

    APP.monthlyRecap=data;
    paintMonthlyRecap(data);
  }catch(e){
    page(`
      <div class="card">
        <div class="inline-note bad">${esc(e.message)}</div>
        <button id="retryRecapBtn" class="btn primary block" type="button" style="margin-top:12px">
          Coba Lagi
        </button>
      </div>
    `);

    $('retryRecapBtn')?.addEventListener('click',()=>{
      loadMonthlyRecap(APP.recapMonth);
    });
  }
}

function paintMonthlyRecap(data){
  const user=data?.user || APP.user || {};
  const isTplp=!!user.isTplp;
  const month=data?.month || APP.recapMonth;
  const daily=data?.daily?.summary || {};
  const apel=data?.apel?.summary || {};
  const act=data?.activities?.summary || {};

  const tplpSummary=isTplp ? `
    <div class="recap-metrics-grid">
      ${recapMetric('Hadir',daily.hadir || 0,`dari ${daily.hariKerja || 0} hari kerja`,'green')}
      ${recapMetric('Tanpa Keterangan',daily.tanpaKeterangan || 0,'hari','red')}
      ${recapMetric('Terlambat',daily.terlambat || 0,'kali','orange')}
      ${recapMetric('Pulang Cepat',daily.pulangCepat || 0,'kali','yellow')}
      ${recapMetric('Tidak Lengkap',daily.tidakLengkap || 0,'hari','blue')}
    </div>
  ` : `
    <div class="recap-metrics-grid asn-recap-grid">
      ${recapMetric('Kegiatan Wajib',act.wajib || 0,'kegiatan','blue')}
      ${recapMetric('Hadir',act.hadir || 0,'kegiatan','green')}
      ${recapMetric('Tidak Hadir',act.tidakHadir || 0,'kegiatan selesai','red')}
    </div>
  `;

  const tplpActions=isTplp ? `
    ${recapAction('🗓️','Rekap Absen Harian',`Hadir ${daily.hadir || 0} dari ${daily.hariKerja || 0} hari kerja`,'daily')}
    ${recapAction('👥','Rekap Apel',`Hadir ${apel.hadir || 0} dari ${apel.wajib || 0} sesi`,'apel')}
    ${recapAction('✅','Rekap Kegiatan',`Hadir ${act.hadir || 0} dari ${act.wajib || 0} kegiatan wajib`,'activities')}
  ` : `
    ${recapAction('✅','Rekap Kegiatan',`Hadir ${act.hadir || 0} dari ${act.wajib || 0} kegiatan wajib`,'activities')}
  `;

  page(`
    <div class="recap-page-title">Rekap Saya</div>

    <div class="card recap-summary-card">
      <div class="recap-summary-head">
        <div>
          <div class="recap-summary-title">Rekap Absensi</div>
          <div class="recap-summary-sub">${esc(isTplp ? 'TPLP' : 'ASN')} • ${esc(user.bidang || '-')}</div>
        </div>

        <label class="recap-month-picker">
          <span>Bulan - Tahun</span>
          <input id="recapMonthInput" type="month" value="${esc(month)}">
        </label>
      </div>

      <div class="recap-month-label">${esc(fmtMonthYear(month))}</div>

      ${tplpSummary}
    </div>

    <div class="recap-actions">
      ${tplpActions}
    </div>
  `);

  $('recapMonthInput')?.addEventListener('change',e=>{
    const val=e.target.value;
    if(val) loadMonthlyRecap(val);
  });

  qsa('[data-recap-detail]').forEach(btn=>{
    btn.addEventListener('click',()=>{
      openRecapDetail(btn.dataset.recapDetail);
    });
  });
}

function recapStatusBadge(status){
  const s=String(status || '').toUpperCase();

  let cls='info';
  if(['HADIR','TERLAMBAT','PULANG_CEPAT'].includes(s)) cls='success';
  if(['TANPA_KETERANGAN','TIDAK_HADIR'].includes(s)) cls='danger';
  if(['TIDAK_LENGKAP','MENUNGGU'].includes(s)) cls='warning';

  return `<span class="badge ${cls}">${esc(s.replaceAll('_',' '))}</span>`;
}

function openRecapDetail(kind){
  const data=APP.monthlyRecap || {};
  const month=fmtMonthYear(data.month || APP.recapMonth);

  if(kind==='daily'){
    const rows=data.daily?.detail || [];

    openModal(`
      <div class="modal-head">
        <h2>Rekap Absen Harian</h2>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="list-meta recap-detail-month">${esc(month)}</div>

      <div class="list recap-detail-list">
        ${rows.length ? rows.map(r=>`
          <div class="list-item">
            <div class="list-top">
              <div>
                <div class="list-title">${esc(fmtDate(r.tanggal))}</div>
                <div class="list-meta">
                  Masuk ${esc(r.masuk || '-')} • Pulang ${esc(r.pulang || '-')}
                </div>
              </div>
              ${recapStatusBadge(r.status)}
            </div>
          </div>
        `).join('') : empty('Belum ada data rekap bulan ini.')}
      </div>
    `);
    return;
  }

  if(kind==='apel'){
    const rows=data.apel?.detail || [];

    openModal(`
      <div class="modal-head">
        <h2>Rekap Apel</h2>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="list-meta recap-detail-month">${esc(month)}</div>

      <div class="list recap-detail-list">
        ${rows.length ? rows.map(r=>`
          <div class="list-item">
            <div class="list-top">
              <div>
                <div class="list-title">${esc(r.nama || ('Apel '+r.jenis))}</div>
                <div class="list-meta">
                  ${esc(fmtDate(r.tanggal))} ${r.waktu ? `• ${esc(r.waktu)}` : ''}
                </div>
              </div>
              ${recapStatusBadge(r.status)}
            </div>
          </div>
        `).join('') : empty('Belum ada jadwal Apel pada bulan ini.')}
      </div>
    `);
    return;
  }

  if(kind==='activities'){
    const rows=data.activities?.detail || [];

    openModal(`
      <div class="modal-head">
        <h2>Rekap Kegiatan</h2>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>
      <div class="list-meta recap-detail-month">${esc(month)}</div>

      <div class="list recap-detail-list">
        ${rows.length ? rows.map(r=>`
          <div class="list-item">
            <div class="list-top">
              <div>
                <div class="list-title">${esc(r.nama || '-')}</div>
                <div class="list-meta">
                  ${esc(fmtDate(r.tanggal))} • ${esc(fmtTime(r.jamMulai))}-${esc(fmtTime(r.jamSelesai))}
                  ${r.waktuAbsen ? ` • Absen ${esc(r.waktuAbsen)}` : ''}
                </div>
              </div>
              ${recapStatusBadge(r.status)}
            </div>
          </div>
        `).join('') : empty('Belum ada kegiatan wajib pada bulan ini.')}
      </div>
    `);
  }
}

function historyRow(r){
  const st = String(r.status || '');
  const cls = (st.includes('TERLAMBAT') || st.includes('PULANG_CEPAT')) ? 'warning' : st.includes('DITOLAK') ? 'danger' : 'success';
  return `
    <div class="list-item">
      <div class="list-top">
        <div><div class="list-title">${esc(r.jenis || '-')}</div><div class="list-meta">${esc(fmtDate(r.tanggal))} • ${esc(fmtTime(r.waktu))}</div></div>
        <span class="badge ${cls}">${esc((st || '-').replaceAll('_',' '))}</span>
      </div>
    </div>`;
}

async function renderLeave(){
  page(`
    <div class="card">
      <div class="card-title-row"><h2>Ajukan Izin / Sakit</h2></div>
      <div class="form-grid">
        <label class="field"><span>Jenis</span>
          <select id="leaveType"><option>IZIN</option><option>SAKIT</option></select>
        </label>
        <label class="field"><span>Tanggal Mulai</span><input id="leaveStart" type="date"></label>
        <label class="field"><span>Tanggal Selesai</span><input id="leaveEnd" type="date"></label>
        <label class="field"><span>Alasan</span><textarea id="leaveReason" placeholder="Tulis alasan"></textarea></label>
      </div>
      <button id="submitLeaveBtn" class="btn primary block" type="button">Kirim Pengajuan</button>
    </div>
    <div id="leaveHistoryCard" class="card">${skeletonInline()}</div>
  `);

  $('submitLeaveBtn').addEventListener('click', submitLeave);
  await loadLeaveHistory();
}

async function submitLeave(){
  const jenis = $('leaveType').value;
  const tanggalMulai = $('leaveStart').value;
  const tanggalSelesai = $('leaveEnd').value;
  const alasan = $('leaveReason').value.trim();
  if(!tanggalMulai || !tanggalSelesai || !alasan){
    toast('Lengkapi tanggal dan alasan.','warning'); return;
  }

  const btn = $('submitLeaveBtn');
  await busyButton(btn, async() => {
    await api('submit_leave',{jenis,tanggalMulai,tanggalSelesai,alasan});
    toast('Pengajuan berhasil dikirim.','success');
    $('leaveReason').value='';
    await loadLeaveHistory();
  }, 'Mengirim...');
}

async function loadLeaveHistory(){
  const c = $('leaveHistoryCard');
  if(!c) return;
  try{
    const rows = await api('my_leaves');
    c.innerHTML = `
      <div class="card-title-row"><h2>Riwayat Pengajuan</h2><span class="badge">${rows.length} data</span></div>
      ${rows.length ? `<div class="list">${rows.map(r => `
        <div class="list-item">
          <div class="list-top">
            <div>
              <div class="list-title">${esc(r.jenis)}</div>
              <div class="list-meta">${esc(r.mulai)} s.d. ${esc(r.selesai)}</div>
            </div>
            <span class="badge ${String(r.status).includes('DITOLAK')?'danger':String(r.status).includes('DISETUJUI')?'success':'warning'}">${esc(r.status)}</span>
          </div>
          <div class="list-meta">${esc(r.alasan || '')}</div>
        </div>`).join('')}</div>` : empty('Belum ada pengajuan.')}`;
  }catch(e){
    c.innerHTML = `<div class="inline-note bad">${esc(e.message)}</div>`;
  }
}

async function renderAdmin(){
  page(skeletonPage());
  try{
    await loadAdminBase();
    renderAdminShell();
  }catch(e){
    page(`<div class="card"><div class="inline-note bad">${esc(e.message)}</div></div>`);
  }
}

async function loadAdminBase(){
  const [dashboard, employees, locations, schedules, apelSchedules] = await Promise.all([
    api('admin_dashboard'),
    api('admin_employees'),
    api('admin_locations'),
    api('admin_schedules'),
    api('admin_apel_schedules')
  ]);

  APP.adminData.dashboard = dashboard;
  APP.adminData.employees = employees || [];
  APP.adminData.locations = locations || [];
  APP.adminData.schedules = schedules || [];
  APP.adminData.apelSchedules = apelSchedules || [];

  try{
    APP.adminData.settings = await api('admin_settings');
  }catch(_){
    APP.adminData.settings = [];
  }
}

function renderAdminShell(){
  page(`
    <div class="section-tabs">
      ${adminTabBtn('overview','Ringkasan')}
      ${adminTabBtn('location','Lokasi & Radius')}
      ${adminTabBtn('schedule','Jadwal')}
      ${adminTabBtn('apel','Apel')}
      ${adminTabBtn('activity','Kegiatan')}
      ${adminTabBtn('employees','Pegawai')}
    </div>
    <div id="adminPanel"></div>
  `);

  qsa('.tab-btn').forEach(b => b.addEventListener('click', () => {
    APP.adminTab = b.dataset.tab;
    qsa('.tab-btn').forEach(x => x.classList.toggle('active',x===b));
    renderAdminPanel();
  }));

  renderAdminPanel();
}

function adminTabBtn(id,label){
  return `<button class="tab-btn ${APP.adminTab===id?'active':''}" data-tab="${id}" type="button">${label}</button>`;
}

function renderAdminPanel(){
  const p = $('adminPanel');
  if(!p) return;
  if(APP.adminTab==='overview') p.innerHTML = adminOverview();
  if(APP.adminTab==='location') p.innerHTML = adminLocation();
  if(APP.adminTab==='schedule') p.innerHTML = adminSchedule();
  if(APP.adminTab==='apel') p.innerHTML = adminApel();
  if(APP.adminTab==='activity') p.innerHTML = adminActivity();
  if(APP.adminTab==='employees') p.innerHTML = adminEmployees();
  bindAdminPanel();
}

function adminOverview(){
  const d = APP.adminData.dashboard || {};
  return `
    <div class="card">
      <div class="card-title-row"><h2>Ringkasan Admin</h2><span class="badge info">${esc(d.tanggal || '')}</span></div>
      <div class="admin-kpi">
        <div class="stat"><div class="stat-label">Pegawai Aktif</div><div class="stat-value">${esc(d.totalPegawai ?? 0)}</div></div>
        <div class="stat"><div class="stat-label">Transaksi Hari Ini</div><div class="stat-value">${esc(d.totalTransaksiHariIni ?? 0)}</div></div>
        <div class="stat"><div class="stat-label">Masuk</div><div class="stat-value">${esc(d.masuk ?? 0)}</div></div>
        <div class="stat"><div class="stat-label">Terlambat</div><div class="stat-value">${esc(d.terlambat ?? 0)}</div></div>
      </div>
    </div>`;
}

function adminLocation(){
  const loc = APP.adminData.locations.find(x => String(x.tipe).toUpperCase()==='KANTOR') || {};
  return `
    <div class="card">
      <div class="card-title-row"><h2>Lokasi Kantor & Radius</h2><span class="badge info">Admin</span></div>
      <input id="locId" type="hidden" value="${esc(loc.id || '')}">
      <label class="field"><span>Nama Lokasi</span><input id="locName" value="${esc(loc.nama || 'Kantor DPUPR KSB')}"></label>
      <label class="field"><span>Alamat</span><textarea id="locAddress">${esc(loc.alamat || '')}</textarea></label>

      <button id="getLocationBtn" class="btn yellow block location-btn" type="button">📍 Ambil Lokasi Saya Sekarang</button>
      <div id="locationStatus" class="inline-note">${loc.latitude ? `Titik tersimpan: ${esc(loc.latitude)}, ${esc(loc.longitude)}` : 'Belum ada titik lokasi tersimpan.'}</div>

      <div class="form-grid">
        <label class="field"><span>Latitude</span><input id="locLat" inputmode="decimal" value="${esc(loc.latitude ?? '')}"></label>
        <label class="field"><span>Longitude</span><input id="locLon" inputmode="decimal" value="${esc(loc.longitude ?? '')}"></label>
        <label class="field"><span>Radius (meter)</span><input id="locRadius" type="number" min="1" value="${esc(loc.radius ?? 100)}"></label>
        <label class="field"><span>Batas Akurasi GPS (meter)</span><input id="locAccuracy" type="number" min="1" value="${esc(loc.akurasi ?? 30)}"></label>
      </div>

      <button id="saveLocationBtn" class="btn primary block" type="button">Simpan Lokasi & Radius</button>
    </div>`;
}

function adminSchedule(){
  const options = APP.adminData.schedules.map((s,i)=>`<option value="${i}">${esc(s.hari)} • ${esc(fmtTime(s.jamMasuk))}-${esc(fmtTime(s.jamPulang))}</option>`).join('');
  return `
    <div class="card">
      <div class="card-title-row"><h2>Jadwal Kerja</h2><span class="badge">${APP.adminData.schedules.length} jadwal</span></div>
      <label class="field"><span>Pilih Jadwal</span><select id="schedulePicker"><option value="">+ Buat baru</option>${options}</select></label>
      <input id="schId" type="hidden">
      <div class="form-grid">
        <label class="field"><span>Nama Jadwal</span><input id="schName" value="Reguler"></label>
        <label class="field"><span>Hari</span>
          <select id="schDay">${['SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU','MINGGU'].map(x=>`<option>${x}</option>`).join('')}</select>
        </label>
        <label class="field"><span>Jam Masuk</span><input id="schIn" type="time"></label>
        <label class="field"><span>Jam Pulang</span><input id="schOut" type="time"></label>
        <label class="field"><span>Toleransi Terlambat (menit)</span><input id="schTolerance" type="number" min="0" value="0"></label>
        <label class="field"><span>Status</span><select id="schStatus"><option>AKTIF</option><option>NONAKTIF</option></select></label>
        <label class="field"><span>Mulai Absen Masuk</span><input id="schInStart" type="time"></label>
        <label class="field"><span>Batas Absen Masuk</span><input id="schInEnd" type="time"></label>
        <label class="field"><span>Mulai Absen Pulang</span><input id="schOutStart" type="time"></label>
        <label class="field"><span>Batas Absen Pulang</span><input id="schOutEnd" type="time"></label>
      </div>
      <button id="saveScheduleBtn" class="btn primary block" type="button">Simpan Jadwal</button>
    </div>`;
}


function getAdminApelRecord(type){
  const t = String(type).toUpperCase();
  return APP.adminData.apelSchedules.find(x => String(x.jenisApel).toUpperCase() === t) || {};
}

function getAdminApelLocation(type){
  const t = 'APEL_' + String(type).toUpperCase();
  return APP.adminData.locations.find(x => String(x.tipe).toUpperCase() === t) || {};
}

function apelDayChecks(type, selectedCsv){
  const selected = String(selectedCsv || 'SENIN,SELASA,RABU,KAMIS,JUMAT')
    .split(',')
    .map(x=>x.trim().toUpperCase());

  return ['SENIN','SELASA','RABU','KAMIS','JUMAT','SABTU','MINGGU'].map(day=>`
    <label class="day-check">
      <input type="checkbox" data-apel-day="${type}" value="${day}" ${selected.includes(day) ? 'checked' : ''}>
      <span>${day.slice(0,3)}</span>
    </label>
  `).join('');
}

function apelAdminCard(type){
  const t = String(type).toUpperCase();
  const schedule = getAdminApelRecord(t);
  const loc = getAdminApelLocation(t);
  const pagi = t === 'PAGI';

  const defaultName = pagi ? 'Apel Pagi' : 'Apel Sore';
  const defaultLocation = pagi ? 'Depan Kantor Bupati' : 'Kantor DPUPR';

  return `
    <div class="card apel-admin-card" data-apel-card="${t}">
      <div class="card-title-row">
        <h2>${defaultName}</h2>
        <span class="badge info">${pagi ? 'Kantor Bupati' : 'DPUPR'}</span>
      </div>

      <input id="apel${t}ScheduleId" type="hidden" value="${esc(schedule.idApel || '')}">
      <input id="apel${t}LocationId" type="hidden" value="${esc(loc.id || '')}">

      <label class="field">
        <span>Nama Apel</span>
        <input id="apel${t}Name" value="${esc(schedule.nama || defaultName)}">
      </label>

      <div class="form-grid">
        <label class="field">
          <span>Mulai Absen</span>
          <input id="apel${t}Start" type="time" value="${esc(fmtTime(schedule.jamMulai || ''))}">
        </label>
        <label class="field">
          <span>Batas Absen</span>
          <input id="apel${t}End" type="time" value="${esc(fmtTime(schedule.jamBatas || ''))}">
        </label>
      </div>

      <div class="field">
        <span>Hari Berlaku</span>
        <div class="day-check-grid">
          ${apelDayChecks(t, schedule.hari)}
        </div>
      </div>

      <label class="field">
        <span>Nama Lokasi</span>
        <input id="apel${t}LocName" value="${esc(loc.nama || defaultLocation)}">
      </label>

      <label class="field">
        <span>Alamat</span>
        <textarea id="apel${t}Address" placeholder="Alamat lokasi apel">${esc(loc.alamat || '')}</textarea>
      </label>

      <button id="apel${t}GpsBtn" class="btn yellow block" type="button">
        📍 Ambil Lokasi Saya Sekarang
      </button>

      <div id="apel${t}GpsStatus" class="inline-note">
        ${loc.latitude ? `Titik tersimpan: ${esc(loc.latitude)}, ${esc(loc.longitude)}` : 'Belum ada titik lokasi tersimpan.'}
      </div>

      <div class="form-grid">
        <label class="field">
          <span>Latitude</span>
          <input id="apel${t}Lat" inputmode="decimal" value="${esc(loc.latitude ?? '')}">
        </label>
        <label class="field">
          <span>Longitude</span>
          <input id="apel${t}Lon" inputmode="decimal" value="${esc(loc.longitude ?? '')}">
        </label>
        <label class="field">
          <span>Radius (meter)</span>
          <input id="apel${t}Radius" type="number" min="1" value="${esc(loc.radius ?? 100)}">
        </label>
        <label class="field">
          <span>Batas Akurasi GPS (meter)</span>
          <input id="apel${t}Accuracy" type="number" min="1" value="${esc(loc.akurasi ?? 30)}">
        </label>
      </div>

      <button id="apel${t}SaveBtn" class="btn primary block" type="button">
        Simpan ${defaultName}
      </button>
    </div>
  `;
}

function adminApel(){
  return `
    <div class="apel-admin-grid">
      ${apelAdminCard('PAGI')}
      ${apelAdminCard('SORE')}
    </div>
  `;
}

async function captureAdminApelGps(type){
  const t = String(type).toUpperCase();
  const btn = $(`apel${t}GpsBtn`);
  const status = $(`apel${t}GpsStatus`);

  if(!navigator.geolocation){
    toast('GPS tidak didukung perangkat ini.','error');
    return;
  }

  btn.disabled = true;
  btn.innerHTML = '<span class="spinner dark"></span>Mencari lokasi...';
  status.className = 'inline-note';
  status.textContent = 'Mencari titik GPS terbaik...';

  let best = null;
  let watch = null;
  let timer = null;

  try{
    await new Promise((resolve,reject)=>{
      const target = Math.max(5, Number($(`apel${t}Accuracy`).value || 30));

      watch = navigator.geolocation.watchPosition(pos=>{
        if(!best || pos.coords.accuracy < best.coords.accuracy){
          best = pos;
          $(`apel${t}Lat`).value = Number(pos.coords.latitude).toFixed(7);
          $(`apel${t}Lon`).value = Number(pos.coords.longitude).toFixed(7);
          status.textContent = `Lokasi ditemukan • akurasi ±${Math.round(pos.coords.accuracy)} meter`;
        }

        if(pos.coords.accuracy <= target) resolve();
      }, reject, {
        enableHighAccuracy:true,
        maximumAge:0,
        timeout:12000
      });

      timer = setTimeout(()=>{
        best ? resolve() : reject(new Error('GPS belum menemukan lokasi.'));
      },15000);
    });

    status.className='inline-note good';
    status.textContent=`Lokasi siap • akurasi terbaik ±${Math.round(best.coords.accuracy)} meter`;
    toast('Lokasi apel berhasil diambil.','success');

  }catch(e){
    status.className='inline-note bad';
    status.textContent=e.message || 'Lokasi tidak dapat diambil.';
    toast(status.textContent,'error');

  }finally{
    if(watch !== null) navigator.geolocation.clearWatch(watch);
    if(timer) clearTimeout(timer);
    btn.disabled = false;
    btn.textContent = '📍 Ambil Lokasi Saya Sekarang';
  }
}

function selectedApelDays(type){
  const t = String(type).toUpperCase();
  return qsa(`[data-apel-day="${t}"]:checked`)
    .map(x=>x.value)
    .join(',');
}

async function saveAdminApel(type){
  const t = String(type).toUpperCase();
  const pagi = t === 'PAGI';

  const locationPayload = {
    id:$(`apel${t}LocationId`).value,
    nama:$(`apel${t}LocName`).value.trim(),
    alamat:$(`apel${t}Address`).value.trim(),
    latitude:$(`apel${t}Lat`).value,
    longitude:$(`apel${t}Lon`).value,
    radius:$(`apel${t}Radius`).value,
    akurasi:$(`apel${t}Accuracy`).value,
    tipe:`APEL_${t}`,
    status:'AKTIF'
  };

  const schedulePayload = {
    id:$(`apel${t}ScheduleId`).value,
    jenisApel:t,
    nama:$(`apel${t}Name`).value.trim() || (pagi ? 'Apel Pagi' : 'Apel Sore'),
    hari:selectedApelDays(t),
    jamMulai:$(`apel${t}Start`).value,
    jamBatas:$(`apel${t}End`).value,
    wajibSelfie:true,
    status:'AKTIF'
  };

  if(!locationPayload.nama || !locationPayload.latitude || !locationPayload.longitude){
    toast('Nama dan titik lokasi apel wajib diisi.','warning');
    return;
  }

  if(!schedulePayload.hari || !schedulePayload.jamMulai || !schedulePayload.jamBatas){
    toast('Hari, mulai absen, dan batas absen wajib diisi.','warning');
    return;
  }

  const btn = $(`apel${t}SaveBtn`);

  await busyButton(btn, async()=>{
    const locResult = await api('admin_upsert_location', locationPayload);
    schedulePayload.idLokasi = locResult.id;

    await api('admin_upsert_apel_schedule', schedulePayload);

    toast(`${pagi ? 'Apel Pagi' : 'Apel Sore'} berhasil disimpan.`,'success');

    await loadAdminBase();
    renderAdminPanel();

  },'Menyimpan...');
}

function activityBidangOptions(){
  const names=[...new Set(
    (APP.adminData.employees || [])
      .map(x=>String(x.bidang || '').trim())
      .filter(Boolean)
  )].sort((a,b)=>a.localeCompare(b,'id'));

  return names
    .map(x=>`<option value="${esc(x)}">${esc(x)}</option>`)
    .join('');
}

function activityEmployeeChecklist(){
  const rows=(APP.adminData.employees || [])
    .slice()
    .sort((a,b)=>String(a.nama || '').localeCompare(String(b.nama || ''),'id'));

  return rows.map(x=>`
    <label class="participant-check"
      data-participant-name="${esc((x.nama || '').toLowerCase())}"
      data-participant-bidang="${esc((x.bidang || '').toLowerCase())}">
      <input type="checkbox"
        data-activity-participant
        value="${esc(x.idPegawai)}">
      <span>
        <b>${esc(x.nama)}</b>
        <small>${esc(x.bidang || '-')} • ${esc(x.jenisPegawai || (x.isTplp ? 'TPLP' : 'ASN'))}</small>
      </span>
    </label>
  `).join('');
}

function adminActivity(){
  const locOptions=(APP.adminData.locations || [])
    .map(x=>`<option value="${esc(x.id)}">${esc(x.nama)}</option>`)
    .join('');

  return `
    <div class="card">
      <div class="card-title-row">
        <h2>Buat Kegiatan</h2>
        <span class="badge info">Peserta Wajib</span>
      </div>

      <label class="field">
        <span>Nama Kegiatan</span>
        <input id="actName" placeholder="Contoh: Rapat Evaluasi / Gotong Royong / Sosialisasi">
      </label>

      <div class="form-grid">
        <label class="field">
          <span>Tanggal</span>
          <input id="actDate" type="date">
        </label>

        <label class="field">
          <span>Lokasi</span>
          <select id="actLocation">${locOptions}</select>
        </label>

        <label class="field">
          <span>Mulai Absen</span>
          <input id="actStart" type="time">
        </label>

        <label class="field">
          <span>Batas Absen</span>
          <input id="actEnd" type="time">
        </label>
      </div>

      <div class="participant-section">
        <div class="field">
          <span>Peserta Kegiatan</span>
          <select id="actParticipantMode">
            <option value="SEMUA">Semua Pegawai</option>
            <option value="ASN">ASN Saja</option>
            <option value="TPLP">TPLP Saja</option>
            <option value="BIDANG">Bidang/Subbag Tertentu</option>
            <option value="PILIH">Pilih Pegawai Tertentu</option>
          </select>
        </div>

        <div id="actBidangWrap" class="field hidden">
          <span>Pilih Bidang/Subbag</span>
          <select id="actParticipantBidang">
            <option value="">-- pilih --</option>
            ${activityBidangOptions()}
          </select>
        </div>

        <div id="actCustomWrap" class="hidden">
          <label class="field">
            <span>Cari Pegawai</span>
            <input id="actParticipantSearch" placeholder="Ketik nama atau bidang">
          </label>

          <div class="participant-toolbar">
            <span id="actParticipantCount">0 dipilih</span>
            <button id="actSelectAllVisible" class="btn ghost compact" type="button">
              Pilih yang Tampil
            </button>
          </div>

          <div id="actParticipantList" class="participant-list">
            ${activityEmployeeChecklist()}
          </div>
        </div>
      </div>

      <button id="saveActivityBtn" class="btn primary block" type="button">
        Simpan Kegiatan
      </button>
    </div>
  `;
}

function adminAssignment(){
  const emps = APP.adminData.employees.map(x => `<option value="${esc(x.idPegawai)}">${esc(x.nama)}</option>`).join('');
  const locs = APP.adminData.locations.map(x => `<option value="${esc(x.id)}">${esc(x.nama)}</option>`).join('');
  return `
    <div class="card">
      <div class="card-title-row"><h2>Penugasan</h2><span class="badge info">Admin</span></div>
      <label class="field"><span>Pegawai</span><select id="taskEmployee">${emps}</select></label>
      <div class="form-grid">
        <label class="field"><span>Jenis</span><select id="taskType"><option value="TUGAS_LAPANGAN">TUGAS LAPANGAN</option><option value="DINAS_LUAR">DINAS LUAR</option></select></label>
        <label class="field"><span>Mode Lokasi</span><select id="taskMode"><option value="LOKASI_AKTUAL">LOKASI AKTUAL</option><option value="RADIUS">RADIUS</option></select></label>
      </div>
      <label class="field"><span>Nama Tugas</span><input id="taskName"></label>
      <div class="form-grid">
        <label class="field"><span>Tanggal Mulai</span><input id="taskStart" type="date"></label>
        <label class="field"><span>Tanggal Selesai</span><input id="taskEnd" type="date"></label>
      </div>
      <label class="field"><span>Lokasi (opsional jika Lokasi Aktual)</span><select id="taskLocation"><option value="">-- pilih --</option>${locs}</select></label>
      <button id="saveAssignmentBtn" class="btn primary block" type="button">Simpan Penugasan</button>
    </div>`;
}

function adminEmployees(){
  const rows = APP.adminData.employees || [];
  return `
    <div class="card">
      <div class="card-title-row"><h2>Pegawai</h2><span class="badge">${rows.length} orang</span></div>
      <div class="list">
        ${rows.map(x => `
          <div class="list-item">
            <div class="list-top">
              <div>
                <div class="list-title">${esc(x.nama)}</div>
                <div class="list-meta">${esc(x.jabatan || '-')} • ${esc(x.bidang || '-')} • ${esc(x.jenisPegawai || (x.isTplp ? 'TPLP' : 'ASN'))}</div>
                <div class="list-meta">ID/NIP: ${esc(x.nip || x.idPegawai)}</div>
                <div class="list-meta">Perangkat Absen: ${x.deviceRegistered ? 'TERDAFTAR' : 'BELUM TERDAFTAR'}</div>
              </div>
              <span class="badge info">${esc(x.role)}</span>
            </div>
            <button class="btn ghost block" type="button" data-reset-pin="${esc(x.idPegawai)}" data-name="${esc(x.nama)}" style="margin-top:10px">Reset PIN</button>
            <button class="btn danger block" type="button" data-reset-device="${esc(x.idPegawai)}" data-name="${esc(x.nama)}" style="margin-top:8px">Reset Perangkat Absen</button>
          </div>`).join('')}
      </div>
    </div>`;
}

function bindAdminPanel(){
  if(APP.adminTab==='location'){
    $('getLocationBtn')?.addEventListener('click', getAdminLocation);
    $('saveLocationBtn')?.addEventListener('click', saveAdminLocation);
  }
  if(APP.adminTab==='schedule'){
    $('schedulePicker')?.addEventListener('change', loadScheduleForm);
    $('saveScheduleBtn')?.addEventListener('click', saveSchedule);
  }
  if(APP.adminTab==='apel'){
    ['PAGI','SORE'].forEach(t=>{
      $(`apel${t}GpsBtn`)?.addEventListener('click', ()=>captureAdminApelGps(t));
      $(`apel${t}SaveBtn`)?.addEventListener('click', ()=>saveAdminApel(t));
    });
  }
  if(APP.adminTab==='activity'){
    $('saveActivityBtn')?.addEventListener('click', saveActivity);
    $('actParticipantMode')?.addEventListener('change', updateActivityParticipantUi);
    $('actParticipantSearch')?.addEventListener('input', filterActivityParticipants);
    $('actSelectAllVisible')?.addEventListener('click', selectVisibleActivityParticipants);
    qsa('[data-activity-participant]').forEach(x=>{
      x.addEventListener('change', updateActivityParticipantCount);
    });
    updateActivityParticipantUi();
    updateActivityParticipantCount();
  }
  if(APP.adminTab==='employees'){
    qsa('[data-reset-pin]').forEach(b => b.addEventListener('click', () => openPinReset(b.dataset.resetPin,b.dataset.name)));
    qsa('[data-reset-device]').forEach(b => b.addEventListener('click', () => openDeviceReset(b.dataset.resetDevice,b.dataset.name)));
  }
}

async function getAdminLocation(){
  const btn = $('getLocationBtn');
  if(!navigator.geolocation){
    toast('GPS tidak didukung perangkat ini.','error'); return;
  }
  btn.disabled=true;
  btn.innerHTML='<span class="spinner dark"></span>Mencari lokasi...';
  const status = $('locationStatus');
  status.className='inline-note';
  status.textContent='Mencari titik GPS terbaik...';

  let best=null, watch=null, timer=null;
  try{
    await new Promise((resolve,reject)=>{
      const target = Math.max(5, Number($('locAccuracy').value || 30));
      watch = navigator.geolocation.watchPosition(pos=>{
        if(!best || pos.coords.accuracy < best.coords.accuracy){
          best=pos;
          $('locLat').value=Number(pos.coords.latitude).toFixed(7);
          $('locLon').value=Number(pos.coords.longitude).toFixed(7);
          status.textContent=`Lokasi ditemukan • akurasi ±${Math.round(pos.coords.accuracy)} meter`;
        }
        if(pos.coords.accuracy <= target) resolve();
      }, reject, {enableHighAccuracy:true,maximumAge:0,timeout:12000});
      timer=setTimeout(()=> best ? resolve() : reject(new Error('GPS belum menemukan lokasi.')),15000);
    });
    status.className='inline-note good';
    status.textContent=`Lokasi siap • akurasi terbaik ±${Math.round(best.coords.accuracy)} meter`;
    toast('Lokasi berhasil diambil.','success');
  }catch(e){
    status.className='inline-note bad';
    status.textContent=e.message || 'Lokasi tidak dapat diambil.';
    toast(status.textContent,'error');
  }finally{
    if(watch!==null) navigator.geolocation.clearWatch(watch);
    if(timer) clearTimeout(timer);
    btn.disabled=false;
    btn.textContent='📍 Ambil Lokasi Saya Sekarang';
  }
}

async function saveAdminLocation(){
  const payload = {
    id:$('locId').value,
    nama:$('locName').value.trim(),
    alamat:$('locAddress').value.trim(),
    latitude:$('locLat').value,
    longitude:$('locLon').value,
    radius:$('locRadius').value,
    akurasi:$('locAccuracy').value,
    tipe:'KANTOR',
    status:'AKTIF'
  };
  if(!payload.nama || !payload.latitude || !payload.longitude || Number(payload.latitude)===0 || Number(payload.longitude)===0){
    toast('Nama dan titik lokasi wajib diisi.','warning'); return;
  }

  const btn=$('saveLocationBtn');
  await busyButton(btn, async()=>{
    await api('admin_upsert_location',payload);
    toast('Lokasi & radius tersimpan.','success');
    await loadAdminBase();
    renderAdminPanel();
  },'Menyimpan...');
}

function loadScheduleForm(){
  const v=$('schedulePicker').value;
  if(v===''){
    $('schId').value=''; $('schName').value='Reguler'; $('schTolerance').value='0'; return;
  }
  const s=APP.adminData.schedules[Number(v)];
  if(!s) return;
  $('schId').value=s.id||'';
  $('schName').value=s.nama||'Reguler';
  $('schDay').value=s.hari||'SENIN';
  $('schIn').value=fmtTime(s.jamMasuk);
  $('schOut').value=fmtTime(s.jamPulang);
  $('schTolerance').value=s.toleransiMenit??0;
  $('schInStart').value=fmtTime(s.mulaiMasuk);
  $('schInEnd').value=fmtTime(s.batasMasuk);
  $('schOutStart').value=fmtTime(s.mulaiPulang);
  $('schOutEnd').value=fmtTime(s.batasPulang);
  $('schStatus').value=s.status||'AKTIF';
}

async function saveSchedule(){
  const payload={
    id:$('schId').value,nama:$('schName').value.trim(),hari:$('schDay').value,
    jamMasuk:$('schIn').value,jamPulang:$('schOut').value,toleransiMenit:$('schTolerance').value,
    mulaiMasuk:$('schInStart').value,batasMasuk:$('schInEnd').value,
    mulaiPulang:$('schOutStart').value,batasPulang:$('schOutEnd').value,status:$('schStatus').value
  };
  if(!payload.hari || !payload.jamMasuk || !payload.jamPulang){
    toast('Hari, jam masuk dan jam pulang wajib diisi.','warning'); return;
  }
  const btn=$('saveScheduleBtn');
  await busyButton(btn, async()=>{
    await api('admin_upsert_schedule',payload);
    toast('Jadwal tersimpan.','success');
    await loadAdminBase();
    renderAdminPanel();
  },'Menyimpan...');
}

function updateActivityParticipantUi(){
  const mode=$('actParticipantMode')?.value || 'SEMUA';
  $('actBidangWrap')?.classList.toggle('hidden',mode!=='BIDANG');
  $('actCustomWrap')?.classList.toggle('hidden',mode!=='PILIH');
}

function selectedActivityParticipantIds(){
  return qsa('[data-activity-participant]:checked')
    .map(x=>x.value);
}

function updateActivityParticipantCount(){
  const el=$('actParticipantCount');
  if(el) el.textContent=`${selectedActivityParticipantIds().length} dipilih`;
}

function filterActivityParticipants(){
  const q=String($('actParticipantSearch')?.value || '').trim().toLowerCase();

  qsa('.participant-check').forEach(row=>{
    const hay=`${row.dataset.participantName || ''} ${row.dataset.participantBidang || ''}`;
    row.classList.toggle('hidden',!!q && !hay.includes(q));
  });
}

function selectVisibleActivityParticipants(){
  const visible=qsa('.participant-check').filter(row=>!row.classList.contains('hidden'));
  const boxes=visible.map(row=>row.querySelector('[data-activity-participant]')).filter(Boolean);
  const shouldCheck=boxes.some(x=>!x.checked);

  boxes.forEach(x=>x.checked=shouldCheck);
  updateActivityParticipantCount();
}

async function saveActivity(){
  const mode=$('actParticipantMode').value;

  const payload={
    nama:$('actName').value.trim(),
    tanggal:$('actDate').value,
    jamMulai:$('actStart').value,
    jamSelesai:$('actEnd').value,
    idLokasi:$('actLocation').value,
    wajibSelfie:true,
    aktif:true,
    pesertaMode:mode,
    pesertaBidang:$('actParticipantBidang')?.value || '',
    pesertaIds:mode==='PILIH' ? selectedActivityParticipantIds() : []
  };

  if(!payload.nama || !payload.tanggal || !payload.jamMulai || !payload.jamSelesai){
    toast('Nama, tanggal, mulai absen, dan batas absen wajib diisi.','warning');
    return;
  }

  if(mode==='BIDANG' && !payload.pesertaBidang){
    toast('Pilih Bidang/Subbag peserta.','warning');
    return;
  }

  if(mode==='PILIH' && !payload.pesertaIds.length){
    toast('Pilih minimal satu pegawai.','warning');
    return;
  }

  const btn=$('saveActivityBtn');

  await busyButton(btn,async()=>{
    const result=await api('admin_create_activity',payload);

    toast(
      `Kegiatan tersimpan untuk ${result.jumlahPeserta || 0} peserta.`,
      'success'
    );

    $('actName').value='';
    qsa('[data-activity-participant]').forEach(x=>x.checked=false);
    updateActivityParticipantCount();
  },'Menyimpan...');
}

async function saveAssignment(){
  const payload={
    idPegawai:$('taskEmployee').value,jenisTugas:$('taskType').value,
    namaTugas:$('taskName').value.trim(),tanggalMulai:$('taskStart').value,tanggalSelesai:$('taskEnd').value,
    modeLokasi:$('taskMode').value,idLokasi:$('taskLocation').value,wajibSelfie:true
  };
  if(!payload.idPegawai || !payload.namaTugas || !payload.tanggalMulai || !payload.tanggalSelesai){
    toast('Lengkapi data penugasan.','warning'); return;
  }
  const btn=$('saveAssignmentBtn');
  await busyButton(btn, async()=>{
    await api('admin_create_assignment',payload);
    toast('Penugasan berhasil disimpan.','success');
    $('taskName').value='';
  },'Menyimpan...');
}

function openPinReset(id,name){
  openModal(`
    <div class="modal-head"><h2>Reset PIN</h2><button class="modal-close" onclick="closeModal()">✕</button></div>
    <div class="inline-note">Pegawai: <b>${esc(name)}</b></div>
    <label class="field"><span>PIN Baru</span><input id="newPin" type="text" inputmode="numeric" placeholder="Masukkan PIN baru"></label>
    <button id="confirmPinBtn" class="btn primary block" type="button">Simpan PIN</button>
  `);
  $('confirmPinBtn').addEventListener('click', async()=>{
    const pin=$('newPin').value.trim();
    if(!pin){toast('PIN baru wajib diisi.','warning');return;}
    await busyButton($('confirmPinBtn'), async()=>{
      await api('admin_reset_pin',{idPegawai:id,pin});
      toast('PIN berhasil diubah.','success');
      closeModal();
    },'Menyimpan...');
  });
}


function openDeviceReset(id,name){
  openModal(`
    <div class="modal-head">
      <h2>Reset Perangkat Absen</h2>
      <button class="modal-close" onclick="closeModal()">✕</button>
    </div>

    <div class="inline-note warn">
      Pegawai: <b>${esc(name)}</b><br>
      Setelah di-reset, perangkat berikutnya yang melakukan absensi akan menjadi HP resmi baru.
    </div>

    <div class="form-actions">
      <button id="cancelDeviceResetBtn" class="btn ghost" type="button">Batal</button>
      <button id="confirmDeviceResetBtn" class="btn danger" type="button">Reset Perangkat</button>
    </div>
  `);

  $('cancelDeviceResetBtn').addEventListener('click', closeModal);

  $('confirmDeviceResetBtn').addEventListener('click', async()=>{
    await busyButton($('confirmDeviceResetBtn'), async()=>{
      await api('admin_reset_device',{idPegawai:id});
      toast('Perangkat absensi berhasil di-reset.','success');
      closeModal();
      await loadAdminBase();
      renderAdminPanel();
    },'Mereset...');
  });
}

async function renderAccount(){
  const u=APP.user||{};

  page(`
    <div class="card">
      <div class="profile-head">
        <div class="profile-avatar">${esc((u.nama||'A').slice(0,1).toUpperCase())}</div>
        <div>
          <div class="profile-name">${esc(u.nama||'-')}</div>
          <div class="muted">${esc(u.jabatan||'-')}</div>
        </div>
      </div>
    </div>

    <div class="card">
      <div class="list">
        <div class="list-item">
          <div class="list-title">ID / NIP</div>
          <div class="list-meta">${esc(u.nip || u.idPegawai || '-')}</div>
        </div>

        <div class="list-item">
          <div class="list-title">Bidang</div>
          <div class="list-meta">${esc(u.bidang || '-')}</div>
        </div>

        <div class="list-item">
          <div class="list-title">Jenis Pegawai</div>
          <div class="list-meta">${esc(u.jenisPegawai || (u.isTplp ? 'TPLP' : 'ASN'))}</div>
        </div>

        <div class="list-item">
          <div class="list-title">Email Google</div>
          <div class="list-meta">${esc(u.email || 'Belum diisi')}</div>
        </div>

        <div class="list-item">
          <div class="list-title">Perangkat Absen</div>
          <div class="list-meta" id="deviceStatusText">Memeriksa...</div>
        </div>

        <div class="list-item">
          <div class="list-title">Role</div>
          <div class="list-meta">${esc(u.role || '-')}</div>
        </div>
      </div>

      ${roleIsAdmin()
        ? `<button id="openAdminBtn" class="btn secondary block" style="margin-top:14px" type="button">⚙ Panel Admin</button>`
        : ''}

      <button id="logoutBtn" class="btn danger block" style="margin-top:10px" type="button">
        Keluar dari Aplikasi
      </button>
    </div>
  `);

  $('openAdminBtn')?.addEventListener('click',()=>navigate('admin'));
  $('logoutBtn')?.addEventListener('click',logout);

  try{
    const state=await api(
      'device_status',
      {
        deviceId:DEVICE.id,
        deviceKey:DEVICE.key
      },
      {timeout:30000}
    );

    const el=$('deviceStatusText');
    if(el) el.textContent=state?.label || 'Belum diaktifkan';

    if(state?.currentDevice){
      APP.user={...APP.user,deviceRegistered:true};
      if(APP.home?.user){
        APP.home.user.deviceRegistered=true;
      }
    }
  }catch(e){
    const el=$('deviceStatusText');
    if(el) el.textContent='Tidak dapat memeriksa';
  }
}

function openModal(html,panelClass=''){
  const root=$('modalRoot');
  root.innerHTML=`<div class="modal-panel ${esc(panelClass)}">${html}</div>`;
  root.classList.remove('hidden');
}

function closeModal(){
  stopCamera();
  const root=$('modalRoot');
  root.classList.add('hidden');
  root.innerHTML='';
}

async function openAttendance(type,ref,title){
  APP.currentAttendance={type,ref,title};
  APP.currentCoords=null;
  APP.currentLocationCheck=null;
  APP.selfieData='';

  openModal(`
    <div class="attendance-flow attendance-checking">
      <div class="modal-head">
        <h2>${esc(title)}</h2>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>

      <div class="attendance-locating">
        <span class="spinner dark"></span>
        <b>Memeriksa lokasi...</b>
        <small>GPS dicari dulu sebelum kamera dibuka.</small>
      </div>
    </div>
  `,'attendance-modal-panel');

  try{
    const coords=await getBestAttendancePosition();

    if(!coords || !$('modalRoot') || $('modalRoot').classList.contains('hidden')){
      return;
    }

    APP.currentCoords=coords;

    const rule=getAttendanceLocationRule(type,ref);
    const check=evaluateAttendanceLocation(coords,rule);
    APP.currentLocationCheck=check;

    if(!check.ok){
      return renderAttendanceLocationBlocked(check);
    }

    renderAttendanceCamera(check);
    await startCamera();
  }catch(e){
    renderAttendanceGpsError(e);
  }
}

function getBestAttendancePosition(){
  return new Promise((resolve,reject)=>{
    if(!navigator.geolocation){
      reject(new Error('GPS tidak didukung oleh perangkat ini.'));
      return;
    }

    let best=null;
    let watchId=null;
    let timer=null;
    let finished=false;

    const done=(err)=>{
      if(finished) return;
      finished=true;

      if(watchId!==null){
        try{ navigator.geolocation.clearWatch(watchId); }catch(_){}
      }
      if(timer) clearTimeout(timer);

      if(best){
        resolve(best.coords);
      }else{
        reject(err || new Error('GPS tidak dapat dibaca.'));
      }
    };

    try{
      watchId=navigator.geolocation.watchPosition(pos=>{
        if(!best || pos.coords.accuracy < best.coords.accuracy){
          best=pos;
        }

        if(pos.coords.accuracy<=20){
          done();
        }
      },err=>done(err),{
        enableHighAccuracy:true,
        maximumAge:3000,
        timeout:8000
      });

      timer=setTimeout(()=>done(),6500);
    }catch(e){
      done(e);
    }
  });
}

function renderAttendanceLocationBlocked(check){
  const outside=check.reason==='OUTSIDE';
  const accuracyBad=check.reason==='ACCURACY';

  const title=outside
    ? 'Di luar radius lokasi'
    : accuracyBad
      ? 'Akurasi GPS belum cukup'
      : 'Lokasi belum dapat digunakan';

  const message=outside
    ? 'Anda berada di luar radius lokasi absensi.'
    : accuracyBad
      ? 'GPS belum cukup akurat. Coba lagi di area yang lebih terbuka.'
      : 'Lokasi belum dapat diverifikasi.';

  const details=[
    check.locationName ? `Lokasi: ${check.locationName}` : '',
    Number.isFinite(Number(check.distance))
      ? `Jarak: ${formatMeters(check.distance)}`
      : '',
    Number.isFinite(Number(check.radius))
      ? `Radius: ${formatMeters(check.radius)}`
      : '',
    `Akurasi GPS: ±${Math.round(Number(check.accuracy)||0)} m`
  ].filter(Boolean);

  openModal(`
    <div class="attendance-flow attendance-blocked">
      <div class="attendance-warning-icon">ⓘ</div>
      <h2>${esc(title)}</h2>
      <p>${esc(message)}</p>

      <div class="attendance-warning-details">
        ${details.map(x=>`<span>${esc(x)}</span>`).join('')}
      </div>

      <div class="form-actions attendance-block-actions">
        <button id="closeLocationBlockBtn" class="btn ghost" type="button">Tutup</button>
        <button id="retryLocationBtn" class="btn primary" type="button">Coba GPS Lagi</button>
      </div>
    </div>
  `,'attendance-modal-panel');

  $('closeLocationBlockBtn')?.addEventListener('click',closeModal);
  $('retryLocationBtn')?.addEventListener('click',()=>{
    const x=APP.currentAttendance;
    if(x) openAttendance(x.type,x.ref,x.title);
  });
}

function renderAttendanceGpsError(err){
  openModal(`
    <div class="attendance-flow attendance-blocked">
      <div class="attendance-warning-icon">!</div>
      <h2>GPS tidak tersedia</h2>
      <p>${esc(err?.message || 'GPS tidak dapat dibaca.')}</p>
      <div class="form-actions">
        <button id="closeGpsErrorBtn" class="btn ghost" type="button">Tutup</button>
        <button id="retryGpsBtn" class="btn primary" type="button">Coba Lagi</button>
      </div>
    </div>
  `,'attendance-modal-panel');

  $('closeGpsErrorBtn')?.addEventListener('click',closeModal);
  $('retryGpsBtn')?.addEventListener('click',()=>{
    const x=APP.currentAttendance;
    if(x) openAttendance(x.type,x.ref,x.title);
  });
}

function renderAttendanceCamera(check){
  const locationLine=Number.isFinite(Number(check.distance))
    ? `${check.locationName || 'Lokasi'} • Jarak ${formatMeters(check.distance)}`
    : (check.locationName || 'Lokasi absensi');

  const radiusLine=Number.isFinite(Number(check.radius))
    ? `Radius ${formatMeters(check.radius)} • Akurasi ±${Math.round(Number(check.accuracy)||0)} m`
    : `Akurasi ±${Math.round(Number(check.accuracy)||0)} m`;

  openModal(`
    <div class="attendance-flow attendance-camera-step">
      <div class="attendance-compact-head">
        <div>
          <b>${esc(APP.currentAttendance?.title || 'Absensi')}</b>
          <span>Lokasi sesuai ✓</span>
        </div>
        <button class="modal-close" onclick="closeModal()">✕</button>
      </div>

      <div class="attendance-location-strip">
        <b>${esc(locationLine)}</b>
        <span>${esc(radiusLine)}</span>
      </div>

      <div class="camera-wrap attendance-camera-wrap">
        <video id="attVideo" autoplay playsinline muted></video>
        <canvas id="attCanvas"></canvas>
        <img id="attPreview" class="hidden" alt="Selfie">
      </div>

      <label class="field attendance-note compact">
        <span>Keterangan (opsional)</span>
        <input id="attNote" maxlength="300" placeholder="Boleh dikosongkan">
      </label>

      <div class="form-actions attendance-sticky-actions">
        <button id="captureBtn" class="btn secondary" type="button">Ambil Selfie</button>
        <button id="submitAttendBtn" class="btn primary" type="button" disabled>Kirim Absen</button>
      </div>
    </div>
  `,'attendance-modal-panel');

  $('captureBtn')?.addEventListener('click',captureSelfie);
  $('submitAttendBtn')?.addEventListener('click',submitAttendance);
}

async function startCamera(){
  try{
    APP.cameraStream=await navigator.mediaDevices.getUserMedia({
      video:{
        facingMode:'user',
        width:{ideal:480},
        height:{ideal:360}
      },
      audio:false
    });

    const video=$('attVideo');
    if(video) video.srcObject=APP.cameraStream;
  }catch(e){
    toast('Kamera tidak dapat dibuka. Periksa izin kamera.','error');
  }
}

function stopCamera(){
  if(APP.cameraStream){
    APP.cameraStream.getTracks().forEach(t=>t.stop());
    APP.cameraStream=null;
  }
}

async function captureSelfie(){
  const video=$('attVideo');
  const canvas=$('attCanvas');
  const preview=$('attPreview');
  const btn=$('captureBtn');

  if(APP.selfieData){
    APP.selfieData='';
    preview?.classList.add('hidden');
    video?.classList.remove('hidden');
    if(btn) btn.textContent='Ambil Selfie';
    updateAttendReady();
    await startCamera();
    return;
  }

  if(!video?.videoWidth){
    toast('Tunggu kamera siap.','warning');
    return;
  }

  const maxWidth=360;
  const scale=Math.min(1,maxWidth/video.videoWidth);

  canvas.width=Math.max(1,Math.round(video.videoWidth*scale));
  canvas.height=Math.max(1,Math.round(video.videoHeight*scale));

  canvas.getContext('2d').drawImage(
    video,
    0,
    0,
    canvas.width,
    canvas.height
  );

  APP.selfieData=canvas.toDataURL('image/jpeg',.35);

  preview.src=APP.selfieData;
  preview.classList.remove('hidden');
  video.classList.add('hidden');

  stopCamera();

  if(btn) btn.textContent='Ulangi Selfie';
  updateAttendReady();
}

function updateAttendReady(){
  const btn=$('submitAttendBtn');
  if(btn) btn.disabled=!(APP.currentCoords && APP.selfieData);
}

function applyAttendanceToHome(data){
  if(!APP.home || !data) return;

  const type=String(
    data.type ||
    APP.currentAttendance?.type ||
    ''
  ).toUpperCase();

  const item={
    waktu:data.waktu || '',
    status:data.status || ''
  };

  if(type==='MASUK'){
    APP.home.attendance=APP.home.attendance || {};
    APP.home.attendance.masuk=item;
  }

  if(type==='PULANG'){
    APP.home.attendance=APP.home.attendance || {};
    APP.home.attendance.pulang=item;
  }

  if(type==='APEL_PAGI' || type==='APEL_SORE'){
    const wanted=type==='APEL_SORE' ? 'SORE' : 'PAGI';
    const row=(APP.home.apel || []).find(
      x=>String(x.jenisApel).toUpperCase()===wanted
    );

    if(row){
      row.status='SUDAH_ABSEN';
      row.sudahAbsen=true;
    }
  }

  if(data.deviceRegisteredNow){
    if(APP.home?.user){
      APP.home.user.deviceRegistered=true;
    }
    APP.user={...APP.user,deviceRegistered:true};
  }

  APP.homeFetchedAt=Date.now();
}

async function submitAttendance(){
  const c=APP.currentCoords;

  if(!c || !APP.selfieData){
    toast('GPS dan selfie wajib siap.','warning');
    return;
  }

  const btn=$('submitAttendBtn');

  await busyButton(btn,async()=>{
    const data=await api('attend',{
      jenisAbsen:APP.currentAttendance.type,
      idReferensi:APP.currentAttendance.ref,
      latitude:c.latitude,
      longitude:c.longitude,
      accuracy:c.accuracy,
      selfieDataUrl:APP.selfieData,
      catatan:$('attNote')?.value?.trim() || '',
      deviceId:DEVICE.id,
      deviceKey:DEVICE.key,
      deviceTime:new Date().toISOString(),
      userAgent:navigator.userAgent
    });

    const statusText=String(data?.status || '').replaceAll('_',' ');

    applyAttendanceToHome(data);
    closeModal();

    if(APP.route==='home' && APP.home){
      paintHome(APP.home);
    }

    toast(
      `Absensi berhasil${statusText ? ': '+statusText : ''}.`,
      'success'
    );
  },'Menyimpan...');
}

async function busyButton(btn, fn, label='Memproses...'){
  if(!btn || btn.disabled) return;
  const old=btn.innerHTML;
  btn.disabled=true;
  btn.innerHTML=`<span class="spinner"></span><span>${esc(label)}</span>`;
  try{
    await fn();
  }catch(e){
    toast(e.message,'error');
  }finally{
    if(document.body.contains(btn)){
      btn.disabled=false;
      btn.innerHTML=old;
    }
  }
}

function empty(text){
  return `<div class="empty-state"><div class="empty-icon">◌</div>${esc(text)}</div>`;
}
function skeletonInline(){
  return `<div class="skeleton skel-line" style="width:45%"></div><div class="skeleton skel-line"></div><div class="skeleton skel-line" style="width:72%"></div>`;
}

window.openAttendance=openAttendance;
window.closeModal=closeModal;

document.addEventListener('DOMContentLoaded', boot);
