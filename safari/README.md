# Jude iPhone Safari 预览版

目标系统为 iOS 18 或更新版本。此版本运行于 Safari 视频网页，不能安装到 iPhone Chrome，也不能注入 YouTube/B站原生 App。

## 已实现

- Safari 页面菜单入口；m.youtube.com、m.bilibili.com 的页面学习按钮。
- 视频在上、完整学习区在下；字幕、概览、词句收藏、学习记录复用现有逻辑。可切换专注字幕并返回完整学习区。
- 短点单词查词；长按使用系统选区，再收藏句子。滑动不触发查词。
- 动态视口、底部安全区、触摸按钮及可拖动分隔线；保留原视频节点。
- 收藏库提供独立“导出 Excel”按钮；生成“生词”和“长难句”两张表，优先通过系统分享面板保存到“文件”或发送到其他应用。
- 删除 Chrome sidePanel 依赖与电脑回环服务权限。iPhone 不支持电脑本地 ASR；原生字幕及显式确认后的 YouTube 提供商转写沿用原有流程。

## 本地生成

在仓库根目录运行 `npm run package:safari` 生成 Safari 扩展资源，或 `npm run project:ios` 生成带完整资源的 Xcode 工程。需要 macOS、Xcode 和 Node.js。生成器不会覆盖已有 Xcode 工程，以免损坏手动配置的签名。

## 安装到自己的 iPhone

1. 打开生成目录中的 `Jude/Jude.xcodeproj`。
2. 在主 App 与 Jude Extension 两个 target 的 Signing & Capabilities 中选择自己的开发团队，必要时替换为自己可用的 Bundle Identifier。工具不会读取或选择你的签名身份。
3. 连接并信任 iPhone，按 Xcode 提示开启开发者模式，选择该设备，运行 App。
4. 在 iPhone 设置的 Safari 扩展中启用句得，在视频网站上授予访问权限。通过 Safari 的句得菜单配置服务，再打开学习区。

工程 ZIP 不是可直接安装的 IPA。真机安装需要 Apple 开发签名；本项目未上传 App Store 或 TestFlight。免费个人团队可用性和有效期以 Xcode 提示为准。

## 数据与边界

收藏、学习记录和服务设置保存在当前设备的扩展存储中，不自动同步电脑。需要在手机另行配置自己的服务凭据。字幕、翻译、查词等仍按原有设置访问 Supadata/DeepSeek，可能产生提供商费用；自动测试使用合成数据，不调用付费接口。

视频必须可在 Safari 中播放。网站登录、地区限制、B站字幕权限以及 iOS 原生全屏限制仍由网站和系统决定。缺少原生字幕时会明确提示；本地 ASR 不可用不代表可以绕过字幕或播放权限。

## 验证范围

桌面回归与 Safari 无侧栏 API 测试、窄屏合成交互测试及 Xcode 编译分别检查。没有 iPhone 模拟器运行环境或连接真机时，不把编译成功视为真机验证；实际视频播放、跨域 iframe 与网站权限仍需在签名安装后确认。
