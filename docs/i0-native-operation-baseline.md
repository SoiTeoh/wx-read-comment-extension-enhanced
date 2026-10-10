# I0 · 原生阅读操作与想法互动基线

日期：2026-10-10。范围：核实原生行为、建立只读能力检测和提供界面预览。尚未接入插件点赞、划线写入、发布或回复提交。

## 真实页面核实

使用提升权限的 `exec_command` 启动桌面可见 Playwright Chromium，用户扫码登录。在《明朝那些事儿（全集）》版权信息章分别查看上下滚动和左右翻页模式。未导出 cookies、token 或 storageState。

- 上下滚动：拖选原文后，原生工具栏显示复制、马克笔、波浪线、直线、写想法和 AI 问书。点击“写想法”打开空白原生编辑器，未输入或提交内容；该检查期间未观察到评论写请求。
- 左右翻页：点击原生划线后打开热门想法面板，顶部显示复制、划线、写想法、AI 问书；想法卡片底部有点赞与评论入口。点击卡片评论入口后打开对应想法详情和空白“发表评论…”输入框，未提交。
- 原生选区显示高亮及工具栏时，`window.getSelection().toString()` 仍为空。I1/I2 必须核实原生 `contentObjs`、range、章节与选区文本，不能用浏览器 DOM Selection 是否有文本判断原生选区是否存在。
- 上下滚动 Reader 可发现操作方法候选；左右翻页 Reader 本轮探测未发现组件入口。原生 UI 的存在和插件可调用能力是两个独立结论。横向发现路径与上下文适配留给 I1，不能宣称横向已支持。

## 能力矩阵与候选契约

候选契约来自当前页面的[官方 Reader 脚本](https://cdn.weread.qq.com/web/wrwebnjlogic/js/9.cab69770.js)和[官方数据操作脚本](https://cdn.weread.qq.com/web/wrwebnjlogic/js/2.8c461fc1.js)。它们是本次版本的实现观察，不是公开稳定 API；本阶段未调用这些函数进行写入，也未验证插件参数传递。后续必须对当前模式、组件和方法逐项核实。

| 操作 | 原生入口／候选参数 | 原生结果与本次验证 | 下一阶段必须核实 |
| --- | --- | --- | --- |
| 复制 | Reader `copyText(text)`；原文文本从原生选区对象提取 | 脚本中执行原生复制并返回复制结果；工具栏已观察，未改写用户剪贴板 | 选区文本提取、章节一致性、复制失败反馈；排除复制代码和整本笔记的同名方法 |
| 划线 | 面板 `handleUnderline()` 使用当前 `contentObjs` 并发出样式、颜色参数；Reader 侧存在 `handleFloatPanelUnderlineObjs` 候选 | 原生工具栏及三种样式已观察；未点击写入按钮，纵向探测本轮未发现该候选方法 | 个人划线写入／删除入口、已划线状态、内容对象与模式对应关系；`handleClickUnderline` 打开原生选区，不能当作新增个人划线函数 |
| 写想法 | Reader `showWriteReviewPanel(contentObjs)`／`handleWriteReview` | 实测打开空白原生编辑器；发布在编辑器提交回调中发生 | 原文对象、range、书籍和章节传递；保留原生公开／私密选项及用户提交流程 |
| AI 问书 | Reader `showAiChatPanel(text)`；原生逻辑检查登录并向自身 AI 面板传入文本 | 两种模式入口已观察；未触发 AI 生成 | 选区文本传递、原生登录／不可用状态、打开与生成的边界 |
| 点赞／取消点赞 | 面板 `handleReviewLikeClick(entry)`，其中 `entry.reviewId` 是目标，`entry.review.isLike` 决定 `isUnlike`；候选请求 `/web/review/like` | 脚本显示服务端结果后更新状态和数量；卡片入口已观察，未执行点赞 | 两种模式的条目结构、成功／失败语义、本人状态、幂等与重复点击处理 |
| 回复想法 | 卡片 `handleReviewCommentClick(entry)` 打开详情；详情 `openCommentInput()` 打开输入。原生提交使用 `reviewId`、`content`，楼中楼还涉及 `toCommentId`、`toUserVid`；候选请求 `/web/review/comment` | 实测详情与空白输入框打开；未调用提交 | 回复目标与楼中楼上下文、原生编辑器复用、登录失效、失败恢复和提交结果 |
| 查看回复 | Reader `showReviewDetailPanel` 与详情 `loadComment`／`loadMoreSubComment` 候选；详情面板接收对应想法条目 | 原生详情已实测；纵向可发现详情读取方法候选 | 首屏与分页数据契约、返回位置、原文上下文、切章迟到响应 |

所有操作在 I0 输出中均为 `callable: false`。`observed: true` 只表示发现白名单组件上的白名单方法，不能代表参数已验证、账户具备权限或操作可以成功。组件遍历最多 500 项，输出 `truncated` 表示是否有候选未检查；“未发现”不等于原生不存在。

## 本阶段开发成果

- `nativeOperationBaseline.js`：按复制、划线、写想法、AI、点赞、回复和回复读取分别报告方法证据及未接通原因。只读取数据属性描述符，不执行计算属性、方法或写接口；白名单限制组件角色，排除代码编辑器复制等同名操作。
- Reader bridge 新增 `GET_NATIVE_OPERATION_BASELINE`／`NATIVE_OPERATION_BASELINE_RESULT`。只返回操作名称、对象类型、组件／方法名称和状态，不返回用户对象、选区全文、账户信息或会话数据。
- `utils/i0-native-inspect.cjs`：显式连接本地桌面测试浏览器，生成不含凭据的能力记录。探测不执行原生按钮点击，结束后只断开 CDP，保留测试浏览器。
- [日夜主题布局预览](previews/i0-interaction-preview.html)及[日间截图](previews/i0-interaction-preview.png)：直接复用项目现有 CSS 的 tonal palette、popup 和卡片样式。顶部原文操作、底部单条想法互动保持对象区分；示例内容及禁用按钮均有明确标识。这是后续 I2/I3 的界面预览，不是已安装扩展的新互动功能。

## 验收与复现

`npm run test:acceptance` 通过：38 项单元测试、TypeScript 类型检查、生产构建、7 项 M4 Chromium 兼容性场景和 15 项 M5 Chromium UI／生命周期／性能场景。新增测试覆盖只读探测、敏感状态排除、访问器不执行、组件角色过滤、Vue 继承选项、有界遍历／截断和 bridge 接口独立性。

预览在真实桌面 Chromium 中打开，日夜切换正常，500px 窄窗口无横向溢出，8 个未接通操作按钮均为禁用状态。

在已启动的本地桌面 Chromium 上手动打开 Reader、完成登录及选择阅读模式后运行：

```powershell
$env:PLAYWRIGHT_MODULE_PATH = 'D:\Codex\idea-lab\.m3-browser-tools\node_modules\playwright'
$env:WXRC_INSPECTION_LABEL = 'horizontal' # 或 vertical；标签由操作者确认
node utils/i0-native-inspect.cjs
```

默认连接 `http://127.0.0.1:9231`，可用 `WXRC_CDP_URL` 指定当前本地测试浏览器。记录写入被 Git 忽略的 `.test-artifacts/i0/native-baseline-horizontal.json` 或 `native-baseline-vertical.json`；脚本不自动登录或提交。

下一步 I1：解决左右翻页 Reader 发现及选区／章节／页码上下文，验证两种模式的原生对象与正文定位。I2 再接通顶部操作，I3 再接通点赞和回复，当前版本仍保持评论只读。
