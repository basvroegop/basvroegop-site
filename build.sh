#!/usr/bin/env bash
# Bouwt de site naar public/ met dezelfde Hugo-versie als de publicatie op GitHub.
# Het Anatole-thema heeft Dart Sass nodig; dat zit in het officiële Hugo-image.
set -Eeuo pipefail
cd "$(dirname "$0")"
docker run --rm -u "$(id -u):$(id -g)" \
  -v "$PWD":/project \
  -e HUGO_CACHEDIR=/project/.cache \
  ghcr.io/gohugoio/hugo:v0.167.0 build --minify --cleanDestinationDir "$@"
