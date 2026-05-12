/**
 * verify-workflow-pause-ui.js — Phase-7.5 M7.5.6 UI 工作流模式 B 验证
 *
 * 验证 5 个层面（前端 UI 在 Node 环境无法 DOM 渲染，因此做"静态契约校验"）：
 *   1) modalFile        — WorkflowPauseModal.jsx 文件存在 + 关键字段
 *   2) v2AppIntegration — V2App.jsx 已 import + 状态变量 + 渲染 + 切换 hook
 *   3) handleAgentRun   — handleAgentRun 含 paused 分支
 *   4) handleResume     — handleAgentResume / handleAgentDismissPause 函数存在
 *   5) preloadApi       — preload 已暴露 agentResume / agentGetPauseState / agentClearPauseState
 *
 * 用法：node scripts/verify-workflow-pause-ui.js
 */

const fs = require('fs');
const path = require('path');

const cases = [];

function readSrc(rel) {
  return fs.readFileSync(path.join(__dirname, '..', rel), 'utf8');
}

// ── 1) modalFile ──
cases.push({
  name: '[modal] WorkflowPauseModal.jsx 存在 + 含关键 props/UI 元素',
  fn: () => {
    const src = readSrc('src/renderer/src/v2/WorkflowPauseModal.jsx');
    if (!src.includes('export default function WorkflowPauseModal')) {
      throw new Error('应导出 WorkflowPauseModal');
    }
    // 必备 props
    for (const prop of ['pauseState', 'onResume', 'onDismiss', 'busy']) {
      if (!src.includes(prop)) throw new Error(`应含 prop ${prop}`);
    }
    // 必备 UI 元素
    for (const text of ['Agent 暂停', '提示词微调', '重新生成', '跳过']) {
      if (!src.includes(text)) throw new Error(`UI 应含 "${text}"`);
    }
    // 风格配置存在
    if (!src.includes('STAGE_LABELS')) throw new Error('应有 STAGE_LABELS');
    if (!src.includes('HINT_EXAMPLES')) throw new Error('应有 HINT_EXAMPLES');
  },
});

cases.push({
  name: '[modal] 不同 stage 提供差异化 hint placeholder',
  fn: () => {
    const src = readSrc('src/renderer/src/v2/WorkflowPauseModal.jsx');
    for (const stage of ['lecture', 'ppt_images', 'framework', 'framework_infographic']) {
      if (!src.includes(`'${stage}':`) && !src.includes(`${stage}:`)) {
        throw new Error(`HINT_EXAMPLES 应含 ${stage}`);
      }
    }
  },
});

// ── 2) v2AppIntegration ──
cases.push({
  name: '[v2app] import WorkflowPauseModal',
  fn: () => {
    const src = readSrc('src/renderer/src/v2/V2App.jsx');
    if (!src.includes("import WorkflowPauseModal from './WorkflowPauseModal'")) {
      throw new Error('应 import WorkflowPauseModal');
    }
  },
});

cases.push({
  name: '[v2app] 状态变量 agentPauseState / agentResumeBusy',
  fn: () => {
    const src = readSrc('src/renderer/src/v2/V2App.jsx');
    if (!src.includes('agentPauseState')) throw new Error('应有 agentPauseState 状态');
    if (!src.includes('agentResumeBusy')) throw new Error('应有 agentResumeBusy 状态');
    if (!src.includes('setAgentPauseState')) throw new Error('应有 setAgentPauseState');
  },
});

cases.push({
  name: '[v2app] modal 渲染 + 三个回调绑定',
  fn: () => {
    const src = readSrc('src/renderer/src/v2/V2App.jsx');
    if (!src.includes('<WorkflowPauseModal')) throw new Error('应渲染 WorkflowPauseModal');
    if (!src.includes('pauseState={agentPauseState}')) throw new Error('应传 pauseState prop');
    if (!src.includes('onResume={handleAgentResume}')) throw new Error('应传 onResume');
    if (!src.includes('onDismiss={handleAgentDismissPause}')) throw new Error('应传 onDismiss');
  },
});

// ── 3) handleAgentRun ──
cases.push({
  name: '[run] handleAgentRun 识别 paused 状态',
  fn: () => {
    const src = readSrc('src/renderer/src/v2/V2App.jsx');
    if (!src.includes("'paused'")) throw new Error('handleAgentRun 应识别 paused 字符串');
    if (!src.includes('pauseInfo')) throw new Error('应处理 pauseInfo 字段');
    if (!src.includes('setAgentPauseState(response.data.pauseInfo')) {
      throw new Error('应在 paused 时设 agentPauseState');
    }
  },
});

// ── 4) handleResume / dismiss ──
cases.push({
  name: '[resume] handleAgentResume 函数定义',
  fn: () => {
    const src = readSrc('src/renderer/src/v2/V2App.jsx');
    if (!src.includes('const handleAgentResume')) throw new Error('应定义 handleAgentResume');
    if (!src.includes('api.agentResume')) throw new Error('应调 api.agentResume');
    if (!src.includes('refinementHint')) throw new Error('应传 refinementHint');
  },
});

cases.push({
  name: '[dismiss] handleAgentDismissPause 函数定义',
  fn: () => {
    const src = readSrc('src/renderer/src/v2/V2App.jsx');
    if (!src.includes('const handleAgentDismissPause')) throw new Error('应定义 handleAgentDismissPause');
    if (!src.includes('api.agentClearPauseState')) throw new Error('应调 agentClearPauseState');
    if (!src.includes('setAgentPauseState(null)')) throw new Error('dismiss 后清空 agentPauseState');
  },
});

// ── 5) loadNotebookContext 加载暂停状态 ──
cases.push({
  name: '[switch] 切换笔记本时加载 agent pause state',
  fn: () => {
    const src = readSrc('src/renderer/src/v2/V2App.jsx');
    if (!src.includes('api.agentGetPauseState(notebookId)')) {
      throw new Error('loadNotebookContext 应调 agentGetPauseState');
    }
  },
});

// ── 6) preloadApi ──
cases.push({
  name: '[preload] 暴露 agentResume / agentGetPauseState / agentClearPauseState',
  fn: () => {
    const src = readSrc('src/preload/index.js');
    for (const fn of ['agentGetPauseState', 'agentResume', 'agentClearPauseState']) {
      if (!src.includes(fn)) throw new Error(`preload 应暴露 ${fn}`);
    }
    // 检查 IPC channel 名一致
    for (const ch of ['agent:getPauseState', 'agent:resume', 'agent:clearPauseState']) {
      if (!src.includes(ch)) throw new Error(`preload 应使用 channel ${ch}`);
    }
  },
});

cases.push({
  name: '[ipc] agent.handlers 注册 5 个 channel（含 3 个新增）',
  fn: () => {
    delete require.cache[require.resolve('../src/main/ipc/agent.handlers')];
    const m = require('../src/main/ipc/agent.handlers');
    const registered = [];
    m.register({ handle: (ch) => registered.push(ch) }, () => ({}));
    for (const ch of ['agent:run', 'agent:getStatus', 'agent:getPauseState', 'agent:resume', 'agent:clearPauseState']) {
      if (!registered.includes(ch)) throw new Error(`未注册 ${ch}`);
    }
  },
});

// ── 7) 完整集成：handleAgentResume 路径覆盖 ──
cases.push({
  name: '[flow] handleAgentResume 处理"再次暂停"场景',
  fn: () => {
    const src = readSrc('src/renderer/src/v2/V2App.jsx');
    // 应支持二次暂停：恢复后又因质量未达标再次 paused
    if (!src.includes('Agent 再次暂停')) {
      throw new Error('handleAgentResume 应处理二次暂停场景');
    }
  },
});

// 主流程
async function main() {
  let passed = 0;
  const failures = [];
  for (const c of cases) {
    try {
      const r = c.fn();
      if (r && typeof r.then === 'function') await r;
      passed++;
    } catch (e) {
      failures.push({ name: c.name, message: e.message });
    }
  }
  const ok = failures.length === 0;
  console.log(JSON.stringify({
    ok, checkedAt: new Date().toISOString(),
    passed, total: cases.length, failures,
  }, null, 2));
  process.exit(ok ? 0 : 1);
}
main();
