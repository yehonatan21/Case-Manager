#!/bin/bash
# Installs the third-party apple-design skill (github.com/dickwu/apple-design-skill) into
# .claude/skills/apple-design at session start. It isn't committed: it has no open-source license and most of
# it is Apple's Human Interface Guidelines text, so each session downloads it instead (the folder is git-ignored).
# Pinned to a commit that was reviewed; to update, review the new version and change APPLE_DESIGN_REV.
set -euo pipefail

cd "${CLAUDE_PROJECT_DIR:-.}"

APPLE_DESIGN_REPO="https://github.com/dickwu/apple-design-skill.git"
APPLE_DESIGN_REV="ff4ebddf0488598723a82bfdce1afb04de0b1c44"
dest=.claude/skills/apple-design
marker="$dest/.pinned-rev"

# Already installed at this version: nothing to do (the hook runs at every start, resume, clear and compact).
if [ "$(cat "$marker" 2>/dev/null)" = "$APPLE_DESIGN_REV" ] && [ -f "$dest/SKILL.md" ]; then
  exit 0
fi

tmp="$(mktemp -d)"
trap 'rm -rf "$tmp"' EXIT
if ! { git -C "$tmp" init -q \
  && git -C "$tmp" fetch -q --depth 1 "$APPLE_DESIGN_REPO" "$APPLE_DESIGN_REV" \
  && git -C "$tmp" checkout -q FETCH_HEAD; }; then
  # No network to GitHub: start without the skill rather than block the session.
  echo "apple-design skill: couldn't download it; continuing without it." >&2
  exit 0
fi

# Only what the skill uses: its instructions, references and the refresh script.
rm -rf "$dest"
mkdir -p "$dest"
cp -R "$tmp/SKILL.md" "$tmp/references" "$tmp/scripts" "$tmp/README.md" "$dest/"
echo "$APPLE_DESIGN_REV" > "$marker"
