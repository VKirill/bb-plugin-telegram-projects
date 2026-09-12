# v0.3.0 verification — 2026-09-13

- TypeScript check, plugin build: passed on BB 0.43.1 / SDK 0.4.87.
- Root tests: 30 passed, including read-only diagnostics, invalid/foreign tokens, atomic protected credential replacement, language preservation and settings RPC round trip.
- Receiver tests: 6 passed; updated companion built and launchd restarted, existing KeepAlive confirmed.
- Installed plugin reports 0.3.0/running. Existing topic bindings preserved.
- Live checkConnection RPC: valid token, same bot, topics enabled, user-created topics enabled, no webhook; no token returned.
- Real app.tsx rendered in an isolated browser harness with built scoped CSS and live installed RPC. Checked connection button, English selection, Save settings, persisted language after reload, restored Russian. Screenshot visually inspected. BB Connect itself required login in the automation browser, so authenticated full-shell rendering was not verified.
- Telegram getMyCommands confirmed English descriptions after setting English; receiver projectList returned English. Russian restored as final setting.
- Actual token rotation was not performed. Replacement was tested against a temporary configuration file; receiver token watcher and launchd restart path reviewed. Invalid/foreign candidate behavior covered by tests.
- Native session/voice functionality retains v0.2 behavior and regression tests; no new agent task or voice was sent in this release.

Known limits: personal fixed bot/owner and host layout; another bot requires migration. BotFather Restrict bot usage is manual, not exposed by getMe. Existing history, user/project names and agent responses are not translated. Queued messages preserve language at enqueue time. No marketplace submission.
