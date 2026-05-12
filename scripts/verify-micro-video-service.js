/**
 * verify-micro-video-service.js — Phase-9 C-3 微课视频整套方案生成器自检
 */

const path = require('path');
const SVC = require(path.resolve(__dirname, '..', 'src', 'main', 'services', 'micro-video.service.js'));
const { parseMicroVideoJson, normalizeMicroVideo, loadPrompt } = SVC._internal;
const { ALLOWED_STYLES, ALLOWED_TYPES, MIN_DURATION, MAX_DURATION } = SVC;

let pass = 0, fail = 0;
const failures = [];

function test(name, fn) {
  return Promise.resolve()
    .then(() => fn())
    .then(() => { console.log(`  ✅ ${name}`); pass++; })
    .catch((err) => { console.log(`  ❌ ${name} — ${err.message}`); failures.push({ name, error: err.message }); fail++; });
}

(async () => {
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('Phase-9 C-3 micro-video.service 自检');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');

  // ── 契约组 1：模块加载 + 常量 ─────────────────────────────────
  console.log('▸ 契约组 1：模块加载 + 常量');

  await test('模块导出完整', () => {
    if (typeof SVC.generate !== 'function') throw new Error('generate 不是函数');
    if (typeof SVC.selfCheck !== 'function') throw new Error('selfCheck 不是函数');
  });

  await test('ALLOWED_STYLES 三选一', () => {
    if (!Array.isArray(ALLOWED_STYLES) || ALLOWED_STYLES.length !== 3) {
      throw new Error(`应 3 项，实际 ${ALLOWED_STYLES?.length}`);
    }
    if (!ALLOWED_STYLES.includes('写实教学风')) throw new Error('缺写实教学风');
  });

  await test('ALLOWED_TYPES 五种镜头类型', () => {
    if (!ALLOWED_TYPES.includes('intro') || !ALLOWED_TYPES.includes('outro')) {
      throw new Error('缺 intro/outro');
    }
  });

  await test('MIN/MAX_DURATION = 60-90 秒', () => {
    if (MIN_DURATION !== 60 || MAX_DURATION !== 90) {
      throw new Error(`MIN=${MIN_DURATION}, MAX=${MAX_DURATION}`);
    }
  });

  await test('selfCheck 10/10 全过', () => {
    const r = SVC.selfCheck();
    if (r.passed !== r.total) {
      const fails = r.checks.filter((c) => !c.pass).map((c) => c.name);
      throw new Error(`仅 ${r.passed}/${r.total}：${fails.join(', ')}`);
    }
  });

  // ── 契约组 2：JSON 解析 ───────────────────────────────────────
  console.log('\n▸ 契约组 2：JSON 解析');

  await test('纯 JSON', () => {
    const r = parseMicroVideoJson('{"foo":"bar"}');
    if (r.foo !== 'bar') throw new Error('解析失败');
  });

  await test('markdown ```json``` 包裹', () => {
    const r = parseMicroVideoJson('```json\n{"foo":"bar"}\n```');
    if (r.foo !== 'bar') throw new Error('未去包裹');
  });

  await test('空字符串抛错', () => {
    let threw = false;
    try { parseMicroVideoJson(''); } catch { threw = true; }
    if (!threw) throw new Error('空字符串应抛错');
  });

  // ── 契约组 3：storyboard / jimengPrompts 数量一致 ────────────────
  console.log('\n▸ 契约组 3：镜头数量一致性');

  await test('storyboard.length === jimengPrompts.length（数量本就相等时不动）', () => {
    const r = normalizeMicroVideo({
      storyboard: [{ shotNumber: 1 }, { shotNumber: 2 }],
      jimengPrompts: [{ shotNumber: 1 }, { shotNumber: 2 }],
    });
    if (r.storyboard.length !== 2 || r.jimengPrompts.length !== 2) throw new Error('数量错');
  });

  await test('jimengPrompts < storyboard → 自动补齐', () => {
    const r = normalizeMicroVideo({
      storyboard: [{ shotNumber: 1 }, { shotNumber: 2 }, { shotNumber: 3 }],
      jimengPrompts: [{ shotNumber: 1 }],
    });
    if (r.jimengPrompts.length !== r.storyboard.length) {
      throw new Error(`未补齐：storyboard=${r.storyboard.length} prompts=${r.jimengPrompts.length}`);
    }
  });

  await test('storyboard 完全缺失 → 至少 1 段兜底', () => {
    const r = normalizeMicroVideo({});
    if (r.storyboard.length < 1) throw new Error('应至少 1 段');
    if (r.jimengPrompts.length < 1) throw new Error('jimengPrompts 也应至少 1 段');
  });

  // ── 契约组 4：style / aspectRatio / type 兜底 ────────────────────
  console.log('\n▸ 契约组 4：风格 / 比例 / 类型枚举');

  await test('非法 style → 默认"写实教学风"', () => {
    const r = normalizeMicroVideo({
      jimengPrompts: [{ shotNumber: 1, style: '油画风' }],
      storyboard: [{ shotNumber: 1 }],
    });
    if (r.jimengPrompts[0].style !== '写实教学风') {
      throw new Error(`实际：${r.jimengPrompts[0].style}`);
    }
  });

  await test('合法 style 三选一保留', () => {
    const r = normalizeMicroVideo({
      jimengPrompts: [{ shotNumber: 1, style: '扁平卡通风' }],
      storyboard: [{ shotNumber: 1 }],
    });
    if (r.jimengPrompts[0].style !== '扁平卡通风') {
      throw new Error(`合法 style 被改：${r.jimengPrompts[0].style}`);
    }
  });

  await test('aspectRatio 默认 9:16', () => {
    const r = normalizeMicroVideo({
      jimengPrompts: [{ shotNumber: 1 }],
      storyboard: [{ shotNumber: 1 }],
    });
    if (r.jimengPrompts[0].aspectRatio !== '9:16') {
      throw new Error(`实际：${r.jimengPrompts[0].aspectRatio}`);
    }
  });

  await test('aspectRatio 16:9 也接受', () => {
    const r = normalizeMicroVideo({
      jimengPrompts: [{ shotNumber: 1, aspectRatio: '16:9' }],
      storyboard: [{ shotNumber: 1 }],
    });
    if (r.jimengPrompts[0].aspectRatio !== '16:9') throw new Error('16:9 应保留');
  });

  await test('非法 aspectRatio → 默认 9:16', () => {
    const r = normalizeMicroVideo({
      jimengPrompts: [{ shotNumber: 1, aspectRatio: '4:3' }],
      storyboard: [{ shotNumber: 1 }],
    });
    if (r.jimengPrompts[0].aspectRatio !== '9:16') throw new Error('应回退到 9:16');
  });

  await test('storyboard.type 五选一兜底', () => {
    const r = normalizeMicroVideo({
      storyboard: [{ shotNumber: 1, type: '不存在的类型' }],
    });
    if (r.storyboard[0].type !== 'content') {
      throw new Error(`实际：${r.storyboard[0].type}`);
    }
  });

  // ── 契约组 5：duration 校验 ────────────────────────────────────
  console.log('\n▸ 契约组 5：时长校验');

  await test('duration 总和 60-90 → durationInRange=true', () => {
    const r = normalizeMicroVideo({
      storyboard: [
        { shotNumber: 1, duration: 30 },
        { shotNumber: 2, duration: 30 },
        { shotNumber: 3, duration: 15 },
      ],
      jimengPrompts: [{ shotNumber: 1 }, { shotNumber: 2 }, { shotNumber: 3 }],
    });
    if (r._stats.durationInRange !== true) throw new Error('应在范围');
    if (r._stats.totalDurationFromShots !== 75) throw new Error(`总时长错：${r._stats.totalDurationFromShots}`);
  });

  await test('duration 总和 < 60 → durationInRange=false', () => {
    const r = normalizeMicroVideo({
      storyboard: [{ shotNumber: 1, duration: 30 }],
      jimengPrompts: [{ shotNumber: 1 }],
    });
    if (r._stats.durationInRange !== false) throw new Error('应超出范围');
  });

  await test('duration 总和 > 90 → durationInRange=false', () => {
    const r = normalizeMicroVideo({
      storyboard: [
        { shotNumber: 1, duration: 60 },
        { shotNumber: 2, duration: 60 },
      ],
      jimengPrompts: [{ shotNumber: 1 }, { shotNumber: 2 }],
    });
    if (r._stats.durationInRange !== false) throw new Error('应超出范围');
  });

  // ── 契约组 6：narrationScript 兜底 ─────────────────────────────
  console.log('\n▸ 契约组 6：旁白脚本');

  await test('完全无 narrationScript → 默认 intro/body/outro 都有', () => {
    const r = normalizeMicroVideo({});
    if (!r.narrationScript.intro?.text) throw new Error('intro 应有兜底');
    if (!r.narrationScript.outro?.text) throw new Error('outro 应有兜底');
    if (r.narrationScript.body.length < 1) throw new Error('body 应至少 1 段');
  });

  await test('body 数组保留多段', () => {
    const r = normalizeMicroVideo({
      narrationScript: {
        body: [
          { section: 'A', narration: 'aa', duration: 15 },
          { section: 'B', narration: 'bb', duration: 15 },
          { section: 'C', narration: 'cc', duration: 15 },
        ],
      },
    });
    if (r.narrationScript.body.length !== 3) throw new Error(`实际 ${r.narrationScript.body.length}`);
  });

  // ── 契约组 7：generate 守卫 + 集成 ─────────────────────────
  console.log('\n▸ 契约组 7：generate 守卫 + 集成');

  await test('aiClient 缺失 → success:false', async () => {
    const r = await SVC.generate({});
    if (r.success !== false) throw new Error('应 success:false');
  });

  await test('courseName 缺失 → success:false', async () => {
    const r = await SVC.generate({ aiClient: { chatJson: async () => '{}' }, courseName: '' });
    if (r.success !== false) throw new Error('应 success:false');
  });

  await test('合法 JSON 集成测试 → success:true 含完整方案', async () => {
    const mockJson = JSON.stringify({
      courseTitle: '服装产品传播',
      videoTopic: '服装海报排版四原则速览',
      duration: 75,
      targetAudience: '中职二年级服装设计学生',
      narrationScript: {
        intro: { text: '看到这张海报你想点开吗？', duration: 12, tone: '提问式' },
        body: [
          { section: '对齐原则', narration: '...', duration: 20 },
          { section: '对比原则', narration: '...', duration: 20 },
        ],
        outro: { text: '动手做一张吧。', duration: 10, callToAction: '打开 PS 跟着做' },
      },
      storyboard: [
        { shotNumber: 1, duration: 12, type: 'intro', visualDescription: '教师拿粗糙海报', cameraAngle: '中景', props: ['海报'], lighting: '柔光', linkedNarration: 'intro' },
        { shotNumber: 2, duration: 20, type: 'content', visualDescription: '屏幕展示对齐对比图', cameraAngle: '特写', props: [], lighting: '柔光', linkedNarration: 'body[0]' },
        { shotNumber: 3, duration: 20, type: 'content', visualDescription: '屏幕展示对比对比图', cameraAngle: '特写', props: [], lighting: '柔光', linkedNarration: 'body[1]' },
        { shotNumber: 4, duration: 13, type: 'outro', visualDescription: '教师对镜头号召', cameraAngle: '中景', props: [], lighting: '柔光', linkedNarration: 'outro' },
      ],
      jimengPrompts: [
        { shotNumber: 1, prompt: '教师持设计粗糙海报，中景，柔光，竖屏 9:16，写实教学风', duration: 12, aspectRatio: '9:16', style: '写实教学风', negativePrompt: '' },
        { shotNumber: 2, prompt: '屏幕展示对齐对比图，特写，9:16，写实教学风', duration: 20, aspectRatio: '9:16', style: '写实教学风', negativePrompt: '' },
        { shotNumber: 3, prompt: '屏幕展示对比对比图，特写，9:16，写实教学风', duration: 20, aspectRatio: '9:16', style: '写实教学风', negativePrompt: '' },
        { shotNumber: 4, prompt: '教师对镜头号召，中景，柔光，9:16，写实教学风', duration: 13, aspectRatio: '9:16', style: '写实教学风', negativePrompt: '' },
      ],
      shootingGuide: {
        equipmentRecommendation: ['iPhone', '三脚架', '领夹麦'],
        location: '实训室白墙背景',
        lightingTips: '顺光为主',
        soundTips: '麦距嘴 15cm',
        presenterTips: '眼神看镜头',
      },
      editingGuide: {
        rhythm: '开头快 → 中稳 → 结尾收',
        transitions: ['横滑', '渐隐'],
        music: { type: '轻快电子', volume: 'BGM -20dB' },
        subtitles: { style: '白底黑字方块', keyPoints: '关键词强调' },
        platforms: ['抖音', '视频号'],
      },
    });
    const r = await SVC.generate({
      aiClient: { chatJson: async () => mockJson },
      courseName: '服装产品传播',
    });
    if (r.success !== true) throw new Error(`应 success:true：${r.error}`);
    if (!r.data?.microVideo) throw new Error('缺 microVideo');
    if (r.data.microVideo.storyboard.length !== r.data.microVideo.jimengPrompts.length) {
      throw new Error('storyboard / prompts 数量不一致');
    }
    if (r.data.microVideo._stats.durationInRange !== true) {
      throw new Error('总时长应在 60-90 秒范围内');
    }
  });

  // ── 总结 ─────────────────────────────────────────────────
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`总计：${pass + fail}    通过：${pass}    失败：${fail}`);

  if (fail === 0) {
    console.log('✅ 全部通过');
    console.log('\n⚠️  H9 提醒：契约组通过 ≠ 端到端就绪');
    console.log('   集成测试需 npm run dev → 端到端走完 schedule/design/lecture/ppt 后');
    console.log('   进入 video 阶段，点"生成微课视频方案"，检查：');
    console.log('     1. 5-6 个镜头是否都有提示词');
    console.log('     2. 总时长是否 60-90 秒');
    console.log('     3. 提示词复制到即梦能否生成可用视频');
    process.exit(0);
  } else {
    console.log('❌ 有失败项：');
    failures.forEach((f) => console.log(`   - ${f.name}：${f.error}`));
    process.exit(1);
  }
})().catch((err) => {
  console.error('💥 自检过程异常：', err);
  process.exit(2);
});
