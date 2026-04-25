function summarizeError(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  return String(error.message || error.stack || error);
}

function createTaskRuntime({ db, emitEvent }) {
  function publish(type, operation, payload = {}) {
    if (typeof emitEvent !== 'function') return;
    emitEvent({
      notebookId: Number(operation?.notebookId) || null,
      scope: 'operation',
      type,
      stage: operation?.stage || '',
      payload: {
        operationId: operation?.id || null,
        action: operation?.action || '',
        status: operation?.status || '',
        ...payload
      }
    });
  }

  function listStageOperations(filters = {}) {
    return db.listOperations(filters || {});
  }

  async function runStageAction(config = {}, action) {
    const operation = db.createOperation({
      notebookId: Number(config.notebookId),
      stage: config.stage || 'framework',
      action: config.action || 'unknown',
      status: 'running',
      summary: config.summary || null,
      input: config.input ?? null,
      metadata: config.metadata || {},
      startedAt: new Date().toISOString()
    });
    publish('operation.started', operation, {
      summary: operation.summary || null
    });

    try {
      const value = await action(operation);
      const finalOperation = db.updateOperation(operation.id, {
        status: 'completed',
        finishedAt: new Date().toISOString(),
        output: Object.prototype.hasOwnProperty.call(value || {}, 'output') ? value.output : null,
        warnings: Array.isArray(value?.warnings) ? value.warnings : [],
        outputArtifactIds: Array.isArray(value?.outputArtifactIds) ? value.outputArtifactIds : [],
        metadata: value?.metadata || {}
      });
      publish('operation.completed', finalOperation, {
        warnings: finalOperation.warnings || [],
        outputArtifactIds: finalOperation.outputArtifactIds || []
      });
      return { value, operation: finalOperation };
    } catch (error) {
      const failedOperation = db.updateOperation(operation.id, {
        status: 'failed',
        finishedAt: new Date().toISOString(),
        error: summarizeError(error)
      });
      publish('operation.failed', failedOperation, {
        error: failedOperation.error || summarizeError(error)
      });
      throw error;
    }
  }

  return {
    listStageOperations,
    runStageAction
  };
}

module.exports = {
  createTaskRuntime
};
