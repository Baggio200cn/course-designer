/**
 * 诊断脚本：在 Node 主进程层面直接测试 fetch 到 ark API 是否稳定。
 *
 * 目的：curl 单次通，但 Electron 主进程报 fetch failed。
 *      这里用纯 Node fetch 复现，定位是 fetch 本身的问题还是 ark-course-client 的封装问题。
 *
 * 用法：node scripts/test-ark-fetch.js
 *      node scripts/test-ark-fetch.js --concurrent  # 并发 4 次（模拟 formal-generator 分段）
 */
'use strict';

const apiKey = '3cfb5c8c-4c94-43f7-895d-ec89fdb228cc';
const endpoint = 'ep-m-20260327105914-k629s';
const url = 'https://ark.cn-beijing.volces.com/api/v3/chat/completions';

const concurrent = process.argv.includes('--concurrent');
const longMode = process.argv.includes('--long');
const N = concurrent ? 4 : 1;

// 长模式：模拟 formal-generator 真实场景（长 prompt + 长响应 + reasoning model）
const LONG_SYSTEM = `你是一名资深职业教育教师，正在为《服装产品传播模型》课程编写正式讲演稿。
要求：
- 必须包含至少 5 个章节
- 每章节包含「教师讲述：」（连续 3-5 句口播）和「课堂动作附栏：」两个段落
- 教师讲述需结合电商真实案例（某品牌官网详情页、某店铺直播场景等）
- 课堂动作附栏需具体到学生操作步骤
- 输出格式严格按 markdown，不得偷懒缩写`;

const LONG_USER = `课程基本信息：
- 软件工具：Adobe Photoshop 2024, Canva 可画, 剪映 6.0
- 学时：4 学时
- 学情：全日制中等职业学校服装相关专业二年级，零三维基础
- 教学目标：掌握服装产品在电商详情页、直播间、短视频中的传播表现技巧

请生成完整的 4 学时讲演稿，每学时至少 1500 字"教师讲述"，章节结构清晰。
请直接输出讲稿正文，不要寒暄。`;

console.log(`Node 版本：${process.version}`);
console.log(`平台：${process.platform} ${process.arch}`);
console.log(`fetch 类型：${typeof fetch}`);
console.log(`请求次数：${N}（${concurrent ? '并发' : '串行'}）`);
console.log('');

async function callOnce(idx) {
  const start = Date.now();
  console.log(`[${idx}] 发起请求...${longMode ? '（长 prompt 模式）' : ''}`);

  const messages = longMode
    ? [
        { role: 'system', content: LONG_SYSTEM },
        { role: 'user', content: LONG_USER },
      ]
    : [{ role: 'user', content: `Hello, request #${idx}, just reply OK.` }];

  const maxTokens = longMode ? 8000 : 50;

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: endpoint,
        messages,
        max_tokens: maxTokens,
      }),
    });
    const elapsed = Date.now() - start;
    console.log(`[${idx}] HTTP ${res.status} 耗时 ${elapsed}ms`);
    if (!res.ok) {
      const errText = await res.text();
      console.log(`[${idx}] 响应错误：${errText.slice(0, 200)}`);
      return { idx, ok: false, status: res.status, elapsed };
    }
    const data = await res.json();
    const content = data?.choices?.[0]?.message?.content || '(empty)';
    const usage = data?.usage || {};
    console.log(`[${idx}] 响应长度：${content.length} 字符`);
    console.log(`[${idx}] tokens：prompt=${usage.prompt_tokens || '?'} completion=${usage.completion_tokens || '?'} reasoning=${usage.completion_tokens_details?.reasoning_tokens || '?'} total=${usage.total_tokens || '?'}`);
    if (longMode) {
      console.log(`[${idx}] 内容前 200 字：${content.slice(0, 200).replace(/\n/g, '\\n')}`);
      console.log(`[${idx}] 是否含「教师讲述」：${content.includes('教师讲述')}`);
      console.log(`[${idx}] 是否含「课堂动作」：${content.includes('课堂动作')}`);
    } else {
      console.log(`[${idx}] 响应：${content.slice(0, 80)}`);
    }
    return { idx, ok: true, status: res.status, elapsed };
  } catch (e) {
    const elapsed = Date.now() - start;
    console.error(`[${idx}] ❌ fetch 失败（耗时 ${elapsed}ms）：${e.message}`);
    if (e.cause) {
      console.error(`[${idx}]    cause: ${e.cause.message || e.cause}`);
      console.error(`[${idx}]    cause.code: ${e.cause.code || '(none)'}`);
      console.error(`[${idx}]    cause.errno: ${e.cause.errno || '(none)'}`);
      console.error(`[${idx}]    cause.syscall: ${e.cause.syscall || '(none)'}`);
    }
    return { idx, ok: false, error: e.message, cause: e.cause?.message, code: e.cause?.code, elapsed };
  }
}

async function main() {
  let results;
  if (concurrent) {
    results = await Promise.all(Array.from({ length: N }, (_, i) => callOnce(i + 1)));
  } else {
    results = [];
    for (let i = 0; i < N; i++) {
      results.push(await callOnce(i + 1));
    }
  }

  console.log('\n═══════════════════════════════════════════');
  console.log('总结：');
  const ok = results.filter((r) => r.ok).length;
  const fail = results.filter((r) => !r.ok).length;
  console.log(`  成功：${ok} / ${N}`);
  console.log(`  失败：${fail} / ${N}`);
  if (fail > 0) {
    console.log('\n失败详情：');
    results.filter((r) => !r.ok).forEach((r) => {
      console.log(`  [${r.idx}] error=${r.error || ''} cause=${r.cause || ''} code=${r.code || ''}`);
    });
  }
}

main().catch(console.error);
