/**
 * micro-video.service.js — 微课视频整套方案生成服务（驭课 Agent v4.0.0 / Phase-9 C-3）
 *
 * 职责：
 *   接收课程上下文 + PPT 大纲，生成微课视频完整方案：
 *     - 旁白脚本（intro/body[]/outro）
 *     - 分镜表（5-6 个镜头）
 *     - 即梦提示词（每镜头独立，9:16 竖屏）
 *     - 拍摄说明（设备/场地/光线/录音）
 *     - 剪辑思路（节奏/转场/音乐/字幕）
 *
 * 与 v3.x 差异：
 *   v3.x 仅 4 段即梦提示词（薄）
 *   v4.0.0 升级为 5 大块完整方案（厚）
 *
 * 关键校验：
 *   - storyboard.length === jimengPrompts.length
 *   - duration 总和 60-90 秒
 *   - aspectRatio 默认 9:16
 *   - style 三选一
 */

const fs = require('fs');
const path = require('path');

const PROMPT_DIR = path.join(__dirname, '../../../prompts');

function loadPrompt(name) {
  return fs.readFileSync(path.join(PROMPT_DIR, `${name}.md`), 'utf8').trim();
}

const ALLOWED_STYLES = ['写实教学风', '扁平卡通风', '国风简约'];
const ALLOWED_TYPES = ['intro', 'content', 'demo', 'closeup', 'outro'];
const MIN_DURATION = 60;
const MAX_DURATION = 90;

// ── JSON 解析 ───────────────────────────────────────────────────────────

function parseMicroVideoJson(rawText) {
  if (!rawText) throw new Error('AI 返回内容为空');
  const trimmed = String(rawText).trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : trimmed;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start < 0 || end < start) throw new Error('AI 未返回合法 JSON 对象');
  try {
    return JSON.parse(candidate.slice(start, end + 1));
  } catch (e) {
    throw new Error(`JSON 解析失败：${e.message}`);
  }
}

// ── 数据规整 + 兜底 ──────────────────────────────────────────────────────

function normalizeMicroVideo(parsed, ctx = {}) {
  const safe = parsed || {};

  // ── narrationScript ──
  const ns = safe.narrationScript || {};
  const narrationScript = {
    intro: {
      text: String(ns.intro?.text || '本微课带你快速掌握核心要点。').trim(),
      duration: Number(ns.intro?.duration) || 10,
      tone: String(ns.intro?.tone || '提问式').trim(),
    },
    body: Array.isArray(ns.body)
      ? ns.body
          .filter((b) => b && (b.narration || b.section))
          .map((b, i) => ({
            section: String(b.section || `知识点 ${i + 1}`).trim(),
            narration: String(b.narration || '').trim(),
            duration: Number(b.duration) || 15,
          }))
          .slice(0, 5)
      : [],
    outro: {
      text: String(ns.outro?.text || '欢迎留言交流。').trim(),
      duration: Number(ns.outro?.duration) || 10,
      callToAction: String(ns.outro?.callToAction || '动手实践一下').trim(),
    },
  };

  // 至少一个 body 段
  if (narrationScript.body.length === 0) {
    narrationScript.body.push({
      section: '核心知识',
      narration: '请补充本节核心讲解。',
      duration: 30,
    });
  }

  // ── storyboard 5-6 个镜头 ──
  let storyboard = Array.isArray(safe.storyboard) ? safe.storyboard : [];
  storyboard = storyboard
    .filter((s) => s && s.shotNumber)
    .map((s, i) => ({
      shotNumber: Number(s.shotNumber) || i + 1,
      duration: Number(s.duration) || 15,
      type: ALLOWED_TYPES.includes(s.type) ? s.type : 'content',
      visualDescription: String(s.visualDescription || '').trim(),
      cameraAngle: String(s.cameraAngle || '中景').trim(),
      props: Array.isArray(s.props) ? s.props.filter(Boolean).map(String) : [],
      lighting: String(s.lighting || '柔光').trim(),
      linkedNarration: String(s.linkedNarration || '').trim(),
    }))
    .sort((a, b) => a.shotNumber - b.shotNumber);

  // ── jimengPrompts —— 必须与 storyboard 一一对应 ──
  let jimengPrompts = Array.isArray(safe.jimengPrompts) ? safe.jimengPrompts : [];
  jimengPrompts = jimengPrompts
    .filter((p) => p && p.shotNumber)
    .map((p, i) => ({
      shotNumber: Number(p.shotNumber) || i + 1,
      prompt: String(p.prompt || '').trim(),
      duration: Number(p.duration) || 15,
      aspectRatio: ['9:16', '16:9', '1:1'].includes(p.aspectRatio) ? p.aspectRatio : '9:16',
      style: ALLOWED_STYLES.includes(p.style) ? p.style : '写实教学风',
      negativePrompt: String(p.negativePrompt || '').trim(),
    }))
    .sort((a, b) => a.shotNumber - b.shotNumber);

  // 强校验：storyboard.length 必须等于 jimengPrompts.length
  if (storyboard.length === 0) {
    storyboard = [
      { shotNumber: 1, duration: 60, type: 'content', visualDescription: '主讲教师对镜头讲述', cameraAngle: '中景', props: [], lighting: '柔光', linkedNarration: 'body[0]' },
    ];
  }
  if (jimengPrompts.length === 0) {
    jimengPrompts = storyboard.map((s) => ({
      shotNumber: s.shotNumber,
      prompt: `${s.visualDescription}，${s.cameraAngle}，${s.lighting}，竖屏 9:16 教学风`,
      duration: s.duration,
      aspectRatio: '9:16',
      style: '写实教学风',
      negativePrompt: '',
    }));
  }

  // 数量不一致时按 storyboard 为准补齐 jimengPrompts
  if (jimengPrompts.length < storyboard.length) {
    const existingShotNums = new Set(jimengPrompts.map((p) => p.shotNumber));
    storyboard.forEach((s) => {
      if (!existingShotNums.has(s.shotNumber)) {
        jimengPrompts.push({
          shotNumber: s.shotNumber,
          prompt: `${s.visualDescription}，${s.cameraAngle}，${s.lighting}，竖屏 9:16`,
          duration: s.duration,
          aspectRatio: '9:16',
          style: '写实教学风',
          negativePrompt: '',
        });
      }
    });
    jimengPrompts.sort((a, b) => a.shotNumber - b.shotNumber);
  }

  // ── shootingGuide ──
  const sg = safe.shootingGuide || {};
  const shootingGuide = {
    equipmentRecommendation: Array.isArray(sg.equipmentRecommendation) && sg.equipmentRecommendation.length > 0
      ? sg.equipmentRecommendation.filter(Boolean).map(String).slice(0, 6)
      : ['手机（iPhone 13+ 或类似）', '三脚架 + 手机夹', '领夹麦克风'],
    location: String(sg.location || '实训室白墙背景').trim(),
    lightingTips: String(sg.lightingTips || '顺光为主，避免逆光').trim(),
    soundTips: String(sg.soundTips || '使用领夹麦，距离嘴 15cm').trim(),
    presenterTips: String(sg.presenterTips || '眼神看镜头，自然停顿').trim(),
  };

  // ── editingGuide ──
  const eg = safe.editingGuide || {};
  const editingGuide = {
    rhythm: String(eg.rhythm || '开头快 → 中间稳 → 结尾收').trim(),
    transitions: Array.isArray(eg.transitions) ? eg.transitions.filter(Boolean).map(String).slice(0, 5) : ['横向滑动', '渐隐切换'],
    music: {
      type: String(eg.music?.type || '轻快电子').trim(),
      volume: String(eg.music?.volume || '人声前置，BGM -20dB').trim(),
    },
    subtitles: {
      style: String(eg.subtitles?.style || '白底黑字方块字幕，置于画面下 1/4').trim(),
      keyPoints: String(eg.subtitles?.keyPoints || '关键名词强调出现').trim(),
    },
    platforms: Array.isArray(eg.platforms) ? eg.platforms.filter(Boolean).map(String) : ['抖音', '视频号', '学习通'],
  };

  // ── 计算总时长 + 校验 ──
  const totalDurationFromShots = storyboard.reduce((s, sh) => s + sh.duration, 0);
  const declaredDuration = Number(safe.duration) || totalDurationFromShots;

  return {
    courseTitle: String(safe.courseTitle || ctx.courseName || '微课').trim(),
    videoTopic: String(safe.videoTopic || '本节核心要点').trim(),
    duration: declaredDuration,
    targetAudience: String(safe.targetAudience || ctx.audience || '中职学生').trim(),
    narrationScript,
    storyboard,
    jimengPrompts,
    shootingGuide,
    editingGuide,
    _stats: {
      shotCount: storyboard.length,
      promptCount: jimengPrompts.length,
      totalDurationFromShots,
      durationInRange: totalDurationFromShots >= MIN_DURATION && totalDurationFromShots <= MAX_DURATION,
      shotPromptMatch: storyboard.length === jimengPrompts.length,
      generatedAt: new Date().toISOString(),
    },
  };
}

// ── 主入口：生成 ────────────────────────────────────────────────────────

/**
 * 生成微课视频整套方案
 *
 * @param {Object} params
 * @param {Object} params.aiClient
 * @param {string} params.courseName
 * @param {string} [params.videoTopic] - 本微课主题（如"服装海报排版四原则速览"）
 * @param {Object} [params.pptOutline] - 上游 PPT 大纲（用于让 AI 知道讲什么）
 * @param {Object} [params.courseContext]
 * @returns {Promise<{ success: boolean, data?: { microVideo: Object, raw: string }, error?: string }>}
 */
async function generate({ aiClient, courseName, videoTopic = '', pptOutline = null, courseContext = {} }) {
  if (!aiClient || typeof aiClient.chatJson !== 'function') {
    return { success: false, error: '未提供有效的 AI 客户端' };
  }
  if (!courseName) {
    return { success: false, error: '课程名（courseName）不能为空' };
  }

  const systemPrompt = loadPrompt('micro-video');

  // 上游 PPT 大纲（若有）
  let pptHint = '';
  if (pptOutline && Array.isArray(pptOutline.pptPages)) {
    const titles = pptOutline.pptPages
      .slice(0, 8)
      .map((p, i) => `${i + 1}. ${p.title || '页面'}`)
      .join('\n');
    pptHint = ['## 上游 PPT 大纲', titles].join('\n');
  }

  const ctxLines = [
    `课程名称：${courseName}`,
    videoTopic ? `本微课主题：${videoTopic}` : '',
    courseContext.softwareTools ? `软件工具：${courseContext.softwareTools}` : '',
    courseContext.jobTargets ? `面向岗位：${courseContext.jobTargets}` : '',
    courseContext.audience ? `授课对象：${courseContext.audience}` : '',
    courseContext.industryScenarios ? `行业场景：${courseContext.industryScenarios}` : '',
  ].filter(Boolean);

  const userPrompt = [
    '## 课程基础信息',
    ctxLines.join('\n'),
    '',
    pptHint,
    '',
    '## 任务',
    '基于以上信息，生成 60-90 秒微课视频完整方案 JSON。',
    '严格遵守：',
    '- storyboard 5-6 个镜头，duration 总和 60-90 秒',
    '- jimengPrompts 与 storyboard 一一对应（数量相等）',
    '- aspectRatio 默认 9:16',
    '- style 三选一：写实教学风 / 扁平卡通风 / 国风简约',
    '',
    '## 严格输出',
    '只返回 JSON 对象，以 { 开头，} 结尾。',
  ].filter(Boolean).join('\n');

  let rawText;
  try {
    rawText = await aiClient.chatJson({
      systemPrompt,
      userPrompt,
      temperature: 0.4,  // 视频创意稍高
      maxTokens: 6000,
    });
  } catch (e) {
    return { success: false, error: `AI 调用失败：${e.message}` };
  }

  let parsed;
  try {
    parsed = parseMicroVideoJson(rawText);
  } catch (e) {
    return { success: false, error: e.message, raw: String(rawText || '').slice(0, 500) };
  }

  const microVideo = normalizeMicroVideo(parsed, {
    courseName,
    audience: courseContext.audience,
  });

  return { success: true, data: { microVideo, raw: rawText } };
}

// ── 自检 ────────────────────────────────────────────────────────────────

function selfCheck() {
  const checks = [];

  checks.push({
    name: 'prompts/micro-video.md 可加载',
    pass: (() => {
      try { return loadPrompt('micro-video').length > 500; } catch { return false; }
    })(),
  });

  checks.push({
    name: 'parseMicroVideoJson 处理 markdown 包裹',
    pass: (() => {
      try { return parseMicroVideoJson('```json\n{"foo":"bar"}\n```').foo === 'bar'; } catch { return false; }
    })(),
  });

  checks.push({
    name: 'normalizeMicroVideo 兜底 storyboard 至少 1',
    pass: (() => {
      const r = normalizeMicroVideo({});
      return r.storyboard.length >= 1;
    })(),
  });

  checks.push({
    name: 'normalizeMicroVideo storyboard.length 必须 === jimengPrompts.length',
    pass: (() => {
      const r = normalizeMicroVideo({
        storyboard: [
          { shotNumber: 1, duration: 10 },
          { shotNumber: 2, duration: 15 },
          { shotNumber: 3, duration: 20 },
        ],
        jimengPrompts: [
          { shotNumber: 1, prompt: 'p1' },
        ],
      });
      return r.storyboard.length === r.jimengPrompts.length;
    })(),
  });

  checks.push({
    name: 'normalizeMicroVideo style 三选一兜底',
    pass: (() => {
      const r = normalizeMicroVideo({
        jimengPrompts: [{ shotNumber: 1, style: '油画风' }],  // 非法
        storyboard: [{ shotNumber: 1 }],
      });
      return r.jimengPrompts[0].style === '写实教学风';
    })(),
  });

  checks.push({
    name: 'normalizeMicroVideo aspectRatio 默认 9:16',
    pass: (() => {
      const r = normalizeMicroVideo({
        jimengPrompts: [{ shotNumber: 1 }],
        storyboard: [{ shotNumber: 1 }],
      });
      return r.jimengPrompts[0].aspectRatio === '9:16';
    })(),
  });

  checks.push({
    name: 'normalizeMicroVideo type 五选一兜底',
    pass: (() => {
      const r = normalizeMicroVideo({
        storyboard: [{ shotNumber: 1, type: '不存在的类型' }],
      });
      return r.storyboard[0].type === 'content';
    })(),
  });

  checks.push({
    name: 'normalizeMicroVideo body 至少 1 段',
    pass: (() => {
      const r = normalizeMicroVideo({});
      return r.narrationScript.body.length >= 1;
    })(),
  });

  checks.push({
    name: 'normalizeMicroVideo _stats 含核心字段',
    pass: (() => {
      const r = normalizeMicroVideo({
        storyboard: [{ shotNumber: 1, duration: 30 }, { shotNumber: 2, duration: 30 }],
        jimengPrompts: [{ shotNumber: 1 }, { shotNumber: 2 }],
      });
      return typeof r._stats?.shotCount === 'number' &&
        typeof r._stats?.totalDurationFromShots === 'number' &&
        r._stats.shotPromptMatch === true;
    })(),
  });

  checks.push({
    name: 'normalizeMicroVideo duration 60-90 秒标记',
    pass: (() => {
      const r1 = normalizeMicroVideo({
        storyboard: [{ shotNumber: 1, duration: 70 }],
        jimengPrompts: [{ shotNumber: 1 }],
      });
      const r2 = normalizeMicroVideo({
        storyboard: [{ shotNumber: 1, duration: 30 }],  // < 60
        jimengPrompts: [{ shotNumber: 1 }],
      });
      return r1._stats.durationInRange === true && r2._stats.durationInRange === false;
    })(),
  });

  const passed = checks.filter((c) => c.pass).length;
  return { total: checks.length, passed, checks };
}

module.exports = {
  generate,
  selfCheck,
  ALLOWED_STYLES,
  ALLOWED_TYPES,
  MIN_DURATION,
  MAX_DURATION,
  _internal: { parseMicroVideoJson, normalizeMicroVideo, loadPrompt },
};
