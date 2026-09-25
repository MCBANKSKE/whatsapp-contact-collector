const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const QRCode = require('qrcode');

const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>WhatsApp Contact Collector</title>
  <style>
    :root { color-scheme: light dark; font-family: system-ui, sans-serif; }
    body { margin: 0; background: #101418; color: #edf2f7; }
    main { max-width: 920px; margin: 0 auto; padding: 32px 20px; }
    h1 { margin-top: 0; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
    .card { background: #1b232b; border: 1px solid #303c46; border-radius: 10px; padding: 16px; }
    .label { color: #9ba8b5; font-size: .85rem; }
    .value { font-size: 1.35rem; margin-top: 6px; }
    .actions { display: flex; flex-wrap: wrap; gap: 12px; margin: 20px 0; }
    button, a.button { border: 0; border-radius: 8px; padding: 10px 16px; background: #2f81f7; color: white; cursor: pointer; text-decoration: none; font: inherit; }
    button:disabled, a.disabled { opacity: .45; cursor: not-allowed; pointer-events: none; }
    #qr { display: block; max-width: 360px; width: 100%; margin: 16px auto; background: white; padding: 12px; border-radius: 8px; }
    .login-row { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 12px; }
    input { min-width: 220px; flex: 1; border: 1px solid #465563; border-radius: 8px; padding: 10px 12px; background: #101418; color: #edf2f7; font: inherit; }
    .muted { color: #9ba8b5; }
    .error { color: #ff9b9b; white-space: pre-wrap; }
  </style>
</head>
<body>
<main>
  <h1>WhatsApp Contact Collector</h1>
  <p class="muted">Initial history synchronization and live collection status.</p>
  <div class="grid">
    <div class="card"><div class="label">State</div><div id="state" class="value">Loading…</div></div>
    <div class="card"><div class="label">WhatsApp connected</div><div id="connected" class="value">—</div></div>
    <div class="card"><div class="label">History complete</div><div id="history" class="value">—</div></div>
    <div class="card"><div class="label">Resolved numbers</div><div id="resolved" class="value">0</div></div>
    <div class="card"><div class="label">Unresolved LIDs</div><div id="unresolved" class="value">0</div></div>
    <div class="card"><div class="label">CSV sent to self</div><div id="sent" class="value">No</div></div>
  </div>
  <div class="actions">
    <a id="download" class="button disabled" href="#">Download CSV</a>
    <button id="refresh" type="button">Refresh</button>
  </div>
  <div class="card">
    <div class="label">WhatsApp pairing QR</div>
    <img id="qr" alt="WhatsApp pairing QR code" hidden>
    <div id="qrMessage" class="muted">Waiting for a QR code…</div>
  </div>
  <div class="card" style="margin-top: 12px">
    <div class="label">Or request a phone-number pairing code</div>
    <form id="pairingForm" class="login-row">
      <input id="phoneNumber" type="tel" inputmode="tel" autocomplete="tel" placeholder="Full international number, e.g. 15550000000" required>
      <button type="submit">Request pairing code</button>
    </form>
    <div id="pairingResult" class="muted" style="margin-top: 10px"></div>
  </div>
  <p id="error" class="error"></p>
</main>
<script>
  const token = new URLSearchParams(window.location.search).get('token') || '';
  const withToken = (route) => {
    if (!token) return route;
    return route + (route.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token);
  };
  const setText = (id, value) => { document.getElementById(id).textContent = value; };
  async function refresh() {
    let connected = false;
    try {
      const response = await fetch(withToken('/health'), { cache: 'no-store' });
      if (!response.ok) throw new Error('Status request failed: ' + response.status);
      const data = await response.json();
      connected = Boolean(data.connected);
      setText('state', data.state || 'unknown');
      setText('connected', connected ? 'Yes' : 'No');
      setText('history', data.historySyncComplete ? 'Yes' : 'No');
      setText('resolved', data.resolvedPhoneNumbers || 0);
      setText('unresolved', data.unresolvedLids || 0);
      setText('sent', data.selfMessageSent ? 'Yes' : 'No');
      setText('error', data.lastError || '');
      const download = document.getElementById('download');
      download.href = withToken('/download');
      download.classList.toggle('disabled', !data.csvReady);
      const qr = document.getElementById('qr');
      const qrMessage = document.getElementById('qrMessage');
      if (data.qrAvailable) {
        qr.src = withToken('/qr.png') + (token ? '&' : '?') + 't=' + Date.now();
        qr.hidden = false;
        qrMessage.textContent = 'Scan this code with WhatsApp → Linked devices.';
      } else {
        qr.hidden = true;
        qr.removeAttribute('src');
        qrMessage.textContent = connected ? 'Connected; no pairing QR is active.' : 'Waiting for a QR code…';
      }
    } catch (error) {
      setText('error', error.message);
    } finally {
      clearTimeout(refresh.timer);
      refresh.timer = setTimeout(refresh, connected ? 2000 : 500);
    }
  }
  document.getElementById('refresh').addEventListener('click', () => {
    clearTimeout(refresh.timer);
    refresh();
  });
  document.getElementById('pairingForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const result = document.getElementById('pairingResult');
    const phoneNumber = document.getElementById('phoneNumber').value.trim();
    result.textContent = 'Requesting pairing code…';
    try {
      const response = await fetch(withToken('/pairing-code'), {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || 'Pairing code request failed');
      result.textContent = 'Pairing code: ' + body.code;
    } catch (error) {
      result.textContent = error.message;
    }
  });
  refresh.timer = undefined;
  refresh();
</script>
</body>
</html>`;

function readJsonBody(request) {
    return new Promise((resolve, reject) => {
        let body = '';
        request.setEncoding('utf8');
        request.on('data', (chunk) => {
            body += chunk;
            if (body.length > 4096) {
                reject(new Error('Request body is too large'));
                request.destroy();
            }
        });
        request.on('end', () => {
            try {
                resolve(JSON.parse(body || '{}'));
            } catch {
                reject(new Error('Request body must be valid JSON'));
            }
        });
        request.on('error', reject);
    });
}

function createStatusServer({
    host,
    port,
    getStatus,
    getQrData = () => null,
    getCsvPath = () => null,
    requestPairingCode = null,
    accessToken = process.env.WHATSAPP_STATUS_TOKEN || '',
}) {
    if (!Number.isInteger(port) || port < 0 || port > 65535) {
        throw new Error('WHATSAPP_STATUS_PORT must be an integer from 0 to 65535');
    }

    const isAuthorized = (request, url) => {
        if (!accessToken) {
            return true;
        }

        return url.searchParams.get('token') === accessToken
            || request.headers['x-status-token'] === accessToken;
    };

    const sendJson = (response, statusCode, body) => {
        response.writeHead(statusCode, {
            'Cache-Control': 'no-store',
            'Content-Type': 'application/json; charset=utf-8',
        });
        response.end(JSON.stringify(body));
    };

    const server = http.createServer(async (request, response) => {
        let url;

        try {
            url = new URL(request.url || '/', 'http://localhost');
        } catch {
            sendJson(response, 400, { error: 'Bad request' });
            return;
        }

        if (!isAuthorized(request, url)) {
            sendJson(response, 401, { error: 'Unauthorized' });
            return;
        }

        const isPairingCodeRequest = url.pathname === '/pairing-code';

        if (
            request.method !== 'GET'
            && !(isPairingCodeRequest && request.method === 'POST')
        ) {
            sendJson(response, 405, { error: 'Method not allowed' });
            return;
        }

        try {
            if (isPairingCodeRequest) {
                if (typeof requestPairingCode !== 'function') {
                    sendJson(response, 501, { error: 'Phone pairing is not available' });
                    return;
                }

                const body = await readJsonBody(request);
                const code = await requestPairingCode(body.phoneNumber);
                sendJson(response, 200, { code });
                return;
            }

            if (url.pathname === '/') {
                response.writeHead(200, {
                    'Cache-Control': 'no-store',
                    'Content-Type': 'text/html; charset=utf-8',
                });
                response.end(DASHBOARD_HTML);
                return;
            }

            if (url.pathname === '/health') {
                sendJson(response, 200, getStatus());
                return;
            }

            if (url.pathname === '/qr.png' || url.pathname === '/qr') {
                const qrData = getQrData();

                if (!qrData) {
                    sendJson(response, 404, { error: 'QR code is not available' });
                    return;
                }

                const png = await QRCode.toBuffer(qrData, {
                    errorCorrectionLevel: 'M',
                    margin: 2,
                    type: 'png',
                    width: 360,
                });
                response.writeHead(200, {
                    'Cache-Control': 'no-store',
                    'Content-Length': png.length,
                    'Content-Type': 'image/png',
                });
                response.end(png);
                return;
            }

            if (url.pathname === '/download' || url.pathname === '/csv') {
                const csvPath = getCsvPath();

                if (!csvPath || !fs.existsSync(csvPath)) {
                    sendJson(response, 404, { error: 'CSV is not available yet' });
                    return;
                }

                const csv = fs.readFileSync(csvPath);
                response.writeHead(200, {
                    'Content-Disposition': `attachment; filename="${path.basename(csvPath)}"`,
                    'Content-Length': csv.length,
                    'Content-Type': 'text/csv; charset=utf-8',
                });
                response.end(csv);
                return;
            }

            sendJson(response, 404, { error: 'Not found' });
        } catch (error) {
            sendJson(response, 500, { error: error.message });
        }
    });

    return {
        host,
        port,
        server,
        start() {
            return new Promise((resolve, reject) => {
                const onError = (error) => {
                    server.off('listening', onListening);
                    reject(error);
                };
                const onListening = () => {
                    server.off('error', onError);
                    const address = server.address();
                    resolve({
                        host,
                        port: typeof address === 'object' ? address.port : port,
                    });
                };

                server.once('error', onError);
                server.once('listening', onListening);
                server.listen(port, host);
            });
        },
        stop() {
            return new Promise((resolve) => {
                if (!server.listening) {
                    resolve();
                    return;
                }

                server.close(() => resolve());
            });
        },
    };
}

module.exports = {
    createStatusServer,
};
