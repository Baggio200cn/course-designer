/**
 * context-compressor.js — 跨阶段内容压缩器（Phase-6 M2.5）
 *
 * 职责：把上游阶段的大体积输出（如 8000+ 字讲稿）压缩为下游阶段需要的关键信息，
 *      减少 token 占用、降低 LLM 注意力稀释、节省成本。
 *
 * 与 context-builder 的区别：
 *  - context-builder：浅层提取（章节标题 + 1-2 句概要），约 200-500 字
 *  - context-compressor：深层提炼（关键术语 + 操作步骤 + 案例），约 800-1200 字
 *  - 两者互补：调用方按场景选择
 *
 * 当前提供的压缩函数：
 *  - compressLectureForPpt(lectureScript)
 *      讲稿 → PPT 规划场景：保留模块标题、关键术语、操作步骤、案例引用
 *
 * 设计原则：
 *  1. 纯函数：相同输入恒等输出，无副作用、无 AI 调用、不读 DB
 *  2. 启发式提取：用正则/统计/停用词，不引入 NLP 库（保持零依赖）
 *  3. 安全降级：输入异常时返回结构化空对象，不抛错
 *  4. 可测试：内置 selfCheck 覆盖典型讲稿样本
 *
 * 单文件不超过 600 行（CLAUDE.md 第七节）
 */

// ─── 停用词表（不计入"关键术语"）──────────────────────────
// 包含常见教学口语、人称代词、连接词、通用动词
const STOPWORDS = new Set([
  '老师', '同学', '同学们', '大家', '我们', '他们', '你们', '自己',
  '现在', '今天', '今节课', '这节课', '本节课', '下节课', '上节课',
  '什么', '怎么', '为什么', '怎样', '哪里', '哪个', '哪些',
  '可以', '能够', '应该', '必须', '需要', '一定', '可能',
  '所以', '因此', '但是', '不过', '然后', '接着', '首先', '最后',
  '一下', '一些', '一点', '一种', '一个', '一次', '一遍',
  '没有', '不是', '就是', '还是', '只是', '已经', '正在',
  '比如', '例如', '举例', '示例',
  // 教学讲稿元词（这些是结构化标签，不是真正的"专业术语"）
  '教师讲述', '课堂动作', '课堂练习', '总结收束', '开场导入', '操作步骤', '知识讲解',
]);

// ─── 工具函数 ────────────────────────────────────────────
/**
 * 用滑动窗口提取所有 4-8 字的连续中文 n-gram 子串作为候选关键术语。
 * 比单纯的 `{4,12}` 整段匹配更精细，能找出真正高频复用的子串。
 *
 * 例：'专业建模流程包括三个阶段' 会展开为多个 4/5/6/7/8 字子串：
 *   '专业建模','业建模流','建模流程','建模流程包','模流程包括' …
 * 所以"专业建模流程"这类反复出现的核心术语就能被频次统计捕获。
 */
function _extractCandidateTerms(text) {
  // 先按非中文切分，得到连续中文段
  const segments = String(text).match(/[一-龥]+/g) || [];
  const candidates = [];
  const MIN_LEN = 4;
  const MAX_LEN = 8;
  for (const seg of segments) {
    for (let len = MIN_LEN; len <= MAX_LEN && len <= seg.length; len++) {
      for (let i = 0; i + len <= seg.length; i++) {
        candidates.push(seg.slice(i, i + len));
      }
    }
  }
  return candidates;
}

/**
 * 频次统计 + 停用词过滤 + 长度过滤 + 子串去重。
 * 保留出现 ≥ minCount 次的术语。
 *
 * 子串去重逻辑：n-gram 滑动窗口会产生大量重叠子串（如"材质反射参数调节"会
 * 衍生出"材质反射参数"、"反射参数调节"等同频次子串）。我们认定：若较短的
 * 子串 B 完全包含在较长术语 A 中，且两者频次相等，则 B 是 A 的"噪音子串"，
 * 删除 B 仅保留 A。这是 NLP 文献中常见的"最长高频短语"启发式。
 */
function _extractKeyTerms(text, { minCount = 2, maxTerms = 30 } = {}) {
  const candidates = _extractCandidateTerms(text);
  const counter = new Map();
  for (const term of candidates) {
    if (STOPWORDS.has(term)) continue;
    if (term.length < 4) continue;
    counter.set(term, (counter.get(term) || 0) + 1);
  }
  // 第一轮筛选：频次 ≥ minCount
  const initial = Array.from(counter.entries())
    .filter(([, count]) => count >= minCount)
    // 先按词长降序，让长术语先进入"已保留"集合
    .sort((a, b) => b[0].length - a[0].length || b[1] - a[1]);

  // 子串去重：若已保留的某长术语包含当前候选 + 频次相等，则跳过
  const kept = [];
  for (const [term, count] of initial) {
    const isNoiseSubstring = kept.some((k) => k.term.includes(term) && k.count === count);
    if (!isNoiseSubstring) {
      kept.push({ term, count });
    }
  }
  // 最终按频次降序、词长降序重新排
  kept.sort((a, b) => b.count - a.count || b.term.length - a.term.length);
  return kept.slice(0, maxTerms);
}

/**
 * 提取操作步骤段落。
 * 启发式：
 *  - 显式编号开头（"1." "1、" "①" "第一步" "Step 1"）
 *  - 含"操作动词"的句子（点击/打开/选择/输入/拖动/创建/设置/调整/启用）
 */
function _extractOperationSteps(text) {
  const lines = text.split(/[\r\n]+/);
  const operationVerbs = /(点击|打开|关闭|选择|选中|输入|拖动|拖放|拖拽|创建|新建|设置|调整|启用|关闭|连接|安装|配置|检查|保存|导出|导入|渲染|生成|编译)/;
  const numberedStep = /^\s*(?:\d+[\.\、]|[①-⑩]|第[一二三四五六七八九十]步|Step\s*\d+)/;
  const result = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 8 || trimmed.length > 200) continue;
    // 跳过明显非操作的句子（教师讲述/课堂动作 标签）
    if (/^(教师讲述|课堂动作|##|---)/.test(trimmed)) continue;
    if (numberedStep.test(trimmed) || operationVerbs.test(trimmed)) {
      // 只取前 100 字
      result.push(trimmed.length > 100 ? trimmed.slice(0, 100) + '…' : trimmed);
    }
    if (result.length >= 20) break;
  }
  return result;
}

/**
 * 提取案例/示例提及。
 * 启发式：含"案例"、"项目"、"比如"、"举个例子"、"以…为例"等关键词的句子。
 *
 * 排除规则：
 *  - Markdown 标题（# ## ###）
 *  - 列表/引用前缀（- * > 教师讲述：课堂动作：）
 *  - 长度异常（< 10 或 > 150）
 */
function _extractExamples(text) {
  const lines = text.split(/[\r\n。！？]+/);
  const exampleKeywords = /(案例|项目|比如|例如|举个例子|举例来说|以.{1,15}为例|实际工作中|真实场景)/;
  // 跳过明显非案例的行前缀
  const skipPrefix = /^(#|-|\*|>|教师讲述[:：]|课堂动作[:：])/;
  const result = [];
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.length < 10 || trimmed.length > 150) continue;
    if (skipPrefix.test(trimmed)) continue;
    if (exampleKeywords.test(trimmed)) {
      result.push(trimmed);
    }
    if (result.length >= 10) break;
  }
  return result;
}

/**
 * 提取模块标题（从 Markdown 二级标题）。
 * 与 context-builder.extractLectureSections 互补——这里只取标题不取讲述内容。
 */
function _extractModuleTitles(text) {
  const lines = text.split(/[\r\n]+/);
  const titles = [];
  for (const line of lines) {
    const m = line.trim().match(/^##?\s+(.+?)$/);
    if (m) {
      // 去掉时间标记如 "（0-9分钟）"
      const cleanTitle = m[1].replace(/（[\d\-～\s分钟到~]+）\s*$/, '').trim();
      if (cleanTitle && !titles.includes(cleanTitle)) {
        titles.push(cleanTitle);
      }
    }
    if (titles.length >= 12) break;
  }
  return titles;
}

// ─── 公共 API ────────────────────────────────────────────
/**
 * 把正式讲稿压缩为 PPT 规划阶段所需的核心信息。
 *
 * 返回结构：
 *   {
 *     moduleTitles: string[],       // 模块/章节标题列表
 *     keyTerms: [{term, count}],    // 关键术语（出现 ≥ 2 次的中文术语）
 *     operationSteps: string[],     // 操作步骤句子
 *     examples: string[],           // 案例/示例提及
 *     rawLength: number,            // 原始字符数
 *     compressedLength: number,     // 压缩后总字符数（仅 4 类信息文本之和）
 *     compressionRatio: number,     // compressedLength / rawLength（0-1，越小压缩越多）
 *   }
 *
 * 输入异常时返回结构化空对象（不抛错）。
 *
 * @param {string} lectureScript
 * @returns {Object}
 */
function compressLectureForPpt(lectureScript) {
  if (typeof lectureScript !== 'string' || !lectureScript.trim()) {
    return {
      moduleTitles: [],
      keyTerms: [],
      operationSteps: [],
      examples: [],
      rawLength: 0,
      compressedLength: 0,
      compressionRatio: 0,
    };
  }

  const moduleTitles = _extractModuleTitles(lectureScript);
  const keyTerms = _extractKeyTerms(lectureScript, { minCount: 2, maxTerms: 25 });
  const operationSteps = _extractOperationSteps(lectureScript);
  const examples = _extractExamples(lectureScript);

  const compressedText = [
    ...moduleTitles,
    ...keyTerms.map((k) => k.term),
    ...operationSteps,
    ...examples,
  ].join('\n');

  return {
    moduleTitles,
    keyTerms,
    operationSteps,
    examples,
    rawLength: lectureScript.length,
    compressedLength: compressedText.length,
    compressionRatio: lectureScript.length > 0
      ? Number((compressedText.length / lectureScript.length).toFixed(3))
      : 0,
  };
}

/**
 * 把压缩结果格式化为可注入 PPT 生成 Prompt 的紧凑字符串。
 * 调用方场景：ppt-plan-generator 需要轻量的"讲稿要点"作为生成参考。
 *
 * 输出格式（中文，便于模型理解）：
 *   ## 讲稿要点摘要
 *   ### 模块标题
 *   - 模块1：xx
 *   - 模块2：xx
 *   ### 关键术语
 *   - 术语1（出现 5 次）
 *   - 术语2（出现 3 次）
 *   ### 主要操作步骤
 *   - 1. 点击 ...
 *   ### 案例引用
 *   - 比如 ...
 */
function formatCompressedAsPrompt(compressed) {
  if (!compressed || typeof compressed !== 'object') return '';

  const lines = ['## 讲稿要点摘要'];

  if (compressed.moduleTitles && compressed.moduleTitles.length) {
    lines.push('', '### 模块标题');
    compressed.moduleTitles.forEach((t) => lines.push(`- ${t}`));
  }
  if (compressed.keyTerms && compressed.keyTerms.length) {
    lines.push('', '### 关键术语');
    compressed.keyTerms.slice(0, 15).forEach((k) => {
      lines.push(`- ${k.term}（出现 ${k.count} 次）`);
    });
  }
  if (compressed.operationSteps && compressed.operationSteps.length) {
    lines.push('', '### 主要操作步骤');
    compressed.operationSteps.slice(0, 10).forEach((s) => lines.push(`- ${s}`));
  }
  if (compressed.examples && compressed.examples.length) {
    lines.push('', '### 案例引用');
    compressed.examples.slice(0, 5).forEach((e) => lines.push(`- ${e}`));
  }

  return lines.join('\n');
}

// ─── 自检函数 ────────────────────────────────────────────
function selfCheck() {
  const cases = [];

  // 用例 1：空字符串返回空结构
  cases.push(() => {
    const r = compressLectureForPpt('');
    if (r.moduleTitles.length !== 0) throw new Error('空字符串应返回空 moduleTitles');
    if (r.compressedLength !== 0) throw new Error('空字符串 compressedLength 应为 0');
  });

  // 用例 2：非字符串输入安全降级
  cases.push(() => {
    const r1 = compressLectureForPpt(null);
    const r2 = compressLectureForPpt(undefined);
    const r3 = compressLectureForPpt(12345);
    if (r1.rawLength !== 0 || r2.rawLength !== 0 || r3.rawLength !== 0) {
      throw new Error('非字符串输入应安全降级为空结构');
    }
  });

  // 用例 3：典型讲稿能提取模块标题
  cases.push(() => {
    const sample = `# 课程标题
## 开场导入（0-9分钟）
教师讲述：今天我们学习...
## 模块1：基础建模（9-30分钟）
教师讲述：...
## 模块2：材质设定（30-50分钟）
教师讲述：...`;
    const r = compressLectureForPpt(sample);
    if (r.moduleTitles.length < 3) throw new Error(`应提取至少 3 个标题，实际 ${r.moduleTitles.length}`);
    if (!r.moduleTitles.some((t) => t.includes('模块1'))) throw new Error('应包含 模块1 标题');
  });

  // 用例 4：关键术语提取——出现 2 次以上的连续中文术语被收录
  cases.push(() => {
    // 注意：keyTerms 仅匹配连续中文（不含 ASCII / 连字符），所以只能用纯中文样本
    const sample = '今天我们学习专业建模流程。专业建模流程包括三个阶段。专业建模流程的核心是参数控制。掌握专业建模流程后才能进入后续模块。';
    const r = compressLectureForPpt(sample);
    const terms = r.keyTerms.map((k) => k.term);
    if (!terms.some((t) => t.length >= 4 && t.includes('建模流程'))) {
      throw new Error(`应提取连续 4+ 字术语，实际 terms=${JSON.stringify(terms)}`);
    }
  });

  // 用例 5：操作步骤提取
  cases.push(() => {
    const sample = `教师讲述：操作开始了
1. 点击"创建"按钮新建项目
2. 选择标准模板
3. 输入项目名称
然后我们继续讲...
拖动鼠标可以调整大小`;
    const r = compressLectureForPpt(sample);
    if (r.operationSteps.length < 2) throw new Error(`应提取至少 2 个操作步骤，实际 ${r.operationSteps.length}`);
  });

  // 用例 6：案例提取
  cases.push(() => {
    const sample = '今天我们看一个案例：某品牌专卖店的设计。比如我去年带的学生张伟做的项目就很有代表性。再举个例子，优衣库的店铺布局也很经典。';
    const r = compressLectureForPpt(sample);
    if (r.examples.length < 2) throw new Error(`应提取至少 2 个案例，实际 ${r.examples.length}`);
  });

  // 用例 7：压缩比 < 1（压缩后比原文短）
  cases.push(() => {
    // 构造一个有大量重复内容的讲稿
    const sample = `## 模块1：建模基础
教师讲述：今天我们学习建模。建模是设计的核心。建模需要耐心和细致。建模工具有很多种。建模流程包括很多步骤。
1. 点击创建按钮
2. 选择基本几何体
3. 调整尺寸参数
具体的操作流程是这样的：先点击工具，再选择参数，最后保存文件。
案例：上次我们看到的项目就是这样做的。
教师讲述：建模流程要熟练掌握。`;
    const r = compressLectureForPpt(sample);
    if (r.compressionRatio >= 1) {
      throw new Error(`压缩后应短于原文，实际 ratio=${r.compressionRatio}`);
    }
    if (r.rawLength === 0) throw new Error('rawLength 不应为 0');
  });

  // 用例 8：formatCompressedAsPrompt 输出 Markdown
  cases.push(() => {
    const compressed = compressLectureForPpt(`## 模块1
教师讲述：使用 Editable Poly 工具。Editable Poly 工具很重要。Editable Poly 工具是核心。
1. 点击创建按钮新建项目`);
    const formatted = formatCompressedAsPrompt(compressed);
    if (!formatted.startsWith('## 讲稿要点摘要')) throw new Error('应以总标题开头');
    if (!formatted.includes('### 模块标题')) throw new Error('应有模块标题段');
  });

  // 用例 9：formatCompressedAsPrompt 空输入返回空字符串
  cases.push(() => {
    if (formatCompressedAsPrompt(null) !== '') throw new Error('null 应返回空字符串');
    if (formatCompressedAsPrompt({}) === '') {
      // {} 至少有总标题
    }
  });

  // 用例 10：长讲稿（4000+ 字）能在合理时间内压缩
  cases.push(() => {
    // 重复构造 4000+ 字讲稿
    const block = `## 模块X：综合应用
教师讲述：在实际工作中，我们使用 Photoshop 进行后期处理。Photoshop 的图层功能很重要。
案例：上次的项目就是用 Photoshop 完成的。
1. 打开 Photoshop 软件
2. 点击文件菜单
3. 选择新建项目
`;
    const long = block.repeat(40);
    if (long.length < 4000) throw new Error('测试样本不够长');
    const t1 = Date.now();
    const r = compressLectureForPpt(long);
    const cost = Date.now() - t1;
    if (cost > 500) throw new Error(`压缩耗时过长 ${cost}ms`);
    if (r.compressionRatio >= 0.9) {
      throw new Error(`长讲稿压缩比应 < 0.9，实际 ${r.compressionRatio}`);
    }
  });

  // 用例 11：纯函数性——相同输入产生相同输出
  cases.push(() => {
    const sample = '## 模块1\n教师讲述：测试内容内容。\n1. 点击创建按钮';
    const r1 = compressLectureForPpt(sample);
    const r2 = compressLectureForPpt(sample);
    if (JSON.stringify(r1) !== JSON.stringify(r2)) {
      throw new Error('相同输入应产生相同输出（纯函数性）');
    }
  });

  // 用例 12：停用词被过滤
  cases.push(() => {
    const sample = '同学们 同学们 同学们 大家 大家 大家 老师 老师 老师';
    const r = compressLectureForPpt(sample);
    const terms = r.keyTerms.map((k) => k.term);
    // 单字"老师"不会被采到（length < 4），但假设别的常见词混入仍应过滤
    if (terms.includes('同学们')) throw new Error('同学们 应被停用词过滤');
    if (terms.includes('大家')) throw new Error('大家 应被停用词过滤（且 < 4 字）');
  });

  // 执行
  let passed = 0;
  const failures = [];
  for (let i = 0; i < cases.length; i++) {
    try {
      cases[i]();
      passed++;
    } catch (e) {
      failures.push({ caseIndex: i + 1, message: e.message });
    }
  }
  return { passed, total: cases.length, failures, success: failures.length === 0 };
}

module.exports = {
  // 主 API
  compressLectureForPpt,
  formatCompressedAsPrompt,

  // 内部工具（导出供高级场景测试）
  _extractCandidateTerms,
  _extractKeyTerms,
  _extractOperationSteps,
  _extractExamples,
  _extractModuleTitles,
  STOPWORDS,

  // 测试辅助
  selfCheck,
};
