'use strict';

// One queue per account/feature, shared by manual, scheduled and automatic calls.
// A local interval is precautionary, not a claim about Clubhouse's private limits.
function createFeatureLimiter({ intervalMs = 5000, fallbackBackoffMs = 180000, maxRequests = Infinity, windowMs = 60000, load = () => [], save = () => {}, now = Date.now, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const buckets = new Map();
  for (const entry of load()) {
    if (!entry || typeof entry.key !== 'string') continue;
    buckets.set(entry.key, { tail: Promise.resolve(), nextAt: Number(entry.nextAt) || 0, blockedUntil: Number(entry.blockedUntil) || 0, starts: (entry.starts || []).filter(Number.isFinite) });
  }
  function persist() {
    save([...buckets].filter(([, b]) => b.nextAt > now() || b.blockedUntil > now() || b.starts.some(t => t > now() - windowMs))
      .map(([key, b]) => ({ key, nextAt: b.nextAt, blockedUntil: b.blockedUntil, starts: b.starts })));
  }
  function bucket(key) {
    if (!buckets.has(key)) buckets.set(key, { tail: Promise.resolve(), nextAt: 0, blockedUntil: 0, starts: [] });
    return buckets.get(key);
  }
  function blockedError(b) {
    const retryAfterMs = Math.max(0, b.blockedUntil - now());
    return Object.assign(new Error(`الإرسال متوقف مؤقتًا — حاول بعد ${Math.ceil(retryAfterMs / 1000)} ثانية`), { status: 429, retryAfterMs, stopOperation: true });
  }
  function run(key, work, validate = () => {}) {
    const b = bucket(key);
    const result = b.tail.then(async () => {
      if (b.blockedUntil > now()) throw blockedError(b);
      while (true) {
        b.starts = b.starts.filter(t => t > now() - windowMs);
        const windowWait = b.starts.length >= maxRequests ? b.starts[0] + windowMs - now() : 0;
        const wait = Math.max(b.nextAt - now(), windowWait);
        if (wait <= 0) break;
        validate();
        await sleep(Math.min(wait, 5000)); // Recheck cancellation/context while cooling down.
      }
      if (b.blockedUntil > now()) throw blockedError(b);
      validate();
      b.starts.push(now());
      persist();
      try { return await work(); }
      catch (error) {
        if (error.status === 429) {
          b.blockedUntil = now() + Math.max(1000, Number(error.retryAfterMs) || fallbackBackoffMs);
          error.retryAfterMs = b.blockedUntil - now();
          error.stopOperation = true;
        }
        throw error;
      } finally { b.nextAt = now() + intervalMs; persist(); }
    });
    b.tail = result.catch(() => {});
    return result;
  }
  return { run, remaining: (key) => Math.max(0, bucket(key).blockedUntil - now()) };
}

module.exports = { createFeatureLimiter };
