# 项目整理与后续开发规划

本文档记录 `wx-read-comment-extension-enhanced` 在完成 `v1.6.0-beta.1`（U1–U3）及本地 U4（点赞排序与作者筛选）后的工程整理、架构加固与后续演进计划。

## 当前基线

- **版本**：`1.6.0-beta.1`（本地最新提交已包含 U4，尚未重新打包发布）
- **核心能力**：仅在微信读书网页版上下滚动模式启用；提供公开评论 `range → rect` 映射、重合划线 badge、popup 弹窗与原文操作栏、想法点赞与官方回复入口、评论侧栏（搜索 / 定位状态 / 作者筛选 / 排序 / 密度）、阅读位置恢复、快捷键及本地收藏与 Markdown 导出。
- **验证基线**：`npm test` 83 项离线单测通过；M4/M5/I1–I4/U1–U4 具备受控 Playwright 浏览器回归脚本。

---

## P0 · 仓库瘦身与 MV3 加固（已完成）

目标：消除模板历史残留与 MV3 后台状态隐患，建立干净的源码与构建目录结构。

1. **清理未使用的脚手架页面与容器**
   - 移除未接入 `webpack.config.js` 和 `src/manifest.json` 的 `src/pages/Devtools/`、`Newtab/`、`Options/`、`Panel/`、`Popup/` 及 `src/containers/Greetings/`。
2. **规范静态资源与文档截图**
   - 将 `README.md` 引用的预览图和安装示意从 `src/assets/img/` 统一迁移至 `docs/previews/`，清理未被引用的上游残留图片；`src/assets/img/` 仅保留扩展运行时图标（`wxread-icon.png`）。
3. **规范构建产物输出目录**
   - 调整 `utils/build.js` 中 `ZipPlugin` 输出路径至 `releases/`，并将根目录历史 `.zip` 归档至 `releases/`，更新 `.gitignore`。
4. **修复 MV3 Service Worker 状态易失问题**
   - 将 `src/pages/Background/index.js` 中的内存 `tabContext = new Map()` 迁移至 `chrome.storage.session` 按 `tabId` 持久化，防止 Service Worker 闲置回收后丢失 `bookId`；同时将消息监听统一为标准 `async/await` 写法。

---

## P1 · 核心代码解耦与类型覆盖（已完成代码与文档整理，待 U4 打包发布）

目标：降低核心文件复杂度，让静态类型检查覆盖更多业务代码，并精简项目主文档。

1. **拆分超长核心模块（已完成）**
   - 已将 `src/pages/Content/publicReviewUnderlines.js`（原 1035 行）按职责拆分为：
     - `src/pages/Content/bridgeClient.js`：与 `pageBridge` 的 `postMessage` 通信、超时与请求序列管理
     - `src/pages/Content/reviewIndex.js`：已映射 `range` 索引、分组、坐标命中测试与原生交互判定
     - `src/pages/Content/popupRenderer.js`：评论 popup DOM 渲染、分批加载、边缘避让与键盘焦点管理
   - `publicReviewUnderlines.js` 保留为协调层与对外接口，并同步更新 `tests/review-compatibility-state.test.cjs` 共享 VM 上下文。
2. **扩大 TypeScript 类型检查覆盖（已完成基础配置）**
   - 已在 `tsconfig.json` 开启 `allowJs: true` 并通过 `tsc --noEmit` 验证；后续可按需逐步开启 `checkJs` 或迁移核心模块为 `.ts`。
3. **精简 README（已完成）与 U4 发布打包（待执行）**
   - 已将 `README.md` 精简为面向用户的说明、安装、预览与路线图，过程验收日志统一收口至 `docs/` 与 `CHANGELOG.zh.md`。
   - 待确认版本号后执行 `npm run build` 生成 U4 发布包。

---

## P2 · 功能演进与商店规范化（U5–U6）

目标：推进下一阶段功能特性，并具备规范化发布（含 Chrome Web Store）条件。

1. **U5–U6 需求立项与实现**
   - **U5 · 兼容性诊断**：显示原生入口能力，生成不含账号、凭据及书籍正文的诊断报告，方便网站更新后排查。
   - **U6 · 插件内回复预览**：核实纵向原生回复读取与分页；按需展开、手动加载更多，提交继续使用官方编辑器。
   - 每个阶段维持“离线单测 + 浏览器回归 + 验收文档”闭环。
2. **多尺寸图标与商店发布准备**
   - 补齐 `16x16`、`48x48` 扩展图标并在 `src/manifest.json` 声明。
   - 若准备上架 Chrome Web Store，补充 `CHROMEWEBSTORE.md`（详述 `webRequest`、`storage` 及 `https://weread.qq.com/*` 权限用途与隐私政策），并完成真实登录态下的回复提交与分页手工验收。
