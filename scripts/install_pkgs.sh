#!/usr/bin/env bash
# SessionStart hook: install npm packages so tests and builds work immediately in fresh
# Claude Code (and CI-like) environments. Safe to re-run; npm install is a no-op when
# node_modules is already current.
set -euo pipefail
cd "$(dirname "$0")/.."
npm install
