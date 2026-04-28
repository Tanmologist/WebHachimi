# WebHachimi 清理计划

本文件记录重做期间的清理边界。当前不直接删除旧文件，避免丢失迁移参考和静态预览依据。

## 已关闭

- `127.0.0.1:5578` 上由本轮启动的本地预览服务已停止。

## 当前保留

- `index.html`
- `styles.css`
- `app.js`
- `server.js`
- `data/project.json`
- `editor-preview.html`
- `editor-preview.css`
- `FEATURES.md`
- `ENGINE_LOGIC_NOTES.md`
- `ARCHITECTURE.md`
- `ROADMAP.md`

保留原因：

- 旧单页实现仍是迁移参考。
- `server.js` 仍是当前本地静态服务和项目保存入口。
- `editor-preview.html` 和 `editor-preview.css` 是重做 UI 的静态决策稿。
- `data/project.json` 是旧数据模型和迁移测试样本。

## 进入 v2 后可归档

当新编辑器入口可运行后，可把以下文件移动到 `legacy/` 或 `archive/legacy-app/`：

- `index.html`
- `styles.css`
- `app.js`
- `data/project.json`
- `FEATURES.md`

归档前必须满足：

- v2 有自己的可运行入口。
- v2 能加载或迁移旧 `data/project.json`。
- 旧功能清单已转化为 v2 issue/roadmap。
- `npm run typecheck` 通过。

## UI 定稿后可归档

当 v2 编辑器 UI 实现到可交互版本后，可归档静态预览：

- `editor-preview.html`
- `editor-preview.css`

归档前必须满足：

- v2 编辑器已经实现工具栏、层级、画布、任务列表、属性和资源入口。
- 超级画笔、任务预览、左侧最小化停靠规则已在真实 UI 中体现。

## 暂不清理

- `node_modules/`
- `package-lock.json`

原因：

- `node_modules/` 是本地依赖安装结果，已被 `.gitignore` 忽略。
- `package-lock.json` 用于固定 TypeScript 验证环境，应保留。

## 删除规则

- 删除或移动旧文件前，需要列出具体文件清单并确认。
- 不删除仍被 `server.js`、文档、预览页或测试流程引用的文件。
- 先归档，后删除；删除只在确认 v2 替代功能稳定后执行。
