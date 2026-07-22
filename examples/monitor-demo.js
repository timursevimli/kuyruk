'use strict';

const { Kuyruk } = require('../kuyruk.js');
const { monitor } = require('../monitor.js');

const queue = new Kuyruk({ concurrency: 5, size: 50 })
  .process((task, callback) => {
    const duration = 200 + Math.random() * 1500;
    setTimeout(() => {
      if (Math.random() < 0.12) {
        callback(new Error(`Task #${task.id} failed`));
      } else {
        callback(null, task);
      }
    }, duration);
  })
  .timeout(1500)
  .success(() => {})
  .failure(() => {})
  .drain(() => console.log('drained'));

monitor(queue, { port: 8228 });

let id = 0;

const addBatch = () => {
  const batch = 1 + Math.floor(Math.random() * 6);
  for (let i = 0; i < batch; i++) {
    queue.add({ id: id++ });
  }
};

setInterval(addBatch, 700);

// Pause/resume waves so the dashboard shows state changes
setInterval(() => {
  queue.pause();
  setTimeout(() => queue.resume(), 3000);
}, 20000);

console.log('Generating tasks… open the monitor URL above.');
