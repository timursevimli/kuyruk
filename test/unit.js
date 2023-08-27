'use strict';

const { test, plan } = require('tap');
const Queue = require('../queue.js');

plan(20);

const items = new Array(10).fill('test').map((e, i) => e + i);

test('Done handling', (t) => {
  let doneCalled = false;

  const queue = new Queue(1)
    .process((item, callback) => {
      setTimeout(() => {
        callback(null, item);
      }, 0);
    })
    .done((err, { res }) => {
      t.equal(err, null);
      t.equal(res, 'test');

      doneCalled = true;
    });

  t.plan(3);

  queue.add('test');

  setTimeout(() => {
    t.equal(doneCalled, true);
  }, 0);
});

test('Success handling', (t) => {
  let successCalled = false;

  const queue = new Queue(1)
    .process((item, callback) => {
      setTimeout(() => {
        callback(null, item);
      }, 0);
    })
    .success(({ res }) => {
      t.equal(res, 'test');

      successCalled = true;
    });

  t.plan(2);

  queue.add('test');

  setTimeout(() => {
    t.equal(successCalled, true);
  }, 0);
});

test('Error handling', (t) => {
  let failureCalled = false;

  const queue = new Queue(1)
    .process((item, callback) => {
      setTimeout(() => {
        callback(new Error('Task failed'), item);
      }, 0);
    })
    .failure((err) => {
      t.equal(err.message, 'Task failed');

      failureCalled = true;
    });

  t.plan(2);

  queue.add('test');

  setTimeout(() => {
    t.equal(failureCalled, true);
  }, 0);
});

test('Timeout handling', (t) => {
  let onTimeoutCalled = false;
  let failureCalled = false;
  let timer = null;

  const queue = new Queue(1)
    .process((item, callback) => {
      timer = setTimeout(() => {
        t.fail('Never should this line');
        callback(null, item);
      }, 100);
    })
    .timeout(50, (err) => {
      t.equal(err.message, 'Process timed out!');

      onTimeoutCalled = true;
    })
    .failure((err) => {
      t.equal(err.message, 'Process timed out!');

      failureCalled = true;
    });

  t.plan(4);

  queue.add('test');

  setTimeout(() => {
    t.equal(failureCalled, true);
    t.equal(onTimeoutCalled, true);
    clearTimeout(timer);
  }, 50);
});

test('Wait handling', (t) => {
  let failureCalled = false;

  const queue = new Queue(1)
    .wait(25)
    .pause()
    .process((item, callback) => {
      setTimeout(() => {
        t.fail('Never should this line');
        callback(null, item);
      }, 0);
    })
    .failure((err) => {
      t.equal(err.message, 'Waiting timed out');

      failureCalled = true;
    });

  t.plan(3);

  queue.add('test');

  setTimeout(() => {
    t.equal(failureCalled, false);

    queue.resume();

    t.equal(failureCalled, true);
  }, 50);
});

test('Pause handling', (t) => {
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

  t.plan(2);

  t.equal(doneCalled, false);

  queue.add('test');

  t.equal(doneCalled, false);
});

test('Resume handling', (t) => {
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

  t.plan(3);

  t.equal(doneCalled, false);

  queue.add('test');

  t.equal(doneCalled, false);

  queue.resume();

  setTimeout(() => {
    t.equal(doneCalled, true);
  }, 0);
});

test('Drain handling', (t) => {
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

  t.plan(1);

  queue.add('test');

  setTimeout(() => {
    t.equal(drainCalled, true);
  }, 0);
});

test('Should task handling: async', (t) => {
  const results = [];

  const queue = new Queue(1)
    .process(
      (item) =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(item);
          }, 0);
        }),
    )
    .async()
    .done((err, { res }) => {
      t.equal(err, null);
      t.ok(items.includes(res));
      results.push(res);
    })
    .drain(() => {
      t.equal(items.length, results.length);
    });

  t.plan(2 * items.length + 1);

  for (const item of items) {
    queue.add(item);
  }
});

test('Should task handling: callback', (t) => {
  const results = [];

  const queue = new Queue(1)
    .process((item, cb) => {
      setTimeout(() => {
        cb(null, item);
      }, 0);
    })
    .done((err, { res }) => {
      t.equal(err, null);
      t.ok(items.includes(res));
      results.push(res);
    })
    .drain(() => {
      t.equal(items.length, results.length);
    });

  t.plan(2 * items.length + 1);

  for (const item of items) {
    queue.add(item);
  }
});

test('Should task handling: promise', (t) => {
  const results = [];

  const queue = new Queue(1)
    .done((err, { res }) => {
      t.equal(err, null);
      t.ok(items.includes(res));
      results.push(res);
    })
    .drain(() => {
      t.equal(items.length, results.length);
    });

  t.plan(2 * items.length + 1);

  for (const item of items) {
    queue.add(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(item);
          }, 0);
        }),
    );
  }
});

test('Should task handling: multiple', (t) => {
  const results = [];

  const queue = new Queue(1)
    .process((item, callback) => {
      setTimeout(() => {
        callback(null, item);
      }, 0);
    })
    .done((err, { res }) => {
      t.equal(err, null);
      t.ok(items.includes(res));

      results.push(res);
    })
    .drain(() => {
      t.equal(items.length * 2, results.length);
    });

  t.plan(4 * items.length + 1);

  for (const item of items) {
    queue.add(item);
    queue.add(
      () =>
        new Promise((resolve) => {
          setTimeout(() => {
            resolve(item);
          }, 0);
        }),
    );
  }
});

test('Concurrency handling', (t) => {
  const taskCount = 50;
  const channels = 5;

  const queue = new Queue(channels)
    .process((item, callback) => {
      setTimeout(callback, 0, null, item);
    })
    .done(() => {
      const channelsExceeded = queue.concurrency > channels;
      t.equal(channelsExceeded, false);
    });

  t.plan(taskCount + 1);

  for (let i = 0; i <= taskCount; i++) {
    queue.add(`test${i}`);
  }
});

test('Queue size handling', (t) => {
  const size = 10;

  const queue = new Queue(1, size)
    .process((item, callback) => {
      setTimeout(callback, 100, null, item);
    })
    .drain(() => {
      t.equal(queue.waiting.length, 0);
      t.equal(queue.size, size);
      t.equal(queue.count, 0);
    });

  t.plan(5);

  t.equal(queue.size, size);

  for (let i = 0; i < 20; i++) {
    queue.add(`test${i}`);
  }

  t.equal(queue.waiting.length, size);
});

test('Should add task without process', (t) => {
  const queue = new Queue(1).done(() => {
    t.fail('Never should this line');
  });

  t.plan(1);

  try {
    queue.add('test');
    t.fail('Never should this line');
  } catch (err) {
    t.equal(err.message, 'Process is not defined');
  }
});

test('Queue pipe handling', (t) => {
  const dest1 = new Queue(1)
    .process((item, callback) => {
      setTimeout(() => {
        callback(null, item);
      }, 0);
    })
    .done((err, { res }) => {
      t.equal(err, null);
      t.ok(items.includes(res));
    });

  const dest2 = new Queue(1)
    .process((item, callback) => {
      setTimeout(() => {
        callback(null, item);
      }, 0);
    })
    .done((err, { res }) => {
      t.equal(err, null);
      t.ok(items.includes(res));
    });

  const queue = new Queue(1)
    .process((item, callback) => {
      setTimeout(() => {
        callback(null, item);
      }, 0);
    })
    .done((err, { res }) => {
      t.equal(err, null);
      t.ok(items.includes(res));
    });

  t.plan(6 * items.length);

  queue.pipe(dest1).pipe(dest2);

  for (const item of items) {
    queue.add(item);
  }
});

test('Should queue clear', (t) => {
  const queue = new Queue(1).pause();

  const dest = new Queue(1);

  queue.pipe(dest);

  t.plan(5);

  queue.add('test1');
  queue.add('test2');
  queue.add('test3');

  t.equal(queue.waiting.length, 3);
  t.equal(queue.destination, dest);

  queue.clear();

  t.equal(queue.waiting.length, 0);
  t.equal(queue.count, 0);
  t.equal(queue.destination, null);
});

test('Fifo', (t) => {
  let i = 0;

  const queue = new Queue(1)
    .process((item, callback) => {
      setTimeout(() => {
        callback(null, item);
      }, 0);
    })
    .success(({ res }) => {
      t.equal(items[i++], res);
    });

  t.plan(items.length);

  for (const item of items) {
    queue.add(item);
  }
});

test('Lifo', (t) => {
  let i = items.length - 1;

  const queue = new Queue(1)
    .lifo()
    .pause()
    .process((item, callback) => {
      setTimeout(() => {
        callback(null, item);
      }, 0);
    })
    .success(({ res }) => {
      t.equal(items[i--], res);
    });

  t.plan(items.length);

  for (const item of items) {
    queue.add(item);
  }

  queue.resume();
});

test('Priority', (t) => {
  const cases = [
    'test0',
    'test1',
    'test2',
    'test9',
    'test8',
    'test7',
    'test6',
    'test5',
    'test4',
    'test3',
  ];
  let i = 0;

  const queue = new Queue(3)
    .priority()
    .process((item, callback) => {
      setTimeout(() => {
        callback(null, item);
      }, 0);
    })
    .success(({ res }) => {
      t.equal(res, cases[i++]);
    });

  t.plan(cases.length + 1);

  t.equal(cases.length, cases.length);

  const max = cases.length;
  for (let i = 0; i < max; i++) {
    const item = cases[i];
    const priority = max - i;
    queue.add(item, { priority });
  }
});
