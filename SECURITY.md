# Security and development boundaries

Do not put real keys, private transcripts or personal notes in source files, tests, prompts, logs, packages or issue reports. Report security issues without including credentials.

The extension uses the active YouTube tab only. Provider output is untrusted: plain-text fields and lengths are validated and rendered with textContent or escaped markup. Prompts treat transcript and video metadata as inert quoted JSON, never instructions. Search and highlights are literal and bounded, not user-generated regular expressions.

New learning APIs accept calls only from extension pages. Content-script study pulses are bound to sender.tab.id and independently checked against Chrome's active tab, window focus and URL; they cannot claim another tab's time. Persistent changes are serialized. AI results cannot resurrect deleted sentences or overwrite manually edited tags.

The first native lookup never starts audio generation. Only explicit confirmation may invoke Supadata generation. Hover calls DeepSeek after a dwell; it does not save automatically. Failed enrichment does not create fictional answers. No Ask or external search request handlers or search host permissions are included.

Word uses a bundled library and explicit field allowlist. Local XLSX export also uses an explicit field allowlist, writes text cells without formulas, macros or external connections, and never includes credentials. No remote executable scripts, dynamic provider endpoints or credential-bearing export payloads are added. Source timestamps are canonical YouTube links. Run npm test, npm run check and npm run package after changes, and separately test the unpacked extension in an isolated Chrome profile. Automated tests must not make paid provider calls.

## Bilibili adapter (1.5.0)

Canonical BV and part identities are validated centrally. Native caption requests are bounded to 30 seconds and 8 MiB, require HTTPS, and allow only api.bilibili.com or hdslb.com subdomains. Redirects are rejected. Bilibili login cookies stay with the site API; captions CDN and AI services never receive them. Login/risk-control failures are displayed; no access controls are bypassed.


## Local ASR companion

The optional service binds only to 127.0.0.1:8766 and validates Host, a paired extension ID, and Origin when present. Browser preflights from websites are denied. It accepts canonical BV identities only (no arbitrary URL, path, shell text, cookies, or credentials), uses argv subprocess execution, bounds duration/downloads, and runs one audio job at a time. Transcripts are checked for identity, source, language, size, ordering, and finite timestamps before replacing the active source. A digest generation change invalidates work from the previous transcript. Model weights are checksum pinned and no remote model Python code is executed.

## Embedded learning layout

Only sidepanel.html is web-accessible, restricted to the two supported video origins. Learning APIs require the extension origin; an embedded sidepanel.html is accepted with its sender tab, while site content scripts remain excluded. Embedded activity binds to the sender tab; playback relay rejects another active tab. Layout content scripts have no storage access; the worker accepts only the layout enum and a bounded 30–65 percent height. Closing removes only extension-owned styles, attributes and the iframe, retaining the original player node.

## Study v2

Session practice validates the current foreground video and bound tab. Content-script pulses cannot invoke record export or clearing. Accounting mutations share one serialized queue; duplicate sample timestamps add no credit. New document IDs and worker boots require manual continuation. Export omits internal runtime identifiers and credentials. Clear requests affect only ytd_study and UI requires confirmation. Legacy migration never infers practice from collection IDs.


## 沉浸模式（1.9.0）

沉浸模式使用本地扩展文档；所有字幕、状态和服务返回文本使用 textContent / 文本节点呈现。收藏仍经过现有扩展页面消息校验和容量限制。全屏由用户手势触发，退出学习区撤销本扩展的样式和事件监听。

1.9.1 自动双语沿用 translateContent 的扩展页面身份检查与纯文本输出。翻译按视频、加载代次与原始台词隔离；旧请求结果不会作为新台词显示。


## 1.9.2 自动原声准备

自动原声转写只对当前 B 站视频触发，仍使用本地服务的扩展身份校验、视频标识验证及原站字幕备份；失败不会降级为中文反译或云端处理。

1.10.0 下方字幕与右侧复用相同的文本渲染、翻译和收藏校验；沉浸行收藏仅保存对应英文原始段落，不混入中文译文。旧上下布局偏好兼容为沉浸模式。

1.10.1 语言按钮的显式重试仅跳过自动尝试标记，保留现有任务复用、身份校验和视频结果校验。

1.11.0 每批部分结果经过原有视频编号、语言、原声来源、大小和时间戳校验；标记未完成并隔离视频。旧结果不能覆盖新的完整转写；任务取消不删除收藏。

原声片段接口仅接受已验证的视频编号和有限数值的起止秒数；单段最多 20 分钟，起止时间不超过 24 小时，并核对实际媒体时长。客户端不能提交音频网址或文件路径。FFmpeg URL 来自站点提取结果的已允许 CDN，参数通过数组传入，不经 shell。

## 本集闯关学习（1.14.0）

自由学习、原有计时、收藏、翻卡与 Word 导出继续保留。学习页新增可选闯关区：开始前告知出题与判题会使用配置的 DeepSeek API；仅从开始后本标签页在前台播放过的英文字幕出题，优先选用适合的收藏词，再补齐目标 8 道单词和 4 道常用短语题。中文题干填写英文，每类正确率至少 75%（向上取整）通关；素材不足则减少题数并明确告知，不冒充正式四级测评。生成的答案必须出现在所引字幕中，题面不得包含英文。

未匹配预设答案的回答交给 DeepSeek 判断合理同义表达；不确定或服务失败时不计错，保存回答供重试或退出。首次成绩与错题补测分开，补测通过不意味着一次掌握。试卷成功生成后复用，重复点击合并请求；浏览器中断的请求可手动重试，服务端已经发生的费用不能保证退回。生成与判题中的退出/清空会使迟到结果失效。

闯关只限制已加入任务的标签页内的后续视频播放：本集结束、测试中或切到其他视频时暂停并显示测试/退出入口。可以在学习页结束当前观看提前测试，因此它不是完整看完一集的证明。允许退出且记为未通关；不限制关闭插件、换浏览器或新标签页，不能作为防作弊或家长控制。刷新后保留进度并需手动继续；拖动、后台、缓冲、离线和休眠不补记播放片段。

新增独立 ytd_challenges（schemaVersion 1），不改旧学习记录或收藏结构。试卷、答案、自评以外的客观练习结果、观看区间和作答仅存本机，保留 90 天（访问时清理），最多 200 次记录、每任务最多 30 次提交。原有“导出学习记录”包含闯关记录；确认清空会清理两类学习记录，但保留收藏与笔记。仅向 DeepSeek 发送选取的已观看字幕、候选收藏词、题目和待判回答，不发送其他视频或本地密钥。出题抽样最多 240 行，过长字幕提示使用较短单集。

新增 challenge-core/worker/ui/content 模块。写操作串行化，AI 请求在队列外；题目生成、判分用任务 ID 与 revision 防迟到覆盖。新数据接口仅扩展页可调用，内容脚本只能发播放采样、主动退出及打开侧栏；播放采样结合真实发送标签页和活动窗口核对。试卷初次提交前不通过页面消息返回参考答案。浏览器本机数据不提供考试级保密。


## 家长模式（1.15.0）

原自由学习、收藏和普通闯关保留。家长在学习页选择“家长设置密钥”，抄下仅当次显示的 9 位数字，隐藏后重新输入确认启用。退出模式必须验证密钥；密钥不会再次显示，也没有免密解除入口。忘记密钥时不能通过本功能恢复，请妥善保存。

- 同一浏览器中扩展支持的 Bilibili / YouTube 视频页面遵循家长任务，切换标签页不会直接解除。通过后，下一个未完成视频自动建立任务；已完成的视频可以回看。
- 从启用本集任务后实际观看的英文字幕统计不同收藏项。收集 10 个单词、5 个句子并实际观看至少视频时长的 80% 可完成收集任务，记录不表示已掌握。收藏不足或观看不足则进入测试。未收藏也能从已观看字幕出题。
- 本集结束或尝试进入其他视频时，字幕素材已就绪会自动准备试卷；可以提前选择“结束观看，准备测试”。失败后提供重试，不自动循环调用收费接口。
- 家长试卷为 10 道单词中文提示默写英文（每题 0.5 分）和 5 道完整句子中译英（每题 1 分），满分 10 分，达到 8 分通过。模型优先挑选常用动词、形容词和四级及以上难度语料；这不是正式四级测评。语义相符的自然译法可以判对。
- 题干、答案及来源例句继续规避色情、下流、脏话等。可靠安全素材不足 15 题时不按小卷放行，可回看、补齐英文字幕后重试或请家长解除；不编造台词凑题。
- 未通过先逐项复习错题、自评记住，再重新作答整张试卷。整卷独立计分，首次成绩保留，不用历次正确答案累积凑够 8 分。参考原声回放限于错题对应片段。
- 判题或出题服务失败不会记为答错或自动解锁，可重试或由家长解除。出题和必要判题使用现有已配置 AI 服务，可能产生费用；不新增账号、后台或第三方分析。
- 密钥仅首次设置返回到家长界面，本机保存随机盐与 PBKDF2-SHA-256 校验值（210000 次），不保存明文；5 次错误后等待 60 秒。待确认密钥 10 分钟过期。校验信息不进入学习记录导出，保留到解除；学习记录依旧只存本机、保留 90 天。家长模式开启时，清空学习记录须先解除，不删除收藏。
- 限制范围是扩展支持的此浏览器视频页，不是系统级控制。卸载/禁用扩展、清除扩展数据、使用其他浏览器或应用仍可绕过；本机数据并非防篡改证据，不能据此保证学生专注或掌握。

学习记录导出使用本机 XLSX 生成器，包含每日统计、学习任务、测试成绩及说明；不导出家长密钥。文本单元格不执行公式。

## 1.16 简化学习页
自由学习页面仅显示今日有效时长、复习收藏和学习记录。打开学习区后在前台视频上自动建立计时记录，暂停与后台仍不计观看时间；无手动任务目标要求。七日记录、Excel 导出和清空移入学习记录弹窗。普通闯关入口移除，旧闯关结束但保留成绩；本集限制仅在家长模式开启时显示。跨视频收藏可以复习，自评不虚增当前视频任务成果。

## 1.16.1 家长密码与学习记录
家长自行设置 6–64 位密码，重复输入确认后直接开启，无随机密钥展示步骤。仅保存加盐哈希，旧 9 位密钥仍可用于解除。学习记录弹窗恢复最近七天柱状图，点击日期显示观看、操作和复习时长，保留 Excel 导出。

## iPhone Safari preview (1.17.0)

The Safari package adds exact m.youtube.com and m.bilibili.com origins and removes the desktop sidePanel permission and 127.0.0.1 ASR host. Provider requests and local collection storage follow the existing policy. Device data and credentials are separate; no automatic phone/desktop synchronization is introduced. Safari may not expose Chrome's storage.setAccessLevel API: that extra Chrome-only restriction is capability-checked. Site JavaScript is still isolated from extension APIs, and extension content scripts do not read credentials or relay them into the page. Extension-page message validation remains enforced, including popup ownership checks. Mobile full-panel height is bounded to 10–80 percent.
