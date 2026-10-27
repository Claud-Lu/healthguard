#!/usr/bin/env bash
set -euo pipefail
TASK_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
TASK_BUILD="$(mktemp -d)"
trap 'rm -rf "$TASK_BUILD"' EXIT
TASK_JAVA="${JAVA_HOME:+$JAVA_HOME/bin/}"
"${TASK_JAVA}javac" --release 11 -d "$TASK_BUILD" \
  "$TASK_ROOT/packages/sdk-flutter/android/src/main/java/dev/healthguard/flutter/DeviceId.java" \
  "$TASK_ROOT/packages/sdk-flutter/android/src/test/java/dev/healthguard/flutter/DeviceIdTest.java"
"${TASK_JAVA}java" -cp "$TASK_BUILD" dev.healthguard.flutter.DeviceIdTest
