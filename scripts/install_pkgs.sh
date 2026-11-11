#!/usr/bin/env bash
# SessionStart hook: install npm packages so tests and builds work immediately in fresh
# Claude Code (and CI-like) environments. Uses npm ci, the same command CI runs, because it
# installs exactly what package-lock.json says and never rewrites it. Safe to re-run.
set -euo pipefail
cd "$(dirname "$0")/.."
npm ci
