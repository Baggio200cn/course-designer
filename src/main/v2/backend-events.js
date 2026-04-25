function createBackendEventBus({ db }) {
  function emit(event = {}) {
    if (!db || typeof db.createBackendEvent !== 'function') return null;
    return db.createBackendEvent(event);
  }

  function list(filters = {}) {
    if (!db || typeof db.listBackendEvents !== 'function') return [];
    return db.listBackendEvents(filters);
  }

  return {
    emit,
    list
  };
}

module.exports = {
  createBackendEventBus
};
