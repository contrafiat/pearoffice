#!/usr/bin/env bash
# Build and smoke-test the Windows desktop app on the win11 build VM.
#
# Packs this repo and ../peerloom-core, copies them to the VM, installs,
# stages resources for win32-x64, runs electron-builder (NSIS), runs the
# packaged smoke test there and copies the installer back to desktop/dist/.
# Pattern from pearcircle/seeder-launcher/scripts/build-windows.sh.
#
# Usage: scripts/build-desktop-windows.sh
# Env: WINDOWS_VM_HOST (default ben@192.168.50.157). The VM is the local
# libvirt domain win11-pearguard; start it with
#   virsh -c qemu:///system start win11-pearguard
set -euo pipefail

WIN="${WINDOWS_VM_HOST:-ben@192.168.50.157}"
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DIR="pearsheet-build"

ssh -o BatchMode=yes -o ConnectTimeout=6 "$WIN" exit || { echo "cannot reach $WIN (is the VM running?)" >&2; exit 1; }

TAR=$(mktemp --suffix=.tar.gz)
trap 'rm -f "$TAR"' EXIT
echo "==> pack source"
tar -czf "$TAR" -C "$ROOT/.." \
  --exclude='node_modules' --exclude='pearsheet/dist' --exclude='pearsheet/desktop/dist' \
  --exclude='pearsheet/desktop/build/resources' --exclude='pearsheet/spikes' --exclude='.git' \
  pearsheet peerloom-core
scp -q "$TAR" "$WIN:$DIR.tar.gz"

echo "==> install, stage, build, smoke on the VM"
PS=$(cat <<PSEOF
\$ErrorActionPreference = 'Stop'
\$target = Join-Path \$HOME '$DIR'
if (Test-Path -LiteralPath \$target) {
  # robocopy /MIR from an empty folder: Remove-Item alone fails on deep node_modules paths.
  \$empty = New-Item -ItemType Directory -Force -Path (Join-Path \$env:TEMP ("wipe-" + [guid]::NewGuid()))
  & robocopy \$empty.FullName \$target /MIR /NFL /NDL /NJH /NJS /NC /NS /NP | Out-Null
  Remove-Item -LiteralPath \$target -Force -Recurse
  Remove-Item -LiteralPath \$empty.FullName -Force -Recurse
}
New-Item -ItemType Directory -Path \$target | Out-Null
tar -xzf (Join-Path \$HOME '$DIR.tar.gz') -C \$target
Set-Location (Join-Path \$target 'peerloom-core'); npm install --no-audit --no-fund --loglevel=error; if (\$LASTEXITCODE) { exit 1 }
Set-Location (Join-Path \$target 'pearsheet'); npm install --no-audit --no-fund --loglevel=error; if (\$LASTEXITCODE) { exit 1 }
npm install --prefix desktop --no-audit --no-fund --loglevel=error; if (\$LASTEXITCODE) { exit 1 }
node scripts/stage-desktop.js --platform win32 --arch x64; if (\$LASTEXITCODE) { exit 1 }
Set-Location desktop
npx electron-builder --win --x64 --publish never; if (\$LASTEXITCODE) { exit 1 }
Set-Location ..
node scripts/smoke-packaged.js desktop\\dist\\win-unpacked\\PearSheet.exe; if (\$LASTEXITCODE) { exit 1 }
PSEOF
)
B64=$(printf '%s' "$PS" | iconv -t UTF-16LE | base64 -w0)
ssh -o BatchMode=yes "$WIN" "powershell -NoProfile -ExecutionPolicy Bypass -EncodedCommand $B64"

echo "==> copy installer back"
mkdir -p "$ROOT/desktop/dist"
scp -q "$WIN:$DIR/pearsheet/desktop/dist/PearSheet-Setup-*.exe" "$ROOT/desktop/dist/"
ls -la "$ROOT/desktop/dist/" | grep -i setup
