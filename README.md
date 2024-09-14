# kuyruk

[![ci Status](https://github.com/timursevimli/kuyruk/workflows/Testing%20CI/badge.svg)](https://github.com/timursevimli/kuyruk/actions?query=workflow%3A%22Testing+CI%22+branch%3Amaster)
[![snyk](https://snyk.io/test/github/timursevimli/kuyruk/badge.svg)](https://snyk.io/test/github/timursevimli/kuyruk)
[![npm downloads/month](https://img.shields.io/npm/dm/kuyruk.svg)](https://www.npmjs.com/package/kuyruk)
[![npm downloads](https://img.shields.io/npm/dt/kuyruk.svg)](https://www.npmjs.com/package/kuyruk)
[![license](https://img.shields.io/badge/license-MIT-blue.svg)](https://github.com/timursevimli/kuyruk/blob/master/LICENSE)

## Description

**kuyruk** is a powerful asynchronous queue implementation for managing concurrency and controlling the flow of asynchronous tasks. It supports various modes, such as callbacks, promises, FIFO, LIFO, priority, factor and round-robin, providing flexibility for different use cases.

- <a href="#install">Installation</a>
- <a href="#usage">Usage</a>
- <a href="#api">API</a>
- <a href="#license">Licence &amp; copyright</a>

## Install

`npm i kuyruk`

## Usage (promise API)

```js
const { Kuyruk } = require('kuyruk');

const queue = new Kuyruk({ concurrency: 3 });

queue
  .success((result) => {
    console.log(result);
  })
  .drain(() => {
    console.log('all done!');
  });

const someAsyncFn = (num) =>
  new Promise((resolve) => {
    setTimeout(() => {
      resolve(num);
    }, 0);
  });

for (let i = 0; i < 10; i++) {
  queue.add(() => someAsyncFn(i));
}
```

## Usage (callback process API)

```js
const { Kuyruk } = require('kuyruk');

const queue = new Kuyruk({ concurrency: 3 });

const someTaskOnCallback = (num, cb) => {
  setTimeout(() => {
    cb(null, num);
  }, 0);
};

queue
  .process(someTaskOnCallback)
  .success((result) => {
    console.log(result);
  })
  .drain(() => {
    console.log('all done!');
  });

for (let i = 0; i < 10; i++) {
  queue.add(i);
}
```

## Usage (asynchronous process API)

```js
const { Kuyruk } = require('kuyruk');

const queue = new Kuyruk({ concurrency: 3 });

const someAsyncTask = (num) => {
  return new Promise((resolve) => {
    setTimeout(() => {
      resolve(num);
    }, 0);
  });
};

queue
  .process(someAsyncTask)
  .success((result) => {
    console.log(result);
  })
  .drain(() => {
    console.log('all done!');
  });

for (let i = 0; i < 10; i++) {
  queue.add(i);
}
```

## Features

- **Concurrency Control**: Define the number of tasks (concurrency) that can be processed simultaneously.
- **Queue Size Limit**: Specify the maximum number of items the queue can hold (size), providing flexibility in managing task overflow.
- **Task Debouncing**: Enable debouncing with a customizable interval and count limit (`debounceMode`). Tasks can be delayed and bundled to reduce the load on the system.
- **FIFO and LIFO Modes**: Supports both FIFO (First-In-First-Out) and LIFO (Last-In-First-Out) task processing, giving you the ability to choose how tasks are prioritized in the queue.
- **Priority-Based Task Scheduling**: Tasks can be prioritized within the queue (`priorityMode`), ensuring that critical tasks are processed first.
- **Round-Robin Scheduling**: Distribute tasks across different queues using round-robin mode (`roundRobinMode`), ensuring equal task distribution.
- **Task Timeout**: Set time limits on both task processing (`processTimeout`) and waiting for tasks to be processed (`waitTimeout`), allowing tasks to fail gracefully if they take too long.
- **Task Pipelining**: The queue supports piping to another queue, allowing tasks to flow from one queue to another for further processing.
- **Pause and Resume**: Control the execution of tasks by pausing the queue and resuming it at any time.
- **Task Processing Lifecycle**: Customize the task lifecycle using event handlers:
  - `onProcess`: Define the logic for processing each task.
  - `onSuccess`: Callback for when a task completes successfully.
  - `onFailure`: Callback for when a task fails.
  - `onDone`: Executed after each task finishes, regardless of success or failure.
  - `onDrain`: Called when the queue has no more tasks to process.
  - `onTimeout`: Handle task timeout events.
- **Dynamic Channel Creation**: Use the `channels` static method to create multiple queues dynamically with predefined concurrency and size settings.
- **Automatic Task Retry with Debouncing**: Retry tasks automatically if debouncing is enabled, minimizing redundant operations during high-load periods.
- **Customizable Task Factor**: Assign tasks to specific channels using the `factor` parameter, which can be helpful for task categorization or grouping.

## API

- <a href="#queue"><code>Kuyruk()</code></a>
- <a href="#add"><code>queue#<b>add()</b></code></a>
- <a href="#pause"><code>queue#<b>pause()</b></code></a>
- <a href="#resume"><code>queue#<b>resume()</b></code></a>
- <a href="#clear"><code>queue#<b>clear()</b></code></a>
- <a href="#pipe"><code>queue#<b>pipe()</b></code></a>
- <a href="#timeout"><code>queue#<b>timeout()</b></code></a>
- <a href="#wait"><code>queue#<b>wait()</b></code></a>
- <a href="#debounce"><code>queue#<b>debounce()</b></code></a>
- <a href="#process"><code>queue#<b>process()</b></code></a>
- <a href="#done"><code>queue#<b>done()</b></code></a>
- <a href="#success"><code>queue#<b>success()</b></code></a>
- <a href="#failure"><code>queue#<b>failure()</b></code></a>
- <a href="#drain"><code>queue#<b>drain()</b></code></a>
- <a href="#fifo"><code>queue#<b>fifo()</b></code></a>
- <a href="#lifo"><code>queue#<b>lifo()</b></code></a>
- <a href="#priority"><code>queue#<b>priority()</b></code></a>
- <a href="#roundRobin"><code>queue#<b>roundRobin()</b></code></a>

---

<a name="queue"></a>

### Kuyruk({ concurrency: 1 , size: 100 })

Creates a new kuyruk instance.

Arguments:

- `concurrency` (optional): Number of tasks that can be processed simultaneously.
- `size` (optional): Maximum number of tasks the queue can hold.

---

<a name="add"></a>

### queue.add(task, { factor = 0, priority = 0 })

Adds a task to the queue. If the queue is full or paused, the task will wait in the queue.

Arguments:

- `task`: The task to be processed, can be a function or any data type.
- `factor` (optional): Used for round-robin processing.
- `priority` (optional): Task priority, used when the queue is in priority mode.

---

<a name="pause"></a>

### queue.pause()

Pauses task processing. Tasks currently being processed will not be stopped, but new tasks won't be taken until resumed.

---

<a name="resume"></a>

### queue.resume()

Resumes task processing after being paused. Tasks in the queue will be processed again.

---

<a name="clear"></a>

### queue.clear()

Clears the queue of all waiting tasks and resets internal counters.

---

<a name="pipe"></a>

### queue.pipe<Kuyruk>(destinationQueue)

Pipes the result of the current queue to another queue. This will pass completed tasks from the current queue to the destination queue.

Arguments:

- `destinationQueue`: An instance of Kuyruk that will receive the results of completed tasks from the current queue. The tasks are passed to the destination queue for further processing or handling.

---

<a name="timeout"></a>

### queue.timeout(msec, onTimeout)

Sets a timeout for each task in the queue. If a task takes longer than the specified time, it will be interrupted.

Arguments:

- `msec`: The time in milliseconds before a task times out.
- `onTimeout` (optional): A function to call when a task times out.

---

<a name="wait"></a>

### queue.wait(msec)

Sets a maximum wait time for tasks in the queue. If a task waits longer than this time without being processed, it will time out.

Arguments:

- `msec`: The maximum time in milliseconds a task can wait in the queue.

---

<a name="debounce"></a>

### queue.debounce(count, interval)

Debounces task execution, ensuring that a certain number of tasks (count) are processed within a specific time interval.

Arguments:

- `count`: Number of tasks to process before applying the debounce delay.
- `interval`: The time interval in milliseconds for the debounce effect.

---

<a name="process"></a>

### queue.process(listener)

Defines the function that will process each task. The listener receives the task and a callback to signal completion.

Arguments:

- `listener`: The function responsible for processing each task.

---

<a name="done"></a>

### queue.done(listener)

Sets a callback to be called when a task is finished (whether successful or failed).

Arguments:

- `listener`: The function to call when a task finishes, with arguments err and result.

---

<a name="success"></a>

### queue.success(listener)

Defines a callback that is called when a task is successfully processed.

Arguments:

- `listener`: The function to call on success, with the task result.

---

<a name="failure"></a>

### queue.failure(listener)

Defines a callback to handle failed tasks.

Arguments:

- `listener`: The function to call on failure, with the task error.

---

<a name="drain"></a>

### queue.drain(listener)

Sets a function to be called when the queue has processed all tasks.

Arguments:

- `listener`: The function to call when the queue is drained.

---

<a name="fifo"></a>

### queue.fifo()

Sets the queue to FIFO (first-in-first-out) mode.

---

<a name="lifo"></a>

### queue.lifo()

Sets the queue to LIFO (last-in-first-out) mode.

---

<a name="priority"></a>

### queue.priority(flag: boolean)

Enables or disables priority mode. When enabled, tasks with higher priority values will be processed first.

Arguments:

- `flag`: Boolean flag to enable or disable priority mode.

---

<a name="roundRobin"></a>

### queue.roundRobin(flag: boolean)

Enables or disables round-robin mode. Tasks will be processed in a round-robin fashion based on their assigned factor.

Arguments:

- `flag`: Boolean flag to enable or disable round-robin mode.

## License

MIT
