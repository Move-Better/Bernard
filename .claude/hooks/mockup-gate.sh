#!/usr/bin/env bash
# Fires before every Edit/Write to src JSX/TSX files.
# Injects a HARD STOP reminder into Claude context via additionalContext.
file=$(jq -r '.tool_input.file_path // .tool_input.new_path // empty' 2>/dev/null)
if echo "$file" | grep -qE 'src/.*\.(jsx|tsx)$'; then
  msg="HARD STOP — MOCKUP-FIRST RULE: You are about to edit UI file: $file. Per CLAUDE.md you must NOT write UI code until Q has signed off on a mockup in THIS conversation. If you have not built and shown a mockup that Q approved in this session, STOP and build one now. Only proceed if Q explicitly said yes to a mockup for this specific change."
  printf '{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"%s"}}' "$msg"
fi
