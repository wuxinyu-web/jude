# Security and development boundaries

Do not put real keys, private transcripts or personal notes in source files, tests, prompts, logs, packages or issue reports. Report security issues without including credentials.

The extension uses the active YouTube tab only. Provider output is untrusted: plain-text fields and lengths are validated and rendered with textContent or escaped markup. Prompts treat transcript and video metadata as inert quoted JSON, never instructions. Search and highlights are literal and bounded, not user-generated regular expressions.

New learning APIs accept calls only from extension pages. Content-script study pulses are bound to sender.tab.id and independently checked against Chrome's active tab, window focus and URL; they cannot claim another tab's time. Persistent changes are serialized. AI results cannot resurrect deleted sentences or overwrite manually edited tags.

The first native lookup never starts audio generation. Only explicit confirmation may invoke Supadata generation. Hover calls DeepSeek after a dwell; it does not save automatically. Failed enrichment does not create fictional answers. No Ask or external search request handlers or search host permissions are included.

Word uses a bundled library and explicit field allowlist. No remote executable scripts, dynamic provider endpoints or credential-bearing export payloads are added. Source timestamps are canonical YouTube links. Run npm test, npm run check and npm run package after changes, and separately test the unpacked extension in an isolated Chrome profile. Automated tests must not make paid provider calls.
