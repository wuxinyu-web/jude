#!/usr/bin/env bash

set -euo pipefail

script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
repo_root="$(cd "$script_dir/.." && pwd)"
version="$(node -e 'process.stdout.write(require(process.argv[1]).version)' "$repo_root/package.json")"
dist_dir="$repo_root/dist"
output="$dist_dir/jude-local-asr-v$version.zip"
files=(
  "local-asr/README.md"
  "local-asr/install.py"
  "local-asr/install-windows.cmd"
  "local-asr/start.py"
  "local-asr/start-windows.cmd"
  "local-asr/server.py"
  "local-asr/worker.py"
  "local-asr/audio_download.py"
  "local-asr/requirements.in"
  "local-asr/requirements.lock"
  "local-asr/requirements-windows.lock"
)

for file in "${files[@]}"; do
  [[ -f "$repo_root/$file" && ! -L "$repo_root/$file" ]] || {
    printf 'Local ASR packaging failed: missing or unsafe file %s\n' "$file" >&2
    exit 1
  }
done

mkdir -p "$dist_dir"
temporary_dir="$(mktemp -d "$dist_dir/.local-asr-package.XXXXXX")"
trap 'rm -rf "$temporary_dir"' EXIT
(
  cd "$repo_root"
  zip -X -q "$temporary_dir/package.zip" "${files[@]}"
)
mv -f "$temporary_dir/package.zip" "$output"
printf 'Created %s\n' "$output"
shasum -a 256 "$output"
