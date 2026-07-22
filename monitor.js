'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const UI_PATH = path.join(__dirname, 'monitor.html');

const TIMEOUT_MESSAGES = new Set(['Process timed out!', 'Waiting timed out']);

const monitor = (queue, { port = 8228, host = '127.0.0.1' } = {}) => {
  const clients = new Set();
  const pendingSince = [];

  const send = (type, data = {}) => {
    if (clients.size === 0) return;
    const event = JSON.stringify({ type, ts: Date.now(), ...data });
    for (const client of clients) client.write(`data: ${event}\n\n`);
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

  const measureOnce = (started) => {
    let measured = false;
    return () => {
      if (measured) return;
      measured = true;
      send('executed', { duration: Date.now() - started });
    };
  };

  const instrument = (listener) => (item, callback) => {
    const enqueued = pendingSince.shift();
    send('start', {
      wait: enqueued === undefined ? 0 : Date.now() - enqueued,
      state: snapshot(),
    });
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
    send('start', { wait: Date.now() - enqueued, state: snapshot() });
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
    if (!isTask) pendingSince.push(enqueued);
    const accepted = originalAdd(toAdd, options);
    if (accepted) {
      send('added', { state: snapshot() });
    } else {
      if (!isTask) pendingSince.pop();
      send('rejected', { state: snapshot() });
    }
    return accepted;
  };

  const originalFinish = queue.finish.bind(queue);
  queue.finish = (err, res, details = {}) => {
    if (err) {
      const type = TIMEOUT_MESSAGES.has(err.message) ? 'timeout' : 'failure';
      send(type, {
        error: err.message,
        factor: details.factor,
        state: snapshot(),
      });
    } else {
      send('success', { factor: details.factor, state: snapshot() });
    }
    originalFinish(err, res, details);
  };

  for (const method of ['pause', 'resume', 'clear']) {
    const original = queue[method].bind(queue);
    queue[method] = () => {
      const result = original();
      send(method, { state: snapshot() });
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
      });
      clients.add(res);
      const hello = JSON.stringify({
        type: 'state',
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

  const poller = setInterval(() => send('state', { state: snapshot() }), 500);
  poller.unref();

  const url = `http://${host}:${port}`;
  server.listen(port, host, () => {
    console.log(`kuyruk monitor: ${url}`);
  });
  server.unref();

  const stop = () => {
    clearInterval(poller);
    for (const client of clients) client.end();
    clients.clear();
    server.close();
  };

  return { url, port, host, stop };
};

module.exports = { monitor };
