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
