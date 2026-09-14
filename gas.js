export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ ok: false, code: 'POST_ONLY', message: 'POST only' });
  }

  const gas = String(process.env.GAS_WEB_APP_URL || '').trim();
  const key = String(process.env.GAS_GATEWAY_KEY || '').trim();

  if (!gas || !key) {
    return res.status(500).json({
      ok: false,
      code: 'ENV_MISSING',
      message: 'Environment Vercel belum lengkap'
    });
  }

  const requestBody = JSON.stringify({ ...(req.body || {}), gatewayKey: key });

  try {
    let url = gas;
    let method = 'POST';
    let body = requestBody;
    let response = null;

    // Follow redirect GAS secara eksplisit. Ini lebih stabil untuk ContentService Google.
    for (let hop = 0; hop < 6; hop++) {
      response = await fetch(url, {
        method,
        headers: method === 'POST'
          ? {
              'Content-Type': 'text/plain;charset=utf-8',
              'Accept': 'application/json,text/plain,*/*',
              'Cache-Control': 'no-cache'
            }
          : {
              'Accept': 'application/json,text/plain,*/*',
              'Cache-Control': 'no-cache'
            },
        body: method === 'POST' ? body : undefined,
        redirect: 'manual',
        cache: 'no-store'
      });

      if (![301, 302, 303, 307, 308].includes(response.status)) break;

      const location = response.headers.get('location');
      if (!location) break;

      url = new URL(location, url).toString();

      // Browser/fetch mengikuti 301/302/303 POST sebagai GET.
      if ([301, 302, 303].includes(response.status)) {
        method = 'GET';
        body = undefined;
      }
    }

    if (!response) {
      return res.status(502).json({
        ok: false,
        code: 'GAS_NO_RESPONSE',
        message: 'GAS tidak memberikan respons'
      });
    }

    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';

    try {
      const json = JSON.parse(text);
      return res.status(200).json(json);
    } catch (_) {
      const lower = text.toLowerCase();
      let message = 'GAS mengirim respons non-JSON';
      let reason = 'UNKNOWN_HTML';

      if (lower.includes('accounts.google.com') || lower.includes('servicelogin') || lower.includes('sign in')) {
        message = 'GAS masih meminta login Google. Web App harus dapat diakses oleh Anyone.';
        reason = 'GOOGLE_LOGIN_REQUIRED';
      } else if (lower.includes('authorization is required') || lower.includes('otorisasi')) {
        message = 'GAS memerlukan otorisasi ulang dari pemilik script.';
        reason = 'GAS_AUTHORIZATION_REQUIRED';
      } else if (lower.includes('moved temporarily') || lower.includes('redirect')) {
        message = 'Redirect Google Apps Script tidak selesai dengan benar.';
        reason = 'GAS_REDIRECT_FAILED';
      } else if (response.status === 404) {
        message = 'URL Web App GAS tidak ditemukan atau deployment berubah.';
        reason = 'GAS_NOT_FOUND';
      }

      console.error('GAS_NON_JSON', {
        status: response.status,
        finalUrl: url,
        contentType,
        reason,
        preview: text.slice(0, 800)
      });

      return res.status(502).json({
        ok: false,
        code: 'GAS_NON_JSON',
        message,
        details: {
          reason,
          status: response.status,
          contentType,
          finalHost: (() => { try { return new URL(url).host; } catch { return ''; } })()
        }
      });
    }
  } catch (e) {
    console.error('GAS_GATEWAY_ERROR', e);
    return res.status(502).json({
      ok: false,
      code: 'GATEWAY_ERROR',
      message: e?.message || 'Gateway error'
    });
  }
}
