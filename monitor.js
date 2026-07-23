'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { FixedQueue } = require('@tsevimli/collections');

const UI_PATH = path.join(__dirname, 'monitor.html');

const TIMEOUT_MESSAGES = new Set(['Process timed out!', 'Waiting timed out']);

const FLUSH_INTERVAL = 300;
const HEARTBEAT_INTERVAL = 25000;
const MAX_CLIENT_BUFFER = 1024 * 1024;
const MAX_SAMPLES_PER_FLUSH = 100;
const MAX_EVENTS_PER_FLUSH = 50;
const MAX_HISTORY = 10000;
const MAX_DETAIL_LENGTH = 200;
const HISTORY_BUCKETS = 60;

const emptyBatch = () => ({
  counts: { added: 0, success: 0, failure: 0, timeout: 0, rejected: 0 },
  waits: [],
  execs: [],
  events: [],
  dropped: { waits: 0, execs: 0, events: 0 },
});

const CONTROLS = new Set(['pause', 'resume', 'clear']);
const PATCHED = ['add', 'process', 'finish', 'pause', 'resume', 'clear'];
const GUARD_HEADER = 'x-kuyruk-monitor';
const MONITORED = Symbol('kuyruk.monitor');

const createWatcher = (queue, name, historySize) => {
  const pendingSince = new FixedQueue();
  let startedBeforeEnqueue = 0;
  let batch = emptyBatch();
  let dirty = false;
  let lastStateJson = '';
  const totals = { added: 0, success: 0, failure: 0, timeout: 0, rejected: 0 };
  const historyBuf = new FixedQueue();
  const secBuckets = new Array(HISTORY_BUCKETS).fill(0);
  let secBase = Math.floor(Date.now() / 1000);

  const bump = (kind) => {
    batch.counts[kind]++;
    totals[kind]++;
    dirty = true;
  };

  // Ring buffer: eviction on every insert keeps memory constant no
  // matter how long the queue runs.
  const remember = (entry) => {
    if (historySize === 0) return;
    historyBuf.push(entry);
    while (historyBuf.length > historySize) historyBuf.shift();
  };

  const rotateSecBuckets = () => {
    const now = Math.floor(Date.now() / 1000);
    let shift = now - secBase;
    if (shift <= 0) return;
    if (shift > HISTORY_BUCKETS) shift = HISTORY_BUCKETS;
    secBuckets.splice(0, shift);
    for (let i = 0; i < shift; i++) secBuckets.push(0);
    secBase = now;
  };

  const recordCompletion = () => {
    rotateSecBuckets();
    secBuckets[HISTORY_BUCKETS - 1]++;
  };

  const sample = (kind, value) => {
    if (batch[kind].length < MAX_SAMPLES_PER_FLUSH) batch[kind].push(value);
    else batch.dropped[kind]++;
    dirty = true;
  };

  const event = (type, detail = '', factor = undefined) => {
    const entry = {
      type,
      ts: Date.now(),
      detail: String(detail).slice(0, MAX_DETAIL_LENGTH),
      factor,
    };
    remember(entry);
    if (batch.events.length < MAX_EVENTS_PER_FLUSH) {
      batch.events.push(entry);
    } else {
      batch.dropped.events++;
    }
    dirty = true;
  };

  const snapshot = () => {
    const state = {
      concurrency: queue.concurrency,
      size: queue.size === Infinity ? null : queue.size,
      // clear() zeroes count while in-flight tasks still decrement it
      // on completion, so it can briefly go negative — clamp it.
      active: Math.max(0, queue.count),
      waiting: queue.waiting.length,
      paused: queue.paused,
      fifo: queue.fifoMode,
      priority: queue.priorityMode,
      roundRobin: queue.roundRobinMode,
      debounce: queue.debounceMode,
      waitTimeout: queue.waitTimeout === Infinity ? null : queue.waitTimeout,
      processTimeout:
        queue.processTimeout === Infinity ? null : queue.processTimeout,
    };
    if (queue.roundRobinMode) {
      state.channels = [];
      for (const child of queue.waiting) {
        state.channels.push({
          factor: child.factor,
          active: Math.max(0, child.count),
          waiting: child.waiting.length,
        });
      }
      state.active = state.channels.reduce((sum, c) => sum + c.active, 0);
      state.waiting = state.channels.reduce((sum, c) => sum + c.waiting, 0);
    }
    return state;
  };

  const measureOnce = (started) => {
    let measured = false;
    return () => {
      if (measured) return;
      measured = true;
      sample('execs', Date.now() - started);
    };
  };

  const instrument = (listener) => (item, callback) => {
    const enqueued = pendingSince.shift();
    if (enqueued === null) startedBeforeEnqueue++;
    else sample('waits', Date.now() - enqueued);
    const measure = measureOnce(Date.now());
    const done = (err, res) => {
      measure();
      callback(err, res);
    };
    const result = listener(item, done);
    if (result && typeof result.then === 'function') {
      return result.then(
        (res) => (measure(), res),
        (err) => {
          measure();
          throw err;
        },
      );
    }
    return result;
  };

  const wrapTask = (task, enqueued) => () => {
    sample('waits', Date.now() - enqueued);
    const measure = measureOnce(Date.now());
    try {
      const result = task();
      if (result && typeof result.then === 'function') {
        return result.then(
          (res) => (measure(), res),
          (err) => {
            measure();
            throw err;
          },
        );
      }
      measure();
      return result;
    } catch (err) {
      measure();
      throw err;
    }
  };

  let userListener = queue.onProcess || null;
  if (userListener) queue.onProcess = instrument(userListener);
  const originalProcess = queue.process.bind(queue);
  queue.process = (listener) => {
    userListener = listener;
    return originalProcess(instrument(listener));
  };

  const originalAdd = queue.add.bind(queue);
  queue.add = (item, options) => {
    const enqueued = Date.now();
    const isTask = typeof item === 'function';
    const toAdd = isTask ? wrapTask(item, enqueued) : item;
    const accepted = originalAdd(toAdd, options);
    if (accepted) {
      // A data item may start synchronously inside add(), before its
      // timestamp is enqueued here — instrument() counts those so this
      // stale timestamp is never stored.
      if (!isTask) {
        if (startedBeforeEnqueue > 0) startedBeforeEnqueue--;
        else pendingSince.push(enqueued);
      }
      bump('added');
    } else {
      bump('rejected');
      event('rejected', 'queue full');
    }
    return accepted;
  };

  const originalFinish = queue.finish.bind(queue);
  queue.finish = (err, res, details = {}) => {
    if (err) {
      const type = TIMEOUT_MESSAGES.has(err.message) ? 'timeout' : 'failure';
      // A wait-timed-out data item never reaches onProcess, so its
      // timestamp must be evicted here or it leaks and skews wait times.
      if (err.message === 'Waiting timed out' && typeof res !== 'function') {
        pendingSince.shift();
      }
      bump(type);
      event(type, err.message, details.factor);
    } else {
      bump('success');
    }
    recordCompletion();
    originalFinish(err, res, details);
  };

  for (const method of ['pause', 'resume', 'clear']) {
    const original = queue[method].bind(queue);
    queue[method] = () => {
      const result = original();
      event(method);
      return result;
    };
  }

  const queuePayload = () => {
    rotateSecBuckets();
    return {
      name,
      state: snapshot(),
      totals,
      history: {
        events: [...historyBuf],
        buckets: { base: secBase, values: secBuckets },
      },
    };
  };

  // Success groups land in history even when nobody is watching, so a
  // late client sees the same log a live one would have.
  const rememberSuccesses = () => {
    if (batch.counts.success === 0) return;
    remember({ type: 'success', ts: Date.now(), count: batch.counts.success });
  };

  const takeBatch = () => {
    const state = snapshot();
    const stateJson = JSON.stringify(state);
    if (!dirty && stateJson === lastStateJson) return null;
    lastStateJson = stateJson;
    const payload = { name, state, totals, ...batch };
    batch = emptyBatch();
    dirty = false;
    return payload;
  };

  const resetBatch = () => {
    if (!dirty) return;
    batch = emptyBatch();
    dirty = false;
  };

  const control = (action) => queue[action]();

  const detach = () => {
    for (const method of PATCHED) delete queue[method];
    queue.onProcess = userListener;
    delete queue[MONITORED];
  };

  return {
    name,
    queuePayload,
    rememberSuccesses,
    takeBatch,
    resetBatch,
    control,
    detach,
  };
};

const monitor = (queueOrOptions, maybeOptions = null) => {
  const isQueue =
    Boolean(queueOrOptions) &&
    typeof queueOrOptions.add === 'function' &&
    typeof queueOrOptions.process === 'function';
  const options = (isQueue ? maybeOptions : queueOrOptions) || {};
  const { port = 8228, host = '127.0.0.1', name = 'kuyruk' } = options;
  let { history = 200 } = options;
  if (history > MAX_HISTORY) {
    console.error(
      `kuyruk monitor: history ${history} clamped to ${MAX_HISTORY}`,
    );
    history = MAX_HISTORY;
  }
  if (history < 0) history = 0;

  const startedAt = Date.now();
  const clients = new Set();
  const watchers = new Map();

  const write = (client, payload) => {
    if (client.writableLength > MAX_CLIENT_BUFFER) {
      clients.delete(client);
      client.destroy();
      return;
    }
    client.write(payload);
  };

  const broadcast = (message) => {
    const payload = `data: ${JSON.stringify(message)}\n\n`;
    for (const client of clients) write(client, payload);
  };

  const flush = () => {
    for (const watcher of watchers.values()) watcher.rememberSuccesses();
    if (clients.size === 0) {
      for (const watcher of watchers.values()) watcher.resetBatch();
      return;
    }
    const queues = [];
    for (const watcher of watchers.values()) {
      const payload = watcher.takeBatch();
      if (payload) queues.push(payload);
    }
    if (queues.length === 0) return;
    broadcast({ type: 'batch', ts: Date.now(), queues });
  };

  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(UI_PATH));
    } else if (req.method === 'POST' && req.url.startsWith('/api/')) {
      // The custom header cannot be attached by a cross-site request
      // without a CORS preflight (which this server never grants), so
      // it shields the controls from CSRF.
      if (req.headers[GUARD_HEADER] !== '1') {
        res.writeHead(403);
        res.end();
        return;
      }
      const parts = req.url.slice('/api/'.length).split('/');
      const queueName = decodeURIComponent(parts[0] || '');
      const action = parts[1] || '';
      const watcher = watchers.get(queueName);
      if (!watcher || !CONTROLS.has(action)) {
        res.writeHead(404);
        res.end();
        return;
      }
      watcher.control(action);
      flush();
      res.writeHead(204);
      res.end();
    } else if (req.url === '/events') {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
        'X-Accel-Buffering': 'no',
      });
      clients.add(res);
      const hello = JSON.stringify({
        type: 'hello',
        ts: Date.now(),
        meta: { name, pid: process.pid, startedAt },
        queues: [...watchers.values()].map((w) => w.queuePayload()),
      });
      res.write(`data: ${hello}\n\n`);
      req.on('close', () => clients.delete(res));
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  const flusher = setInterval(flush, FLUSH_INTERVAL);
  flusher.unref();
  const heartbeat = setInterval(() => {
    for (const client of clients) write(client, ': ping\n\n');
  }, HEARTBEAT_INTERVAL);
  heartbeat.unref();

  const url = `http://${host}:${port}`;
  server.on('error', (err) => {
    const reason = err.code || err.message;
    console.error(
      `kuyruk monitor: cannot listen on ${url} (${reason}), ` +
        'monitoring is disabled',
    );
  });
  server.listen(port, host, () => {
    console.log(`kuyruk monitor: ${url}`);
  });
  server.unref();

  const handle = {
    url,
    port,
    host,
    watch: (queue, queueName) => {
      const label = queueName || `queue-${watchers.size + 1}`;
      if (watchers.has(label)) {
        throw new Error(`Queue name "${label}" is already watched`);
      }
      if (queue[MONITORED]) {
        throw new Error('Monitor is already attached to this queue');
      }
      queue[MONITORED] = true;
      const watcher = createWatcher(queue, label, history);
      watchers.set(label, watcher);
      if (clients.size > 0) {
        broadcast({
          type: 'watched',
          ts: Date.now(),
          queue: watcher.queuePayload(),
        });
      }
      return handle;
    },
    stop: () => {
      clearInterval(flusher);
      clearInterval(heartbeat);
      for (const client of clients) client.end();
      clients.clear();
      server.close(() => {});
      for (const watcher of watchers.values()) watcher.detach();
      watchers.clear();
    },
  };

  if (isQueue) handle.watch(queueOrOptions, options.name || 'kuyruk');
  return handle;
};

module.exports = { monitor };
