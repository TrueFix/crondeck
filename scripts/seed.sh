#!/usr/bin/env bash
# Seed a running CronDeck with demo jobs.
# Usage: CRONDECK_URL=http://localhost:8080 ADMIN_KEY=... scripts/seed.sh
set -euo pipefail
URL="${CRONDECK_URL:-http://localhost:8080}"
JAR="$(mktemp)"
trap 'rm -f "$JAR"' EXIT
H=(-H "Content-Type: application/json" -H "X-Requested-With: crondeck" -b "$JAR" -c "$JAR" -s)

curl "${H[@]}" -X POST "$URL/api/auth/login" -d "{\"key\":\"$ADMIN_KEY\"}" >/dev/null

post() { curl "${H[@]}" -X POST "$URL/api/jobs" -d "$1" | sed -E 's/.*"id":"([^"]+)".*/\1/' | head -c 26; echo; }

post '{"name":"API health check","type":"http","schedule":"*/1 * * * *","tags":["monitoring"],"max_retries":1,"retry_backoff_sec":5,"config":{"url":"https://example.com/","method":"GET"}}'
post '{"name":"Heartbeat echo","type":"shell","schedule":"@every 20s","tags":["demo"],"concurrency_policy":"allow","config":{"command":"echo tick $(date +%T); sleep 1; echo done"}}'
post '{"name":"Flaky task","type":"shell","schedule":"@every 45s","description":"Fails roughly half of the time","tags":["demo","flaky"],"config":{"command":"n=$((RANDOM % 2)); echo roll=$n; exit $n"}}'
post '{"name":"Disk usage guard","type":"script","schedule":"*/15 * * * *","tags":["monitoring","disk"],"config":{"interpreter":"bash","source":"df -h / | tail -1"}}'
post '{"name":"Python report","type":"script","schedule":"0 9 * * MON-FRI","timezone":"Europe/Berlin","tags":["report"],"config":{"interpreter":"python3","source":"import platform\nprint(\"hello from\", platform.python_version())"}}'
post '{"name":"Nightly backup","type":"shell","schedule":"0 3 * * *","tags":["backup"],"timeout_sec":3600,"config":{"command":"echo pretend pg_dump; sleep 2","env":{"DB_PASSWORD":"hunter2","REGION":"eu"}}}'
post '{"name":"Slow job","type":"shell","schedule":"*/2 * * * *","timeout_sec":3,"tags":["demo"],"config":{"command":"echo starting; sleep 5"}}'
post '{"name":"Weekly cleanup","type":"shell","schedule":"0 4 * * 0","enabled":false,"tags":["maintenance"],"config":{"command":"find /tmp -name \"*.tmp\" -mtime +7 -print"}}'
echo "seeded"
