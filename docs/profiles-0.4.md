# Native CLI profiles from Telegram

After choosing a model for a new session, Telegram queries the installed/running CLI Agents plugin for the selected provider, project and host. If supported profiles exist, the next card offers them (two per row), the default and pagination. No plugin, unsupported provider or empty catalog skips the step. Discovery failure offers retry/default explicitly.

Profile selection uses CLI Agents catalog/select RPC. The first user message is spawned with a fresh native selection marker; subsequent messages do not repeat it. Selection is checked again at spawn and target changes fail closed. Provider/section changes clear pending selection. Existing chats retain their established native role; changing model does not change role. No global CLI configuration is edited. Codex profiles contribute developer instructions only, as documented by CLI Agents.

Sections need a matching registered BB environment so CLI Agents can resolve the exact checkout. A section without one shows retry/default guidance. New-chat status shows human-readable provider/model names, profile and section name. Stop/disconnect controls appear only for connected chats.

Validation: 32 root tests; TypeScript/build passed. New regression verifies catalog after model, target-scoped selection and initial prompt marker, preserved model, unchanged subsequent messages, readable card and hidden stop before connection. Live Telegram test in an isolated temporary topic: project→Codex→GPT-6-Astra→bb-cli-agents-test produced the expected card. No actual agent task launched in this live test; dispatch arguments are covered by mocks and CLI Agents' native integration contract. Temporary topic and binding removed. Working-topic selections preserved.
