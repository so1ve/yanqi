#!/usr/bin/env bash

set -euo pipefail

version=${1:?usage: scripts/publish-release.sh v1.0.0}
cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.."

revision=$(git rev-parse HEAD)
short_revision=$(git rev-parse --short=12 HEAD)
readonly version revision short_revision
readonly image='git.bitnp.net/so1ve/yanqi'
readonly version_image="$image:$version"
readonly revision_image="$image:sha-$short_revision"
readonly latest_image="$image:latest"

docker build \
  --label 'org.opencontainers.image.source=https://github.com/so1ve/yanqi' \
  --label "org.opencontainers.image.revision=$revision" \
  --label "org.opencontainers.image.version=$version" \
  --tag "$version_image" \
  --tag "$revision_image" \
  --tag "$latest_image" \
  .

docker push "$version_image"
docker push "$revision_image"
docker push "$latest_image"

printf 'Published %s at %s\n' "$version" "$revision"
printf '  %s\n  %s\n  %s\n' "$version_image" "$revision_image" "$latest_image"
