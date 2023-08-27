# Conqueue

<div align="center">

[![ci Status](https://github.com/timursevimli/conqueue/workflows/Testing%20CI/badge.svg)](https://github.com/timursevimli/conqueue/actions?query=workflow%3A%22Testing+CI%22+branch%3Amaster)
[![snyk](https://snyk.io/test/github/timursevimli/conqueue/badge.svg)](https://snyk.io/test/github/timursevimli/conqueue)
[![npm downloads/month](https://img.shields.io/npm/dm/conqueue.svg)](https://www.npmjs.com/package/conqueue)
[![npm downloads](https://img.shields.io/npm/dt/conqueue.svg)](https://www.npmjs.com/package/conqueue)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/timursevimli/conqueue/blob/master/LICENSE)

</div>

## Description

**Conqueue** is a simple yet powerful asynchronous queue implementation for managing concurrency and controlling the flow of asynchronous tasks. It supports various modes, such as callbacks, promises, FIFO, LIFO, priority, factor and round-robin, providing flexibility for different use cases.

## Features

- Concurrency Control: Limit the number of concurrent tasks to prevent resource overload.
- Task Priority: Assign priorities to tasks for customized task execution order.
- Task Timeout: Set a timeout for individual tasks to handle situations where a task takes too long to complete.
- Debouncing: Control task execution frequency with debouncing, useful for scenarios with rapid task submissions.
- Promise Mode: Execute tasks that return promises, providing seamless integration with promise-based workflows.
- Event Handling: Attach event listeners to handle various events, such as task success, failure, done, timeout and queue drain.

## Installation

```bash
npm install conqueue
```

## Usage

```javascript
const Queue = require('conqueue');

const job = (taskId, cb) => {
  setTimeout(() => {
    if (taskId === 4) {
      cb(new Error('Biggest error!!!'));
      return;
    }
    cb(null, taskId);
  }, 0);
};

// Create a queue with a concurrency limit of 3
const queue = new Queue(3)
  .process(job)
  .done((err, res) => {
    if (err) console.error(err);
    else console.log(res);
  })
  .success(({ res }) => {
    console.log(`Response: ${res}`);
  })
  .failure((err) => {
    console.error(`Task failed: ${err}`);
  })
  .drain(() => {
    console.log('Queue drain!');
  });

// Add tasks to the queue
for (let i = 0; i < 10; i++) {
  queue.add(i);
}
```

## API Reference

### `Queue(concurrency, size = Infinity)`

- **Constructor:**
  - concurrency: Maximum number of tasks to be executed concurrently.
  - size: Maximum size of the queue (default is Infinity).
- **Methods:**
  - add(item: any, options?: AddOptions): Add a task to the queue with optional factor and priority.
  - pipe(destination: Queue): Pipe the queue output to another queue.
  - timeout(msec: number, onTimeout: function): Set the maximum execution time for each task.
  - wait(msec: number): Set a waiting time before processing tasks.
  - debounce(count: number, interval: number): Control the execution frequency using debouncing.
  - resume(): Resume the execution of the paused queue.
  - pause(): Pause the queue to stop processing new tasks.
  - clear(): Clear the queue and reset counters.
  - process(listener: function): Set a listener function to process each task.
  - done(listener: function): Set a listener function called after each task is processed.
  - success(listener: function): Set a listener function for successful task execution.
  - failure(listener: function): Set a listener function for failed task execution.
  - drain(listener: function): Set a listener function called when the queue is drained.
  - fifo(): Set the queue mode to First-In-First-Out (default).
  - lifo(): Set the queue mode to Last-In-First-Out.
  - priority(flag: boolean): Enable or disable priority mode.
  - setFactor(factor: boolean): Set a factor for tasks in round-robin mode.
  - roundRobin(flag: boolean): Enable or disable round-robin mode.
  - promise(): Enable promise mode to execute tasks returning promises.
  - callback(): Switch back to callback mode.

## License

This project is licensed under the MIT License - see the [LICENSE.md](./LICENSE) file for details.
