'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Queue = require('../queue.js');

test('Done handling', () => {
  const queue = new Queue(1);
  let doneCalled = false;

  queue.process((item, callback) => void callback(null, item));
  queue.done((err, result) => {
    assert.strictEqual(err, null);
    assert.strictEqual(result.res, 'test');
    doneCalled = true;
  });

  queue.add('test');

  setTimeout(() => {
    assert.strictEqual(doneCalled, true);
  }, 0);
});

test('Success handling', () => {
  const queue = new Queue(1);
  let successCalled = false;

  queue.process((item, callback) => void callback(null, item));
  queue.success((result) => {
    assert.strictEqual(result.res, 'test');
    successCalled = true;
  });

  queue.add('test');

  setTimeout(() => {
    assert.strictEqual(successCalled, true);
  }, 0);
});

test('Error handling', () => {
  const queue = new Queue(1);
  let failureCalled = false;

  queue.process((_, callback) => void callback(new Error('Task failed')));
  queue.failure((err) => {
    assert.strictEqual(err.message, 'Task failed');
    failureCalled = true;
  });

  queue.add('test');

  setTimeout(() => {
    assert.strictEqual(failureCalled, true);
  }, 0);
});

test('Timeout handling', () => {
  let onTimeoutCalled = false;
  let failureCalled = false;
  const queue = new Queue(1)
    .timeout(50, (err) => {
      onTimeoutCalled = true;
      assert.strictEqual(err.message, 'Process timed out!');
    })
    .process((item, callback) => void setTimeout(callback, 100, null, item))
    .failure((err) => {
      failureCalled = true;
      assert.strictEqual(err.message, 'Process timed out!');
    });

  queue.add('test');

  setTimeout(() => {
    assert.strictEqual(failureCalled, true);
    assert.strictEqual(onTimeoutCalled, true);
  }, 150);
});

test('Wait handling', (t, done) => {
  let failureCalled = false;
  const queue = new Queue(1)
    .wait(50)
    .process((item, callback) => void setTimeout(callback, 100, null, item))
    .failure((err) => {
      failureCalled = true;
      assert.strictEqual(err.message, 'Waiting timed out');
    });

  queue.add('test');

  assert.strictEqual(failureCalled, false);

  queue.add('test');

  setTimeout(() => {
    assert.strictEqual(failureCalled, true);
    done();
  }, 150);
});

test('Pause handling', () => {
  let doneCalled = false;
  const queue = new Queue(1)
    .pause()
    .process((item, callback) => void callback(null, item))
    .done(() => void (doneCalled = true));

  assert.strictEqual(doneCalled, false);

  queue.add('test');

  assert.strictEqual(doneCalled, false);
});

test('Resume handling', () => {
  let doneCalled = false;
  const queue = new Queue(1)
    .pause()
    .process((item, callback) => void callback(null, item))
    .done(() => void (doneCalled = true));

  assert.strictEqual(doneCalled, false);

  queue.add('test');

  assert.strictEqual(doneCalled, false);

  queue.resume();

  assert.strictEqual(doneCalled, true);
});

test('Promise mode', () => {
  let doneCalled = false;
  const job = (item) => new Promise((resolve) => void resolve(item));
  const queue = new Queue(1)
    .process(job)
    .async()
    .done((err, result) => {
      assert.strictEqual(err, null);
      assert.strictEqual(result.res, 'test');
      doneCalled = true;
    });

  queue.add('test');

  setTimeout(() => {
    assert.strictEqual(doneCalled, true);
  }, 0);
});

test('Drain handling', () => {
  let drainCalled = false;
  const queue = new Queue(1)
    .process((item, callback) => void callback(null, item))
    .drain(() => void (drainCalled = true));

  queue.add('test');

  setTimeout(() => {
    assert.strictEqual(drainCalled, true);
  }, 0);
});

test('Concurrency handling', (t, done) => {
  const channels = 5;
  const queue = new Queue(channels)
    .process((item, callback) => void setTimeout(callback, 0, null, item))
    .done(() => {
      const channelsExceeded = queue.concurrency > channels;
      assert.strictEqual(channelsExceeded, false);
    })
    .drain(done);

  for (let i = 0; i < 50; i++) queue.add(`test${i}`);
});

test('Queue size handling', (t, done) => {
  const size = 10;
  const queue = new Queue(1, size)
    .process((item, callback) => void setTimeout(callback, 100, null, item))
    .drain(() => {
      assert.strictEqual(queue.waiting.length, 0);
      done();
    });

  assert.strictEqual(queue.size, size);

  for (let i = 0; i < 20; i++) queue.add(`test${i}`);

  assert.strictEqual(queue.waiting.length, size);
});
