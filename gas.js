export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({
      ok: false,
      code: 'METHOD_NOT_ALLOWED',
      message: 'Gunakan POST.'
    });
  }

  const gasUrl = process.env.GAS_WEB_APP_URL;
  const gatewayKey = process.env.GAS_GATEWAY_KEY;

  if (!gasUrl || !gatewayKey) {
    return res.status(500).json({
      ok: false,
      code: 'ENV_MISSING',
      message: 'Environment Variable Vercel belum lengkap.',
      details: {
        GAS_WEB_APP_URL: !!gasUrl,
        GAS_GATEWAY_KEY: !!gatewayKey
      }
    });
  }

  try {
    const incoming =
      typeof req.body === 'string'
        ? JSON.parse(req.body || '{}')
        : (req.body || {});

    const payload = { ...incoming, gatewayKey };

    const first = await fetch(gasUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json;charset=UTF-8' },
      body: JSON.stringify(payload),
      redirect: 'manual'
    });

    let response = first;

    if ([301, 302, 303, 307, 308].includes(first.status)) {
      const location = first.headers.get('location');

      if (!location) {
        return res.status(502).json({
          ok: false,
          code: 'GAS_REDIRECT_NO_LOCATION',
          message: 'GAS mengirim redirect tanpa alamat tujuan.'
        });
      }

      response = await fetch(location, {
        method: 'GET',
        redirect: 'follow',
        headers: { 'Accept': 'application/json,text/plain,*/*' }
      });
    }

    const text = await response.text();
    const contentType = response.headers.get('content-type') || '';

    let data;
    try {
      data = JSON.parse(text);
    } catch (e) {
      const looksLikeGoogleLogin =
        /accounts\.google\.com|ServiceLogin|Sign in with Google|<html/i.test(text);

      return res.status(502).json({
        ok: false,
        code: looksLikeGoogleLogin
          ? 'GAS_ACCESS_RESTRICTED'
          : 'GAS_NON_JSON_RESPONSE',
        message: looksLikeGoogleLogin
          ? 'Web App GAS masih meminta login Google. Deployment harus dapat diakses oleh Anyone.'
          : 'GAS mengirim respons non-JSON.',
        details: {
          httpStatus: response.status,
          contentType,
          preview: text.slice(0, 500)
        }
      });
    }

    return res.status(200).json(data);

  } catch (error) {
    return res.status(502).json({
      ok: false,
      code: 'VERCEL_GATEWAY_ERROR',
      message: error?.message || 'Gateway Vercel gagal menghubungi GAS.'
    });
  }
}
