# M5 自动化验收 · 2026-10-10

本阶段补充可重复的 UI、生命周期与性能回归。自动化只使用新建临时配置、受控 Reader 页面与模拟公开评论接口，不连接已登录浏览器，不读写用户凭据。真实登录态仍只在本地手动复核。

## 自动化入口

从项目根目录执行：

```powershell
npm.cmd ci --no-audit --no-fund
# 使用独立工具目录，项目依赖和 package-lock 不加入 Playwright。
npm.cmd install --prefix ..\.browser-test-tools --no-save --package-lock=false playwright@1.63.0
..\.browser-test-tools\node_modules\.bin\playwright.cmd install chromium
$env:PLAYWRIGHT_MODULE_PATH = (Resolve-Path ..\.browser-test-tools\node_modules\playwright).Path
npm.cmd run test:acceptance
```

如已安装独立 Playwright，直接把 `PLAYWRIGHT_MODULE_PATH` 指向其模块目录即可。本次使用 `D:\Codex\idea-lab\.m3-browser-tools\node_modules\playwright` 中的 Playwright 1.63.0。

`test:acceptance` 顺序执行离线测试、TypeScript 检查、生产构建、M4 兼容故障检查、M5 浏览器回归；任一失败即返回非零退出码并停止后续 gate。`test:browser` 仅运行 M4／M5 浏览器检查，需先构建；`test:browser:m5` 可单独排查 M5。

默认 headed Chromium。由 Agent 在 Windows 启动时，沿用 `exec_command` 的 `sandbox_permissions: "require_escalated"`，让 GUI 出现在 Default desktop。无需 GUI 的独立机器可设置 `$env:WXRC_HEADLESS = '1'` 运行；不会因此访问真实登录态页面。

## 回归范围与结果

本次一键验收通过：33 项离线测试、7 项 M4 Chromium 隔离故障检查、15 项 M5 Chromium 场景，TypeScript 与生产构建均通过，浏览器未观察到 pageerror。

| 范围 | M5 浏览器检查 |
| --- | --- |
| 数据与分页 | 2 页续传 syncKey／maxIdx、去重、排除其他章节、按 range 合并映射 |
| 评论浏览 | 正文／作者／引用搜索、组合筛选、无结果、清除恢复、排序、键盘展开引用、长评论全文及密度 |
| 设置与 UI | 5 项设置持久化、刷新重建、侧栏隐藏／恢复、日夜主题、900px 控件与 popup 边界 |
| 原生操作 | 非重合正文打开全部同段评论、重合原生划线不被抢占、独立 badge、原生工具栏和拖选 |
| 布局与热路径 | 字号／resize 复用评论并恢复原生方法；滚动、hover、侧栏滚动不新增映射或接口请求 |
| 生命周期 | 切章清空筛选与旧 popup、空章、慢请求加载状态、HTTP 失败重试、慢分页及延迟定位结果的跨章防护 |
| 数量与重复 | 800 条评论合并为 2 个 range、1 个映射 batch；重复布局及页面重建不重复侧栏、划线层或 popup |

性能验收以调用数量为判定依据：800 条评论只做一次包含 2 个 range 的批量映射；稳定滚动后 mapping batch 与评论请求的增量均为 0。JSON 中的耗时仅用于观察，不设置依赖机器性能的毫秒门槛，也不据此声称真实长书性能已全面通过。

## 测试发现并修复的问题

旧实现的分页取消条件只比较闭包中的 `activeChapterUid`。当同步仍在等待旧章网络请求时，切章同步被串行化，闭包值尚未更新，旧章会继续取下一页。

现在允许异步章节检查，在每页请求前及响应返回后核对当前章节。过期页不会合并进评论结果，也不会继续下载；浏览器用可控慢响应验证切到新章后旧章请求数保持 1，新章只显示自身评论。离线测试同时覆盖请求前取消与请求中切章。

## 本地产物

`.test-artifacts/m5/` 已加入忽略规则，包含：

- `report.json`：环境版本、场景结果、受控请求计数、耗时及性能摘要。
- `day-1600.png`、`night-1600.png`、`day-900.png`：夹具 UI 截图，捕获时禁用过渡动画。
- `failure.png`：失败时的受控页面截图；下一次成功时清除。

没有 HAR、storageState、cookies、token、真实评论原始响应或真实登录截图。测试结束关闭自己的 Chromium，并只清理本次创建的系统临时配置目录。

## 真实登录态本地手工复核清单

本轮未进行 M5 真实登录态复核；M4 的历史登录态记录不能替代修复后的回归。自动化不会跳过登录、保存登录态或在 CI 执行这些项目。

先构建，按 [M3 桌面启动说明](m3-real-reader-acceptance.md#桌面浏览器启动) 运行 `utils/m3-desktop-browser.cjs`，由用户扫码，再按以下清单操作。开发者工具仅观察公开接口路径和插件 DOM 的计数，记录汇总值即可，不导出网络响应或凭据。

| 手工操作 | 通过标准 |
| --- | --- |
| 打开评论较多的上下滚动章节 | 列表对应当前章，完整条数可核对；正常 range 可定位，失败项保留全文 |
| 搜索正文／作者／引用，组合定位条件并清除 | 结果符合全文，清除恢复原列表；不新增评论请求 |
| 改密度、排序、3 个开关并刷新 | 5 项设置保留；侧栏隐藏时可由入口恢复 |
| 日夜切换及约 900px 窗口 | 评论、控件可读，popup 不越界 |
| 原生重合划线与独立评论划线、数字 badge | 原生点击及拖选保持可用；插件 popup 内容正确，Enter／Escape 返回焦点 |
| 改字号、resize | 重新定位并复用评论，不为布局变化重新请求公开评论 |
| 布局稳定后滚动与 hover | `data-mapping-call-counts` 不变，公开评论接口不因滚动新增请求 |
| 网络较慢时切章，再等待旧请求结束 | 不追加旧章后续页，不显示旧章评论、划线或 popup；新章筛选清空 |

记录日期、浏览器／扩展版本、书籍和章节、汇总条数、上述结果以及观察到的限制。横向 Reader 的限制仍按 [M4 记录](m4-compatibility-acceptance.md) 处理；本阶段没有新增替代文本映射。
