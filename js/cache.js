const CACHE_PREFIX = 'tt_cache_';
const DEFAULT_TTL = 5 * 60 * 1000;

export function getCache(key) {
  try {
    const raw = localStorage.getItem(CACHE_PREFIX + key);
    if (!raw) return null;
    const { data, expiry } = JSON.parse(raw);
    if (Date.now() > expiry) {
      localStorage.removeItem(CACHE_PREFIX + key);
      return null;
    }
    return data;
  } catch {
    return null;
  }
}

export function setCache(key, data, ttl = DEFAULT_TTL) {
  try {
    localStorage.setItem(CACHE_PREFIX + key, JSON.stringify({ data, expiry: Date.now() + ttl }));
  } catch {}
}

export function invalidateCache(key) {
  localStorage.removeItem(CACHE_PREFIX + key);
}
