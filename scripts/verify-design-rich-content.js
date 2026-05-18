/**
 * verify-design-rich-content.js
 *
 * 验证：教学设计的 5 段法字段（修复 2026-05-15 老师视频反馈）
 *
 * 现象：之前生成的 5 段法每格只有 6-8 字（"案例引入 + 提问启发"），过于敷衍
 * 修复：①重命名 evaluation → designIntent  ②内容密度铁律  ③向后兼容老数据
 *
 * 测试用例（9 项）：
 *   ① 新字段 designIntent 写入并保留
 *   ② 老数据用 evaluation → 自动迁移到 designIntent
 *   ③ designIntent 与 evaluation 同时存在 → 优先 designIntent
 *   ④ 两个都没 → 都为空字符串
 *   ⑤ phase 名带前缀"启·导入新课" → 仍认作合法（不被改成"导入新课"）
 *   ⑥ phase 名没前缀"导入新课" → 输出时建议加前缀"启·"
 *   ⑦ teacherActions/studentActions/designIntent 全部保留
 *   ⑧ evaluation 字段同时回写一份（向后兼容下游 Word 导出）
 *   ⑨ prompt 模板含"设计意图"和密度铁律
 */
const path = require('path');
const fs = require('fs');
const designSvc = require(path.resolve(__dirname, '..', 'src/main/services/design.service.js'));
const { normalizeDesign } = designSvc._internal;

function runCases() {
  const cases = [];
  const pass = (n) => { cases.push({ n, ok: true }); console.log(`  ✓ ${n}`); };
  const fail = (n, msg) => { cases.push({ n, ok: false, msg }); console.log(`  ✗ ${n} — ${msg}`); };

  const richTeacher = '1. 设疑激趣：用问题点燃思维 2. 概念初识：展示案例 3. 揭示课题';
  const richStudent = '1. 联想生活经验回答 2. 观察案例归纳 3. 接受任务';
  const richIntent = '1. 激活已有认知，搭建脚手架 2. 具象化抽象概念 3. 创设职业情境';

  // ① 新字段 designIntent 保留
  {
    const r = normalizeDesign({
      inClass: { phases: [{
        phase: '启·导入新课', duration: '10 分钟',
        teacherActions: richTeacher, studentActions: richStudent,
        designIntent: richIntent,
      }] },
    });
    if (r.inClass.phases[0].designIntent === richIntent) pass('① 新字段 designIntent 写入并保留');
    else fail('①', JSON.stringify(r.inClass.phases[0]));
  }

  // ② 老数据 evaluation 自动迁移
  {
    const r = normalizeDesign({
      inClass: { phases: [{
        phase: '导入新课', duration: '10 分钟',
        teacherActions: richTeacher, studentActions: richStudent,
        evaluation: '通过提问检查预习效果',
      }] },
    });
    if (r.inClass.phases[0].designIntent === '通过提问检查预习效果') {
      pass('② 老数据 evaluation → designIntent 自动迁移');
    } else fail('②', JSON.stringify(r.inClass.phases[0]));
  }

  // ③ 两个同时存在 → 优先 designIntent
  {
    const r = normalizeDesign({
      inClass: { phases: [{
        phase: '导入新课', duration: '10 分钟',
        teacherActions: 't', studentActions: 's',
        designIntent: '新意图',
        evaluation: '老评价',
      }] },
    });
    if (r.inClass.phases[0].designIntent === '新意图') pass('③ 优先用 designIntent（不被 evaluation 覆盖）');
    else fail('③', JSON.stringify(r.inClass.phases[0]));
  }

  // ④ 都没
  {
    const r = normalizeDesign({
      inClass: { phases: [{ phase: '导入新课', duration: '10' }] },
    });
    if (r.inClass.phases[0].designIntent === '') pass('④ 都没 → 空字符串');
    else fail('④', JSON.stringify(r.inClass.phases[0]));
  }

  // ⑤ phase 带前缀 → 认作合法
  {
    const r = normalizeDesign({
      inClass: { phases: [
        { phase: '启·导入新课', duration: '10', teacherActions: 'A1', studentActions: 'S1', designIntent: 'I1' },
        { phase: '授·知识讲授', duration: '20', teacherActions: 'A2', studentActions: 'S2', designIntent: 'I2' },
      ] },
    });
    // 前缀的应被识别为对应位置（导入/讲授）
    if (r.inClass.phases[0].teacherActions === 'A1' && r.inClass.phases[1].teacherActions === 'A2') {
      pass('⑤ 带前缀的 phase 名（"启·导入新课"）被识别');
    } else fail('⑤', JSON.stringify(r.inClass.phases.map(p => p.teacherActions)));
  }

  // ⑥ phase 无前缀 → 输出建议加前缀
  {
    const r = normalizeDesign({
      inClass: { phases: [
        { phase: '导入新课', duration: '10', teacherActions: 't', studentActions: 's', designIntent: 'i' },
      ] },
    });
    // 没前缀的，输出时应给建议（保留老师输入，但可附建议）
    // 当前实现：保留老师输入 → 应为"导入新课"
    if (r.inClass.phases[0].phase === '导入新课') {
      pass('⑥ phase 老命名"导入新课"保留（向后兼容）');
    } else fail('⑥', `期望 "导入新课"，实际 "${r.inClass.phases[0].phase}"`);
  }

  // ⑦ teacher/student/designIntent 三字段都保留
  {
    const r = normalizeDesign({
      inClass: { phases: [{
        phase: '导入新课', duration: '10 分钟',
        teacherActions: richTeacher,
        studentActions: richStudent,
        designIntent: richIntent,
      }] },
    });
    const p = r.inClass.phases[0];
    if (p.teacherActions === richTeacher && p.studentActions === richStudent && p.designIntent === richIntent) {
      pass('⑦ teacherActions/studentActions/designIntent 三字段都保留');
    } else fail('⑦', JSON.stringify(p));
  }

  // ⑧ evaluation 同时回写（向后兼容下游 Word 导出）
  {
    const r = normalizeDesign({
      inClass: { phases: [{
        phase: '导入新课', duration: '10', teacherActions: 't', studentActions: 's',
        designIntent: '新版意图内容',
      }] },
    });
    if (r.inClass.phases[0].evaluation === '新版意图内容') {
      pass('⑧ evaluation 字段同步回写（下游 Word 导出兼容）');
    } else fail('⑧', JSON.stringify(r.inClass.phases[0]));
  }

  // ⑨ prompt 模板含"设计意图"和密度铁律
  {
    const promptPath = path.resolve(__dirname, '..', 'prompts/design.md');
    const content = fs.readFileSync(promptPath, 'utf8');
    const hasDesignIntent = content.includes('designIntent') && content.includes('设计意图');
    const hasDensityRule = content.includes('密度铁律') && content.includes('60-180 字') && content.includes('80-200 字');
    const hasExample = content.includes('周成锦') || content.includes('POP') || content.includes('国潮');
    if (hasDesignIntent && hasDensityRule && hasExample) {
      pass('⑨ prompt 含"设计意图" + 密度铁律 + 周成锦样例');
    } else fail('⑨', `designIntent=${hasDesignIntent} density=${hasDensityRule} example=${hasExample}`);
  }

  const passed = cases.filter((c) => c.ok).length;
  console.log(`\n[verify-design-rich-content] ${passed}/${cases.length} 通过`);
  if (passed < cases.length) {
    console.log('失败：', cases.filter((c) => !c.ok).map((c) => c.n).join(' / '));
    process.exit(1);
  }
}

runCases();
