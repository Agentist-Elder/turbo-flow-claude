#!/usr/bin/env bash
# Production-grade SAST via semgrep.
# Known false positives on TypeScript relative imports are suppressed inline
# with `// nosemgrep` at the call sites.
#
# Prerequisites:
#   pip install semgrep
#
# Usage:
#   ./scripts/security-scan.sh
#
# CI: see .github/workflows/ci.yml

set -euo pipefail

semgrep --config auto \
  --error \
  --severity ERROR \
  --severity WARNING \
  scripts/poc/ \
  packages/host-rpc-server/src/
