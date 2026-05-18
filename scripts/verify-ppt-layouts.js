/**
 * verify-ppt-layouts.js — 2026-05-16 v4.1.4 Phase 2
 *
 * 验证 AI 自主 layout 体系：
 *   1. 7 个 layout 函数能独立调用（不抛错）
 *   2. dispatchLayout 按 layoutType 正确分发
 *   3. 未知 layoutType 回落到 bullet-list
 *   4. ppt-pipeline-v2 的 defaultLayoutTypeFor 决策正确
 *   5. inferMainAccentColor 按课程性质命中
 *   6. accentColor / themeMode 兜底逻辑
 *   7. ppt.js export 能加载 ppt-layouts 且 addLectureSlides 接收新参数
 */

const PptxGenJS = require('pptxgenjs');
const {
  dispatchLayout,
  renderHeroLayout,
  renderTwoColumnLayout,
  renderImageBleedLayout,
  renderDiagramCenterLayout,
  renderQuoteLayout,
  renderTableLayout,
  renderBulletListLayout,
  pickThemeColors,
  pickAccent,
  normHex,
  LAYOUT_RENDERERS,
} = require('../src/main/export/ppt-layouts');

const {
  inferMainAccentColor,
  defaultLayoutTypeFor,
  defaultThemeModeFor,
  VALID_LAYOUT_TYPES,
} = require('../src/main/script/ppt-pipeline-v2');

let total = 0, pass = 0;
const fails = [];

function ok(name, cond) {
  total++;
  if (cond) {
    pass++;
    console.log(`  ✓ ${name}`);
  } else {
    fails.push(name);
    console.log(`  ✗ ${name}`);
  }
}

function newSlide() {
  const pptx = new PptxGenJS();
  pptx.layout = 'LAYOUT_WIDE';
  return { pptx, slide: pptx.addSlide() };
}

function fakePage(layoutType, overrides = {}) {
  return {
    pageNumber: 1,
    pageType: '知识讲解',
    title: '本页标题',
    subtitle: '副标题示例',
    keyContent: ['要点 1：xxx', '要点 2：yyy', '要点 3：zzz', '要点 4：aaa'],
    speakerNotes: '老师讲解参考',
    dataPoint: 'GMV 增长 35%',
    caseExample: '中山光电产业 ABC 案例',
    interactionPrompt: '请同学们思考一下',
    imagePrompt: '光学产业实操场景特写',
    needImage: true,
    sourceSection: '模块 1',
    layoutType,
    accentColor: '',
    themeMode: 'light',
    ...overrides,
  };
}

function ctx() {
  return { mainAccent: '2E86DE', pageNumber: 1, totalPages: 10 };
}

console.log('\n━━━ ① 7 个 layout 渲染器能独立调用（不抛错）━━━');
['hero', 'two-column', 'image-bleed', 'diagram-center', 'quote', 'table', 'bullet-list'].forEach((lt) => {
  const { slide } = newSlide();
  let threw = false;
  try { dispatchLayout(slide, fakePage(lt), ctx()); } catch (e) { threw = true; }
  ok(`layout '${lt}' 渲染不抛错`, !threw);
});

console.log('\n━━━ ② dispatchLayout 按 layoutType 正确分发 ━━━');
{
  const { slide } = newSlide();
  const r = dispatchLayout(slide, fakePage('hero'), ctx());
  ok('hero 命中 hero', r.ok && r.used === 'hero');
}
{
  const { slide } = newSlide();
  const r = dispatchLayout(slide, fakePage('two-column'), ctx());
  ok('two-column 命中', r.ok && r.used === 'two-column');
}

console.log('\n━━━ ③ 未知 layoutType 回落到 bullet-list ━━━');
{
  const { slide } = newSlide();
  const r = dispatchLayout(slide, fakePage('nonsense-layout'), ctx());
  ok('未知 layout 回落 bullet-list', r.ok && r.used === 'bullet-list');
}
{
  const { slide } = newSlide();
  const r = dispatchLayout(slide, fakePage(''), ctx());
  ok('空 layoutType 回落 bullet-list', r.ok && r.used === 'bullet-list');
}

console.log('\n━━━ ④ defaultLayoutTypeFor 决策表 ━━━');
ok('封面 → hero', defaultLayoutTypeFor('封面', 0) === 'hero');
ok('谢谢 → hero', defaultLayoutTypeFor('谢谢', 0) === 'hero');
ok('总结收束 → hero', defaultLayoutTypeFor('总结收束', 0) === 'hero');
ok('课程导入 → image-bleed', defaultLayoutTypeFor('课程导入', 0) === 'image-bleed');
ok('模块导入 → image-bleed', defaultLayoutTypeFor('模块导入', 0) === 'image-bleed');
ok('路线图 → diagram-center', defaultLayoutTypeFor('路线图', 0) === 'diagram-center');
ok('操作步骤 → diagram-center', defaultLayoutTypeFor('操作步骤', 0) === 'diagram-center');
ok('验收标准 → table', defaultLayoutTypeFor('验收标准', 0) === 'table');
ok('课堂练习 → quote', defaultLayoutTypeFor('课堂练习', 0) === 'quote');
ok('知识讲解 + 4 条 → two-column', defaultLayoutTypeFor('知识讲解', 4) === 'two-column');
ok('知识讲解 + 5 条 → bullet-list', defaultLayoutTypeFor('知识讲解', 5) === 'bullet-list');
ok('案例展示 + 2 条 → two-column', defaultLayoutTypeFor('案例展示', 2) === 'two-column');
ok('未知 pageType → bullet-list', defaultLayoutTypeFor('其它', 0) === 'bullet-list');

console.log('\n━━━ ⑤ inferMainAccentColor 行业命中 ━━━');
ok('光电产业 → 科技蓝 2563EB',
   inferMainAccentColor({ courseName: '中山光电产业', courseContext: {} }) === '#2563EB');
ok('服装陈列 → 时尚粉 E91E8C',
   inferMainAccentColor({ courseName: '服装陈列设计', courseContext: {} }) === '#E91E8C');
ok('中医药 → 中国红 C8102E',
   inferMainAccentColor({ courseName: '中医药基础', courseContext: {} }) === '#C8102E');
ok('Web 编程 → 极客紫 6B21A8',
   inferMainAccentColor({ courseName: 'Web 前端编程', courseContext: {} }) === '#6B21A8');
ok('护理学 → 健康绿 10B981',
   inferMainAccentColor({ courseName: '护理基础', courseContext: {} }) === '#10B981');
ok('普通课 → 深海蓝 2E86DE (兜底)',
   inferMainAccentColor({ courseName: '随便什么课', courseContext: {} }) === '#2E86DE');

console.log('\n━━━ ⑥ defaultThemeModeFor 决策 ━━━');
ok('封面 → dark', defaultThemeModeFor('封面', 'hero') === 'dark');
ok('谢谢 → dark', defaultThemeModeFor('谢谢', 'hero') === 'dark');
ok('总结收束 → dark', defaultThemeModeFor('总结收束', 'hero') === 'dark');
ok('课程导入 → dark', defaultThemeModeFor('课程导入', 'image-bleed') === 'dark');
ok('知识讲解 → light', defaultThemeModeFor('知识讲解', 'two-column') === 'light');
ok('操作步骤 → light', defaultThemeModeFor('操作步骤', 'diagram-center') === 'light');
ok('image-bleed layout 强制 dark', defaultThemeModeFor('模块导入', 'image-bleed') === 'dark');

console.log('\n━━━ ⑦ pickAccent / pickThemeColors ━━━');
ok('page.accentColor 优先', pickAccent({ accentColor: '#FF0000' }, '2E86DE') === 'FF0000');
ok('page.accentColor 空 → 用 mainAccent',
   pickAccent({ accentColor: '' }, '2E86DE') === '2E86DE');
ok('非法 hex 回落到 mainAccent',
   pickAccent({ accentColor: 'rgb(0,0,0)' }, '2E86DE') === '2E86DE');
{
  const t = pickThemeColors({ themeMode: 'dark' }, '2E86DE');
  ok('dark theme bg 是深色', t.bg === '0F172A' && t.fg === 'F8FAFC');
}
{
  const t = pickThemeColors({ themeMode: 'light' }, '2E86DE');
  ok('light theme bg 是浅色', t.bg === 'F8FAFC' && t.fg === '0F172A');
}

console.log('\n━━━ ⑧ normHex 工具 ━━━');
ok('带 # 6位 hex', normHex('#FF8800') === 'FF8800');
ok('不带 # 6位 hex', normHex('FF8800') === 'FF8800');
ok('小写转大写', normHex('ff8800') === 'FF8800');
ok('非法回落', normHex('xxx', 'AABBCC') === 'AABBCC');
ok('空回落', normHex('', 'AABBCC') === 'AABBCC');

console.log('\n━━━ ⑨ ppt.js 能加载 ppt-layouts ━━━');
{
  let threw = false;
  try { require('../src/main/export/ppt.js'); } catch (e) { threw = true; console.error(e.message); }
  ok('ppt.js require 不抛错', !threw);
}

console.log('\n━━━ ⑩ pipeline V2 完整字段输出（mock AI）━━━');
{
  const { generatePptPlanV2 } = require('../src/main/script/ppt-pipeline-v2');
  const mockAi = {
    async chatJson({ systemPrompt, userPrompt }) {
      // outline 阶段：system prompt 是 ppt-outline.md（含"PPT 页面大纲生成器"）
      // detail 阶段：system prompt 是 ppt-page-detail.md（含"PPT 单页详情生成器"）
      const sys = String(systemPrompt || '');
      if (sys.includes('PPT 页面大纲生成器') || sys.includes('大纲生成器')) {
        return JSON.stringify({
          pages: [
            { pageType: '封面', title: '本节封面', sourceSection: '开场' },
            { pageType: '知识讲解', title: '核心要点', sourceSection: '模块 1' },
            { pageType: '谢谢', title: 'Thank you', sourceSection: '收尾' },
          ],
        });
      }
      // page detail
      return JSON.stringify({
        subtitle: '副标题',
        keyContent: ['要点 1', '要点 2'],
        speakerNotes: '老师讲解',
        dataPoint: '',
        caseExample: '',
        interactionPrompt: '',
        imagePrompt: '相关场景图',
        needImage: true,
        layoutType: 'two-column',
        accentColor: '',
        themeMode: 'light',
      });
    },
  };
  let pages = [];
  (async () => {
    const r = await generatePptPlanV2({
      lectureScript: '【开场】hello\n【模块 1】内容\n【收尾】bye',
      courseName: '中山光电',
      totalHours: 2,
      modules: [],
      aiClient: mockAi,
      skipDynamicExercise: true,
    });
    pages = r.pages;
    ok('pipeline 返回 pages 数组', Array.isArray(pages) && pages.length >= 1);
    ok('pipeline 返回 mainAccentColor', /^#[0-9A-F]{6}$/i.test(r.mainAccentColor || ''));
    ok('每页都有 layoutType', pages.every((p) => VALID_LAYOUT_TYPES.has(p.layoutType)));
    ok('每页都有 themeMode', pages.every((p) => ['light', 'dark'].includes(p.themeMode)));
    ok('每页都有 accentColor 字段（可为空）',
       pages.every((p) => typeof p.accentColor === 'string'));

    // 总结
    console.log(`\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`);
    console.log(`总计：${total}    通过：${pass}    失败：${fails.length}`);
    if (fails.length) {
      console.log(`❌ 失败：`);
      fails.forEach((n) => console.log(`   - ${n}`));
      process.exit(1);
    } else {
      console.log(`✅ 全部通过`);
    }
  })().catch((e) => {
    console.error('pipeline 测试异常：', e);
    process.exit(2);
  });
}
