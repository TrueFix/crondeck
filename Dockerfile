# syntax=docker/dockerfile:1

# ---- 1. dashboard (static export) ------------------------------------------
FROM --platform=$BUILDPLATFORM node:24-alpine AS web
ENV NEXT_TELEMETRY_DISABLED=1
WORKDIR /src/web
COPY web/package.json web/package-lock.json ./
RUN --mount=type=cache,target=/root/.npm npm ci --no-audit --no-fund
COPY web/ ./
RUN npm run build

# ---- 2. Go binary (pure Go, no CGO) ----------------------------------------
FROM --platform=$BUILDPLATFORM golang:1.26-alpine AS build
ARG TARGETOS=linux
ARG TARGETARCH=amd64
WORKDIR /src
COPY go.mod go.sum ./
RUN --mount=type=cache,target=/go/pkg/mod go mod download
COPY cmd ./cmd
COPY internal ./internal
COPY web/embed.go ./web/embed.go
COPY --from=web /src/web/out ./web/out
RUN --mount=type=cache,target=/go/pkg/mod --mount=type=cache,target=/root/.cache/go-build \
    CGO_ENABLED=0 GOOS=$TARGETOS GOARCH=$TARGETARCH go build -trimpath -ldflags "-s -w" -o /out/crondeck ./cmd/crondeck

# ---- 3. runtime -------------------------------------------------------------
# Alpine (not distroless) so shell/script jobs have a shell to run in.
# Add the tools your jobs need (python3, nodejs, postgresql-client, docker-cli, ...).
FROM alpine:3.22
ARG EXTRA_PACKAGES=""
RUN apk add --no-cache ca-certificates tzdata bash $EXTRA_PACKAGES \
 && adduser -D -H -u 10001 crondeck \
 && mkdir -p /data && chown crondeck /data
COPY --from=build /out/crondeck /usr/local/bin/crondeck
USER crondeck
WORKDIR /data
ENV APP_ENV=production \
    PORT=8080 \
    DB_PATH=/data/crondeck.db
VOLUME ["/data"]
EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=3s CMD wget -qO- http://127.0.0.1:8080/healthz || exit 1
ENTRYPOINT ["/usr/local/bin/crondeck"]
