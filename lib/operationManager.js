'use strict';

const { EventEmitter } = require('events');

const bus = new EventEmitter();
const operations = new Map();
const MAX_HISTORY = 40;

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function publicOperation(operation) {
  if (!operation) return null;
  const { worker, items, ...safe } = operation;
  return { ...safe, results: safe.results.map((result) => ({ ...result })) };
}

function trimHistory() {
  const completed = [...operations.values()]
    .filter((operation) => operation.status !== 'running')
    .sort((a, b) => new Date(a.createdAt) - new Date(b.createdAt));
  while (operations.size > MAX_HISTORY && completed.length) operations.delete(completed.shift().id);
}

function emit(operation) {
  const snapshot = publicOperation(operation);
  bus.emit('progress', snapshot);
  return snapshot;
}

function createOperation({ kind, label, items, worker, intervalMs = 700, dryRun = false, metadata = {} }) {
  if (!Array.isArray(items)) throw new Error('قائمة أهداف العملية غير صالحة');
  if (typeof worker !== 'function') throw new Error('منفذ العملية غير صالح');
  const safeInterval = Math.min(5000, Math.max(600, Number(intervalMs) || 700));
  const id = `op_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
  const operation = {
    id, kind, label, status: dryRun ? 'preview' : 'running', dryRun: !!dryRun,
    createdAt: new Date().toISOString(), startedAt: dryRun ? null : new Date().toISOString(), completedAt: dryRun ? new Date().toISOString() : null,
    total: items.length, completed: 0, succeeded: 0, skipped: 0, failed: 0, cancelled: false,
    intervalMs: safeInterval, metadata, results: [], items, worker,
  };
  operations.set(id, operation);
  emit(operation);
  if (!dryRun) void runOperation(operation);
  trimHistory();
  return publicOperation(operation);
}

async function runOperation(operation) {
  for (let index = 0; index < operation.items.length; index++) {
    if (operation.cancelled) break;
    const item = operation.items[index];
    let skipped = false;
    try {
      const value = await operation.worker(item, index);
      skipped = !!value?.skipped;
      operation.results.push({ key: item.key, userId: item.userId, ok: !value?.skipped, skipped: !!value?.skipped, value });
      if (value?.skipped) operation.skipped++;
      else operation.succeeded++;
    } catch (error) {
      operation.results.push({ key: item.key, userId: item.userId, ok: false, error: error.message });
      operation.failed++;
      if (error.status === 429 || error.stopOperation) {
        operation.stopReason = error.message;
        operation.retryAfterMs = error.retryAfterMs || null;
        operation.stopped = true;
      }
    }
    operation.completed++;
    emit(operation);
    if (operation.stopped) break;
    if (index < operation.items.length - 1 && !operation.cancelled && !skipped) await wait(operation.intervalMs);
  }
  operation.status = operation.cancelled ? 'cancelled' : operation.failed ? (operation.succeeded ? 'partial' : 'failed') : 'completed';
  operation.completedAt = new Date().toISOString();
  emit(operation);
  trimHistory();
}

function cancelOperation(id) {
  const operation = operations.get(id);
  if (!operation) return null;
  if (operation.status !== 'running') return publicOperation(operation);
  operation.cancelled = true;
  emit(operation);
  return publicOperation(operation);
}

function cancelAllOperations() {
  return [...operations.values()]
    .filter((operation) => operation.status === 'running')
    .map((operation) => cancelOperation(operation.id));
}

function getOperation(id) {
  return publicOperation(operations.get(id));
}

function listOperations() {
  return [...operations.values()]
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(publicOperation);
}

module.exports = { bus, createOperation, cancelOperation, cancelAllOperations, getOperation, listOperations };
