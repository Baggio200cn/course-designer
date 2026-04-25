const { generateSceneOutlinesFromRequirements } = require('./outline-generator');
const { generateFullScenes } = require('./scene-generator');

async function runGenerationPipeline(params = {}) {
  const {
    requirementsText = '',
    courseInfo = {},
    styleCard = null,
    aiClient = null,
    logger = console,
    callbacks = {}
  } = params;

  const metrics = {
    startedAt: new Date().toISOString(),
    outlinesGenerated: 0,
    scenesGenerated: 0,
    totalDurationMin: 0,
    warnings: []
  };

  callbacks.onStageStart?.(1, 'generate-outlines');
  const outlinesResult = await generateSceneOutlinesFromRequirements({
    requirementsText,
    courseInfo,
    styleCard,
    aiClient,
    logger
  });
  callbacks.onStageComplete?.(1, outlinesResult);

  if (!outlinesResult.success) {
    return {
      success: false,
      stage: 'generate-outlines',
      errors: outlinesResult.errors || ['Failed to generate scene outlines'],
      warnings: outlinesResult.warnings || []
    };
  }

  metrics.outlinesGenerated = outlinesResult.data.length;
  metrics.totalDurationMin = outlinesResult.data.reduce(
    (sum, item) => sum + (Number(item.durationMin) || 0),
    0
  );
  metrics.warnings.push(...(outlinesResult.warnings || []));

  callbacks.onStageStart?.(2, 'generate-scenes');
  const scenesResult = await generateFullScenes(outlinesResult.data, {
    aiClient,
    logger,
    callbacks: {
      onProgress: callbacks.onSceneProgress
    }
  });
  callbacks.onStageComplete?.(2, scenesResult);

  if (!scenesResult.success) {
    return {
      success: false,
      stage: 'generate-scenes',
      errors: scenesResult.errors || ['Failed to generate scenes'],
      warnings: [
        ...(outlinesResult.warnings || []),
        ...(scenesResult.warnings || [])
      ]
    };
  }

  metrics.scenesGenerated = scenesResult.data.length;
  metrics.warnings.push(...(scenesResult.warnings || []));
  metrics.finishedAt = new Date().toISOString();

  return {
    success: true,
    data: {
      sceneOutlines: outlinesResult.data,
      scenes: scenesResult.data,
      metrics
    },
    warnings: metrics.warnings
  };
}

module.exports = {
  runGenerationPipeline
};

