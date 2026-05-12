/**
 * verify-import-lecture.js — Phase-6 M4.1 导入现有讲稿验证
 *
 * 验证 5 个层面：
 *   1) selfCheck         — lecture-importer.service 内置 15 个用例
 *   2) conflictDecision  — 与 conflict-policy.CONTRACTS_VS_SKIP 联动
 *   3) e2e               — 用临时 .txt/.md 文件 + mock v2Runtime 完整流程
 *   4) errorPaths        — 各 stage 失败时的错误返回与 stage 字段
 *   5) coverage          — 3 种格式（.txt / .md / .docx）覆盖
 *
 * 用法：node scripts/verify-import-lecture.js
 *
 * 退出码：0=全部通过，1=任意检查失败
 */

const fs = require('fs');
const path = require('path');
const os = require('os');

const importer = require('../src/main/services/lecture-importer.service');
const { CONFLICT_TYPE, RESOLUTION, resolveConflict } = require('../src/main/agent/conflict-policy');
const { selfCheck, importLectureFromFile, parseLectureFile, validateImportedScript, SUPPORTED_EXTENSIONS } = importer;

const cases = [];

// ─── 1) selfCheck ─────────────────────────────────────
cases.push({
  name: '[selfCheck] lecture-importer 内置自检 15/15',
  fn: async () => {
    const r = await selfCheck();
    if (!r.success) {
      throw new Error(`selfCheck 未全过：${JSON.stringify(r.failures)}`);
    }
    if (r.passed !== 15 || r.total !== 15) {
      throw new Error(`期望 15/15，实际 ${r.passed}/${r.total}`);
    }
  },
});

// ─── 2) conflictDecision ─────────────────────────────
cases.push({
  name: '[conflict] CONTRACTS_VS_SKIP + hasImportPath=true → PROVIDE_IMPORT_PATH',
  fn: () => {
    const decision = resolveConflict(CONFLICT_TYPE.CONTRACTS_VS_SKIP, {
      hasImportPath: true,
      importedArtifact: { type: 'lecture_final', finalScript: 'x'.repeat(500) },
    });
    if (decision.resolution !== RESOLUTION.PROVIDE_IMPORT_PATH) {
      throw new Error(`期望 PROVIDE_IMPORT_PATH，实际 ${decision.resolution}`);
    }
    if (decision.blocksAgent) throw new Error('PROVIDE_IMPORT_PATH 不应阻塞');
  },
});

cases.push({
  name: '[conflict] 缺 hasImportPath → CONTRACTS_WINS（阻塞）',
  fn: () => {
    const decision = resolveConflict(CONFLICT_TYPE.CONTRACTS_VS_SKIP);
    if (decision.resolution !== RESOLUTION.CONTRACTS_WINS) {
      throw new Error(`期望 CONTRACTS_WINS，实际 ${decision.resolution}`);
    }
    if (!decision.blocksAgent) throw new Error('CONTRACTS_WINS 应阻塞');
  },
});

// ─── 3) e2e: txt 完整流程 ─────────────────────────────
cases.push({
  name: '[e2e] .txt 文件完整导入流程',
  fn: async () => {
    const tmpFile = path.join(os.tmpdir(), `verify-import-txt-${Date.now()}.txt`);
    const sample = '# 课程讲稿\n\n## 模块1\n教师讲述：测试导入功能。'.repeat(20);
    fs.writeFileSync(tmpFile, sample, 'utf8');
    try {
      const calls = [];
      const fakeRuntime = {
        saveLectureStage: async (p) => { calls.push({ fn: 'save', payload: p }); return { success: true }; },
        confirmLectureStage: async (p) => { calls.push({ fn: 'confirm', payload: p }); return { success: true, data: { lectureFinal: { id: 1 } } }; },
      };
      const result = await importLectureFromFile(
        { filePath: tmpFile, notebookId: 100, instruction: '测试导入说明' },
        { v2Runtime: fakeRuntime }
      );
      if (!result.success) throw new Error(`应成功：${result.error}`);
      if (result.imported.format !== 'txt') throw new Error('format 应为 txt');
      if (!result.imported.lockedByUser) throw new Error('lockedByUser 应为 true');
      if (result.imported.conflictResolution !== RESOLUTION.PROVIDE_IMPORT_PATH) {
        throw new Error('conflictResolution 应为 PROVIDE_IMPORT_PATH');
      }
      // 校验 v2Runtime 调用顺序与字段
      if (calls.length !== 2) throw new Error(`应调用 2 次（save+confirm），实际 ${calls.length}`);
      if (calls[0].fn !== 'save' || calls[1].fn !== 'confirm') {
        throw new Error('调用顺序应为 save → confirm');
      }
      if (calls[0].payload._userInitiated !== true) throw new Error('save 应传 _userInitiated=true');
      if (calls[0].payload.userForceAccept !== true) throw new Error('save 应传 userForceAccept=true');
      if (calls[1].payload._userInitiated !== true) throw new Error('confirm 应传 _userInitiated=true');
      if (!calls[0].payload.instruction.includes('测试导入说明')) {
        throw new Error('应使用调用方提供的 instruction');
      }
    } finally {
      fs.unlinkSync(tmpFile);
    }
  },
});

// ─── 4) e2e: md 流程 + Markdown 标记保留 ─────────────
cases.push({
  name: '[e2e] .md 文件 Markdown 结构保留',
  fn: async () => {
    const tmpFile = path.join(os.tmpdir(), `verify-import-md-${Date.now()}.md`);
    const sample = '# 标题\n\n## 模块A\n\n- 要点1\n- 要点2\n\n教师讲述：内容。'.repeat(15);
    fs.writeFileSync(tmpFile, sample, 'utf8');
    try {
      const fakeRuntime = {
        saveLectureStage: async (p) => ({ success: true, _passedScript: p.finalScript }),
        confirmLectureStage: async (p) => ({ success: true, _passedScript: p.finalScript }),
      };
      const result = await importLectureFromFile(
        { filePath: tmpFile, notebookId: 200 },
        { v2Runtime: fakeRuntime }
      );
      if (!result.success) throw new Error(`应成功：${result.error}`);
      if (result.imported.format !== 'md') throw new Error('format 应为 md');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  },
});

// ─── 5) errorPaths ────────────────────────────────────
cases.push({
  name: '[error] 不存在文件 → stage=parse',
  fn: async () => {
    const fakeRuntime = { saveLectureStage: async () => ({}), confirmLectureStage: async () => ({}) };
    const r = await importLectureFromFile(
      { filePath: '/never/exists.txt', notebookId: 1 },
      { v2Runtime: fakeRuntime }
    );
    if (r.success) throw new Error('应失败');
    if (r.stage !== 'parse') throw new Error(`stage 应为 parse，实际 ${r.stage}`);
  },
});

cases.push({
  name: '[error] 过短文件 → stage=validate',
  fn: async () => {
    const tmpFile = path.join(os.tmpdir(), `verify-import-short-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, '太短', 'utf8');
    try {
      const fakeRuntime = { saveLectureStage: async () => ({}), confirmLectureStage: async () => ({}) };
      const r = await importLectureFromFile(
        { filePath: tmpFile, notebookId: 1 },
        { v2Runtime: fakeRuntime }
      );
      if (r.success) throw new Error('应失败');
      if (r.stage !== 'validate') throw new Error(`stage 应为 validate，实际 ${r.stage}`);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  },
});

cases.push({
  name: '[error] saveLectureStage 抛错 → stage=save',
  fn: async () => {
    const tmpFile = path.join(os.tmpdir(), `verify-import-save-fail-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, '内容'.repeat(200), 'utf8');
    try {
      const fakeRuntime = {
        saveLectureStage: async () => { throw new Error('mock save fail'); },
        confirmLectureStage: async () => ({}),
      };
      const r = await importLectureFromFile(
        { filePath: tmpFile, notebookId: 1 },
        { v2Runtime: fakeRuntime }
      );
      if (r.success) throw new Error('应失败');
      if (r.stage !== 'save') throw new Error(`stage 应为 save，实际 ${r.stage}`);
      if (!r.error.includes('mock save fail')) throw new Error('应携带原始错误');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  },
});

cases.push({
  name: '[error] confirmLectureStage 抛错 → stage=confirm',
  fn: async () => {
    const tmpFile = path.join(os.tmpdir(), `verify-import-conf-fail-${Date.now()}.txt`);
    fs.writeFileSync(tmpFile, '内容'.repeat(200), 'utf8');
    try {
      const fakeRuntime = {
        saveLectureStage: async () => ({ success: true }),
        confirmLectureStage: async () => { throw new Error('mock confirm fail'); },
      };
      const r = await importLectureFromFile(
        { filePath: tmpFile, notebookId: 1 },
        { v2Runtime: fakeRuntime }
      );
      if (r.success) throw new Error('应失败');
      if (r.stage !== 'confirm') throw new Error(`stage 应为 confirm，实际 ${r.stage}`);
    } finally {
      fs.unlinkSync(tmpFile);
    }
  },
});

cases.push({
  name: '[error] 不支持的扩展名（.pdf）',
  fn: async () => {
    const tmpFile = path.join(os.tmpdir(), `verify-import-pdf-${Date.now()}.pdf`);
    fs.writeFileSync(tmpFile, 'fake pdf content');
    try {
      const fakeRuntime = { saveLectureStage: async () => ({}), confirmLectureStage: async () => ({}) };
      const r = await importLectureFromFile(
        { filePath: tmpFile, notebookId: 1 },
        { v2Runtime: fakeRuntime }
      );
      if (r.success) throw new Error('.pdf 应失败');
      if (r.stage !== 'parse') throw new Error('stage 应为 parse');
      if (!r.error.includes('不支持')) throw new Error('error 应说明不支持');
    } finally {
      fs.unlinkSync(tmpFile);
    }
  },
});

// ─── 6) coverage: 3 种格式都被支持 ─────────────────
cases.push({
  name: '[coverage] SUPPORTED_EXTENSIONS 含 .txt/.md/.docx',
  fn: () => {
    if (!SUPPORTED_EXTENSIONS.includes('.txt')) throw new Error('应支持 .txt');
    if (!SUPPORTED_EXTENSIONS.includes('.md')) throw new Error('应支持 .md');
    if (!SUPPORTED_EXTENSIONS.includes('.docx')) throw new Error('应支持 .docx');
  },
});

// ─── 7) IPC handler 加载 ─────────────────────────────
cases.push({
  name: '[ipc] v2/lecture.handlers.js 加载无错',
  fn: () => {
    delete require.cache[require.resolve('../src/main/ipc/v2/lecture.handlers')];
    const m = require('../src/main/ipc/v2/lecture.handlers');
    if (typeof m.register !== 'function') throw new Error('应导出 register');
  },
});

cases.push({
  name: '[ipc] register 注册 4 个 channel',
  fn: () => {
    const m = require('../src/main/ipc/v2/lecture.handlers');
    const registered = [];
    const fakeIpcMain = { handle: (channel) => registered.push(channel) };
    m.register(fakeIpcMain, () => ({}));
    if (registered.length !== 4) {
      throw new Error(`应注册 4 个 channel，实际 ${registered.length}: ${registered.join(', ')}`);
    }
    if (!registered.includes('v2:importLectureArtifact')) {
      throw new Error('应包含 v2:importLectureArtifact');
    }
  },
});

// ─── 主流程 ────────────────────────────────────────
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
    ok,
    checkedAt: new Date().toISOString(),
    passed,
    total: cases.length,
    failures,
  }, null, 2));
  process.exit(ok ? 0 : 1);
}

main();
