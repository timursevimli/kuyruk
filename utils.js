'use strict';

const debounce = (fn, interval) => {
  const debounced = (...args) => {
    setTimeout(fn, interval, null, ...args);
  };
  return debounced;
};

module.exports = { debounce };
