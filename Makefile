BINARY := bin/crondeck
LDFLAGS := -s -w

.PHONY: all build web web-placeholder dev dev-api dev-web test lint clean run

all: build

## build: build the dashboard and a single static binary
build: web
	CGO_ENABLED=0 go build -trimpath -ldflags "$(LDFLAGS)" -o $(BINARY) ./cmd/crondeck

## web: install deps and statically export the dashboard to web/out
web:
	cd web && npm ci && npm run build

## web-placeholder: create web/out so Go builds/tests work without Node
web-placeholder:
	@mkdir -p web/out
	@test -f web/out/index.html || echo '<!doctype html><title>CronDeck</title><p>Dashboard not built. Run <code>make web</code>.</p>' > web/out/index.html

## dev-api: run the Go API on :8080 (reads .env)
dev-api: web-placeholder
	go run ./cmd/crondeck

## dev-web: run the Next.js dev server on :3000 (proxies /api to :8080)
dev-web:
	cd web && npm run dev

## dev: run API and web dev servers together
dev: web-placeholder
	@trap 'kill 0' INT TERM; $(MAKE) dev-api & $(MAKE) dev-web & wait

run: build
	./$(BINARY)

## test: run Go tests with the race detector
test: web-placeholder
	go test -race ./...

## lint: go vet (+ golangci-lint if installed) and frontend lint/typecheck
lint: web-placeholder
	go vet ./...
	@command -v golangci-lint >/dev/null && golangci-lint run ./... || echo "golangci-lint not installed, skipped"
	cd web && npm run lint && npx tsc --noEmit

clean:
	rm -rf bin web/out web/.next
