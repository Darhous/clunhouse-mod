'use strict';
const { createHash } = require('crypto');

// Conservative local duplicate window, not a claim about Clubhouse's limits.
// Hashes only: no message bodies or credentials are persisted here.
function createChatReceipts({ load = () => [], save = () => {}, now = Date.now, ttlMs = 86400000, maxEntries = 5000 } = {}) {
  const entries = new Map(load().filter(([key, time]) => typeof key === 'string' && Number.isFinite(time)));
  const key = (account, channel, text) => createHash('sha256').update(JSON.stringify([String(account), channel, text.trim()])).digest('hex');
  function prune() {
    for (const [id, time] of entries) if (time <= now() - ttlMs) entries.delete(id);
    while (entries.size > maxEntries) entries.delete(entries.keys().next().value);
  }
  return {
    has(account, channel, text) { prune(); return entries.has(key(account, channel, text)); },
    remember(account, channel, text, time = now()) {
      const id = key(account, channel, text);
      if (!Number.isFinite(time) || time <= now() - ttlMs || entries.has(id)) return;
      entries.set(id, time); prune(); save([...entries]);
    },
  };
}
module.exports = { createChatReceipts };
