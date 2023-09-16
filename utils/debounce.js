'use strict';

const debounce = (fn, interval) => (...args) => {
  setTimeout(() => void fn(...args), interval);
};

module.exports = { debounce };
