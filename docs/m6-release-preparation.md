# M6 · v1.5.0-beta.1 发布准备

日期：2026-10-11。用户确认测试无问题，并要求提交推送代码、准备安装包和文案，由用户自行上传 Release。本轮打包准备完成，GitHub Release 尚未由代理创建。

## 版本与范围

- 目标仓库：`SoiTeoh/wx-read-comment-extension-enhanced`，分支 `enhanced`。
- 版本由 `1.4.0-beta.1` 升为 `1.5.0-beta.1`；`package.json`、锁文件与 manifest 同步。Chrome 数字版本为 `1.5.0`，显示版本为 `1.5.0-beta.1`。
- 汇总 M5 与 I0–I4。只增强上下滚动页面，左右双栏保持官方界面；撤出的横向实验不作为发布功能。
- 更新 README 计划进度、功能截图及中文更新记录；保留原项目来源与 MIT 许可。包元数据中的仓库地址改为当前增强版仓库。

## 检查结果

- 发布版本完整 `test:acceptance` 通过，退出码 0：66 项离线测试，56 项 Chromium 场景，TypeScript 与生产构建。
- 本地真实 Reader 入口与 UI 结果见 [I2](i2-vertical-text-operations.md)、[I3](i3-vertical-review-interactions.md)、[I4](i4-interaction-regression.md)；用户随后确认测试无问题。
- `DEBUG = false`；安装包不含 source map、源码、测试报告、测试浏览器 profile 或登录凭据。
- 权限仍为 `webRequest` 和 `storage`。前者仅观察站点请求以补充书籍身份，后者保存插件设置；host 范围仅 `https://weread.qq.com/*`，内容脚本限于 `/web/reader/*`。
- 没有增加自动回复提交或后台写入；回复最终提交、真实回复分页与完整点赞／取消点赞服务端往返未由代理验收，保持 Beta 并在文案中注明。

## 安装包核对

文件：`wx-read-comment-extension-enhanced-v1.5.0-beta.1.zip`，91,841 字节。

SHA-256：

```text
eacfd8e93482878d383dc1df2f063ddc99e92b383e7589d70ad525b0b869b339
```

ZIP 根目录仅含以下 6 个文件，每个文件的 SHA-256 与最终 `build` 中的对应文件一致：

- `manifest.json`
- `background.bundle.js`
- `contentScript.bundle.js`
- `pageBridge.bundle.js`
- `content.styles.css`
- `wxread-icon.png`

验证记录保存在忽略的 `.test-artifacts/release-1.5/package-verification.json`。ZIP 为项目构建命令生成的安装包，不是 GitHub 的源码压缩包。

## 上传信息

- Tag：`v1.5.0-beta.1`
- 标题：`微信读书评论增强版 v1.5.0-beta.1 · 纵向原文操作与想法互动`
- 文案：[v1.5.0-beta.1](releases/v1.5.0-beta.1.md)，提取自本次中文更新记录。
- 附件：上述安装 ZIP。
- 建议勾选 GitHub 的预发布选项（Pre-release）。

用户上传后即可下载 ZIP，解压并在 Chrome 开发者模式中加载含 `manifest.json` 的目录，随后刷新微信读书上下滚动页面。
