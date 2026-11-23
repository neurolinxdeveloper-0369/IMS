#!/usr/bin/env bash
set -euo pipefail
image="${1:?Pass the Docker image tag}"
expected_commit="${2:-local}"
container_id=""
cleanup() {
  if [[ -n "$container_id" ]]; then docker stop "$container_id" >/dev/null 2>&1 || true; fi
}
trap cleanup EXIT
docker run --rm --entrypoint nginx "$image" -t
container_id=$(docker run --detach --rm --publish 127.0.0.1::80 "$image")
port=$(docker port "$container_id" 80/tcp | sed -nE 's/^127[.]0[.]0[.]1:([0-9]+)$/\1/p')
[[ -n "$port" ]] || { echo "Could not determine the test container port." >&2; exit 1; }
base="http://127.0.0.1:$port"
for attempt in {1..20}; do
  if curl --fail --silent --max-time 3 "$base/health" >/dev/null; then break; fi
  sleep 1
done
[[ "$(curl --fail --silent --show-error --max-time 5 "$base/health")" = "ok" ]]
for route in /IMS /IMS/ /IMS/index.html; do
  content=$(curl --fail --silent --show-error --max-time 5 "$base$route")
  [[ "$content" == *'<title>Welcome to Inventory Management System | Neurolinx</title>'* ]] || {
    echo "The welcome page did not render at $route." >&2; exit 1;
  }
done
for extension in js css; do
  asset=$(printf '%s\n' "$content" | sed -nE "s|.*[\"](\/IMS\/assets\/[^\"]+\.$extension)\".*|\1|p")
  [[ -n "$asset" ]] || { echo "Missing $extension asset in the welcome page." >&2; exit 1; }
  curl --fail --silent --show-error --max-time 5 --output /dev/null "$base$asset"
done
metadata=$(curl --fail --silent --show-error --max-time 5 "$base/IMS/version.json")
[[ "$(jq -r .service <<< "$metadata")" = "neurolinx-ims" ]]
[[ "$(jq -r .commit <<< "$metadata")" = "$expected_commit" ]]
[[ "$(curl --silent --show-error --max-time 5 --output /dev/null --write-out '%{http_code}' "$base/IMS/not-a-real-page")" = "404" ]]
echo "IMS image passed Nginx syntax, health, welcome routes, React assets, version and missing-page checks."
