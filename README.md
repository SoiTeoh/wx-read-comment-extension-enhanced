# 微信读书评论增强版

基于原项目 [wx-read-comment-extension](https://github.com/my19940202/wx-read-comment-extension) 开发的非官方增强版本，面向微信读书网页版的上下滚动阅读模式。本仓库为 [SoiTeoh/wx-read-comment-extension-enhanced](https://github.com/SoiTeoh/wx-read-comment-extension-enhanced)，与原作者发布的扩展相互独立。

当前版本：**v1.2.0-beta.1**。

## 主要功能

- 在上下滚动阅读模式中查看其他用户的公开评论划线，点击插件划线可查看对应想法。
- 插件划线与微信读书原生划线有不同样式；两者重合时，可点击数字 badge 查看该段的公开评论，正文点击仍保留原生操作。
- 按需显示右侧评论栏：阅读时高亮附近的评论，也可点击可定位的侧栏评论跳到正文。
- 侧栏支持阅读顺序与接口顺序切换，并继续加载后续页的公开评论。
- 支持日间／夜间模式；划线、侧栏和跟随阅读位置等设置在刷新后保留。

## 技术特性

- 长章节点击使用已缓存 rect 的 coordinate hit-test，不依赖插件划线成为页面最上层元素。
- 使用章节与 layout version 校验异步映射结果，丢弃过期的结果（stale async result 防护）。

## 效果预览

### 公开评论划线与想法弹窗

插件会在可映射到正文的公开评论位置绘制可点击划线，点击后可直接查看对应公开想法。

![公开评论划线与想法弹窗](./src/assets/img/preview-public-comment.png)

### 原生划线与公开评论重合

当微信读书原生划线与公开评论位置重合时，正文点击仍保留微信读书原生操作；旁边的数字 badge 可用于查看对应公开评论。

![原生划线与公开评论重合](./src/assets/img/preview-overlap-badge.png)

### 可选右侧评论栏

右侧评论栏可以自由开启或关闭，支持阅读顺序 / 接口顺序切换，以及正文与评论之间的定位联动。

![右侧评论栏](./src/assets/img/preview-sidebar.png)

### 夜间模式

插件划线、popup、badge 和评论栏均适配微信读书夜间模式。

![夜间模式](./src/assets/img/preview-night-mode.png)

## 安装方式

### 本地开发安装

1. 克隆本仓库，进入项目目录后运行 `npm install`。
2. 运行 `npm run build`，生成 `build` 目录。
3. 在 Chrome 打开 `chrome://extensions`，开启“开发者模式”。
4. 点击“加载已解压的扩展程序”，选择本项目的 `build` 目录。

也可以从本仓库的 [GitHub Releases](https://github.com/SoiTeoh/wx-read-comment-extension-enhanced/releases) 下载增强版 zip，解压后按上述方式加载。请勿将原项目商店版本或旧版安装包误认为本增强版。

### 本地安装示意

下图是原项目保留的 Chrome 扩展加载示意，仅用于说明“加载已解压的扩展程序”的操作；请以本项目的 `build` 目录为准。

![Chrome 本地加载扩展示意](./src/assets/img/tutorial.jpg)

## 使用说明

在微信读书网页版打开书籍并切换到上下滚动模式。插件只为成功映射到正文的公开评论绘制可点击划线。

- **显示可点击评论划线**：控制插件划线的显示，不改变微信读书原生划线。
- **显示右侧评论栏**：关闭后正文恢复宽度；公开评论划线及点击 popup 仍可使用。
- **跟随阅读位置**：开启后，侧栏高亮靠近当前阅读位置的已映射评论；点击侧栏中可定位的评论可跳转到正文。
- **排序**：可选择按正文 `range.start` 排列的“阅读顺序”，或保持接口返回次序的“接口顺序”。
- **重合划线 badge**：当插件公开评论划线与原生划线重合时，点击正文保留微信读书操作；点击旁边的数字 badge 查看该 range 的公开评论，数字表示评论条数。

## 已知限制

- 仅展示微信读书接口返回的公开评论／公开想法；不读取、模拟或推测私密评论。
- 微信读书原生划线不一定对应公开评论，原生划线本身不保证可打开插件 popup。
- 部分历史 `range` 可能因正文版本或 Reader layout 不匹配而无法映射；此类评论仍可在侧栏查看，但不能定位到正文。
- 当前不支持点赞、回复、发布，也不调用评论写接口。
- 微信读书前端更新可能影响内部 Reader runtime 的兼容性。

## 开发状态

Current status: **Local Beta / v1.2.0-beta.1**。

后续计划：UI/UX 重设计、popup 优化、badge 优化、评论过滤与密度控制、当前视口评论模式、自动化回归测试、兼容性增强。这些是规划，不代表当前版本已经提供。

## 来源与许可

本项目基于 [原项目 wx-read-comment-extension](https://github.com/my19940202/wx-read-comment-extension) 开发，并非原作者的官方版本。项目沿用 MIT License；原作者版权声明保留在 [LICENSE](LICENSE) 中。

Maintainer: SoiTeoh

Email: <z993851877@gmail.com>
