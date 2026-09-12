# Study v2 validation (1.8.0)

The session model is version 2. Legacy watch/operation/review totals and collection IDs remain intact; legacy collections never become practiced IDs. Unknown legacy playback positions do not trigger a seek to zero.

Automated checks cover category priority/de-duplication, real elapsed playback time, buffering/seeking, offline/background conditions, manual pause, 60-second operation/review expiry, duplicate timestamps, competing tabs, worker/document recovery, distinct self-assessments, target completeness, continuation of ended tasks, retention, export and clear isolation.

The isolated browser study suite (`YTD_TEST_STUDY=1`, `YTD_TEST_PLATFORM=bilibili` or `youtube`, `node scripts/browser-test.cjs`) exercises actual controls: empty state, start, manual pause/resume, distraction toggling and restored recommendations, word and sentence cards, reveal without practice credit, repeated self-assessment, early summary, continuation, video refresh and saved playhead, 320-pixel layout, all-target summary, pending-review completion, JSON download and confirmed clearing that preserves collections. Full browser regression separately covers subtitle interaction, bilingual collection, playback/background accounting, nonblocking deadline prompt, Word download and review. Providers and captions are fixture-only.

Manual Chrome verification on Bilibili video BV1bfLwz1Eu4 confirms the real video and embedded vertical learning page load, the pre-existing session is retained as paused, and legacy word/sentence practice remains zero with an explicit continue action. No new audio transcription or real AI request was run for this change.

Limitations: current-video scope only (no existing segment picker); recorded behavior is not evidence of attention/mastery. Samples are conservative at activity transitions or missing-heartbeat boundaries; no offline interval is reconstructed. Existing library self-assessments survive clearing task records.
