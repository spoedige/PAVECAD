#!/bin/bash
set -euo pipefail

if [ "${CLAUDE_CODE_REMOTE:-}" != "true" ]; then
  exit 0
fi

cd "$CLAUDE_PROJECT_DIR"

# Chromium já vem instalado no ambiente; não baixar de novo.
export PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1
npm install

# graphify: CLI e skill do Claude Code
if ! command -v graphify >/dev/null 2>&1; then
  uv tool install graphifyy
fi
export PATH="$HOME/.local/bin:$PATH"
graphify install
