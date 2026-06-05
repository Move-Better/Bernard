#!/usr/bin/env bash
# Weekly watchdog for the NarrateRx auto-memory INDEX (MEMORY.md).
#
# MEMORY.md is auto-loaded into every Claude session and has a hard ~24.4KB
# cap — over it, tail entries silently truncate and recall is lost. This job
# removes the "check it by hand every day" burden WITHOUT taking the risk of an
# unattended agent rewriting your memory: it only backs up and watches, and
# pings you (macOS notification) on the rare week it actually needs a trim.
#
#   1. Always snapshot the index (keep last 8 backups) — cheap insurance.
#   2. If under the soft limit, log "ok" and exit.
#   3. If over, post a macOS notification so you run `/consolidate-memory` in a
#      real session (where the rewrite is verified — link-set diff, no drops).
#
# Why not auto-rewrite here? An unattended `claude --permission-mode
# bypassPermissions` loop editing memory with no human verification is exactly
# what the permission guardrail (rightly) blocks. The root-cause fix is the
# one-line-entry + archive-shipped discipline now in CLAUDE.md, which keeps
# growth slow enough that this watchdog rarely needs to fire.
#
# Opt-in to true unattended consolidation (only if you accept the trade-off):
#   cd "/Users/qbook/Claude Projects/NarrateRx" \
#     && claude -p "/consolidate-memory" --permission-mode bypassPermissions --model sonnet --max-budget-usd 2
#
# Installed via launchd: ~/Library/LaunchAgents/com.narraterx.memory-maintenance.plist
# Manual run / smoke test:  bash scripts/memory-maintenance.sh
set -uo pipefail

MEM_DIR="/Users/qbook/.claude/projects/-Users-qbook-Claude-Projects-NarrateRx/memory"
MEM="$MEM_DIR/MEMORY.md"
BAK_DIR="$MEM_DIR/.backups"
SOFT_LIMIT=22000     # notify above this many bytes
HARD_CAP=24400       # the auto-loader truncates above this
KEEP_BACKUPS=8

ts() { date '+%Y-%m-%d %H:%M:%S'; }
notify() { /usr/bin/osascript -e "display notification \"$1\" with title \"NarrateRx memory\"" >/dev/null 2>&1 || true; }

[ -f "$MEM" ] || { echo "[mem] $(ts) ERROR: MEMORY.md not found at $MEM"; exit 1; }
mkdir -p "$BAK_DIR"

# 1) backup, prune to last KEEP_BACKUPS
backup="$BAK_DIR/MEMORY-$(date '+%Y%m%d-%H%M%S').md"
cp "$MEM" "$backup"
ls -1t "$BAK_DIR"/MEMORY-*.md 2>/dev/null | tail -n +$((KEEP_BACKUPS+1)) | xargs -r rm -f

size=$(wc -c < "$MEM" | tr -d ' ')
echo "[mem] $(ts) size=${size}B (soft=${SOFT_LIMIT} cap=${HARD_CAP}) backup=$(basename "$backup")"

# 2/3) watch + notify
if [ "$size" -le "$SOFT_LIMIT" ]; then
  echo "[mem] ok — under soft limit, no action."
  exit 0
fi

kb=$(( size / 1024 ))
notify "MEMORY.md is ${kb}KB (cap 24KB) — run /consolidate-memory soon."
echo "[mem] OVER SOFT LIMIT (${size}B) — notified. Run /consolidate-memory in a session."
exit 0
