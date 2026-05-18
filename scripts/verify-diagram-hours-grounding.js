/**
 * verify-diagram-hours-grounding.js
 *
 * 验证：diagram.service.js 在 userPrompt 中包含真实学时数据
 *       并嵌入"禁止编造学时"硬约束（修复 2026-05-15 老师反馈 4.4）
 *
 * 触发场景：生成"教学设计信息图"，AI 凭空编造总学时（如"72学时"实际课程是 36 学时）
 * 修复内核：把 totalHours/theoryHours/practiceHours 显式注入 userPrompt + prompt 加铁律
 *
 * 用例（计 5 项）：
 *   ① 学时存在时 userPrompt 含"总学时：72"
 *   ② 学时存在时 userPrompt 含"禁止编造"硬约束
 *   ③ 学时为 0/缺时不注入空行（避免噪音）
 *   ④ magazine 路径也注入了学时
 *   ⑤ 缺学时数据时 magazine 路径不写空字段（防"总学时：0"误导）
 */
const path = require('path');
const { generateDiagram } = require(path.resolve(__dirname, '..', 'src/main/services/diagram.service.js'));

function makeMockClient(capture) {
  return {
    async chatJson({ systemPrompt, userPrompt, ...rest }) {
      capture.push({ systemPrompt, userPrompt, rest });
      // 返回一个最小可解析的 magazine JSON 让流程跑通
      return JSON.stringify({
        title: '测试',
        items: [],
      });
    },
  };
}

async function runCases() {
  const cases = [];
  const pass = (name) => { cases.push({ name, ok: true }); console.log(`  ✓ ${name}`); };
  const fail = (name, msg) => { cases.push({ name, ok: false, msg }); console.log(`  ✗ ${name} — ${msg}`); };

  // ── 用例 ① ②：hierarchy 路径，学时齐全 ─────────────────────────────
  {
    const cap = [];
    try {
      await generateDiagram({
        aiClient: makeMockClient(cap),
        modules: [{ name: '模块 1' }],
        courseName: '测试课程',
        diagramType: 'hierarchy',
        outputDir: null,
        courseContext: {
          totalHours: 72,
          theoryHours: 32,
          practiceHours: 36,
          examHours: 4,
        },
      });
    } catch (e) {
      // mock 返回 SVG 时会失败——但 prompt 已经被捕获
    }
    if (cap.length === 0) {
      fail('① hierarchy 学时注入', 'aiClient 未被调用');
    } else {
      const up = cap[0].userPrompt;
      if (up.includes('总学时：72') && up.includes('理论学时：32') && up.includes('实践学时：36')) {
        pass('① hierarchy 学时三项注入正确');
      } else {
        fail('① hierarchy 学时注入', '缺少学时数据 → userPrompt:\n' + up.slice(0, 400));
      }
      if (up.includes('禁止编造') && up.includes('凭空数据')) {
        pass('② hierarchy 反编造硬约束注入');
      } else {
        fail('② hierarchy 反编造硬约束', '缺约束语句');
      }
    }
  }

  // ── 用例 ③：hierarchy 路径，学时全为 0 → 不写学时段 ─────────────────
  {
    const cap = [];
    try {
      await generateDiagram({
        aiClient: makeMockClient(cap),
        modules: [{ name: '模块 1' }],
        courseName: '测试课程',
        diagramType: 'hierarchy',
        outputDir: null,
        courseContext: {},
      });
    } catch (e) {}
    if (cap.length === 0) {
      fail('③ 空学时不注入空段', 'aiClient 未被调用');
    } else {
      const up = cap[0].userPrompt;
      if (!up.includes('## 课程学时')) {
        pass('③ 空学时时不出现"## 课程学时"标题');
      } else {
        fail('③ 空学时不注入空段', '出现了空段标题');
      }
    }
  }

  // ── 用例 ④：magazine 路径，学时注入 ───────────────────────────────
  {
    const cap = [];
    try {
      await generateDiagram({
        aiClient: makeMockClient(cap),
        modules: [{ name: '模块 1' }],
        courseName: '测试课程',
        diagramType: 'magazine',
        outputDir: null,
        courseContext: {
          totalHours: 36,
          theoryHours: 16,
          practiceHours: 18,
          description: '一门测试课',
        },
      });
    } catch (e) {}
    if (cap.length === 0) {
      fail('④ magazine 学时注入', 'aiClient 未被调用');
    } else {
      const up = cap[0].userPrompt;
      if (up.includes('总学时：36') && up.includes('理论学时：16') && up.includes('实践学时：18')) {
        pass('④ magazine 学时三项注入');
      } else {
        fail('④ magazine 学时注入', 'userPrompt 缺学时：\n' + up.slice(0, 400));
      }
    }
  }

  // ── 用例 ⑤：magazine 路径，无学时数据 ─────────────────────────────
  {
    const cap = [];
    try {
      await generateDiagram({
        aiClient: makeMockClient(cap),
        modules: [{ name: '模块 1' }],
        courseName: '测试课程',
        diagramType: 'magazine',
        outputDir: null,
        courseContext: { description: '只有描述' },
      });
    } catch (e) {}
    if (cap.length === 0) {
      fail('⑤ magazine 无学时不污染', 'aiClient 未被调用');
    } else {
      const up = cap[0].userPrompt;
      if (!up.includes('总学时：0') && !up.includes('理论学时：0')) {
        pass('⑤ magazine 无学时数据时不写"总学时：0"');
      } else {
        fail('⑤ magazine 无学时不污染', 'userPrompt 包含 0 学时\n' + up.slice(0, 400));
      }
    }
  }

  // 汇总
  const passed = cases.filter((c) => c.ok).length;
  const total = cases.length;
  console.log(`\n[verify-diagram-hours-grounding] ${passed}/${total} 通过`);
  if (passed < total) {
    console.log('失败用例：', cases.filter((c) => !c.ok).map((c) => c.name).join(' / '));
    process.exit(1);
  }
}

runCases().catch((e) => {
  console.error('[verify] 异常：', e);
  process.exit(1);
});
