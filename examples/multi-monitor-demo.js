'use strict';

const { Kuyruk } = require('../kuyruk.js');
const { monitor } = require('../monitor.js');

// One monitor server, one port, three queues.
const m = monitor({ port: 8228, name: 'shop' });

const emails = new Kuyruk({ concurrency: 2 })
  .process((task, callback) => {
    const duration = 500 + Math.random() * 1500;
    setTimeout(() => {
      if (Math.random() < 0.03) {
        callback(new Error(`SMTP refused message #${task.id}`));
      } else {
        callback(null, task);
      }
    }, duration);
  })
  .success(() => {})
  .failure(() => {});

const webhooks = new Kuyruk({ concurrency: 10, size: 100 })
  .process((task, callback) => {
    const duration = 50 + Math.random() * 200;
    setTimeout(() => {
      if (Math.random() < 0.08) {
        callback(new Error(`Endpoint ${task.url} returned 500`));
      } else {
        callback(null, task);
      }
    }, duration);
  })
  .success(() => {})
  .failure(() => {});

const images = new Kuyruk({ concurrency: 4 })
  .process((task, callback) => {
    const duration = 500 + Math.random() * 2500;
    setTimeout(() => {
      callback(null, task);
    }, duration);
  })
  .timeout(2000)
  .success(() => {})
  .failure(() => {});

m.watch(emails, 'emails').watch(webhooks, 'webhooks').watch(images, 'images');

let id = 0;

setInterval(() => {
  emails.add({ id: id++ });
}, 1200);

setInterval(() => {
  // Webhooks arrive in bursts
  const burst = 1 + Math.floor(Math.random() * 8);
  for (let i = 0; i < burst; i++) {
    webhooks.add({ id: id++, url: `/hook/${id % 5}` });
  }
}, 600);

setInterval(() => {
  const batch = 1 + Math.floor(Math.random() * 3);
  for (let i = 0; i < batch; i++) {
    images.add({ id: id++ });
  }
}, 900);

console.log('Three queues running… open the monitor URL above.');
