#!/bin/sh
# Runs the unit tests (no GNOME Shell needed).
set -u
cd "$(dirname "$0")/.."
status=0
for f in tests/unit/*.test.js; do
    echo "# $f"
    gjs -m "$f" || status=1
done
exit $status
