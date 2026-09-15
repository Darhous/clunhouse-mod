'use strict';

function createLogBuffer({ maxBytes = 8 * 1024 * 1024, maxRecords = 5000 } = {}) {
  let entries = [], bytes = 0, dropped = 0;
  return {
    add(record) {
      const text = JSON.stringify(record), size = Buffer.byteLength(text);
      // Keep whole records: never silently export a clipped JSON body.
      if (size > maxBytes) { dropped++; return; }
      entries.push({ text, size }); bytes += size;
      while (bytes > maxBytes || entries.length > maxRecords) { bytes -= entries.shift().size; dropped++; }
    },
    export() { return JSON.stringify({ format: 'modpanel-log-v2', exportedAt: new Date().toISOString(), droppedRecords: dropped }) + '\n' + entries.map((e) => e.text).join('\n'); },
  };
}

module.exports = { createLogBuffer };
