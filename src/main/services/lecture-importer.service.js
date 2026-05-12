/**
 * lecture-importer.service.js — 导入现有讲稿合法入口（Phase-6 M4.1）
 *
 * 商业化场景：老师手上已有现成讲稿（Word / 纯文本 / Markdown），不想从头让 AI 生成。
 * 现有 contracts.js 强制 framework→lecture→ppt 顺序，本 service 提供 contracts.js
 * 唯一允许的合法跳过路径：通过 conflict-policy.CONTRACTS_VS_SKIP 裁决。
 *
 * 流程：
 *   ① 解析文件（.txt / .md 直接读 / .docx 用 mammoth）
 *   ② 验证内容（非空、长度合理）
 *   ③ 冲突裁决（resolveConflict(CONTRACTS_VS_SKIP) → PROVIDE_IMPORT_PATH 才允许）
 *   ④ 通过 v2Runtime.saveLectureStage + confirmLectureStage 写入 DB
 *      - _userInitiated=true：M2.2 用户操作锁，导入即"用户编辑"，自动锁定
 *      - userForceAccept=true：M3.2 跳过 quality 校验（导入内容不一定符合 8000+ 字标准）
 *   ⑤ 返回结构化结果，包含审计字段（来源文件 / 字符数 / 冲突裁决标识）
 *
 * 不依赖 electron。可独立测试。
 *
 * 单文件不超过 600 行（CLAUDE.md 第七节）
 */

const fs = require('fs');
const path = require('path');
const { resolveConflict, CONFLICT_TYPE, RESOLUTION } = require('../agent/conflict-policy');

// ─── 常量 ────────────────────────────────────────────
const SUPPORTED_EXTENSIONS = Object.freeze(['.txt', '.md', '.docx']);
const MIN_SCRIPT_CHARS = 200;          // 太短的文件不认为是讲稿
const MAX_SCRIPT_CHARS = 200 * 1000;   // 20 万字硬上限（避免恶意文件）

// ─── 文件解析 ────────────────────────────────────────
/**
 * 读取并解析讲稿文件。
 *
 * @param {string} filePath - 绝对路径
 * @returns {Promise<{ ok: boolean, finalScript?: string, format?: string, error?: string }>}
 */
async function parseLectureFile(filePath) {
  if (typeof filePath !== 'string' || !filePath.trim()) {
    return { ok: false, error: '文件路径为空或非字符串' };
  }
  if (!fs.existsSync(filePath)) {
    return { ok: false, error: `文件不存在：${filePath}` };
  }

  const ext = path.extname(filePath).toLowerCase();
  if (!SUPPORTED_EXTENSIONS.includes(ext)) {
    return {
      ok: false,
      error: `不支持的文件格式 "${ext}"。支持：${SUPPORTED_EXTENSIONS.join(', ')}`,
    };
  }

  try {
    if (ext === '.txt' || ext === '.md') {
      const text = fs.readFileSync(filePath, 'utf8');
      return { ok: true, finalScript: _normalizeText(text), format: ext.slice(1) };
    }
    if (ext === '.docx') {
      const text = await _extractDocxText(filePath);
      return { ok: true, finalScript: _normalizeText(text), format: 'docx' };
    }
    return { ok: false, error: `未实现的格式：${ext}` };
  } catch (e) {
    return { ok: false, error: `解析失败：${e.message}` };
  }
}

/**
 * 用 mammoth 提取 .docx 的纯文本。
 * mammoth 是项目已有依赖（package.json: mammoth ^1.6.0），不引入新包。
 *
 * 失败时由调用方捕获 throw。
 */
async function _extractDocxText(filePath) {
  const mammoth = require('mammoth');
  const result = await mammoth.extractRawText({ path: filePath });
  return String(result.value || '');
}

/**
 * 规范化文本：
 *  - 统一换行为 \n
 *  - 去除 BOM / 零宽空格 / 大量重复空白
 *  - 不动 Markdown 结构（## 标题、- 列表等保留）
 */
function _normalizeText(text) {
  if (typeof text !== 'string') return '';
  return text
    .replace(/^﻿/, '')              // BOM
    .replace(/[​‌‍]/g, '') // 零宽空格
    .replace(/\r\n/g, '\n')               // 统一换行
    .replace(/\r/g, '\n')
    .replace(/\n{4,}/g, '\n\n\n')         // 4+ 连续换行压成 3
    .trim();
}

// ─── 内容验证 ────────────────────────────────────────
/**
 * 验证导入的 finalScript 是否合规。
 * 不做 quality 校验（quality.js 由后续 v2Runtime 处理 + userForceAccept 兜底）。
 * 只做基本完整性检查。
 *
 * @param {string} finalScript
 * @returns {{ ok: boolean, charCount: number, error?: string }}
 */
function validateImportedScript(finalScript) {
  if (typeof finalScript !== 'string') {
    return { ok: false, charCount: 0, error: 'finalScript 必须是字符串' };
  }
  const trimmed = finalScript.trim();
  if (!trimmed) {
    return { ok: false, charCount: 0, error: '讲稿内容为空' };
  }
  const charCount = trimmed.length;
  if (charCount < MIN_SCRIPT_CHARS) {
    return {
      ok: false, charCount,
      error: `讲稿内容过短（${charCount} 字符），至少需要 ${MIN_SCRIPT_CHARS} 字符`,
    };
  }
  if (charCount > MAX_SCRIPT_CHARS) {
    return {
      ok: false, charCount,
      error: `讲稿内容过长（${charCount} 字符），超出上限 ${MAX_SCRIPT_CHARS} 字符`,
    };
  }
  return { ok: true, charCount };
}

// ─── 冲突裁决 ────────────────────────────────────────
/**
 * 通过 conflict-policy 裁决导入是否合法。
 * 走 CONTRACTS_VS_SKIP 场景：hasImportPath=true 时应返回 PROVIDE_IMPORT_PATH。
 *
 * @param {Object} importedArtifact - 已解析的 artifact 描述
 * @returns {Object} resolveConflict 的返回值
 */
function checkImportConflict(importedArtifact) {
  return resolveConflict(CONFLICT_TYPE.CONTRACTS_VS_SKIP, {
    hasImportPath: true,
    importedArtifact,
  });
}

// ─── 主流程 ────────────────────────────────────────
/**
 * 完整导入流程：解析 → 校验 → 冲突裁决 → 写 DB。
 *
 * @param {Object} payload
 * @param {number} payload.notebookId
 * @param {string} payload.filePath - 讲稿文件绝对路径
 * @param {string} [payload.instruction] - 可选的导入说明
 * @param {Object} deps
 * @param {Object} deps.v2Runtime - 由 IPC handler 注入的 v2Runtime（含 saveLectureStage / confirmLectureStage）
 * @returns {Promise<Object>}
 */
async function importLectureFromFile(payload, deps) {
  if (!deps || !deps.v2Runtime) {
    return { success: false, error: 'v2Runtime 未注入' };
  }
  if (!payload || typeof payload.filePath !== 'string') {
    return { success: false, error: '缺少 payload.filePath' };
  }
  if (!Number(payload.notebookId)) {
    return { success: false, error: '缺少 payload.notebookId' };
  }

  // ① 解析文件
  const parseResult = await parseLectureFile(payload.filePath);
  if (!parseResult.ok) {
    return { success: false, error: parseResult.error, stage: 'parse' };
  }

  // ② 验证
  const validation = validateImportedScript(parseResult.finalScript);
  if (!validation.ok) {
    return { success: false, error: validation.error, stage: 'validate' };
  }

  // ③ 冲突裁决
  const importedArtifact = {
    type: 'lecture_final',
    finalScript: parseResult.finalScript,
    sourceFile: path.basename(payload.filePath),
  };
  const decision = checkImportConflict(importedArtifact);
  if (decision.blocksAgent) {
    return {
      success: false,
      error: `导入被 conflict-policy 阻止：${decision.reason}`,
      stage: 'conflict',
      conflictType: decision.conflictType,
    };
  }
  if (decision.resolution !== RESOLUTION.PROVIDE_IMPORT_PATH) {
    // 健壮性：理论上 hasImportPath=true 应当返回 PROVIDE_IMPORT_PATH
    return {
      success: false,
      error: `意外的冲突裁决结果：${decision.resolution}`,
      stage: 'conflict',
    };
  }

  // ④ 写 DB（save + confirm；userForceAccept=true 让 quality 失败也能通过）
  const lecturePayload = {
    notebookId: Number(payload.notebookId),
    finalScript: parseResult.finalScript,
    drafts: { a: '', b: '', c: '' },     // 导入路径无 ABC 草稿
    selectedDraft: 'a',
    instruction: typeof payload.instruction === 'string' && payload.instruction.trim()
      ? payload.instruction.trim()
      : `导入自现有讲稿文件：${path.basename(payload.filePath)}`,
    _userInitiated: true,                 // M2.2：用户操作，自动锁
    userForceAccept: true,                // M3.2：跳过 quality 校验（导入内容不一定符合标准字数）
  };

  let saveResult;
  let confirmResult;
  try {
    saveResult = await deps.v2Runtime.saveLectureStage(lecturePayload);
    if (saveResult && saveResult.success === false) {
      return {
        success: false,
        error: `保存失败：${saveResult.error || '未知原因'}`,
        stage: 'save',
      };
    }
  } catch (e) {
    return { success: false, error: `saveLectureStage 抛错：${e.message}`, stage: 'save' };
  }

  try {
    confirmResult = await deps.v2Runtime.confirmLectureStage(lecturePayload);
    if (confirmResult && confirmResult.success === false) {
      return {
        success: false,
        error: `确认失败：${confirmResult.error || '未知原因'}`,
        stage: 'confirm',
      };
    }
  } catch (e) {
    return { success: false, error: `confirmLectureStage 抛错：${e.message}`, stage: 'confirm' };
  }

  // ⑤ 返回审计信息
  return {
    success: true,
    data: confirmResult?.data || saveResult?.data || null,
    imported: {
      format: parseResult.format,
      sourceFile: path.basename(payload.filePath),
      charCount: validation.charCount,
      conflictType: decision.conflictType,
      conflictResolution: decision.resolution,
      lockedByUser: true,                  // 导入即锁定，符合 Q3 决策
    },
  };
}

// ─── 自检函数 ────────────────────────────────────────
function selfCheck() {
  const cases = [];

  // 用例 1：parseLectureFile - 不存在的文件
  cases.push({
    name: 'parseLectureFile: 不存在的文件返回 ok:false',
    fn: async () => {
      const r = await parseLectureFile('/nonexistent/file.txt');
      if (r.ok) throw new Error('不存在的文件应返回 ok:false');
      if (!r.error.includes('不存在')) throw new Error(`error 应包含"不存在"：${r.error}`);
    },
  });

  // 用例 2：parseLectureFile - 不支持的扩展名
  cases.push({
    name: 'parseLectureFile: .pdf 不支持',
    fn: async () => {
      const tmpFile = path.join(require('os').tmpdir(), `test-import-${Date.now()}.pdf`);
      fs.writeFileSync(tmpFile, 'fake');
      try {
        const r = await parseLectureFile(tmpFile);
        if (r.ok) throw new Error('.pdf 应不支持');
        if (!r.error.includes('不支持')) throw new Error(`error 应包含"不支持"：${r.error}`);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    },
  });

  // 用例 3：parseLectureFile - .txt 正常解析
  cases.push({
    name: 'parseLectureFile: .txt 正常',
    fn: async () => {
      const tmpFile = path.join(require('os').tmpdir(), `test-import-${Date.now()}.txt`);
      const sample = '## 模块1\n这是讲稿内容。'.repeat(20);  // 确保过 MIN_SCRIPT_CHARS
      fs.writeFileSync(tmpFile, sample, 'utf8');
      try {
        const r = await parseLectureFile(tmpFile);
        if (!r.ok) throw new Error(`txt 解析应成功：${r.error}`);
        if (r.format !== 'txt') throw new Error(`format 应为 txt，实际 ${r.format}`);
        if (!r.finalScript.includes('讲稿内容')) throw new Error('内容丢失');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    },
  });

  // 用例 4：parseLectureFile - .md 正常解析
  cases.push({
    name: 'parseLectureFile: .md 保留 Markdown 标记',
    fn: async () => {
      const tmpFile = path.join(require('os').tmpdir(), `test-import-${Date.now()}.md`);
      const sample = '# 标题\n\n## 模块1\n\n教师讲述：测试。\n'.repeat(15);
      fs.writeFileSync(tmpFile, sample, 'utf8');
      try {
        const r = await parseLectureFile(tmpFile);
        if (!r.ok) throw new Error(`md 解析应成功：${r.error}`);
        if (!r.finalScript.includes('## 模块1')) throw new Error('Markdown 结构应保留');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    },
  });

  // 用例 5：validateImportedScript - 空内容
  cases.push({
    name: 'validateImportedScript: 空内容拒绝',
    fn: () => {
      const r1 = validateImportedScript('');
      if (r1.ok) throw new Error('空字符串应拒绝');
      const r2 = validateImportedScript('   \n\n  ');
      if (r2.ok) throw new Error('仅空白也应拒绝');
    },
  });

  // 用例 6：validateImportedScript - 过短
  cases.push({
    name: 'validateImportedScript: 过短（< 200 字符）拒绝',
    fn: () => {
      const r = validateImportedScript('短内容');
      if (r.ok) throw new Error('过短应拒绝');
      if (!r.error.includes('过短')) throw new Error(`error 应说明"过短"：${r.error}`);
    },
  });

  // 用例 7：validateImportedScript - 正常长度
  cases.push({
    name: 'validateImportedScript: 正常长度通过',
    fn: () => {
      const sample = 'X'.repeat(500);
      const r = validateImportedScript(sample);
      if (!r.ok) throw new Error(`正常长度应通过：${r.error}`);
      if (r.charCount !== 500) throw new Error(`charCount 应为 500，实际 ${r.charCount}`);
    },
  });

  // 用例 8：checkImportConflict - 应返回 PROVIDE_IMPORT_PATH
  cases.push({
    name: 'checkImportConflict: 返回 PROVIDE_IMPORT_PATH 不阻塞',
    fn: () => {
      const decision = checkImportConflict({ type: 'lecture_final', finalScript: 'x' });
      if (decision.resolution !== RESOLUTION.PROVIDE_IMPORT_PATH) {
        throw new Error(`期望 PROVIDE_IMPORT_PATH，实际 ${decision.resolution}`);
      }
      if (decision.blocksAgent) throw new Error('导入路径不应阻塞');
    },
  });

  // 用例 9：importLectureFromFile - 缺 deps
  cases.push({
    name: 'importLectureFromFile: 缺 v2Runtime 返回 error',
    fn: async () => {
      const r = await importLectureFromFile({ filePath: '/x', notebookId: 1 }, null);
      if (r.success) throw new Error('缺 deps 应失败');
      if (!r.error.includes('v2Runtime')) throw new Error(`error 应提示 v2Runtime：${r.error}`);
    },
  });

  // 用例 10：importLectureFromFile - 缺 filePath
  cases.push({
    name: 'importLectureFromFile: 缺 filePath 返回 error',
    fn: async () => {
      const fakeRuntime = { saveLectureStage: async () => ({}), confirmLectureStage: async () => ({}) };
      const r = await importLectureFromFile({ notebookId: 1 }, { v2Runtime: fakeRuntime });
      if (r.success) throw new Error('缺 filePath 应失败');
    },
  });

  // 用例 11：importLectureFromFile - 完整流程（mock v2Runtime）
  cases.push({
    name: 'importLectureFromFile: 完整流程成功',
    fn: async () => {
      const tmpFile = path.join(require('os').tmpdir(), `test-import-${Date.now()}.txt`);
      const sample = '## 模块1\n这是测试讲稿内容。'.repeat(30);
      fs.writeFileSync(tmpFile, sample, 'utf8');
      try {
        const calls = { save: 0, confirm: 0 };
        const fakeRuntime = {
          saveLectureStage: async (p) => { calls.save++; calls.savePayload = p; return { success: true }; },
          confirmLectureStage: async (p) => { calls.confirm++; calls.confirmPayload = p; return { success: true, data: { ok: 1 } }; },
        };
        const r = await importLectureFromFile(
          { filePath: tmpFile, notebookId: 42 },
          { v2Runtime: fakeRuntime }
        );
        if (!r.success) throw new Error(`应成功：${r.error}`);
        if (calls.save !== 1) throw new Error('应调用 saveLectureStage 一次');
        if (calls.confirm !== 1) throw new Error('应调用 confirmLectureStage 一次');
        if (calls.savePayload._userInitiated !== true) throw new Error('应传 _userInitiated=true');
        if (calls.savePayload.userForceAccept !== true) throw new Error('应传 userForceAccept=true');
        if (!r.imported || r.imported.format !== 'txt') throw new Error('imported.format 应为 txt');
        if (!r.imported.lockedByUser) throw new Error('imported.lockedByUser 应为 true');
      } finally {
        fs.unlinkSync(tmpFile);
      }
    },
  });

  // 用例 12：importLectureFromFile - 解析失败
  cases.push({
    name: 'importLectureFromFile: 不存在文件 stage=parse',
    fn: async () => {
      const fakeRuntime = { saveLectureStage: async () => ({}), confirmLectureStage: async () => ({}) };
      const r = await importLectureFromFile(
        { filePath: '/nonexistent.txt', notebookId: 1 },
        { v2Runtime: fakeRuntime }
      );
      if (r.success) throw new Error('应失败');
      if (r.stage !== 'parse') throw new Error(`stage 应为 parse，实际 ${r.stage}`);
    },
  });

  // 用例 13：importLectureFromFile - 内容过短 stage=validate
  cases.push({
    name: 'importLectureFromFile: 过短文件 stage=validate',
    fn: async () => {
      const tmpFile = path.join(require('os').tmpdir(), `test-import-${Date.now()}.txt`);
      fs.writeFileSync(tmpFile, '短内容', 'utf8');
      try {
        const fakeRuntime = { saveLectureStage: async () => ({}), confirmLectureStage: async () => ({}) };
        const r = await importLectureFromFile(
          { filePath: tmpFile, notebookId: 1 },
          { v2Runtime: fakeRuntime }
        );
        if (r.success) throw new Error('过短应失败');
        if (r.stage !== 'validate') throw new Error(`stage 应为 validate，实际 ${r.stage}`);
      } finally {
        fs.unlinkSync(tmpFile);
      }
    },
  });

  // 用例 14：_normalizeText - 移除 BOM 与零宽空格
  cases.push({
    name: '_normalizeText: 移除 BOM 与零宽空格',
    fn: () => {
      const out = _normalizeText('﻿测​试‌内‍容');
      if (out !== '测试内容') throw new Error(`规范化失败：${JSON.stringify(out)}`);
    },
  });

  // 用例 15：_normalizeText - 统一换行
  cases.push({
    name: '_normalizeText: 统一 \\r\\n 为 \\n',
    fn: () => {
      const out = _normalizeText('A\r\nB\rC');
      if (out !== 'A\nB\nC') throw new Error(`换行规范化失败：${JSON.stringify(out)}`);
    },
  });

  return (async () => {
    let passed = 0;
    const failures = [];
    for (let i = 0; i < cases.length; i++) {
      try {
        const r = cases[i].fn();
        if (r && typeof r.then === 'function') await r;
        passed++;
      } catch (e) {
        failures.push({ caseIndex: i + 1, name: cases[i].name, message: e.message });
      }
    }
    return { passed, total: cases.length, failures, success: failures.length === 0 };
  })();
}

module.exports = {
  // 主 API
  parseLectureFile,
  validateImportedScript,
  checkImportConflict,
  importLectureFromFile,

  // 常量（导出供测试 & UI 提示用）
  SUPPORTED_EXTENSIONS,
  MIN_SCRIPT_CHARS,
  MAX_SCRIPT_CHARS,

  // 测试辅助
  selfCheck,
};
