/**
 * verify-schedule-alias-import.js
 *
 * 验证：外部 AI 生成的 JSON 字段名兼容映射（修复 2026-05-15 老师视频反馈）
 *
 * 现象：老师把 Word 上传 DeepSeek 转 JSON 再粘到驭课 → 字段名不匹配 → 静默走默认值
 *
 * 测试用例（10 项）：
 *   ① DeepSeek 的 metadata → header
 *   ② DeepSeek 的 teachingMethod → method
 *   ③ DeepSeek 的 homeworkCount → homework
 *   ④ DeepSeek 的 assessmentHours → examHours
 *   ⑤ DeepSeek 的 practicalTrainingCategories → experimentTopics
 *   ⑥ DeepSeek 的 teachingObjectives → objective
 *   ⑦ ChatGPT 的 lessons → schedule
 *   ⑧ 缺 method 字段时给警告
 *   ⑨ 缺 homework 字段时给警告
 *   ⑩ 模拟视频中完整 DeepSeek JSON → 全字段映射 + 后续 normalize 不丢字段
 */
const path = require('path');
const { importWithAliases } = require(path.resolve(__dirname, '..', 'src/main/services/schedule-alias-resolver.js'));
const scheduleSvc = require(path.resolve(__dirname, '..', 'src/main/services/schedule.service.js'));

function runCases() {
  const cases = [];
  const pass = (n) => { cases.push({ n, ok: true }); console.log(`  ✓ ${n}`); };
  const fail = (n, msg) => { cases.push({ n, ok: false, msg }); console.log(`  ✗ ${n} — ${msg}`); };

  // ① metadata → header
  {
    const r = importWithAliases({
      metadata: { course: '测试', school: '广纺', totalHours: 36 },
    });
    if (r.data.header?.courseName === '测试' && r.data.header?.school === '广纺' && r.data.header?.totalHours === 36) {
      pass('① metadata → header + course → courseName 多级映射');
    } else fail('①', JSON.stringify(r.data));
  }

  // ② teachingMethod → method
  {
    const r = importWithAliases({
      schedule: [{ week: 1, content: 'X', teachingMethod: '讨论' }],
    });
    if (r.data.schedule[0].method === '讨论' && !('teachingMethod' in r.data.schedule[0])) {
      pass('② schedule[].teachingMethod → method');
    } else fail('②', JSON.stringify(r.data.schedule[0]));
  }

  // ③ homeworkCount → homework
  {
    const r = importWithAliases({
      schedule: [{ week: 1, content: 'X', homeworkCount: 3 }],
    });
    if (r.data.schedule[0].homework === 3) pass('③ homeworkCount → homework');
    else fail('③', JSON.stringify(r.data.schedule[0]));
  }

  // ④ assessmentHours → examHours
  {
    const r = importWithAliases({
      header: { assessmentHours: 4 },
    });
    if (r.data.header.examHours === 4) pass('④ header.assessmentHours → examHours');
    else fail('④', JSON.stringify(r.data));
  }

  // ⑤ practicalTrainingCategories → experimentTopics
  {
    const r = importWithAliases({
      practicalTrainingCategories: ['T1', 'T2', 'T3'],
    });
    if (Array.isArray(r.data.experimentTopics) && r.data.experimentTopics.length === 3) {
      pass('⑤ practicalTrainingCategories → experimentTopics');
    } else fail('⑤', JSON.stringify(r.data));
  }

  // ⑥ teachingObjectives → objective
  {
    const r = importWithAliases({
      teachingObjectives: '本课程目标 X',
    });
    if (r.data.objective === '本课程目标 X') pass('⑥ teachingObjectives → objective');
    else fail('⑥', JSON.stringify(r.data));
  }

  // ⑦ lessons → schedule
  {
    const r = importWithAliases({
      lessons: [
        { weekNumber: 1, lessonContent: 'A', teachingMethod: '讲授' },
        { weekNumber: 2, lessonContent: 'B', teachingMethod: '案例' },
      ],
    });
    if (Array.isArray(r.data.schedule) && r.data.schedule.length === 2 &&
        r.data.schedule[0].week === 1 && r.data.schedule[0].content === 'A' && r.data.schedule[0].method === '讲授') {
      pass('⑦ ChatGPT 风：lessons + weekNumber + lessonContent + teachingMethod 全套映射');
    } else fail('⑦', JSON.stringify(r.data));
  }

  // ⑧ 缺 method → 警告
  {
    const r = importWithAliases({
      header: { courseName: 'X', totalHours: 36 },
      schedule: [{ week: 1, content: 'A' }],  // 无 method 也无 teachingMethod
    });
    const hasMethodWarn = r.warnings.some((w) => w.includes('method'));
    if (hasMethodWarn) pass('⑧ 缺 method 字段时给警告');
    else fail('⑧', `warnings=${JSON.stringify(r.warnings)}`);
  }

  // ⑨ 缺 homework → 警告
  {
    const r = importWithAliases({
      header: { courseName: 'X', totalHours: 36 },
      schedule: [{ week: 1, content: 'A', method: '讲授' }],  // 有 method 但没 homework
    });
    const hasHomeworkWarn = r.warnings.some((w) => w.includes('homework'));
    if (hasHomeworkWarn) pass('⑨ 缺 homework 字段时给警告');
    else fail('⑨', `warnings=${JSON.stringify(r.warnings)}`);
  }

  // ⑩ 模拟视频里的 DeepSeek 完整 JSON
  {
    const deepseekJson = {
      metadata: {
        school: '广州纺校',
        department: '服装',
        course: '服装产品传播',
        teacher: '刘勤',
        class: '24服装产品传播',
        semester: '2025-2026 学年第二学期',
        textbook: '《服装产品传播》校本教材',
        totalHours: 72,
        theoryHours: 32,
        practiceHours: 32,
        assessmentHours: 4,
      },
      teachingObjectives: '本课程为中职服装类专业必修...',
      practicalTrainingCategories: [
        '案例开发教学法',
        '产品传播实例教学法',
      ],
      schedule: [
        { week: 1, session: 1, chapter: '一', content: '服装传播基本框架与模型详解', hours: 4, teachingMethod: '讲授法', homeworkCount: 0 },
        { week: 2, session: 2, chapter: '一', content: '产品营销策划方案设计', hours: 4, teachingMethod: '案例分析法', homeworkCount: 1 },
      ],
    };
    const r = importWithAliases(deepseekJson);
    // 检查关键字段都映射对了
    const ok =
      r.data.header?.courseName === '服装产品传播' &&
      r.data.header?.examHours === 4 &&
      r.data.objective?.length > 5 &&
      Array.isArray(r.data.experimentTopics) && r.data.experimentTopics.length === 2 &&
      r.data.schedule?.[0]?.method === '讲授法' &&
      r.data.schedule?.[0]?.homework === 0 &&
      r.data.schedule?.[1]?.method === '案例分析法' &&
      r.data.schedule?.[1]?.homework === 1;
    if (ok && r.aliasesUsed.length >= 5) {
      pass(`⑩ 视频里 DeepSeek 完整 JSON → 全字段映射（共 ${r.aliasesUsed.length} 项 alias 命中）`);
    } else {
      fail('⑩', `映射结果=${JSON.stringify({
        courseName: r.data.header?.courseName,
        examHours: r.data.header?.examHours,
        method: r.data.schedule?.[0]?.method,
        homework: r.data.schedule?.[0]?.homework,
        aliasCount: r.aliasesUsed.length,
      })}`);
    }
  }

  // ⑪（额外）兼容 + normalize 联动：normalize 接收 alias 映射后的对象不丢字段
  {
    const result = scheduleSvc.normalizeFromUserEdit({
      metadata: { course: '联动测试', totalHours: 8 },
      teachingObjectives: '目标',
      schedule: [
        { week: 1, content: 'A', hours: 4, teachingMethod: '讲授', homeworkCount: 0 },
        { week: 2, content: 'B', hours: 4, teachingMethod: '案例', homeworkCount: 1 },
      ],
    }, { totalHours: 8, teacher: '老李' });
    const ok =
      result.header.courseName === '联动测试' &&
      result.header.totalHours === 8 &&
      result.objective === '目标' &&
      result.schedule[0].method === '讲授' &&
      result.schedule[1].homework === 1 &&
      result._importAudit && result._importAudit.aliasesUsed.length >= 4;
    if (ok) pass('⑪ alias 映射 + normalize 联动：全字段正确，留 _importAudit');
    else fail('⑪', JSON.stringify({
      courseName: result.header.courseName,
      method: result.schedule?.[0]?.method,
      audit: result._importAudit,
    }));
  }

  const passed = cases.filter((c) => c.ok).length;
  console.log(`\n[verify-schedule-alias-import] ${passed}/${cases.length} 通过`);
  if (passed < cases.length) {
    console.log('失败：', cases.filter((c) => !c.ok).map((c) => c.n).join(' / '));
    process.exit(1);
  }
}

runCases();
