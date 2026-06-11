# Agent instructions

## Caveman (token compression) — REQUIRED

- **Always use caveman in `ultra` mode.** At the start of every response/session, the active compression level MUST be `ultra`.
- **On every new session, first check whether caveman is active.** If it is not active, or not set to `ultra`, activate it immediately by running `/caveman ultra` (or saying "caveman ultra") before doing any other work.
- To verify the current state, run `/caveman-stats` (shows session usage and confirms the level). If the level is anything other than `ultra`, re-run `/caveman ultra`.
- Do not switch to `normal mode`, `lite`, `full`, or `wenyan` unless the user explicitly asks for it.
