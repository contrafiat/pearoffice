#!/usr/bin/env bash
# Build the PearSheet seeder image for amd64 and arm64 and push it to
# ghcr.io/peerloomllc/pearsheet-seeder:<version> (version from package.json
# unless given). PUSH=0 builds without pushing. Needs podman, and
# qemu-user-static for the arm64 apt step.
#
# Usage: scripts/build-umbrel-image.sh [version]
set -euo pipefail
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT"
IMAGE="${IMAGE:-ghcr.io/peerloomllc/pearsheet-seeder}"
VERSION="${1:-$(node -p "require('./package.json').version")}"
TAG="$IMAGE:$VERSION"
PUSH="${PUSH:-1}"

node scripts/stage-umbrel.js
podman manifest rm "$TAG" 2>/dev/null || true
podman build --platform=linux/amd64,linux/arm64 --manifest "$TAG" -f seeder-dist/umbrel/Dockerfile dist/umbrel
if [ "$PUSH" = 1 ]; then
  podman manifest push --all "$TAG" "docker://$TAG"
  echo "pushed $TAG"
  skopeo inspect "docker://$TAG" --format '{{.Digest}}' 2>/dev/null || true
else
  echo "built $TAG (not pushed)"
fi
