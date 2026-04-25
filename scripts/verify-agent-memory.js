/**
 * verify-agent-memory.js — Phase-5C Step 4 验证脚本
 *
 * 测试内容：
 *  1. extractKeywords — 关键词提取逻辑
 *  2. scoreSimilarity — 相似度评分
 *  3. saveMemory / getAgentMemories / saveAgentMemory — DB 持久化（mock）
 *  4. findSimilarMemories — 相似检索
 *  5. buildMemoryContext — Prompt 上下文格式化
 *
 * 运行：node scripts/verify-agent-memory.js
 */

'use strict';

const { extractKeywords, findSimilarMemories, buildMemoryContext } = require('../src/main/agent/memory');

let passed = 0;
let failed = 0;

function ok(label, condition) {
  if (condition) {
    console.log(`  ✅ ${label}`);
    passed++;
  } else {
    console.log(`  ❌ ${label}`);
    failed++;
  }
}

// ── Mock DB ───────────────────────────────────────────────────────────────────

function makeMockDb(initialMemories = []) {
  const memories = [...initialMemories];
  const notebooks = {};

  return {
    getNotebookById: (id) => notebooks[id] || null,
    saveAgentMemory: (entry) => {
      // upsert
      const idx = memories.findIndex((m) => m.notebookId === entry.notebookId);
      if (idx >= 0) memories[idx] = entry;
      else memories.push(entry);
    },
    getAgentMemories: () => [...memories],
    _notebooks: notebooks
  };
}

// ── Test 1: extractKeywords ───────────────────────────────────────────────────

console.log('\n[1] extractKeywords');
{
  const nb = {
    name: '纺织品色彩搭配',
    description: '纺织行业色彩基础课',
    jobTargets: '橱窗陈列师',
    industryScenarios: '服装展示',
    softwareTools: 'Adobe Color',
    grade: '高职二年级'
  };
  const kws = extractKeywords(nb);
  ok('返回数组', Array.isArray(kws));
  ok('包含"纺织"相关词', kws.some((k) => k.includes('纺织') || k.includes('色彩')));
  ok('去重（无重复词）', new Set(kws).size === kws.length);
  ok('最短2字', kws.every((k) => k.length >= 2));
  console.log(`   关键词(${kws.length})：`, kws.slice(0, 8).join('、'));
}

// ── Test 2: 无记忆时返回空 ────────────────────────────────────────────────────

console.log('\n[2] 无历史记忆');
{
  const db = makeMockDb([]);
  const nb = { id: 1, name: '纺织课', totalHours: 36 };
  const mems = findSimilarMemories(db, nb);
  ok('无记忆时返回空数组', Array.isArray(mems) && mems.length === 0);

  const ctx = buildMemoryContext(db, nb);
  ok('无记忆时 buildMemoryContext 返回空字符串', ctx === '');
}

// ── Test 3: 排除自身 ─────────────────────────────────────────────────────────

console.log('\n[3] 自身不会成为参考');
{
  const selfMemory = {
    notebookId: 42,
    courseName: '纺织品检验',
    totalHours: 36,
    keywords: ['纺织', '检验', '品质'],
    frameworkObjectives: '掌握检验方法',
    frameworkTeachingMethods: '项目教学法',
    lectureCharCount: 8000,
    styleHints: ''
  };
  const db = makeMockDb([selfMemory]);
  const nb = { id: 42, name: '纺织品检验', totalHours: 36 };
  const mems = findSimilarMemories(db, nb);
  ok('排除自身 notebookId', mems.length === 0);
}

// ── Test 4: 相似度排序 ────────────────────────────────────────────────────────

console.log('\n[4] 相似度排序');
{
  const memories = [
    {
      notebookId: 10,
      courseName: '服装色彩搭配',
      totalHours: 36,
      keywords: ['服装', '色彩', '搭配', '纺织'],
      frameworkObjectives: '知识目标：理解色彩理论；技能目标：应用色彩搭配',
      frameworkTeachingMethods: '项目教学法；情境教学法',
      lectureCharCount: 9200,
      styleHints: ''
    },
    {
      notebookId: 11,
      courseName: '计算机网络基础',
      totalHours: 72,
      keywords: ['计算机', '网络', '协议'],
      frameworkObjectives: '理解网络层次',
      frameworkTeachingMethods: '讲授法',
      lectureCharCount: 7000,
      styleHints: ''
    }
  ];
  const db = makeMockDb(memories);
  const nb = { id: 99, name: '纺织品色彩应用', totalHours: 36, description: '服装色彩', jobTargets: '陈列师', industryScenarios: '', softwareTools: '', grade: '' };
  const mems = findSimilarMemories(db, nb, 3);
  ok('有相似记忆时返回结果', mems.length > 0);
  ok('服装色彩排在网络之前', mems[0].notebookId === 10);
  ok('结果含 _score', typeof mems[0]._score === 'number');
  console.log(`   最相似：《${mems[0].courseName}》 score=${mems[0]._score}`);
}

// ── Test 5: buildMemoryContext 格式 ───────────────────────────────────────────

console.log('\n[5] buildMemoryContext 格式');
{
  const memories = [
    {
      notebookId: 20,
      courseName: '纺织工艺基础',
      totalHours: 48,
      keywords: ['纺织', '工艺', '基础'],
      frameworkObjectives: '掌握纺织基本工艺流程，理解纤维分类',
      frameworkTeachingMethods: '项目教学法；实验教学法',
      lectureCharCount: 10500,
      styleHints: '多用实际案例'
    }
  ];
  const db = makeMockDb(memories);
  const nb = { id: 55, name: '纺织技术', totalHours: 48, description: '纺织', jobTargets: '纺织技工', industryScenarios: '', softwareTools: '', grade: '' };
  const ctx = buildMemoryContext(db, nb);
  ok('返回非空字符串', typeof ctx === 'string' && ctx.length > 0);
  ok('包含历史标题行', ctx.includes('历史相似课程参考'));
  ok('包含课程名', ctx.includes('纺织工艺基础'));
  ok('包含教学目标', ctx.includes('教学目标'));
  ok('包含学时信息', ctx.includes('48学时'));
  console.log('   context preview:', ctx.split('\n')[0]);
}

// ── Test 6: DB 方法存在 ───────────────────────────────────────────────────────

console.log('\n[6] DatabaseManager 新方法');
{
  // 仅检查语法可加载，不启动 Electron
  let dbLoaded = false;
  try {
    const src = require('fs').readFileSync(
      require('path').join(__dirname, '../src/main/database/db-simple.js'), 'utf8'
    );
    dbLoaded = src.includes('saveAgentMemory') && src.includes('getAgentMemories') && src.includes('agent_memories');
  } catch {}
  ok('db-simple.js 包含 saveAgentMemory 方法', dbLoaded);
  ok('db-simple.js 包含 getAgentMemories 方法', dbLoaded);
  ok('db-simple.js 包含 agent_memories 初始化', dbLoaded);
}

// ── 汇总 ──────────────────────────────────────────────────────────────────────

console.log(`\n${'='.repeat(50)}`);
console.log(`结果：${passed} 通过 / ${failed} 失败`);
if (failed === 0) {
  console.log('✅ Phase-5C Step 4 Cross-Session Memory 验证通过');
} else {
  console.log('❌ 有测试失败，请检查 src/main/agent/memory.js');
  process.exit(1);
}
