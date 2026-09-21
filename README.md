# 句得 · 句句有所得

边看视频，边学英语。支持哔哩哔哩与 YouTube 的双语字幕、查词、词句收藏和复习。

## 手机网页体验

**[打开手机交互演示](https://wuxinyu-web.github.io/jude/)**

iPhone Safari、Chrome 和电脑浏览器均可直接打开。播放原创示例课堂，点击单词查看预置释义、切换双语字幕、收藏单词和整句；收藏仅保存在当前设备。

这是独立网页演示，不会读取其他视频页面，不需要 API 密钥，也不是手机浏览器扩展。演示语音由系统语音合成生成。

### iPhone Safari 扩展预览

[下载未签名 Xcode 工程](https://github.com/wuxinyu-web/jude/releases/download/v1.22.0/jude-iphone-safari-1.22.0-project.zip) · [查看 iPhone 安装说明](IPHONE.md)

Safari 扩展需要开发者签名和真机安装，目前没有 IPA 或 TestFlight 安装入口。iPhone Chrome 不能安装此扩展；可使用上面的独立网页演示。

## v1.22.0 更新

- Windows 与 macOS 均支持可选的本地英文原声转写；视频没有字幕时也可从实际音频识别英文。
- Windows 使用 faster-whisper CPU int8，本地处理，不消耗云端模型 Token。
- 新增移动端独立导出入口，以及 Excel 导出；生词、长难句分别放在独立 Sheet。
- 优化左右结构的产品主界面，并完善家长模式说明和测试机制。
- 保留免登录本地模式；只有开启跨设备同步时才需要邮箱验证码登录。

## 下载与安装

**[下载句得 v1.22.0](https://github.com/wuxinyu-web/jude/releases/download/v1.22.0/youtube-digest-v1.22.0.zip)** · **[下载 Windows 本地字幕识别便携包](https://gitcode.com/AlyssaWu/jude/releases/download/v1.22.0/jude-local-asr-windows-portable-v1.22.0.zip)** · [下载 macOS / 源码包](https://github.com/wuxinyu-web/jude/releases/download/v1.22.0/jude-local-asr-v1.22.0.zip) · [查看所有版本](https://github.com/wuxinyu-web/jude/releases)

1. 下载上面的 `youtube-digest-v1.22.0.zip` 并解压。
2. 在桌面 Chrome 地址栏输入 `chrome://extensions`，打开右上角「开发者模式」。
3. 点击「加载已解压的扩展程序」，选择直接包含 `manifest.json` 的文件夹。
4. 打开哔哩哔哩或 YouTube 视频，点击「句得」扩展。安装后请保留该文件夹。

更新时用新版本替换原文件夹内容，在扩展管理页点击重新加载，再刷新视频页面。不要卸载旧扩展，以免丢失本机数据。

## 可以做什么

- 双语字幕与沉浸阅读，点击字幕跳转播放，跟随播放滚动。
- 悬停英文查词，选中句子收藏，收藏库翻卡复习。
- 自动记录有效学习时间，七天柱状图，导出 Excel。
- 下载纯讲义或讲义＋测试题 Word 文件。
- 可选家长模式：家长设置密码，本集任务或测试达标后继续观看。

## 首次设置

- **DeepSeek 密钥**：用于释义、翻译、句子分析、出题和判题，需要填写使用者自己的密钥，服务商可能收费。
- **Supadata 密钥（YouTube 可选）**：用于 YouTube 字幕获取；无字幕音频生成需确认。
- B 站优先读取网站字幕，是否能读取取决于视频字幕轨和当前账号权限。
- 收藏、复习、Excel 和 Word 导出在本机完成，不需要借用发布者账号。

## 没有字幕怎么办

可选的本地英文原声转写助手需要单独安装。Windows 推荐下载已包含便携 Python 和依赖的 [Windows 便携包](https://gitcode.com/AlyssaWu/jude/releases/download/v1.22.0/jude-local-asr-windows-portable-v1.22.0.zip)；macOS 或需要源码安装时下载 [通用包](https://github.com/wuxinyu-web/jude/releases/download/v1.22.0/jude-local-asr-v1.22.0.zip)。解压后按包内 README 安装并启动；首次使用会下载语音识别模型。本地助手不包含在扩展 ZIP 中，不需要购买云端模型 Token。

本地转写会临时使用内存和磁盘；正常结束、失败或取消时清理临时音频，模型保留供复用。它不能绕过付费、地区或 DRM 限制，不保证所有视频均可识别。

## 数据与家长模式

学习记录、收藏和配置保存在当前浏览器本机。学习记录保留 90 天；AI 操作会把相关词句或字幕上下文发送给所配置的服务商。具体说明见扩展包内 `PRIVACY.md`。

家长密码只保存加盐哈希，请自行保管。家长模式只限制此浏览器中扩展支持的视频页面，并非系统级家长控制。

## 源码与许可

这是句得的下载发布仓库。扩展采用原生 HTML/CSS/JavaScript，源码随扩展 ZIP 提供，可直接查看；本地转写服务源码随独立 ZIP 提供。

本项目基于 [zarazhangrui/youtube-digest](https://github.com/zarazhangrui/youtube-digest) 二次开发，并针对双语字幕、词句收藏、复习与本地转写等功能进行了修改。项目遵循 MIT 许可证，第三方库许可随包提供。详见 [LICENSE](https://github.com/wuxinyu-web/jude/blob/main/LICENSE)。
