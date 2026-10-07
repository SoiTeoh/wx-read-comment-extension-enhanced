# M3 真实 Reader 验收 · 2026-10-07

结论：M3 评论浏览验收通过。使用提升权限的 `exec_command` 启动桌面可见的 Playwright headed Chromium，加载本地 `build` 扩展，由用户扫码登录真实微信读书。未模拟接口响应，未导出登录凭据。

## 验收结果

《明朝那些事儿（全集）》版权信息章加载 237 条真实公开评论：194 条可定位、43 条暂不可定位，22 个 range 映射成功、3 个失败。切至引子章后加载 483 条评论。

| 检查 | 结果 |
| --- | --- |
| 作者、正文、引用关键词 | 分别筛出 1、1、41 条，ID 与完整列表派生的预期一致 |
| 无结果、组合筛选、清除 | 提示正常，恢复完整条数和原顺序 |
| 可定位／暂不可定位 | 分别显示 194／43 条 |
| 接口顺序／阅读顺序 | 清除筛选恢复对应排序 |
| 密度与全文 | 内边距从 17px 18px 变为 10px 12px；905 字长评论全文保留 |
| 密度持久化 | 刷新后仍为紧凑，完整评论重新加载 |
| 正文 popup | 侧栏筛空后鼠标仍能打开原有想法；修复后 Enter 打开同段全部 151 条，Escape 返回划线焦点 |
| 日间／夜间主题 | 真实主题切换后浏览与筛选正常 |
| 900px 窄窗口 | 控件在视口内；修复后搜索框为 36px 高 |
| 切章 | 从 378 切到 379；搜索与定位条件清空，新章显示全部 483 条 |
| 稳定布局下过滤和滚动 | 全浏览器监听 `/web/review/list`，真实加载校准后请求数 4→4；`GET_RECTS_BATCH` 次数 2→2 |
| 修复版网页异常 | 无 `pageerror` |

初次加载期间观察到额外布局映射，零增量验收在布局稳定后进行；本次不把初始化映射计为滚动热路径回归。

## 本次修复与验证

- 划线 Enter 处理遗漏 `group` 参数，触发 `Cannot read properties of undefined (reading 'key')`。已补参数，并在真实页面验证完整同段 popup 和焦点恢复。
- 通用 input 样式让搜索框继承复选框的 16px 高度。已限定复选框类型，并给搜索框设置 36px 最小高度和单列标签布局。

修复后重新加载 Chromium 中的扩展再刷新 Reader；14 项离线测试、TypeScript 检查及生产构建通过。Playwright 安装在独立工具目录，项目依赖已按原锁文件恢复，未变更 package.json 或 package-lock.json。

## 桌面浏览器启动

```powershell
npm.cmd install --prefix D:\Codex\idea-lab\.m3-browser-tools --no-save --package-lock=false playwright
D:\Codex\idea-lab\.m3-browser-tools\node_modules\.bin\playwright.cmd install chromium
$env:PLAYWRIGHT_MODULE_PATH = 'D:\Codex\idea-lab\.m3-browser-tools\node_modules\playwright'
node utils/m3-desktop-browser.cjs
```

由 Agent 启动时使用 `exec_command` 的 `sandbox_permissions: "require_escalated"`，沿用已验证可见的 Windows desktop 启动方式。脚本保持浏览器打开，并提供仅绑定本机地址的 CDP 9231 端口供后续测试连接；临时配置位于系统临时目录。用户仍需扫码登录。

机器可读结果和截图存放在本地 `D:\Codex\idea-lab\m3-acceptance-2026-10-07`，不包含 cookies、token 或原始接口响应。本次覆盖所列章节及视口，未声称覆盖所有书籍或 Reader runtime 版本。
