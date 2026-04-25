function createArtifactTracker({ db, emitEvent }) {
  function publish(artifact) {
    if (!artifact || typeof emitEvent !== 'function') return;
    emitEvent({
      notebookId: Number(artifact.notebookId) || null,
      scope: 'artifact',
      type: 'artifact.changed',
      stage: artifact.stage || '',
      artifactId: artifact.id || null,
      payload: {
        artifactType: artifact.type || '',
        status: artifact.status || '',
        confirmed: Boolean(artifact.confirmed),
        reviewFlags: artifact.reviewFlags || [],
        blockingIssues: artifact.blockingIssues || []
      }
    });
    if (artifact.confirmed) {
      emitEvent({
        notebookId: Number(artifact.notebookId) || null,
        scope: 'artifact',
        type: 'artifact.confirmed',
        stage: artifact.stage || '',
        artifactId: artifact.id || null,
        payload: {
          artifactType: artifact.type || '',
          status: artifact.status || ''
        }
      });
    }
  }

  function create(notebookId, patch = {}) {
    const artifact = db.createArtifact({
      notebookId,
      ...patch
    });
    publish(artifact);
    return artifact;
  }

  function update(artifactId, patch = {}) {
    const artifact = db.updateArtifact(artifactId, patch);
    publish(artifact);
    return artifact;
  }

  return {
    create,
    update
  };
}

module.exports = {
  createArtifactTracker
};
