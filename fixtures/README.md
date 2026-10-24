# Fixtures
## gemini, copilot, cursor

Constructed from each agent's published types (no real user data):
- `gemini/session-fix-add.jsonl`: Gemini CLI chat JSONL (`chatRecordingTypes.ts` in google-gemini/gemini-cli), including a re-appended message, a `$rewindTo`, a `$patch` and a `$set` title.
- `copilot/events.jsonl` + `workspace.yaml`: Copilot CLI `session-state/<id>/` (event types from github/copilot-sdk), with an internal tool, a string-encoded argument and a failed command.
- `cursor/transcript.jsonl`: Cursor agent transcript (community-documented; no tool results).
