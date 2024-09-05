'use strict';

// prettier-ignore
const debounce =
  (fn, interval) =>
    (...args) => {
      setTimeout(fn, interval, null, ...args);
    };

module.exports = {
  debounce,
};
