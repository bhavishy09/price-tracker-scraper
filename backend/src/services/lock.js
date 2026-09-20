/**
 * lock.js
 * Wrapper around store.js lock methods to maintain compatibility.
 */

const db = require('../db/store');

module.exports = {
  tryAcquire: () => db.tryAcquireLock(),
  release: () => db.releaseLock(),
  getStatus: () => db.getLockStatus(),
};
