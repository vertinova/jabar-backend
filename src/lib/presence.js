/**
 * In-memory realtime presence store for the superadmin monitoring page.
 *
 * Visitors send a heartbeat (POST /api/monitoring/heartbeat) every few seconds;
 * each is kept here keyed by user id (logged in) or a visitor id (guest) and
 * pruned after TTL_MS of silence. Suitable while the backend runs as a single
 * process (pm2 fork) — state lives in this process only.
 */
const TTL_MS = 30_000; // a visitor is "online" for 30s after their last heartbeat

const visitors = new Map();

const touch = ({ key, userId = null, name = null, role = 'GUEST', page = '/', device = 'desktop', ip = null }) => {
  const now = Date.now();
  const existing = visitors.get(key);
  visitors.set(key, {
    key,
    userId: userId ?? existing?.userId ?? null,
    name: name ?? existing?.name ?? null,
    role: role ?? existing?.role ?? 'GUEST',
    page,
    device,
    ip: ip ?? existing?.ip ?? null,
    firstSeen: existing?.firstSeen ?? now,
    lastSeen: now,
  });
};

// Returns currently-online visitors and prunes stale ones as a side effect.
const active = () => {
  const cutoff = Date.now() - TTL_MS;
  const list = [];
  for (const [key, v] of visitors) {
    if (v.lastSeen < cutoff) visitors.delete(key);
    else list.push(v);
  }
  return list;
};

module.exports = { touch, active, TTL_MS };
