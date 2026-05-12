# IPC Handler 文件地图（Phase-5A 已完成）

> **状态**：全部 87 个 handler 已迁移完毕，index.js 只做启动+注册。

```
src/main/
├── index.js              ← 只做启动+路由注册（已精简）
└── ipc/
    ├── _registry.js           ← 统一注册入口 ✅
    ├── notebook.handlers.js   (6 handlers，含 notebook:update + notebook:generateResearch) ✅
    ├── module.handlers.js     (7 handlers) ✅
    ├── framework.handlers.js  (7 handlers，含 ai:generateFramework) ✅
    ├── course.handlers.js     (6 handlers) ✅
    ├── lecture.handlers.js    (4 handlers，含 script:generateABC/Formal + quality:audit) ✅
    ├── v2/
    │   ├── framework.handlers.js  (4 handlers) ✅
    │   ├── lecture.handlers.js    (3 handlers) ✅
    │   ├── ppt.handlers.js        (4 handlers) ✅
    │   └── video.handlers.js      (7 handlers) ✅
    ├── export.handlers.js     (8 handlers，word/ppt/quiz/html/pbl/zip) ✅
    ├── resource.handlers.js   (11 handlers) ✅
    ├── media.handlers.js      (7 handlers，含 v2:generateFrameworkInfographic) ✅
    ├── prompt.handlers.js     (8 handlers，LEGACY_DISABLED 模式) ✅
    └── system.handlers.js     (7 handlers，schedule/settings/util/workspace) ✅
```

**Agent 新 handler 规范**：Phase-5C 新增的 Agent IPC handler 放入 `src/main/ipc/agent.handlers.js`，
通过 `_registry.js` 注册，不允许写入其他已有文件。

**新加 handler 的步骤**：
1. 选对文件（按业务领域，参考上表）
2. 在文件末尾加 `ipcMain.handle(...)`
3. 在 `_registry.js` 调用 `register(ipcMain, getDeps)` 注册
4. 在 `src/preload/index.js` 暴露给前端
5. 跑 `npm run dev` 验证手动调用 OK
