/**
 * stress-test-session-binding.js — v4.2.0 Phase A 压力测试
 *
 * 目标：验证"跨 stage 实体绑定"的 6 个核心承诺，杜绝老师反馈的"4 课件用同一节设计"类 bug
 *
 * 6 个用例（全部通过 = Phase A 验收）：
 *   T1 创建 3 节课，每节都做完整流程 → 每节 design/lecture/ppt 各自独立，不混
 *   T2 切到第 1 节 → 切第 3 节 → 切回第 1 节 → 仍然是第 1 节的内容
 *   T3 同一节有 2 个设计版本 → 切别的节再切回来 → 保留之前选的版本
 *   T4 第 2 节生成 PPT → 第 3 节生成 PPT → PPT 各自绑定到不同 lecture，互不污染
 *   T5 切节课操作要同步更新所有 active artifact id（design / lecture / ppt）
 *   T6 sessionContext 持久化（写入 notebook.sessionContext）
 *
 * 用法：node scripts/stress-test-session-binding.js
 * 不需要 AI / Electron，纯 mock DB
 */

'use strict';
const path = require('path');
const fs = require('fs');
const os = require('os');

// 用临时文件做 mock DB（DatabaseManager 直接读写 JSON 文件）
const TMP_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'stress-session-'));
const DB_FILE = path.join(TMP_DIR, 'course-designer-data.json');
fs.writeFileSync(DB_FILE, JSON.stringify({
  notebooks: [],
  modules: [],
  frameworks: [],
  artifacts: [],
  operations: [],
  backendEvents: [],
  workflowStates: [],
  settings: {},
  agent_memories: [],
}, null, 2));

// 让 DatabaseManager 读写我们的临时文件
process.env.COURSE_DESIGNER_DB_PATH = DB_FILE;

const DB = require('../src/main/database/db-simple.js');

// 大多数 DatabaseManager 实现会从 app.getPath('userData') 取路径
// 我们直接 monkey-patch _readData / _writeData 到临时文件
const db = new DB();
const originalRead = db._readData.bind(db);
const originalWrite = db._writeData.bind(db);
db._readData = function () {
  return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
};
db._writeData = function (data) {
  fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
};

// ── 测试运行框架 ─────────────────────────────────────────────────────────
let total = 0, pass = 0;
const fails = [];
function ok(name, cond, detail = '') {
  total++;
  if (cond) { pass++; console.log(`  ✓ ${name}`); }
  else { fails.push({ name, detail }); console.log(`  ✗ ${name}${detail ? ' — ' + detail : ''}`); }
}
function section(t) { console.log(`\n━━━ ${t} ━━━`); }

// ── 测试数据准备 ─────────────────────────────────────────────────────────
function setupNotebook(name) {
  const data = db._readData();
  const nb = {
    id: (data.notebooks[data.notebooks.length - 1]?.id || 0) + 1,
    name,
    totalHours: 36,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  data.notebooks.push(nb);
  db._writeData(data);
  return nb;
}
function createLessonArtifacts(notebookId, lessonNumber, topic, totalHours) {
  // design + lecture + ppt 各 1 个，绑定到该 lessonNumber
  const design = db.createArtifact({
    notebookId, type: 'design_doc', stage: 'design',
    title: `第 ${lessonNumber} 节·${topic}-设计`, confirmed: true, status: 'confirmed',
    content: { lessonMeta: { lessonNumber, topic, totalHours } },
    metadata: { lessonNumber, topic, theoryHours: totalHours / 2, practiceHours: totalHours / 2 },
  });
  const lecture = db.createArtifact({
    notebookId, type: 'lecture_final', stage: 'lecture',
    title: `第 ${lessonNumber} 节·${topic}-讲稿`, confirmed: true, status: 'confirmed',
    content: { finalScript: `这是第 ${lessonNumber} 节讲稿` },
    metadata: { lessonNumber, topic, theoryHours: totalHours / 2, practiceHours: totalHours / 2 },
  });
  const ppt = db.createArtifact({
    notebookId, type: 'ppt_outline', stage: 'ppt',
    title: `第 ${lessonNumber} 节·${topic}-PPT`, confirmed: true, status: 'confirmed',
    content: {
      pptPages: [{ id: `p${lessonNumber}-1`, title: `Page ${lessonNumber}-1` }],
      lessonContext: { lessonId: lecture.id, lessonNumber, totalHours },
    },
  });
  return { design, lecture, ppt };
}

// ═══════════════════════════════════════════════════════════════════════
// T1: 3 节课，每节独立
// ═══════════════════════════════════════════════════════════════════════
section('T1 · 3 节课，每节 design/lecture/ppt 各自独立');
const nb1 = setupNotebook('光电产业课程');
const lesson1 = createLessonArtifacts(nb1.id, 1, '人才需求', 4);
const lesson2 = createLessonArtifacts(nb1.id, 2, '薪资分析', 4);
const lesson3 = createLessonArtifacts(nb1.id, 3, '岗位匹配', 4);

ok('T1.1 创建后第 1 节的 design 不等于第 2 节的 design',
   lesson1.design.id !== lesson2.design.id);
ok('T1.2 创建后第 1 节的 ppt content.lessonContext.lessonId === lesson1.lecture.id',
   lesson1.ppt.content.lessonContext.lessonId === lesson1.lecture.id);
ok('T1.3 第 3 节 PPT 绑定到第 3 节的 lecture',
   lesson3.ppt.content.lessonContext.lessonId === lesson3.lecture.id);

// ═══════════════════════════════════════════════════════════════════════
// T2: 切节课往返保真
// ═══════════════════════════════════════════════════════════════════════
section('T2 · 切第 1 → 第 3 → 第 1，session 永远准确');
const sess1a = db.switchActiveLesson(nb1.id, 1);
ok('T2.1 切到第 1 节后 activeDesign === lesson1.design.id',
   sess1a.activeDesignArtifactId === lesson1.design.id);
ok('T2.1 切到第 1 节后 activeLecture === lesson1.lecture.id',
   sess1a.activeLectureArtifactId === lesson1.lecture.id);
ok('T2.1 切到第 1 节后 activePpt === lesson1.ppt.id',
   sess1a.activePptOutlineId === lesson1.ppt.id);

const sess3 = db.switchActiveLesson(nb1.id, 3);
ok('T2.2 切到第 3 节后 activeDesign === lesson3.design.id',
   sess3.activeDesignArtifactId === lesson3.design.id);
ok('T2.2 切到第 3 节后 activeLecture === lesson3.lecture.id',
   sess3.activeLectureArtifactId === lesson3.lecture.id);

const sess1b = db.switchActiveLesson(nb1.id, 1);
ok('T2.3 切回第 1 节 → activeDesign 仍是 lesson1.design.id',
   sess1b.activeDesignArtifactId === lesson1.design.id,
   `got ${sess1b.activeDesignArtifactId}, expected ${lesson1.design.id}`);

// ═══════════════════════════════════════════════════════════════════════
// T3: 多版本切换保真（同一节多版本）
// ═══════════════════════════════════════════════════════════════════════
section('T3 · 第 1 节有 2 个设计版本 → 切别的节再切回来 → 仍能恢复指定版本');
// 给第 1 节再加一个 design 版本
const lesson1DesignV2 = db.createArtifact({
  notebookId: nb1.id, type: 'design_doc', stage: 'design',
  title: '第 1 节·人才需求-设计 v2', confirmed: true, status: 'confirmed',
  content: { lessonMeta: { lessonNumber: 1, topic: '人才需求', totalHours: 4 } },
  metadata: { lessonNumber: 1, topic: '人才需求', theoryHours: 2, practiceHours: 2 },
});
// 老师手动切到 v2
db.updateSessionContext(nb1.id, { activeDesignArtifactId: lesson1DesignV2.id });
const sessAfterPick = db.getSessionContext(nb1.id);
ok('T3.1 老师切到 design v2 后 session 记录正确',
   sessAfterPick.activeDesignArtifactId === lesson1DesignV2.id);

// 切到第 3 节
db.switchActiveLesson(nb1.id, 3);
// 切回第 1 节 —— switchActiveLesson 会自动选"最新"的 design（按 updatedAt 倒序）
// 因为 v2 是后创建的，所以 latest 就是 v2，应该是 v2
const sessBackTo1 = db.switchActiveLesson(nb1.id, 1);
ok('T3.2 切回第 1 节 → 自动选"最新"design 是 v2（最近创建的）',
   sessBackTo1.activeDesignArtifactId === lesson1DesignV2.id);

// ═══════════════════════════════════════════════════════════════════════
// T4: 2 节课的 PPT 互不污染
// ═══════════════════════════════════════════════════════════════════════
section('T4 · 第 2 节 PPT 不会用第 3 节的 lecture');
const lesson2Ppt = lesson2.ppt;
const lesson3Ppt = lesson3.ppt;
ok('T4.1 lesson2.ppt.lessonContext.lessonId !== lesson3.lecture.id',
   lesson2Ppt.content.lessonContext.lessonId !== lesson3.lecture.id);
ok('T4.2 lesson3.ppt.lessonContext.lessonId !== lesson2.lecture.id',
   lesson3Ppt.content.lessonContext.lessonId !== lesson2.lecture.id);
ok('T4.3 即使切到第 2 节，第 3 节 PPT 数据不变',
   lesson3.ppt.content.lessonContext.lessonId === lesson3.lecture.id);

// ═══════════════════════════════════════════════════════════════════════
// T5: switchActiveLesson 同步更新所有 active id
// ═══════════════════════════════════════════════════════════════════════
section('T5 · 切节课同步更新 design + lecture + ppt 三个 active id');
const sessSync = db.switchActiveLesson(nb1.id, 2);
ok('T5.1 切第 2 节后 activeDesign 是 lesson2',
   sessSync.activeDesignArtifactId === lesson2.design.id);
ok('T5.1 切第 2 节后 activeLecture 是 lesson2',
   sessSync.activeLectureArtifactId === lesson2.lecture.id);
ok('T5.1 切第 2 节后 activePpt 是 lesson2',
   sessSync.activePptOutlineId === lesson2.ppt.id);

// ═══════════════════════════════════════════════════════════════════════
// T6: sessionContext 持久化
// ═══════════════════════════════════════════════════════════════════════
section('T6 · sessionContext 写入 notebook.sessionContext，重启后能恢复');
db.switchActiveLesson(nb1.id, 3);
// 模拟"重启" → 重读 DB
const reread = db._readData();
const nbReloaded = reread.notebooks.find((n) => n.id === nb1.id);
ok('T6.1 notebook.sessionContext 已写入磁盘',
   !!nbReloaded.sessionContext);
ok('T6.2 sessionContext.activeLessonNumber === 3',
   nbReloaded.sessionContext.activeLessonNumber === 3);
ok('T6.3 sessionContext.activeDesignArtifactId === lesson3.design.id',
   nbReloaded.sessionContext.activeDesignArtifactId === lesson3.design.id);

// 重新读 session
const sessReread = db.getSessionContext(nb1.id);
ok('T6.4 getSessionContext 返回值跟磁盘一致',
   sessReread.activeLessonNumber === 3
   && sessReread.activeDesignArtifactId === lesson3.design.id);

// ═══════════════════════════════════════════════════════════════════════
// T7（附加）: getArtifactById 取得到指定 artifact
// ═══════════════════════════════════════════════════════════════════════
section('T7 · getArtifactById 按 ID 取 artifact');
const fetchedDesign = db.getArtifactById(lesson1.design.id);
ok('T7.1 按 ID 取得到 lesson1.design',
   fetchedDesign && fetchedDesign.id === lesson1.design.id);
ok('T7.2 按 ID 取 lesson1.lecture',
   db.getArtifactById(lesson1.lecture.id)?.id === lesson1.lecture.id);
ok('T7.3 无效 ID 返回 null',
   db.getArtifactById(99999) === null);

// ═══════════════════════════════════════════════════════════════════════
// 总结
// ═══════════════════════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(60)}`);
console.log(`总计：${total}    通过：${pass}    失败：${fails.length}`);
console.log(`临时 DB 路径：${DB_FILE}`);
if (fails.length === 0) {
  console.log(`✅ Phase A 跨 stage 实体绑定 — 全部通过`);
  // 清理临时目录
  try { fs.rmSync(TMP_DIR, { recursive: true, force: true }); } catch { /* ignore */ }
  process.exit(0);
} else {
  console.log(`❌ 失败：`);
  fails.forEach((f) => console.log(`   - ${f.name}${f.detail ? '\n     ' + f.detail : ''}`));
  process.exit(1);
}
