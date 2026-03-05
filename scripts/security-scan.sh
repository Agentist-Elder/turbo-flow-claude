#!/usr/bin/env bash
# WIRE-IN: Replace this AQE-based scan with semgrep when CI pipeline is created (P6).
#
# Production-grade SAST — eliminates false positives from pattern-only scanners.
# No false positives on TypeScript relative imports or RegExp.exec() calls.
#
# Prerequisites:
#   pip install semgrep          # or:
#   docker pull semgrep/semgrep
#
# Usage:
#   ./scripts/security-scan.sh
#
# TODO (P6): add as a GitHub Actions step:
#   - name: Security scan
#     run: ./scripts/security-scan.sh

set -euo pipefail

semgrep --config auto \
  --error \
  --severity ERROR \
  --severity WARNING \
  scripts/poc/ \
  packages/host-rpc-server/src/
