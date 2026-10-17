# ⏱️ CronDeck

**Self-hosted job scheduler** with a live dashboard — one Go binary, one SQLite file, no Redis cluster.

Run HTTP calls, shell commands, scripts, and SQL on a cron schedule. Watch logs stream in real time, chain jobs on upstream success, and keep everything on your own machine.

---

## ✨ Highlights

- **Jobs** — HTTP (multi-step + `{{variables}}`), shell, script, SQL · dependency chains (`depends_on`)
- **Schedule** — Cron, `@daily`, `@every 30s`, per-job timezone, live next-run preview
- **Control room** — Run now, cancel, retries, concurrency policies, SSE live runs, search, templates
- **Ops** — SQLite backup/restore, Prometheus metrics, failure alerts (Slack, Discord, webhook)
- **Auth** — Admin key or users, API tokens (RBAC), audit log, redacted secrets

---

## 🚀 Quick start

**Requirements:** Go 1.26+, Node 24+ (only to build the UI once).

```bash
git clone https://github.com/TrueFix/crondeck.git
cd crondeck

cp .env.example .env
# Set ADMIN_KEY to at least 32 chars: openssl rand -hex 32

make build
./bin/crondeck
```

Open **http://localhost:8080** — sign in with `ADMIN_KEY` or create a user under Settings.

---

## 🐳 Docker

```bash
cp .env.example .env   # set ADMIN_KEY
docker compose up -d --build
```

Data lives in the `crondeck-data` volume. Default bind: **127.0.0.1:8080**.

---

## ⚙️ Config

| Variable | Default | Notes |
|----------|---------|--------|
| `ADMIN_KEY` | — | Required, ≥ 32 characters |
| `PORT` | `8080` | HTTP port |
| `DB_PATH` | `./data/crondeck.db` | SQLite path |
| `ALLOW_SHELL` | `true` | `false` disables shell/script jobs |
| `ALLOW_SQL` | `true` | `false` disables SQL jobs |
| `METRICS_ENABLED` | `true` | `GET /metrics` (protect at the edge) |

See [`.env.example`](.env.example) for the full list.

---

## 🛠️ Develop

```bash
make dev      # API :8080 + Next.js :3000
make test     # go test -race ./...
make lint     # vet + frontend lint/typecheck
```

---

## 📄 License

MIT — use it, fork it, run it at home.
