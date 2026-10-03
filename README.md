# 微信读书评论增强版（1.2.0-beta.1）

这是基于 [wx-read-comment-extension](https://github.com/my19940202/wx-read-comment-extension) 的本地增强版本。Based on wx-read-comment-extension, with additional support for public review underlines, range-to-rect mapping, popup comments and optional sidebar sync.

主要增强：微信读书上下滚动模式的公开评论划线；点击正文划线查看公开想法；原生划线与插件可点击划线的视觉区分；可选右侧评论栏；正文与评论双向定位；阅读顺序／接口顺序切换；日夜模式适配；用户设置持久化；评论分页；迟到异步结果防护。

限制：插件只展示接口返回的公开评论／公开想法，不读取或推测私密评论。微信读书原生划线不一定对应公开评论，因此部分原生划线不可点击。部分历史 range 可能因当前正文版本或 Reader 布局不匹配而无法映射。本增强版不提供点赞、回复、发布功能，也不调用评论写接口。

本地安装：运行 `npm install`、`npm run build`，在 Chrome 的 `chrome://extensions` 开启开发者模式，选择“加载已解压的扩展程序”，选中本仓库的 `build` 目录。Chrome 扩展卡片将显示“微信读书评论增强版”及 `1.2.0-beta.1`。

## 原项目说明（保留）

以下商店链接、预览和规划来自原项目，并非本地增强版的发布页面或功能承诺。

### 微信读书评论插件-适用于PC浏览器
A chrome extension show comments for weread.qq.com <br/>
一个让网页微信读书页面显示评论的插件，了解他人的见解，解答阅读中的困惑, 不做一个孤独的阅读者。

目前已发布到插件商店,可以直接安装
- [Chrome插件商店](https://chromewebstore.google.com/detail/kfjimgaoegibikoojcbnkbffkongnoep)
- [Edge插件商店](https://microsoftedge.microsoft.com/addons/detail/%E5%BE%AE%E4%BF%A1%E8%AF%BB%E4%B9%A6%E8%AF%84%E8%AE%BA%E6%8F%92%E4%BB%B6/dpihhfdnbndfhonhkbnnhojbnaeedabc)

## 效果预览
请求微信评论接口数据，侧边栏渲染评论数据，支持评论引用原文的展开和收起
<img src="./src/assets/img/preview-day.jpg">
<img src="./src/assets/img/preview-night.jpg">

## 使用方法
<ol>
    <li>
        方法一: <a href="https://chromewebstore.google.com/detail/kfjimgaoegibikoojcbnkbffkongnoep">Chrome应用商店安装</a>
    </li>
    <li>方法二: <a href="https://github.com/my19940202/wx-read-comment-extension/raw/main/微信读书评论-2024-05-14.zip">手动下载插件</a> 再打开chrome://extensions/&nbsp; 页面导入安装插件</li>
</ol>
<img src="./src/assets/img/tutorial.jpg">

## 原项目功能规划（本增强版不包含写功能）
1. 界面交互优化
2. 支持评论排序
3. 支持点赞 发表评论等

## 产品改进建议沟通
<img width="200" src="./src/assets/img/wx-qrcode.jpg">

## 赞助
[![Powered by DartNode](https://dartnode.com/branding/DN-Open-Source-sm.png)](https://dartnode.com "Powered by DartNode - Free VPS for Open Source")
