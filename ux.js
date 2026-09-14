(() => {
  const UX_VERSION = '1.4.0';
  const $ = (id) => document.getElementById(id);

  let pendingFetches = 0;
  let netShowTimer = null;
  let deadClickTimer = null;

  function setReadyNote(text, ok = true) {
    const el = $('jsStatus');
    if (!el) return;
    el.textContent = text;
    el.classList.remove('ux-ready', 'ux-error');
    el.classList.add(ok ? 'ux-ready' : 'ux-error');
  }

  function setNetworkBusy(active, text = 'Memproses...') {
    const bar = $('netBar');
    const label = $('netBarText');
    if (!bar) return;

    if (label) label.textContent = text;

    if (active) {
      clearTimeout(netShowTimer);
      netShowTimer = setTimeout(() => {
        if (pendingFetches > 0) bar.classList.remove('hidden');
      }, 180);
    } else {
      clearTimeout(netShowTimer);
      bar.classList.add('hidden');
    }
  }

  function pulseButton(btn) {
    if (!btn || btn.disabled) return;
    btn.classList.add('is-tapping');
    setTimeout(() => btn.classList.remove('is-tapping'), 140);

    try {
      if (navigator.vibrate) navigator.vibrate(12);
    } catch (_) {}
  }

  function showFallbackMessage(message) {
    if (typeof window.toast === 'function') {
      window.toast(message);
      return;
    }

    const t = $('toast');
    if (!t) return;
    t.textContent = message;
    t.classList.add('show');
    setTimeout(() => t.classList.remove('show'), 2800);
  }

  // Global touch feedback for every button, including dynamically rendered buttons.
  document.addEventListener('pointerdown', (e) => {
    const btn = e.target.closest('button,.btn,.icon-btn');
    if (btn) pulseButton(btn);
  }, { passive: true });

  // Make obvious "dead" buttons respond instead of appearing broken.
  document.addEventListener('click', (e) => {
    const btn = e.target.closest('button');
    if (!btn || btn.disabled) return;

    const hasInline = !!btn.getAttribute('onclick');
    const isSubmit = (btn.getAttribute('type') || '').toLowerCase() === 'submit';

    if (!hasInline && !isSubmit) {
      clearTimeout(deadClickTimer);
      deadClickTimer = setTimeout(() => {
        showFallbackMessage('Fitur ini belum aktif.');
      }, 80);
    }
  });

  // Global fetch progress. Existing app logic remains untouched.
  const originalFetch = window.fetch.bind(window);
  window.fetch = async (...args) => {
    pendingFetches += 1;
    setNetworkBusy(true, 'Menghubungkan ke server...');

    try {
      const res = await originalFetch(...args);
      return res;
    } finally {
      pendingFetches = Math.max(0, pendingFetches - 1);
      if (pendingFetches === 0) setNetworkBusy(false);
    }
  };

  // Animate all new main-content screens/cards.
  const main = $('mainContent');
  if (main) {
    const observer = new MutationObserver(() => {
      main.classList.remove('ux-content-in');
      void main.offsetWidth;
      main.classList.add('ux-content-in');
    });
    observer.observe(main, { childList:true, subtree:false });
  }

  // Make browser Back feel safer when an attendance modal is open.
  window.addEventListener('popstate', () => {
    const modal = $('attendanceModal');
    if (modal && !modal.classList.contains('hidden') && typeof window.closeAttendance === 'function') {
      window.closeAttendance();
    }
  });

  // Better error feedback instead of silent failures.
  window.addEventListener('error', (event) => {
    console.error('UX caught error:', event.error || event.message);
    showFallbackMessage('Ada fungsi yang bermasalah. Coba ulangi atau refresh aplikasi.');
  });

  window.addEventListener('unhandledrejection', (event) => {
    console.error('UX caught rejection:', event.reason);
    const message = event.reason?.message || 'Proses gagal.';
    showFallbackMessage(message);
  });

  function updateOnlineState() {
    const bar = $('netBar');
    const label = $('netBarText');

    if (!navigator.onLine) {
      if (label) label.textContent = 'Tidak ada koneksi internet';
      if (bar) {
        bar.classList.remove('hidden');
        bar.classList.add('ux-offline');
      }
      return;
    }

    if (bar) bar.classList.remove('ux-offline');
    if (pendingFetches === 0 && bar) bar.classList.add('hidden');
  }

  window.addEventListener('online', updateOnlineState);
  window.addEventListener('offline', updateOnlineState);

  // Enter on PIN = login.
  $('pin')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && typeof window.login === 'function') {
      e.preventDefault();
      window.login();
    }
  });

  // Expose a helper that existing functions can optionally use later.
  window.UX = {
    version: UX_VERSION,
    busyButton(btn, active, text) {
      if (!btn) return;
      btn.classList.toggle('ux-button-busy', !!active);
      btn.disabled = !!active;
      if (text) btn.dataset.uxText = text;
    },
    message: showFallbackMessage
  };

  setReadyNote(`Aplikasi siap • UX v${UX_VERSION}`, true);
  updateOnlineState();
})();
