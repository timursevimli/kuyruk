'use strict';

const test = require('node:test');
const assert = require('node:assert');
const Queue = require('../queue.js');

test('Done handling', () => {
  let doneCalled = false;

  const queue = new Queue(1)
    .process((item, callback) => {
      callback(null, item);
    })
    .done((err, { res }) => {
      assert.strictEqual(err, null);
      assert.strictEqual(res, 'test');

      doneCalled = true;
    });

  queue.add('test');

  setTimeout(() => {
    assert.strictEqual(doneCalled, true);
  }, 0);
});

test('Success handling', () => {
  let successCalled = false;

  const queue = new Queue(1)
    .process((item, callback) => {
      callback(null, item);
    })
    .success(({ res }) => {
      assert.strictEqual(res, 'test');

      successCalled = true;
    });

  queue.add('test');

  setTimeout(() => {
    assert.strictEqual(successCalled, true);
  }, 0);
});

test('Error handling', () => {
  let failureCalled = false;

  const queue = new Queue(1)
    .process((item, callback) => {
      callback(new Error('Task failed'), item);
    })
    .failure((err) => {
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
    .process((item, callback) => {
      setTimeout(callback, 100, null, item);
    })
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
    .pause()
    .process((item, callback) => {
      setTimeout(() => {
        callback(null, item);
      }, 0);
    })
    .failure((err) => {
      failureCalled = true;

      assert.strictEqual(err.message, 'Waiting timed out');
    });

  queue.add('test');

  setTimeout(() => {
    assert.strictEqual(failureCalled, false);

    queue.resume();

    assert.strictEqual(failureCalled, true);
    done();
  }, 100);
});

test('Pause handling', () => {
  let doneCalled = false;
  const queue = new Queue(1)
    .pause()
    .process((item, callback) => {
      callback(null, item);
    })
    .done(() => {
      doneCalled = true;
    });

  assert.strictEqual(doneCalled, false);

  queue.add('test');

  assert.strictEqual(doneCalled, false);
});

test('Resume handling', (t, done) => {
  let doneCalled = false;
  const queue = new Queue(1)
    .pause()
    .process((item, callback) => {
      setTimeout(() => {
        callback(null, item);
      }, 0);
    })
    .done(() => {
      doneCalled = true;
    });

  assert.strictEqual(doneCalled, false);

  queue.add('test');

  assert.strictEqual(doneCalled, false);

  queue.resume();

  setTimeout(() => {
    assert.strictEqual(doneCalled, true);
    done();
  }, 0);
});

test('Drain handling', () => {
  let drainCalled = false;

  const queue = new Queue(1)
    .process((item, callback) => {
      setTimeout(() => {
        callback(null, item);
      }, 0);
    })
    .drain(() => {
      drainCalled = true;
    });

  queue.add('test');

  setTimeout(() => {
    assert.strictEqual(drainCalled, true);
  }, 0);
});

test('Should task handling: async', (t, done) => {
  const items = new Array(100).fill('item').map((e, i) => e + i);
  const results = [];
  const job = (item) => Promise.resolve(item);

  const queue = new Queue(1)
    .process(job)
    .async()
    .success(({ res }) => {
      assert.ok(items.includes(res));
      results.push(res);
    })
    .failure((err) => {
      assert.fail(err.message);
    })
    .done((err, { res }) => {
      assert.strictEqual(err, null);
      assert.ok(items.includes(res));
    })
    .drain(() => {
      assert.strictEqual(items.length, results.length);
      done();
    });

  for (const item of items) {
    queue.add(item);
  }
});

test('Should task handling: callback', (t, done) => {
  const items = new Array(100).fill('item').map((e, i) => e + i);
  const results = [];
  const job = (item, cb) => {
    setTimeout(() => {
      cb(null, item);
    }, 0);
  };

  const queue = new Queue(1)
    .process(job)
    .success(({ res }) => {
      assert.ok(items.includes(res));

      results.push(res);
    })
    .failure((err) => {
      assert.fail(err.message);
    })
    .done((err, { res }) => {
      assert.strictEqual(err, null);
      assert.ok(items.includes(res));
    })
    .drain(() => {
      assert.strictEqual(items.length, results.length);
      done();
    });

  for (const item of items) {
    queue.add(item);
  }
});

test('Should task handling: promise', (t, done) => {
  const items = new Array(100).fill('item').map((e, i) => e + i);
  const results = [];

  const queue = new Queue(1)
    .success(({ res }) => {
      assert.ok(items.includes(res));

      results.push(res);
    })
    .failure((err) => {
      assert.fail(err.message);
    })
    .done((err, { res }) => {
      assert.strictEqual(err, null);
      assert.ok(items.includes(res));
    })
    .drain(() => {
      assert.strictEqual(items.length, results.length);
      done();
    });

  for (const item of items) {
    queue.add(() => Promise.resolve(item));
  }
});

test('Concurrency handling', (t, done) => {
  const channels = 5;

  const queue = new Queue(channels)
    .process((item, callback) => {
      setTimeout(callback, 0, null, item);
    })
    .done(() => {
      const channelsExceeded = queue.concurrency > channels;
      assert.strictEqual(channelsExceeded, false);
    })
    .drain(done);

  for (let i = 0; i < 50; i++) {
    queue.add(`test${i}`);
  }
});

test('Queue size handling', (t, done) => {
  const size = 10;

  const queue = new Queue(1, size)
    .process((item, callback) => {
      setTimeout(callback, 100, null, item);
    })
    .drain(() => {
      assert.strictEqual(queue.waiting.length, 0);
      done();
    });

  assert.strictEqual(queue.size, size);

  for (let i = 0; i < 20; i++) {
    queue.add(`test${i}`);
  }

  assert.strictEqual(queue.waiting.length, size);
});
