# Chrome Web Store Listing — 微信读书评论增强版

> Last Updated: 2026-11-22

## Store Listing

**Extension Name** [REQUIRED]
微信读书评论增强版

**Short Description** [REQUIRED]
在微信读书网页版上下滚动阅读时显示公开评论划线，支持点击查看想法、点赞回复入口、评论侧栏与本地收藏导出。

**Detailed Description** [REQUIRED]
在微信读书网页版使用上下滚动模式阅读时，直接在正文旁查看其他读者的公开评论划线与想法，无需频繁切页或离开当前阅读位置。

核心功能：
1. 公开评论划线与弹窗：为可映射到正文的公开评论绘制可点击划线；当与个人原生划线重合时保留原生操作，并在正文右侧页边显示聚合数字标记，不遮挡文字。
2. 原文操作与想法互动：评论弹窗顶部提供复制、划线、写想法与 AI 问书入口；想法卡片支持点赞、取消点赞及打开官方回复详情页。
3. 可选右侧评论栏：支持跟随阅读位置高亮、点击定位正文、按阅读顺序/接口顺序/点赞最多排序、全文搜索、作者筛选与舒适/紧凑密度切换。
4. 长评论浏览与阅读辅助：同段想法分批加载、长评论折叠展开、字号或侧栏切换后保持阅读位置，并提供可选阅读快捷键。
5. 本地收藏与导出：支持将主动选中的公开想法保存在浏览器本地，随时搜索、管理或导出为完整 Markdown 笔记。
6. 兼容性诊断：内置脱敏诊断报告导出，仅包含版本与功能可用状态，不包含账号凭据或书籍正文。

使用说明：
打开微信读书网页版书籍阅读页并切换到“上下滚动”模式即可自动启用（左右双栏保留官方原始界面）。

隐私声明：
本扩展仅在 https://weread.qq.com/* 站点运行，所有设置与本地收藏均保存在浏览器本地存储中，不收集、上传或向第三方出售任何个人数据或阅读内容。

**Category** [REQUIRED]
Productivity

**Single Purpose** [REQUIRED]
在微信读书网页版上下滚动阅读页面展示公开评论划线、评论侧栏及本地收藏管理。

**Primary Language** [REQUIRED]
Chinese (Simplified)

## Graphics & Assets

| Asset | Dimensions | Status | Filename |
|-------|-----------|--------|----------|
| Store Icon [REQUIRED] | 128×128 PNG | ✅ Ready | `src/assets/img/icon-128.png` |
| Toolbar / Extension Icons | 16×16, 48×48 PNG | ✅ Ready | `src/assets/img/icon-16.png`, `src/assets/img/icon-48.png` |
| Screenshot 1 [REQUIRED] | 1280×800 | ✅ Ready | `docs/previews/preview-public-comment.png` |
| Screenshot 2 [RECOMMENDED] | 1280×800 | ✅ Ready | `docs/previews/preview-sidebar.png` |
| Screenshot 3 [RECOMMENDED] | 1280×800 | ✅ Ready | `docs/previews/u3-favorites-day.png` |
| Screenshot 4 | 1280×800 | ✅ Ready | `docs/previews/i3-vertical-day.png` |

## Permissions Justification

| Permission | Type | Justification |
|------------|------|---------------|
| `storage` | permissions | Used to save user preferences (sidebar visibility, underline visibility, sort order, density, keyboard shortcuts) and user-selected local favorite public thoughts in `chrome.storage.local`, and temporary per-tab book context in `chrome.storage.session`. |
| `webRequest` | permissions | Used on `https://weread.qq.com/web/reader/*` and `https://weread.qq.com/web/review/*` strictly as a fallback to identify the active `bookId` for the current reader tab and detect when the user submits or deletes a review so the chapter comment list can refresh automatically. |
| `https://weread.qq.com/*` | host_permissions | Scoped exclusively to WeRead web pages so the extension can inject its reader enhancement UI and read public review data on the reader page. |

## Privacy & Data Use

### Data Collection

**Does the extension collect user data?** No

All preferences and locally favorited public thoughts remain exclusively in the user's browser (`chrome.storage.local` / `chrome.storage.session`) and are never transmitted to any developer-controlled server or third party.

### Data Use Certification
- [x] Data is NOT sold to third parties
- [x] Data is NOT used for purposes unrelated to the extension's core functionality
- [x] Data is NOT used for creditworthiness or lending purposes

## Developer Info

- **Publisher Name**: SoiTeoh
- **Contact Email**: z993851877@gmail.com
- **Homepage / Support URL**: https://github.com/SoiTeoh/wx-read-comment-extension-enhanced

## Version History

| Version | Date | Changes | Status |
|---------|------|---------|--------|
| 1.6.0 | 2026-11-22 | U1–U5 complete: progressive browsing, reading position restore, local favorites & Markdown export, likes sorting & author filtering, dynamic right-margin overlap badges, compatibility diagnostics, multi-size icons | Ready |
