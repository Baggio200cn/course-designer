#!/usr/bin/env node
/**
 * install-git-hooks.js — 安装项目 git hooks 到 .git/hooks/
 *
 * 用法：node scripts/install-git-hooks.js
 *
 * 做什么：
 *   - 把 scripts/git-hooks/* 复制到 .git/hooks/
 *   - 给 hook 文件加可执行权限
 *
 * 为什么需要安装：
 *   .git/ 目录不进 git，所以 hook 文件必须每次 clone 后单独安装
 */
const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
const HOOKS_SRC = path.join(PROJECT_ROOT, 'scripts', 'git-hooks');
const HOOKS_DST = path.join(PROJECT_ROOT, '.git', 'hooks');

if (!fs.existsSync(HOOKS_DST)) {
  console.error('❌ .git/hooks/ 目录不存在——是否在 git 仓库根目录运行？');
  process.exit(1);
}

if (!fs.existsSync(HOOKS_SRC)) {
  console.error(`❌ ${HOOKS_SRC} 目录不存在`);
  process.exit(1);
}

const hooks = fs.readdirSync(HOOKS_SRC);
let installed = 0;

hooks.forEach((name) => {
  const src = path.join(HOOKS_SRC, name);
  const dst = path.join(HOOKS_DST, name);
  if (fs.statSync(src).isFile()) {
    fs.copyFileSync(src, dst);
    try {
      fs.chmodSync(dst, 0o755);
    } catch (e) {
      // Windows 可能不支持 chmod，忽略
    }
    console.log(`✅ 已安装：${name}`);
    installed++;
  }
});

console.log(`\n安装完成：${installed} 个 hook 已就位`);
console.log('下次 git commit 时会自动运行 pre-commit 检查');
console.log('\n💡 如需临时跳过检查（不推荐）：git commit --no-verify');
