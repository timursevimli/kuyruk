'use strict';

const http = require('http');
const { test, plan } = require('tap');
const { Kuyruk } = require('../kuyruk.js');
const { monitor } = require('../monitor.js');

plan(18);

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

const post = (port, path, headers = { 'x-kuyruk-monitor': '1' }) =>
  new Promise((resolve, reject) => {
    const req = http.request(
      { host: HOST, port, path, method: 'POST', headers },
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
        anyWaiters: [],
        buffer: '',
        close: () => req.destroy(),
      };
      client.waitAny = () =>
        new Promise((res2) => {
          client.anyWaiters.push(res2);
        });
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
          for (const notify of client.anyWaiters.splice(0)) notify();
        }
      });
      resolve(client);
    });
    req.on('error', reject);
  });

const partOf = (msg, queueName) => {
  if (msg.type !== 'batch') return null;
  return msg.queues.find((q) => q.name === queueName) || null;
};

// Scans the full message backlog with its own index, so two sequential
// collects for different queues never starve each other.
const collectBatches = async (client, queueName, kind, target) => {
  const totals = { added: 0, success: 0, failure: 0, timeout: 0, rejected: 0 };
  const waits = [];
  const execs = [];
  const events = [];
  let last = null;
  let idx = 0;
  while (totals[kind] < target) {
    if (idx >= client.messages.length) {
      await client.waitAny();
      continue;
    }
    const part = partOf(client.messages[idx++], queueName);
    if (!part) continue;
    for (const key of Object.keys(totals)) totals[key] += part.counts[key];
    waits.push(...part.waits);
    execs.push(...part.execs);
    events.push(...part.events);
    last = part;
  }
  return { totals, waits, execs, events, last };
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
  t.equal(hello.queues.length, 1);
  const q = hello.queues[0];
  t.equal(q.name, 'test-queue');
  t.equal(q.state.concurrency, 3);
  t.equal(q.state.size, 7);
  t.equal(q.state.active, 0);
  t.equal(q.state.paused, false);
  t.strictSame(q.totals, {
    added: 0,
    success: 0,
    failure: 0,
    timeout: 0,
    rejected: 0,
  });

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

  const { totals, waits, execs, last } = await collectBatches(
    client,
    'kuyruk',
    'success',
    3,
  );
  t.equal(totals.added, 3);
  t.equal(totals.success, 3);
  t.equal(totals.failure, 0);
  t.equal(last.totals.success, 3, 'server carries cumulative totals');
  t.equal(last.totals.added, 3, 'cumulative totals survive batch resets');
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

  const { totals, events } = await collectBatches(
    client,
    'kuyruk',
    'timeout',
    1,
  );
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

  const { totals, events } = await collectBatches(
    client,
    'kuyruk',
    'timeout',
    1,
  );
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

  const { totals, events } = await collectBatches(
    client,
    'kuyruk',
    'rejected',
    1,
  );
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
    'kuyruk',
    'failure',
    150,
  );
  t.equal(totals.failure, 150, 'every completion counted');
  t.equal(events.length, 50, 'events capped per flush');
  t.equal(execs.length, 100, 'samples capped per flush');

  const droppedMsg = client.messages
    .map((m) => partOf(m, 'kuyruk'))
    .find((p) => p && p.dropped.events > 0);
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
  t.equal(await post(port, '/api/kuyruk/pause'), 204);
  t.equal(queue.paused, true);
  const paused = await client.take((m) => {
    const part = partOf(m, 'kuyruk');
    return Boolean(part) && part.state.paused === true;
  });
  t.ok(paused, 'paused state broadcast');

  t.equal(await post(port, '/api/kuyruk/resume'), 204);
  t.equal(queue.paused, false);

  t.equal(await post(port, '/api/kuyruk/bogus'), 404);
  t.equal(await post(port, '/api/kuyruk/add'), 404, 'whitelisted controls');
  t.equal(await post(port, '/api/nope/pause'), 404, 'unknown queue name');

  t.equal(
    await post(port, '/api/kuyruk/pause', {}),
    403,
    'blocked without guard header',
  );
  t.equal(queue.paused, false, 'queue untouched by blocked request');

  client.close();
  handle.stop();
});

test('Attaching a second monitor throws', async (t) => {
  const port = nextPort();
  const queue = new Kuyruk({ concurrency: 1 });
  const handle = monitor(queue, { port });

  t.throws(
    () => monitor(queue, { port: nextPort() }),
    /already attached/,
    'double instrumentation refused',
  );

  handle.stop();
  const again = monitor(queue, { port: nextPort() });
  t.ok(again, 'can re-attach after stop()');
  again.stop();
});

test('stop() restores queue methods', async (t) => {
  const port = nextPort();
  const listener = (item, callback) => callback(null, item);
  const queue = new Kuyruk({ concurrency: 1 }).process(listener);
  const handle = monitor(queue, { port });

  t.not(queue.add, Kuyruk.prototype.add, 'add is wrapped while attached');
  t.not(queue.onProcess, listener, 'listener is wrapped while attached');

  handle.stop();
  t.equal(queue.add, Kuyruk.prototype.add, 'add restored');
  t.equal(queue.process, Kuyruk.prototype.process, 'process restored');
  t.equal(queue.finish, Kuyruk.prototype.finish, 'finish restored');
  t.equal(queue.pause, Kuyruk.prototype.pause, 'pause restored');
  t.equal(queue.resume, Kuyruk.prototype.resume, 'resume restored');
  t.equal(queue.clear, Kuyruk.prototype.clear, 'clear restored');
  t.equal(queue.onProcess, listener, 'user listener restored');
});

test('Occupied port does not crash the process', async (t) => {
  const port = nextPort();
  const first = monitor(new Kuyruk({ concurrency: 1 }), { port });
  const second = monitor(new Kuyruk({ concurrency: 1 }), { port });

  await new Promise((resolve) => {
    setTimeout(resolve, 150);
  });
  const page = await get(port, '/');
  t.equal(page.status, 200, 'first monitor keeps serving');
  t.pass('EADDRINUSE handled without throwing');

  first.stop();
  second.stop();
});

test('Replays recent history to late clients', async (t) => {
  const port = nextPort();
  const queue = new Kuyruk({ concurrency: 1 })
    .process((item, callback) => {
      if (item === 'bad') callback(new Error('history boom'));
      else callback(null, item);
    })
    .success(() => {})
    .failure(() => {});
  const handle = monitor(queue, { port });

  const witness = await connect(port);
  queue.add('ok');
  queue.add('bad');
  queue.add('ok');
  await collectBatches(witness, 'kuyruk', 'success', 2);
  witness.close();

  const late = await connect(port);
  const hello = await late.take((m) => m.type === 'hello');
  const history = hello.queues[0].history;
  const failure = history.events.find((e) => e.type === 'failure');
  t.equal(failure.detail, 'history boom', 'failure replayed');
  const successes = history.events
    .filter((e) => e.type === 'success')
    .reduce((sum, e) => sum + e.count, 0);
  t.equal(successes, 2, 'success groups replayed with counts');
  const completed = history.buckets.values.reduce((s, v) => s + v, 0);
  t.equal(completed, 3, 'throughput buckets replayed');

  late.close();
  handle.stop();
});

test('History is capped and details truncated', async (t) => {
  const port = nextPort();
  const longMessage = 'x'.repeat(500);
  const queue = new Kuyruk({ concurrency: 1 })
    .process((item, callback) => {
      callback(new Error(longMessage));
    })
    .failure(() => {});
  const handle = monitor(queue, { port, history: 10 });

  for (let i = 0; i < 150; i++) queue.add(i);

  const client = await connect(port);
  const hello = await client.take((m) => m.type === 'hello');
  const history = hello.queues[0].history;
  t.equal(history.events.length, 10, 'ring buffer never grows past cap');
  t.equal(
    history.events[0].detail.length,
    200,
    'details truncated to 200 chars',
  );
  client.close();
  handle.stop();

  const bare = nextPort();
  const off = monitor(new Kuyruk({ concurrency: 1 }), {
    port: bare,
    history: 0,
  });
  const client2 = await connect(bare);
  const hello2 = await client2.take((m) => m.type === 'hello');
  t.strictSame(
    hello2.queues[0].history.events,
    [],
    'history: 0 disables replay',
  );
  client2.close();
  off.stop();
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

test('Watches multiple queues on one port', async (t) => {
  const port = nextPort();
  const fast = new Kuyruk({ concurrency: 5 })
    .process((item, callback) => {
      setTimeout(callback, 5, null, item);
    })
    .success(() => {});
  const slow = new Kuyruk({ concurrency: 1 })
    .process((item, callback) => {
      setTimeout(callback, 30, new Error('slow boom'));
    })
    .failure(() => {});

  const handle = monitor({ port });
  handle.watch(fast, 'fast').watch(slow, 'slow');

  t.throws(
    () => handle.watch(new Kuyruk({ concurrency: 1 }), 'fast'),
    /already watched/,
    'name collision refused',
  );

  const client = await connect(port);
  const hello = await client.take((m) => m.type === 'hello');
  t.strictSame(
    hello.queues.map((q) => q.name).sort(),
    ['fast', 'slow'],
    'both queues in hello',
  );

  for (let i = 0; i < 3; i++) fast.add(i);
  slow.add('x');

  const fastSeen = await collectBatches(client, 'fast', 'success', 3);
  t.equal(fastSeen.totals.success, 3, 'fast counted separately');
  const slowSeen = await collectBatches(client, 'slow', 'failure', 1);
  t.equal(slowSeen.totals.failure, 1, 'slow counted separately');

  t.equal(await post(port, '/api/slow/pause'), 204);
  t.equal(slow.paused, true, 'control targets the named queue');
  t.equal(fast.paused, false, 'other queue untouched');
  await post(port, '/api/slow/resume');

  const third = new Kuyruk({ concurrency: 1 });
  handle.watch(third, 'third');
  const watched = await client.take((m) => m.type === 'watched');
  t.equal(watched.queue.name, 'third', 'late watch announced to clients');

  client.close();
  handle.stop();
});

test('Round-robin snapshot reports per-factor channels', async (t) => {
  const port = nextPort();
  // Concurrency 0 keeps every item waiting, so the channel counts are
  // deterministic and no task timers linger after the test.
  const queue = new Kuyruk({ concurrency: 0 }).roundRobin();
  const handle = monitor(queue, { port });

  queue.add('a', { factor: 1 });
  queue.add('b', { factor: 1 });
  queue.add('c', { factor: 2 });

  const client = await connect(port);
  const hello = await client.take((m) => m.type === 'hello');
  const state = hello.queues[0].state;
  t.equal(state.roundRobin, true, 'round-robin flagged');
  const byFactor = {};
  for (const c of state.channels) byFactor[c.factor] = c;
  t.strictSame(
    Object.keys(byFactor)
      .map(Number)
      .sort((a, b) => a - b),
    [1, 2],
    'one channel per distinct factor',
  );
  t.equal(byFactor[1].waiting, 2, 'factor 1 holds both its items');
  t.equal(byFactor[2].waiting, 1, 'factor 2 holds its item');
  t.equal(state.active, 0, 'nothing active at concurrency 0');
  t.equal(state.waiting, 3, 'aggregate waiting across channels');

  client.close();
  handle.stop();
});

test('Auto-names queues watched without a name', async (t) => {
  const port = nextPort();
  const handle = monitor({ port });
  handle.watch(new Kuyruk({ concurrency: 1 }));
  handle.watch(new Kuyruk({ concurrency: 1 }));

  const client = await connect(port);
  const hello = await client.take((m) => m.type === 'hello');
  t.strictSame(
    hello.queues.map((q) => q.name).sort(),
    ['queue-1', 'queue-2'],
    'sequential default names',
  );

  client.close();
  handle.stop();
});

test('Negative history size disables replay', async (t) => {
  const port = nextPort();
  const queue = new Kuyruk({ concurrency: 1 })
    .process((item, callback) => {
      callback(new Error('boom'));
    })
    .failure(() => {});
  const handle = monitor(queue, { port, history: -1 });

  for (let i = 0; i < 5; i++) queue.add(i);

  const client = await connect(port);
  const hello = await client.take((m) => m.type === 'hello');
  t.strictSame(hello.queues[0].history.events, [], 'no events retained');

  client.close();
  handle.stop();
});
