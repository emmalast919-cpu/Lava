const http = require('http');
const https = require('https');
const fs = require('fs');
const os = require('os');

const HOST    = process.env.LAVALINK_HOST     || '5.39.63.207';
const LL_PORT = process.env.LAVALINK_PORT     || '9261';
const PASS    = process.env.LAVALINK_PASSWORD || 'glace';
const SECURE  = process.env.LAVALINK_SECURE   === 'true';
const SESSION = 'vy3gcm5qo7dgbb49';
const BASE    = `${SECURE ? 'https' : 'http'}://${HOST}:${LL_PORT}`;
const PORT    = Number(process.env.PORT || 5000);

const pingH = [], cpuH = [], ramH = [];
let lastData = null;
let prevCpu  = null;
let lastPlayingSong = null; // last known song that was playing

/* ── CPU from /proc/stat ── */
function readCpuStat() {
  try {
    const n = fs.readFileSync('/proc/stat', 'utf8').split('\n')[0]
      .replace('cpu', '').trim().split(/\s+/).map(Number);
    return { idle: n[3] + (n[4] || 0), total: n.reduce((a, b) => a + b, 0) };
  } catch { return { idle: 1, total: 2 }; }
}
function cpuPct() {
  const cur = readCpuStat();
  if (!prevCpu) { prevCpu = cur; return 0; }
  const di = cur.idle - prevCpu.idle, dt = cur.total - prevCpu.total;
  prevCpu = cur;
  return dt === 0 ? 0 : Math.max(0, Math.min(100, (1 - di / dt) * 100));
}

/* ── HTTP fetch ── */
function fetchJSON(url) {
  return new Promise((res, rej) => {
    const mod = url.startsWith('https') ? https : http;
    const r = mod.get(url, { headers: { Authorization: PASS }, timeout: 6000 }, resp => {
      let d = '';
      resp.on('data', c => d += c);
      resp.on('end', () => { try { res(JSON.parse(d)); } catch { rej(new Error('parse')); } });
    });
    r.on('error', rej);
    r.on('timeout', () => { r.destroy(); rej(new Error('timeout')); });
  });
}

/* ── Normalize a player object from Lavalink ── */
function songImage(track) {
  const uri = track?.info?.uri || '';
  const art  = track?.info?.artworkUrl || track?.pluginInfo?.artworkUrl || '';
  if (art) return art;
  const yt = uri.match(/(?:youtube\.com\/watch\?v=|youtu\.be\/)([a-zA-Z0-9_-]{6,})/);
  if (yt) return `https://img.youtube.com/vi/${yt[1]}/hqdefault.jpg`;
  return null;
}

function normalizePlayer(p) {
  const track = p?.track || null;
  const info  = track?.info || {};
  return {
    guildId:   p?.guildId   || 'unknown',
    paused:    !!p?.paused,
    connected: p?.voice?.connected !== false,
    voicePing: p?.voice?.ping ?? null,
    position:  p?.position  ?? 0,
    volume:    p?.volume    ?? 100,
    playing:   !!track && !p?.paused,
    song: {
      title:  info.title  || info.identifier || null,
      author: info.author || null,
      uri:    info.uri    || '',
      length: info.length || 0,
      image:  songImage(track)
    }
  };
}

/* ── Fetch active players ── */
async function fetchPlayers() {
  const urls = [
    `${BASE}/v4/sessions/${encodeURIComponent(SESSION)}/players`,
    `${BASE}/v4/sessions/players`,
    `${BASE}/v4/players`
  ];
  for (const url of urls) {
    try {
      const data = await fetchJSON(url);
      const list = Array.isArray(data) ? data
                 : Array.isArray(data?.players) ? data.players : [];
      return list.map(normalizePlayer);
    } catch {}
  }
  return [];
}

/* ── Main refresh ── */
async function refresh() {
  const t0 = Date.now();
  const [stats, info] = await Promise.all([
    fetchJSON(`${BASE}/v4/stats`).catch(() => null),
    fetchJSON(`${BASE}/v4/info`).catch(() => null)
  ]);
  const ping = stats ? (Date.now() - t0) : 0;
  const cpu  = parseFloat(cpuPct().toFixed(2));
  const ramUsed  = os.totalmem() - os.freemem();
  const ramTotal = os.totalmem();
  const now  = Date.now();

  pingH.push({ v: ping, t: now });
  cpuH.push({ v: cpu,  t: now });
  ramH.push({ v: parseFloat((ramUsed / ramTotal * 100).toFixed(2)), t: now });
  if (pingH.length > 60) pingH.shift();
  if (cpuH.length > 60)  cpuH.shift();
  if (ramH.length > 60)  ramH.shift();

  /* Fetch players only when Lavalink is online */
  let players = [];
  if (stats) {
    players = await fetchPlayers().catch(() => []);
    /* Track last known playing song */
    const activeSong = players.find(p => p.playing && p.song?.title);
    if (activeSong) lastPlayingSong = { ...activeSong, seenAt: now };
  }

  lastData = {
    secure:    SECURE,
    sessionId: SESSION,
    ll: {
      online:   !!stats,
      ping,
      uptime:   stats?.uptime   || 0,
      players:  stats?.players  || 0,
      playing:  stats?.playingPlayers || 0,
      memUsed:  stats?.memory?.used   || 0,
      memAlloc: stats?.memory?.allocated || 0,
      version:  info?.version?.semver  || '—'
    },
    sys: { cpu, ramUsed, ramTotal },
    players,
    lastPlaying: lastPlayingSong,
    history: {
      ping: pingH.slice(),
      cpu:  cpuH.slice(),
      ram:  ramH.slice()
    }
  };
  console.log(`[${new Date().toLocaleTimeString()}] LL:${stats?'online':'offline'} ping:${ping}ms cpu:${cpu}% players:${players.length}`);
}

function send(res, code, body, type = 'text/plain') {
  res.writeHead(code, {
    'Content-Type': type,
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'no-store'
  });
  res.end(body);
}

refresh().finally(() => {
  setInterval(refresh, 15000); // refresh every 15s for more real-time players
  http.createServer((req, res) => {
    if (req.url === '/api/status')
      return send(res, 200, JSON.stringify(lastData || {}), 'application/json');
    send(res, 200, fs.readFileSync('index.html', 'utf8'), 'text/html; charset=utf-8');
  }).listen(PORT, '0.0.0.0', () => console.log(`✅ Lavalink Dashboard on port ${PORT}`));
});
