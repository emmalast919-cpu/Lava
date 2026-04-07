const http = require('http');
const fs   = require('fs');
const path = require('path');

const LAVA_HOST = '5.39.63.207';
const LAVA_PORT = 9261;
const PASSWORD  = 'glace';
const PORT      = 5000;

// ── Proxy: forward /api/stats to Lavalink ────────────────────────────────────
function proxyLava(res) {
  const opts = {
    hostname: LAVA_HOST,
    port:     LAVA_PORT,
    path:     '/v4/stats',
    method:   'GET',
    headers:  { Authorization: PASSWORD }
  };

  const req = http.request(opts, (lavaRes) => {
    let body = '';
    lavaRes.on('data', chunk => body += chunk);
    lavaRes.on('end', () => {
      res.writeHead(lavaRes.statusCode, {
        'Content-Type':                'application/json',
        'Access-Control-Allow-Origin': '*'
      });
      res.end(body);
    });
  });

  req.on('error', err => {
    res.writeHead(502, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify({ error: err.message }));
  });

  req.end();
}

// ── HTTP server ───────────────────────────────────────────────────────────────
http.createServer((req, res) => {
  if (req.url === '/api/stats') {
    return proxyLava(res);
  }

  // Serve index.html for everything else
  const file = path.join(__dirname, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(500);
      return res.end('Server error');
    }
    res.writeHead(200, { 'Content-Type': 'text/html' });
    res.end(data);
  });
}).listen(PORT, () => {
  console.log(`Laavlink Monitor running on http://localhost:${PORT}`);
});
