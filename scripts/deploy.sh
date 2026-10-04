#!/usr/bin/env bash
# Deploy MWThree with Docker. The maps shipped in maps/ are always included.
#   scripts/deploy.sh                          # just the shipped maps
#   scripts/deploy.sh --folder /path/to/mw3    # also share a folder: an MW3 installation (zone/, main/*.iwd) or any
#                                              # folder with extra maps (usermaps/<map>/ for community maps)
#   scripts/deploy.sh --folder DIR --port 8080 --name mwthree
#   scripts/deploy.sh --password SECRET        # whole site behind a password (HTTP Basic, any user name); or set MWTHREE_PASSWORD
set -euo pipefail
cd "$(dirname "$0")/.."
folder="" port=4173 name=mwthree
while [ $# -gt 0 ]; do
  case "$1" in
    --folder) folder="${2:?--folder needs a path}"; shift 2 ;;
    --port) port="${2:?--port needs a number}"; shift 2 ;;
    --name) name="${2:?--name needs a name}"; shift 2 ;;
    --password) export MWTHREE_PASSWORD="${2:?--password needs a value}"; shift 2 ;;
    -h|--help) sed -n '2,9p' "$0"; exit 0 ;;
    *) echo "unknown option: $1 (see --help)" >&2; exit 1 ;;
  esac
done
args=(-d --name "$name" --restart unless-stopped -p "$port:4173")
# the value goes through the environment, not the docker command line
[ -n "${MWTHREE_PASSWORD:-}" ] && args+=(-e MWTHREE_PASSWORD)
if [ -n "$folder" ]; then
  [ -d "$folder" ] || { echo "not a folder: $folder" >&2; exit 1; }
  args+=(-v "$(cd "$folder" && pwd):/data:ro")
fi
docker build -t mwthree:local .
docker rm -f "$name" >/dev/null 2>&1 || true
docker run "${args[@]}" mwthree:local
echo "MWThree: http://localhost:$port${folder:+  (sharing $folder)}"
