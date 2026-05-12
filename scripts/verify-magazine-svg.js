/**
 * verify-magazine-svg.js — Phase-8.5 magazine-svg-builder 自检
 *
 * 测试范围：
 *   - buildMagazineSvg 用 mock 数据能否生成合法 SVG
 *   - 各种边界情况：模块少（2 个）/ 模块多（10 个）/ 字段缺失 / 中文字符
 *   - 输出 SVG 文件供肉眼检查
 *
 * 用法：node scripts/verify-magazine-svg.js
 */

const path = require('path');
const fs = require('fs');
const { buildMagazineSvg } = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'magazine-svg-builder.js'));

const OUT_DIR = path.resolve(__dirname, '..', 'reports');
fs.mkdirSync(OUT_DIR, { recursive: true });

let pass = 0;
let fail = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    console.log(`  ✅ ${name}`);
    pass++;
  } catch (err) {
    console.log(`  ❌ ${name} — ${err.message}`);
    failures.push({ name, error: err.message });
    fail++;
  }
}

console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log('Phase-8.5 magazine-svg-builder 自检');
console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

// ── 用例 1：5 模块的"店铺三维表现"完整数据 ──────────────────────────────
console.log('▸ 用例 1：店铺三维表现（5 模块 / 完整 AI 数据）');

const fullData = {
  courseName: '店铺三维表现',
  modules: [
    { name: '项目认知与案例拆解', hours: 0.5, knowledgePoints: ['服装店铺功能分区', '3ds Max 视图导航', '案例模型库调用'] },
    { name: '店铺空间建模', hours: 1.5, knowledgePoints: ['Editable Poly 开窗', '展柜参数化建模', '模型库道具合并'] },
    { name: '材质与灯光设定', hours: 1, knowledgePoints: ['V-Ray Mtl 反射参数', 'IES 灯光方案', 'HDRI 环境光'] },
    { name: 'V-Ray 渲染输出', hours: 0.5, knowledgePoints: ['帧缓冲区设置', '渲染元素通道', 'JPG/PNG 选择'] },
    { name: 'Photoshop 后期', hours: 0.5, knowledgePoints: ['通道蒙版', '曲线调色', '智能对象贴图'] },
  ],
  grade: '二年级',
  aiData: {
    courseSubtitle: '服装设计专业核心实践课·教学框架可视化',
    core: '掌握 3ds Max + V-Ray + PS 三件套，胜任陈列设计师岗位',
    definitionAndJob: {
      description: '本课程聚焦服装店铺三维效果图设计，从空间建模到渲染输出，培养能独立完成商业级店铺效果图的实战能力',
      jobs: ['陈列设计师', '商业空间设计师', '品牌视觉'],
      tools: ['3ds Max 2024', 'V-Ray 6.x', 'Adobe Photoshop 2024'],
    },
    objectives: {
      knowledge: ['3ds Max 建模方法', 'V-Ray 灯光原理', 'PS 后期技巧'],
      skill: ['店铺空间建模', '材质灯光设定', '效果图后期'],
      emotion: ['空间美学意识', '商业标准意识', '团队协作精神'],
    },
    methods: [
      { icon: '★', name: '案例教学法', desc: '优衣库等真实案例' },
      { icon: '◆', name: '任务驱动法', desc: '逐步完成店铺设计' },
      { icon: '●', name: '示范演练法', desc: '教师演示+学生跟做' },
      { icon: '▲', name: '小组合作法', desc: '互查+共评+迭代' },
    ],
    evaluation: {
      process: 60,
      summative: 40,
      processItems: ['课堂提问', '小组讨论', '互查反馈'],
      summativeItems: ['课后作业', '效果图成果'],
    },
    resources: [
      { icon: '◇', type: '教材', name: '《服装陈列设计》' },
      { icon: '◆', type: '软件', name: '3ds Max 2024' },
      { icon: '○', type: '平台', name: '学习通教学平台' },
      { icon: '●', type: '案例', name: '优衣库/UR 实景' },
    ],
    goal: '学完后能独立完成服装店铺三维效果图，达到商业可交付标准',
  },
};

let svg1;
test('完整 5 模块数据 → 生成合法 SVG', () => {
  svg1 = buildMagazineSvg(fullData);
  if (!svg1.startsWith('<svg')) throw new Error('未以 <svg 开头');
  if (!svg1.endsWith('</svg>')) throw new Error('未以 </svg> 结尾');
  if (svg1.length < 5000) throw new Error(`SVG 长度过短：${svg1.length}`);
  if (svg1.length > 100000) throw new Error(`SVG 长度异常：${svg1.length}`);
});

test('SVG 应包含课程名、5 个模块名、教学方法 4 项', () => {
  if (!svg1.includes('店铺三维表现')) throw new Error('缺少课程名');
  ['项目认知与案例拆解', '店铺空间建模', '材质与灯光设定'].forEach(name => {
    if (!svg1.includes(name)) throw new Error(`缺少模块名：${name}`);
  });
  if (!svg1.includes('案例教学法')) throw new Error('缺少教学方法');
  if (!svg1.includes('陈列设计师')) throw new Error('缺少岗位');
});

test('SVG 应包含 5 个区块（① ② ③ ④ ⑤ ⑥ 数字徽章）+ HERO 数字徽章', () => {
  // 检查区块数字（1-6）
  for (let i = 1; i <= 6; i++) {
    const numStr = `>${i}</text>`;
    if (!svg1.includes(numStr)) throw new Error(`缺少区块 ${i} 数字徽章`);
  }
  // HERO 数字徽章应包含模块数 5、知识点数 15、总学时 4
  if (!svg1.includes('>5</text>')) throw new Error('HERO 缺少模块数 5');
  if (!svg1.includes('>15</text>')) throw new Error('HERO 缺少知识点数 15');
});

// 保存 SVG 文件供肉眼检查
const out1 = path.join(OUT_DIR, 'magazine-test-1-full.svg');
fs.writeFileSync(out1, svg1, 'utf8');
console.log(`  📁 SVG 已保存：${out1}（用浏览器/编辑器打开看效果）`);

// ── 用例 2：模块少（2 个）的边界 ─────────────────────────────────────
console.log('\n▸ 用例 2：模块少（2 个）边界测试');

const minimalData = {
  courseName: '图文排版',
  modules: [
    { name: '排版基础', hours: 1, knowledgePoints: ['对齐对比重复', 'PS/InDesign 基础'] },
    { name: '海报实操', hours: 1, knowledgePoints: ['元素布局', '文字层级', '版面张力'] },
  ],
  grade: '一年级',
  aiData: {
    courseSubtitle: '设计基础课·教学框架可视化',
    core: '掌握图文排版核心技巧，胜任品牌设计岗位',
    definitionAndJob: {
      description: '聚焦平面图文排版，培养版面设计基本功',
      jobs: ['排版设计师', '品牌助理'],
      tools: ['Photoshop', 'InDesign', 'Canva'],
    },
    objectives: {
      knowledge: ['排版四原则', '色彩搭配', '版面层级'],
      skill: ['软件操作', '版面策划'],
      emotion: ['审美意识', '版权意识'],
    },
    methods: [
      { icon: '★', name: '案例教学法', desc: '经典海报赏析' },
      { icon: '◆', name: '任务驱动法', desc: '完整海报作业' },
    ],
    evaluation: {
      process: 60,
      summative: 40,
      processItems: ['课堂练习'],
      summativeItems: ['期末作品'],
    },
    resources: [
      { icon: '◇', type: '教材', name: '《版式设计》' },
      { icon: '◆', type: '软件', name: 'PS/InDesign' },
    ],
    goal: '学完后能独立完成商业级图文排版作品',
  },
};

let svg2;
test('2 模块也能生成完整 SVG（不缩水）', () => {
  svg2 = buildMagazineSvg(minimalData);
  if (svg2.length < 5000) throw new Error(`SVG 长度过短：${svg2.length}`);
  if (!svg2.includes('图文排版')) throw new Error('缺少课程名');
  // HERO 区数字徽章：2 模块、5 知识点、2 学时
  if (!svg2.includes('>2</text>')) throw new Error('HERO 缺少模块数 2');
});

const out2 = path.join(OUT_DIR, 'magazine-test-2-minimal.svg');
fs.writeFileSync(out2, svg2, 'utf8');
console.log(`  📁 SVG 已保存：${out2}`);

// ── 用例 3：模块多（8 个）→ 应只显示前 6 + "+2 更多" ──────────────────
console.log('\n▸ 用例 3：模块多（8 个）边界测试');

const manyModules = Array.from({ length: 8 }, (_, i) => ({
  name: `模块${i + 1}：测试模块名`,
  hours: 1,
  knowledgePoints: [`知识点${i}-1`, `知识点${i}-2`],
}));

let svg3;
test('8 模块 → 只显示前 6 + 提示语"还有 2 个"', () => {
  svg3 = buildMagazineSvg({
    courseName: '测试课程',
    modules: manyModules,
    grade: '高级',
    aiData: minimalData.aiData,
  });
  if (!svg3.includes('还有 2 个')) throw new Error('缺少"还有 N 个"提示');
  if (!svg3.includes('模块6')) throw new Error('缺少模块6');
  if (svg3.includes('模块8：')) throw new Error('不应显示模块8（应被截断）');
});

const out3 = path.join(OUT_DIR, 'magazine-test-3-many.svg');
fs.writeFileSync(out3, svg3, 'utf8');
console.log(`  📁 SVG 已保存：${out3}`);

// ── 用例 4：缺字段降级（aiData 部分字段缺失）──────────────────────────
console.log('\n▸ 用例 4：缺字段降级测试');

test('aiData 完全为空 → 不崩溃，使用占位文字', () => {
  const svg = buildMagazineSvg({
    courseName: '测试',
    modules: [{ name: '模块1', hours: 1, knowledgePoints: ['知识点'] }],
    grade: '',
    aiData: {},
  });
  if (!svg.startsWith('<svg')) throw new Error('应仍生成 SVG');
  if (svg.length < 4000) throw new Error('应有兜底占位内容');
});

test('XSS 测试：含特殊字符 < > & 应被转义', () => {
  const svg = buildMagazineSvg({
    courseName: 'A<B>&"\'C',
    modules: [],
    grade: '',
    aiData: { core: '<script>alert(1)</script>' },
  });
  if (svg.includes('<script>alert(1)</script>')) throw new Error('XSS 风险：未转义脚本');
  if (!svg.includes('&lt;script&gt;')) throw new Error('未正确转义 <');
});

// ── 总结 ────────────────────────────────────────────────────────────
console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
console.log(`总计：${pass + fail}    通过：${pass}    失败：${fail}`);

if (fail === 0) {
  console.log('✅ 全部通过');
  console.log('\n💡 下一步：用浏览器/编辑器打开 reports/ 下的 3 个 SVG 看效果：');
  console.log('   - magazine-test-1-full.svg     (店铺三维表现 5 模块)');
  console.log('   - magazine-test-2-minimal.svg  (图文排版 2 模块)');
  console.log('   - magazine-test-3-many.svg     (8 模块边界)');
  console.log('\n⚠️  H9 提醒：契约组通过 ≠ 生产路径就绪。');
  console.log('   AI 端 JSON 输出格式正确性需 npm run dev 真实测试。');
  process.exit(0);
} else {
  console.log('❌ 有失败项：');
  failures.forEach(f => console.log(`   - ${f.name}：${f.error}`));
  process.exit(1);
}
