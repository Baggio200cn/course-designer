/**
 * conflict-policy.js — 显式冲突优先级矩阵（Phase-6 M2.3）
 *
 * 职责：当 Agent 决策、用户操作、平台规则之间出现冲突时，
 *      提供唯一可信的"谁胜"裁决，避免运行时靠"模型自己理解"。
 *
 * 设计原则（参照《Claude Code 与 Codex 控制面设计》笔记 §3.3 / §4.4）：
 *  1. 冲突类型显式化——不依赖语义推断，列出所有已知冲突场景的常量
 *  2. 决策可追溯——每次裁决返回 { resolution, reason, blocksAgent, requiresUserConfirm }
 *  3. 上下文敏感——同一冲突在不同上下文下可能有不同裁决（如 lockedByUser 决定 user_edit_vs_agent）
 *  4. 纯函数——无副作用、不查数据库、不读全局状态，所有上下文从参数传入
 *
 * 7 个内置冲突类型（覆盖审计报告中的全部场景）：
 *  PLATFORM_VS_USER       平台硬约束 vs 用户操作（H1-H8 不可绕过）
 *  PROJECT_VS_USER        课程级规则 vs 用户当前输入
 *  MEMORY_VS_CURRENT      历史课程参考 vs 当前任务参数
 *  USER_EDIT_VS_AGENT     用户编辑保护 vs Agent 重生成（M2.4 关键场景）
 *  QUALITY_VS_USER_ACCEPT 质量校验失败 vs 用户强制接受
 *  CONTRACTS_VS_SKIP      Stage 依赖链 vs 用户/Agent 跳过阶段
 *  RETRY_VS_STOP          自动重试机制 vs 用户中断请求
 *
 * 调用方典型场景：
 *  - orchestrator backtracking 前调 USER_EDIT_VS_AGENT 检查上游是否被锁
 *  - lecture confirm handler 在 quality.invalid 时调 QUALITY_VS_USER_ACCEPT
 *  - import handler 调 CONTRACTS_VS_SKIP 判断是否允许导入跳过 lecture 进入 ppt
 *
 * 单文件不超过 600 行（CLAUDE.md 第七节）
 */

// ─── 冲突类型枚举 ────────────────────────────────────────
const CONFLICT_TYPE = Object.freeze({
  PLATFORM_VS_USER: 'platform_safety_vs_user',
  PROJECT_VS_USER: 'project_rule_vs_user',
  MEMORY_VS_CURRENT: 'memory_vs_current_user',
  USER_EDIT_VS_AGENT: 'user_edit_vs_agent_regenerate',
  QUALITY_VS_USER_ACCEPT: 'quality_invalid_vs_user_accept',
  CONTRACTS_VS_SKIP: 'contracts_vs_user_skip',
  RETRY_VS_STOP: 'retry_vs_user_stop',
});

// ─── 解决决策枚举 ────────────────────────────────────────
const RESOLUTION = Object.freeze({
  // 平台/合约层
  PLATFORM_WINS: 'platform_safety_wins',
  CONTRACTS_WINS: 'contracts_wins',
  // 用户层
  USER_WINS: 'user_wins',
  CURRENT_USER_WINS: 'current_user_wins',
  USER_EDIT_PROTECTED: 'user_edit_protected',
  USER_FORCE_ACCEPT: 'user_can_force_accept',
  USER_STOP_WINS: 'user_stop_wins',
  // Agent 层
  AGENT_PROCEEDS: 'agent_proceeds',
  // 中性
  PROVIDE_IMPORT_PATH: 'provide_import_path',
});

// ─── 默认决策表（不依赖上下文时的兜底）──────────────────────
// 上下文敏感的冲突（USER_EDIT_VS_AGENT / QUALITY_VS_USER_ACCEPT 等）需要在 resolveConflict 内部判断
const STATIC_DEFAULTS = Object.freeze({
  [CONFLICT_TYPE.PLATFORM_VS_USER]: {
    resolution: RESOLUTION.PLATFORM_WINS,
    reason: '平台硬约束（H1-H8）不可被任何用户操作覆盖',
    blocksAgent: false,
    requiresUserConfirm: false,
  },
  [CONFLICT_TYPE.PROJECT_VS_USER]: {
    resolution: RESOLUTION.USER_WINS,
    reason: '当前用户的明确输入优先于历史项目级规则（仅在不违反平台安全的前提下）',
    blocksAgent: false,
    requiresUserConfirm: false,
  },
  [CONFLICT_TYPE.MEMORY_VS_CURRENT]: {
    resolution: RESOLUTION.CURRENT_USER_WINS,
    reason: '历史课程仅作风格参考，不能覆盖当前任务的目标和参数',
    blocksAgent: false,
    requiresUserConfirm: false,
  },
});

// ─── 公共 API ────────────────────────────────────────────
/**
 * 给定冲突类型与上下文，返回标准化的裁决结果。
 *
 * @param {string} conflictType - CONFLICT_TYPE 枚举之一
 * @param {Object} [context] - 上下文（不同冲突类型需要的字段不同）
 * @returns {Object} { resolution, reason, blocksAgent, requiresUserConfirm, conflictType }
 *
 * 各冲突类型期望的 context 字段：
 *   PLATFORM_VS_USER       (无)
 *   PROJECT_VS_USER        (无)
 *   MEMORY_VS_CURRENT      (无)
 *   USER_EDIT_VS_AGENT     { upstreamArtifact: { lockedByUser: bool, ... } } 或 { lockedByUser: bool }
 *   QUALITY_VS_USER_ACCEPT { quality: { valid: bool, errors: [...] }, userForceAccept: bool }
 *   CONTRACTS_VS_SKIP      { hasImportPath: bool, importedArtifact: any }
 *   RETRY_VS_STOP          { userStopRequested: bool, attemptCount: number, maxAttempts: number }
 */
function resolveConflict(conflictType, context = {}) {
  if (!Object.values(CONFLICT_TYPE).includes(conflictType)) {
    throw new Error(`conflict-policy: 未知冲突类型 ${JSON.stringify(conflictType)}`);
  }

  // 静态默认决策
  if (STATIC_DEFAULTS[conflictType]) {
    return { conflictType, ...STATIC_DEFAULTS[conflictType] };
  }

  // ── USER_EDIT_VS_AGENT ────────────────────────────────
  // M2.4 关键场景：Agent 想 backtracking 重生成上游 artifact 时，
  // 必须先检查该 artifact 是否被用户保护
  if (conflictType === CONFLICT_TYPE.USER_EDIT_VS_AGENT) {
    const isLocked = _extractLockedByUser(context);
    if (isLocked) {
      return {
        conflictType,
        resolution: RESOLUTION.USER_EDIT_PROTECTED,
        reason: '上游 artifact 已被用户锁定，Agent 不能自动覆盖；请用户主动点"重新生成"或"解锁"后再重试',
        blocksAgent: true,
        requiresUserConfirm: true,
      };
    }
    return {
      conflictType,
      resolution: RESOLUTION.AGENT_PROCEEDS,
      reason: '上游 artifact 未被用户锁定，Agent 可继续覆盖重生成',
      blocksAgent: false,
      requiresUserConfirm: false,
    };
  }

  // ── QUALITY_VS_USER_ACCEPT ────────────────────────────
  // 用户在质量校验失败时主动选择"我接受这个版本"——允许但需提示
  if (conflictType === CONFLICT_TYPE.QUALITY_VS_USER_ACCEPT) {
    const quality = (context && context.quality) || {};
    const userForceAccept = Boolean(context.userForceAccept);
    if (quality.valid === true) {
      // 没有冲突，质量本身通过
      return {
        conflictType,
        resolution: RESOLUTION.USER_WINS,
        reason: '质量校验通过，无冲突',
        blocksAgent: false,
        requiresUserConfirm: false,
      };
    }
    if (userForceAccept) {
      return {
        conflictType,
        resolution: RESOLUTION.USER_FORCE_ACCEPT,
        reason: '质量校验未通过但用户明确选择强制接受——记入操作日志，并展示警告',
        blocksAgent: false,
        requiresUserConfirm: false,    // 用户已 force accept，无需再次确认
      };
    }
    return {
      conflictType,
      resolution: RESOLUTION.USER_FORCE_ACCEPT,   // 同枚举值，但 requiresUserConfirm=true 表示需弹窗
      reason: `质量未达标（${(quality.errors || []).slice(0, 2).join('、') || '原因未指明'}），需要用户显式确认是否强制接受`,
      blocksAgent: true,
      requiresUserConfirm: true,
    };
  }

  // ── CONTRACTS_VS_SKIP ─────────────────────────────────
  // 用户/Agent 想跳过 contracts.js 定义的 Stage 依赖链
  // 唯一合法路径：导入已有 artifact（如老师手上有现成讲稿）
  if (conflictType === CONFLICT_TYPE.CONTRACTS_VS_SKIP) {
    if (context && context.hasImportPath && context.importedArtifact) {
      return {
        conflictType,
        resolution: RESOLUTION.PROVIDE_IMPORT_PATH,
        reason: '允许通过"导入现有 artifact"路径满足 contracts.js 的 Stage 依赖（M4 商业化场景）',
        blocksAgent: false,
        requiresUserConfirm: false,
      };
    }
    return {
      conflictType,
      resolution: RESOLUTION.CONTRACTS_WINS,
      reason: 'contracts.js 的 Stage 依赖链不可绕过；如需跳过，请通过"导入现有讲稿/框架"路径',
      blocksAgent: true,
      requiresUserConfirm: false,
    };
  }

  // ── RETRY_VS_STOP ─────────────────────────────────────
  // 自动重试 loop 与用户主动中断的关系
  if (conflictType === CONFLICT_TYPE.RETRY_VS_STOP) {
    if (context && context.userStopRequested === true) {
      return {
        conflictType,
        resolution: RESOLUTION.USER_STOP_WINS,
        reason: '用户已请求停止，立即终止重试 loop 并保留当前最佳候选',
        blocksAgent: true,
        requiresUserConfirm: false,
      };
    }
    const attemptCount = Number(context.attemptCount) || 0;
    const maxAttempts = Number(context.maxAttempts) || 3;
    if (attemptCount >= maxAttempts) {
      return {
        conflictType,
        resolution: RESOLUTION.USER_STOP_WINS,
        reason: `已达最大重试次数（${maxAttempts}），停止重试并向用户报告`,
        blocksAgent: true,
        requiresUserConfirm: false,
      };
    }
    return {
      conflictType,
      resolution: RESOLUTION.AGENT_PROCEEDS,
      reason: `继续重试（第 ${attemptCount + 1} 次/最多 ${maxAttempts} 次）`,
      blocksAgent: false,
      requiresUserConfirm: false,
    };
  }

  // 兜底（理论上不可达）
  throw new Error(`conflict-policy: 未实现的冲突类型分支 ${conflictType}`);
}

// ─── 内部工具 ────────────────────────────────────────────
/**
 * 从多种 context 形态中提取 lockedByUser 状态。
 * 支持：
 *  - context.lockedByUser
 *  - context.upstreamArtifact.lockedByUser
 *  - context.artifact.lockedByUser
 */
function _extractLockedByUser(context) {
  if (!context || typeof context !== 'object') return false;
  if (context.lockedByUser === true) return true;
  if (context.upstreamArtifact && context.upstreamArtifact.lockedByUser === true) return true;
  if (context.artifact && context.artifact.lockedByUser === true) return true;
  return false;
}

/**
 * 工具方法：批量校验一组冲突，返回任一阻塞 Agent 的最先决策。
 * 用于 orchestrator 在执行某动作前一次性检查多个潜在冲突。
 *
 * @param {Array<{type: string, context: Object}>} conflicts
 * @returns {Object|null} 第一个 blocksAgent=true 的裁决，全部允许时返回 null
 */
function findFirstBlocking(conflicts) {
  if (!Array.isArray(conflicts)) return null;
  for (const item of conflicts) {
    if (!item || !item.type) continue;
    const decision = resolveConflict(item.type, item.context || {});
    if (decision.blocksAgent) return decision;
  }
  return null;
}

// ─── 自检函数 ────────────────────────────────────────────
function selfCheck() {
  const cases = [];

  // 用例 1：PLATFORM_VS_USER 永远 platform 胜
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.PLATFORM_VS_USER);
    if (d.resolution !== RESOLUTION.PLATFORM_WINS) throw new Error('platform 应胜');
    if (d.blocksAgent !== false) throw new Error('platform 不应阻塞 Agent（Agent 也受平台约束）');
  });

  // 用例 2：PROJECT_VS_USER 当前用户胜
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.PROJECT_VS_USER);
    if (d.resolution !== RESOLUTION.USER_WINS) throw new Error('用户输入应胜');
  });

  // 用例 3：MEMORY_VS_CURRENT 当前任务胜
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.MEMORY_VS_CURRENT);
    if (d.resolution !== RESOLUTION.CURRENT_USER_WINS) throw new Error('当前任务应胜过历史 memory');
  });

  // 用例 4：USER_EDIT_VS_AGENT 上游被锁 → 阻塞 Agent
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.USER_EDIT_VS_AGENT, {
      upstreamArtifact: { lockedByUser: true, type: 'framework' },
    });
    if (d.resolution !== RESOLUTION.USER_EDIT_PROTECTED) throw new Error('锁定应触发 USER_EDIT_PROTECTED');
    if (d.blocksAgent !== true) throw new Error('锁定应阻塞 Agent');
    if (d.requiresUserConfirm !== true) throw new Error('应要求用户确认');
  });

  // 用例 5：USER_EDIT_VS_AGENT 上游未锁 → Agent 可继续
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.USER_EDIT_VS_AGENT, {
      upstreamArtifact: { lockedByUser: false, type: 'framework' },
    });
    if (d.resolution !== RESOLUTION.AGENT_PROCEEDS) throw new Error('未锁应允许 AGENT_PROCEEDS');
    if (d.blocksAgent !== false) throw new Error('未锁不应阻塞');
  });

  // 用例 6：USER_EDIT_VS_AGENT 直接传 lockedByUser=true 也能识别
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.USER_EDIT_VS_AGENT, { lockedByUser: true });
    if (d.blocksAgent !== true) throw new Error('直接传 lockedByUser=true 应阻塞');
  });

  // 用例 7：QUALITY_VS_USER_ACCEPT quality.valid=true 时无冲突
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.QUALITY_VS_USER_ACCEPT, {
      quality: { valid: true, errors: [] },
    });
    if (d.resolution !== RESOLUTION.USER_WINS) throw new Error('质量通过应判 USER_WINS');
    if (d.blocksAgent !== false) throw new Error('质量通过不应阻塞');
  });

  // 用例 8：QUALITY_VS_USER_ACCEPT 失败 + 未 force → 阻塞 + 要求确认
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.QUALITY_VS_USER_ACCEPT, {
      quality: { valid: false, errors: ['字数不足', '寒暄词过多'] },
      userForceAccept: false,
    });
    if (d.blocksAgent !== true) throw new Error('未 force 时应阻塞');
    if (d.requiresUserConfirm !== true) throw new Error('应要求用户确认');
    if (!d.reason.includes('字数不足') && !d.reason.includes('寒暄词')) {
      throw new Error('reason 应包含错误描述：' + d.reason);
    }
  });

  // 用例 9：QUALITY_VS_USER_ACCEPT 失败 + force=true → 允许通过
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.QUALITY_VS_USER_ACCEPT, {
      quality: { valid: false, errors: ['x'] },
      userForceAccept: true,
    });
    if (d.resolution !== RESOLUTION.USER_FORCE_ACCEPT) throw new Error('应判 USER_FORCE_ACCEPT');
    if (d.blocksAgent !== false) throw new Error('force 时不应阻塞');
    if (d.requiresUserConfirm !== false) throw new Error('已 force 不需再确认');
  });

  // 用例 10：CONTRACTS_VS_SKIP 无导入路径 → contracts 胜
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.CONTRACTS_VS_SKIP);
    if (d.resolution !== RESOLUTION.CONTRACTS_WINS) throw new Error('无导入路径应判 CONTRACTS_WINS');
    if (d.blocksAgent !== true) throw new Error('应阻塞跳过');
  });

  // 用例 11：CONTRACTS_VS_SKIP 提供导入路径 → 允许
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.CONTRACTS_VS_SKIP, {
      hasImportPath: true,
      importedArtifact: { type: 'lecture_final', content: 'imported' },
    });
    if (d.resolution !== RESOLUTION.PROVIDE_IMPORT_PATH) throw new Error('导入路径应判 PROVIDE_IMPORT_PATH');
    if (d.blocksAgent !== false) throw new Error('导入路径下不应阻塞');
  });

  // 用例 12：RETRY_VS_STOP 用户请求停止 → 立即停
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.RETRY_VS_STOP, { userStopRequested: true });
    if (d.resolution !== RESOLUTION.USER_STOP_WINS) throw new Error('用户停止应胜');
    if (d.blocksAgent !== true) throw new Error('应阻塞继续重试');
  });

  // 用例 13：RETRY_VS_STOP 已达最大重试 → 停
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.RETRY_VS_STOP, {
      attemptCount: 3, maxAttempts: 3,
    });
    if (d.resolution !== RESOLUTION.USER_STOP_WINS) throw new Error('达上限应停');
    if (!d.reason.includes('3')) throw new Error('reason 应含次数');
  });

  // 用例 14：RETRY_VS_STOP 未达上限 → Agent 继续
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.RETRY_VS_STOP, {
      attemptCount: 1, maxAttempts: 3,
    });
    if (d.resolution !== RESOLUTION.AGENT_PROCEEDS) throw new Error('未达上限应继续');
    if (d.blocksAgent !== false) throw new Error('继续重试不应阻塞');
  });

  // 用例 15：未知冲突类型抛错
  cases.push(() => {
    let threw = false;
    try {
      resolveConflict('unknown_conflict_type');
    } catch (e) {
      threw = true;
    }
    if (!threw) throw new Error('未知冲突类型应抛错');
  });

  // 用例 16：findFirstBlocking 返回首个阻塞决策
  cases.push(() => {
    const conflicts = [
      { type: CONFLICT_TYPE.PROJECT_VS_USER },                  // 不阻塞
      { type: CONFLICT_TYPE.USER_EDIT_VS_AGENT, context: { lockedByUser: true } },  // 阻塞
      { type: CONFLICT_TYPE.RETRY_VS_STOP, context: { userStopRequested: true } },  // 也阻塞但应不返回此项
    ];
    const blocking = findFirstBlocking(conflicts);
    if (!blocking) throw new Error('应找到阻塞决策');
    if (blocking.conflictType !== CONFLICT_TYPE.USER_EDIT_VS_AGENT) {
      throw new Error(`应返回首个阻塞，实际 ${blocking.conflictType}`);
    }
  });

  // 用例 17：findFirstBlocking 全部允许时返回 null
  cases.push(() => {
    const conflicts = [
      { type: CONFLICT_TYPE.PROJECT_VS_USER },
      { type: CONFLICT_TYPE.MEMORY_VS_CURRENT },
      { type: CONFLICT_TYPE.USER_EDIT_VS_AGENT, context: { lockedByUser: false } },
    ];
    const blocking = findFirstBlocking(conflicts);
    if (blocking !== null) throw new Error(`全部允许应返回 null，实际 ${blocking?.conflictType}`);
  });

  // 用例 18：返回结构标准化（4 个固定字段 + conflictType）
  cases.push(() => {
    const d = resolveConflict(CONFLICT_TYPE.PLATFORM_VS_USER);
    const expectedKeys = ['conflictType', 'resolution', 'reason', 'blocksAgent', 'requiresUserConfirm'];
    for (const k of expectedKeys) {
      if (!(k in d)) throw new Error(`返回结构缺字段 ${k}`);
    }
  });

  // 执行
  let passed = 0;
  const failures = [];
  for (let i = 0; i < cases.length; i++) {
    try {
      cases[i]();
      passed++;
    } catch (e) {
      failures.push({ caseIndex: i + 1, message: e.message });
    }
  }
  return { passed, total: cases.length, failures, success: failures.length === 0 };
}

module.exports = {
  // 枚举
  CONFLICT_TYPE,
  RESOLUTION,

  // 核心 API
  resolveConflict,
  findFirstBlocking,

  // 测试辅助
  selfCheck,
};
