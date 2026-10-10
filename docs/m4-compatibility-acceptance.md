# M4 兼容性验收 · 2026-10-10

M4 的能力检测、失败提示和安全降级已实现。只在 `SoiTeoh/wx-read-comment-extension-enhanced` 的 `enhanced` 分支修改与提交。

## 行为

- 启动及每次映射前使用 `GET_CAPABILITIES` 只读检测 Reader 方法、画布与方法能否临时替换。探测本身不调用原生映射。
- 缺失能力、bridge 超时、章节身份不匹配、捕获失败或返回格式变化时，停止插件划线与定位，清理失效索引；保留完整公开评论、搜索和阅读。
- 侧栏按失败原因显示提示与「重试定位」，禁用暂不可用的划线和跟随设置，保留原设置值。
- 重试定位及布局失效复用已加载评论；正常评论重试仍可重新请求接口。
- 捕获过程中临时替换原生方法，成功或失败后均恢复原始 own descriptors；原来继承的方法不会永久变为 own property。
- 通过有界 Vue 树和 webpack 缓存遍历发现 Reader，移除固定模块 `1380`；保留原生 push 行为，观察失败不让原生 factory 失败。
- 身份桥接只返回当前 bookId／chapterUid，初始脚本被页面移除时仍优先使用当前 Reader 或原始 HTML 的结构数据，避免先取推荐书籍的 JSON-LD ID。
- 继续使用已有 range→rect 路径，不增加 DOM Range、EPUB 重排或模糊匹配补位。

## 离线与浏览器验证

`npm test`：30 项通过。新增覆盖缺失方法／画布、冻结对象、捕获 hook 部分失败回滚、原生方法抛错、异常返回格式、缓存章节不匹配、webpack 模块改名／冻结、bridge 超时、过期错误不覆盖新章、公共身份隔离、超过 700 个无关缓存模块后发现 Reader，以及降级提示保留评论。

`npm run test:browser:m4`：桌面可见 headed Chromium，真实加载扩展并拦截测试域名下页面与接口为受控 fixture。以下 7 项通过，评论接口只调用 1 次，全流程无 pageerror：

1. 正常 Reader 保留评论及 range→rect。
2. 缺失方法后清除划线和定位按钮，保留评论搜索、全文及原生操作。
3. 不兼容重试只检测能力，不重取评论或执行映射。
4. 方法恢复后自动恢复定位，不重取评论。
5. 原生 rect 返回格式变化时降级，精确恢复 hook，布局变化后可恢复。
6. 画布丢失时降级，恢复后重新定位。
7. 稳定滚动不执行 range 映射或重取评论。

TypeScript 检查与生产构建通过。隔离浏览器测试使用模拟数据，与下面的真实登录态检查分别记录。

## 真实登录态 Reader 回归

用户扫码后，在 Windows Default desktop 的 headed Playwright Chromium 中加载最终生产构建，打开《明朝那些事儿（全集）》。未读取或导出登录凭据。

- 上下滚动模式的「引子」（chapterUid 379）加载 483 条公开评论，40 个 range 全部映射成功，能力状态 `READY`。
- 原生字号变更后仍有 40 个成功 range；窗口 resize 后恢复正常映射。CDP Network 记录确认单独布局变化无 `/web/review/*` 新请求。
- 稳定正文滚动前后 mappingCallCounts 保持不变。
- 公开想法徽标用 Enter 打开 popup，Escape 关闭后焦点返回原徽标。
- 切到 chapterUid 380 后评论更新为 14 条；该章的 1 个 range 未定位，安全保留评论，不使用替代文本映射。回到 chapterUid 379 再次得到 483 条评论及 40 个成功 range。
- 横向翻页模式显示明确降级提示，原生「下一页」可操作；切回上下滚动模式后 chapterUid 381 加载 123 条评论，16 个 range 全部成功。全过程未观察到 pageerror。

限制：本项目正文定位仍针对上下滚动 Reader。横向模式本次未取得可靠章节身份，初始侧栏显示评论加载失败；提示可引导切回支持模式。故障后的已加载评论保留由隔离测试覆盖，不把横向模式视为完整评论浏览验收通过。

## 复跑

```powershell
npm.cmd ci --no-audit --no-fund
npm.cmd test
node node_modules/typescript/bin/tsc --noEmit
npm.cmd run build
$env:PLAYWRIGHT_MODULE_PATH = 'D:\Codex\idea-lab\.m3-browser-tools\node_modules\playwright'
npm.cmd run test:browser:m4
```

Playwright 使用独立工具目录，不加入项目依赖。如未安装，先在该目录安装 Playwright 及 Chromium。由 Agent 执行 headed GUI 时使用提升权限的 `exec_command`，沿用已确认可见的 Windows desktop 启动方式。

复跑真实 Reader 检查需用户扫码；不要把受控 fixture 结果替代登录态验收。
