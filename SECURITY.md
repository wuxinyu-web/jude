# Security and development boundaries

Do not put real keys, private transcripts or personal notes in source files, tests, prompts, logs, packages or issue reports. Report security issues without including credentials.

The extension uses the active YouTube tab only. Provider output is untrusted: plain-text fields and lengths are validated and rendered with textContent or escaped markup. Prompts treat transcript and video metadata as inert quoted JSON, never instructions. Search and highlights are literal and bounded, not user-generated regular expressions.

New learning APIs accept calls only from extension pages. Content-script study pulses are bound to sender.tab.id and independently checked against Chrome's active tab, window focus and URL; they cannot claim another tab's time. Persistent changes are serialized. AI results cannot resurrect deleted sentences or overwrite manually edited tags.

The first native lookup never starts audio generation. Only explicit confirmation may invoke Supadata generation. Hover calls DeepSeek after a dwell; it does not save automatically. Failed enrichment does not create fictional answers. No Ask or external search request handlers or search host permissions are included.

Word uses a bundled library and explicit field allowlist. No remote executable scripts, dynamic provider endpoints or credential-bearing export payloads are added. Source timestamps are canonical YouTube links. Run npm test, npm run check and npm run package after changes, and separately test the unpacked extension in an isolated Chrome profile. Automated tests must not make paid provider calls.

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
