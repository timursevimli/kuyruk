'use strict';

const { FixedQueue } = require('@tsevimli/collections');
const { debounce } = require('./utils.js');

class Queue {
  constructor({ concurrency = 1, size = Infinity }) {
    this.concurrency = concurrency;
    this.size = size;
    this.count = 0;
    this.waiting = new FixedQueue();
    this.destination = null;
    this.paused = false;
    this.factor = undefined;
    this.waitTimeout = Infinity;
    this.processTimeout = Infinity;
    this.debounceInterval = 0;
    this.debounceCount = Infinity;
    this.fifoMode = true;
    this.roundRobinMode = false;
    this.priorityMode = false;
    this.debounceMode = false;
    this.onProcess = null;
    this.onDone = null;
    this.onSuccess = null;
    this.onTimeout = null;
    this.onFailure = null;
    this.onDrain = null;
  }

  static channels({ concurrency, size }) {
    return new Queue({ concurrency, size });
  }

  #next(item) {
    let timer = null;
    let finished = false;
    this.count++;
    let execute = (err = null, res = item) => {
      if (!finished) {
        finished = true;
        if (timer) {
          clearTimeout(timer);
          timer = null;
        }
        this.count--;
        setTimeout(() => {
          if (this.waiting.length > 0) this.#takeNext();
        }, 0);
        this.finish(err, res);
      }
    };
    if (
      this.debounceMode &&
      this.debounceInterval > 0 &&
      this.debounceCount-- > 0
    ) {
      execute = debounce(execute, this.debounceInterval);
    }
    if (this.processTimeout !== Infinity) {
      timer = setTimeout(() => {
        timer = null;
        const err = new Error('Process timed out!');
        if (this.onTimeout) this.onTimeout(err);
        execute(err);
      }, this.processTimeout);
    }
    if (typeof item === 'function') {
      this.#runItem(item, execute);
    } else {
      if (!this.onProcess) {
        throw new Error('Process is not defined');
      }
      const result = this.onProcess(item, execute);
      if (result && result.then) {
        result.then((res) => void execute(null, res), execute);
      }
    }
  }

  #takeNext() {
    if (this.paused) return;
    const { waiting, waitTimeout } = this;
    const task = waiting.shift();
    if (waitTimeout !== Infinity) {
      const delay = Date.now() - task.start;
      if (delay > waitTimeout) {
        const err = new Error('Waiting timed out');
        this.finish(err, task.item);
        if (waiting.length > 0) {
          setTimeout(() => {
            if (!this.paused && waiting.length > 0) {
              this.#takeNext();
            }
          }, 0);
        }
        return;
      }
    }
    const hasChannel = this.count < this.concurrency;
    if (hasChannel) this.#next(task.item);
  }

  #prepareProcessTimeout(execute) {
    return setTimeout(() => {
      const err = new Error('Process timed out!');
      if (this.onTimeout) this.onTimeout(err);
      execute(err);
    }, this.processTimeout);
  }

  #runItem(item, execute) {
    try {
      const result = item();
      if (result && typeof result.then === 'function') {
        result.then((res) => void execute(null, res), execute);
      } else {
        execute(null, result);
      }
    } catch (err) {
      execute(err);
    }
  }

  #cloneQueue({ factor, item }) {
    const queue = Queue.channels(this.concurrency)
      .process(this.onProcess)
      .setFactor(factor)
      .add(item);

    if (this.priorityMode) queue.priority();
    if (!this.fifoMode) queue.lifo();
    if (this.waitTimeout !== Infinity) queue.wait(this.waitTimeout);
    if (this.processTimeout !== Infinity) {
      queue.timeout(this.processTimeout, this.onTimeout);
    }
    if (this.debounceMode) {
      queue.debounce(this.debounceCount, this.debounceInterval);
    }
    queue.finish = this.finish.bind(this);
    return queue;
  }

  finish(err, res) {
    const { onFailure, onSuccess, onDone, onDrain } = this;
    const details = { factor: this.factor };
    if (err) {
      if (onFailure) onFailure(err, res, details);
    } else if (onSuccess) onSuccess(res, details);
    if (onDone) onDone(err, res, details);
    if (this.destination) this.destination.add(res);
    if (onDrain) {
      if (!this.roundRobinMode) {
        if (this.count === 0 && this.waiting.length === 0) onDrain();
      } else {
        const queuesIsDrain = this.waiting.every(
          (queue) => queue.waiting.length === 0 && queue.count === 0,
        );
        if (queuesIsDrain) onDrain();
      }
    }
  }

  add(item, { factor = 0, priority = 0 } = {}) {
    if (this.size > this.waiting.length) {
      if (this.priorityMode && !this.roundRobinMode) {
        priority = factor;
        factor = 0;
      }
      if (this.roundRobinMode) {
        let queue = this.waiting.find((q) => q.factor === factor);
        if (queue) {
          queue.add(item);
        } else {
          queue = this.#cloneQueue({ factor, item });
          this.waiting.push(queue);
        }
      } else if (!this.paused && this.concurrency > this.count) {
        this.#next(item);
      } else {
        const task = { item, priority, start: Date.now() };
        if (this.fifoMode) this.waiting.push(task);
        else this.waiting.unshift(task);
        if (this.priorityMode) {
          const compare = this.fifoMode ? (a, b) => b - a : (a, b) => a - b;
          this.waiting.sort(({ priority: a }, { priority: b }) =>
            compare(a, b),
          );
        }
      }
    }
  }

  pipe(dest) {
    if (!Object.getPrototypeOf(dest) === Queue.prototype) {
      const msg = 'Pipe method only work with "Queue" instances';
      throw new Error(msg);
    }
    this.destination = dest;
    return { pipe: dest.pipe.bind(dest) };
  }

  timeout(msec = 1, onTimeout = null) {
    if (msec < 1) {
      const msg = 'Timeout interval must be greater than 0 milliseconds';
      throw new Error(msg);
    }
    this.processTimeout = msec;
    this.onTimeout = onTimeout;
    return this;
  }

  wait(msec = 0) {
    if (this.debounceMode && msec > this.debounceInterval) {
      const msg = 'Cannot use wait longer than debounce interval';
      throw new Error(msg);
    }
    this.waitTimeout = msec;
    return this;
  }

  debounce(count = 0, interval = 1000) {
    if (this.waitTimeout > 0 && interval > this.waitTimeout) {
      const msg = 'Cannot use debounce interval greater than wait timeout';
      throw new Error(msg);
    }
    this.debounceMode = true;
    this.debounceCount = count;
    this.debounceInterval = interval;
    return this;
  }

  resume() {
    this.paused = false;
    const emptyChannels = this.concurrency - this.count;
    let launchCount = Math.min(emptyChannels, this.waiting.length);
    while (launchCount-- > 0) {
      this.#takeNext();
    }
    return this;
  }

  pause() {
    this.paused = true;
    return this;
  }

  clear() {
    this.count = 0;
    this.waiting = [];
    this.destination = null;
    return this;
  }

  process(listener) {
    this.onProcess = listener;
    return this;
  }

  done(listener) {
    this.onDone = listener;
    return this;
  }

  success(listener) {
    this.onSuccess = listener;
    return this;
  }

  failure(listener) {
    this.onFailure = listener;
    return this;
  }

  drain(listener) {
    this.onDrain = listener;
    return this;
  }

  fifo() {
    this.fifoMode = true;
    return this;
  }

  lifo() {
    this.fifoMode = false;
    return this;
  }

  priority(flag = true) {
    this.priorityMode = flag;
    return this;
  }

  setFactor(factor) {
    this.factor = factor;
    return this;
  }

  roundRobin(flag = true) {
    this.roundRobinMode = flag;
    return this;
  }
}

module.exports = Queue;
