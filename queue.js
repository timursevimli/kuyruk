'use strict';

const { debounce } = require('./utils.js');

class Queue {
  constructor(concurrency, size = Infinity) {
    this.concurrency = concurrency;
    this.size = size;
    this.count = 0;
    this.waiting = [];
    this.destination = null;
    this.paused = false;
    this.factor = undefined;
    this.waitTimeout = Infinity;
    this.processTimeout = Infinity;
    this.debounceInterval = 1000;
    this.debounceCount = 0;
    this.fifoMode = true;
    this.asyncProcess = false;
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

  static channels(concurrency, size) {
    return new Queue(concurrency, size);
  }

  #next(item) {
    let timer = null;
    let finished = false;
    this.count++;
    let execute = (err = null, res) => {
      if (finished) return;
      finished = true;
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      this.count--;
      setTimeout(() => {
        if (this.waiting.length > 0) this.#takeNext();
      }, 0);
      this.finish(err, { res, from: this.factor });
    };
    if (this.debounceMode && this.debounceCount-- > 0) {
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
      return void item().then((res) => void execute(null, res), execute);
    }
    if (!this.onProcess) {
      throw new Error('Process is not defined');
    }
    if (!this.asyncProcess) {
      this.onProcess(item, execute);
    } else {
      this.onProcess(item).then((res) => void execute(null, res), execute);
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

  finish(err, res) {
    const { onFailure, onSuccess, onDone, onDrain } = this;
    if (err) {
      if (onFailure) onFailure(err, res);
    } else if (onSuccess) onSuccess(res);
    if (onDone) onDone(err, res);
    if (this.destination) this.destination.add(res);
    if (!onDrain) return;
    if (!this.roundRobinMode) {
      if (this.count === 0 && this.waiting.length === 0) onDrain();
    } else {
      const queuesIsDrain = this.waiting.every(
        (queue) => queue.waiting.length === 0 && queue.count === 0,
      );
      if (queuesIsDrain) onDrain();
    }
  }

  add(item, { factor = 0, priority = 0 } = {}) {
    if (this.size <= this.waiting.length) return;
    if (this.priorityMode && !this.roundRobinMode) {
      priority = factor;
      factor = 0;
    }

    if (this.roundRobinMode) {
      let queue = this.waiting.find((q) => q.factor === factor);
      if (queue) return void queue.add(item);
      queue = Queue.channels(this.concurrency)
        .pause()
        .process(this.onProcess)
        .setFactor(factor)
        .add(item);

      if (this.asyncProcess) queue.async();
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
      this.waiting.push(queue);
      return void queue.resume();
    }

    if (!this.paused && this.concurrency > this.count) {
      return void this.#next(item);
    }

    const task = { item, priority, start: Date.now() };

    if (this.fifoMode) this.waiting.push(task);
    else this.waiting.unshift(task);

    if (this.priorityMode) {
      const compare = this.fifoMode ? (a, b) => b - a : (a, b) => a - b;
      this.waiting.sort(({ priority: a }, { priority: b }) => compare(a, b));
    }
  }

  pipe(dest) {
    if (!(dest instanceof Queue)) {
      const msg = 'Pipe method only work with "Queue" instances';
      throw new Error(msg);
    }
    this.destination = dest;
    return { pipe: dest.pipe };
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
    this.destinations = [];
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

  async() {
    this.asyncProcess = true;
    return this;
  }
}

module.exports = Queue;
