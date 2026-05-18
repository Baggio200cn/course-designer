/**
 * smoke-test-real-ark.js — 真实 ARK endpoint 烟雾测试（v4.3.3 D15）
 *
 * 用途：验证 H9「mock 通过 ≠ 功能就绪」原则
 *   每次发版前手动跑一次，确保 doubao 端点真的能连通 + 返回有效内容
 *
 * 不在 CI 跑（需要老师的真实 API Key）：
 *   - 老师本地：npm run smoke
 *   - 失败原因 → 打印 endpoint / 错误码 / response body 帮助诊断
 *
 * 用法：
 *   ARK_API_KEY=xxx \
 *   ARK_TEXT_ENDPOINT=ep-m-xxx \
 *   node scripts/smoke-test-real-ark.js
 *
 * 退出码：
 *   0  全部通过
 *   1  至少 1 个 endpoint 失败
 *   2  环境变量缺失
 */

'use strict';

const path = require('path');

function fail(msg, exitCode = 1) {
  console.error(`\n❌ ${msg}\n`);
  process.exit(exitCode);
}

const apiKey = process.env.ARK_API_KEY || process.env.ARK_KEY;
const textEndpoint = process.env.ARK_TEXT_ENDPOINT || process.env.ARK_ENDPOINT_TEXT;

if (!apiKey || !textEndpoint) {
  fail([
    '环境变量缺失：',
    '  ARK_API_KEY        (必填)',
    '  ARK_TEXT_ENDPOINT  (必填，如 ep-m-20260327105914-k629s)',
    '可选：',
    '  ARK_IMAGE_ENDPOINT (测图片生成)',
    '',
    '示例：',
    '  ARK_API_KEY=3cfb-... ARK_TEXT_ENDPOINT=ep-m-... node scripts/smoke-test-real-ark.js',
  ].join('\n'), 2);
}

const { ArkCourseClient } = require(path.resolve(__dirname, '../src/main/api/ark-course-client'));

async function testTextEndpoint() {
  console.log(`\n🔬 Test 1 · 文本 endpoint chatJson`);
  console.log(`   endpoint: ${textEndpoint}`);
  const client = new ArkCourseClient({ apiKey, endpointId: textEndpoint });
  const start = Date.now();
  try {
    const result = await client.chatJson({
      systemPrompt: '你是测试助手。输出严格 JSON，不要 markdown 包装。',
      userPrompt: '输出 { "ok": true, "msg": "smoke test pass" }',
      temperature: 0.1,
      maxTokens: 200,
    });
    const ms = Date.now() - start;
    const text = typeof result === 'string' ? result : JSON.stringify(result);
    if (!/ok|true|pass|smoke/i.test(text)) {
      console.error(`   ❌ 响应内容不含预期关键词。原响应：\n${text.slice(0, 300)}`);
      return false;
    }
    console.log(`   ✅ chatJson 通过（${ms}ms · 返回 ${text.length} 字符）`);
    return true;
  } catch (err) {
    const ms = Date.now() - start;
    console.error(`   ❌ chatJson 失败（${ms}ms）：${err.message}`);
    return false;
  }
}

async function testVisionEndpoint() {
  console.log(`\n🔬 Test 2 · 多模态 chatVision（仅 ep-m-* 前缀 endpoint 支持）`);
  if (!/^ep-m-/.test(textEndpoint)) {
    console.log(`   ⏭ 跳过：${textEndpoint} 非多模态前缀 ep-m-*`);
    return true;
  }
  const client = new ArkCourseClient({ apiKey, endpointId: textEndpoint });
  // 1x1 透明 PNG
  const tinyPng = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const start = Date.now();
  try {
    const text = await client.chatVision({
      systemPrompt: '你是 OCR 助手。',
      userPrompt: '这张图片有内容吗？回复 "yes" 或 "no"。',
      imageData: tinyPng,
      imageFormat: 'png',
      temperature: 0.1,
      maxTokens: 50,
    });
    const ms = Date.now() - start;
    if (!text || typeof text !== 'string' || text.length < 1) {
      console.error(`   ❌ chatVision 返回空`);
      return false;
    }
    console.log(`   ✅ chatVision 通过（${ms}ms · 返回："${text.slice(0, 60)}..."）`);
    return true;
  } catch (err) {
    const ms = Date.now() - start;
    console.error(`   ❌ chatVision 失败（${ms}ms）：${err.message}`);
    return false;
  }
}

(async () => {
  console.log('═══ 驭课 Agent v4.3.3 · 真实 ARK endpoint smoke test ═══');
  const results = [];
  results.push(await testTextEndpoint());
  results.push(await testVisionEndpoint());
  const passed = results.filter(Boolean).length;
  const total = results.length;
  console.log(`\n═══ 总计 ${passed}/${total} 通过 ═══`);
  if (passed < total) {
    fail(`${total - passed} 个测试失败。请检查 API Key / endpoint 配置`, 1);
  }
  console.log('✅ 全部通过\n');
  process.exit(0);
})();
