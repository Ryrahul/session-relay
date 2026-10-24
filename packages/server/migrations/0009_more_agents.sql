-- Gemini CLI, GitHub Copilot CLI and Cursor as source tools.
ALTER TABLE sessions DROP CONSTRAINT IF EXISTS sessions_source_tool_check;
ALTER TABLE sessions ADD CONSTRAINT sessions_source_tool_check
  CHECK (source_tool IN ('claude-code', 'codex', 'opencode', 'zcode', 'gemini', 'copilot', 'cursor'));
