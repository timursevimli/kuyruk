'use strict';

// prettier-ignore
const debounce =
  (fn, interval) =>
    (...args) => {
      setTimeout(fn, interval, ...args);
    };

module.exports = {
  debounce,
};
