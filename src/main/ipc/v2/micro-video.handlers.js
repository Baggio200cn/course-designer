/**
 * v2 微课视频整套方案 handlers（Phase-9 阶段 C-3）
 *
 * 处理的 channel：
 *   v2:generateMicroVideo   生成完整方案（AI 调用）
 *   v2:saveMicroVideo       保存方案（老师手改后）
 *   v2:confirmMicroVideo    确认（解锁下游 report 阶段）
 *   v2:getMicroVideoData    读取当前 notebookId 的微课方案
 *
 * artifact_type='video_prompt'，stage='video'
 * 注意：与 v3.x 老 video.handlers.js 并存——前端 D 阶段切到新接口后，老 handler 自然废弃
 */

const microVideoSvc = require('../../services/micro-video.service');
const { resolveProviderConfig, createAiClientByConfig } = require('../../api/provider-config');

function register(ipcMain, getDeps) {
  // ── 生成 ───────────────────────────────────────────────────────────
  ipcMain.handle('v2:generateMicroVideo', async (event, payload = {}) => {
    const { db, ensureNotebookWorkspaceState } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');

      const notebookId = Number(payload.notebookId);
      if (!Number.isFinite(notebookId) || notebookId <= 0) {
        return { success: false, error: 'notebookId 无效' };
      }

      const notebook = ensureNotebookWorkspaceState
        ? ensureNotebookWorkspaceState(db.getNotebookById(notebookId))
        : db.getNotebookById(notebookId);
      if (!notebook) return { success: false, error: 'Notebook not found' };

      // 取上游 PPT artifact（已 confirmed）作为参考
      let pptOutline = null;
      const allArtifacts = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId }) : [];
      const confirmedPpt = allArtifacts
        .filter((a) => a.type === 'ppt_outline' && a.stage === 'ppt' && a.confirmed)
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt))[0];
      if (confirmedPpt?.content) pptOutline = confirmedPpt.content;

      const config = resolveProviderConfig({ payload, db });
      const aiClient = createAiClientByConfig(config);
      if (!aiClient) {
        return { success: false, error: '未配置有效的 AI 客户端' };
      }

      const courseContext = {
        softwareTools: notebook.softwareTools || '',
        jobTargets: notebook.jobTargets || '',
        audience: notebook.audience || notebook.className || '',
        industryScenarios: notebook.industryScenarios || '',
      };

      const result = await microVideoSvc.generate({
        aiClient,
        courseName: payload.courseName || notebook.name || '课程',
        videoTopic: payload.videoTopic || '',
        pptOutline,
        courseContext,
      });

      if (!result.success) return result;

      const artifact = db.createArtifact({
        notebookId,
        type: 'video_prompt',
        stage: 'video',
        title: `微课视频方案：${result.data.microVideo.videoTopic || '本节核心要点'}`,
        content: result.data.microVideo,
        confirmed: false,
        status: 'draft',
        metadata: {
          generatedBy: 'micro-video.service',
          phase: 'phase-9',
          shotCount: result.data.microVideo._stats?.shotCount,
          totalDuration: result.data.microVideo._stats?.totalDurationFromShots,
          durationInRange: result.data.microVideo._stats?.durationInRange,
        },
      });

      return {
        success: true,
        data: {
          notebookId,
          artifactId: artifact?.id,
          microVideo: result.data.microVideo,
        },
      };
    } catch (error) {
      console.error('[v2:generateMicroVideo] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 保存 ───────────────────────────────────────────────────────────
  ipcMain.handle('v2:saveMicroVideo', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const artifactId = payload.artifactId ? Number(payload.artifactId) : null;
      const microVideo = payload.microVideo;

      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      if (!microVideo || typeof microVideo !== 'object') return { success: false, error: 'microVideo 内容无效' };

      let artifact;
      if (artifactId && db.updateArtifact) {
        artifact = db.updateArtifact(artifactId, { content: microVideo, status: 'draft' });
      } else {
        artifact = db.createArtifact({
          notebookId,
          type: 'video_prompt',
          stage: 'video',
          title: `微课视频方案：${microVideo.videoTopic || '手动保存'}`,
          content: microVideo,
          confirmed: false,
          status: 'draft',
          metadata: { source: 'manual-save', phase: 'phase-9' },
        });
      }

      return { success: true, data: { notebookId, artifactId: artifact?.id, microVideo } };
    } catch (error) {
      console.error('[v2:saveMicroVideo] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 确认 ───────────────────────────────────────────────────────────
  ipcMain.handle('v2:confirmMicroVideo', async (event, payload = {}) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const notebookId = Number(payload.notebookId);
      const artifactId = Number(payload.artifactId);
      if (!Number.isFinite(notebookId) || notebookId <= 0) return { success: false, error: 'notebookId 无效' };
      if (!Number.isFinite(artifactId) || artifactId <= 0) return { success: false, error: 'artifactId 无效' };
      if (!db.updateArtifact) return { success: false, error: 'db.updateArtifact 不存在' };

      db.updateArtifact(artifactId, {
        confirmed: true,
        status: 'confirmed',
        confirmedAt: new Date().toISOString(),
      });

      // v4.3.3 Codex #5：上游 video 改 → 下游 report 标 dirty
      if (typeof db.markDownstreamDirty === 'function') {
        try { db.markDownstreamDirty(notebookId, 'video', 'video-confirmed'); } catch (_) {}
      }

      return { success: true, data: { notebookId, artifactId, confirmed: true } };
    } catch (error) {
      console.error('[v2:confirmMicroVideo] 异常：', error);
      return { success: false, error: error.message };
    }
  });

  // ── 读取 ───────────────────────────────────────────────────────────
  ipcMain.handle('v2:getMicroVideoData', async (event, notebookId) => {
    const { db } = getDeps();
    try {
      if (!db) throw new Error('Database not initialized');
      const id = Number(notebookId);
      if (!Number.isFinite(id) || id <= 0) return { success: false, error: 'notebookId 无效' };

      const allArtifacts = typeof db.listArtifacts === 'function' ? db.listArtifacts({ notebookId: id }) : [];
      const videoArtifacts = allArtifacts
        .filter((a) => a.type === 'video_prompt' && a.stage === 'video')
        .sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));

      const latest = videoArtifacts[0] || null;
      return {
        success: true,
        data: {
          notebookId: id,
          artifactId: latest?.id || null,
          microVideo: latest?.content || null,
          confirmed: latest?.confirmed || false,
          status: latest?.status || null,
          history: videoArtifacts.map((a) => ({
            id: a.id, confirmed: a.confirmed, status: a.status, createdAt: a.createdAt, updatedAt: a.updatedAt,
          })),
        },
      };
    } catch (error) {
      console.error('[v2:getMicroVideoData] 异常：', error);
      return { success: false, error: error.message };
    }
  });
}

module.exports = { register };
