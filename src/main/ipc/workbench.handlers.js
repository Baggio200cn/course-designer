/**
 * workbench.handlers.js — 「我的工作台」统计接口（Phase-7.7 A3）
 *
 * 职责：聚合老师的课程开发统计数据，供 UI 工作台页面展示。
 * 不引入新表，复用现有 notebooks / agent_memories / artifacts 数据。
 *
 * 设计原则（按 CLAUDE.md 第〇节）：
 *  - 完全本地查询，不上传任何数据
 *  - 不修改任何 artifact / notebook 数据，纯读取
 *  - 失败不影响主流程
 */
'use strict';

function register(ipcMain, getDeps) {
  /**
   * workbench:getStats — 获取工作台统计概览
   *
   * 返回：{
   *   success: true,
   *   data: {
   *     totalNotebooks: number,
   *     confirmedFrameworks: number,
   *     confirmedLectures: number,
   *     confirmedPpts: number,
   *     totalMemories: number,
   *     recentActivities: Array<{ notebookId, name, totalHours, lastActivity, stages: { framework, lecture, ppt } }>,
   *   }
   * }
   */
  ipcMain.handle('workbench:getStats', async () => {
    try {
      const { db } = getDeps();
      if (!db) return { success: false, error: 'Database not initialized' };

      const notebooks = (typeof db.listNotebooks === 'function' ? db.listNotebooks() : []) || [];
      const memories = (typeof db.getAgentMemories === 'function' ? db.getAgentMemories() : []) || [];

      // 按 notebook 统计 stage 完成情况（基于 artifact 的 confirmed 字段）
      const recentActivities = notebooks.slice(0, 30).map((nb) => {
        const fw = typeof db.getLatestArtifact === 'function'
          ? db.getLatestArtifact(nb.id, 'framework_json', 'framework') : null;
        const lc = typeof db.getLatestArtifact === 'function'
          ? db.getLatestArtifact(nb.id, 'lecture_final', 'lecture') : null;
        const ppt = typeof db.getLatestArtifact === 'function'
          ? db.getLatestArtifact(nb.id, 'ppt_outline', 'ppt') : null;

        return {
          notebookId: nb.id,
          name: nb.name || '未命名课程',
          totalHours: nb.totalHours || 0,
          updatedAt: nb.updatedAt || nb.createdAt || '',
          stages: {
            framework: Boolean(fw?.confirmed),
            lecture: Boolean(lc?.confirmed),
            ppt: Boolean(ppt?.confirmed),
          },
          memorySaved: memories.some((m) => m.notebookId === nb.id),
        };
      }).sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));

      const confirmedFrameworks = recentActivities.filter((a) => a.stages.framework).length;
      const confirmedLectures = recentActivities.filter((a) => a.stages.lecture).length;
      const confirmedPpts = recentActivities.filter((a) => a.stages.ppt).length;

      // 计算"完成度"：每个笔记本完成的 stage 数 / 3（framework / lecture / ppt 全部完成 = 100%）
      const totalStages = notebooks.length * 3;
      const completedStages = confirmedFrameworks + confirmedLectures + confirmedPpts;
      const overallCompletionRate = totalStages > 0
        ? Math.round((completedStages / totalStages) * 100) : 0;

      // 平均迭代次数：用 lastVisited - createdAt 的天数粗略估算（更精确版本需要 operations 表）
      // 这里先简化：framework_json artifact 的 contentVersion（如果有）作为重生成次数
      const totalRegenerations = notebooks.reduce((acc, nb) => {
        const fw = typeof db.getLatestArtifact === 'function'
          ? db.getLatestArtifact(nb.id, 'framework_json', 'framework') : null;
        return acc + Math.max(1, Number(fw?.version) || 1);
      }, 0);
      const avgRegenerations = notebooks.length > 0
        ? (totalRegenerations / notebooks.length).toFixed(1) : '0.0';

      return {
        success: true,
        data: {
          totalNotebooks: notebooks.length,
          confirmedFrameworks,
          confirmedLectures,
          confirmedPpts,
          overallCompletionRate,
          totalMemories: memories.length,
          avgRegenerations,
          recentActivities,
          memories: memories.slice(-10).reverse(),  // 最近 10 条 memory 摘要
        },
      };
    } catch (e) {
      return { success: false, error: e.message };
    }
  });
}

module.exports = { register };
