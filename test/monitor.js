'use strict';

const http = require('http');
const { test, plan } = require('tap');
const { Kuyruk } = require('../kuyruk.js');
const { monitor } = require('../monitor.js');

plan(9);

const HOST = '127.0.0.1';
let portCounter = 8840;
const nextPort = () => portCounter++;

const get = (port, path) =>
  new Promise((resolve, reject) => {
    http
      .get({ host: HOST, port, path }, (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => resolve({ status: res.statusCode, body }));
      })
      .on('error', reject);
  });

const post = (port, path) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port, path, method: 'POST' },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      },
    );
    req.on('error', reject);
    req.end();
  });

const connect = (port) =>
  new Promise((resolve, reject) => {
    const req = http.get({ host: HOST, port, path: '/events' }, (res) => {
      const client = {
        messages: [],
        cursor: 0,
        waiters: [],
        buffer: '',
        close: () => req.destroy(),
      };
      client.take = (match) => {
        for (; client.cursor < client.messages.length; client.cursor++) {
          const msg = client.messages[client.cursor];
          if (match(msg)) {
            client.cursor++;
            return Promise.resolve(msg);
          }
        }
        return new Promise((res2) => {
          client.waiters.push({ match, resolve: res2 });
        });
      };
      res.setEncoding('utf8');
      res.on('data', (chunk) => {
        client.buffer += chunk;
        let idx = client.buffer.indexOf('\n\n');
        while (idx !== -1) {
          const raw = client.buffer.slice(0, idx);
          client.buffer = client.buffer.slice(idx + 2);
          idx = client.buffer.indexOf('\n\n');
          if (!raw.startsWith('data: ')) continue;
          const msg = JSON.parse(raw.slice('data: '.length));
          client.messages.push(msg);
          const waiter = client.waiters.find((w) => w.match(msg));
          if (waiter) {
            client.waiters.splice(client.waiters.indexOf(waiter), 1);
            client.cursor = client.messages.length;
            waiter.resolve(msg);
          }
        }
      });
      resolve(client);
    });
    req.on('error', reject);
  });

const collectBatches = async (client, kind, target) => {
  const totals = { added: 0, success: 0, failure: 0, timeout: 0, rejected: 0 };
  const waits = [];
  const execs = [];
  const events = [];
  while (totals[kind] < target) {
    const msg = await client.take((m) => m.type === 'batch');
    for (const key of Object.keys(totals)) totals[key] += msg.counts[key];
    waits.push(...msg.waits);
    execs.push(...msg.execs);
    events.push(...msg.events);
  }
  return { totals, waits, execs, events };
};

test('Dashboard and unknown routes', async (t) => {
  const port = nextPort();
  const queue = new Kuyruk({ concurrency: 1 });
  const handle = monitor(queue, { port });

  const page = await get(port, '/');
  t.equal(page.status, 200);
  t.match(page.body, /kuyruk monitor/);

  const missing = await get(port, '/nope');
  t.equal(missing.status, 404);

  handle.stop();
});

test('Hello message carries meta and initial state', async (t) => {
  const port = nextPort();
  const queue = new Kuyruk({ concurrency: 3, size: 7 });
  const handle = monitor(queue, { port, name: 'test-queue' });

  const client = await connect(port);
  const hello = await client.take((m) => m.type === 'hello');
  t.equal(hello.meta.name, 'test-queue');
  t.equal(hello.meta.pid, process.pid);
  t.type(hello.meta.startedAt, 'number');
  t.equal(hello.state.concurrency, 3);
  t.equal(hello.state.size, 7);
  t.equal(hello.state.active, 0);
  t.equal(hello.state.paused, false);

  client.close();
  handle.stop();
});

test('Aggregates task lifecycle into batches', async (t) => {
  const port = nextPort();
  const results = [];
  const queue = new Kuyruk({ concurrency: 1 })
    .process((item, callback) => {
      setTimeout(callback, 10, null, item * 2);
    })
    .success((res) => results.push(res));
  const handle = monitor(queue, { port });

  const client = await connect(port);
  t.equal(queue.add(1), true);
  t.equal(queue.add(2), true);
  t.equal(queue.add(3), true);

  const { totals, waits, execs } = await collectBatches(client, 'success', 3);
  t.equal(totals.added, 3);
  t.equal(totals.success, 3);
  t.equal(totals.failure, 0);
  t.equal(execs.length, 3, 'exec duration sampled for every task');
  t.equal(waits.length, 2, 'wait sampled only for queued tasks');
  t.strictSame(results.sort(), [2, 4, 6], 'user success listener intact');

  client.close();
  handle.stop();
});

test('Reports failures and process timeouts as events', async (t) => {
  const port = nextPort();
  let timedOut = false;
  const queue = new Kuyruk({ concurrency: 2 })
    .process((item, callback) => {
      if (item === 'slow') setTimeout(callback, 200, null, item);
      else setTimeout(callback, 5, new Error('boom'));
    })
    .timeout(50, () => {
      timedOut = true;
    })
    .failure(() => {});
  const handle = monitor(queue, { port });

  const client = await connect(port);
  queue.add('fail');
  queue.add('slow');

  const { totals, events } = await collectBatches(client, 'timeout', 1);
  t.equal(totals.failure >= 1, true);
  t.equal(totals.timeout, 1);
  const failure = events.find((e) => e.type === 'failure');
  t.equal(failure.detail, 'boom');
  const timeout = events.find((e) => e.type === 'timeout');
  t.equal(timeout.detail, 'Process timed out!');
  t.equal(timedOut, true, 'user onTimeout listener intact');

  client.close();
  handle.stop();
});

test('Wait timeout surfaces as timeout event', async (t) => {
  const port = nextPort();
  const queue = new Kuyruk({ concurrency: 1 })
    .wait(20)
    .process((item, callback) => {
      setTimeout(callback, 100, null, item);
    })
    .failure(() => {});
  const handle = monitor(queue, { port });

  const client = await connect(port);
  queue.add('first');
  queue.add('starved');

  const { totals, events } = await collectBatches(client, 'timeout', 1);
  t.equal(totals.timeout, 1);
  const timeout = events.find((e) => e.type === 'timeout');
  t.equal(timeout.detail, 'Waiting timed out');

  client.close();
  handle.stop();
});

test('Counts rejected adds when the queue is full', async (t) => {
  const port = nextPort();
  const queue = new Kuyruk({ concurrency: 1, size: 1 })
    .process((item, callback) => {
      setTimeout(callback, 50, null, item);
    })
    .success(() => {});
  const handle = monitor(queue, { port });

  const client = await connect(port);
  t.equal(queue.add('a'), true);
  t.equal(queue.add('b'), true);
  t.equal(queue.add('c'), false, 'add still reports rejection');

  const { totals, events } = await collectBatches(client, 'rejected', 1);
  t.equal(totals.added, 2);
  t.equal(totals.rejected, 1);
  const rejected = events.find((e) => e.type === 'rejected');
  t.equal(rejected.detail, 'queue full');

  client.close();
  handle.stop();
});

test('Caps events and samples per flush', async (t) => {
  const port = nextPort();
  const queue = new Kuyruk({ concurrency: 1 })
    .process((item, callback) => {
      callback(new Error('always fails'));
    })
    .failure(() => {});
  const handle = monitor(queue, { port });

  const client = await connect(port);
  for (let i = 0; i < 150; i++) queue.add(i);

  const { totals, events, execs } = await collectBatches(
    client,
    'failure',
    150,
  );
  t.equal(totals.failure, 150, 'every completion counted');
  t.equal(events.length, 50, 'events capped per flush');
  t.equal(execs.length, 100, 'samples capped per flush');

  const droppedMsg = client.messages.find(
    (m) => m.type === 'batch' && m.dropped.events > 0,
  );
  t.equal(droppedMsg.dropped.events, 100, 'dropped events counted');
  t.equal(droppedMsg.dropped.execs, 50, 'dropped samples counted');

  client.close();
  handle.stop();
});

test('Control endpoints drive the queue', async (t) => {
  const port = nextPort();
  const queue = new Kuyruk({ concurrency: 1 });
  const handle = monitor(queue, { port });

  const client = await connect(port);
  t.equal(await post(port, '/api/pause'), 204);
  t.equal(queue.paused, true);
  const paused = await client.take((m) => m.state && m.state.paused === true);
  t.ok(paused, 'paused state broadcast');

  t.equal(await post(port, '/api/resume'), 204);
  t.equal(queue.paused, false);

  t.equal(await post(port, '/api/bogus'), 404);
  t.equal(await post(port, '/api/add'), 404, 'only whitelisted controls');

  client.close();
  handle.stop();
});

test('stop() shuts the server down', async (t) => {
  const port = nextPort();
  const queue = new Kuyruk({ concurrency: 1 });
  const handle = monitor(queue, { port });

  const before = await get(port, '/');
  t.equal(before.status, 200);

  handle.stop();
  await t.rejects(get(port, '/'), 'connections refused after stop');
});
