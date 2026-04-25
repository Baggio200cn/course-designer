function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function summarizeError(error) {
  if (!error) return 'Unknown error';
  if (typeof error === 'string') return error;
  return String(error.message || error.stack || error);
}

function createExportRuntime({ emitEvent }) {
  function publish(type, config = {}, payload = {}, artifactId = null) {
    if (typeof emitEvent !== 'function') return;
    emitEvent({
      notebookId: Number(config.notebookId) || null,
      scope: 'export',
      type,
      stage: String(config.stage || ''),
      artifactId: artifactId || null,
      payload: {
        format: String(config.format || ''),
        variant: String(config.variant || ''),
        ...payload
      }
    });
  }

  async function run(config = {}, action) {
    const blockingIssues = asArray(config.blockingIssues)
      .map((item) => String(item || '').trim())
      .filter(Boolean);

    publish('export.requested', config);

    if (blockingIssues.length) {
      publish('export.blocked', config, { blockingIssues });
      return {
        success: false,
        error: blockingIssues.join('；')
      };
    }

    try {
      const result = await action();
      if (result?.cancelled) {
        return {
          success: true,
          data: null
        };
      }

      if (result?.success === false) {
        const errorMessage = summarizeError(result.error || 'Export failed');
        publish('export.failed', config, { error: errorMessage });
        return {
          success: false,
          error: errorMessage
        };
      }

      publish(
        'export.completed',
        config,
        result?.eventPayload || {},
        result?.eventArtifactId || null
      );

      return {
        success: true,
        data: Object.prototype.hasOwnProperty.call(result || {}, 'data') ? result.data : null
      };
    } catch (error) {
      const errorMessage = summarizeError(error);
      publish('export.failed', config, { error: errorMessage });
      return {
        success: false,
        error: errorMessage
      };
    }
  }

  return {
    run
  };
}

module.exports = {
  createExportRuntime
};
