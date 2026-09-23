# 句得 · 句句有所得

边看视频，边学英语。支持哔哩哔哩与 YouTube 的双语字幕、查词、词句收藏和复习。

## 手机网页体验

**[打开手机交互演示](https://wuxinyu-web.github.io/jude/)**

iPhone Safari、Chrome 和电脑浏览器均可直接打开。播放原创示例课堂，点击单词查看预置释义、切换双语字幕、收藏单词和整句；收藏仅保存在当前设备。

这是独立网页演示，不会读取其他视频页面，不需要 API 密钥，也不是手机浏览器扩展。演示语音由系统语音合成生成。

### iPhone Safari 扩展预览

[下载未签名 Xcode 工程](https://gitcode.com/AlyssaWu/jude/releases/download/v1.22.0/jude-iphone-safari-1.22.0-project.zip) · [查看 iPhone 安装说明](IPHONE.md)

Safari 扩展需要开发者签名和真机安装，目前没有 IPA 或 TestFlight 安装入口。iPhone Chrome 不能安装此扩展；可使用上面的独立网页演示。

## v1.22.0 更新

- Windows 与 macOS 均支持可选的本地英文原声转写；视频没有字幕时也可从实际音频识别英文。
- Windows 使用 faster-whisper CPU int8，本地处理，不消耗云端模型 Token。
- 新增移动端独立导出入口，以及 Excel 导出；生词、长难句分别放在独立 Sheet。
- 优化左右结构的产品主界面，并完善家长模式说明和测试机制。
- 保留免登录本地模式；只有开启跨设备同步时才需要邮箱验证码登录。

## 下载与安装

### 1. Chrome 扩展（必须下载）

**[下载句得 Chrome 扩展 v1.22.0](https://gitcode.com/AlyssaWu/jude/releases/download/v1.22.0/youtube-digest-v1.22.0.zip)**

这是需要加载到 Chrome 的扩展本体，解压后的文件夹中包含 `manifest.json`。

### 2. Windows 本地字幕识别助手（可选）

**[下载 Windows 本地字幕识别便携包](https://gitcode.com/AlyssaWu/jude/releases/download/v1.22.0/jude-local-asr-windows-portable-v1.22.0.zip)**

仅在 B 站等视频没有可用字幕、需要识别英文原声时安装。**这个包不能加载到 Chrome**；请单独解压后双击 `install-windows.cmd`。

### 3. macOS / 源码版字幕识别助手（可选）

[下载 macOS / 源码包](https://gitcode.com/AlyssaWu/jude/releases/download/v1.22.0/jude-local-asr-v1.22.0.zip) · [查看所有版本](https://gitcode.com/AlyssaWu/jude/releases)

下面的扩展安装步骤只适用于第 1 个 `youtube-digest-v1.22.0.zip`：

1. 下载第 1 个 `youtube-digest-v1.22.0.zip` 并解压。
2. 在桌面 Chrome 地址栏输入 `chrome://extensions`，打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择直接包含 `manifest.json` 的文件夹。
4. 打开哔哩哔哩或 YouTube 视频，点击「句得」扩展。安装后请保留该文件夹。

更新时用新版本替换原文件夹内容，在扩展管理页点击重新加载，再刷新视频页面。不要卸载旧扩展，以免丢失本机数据。

## 可以做什么

- 双语字幕与沉浸阅读，点击字幕跳转播放，跟随播放滚动。
- 悬停英文查词，选中句子收藏，收藏库翻卡复习。
- 自动记录有效学习时间，七天柱状图，导出 Excel。
- 下载纯讲义或讲义＋测试题 Word 文件。
