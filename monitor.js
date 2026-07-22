'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');
const { FixedQueue } = require('@tsevimli/collections');

const UI_PATH = path.join(__dirname, 'monitor.html');

const TIMEOUT_MESSAGES = new Set(['Process timed out!', 'Waiting timed out']);

const FLUSH_INTERVAL = 300;
const HEARTBEAT_INTERVAL = 25000;
const MAX_CLIENT_BUFFER = 1024 * 1024;
const MAX_SAMPLES_PER_FLUSH = 100;
const MAX_EVENTS_PER_FLUSH = 50;

const emptyBatch = () => ({
  counts: { added: 0, success: 0, failure: 0, timeout: 0, rejected: 0 },
  waits: [],
  execs: [],
  events: [],
  dropped: { waits: 0, execs: 0, events: 0 },
});

const monitor = (queue, { port = 8228, host = '127.0.0.1' } = {}) => {
  const clients = new Set();
  const pendingSince = new FixedQueue();
  let startedBeforeEnqueue = 0;
  let batch = emptyBatch();
  let dirty = false;
  let lastStateJson = '';

  const bump = (kind) => {
    batch.counts[kind]++;
    dirty = true;
  };

  const sample = (kind, value) => {
    if (batch[kind].length < MAX_SAMPLES_PER_FLUSH) batch[kind].push(value);
    else batch.dropped[kind]++;
    dirty = true;
  };

  const event = (type, detail = '', factor = undefined) => {
    if (batch.events.length < MAX_EVENTS_PER_FLUSH) {
      batch.events.push({ type, ts: Date.now(), detail, factor });
    } else {
      batch.dropped.events++;
    }
    dirty = true;
  };

  const snapshot = () => {
    const state = {
      concurrency: queue.concurrency,
      size: queue.size === Infinity ? null : queue.size,
      active: queue.count,
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
          active: child.count,
          waiting: child.waiting.length,
        });
      }
      state.active = state.channels.reduce((sum, c) => sum + c.active, 0);
      state.waiting = state.channels.reduce((sum, c) => sum + c.waiting, 0);
    }
    return state;
  };

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
    if (clients.size === 0) {
      if (dirty) {
        batch = emptyBatch();
        dirty = false;
      }
      return;
    }
    const state = snapshot();
    const stateJson = JSON.stringify(state);
    if (!dirty && stateJson === lastStateJson) return;
    lastStateJson = stateJson;
    broadcast({ type: 'batch', ts: Date.now(), state, ...batch });
    batch = emptyBatch();
    dirty = false;
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

  if (queue.onProcess) queue.onProcess = instrument(queue.onProcess);
  const originalProcess = queue.process.bind(queue);
  queue.process = (listener) => originalProcess(instrument(listener));

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

  const server = http.createServer((req, res) => {
    if (req.url === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(fs.readFileSync(UI_PATH));
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
        state: snapshot(),
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
  server.listen(port, host, () => {
    console.log(`kuyruk monitor: ${url}`);
  });
  server.unref();

  const stop = () => {
    clearInterval(flusher);
    clearInterval(heartbeat);
    for (const client of clients) client.end();
    clients.clear();
    server.close();
  };

  return { url, port, host, stop };
};

module.exports = { monitor };
