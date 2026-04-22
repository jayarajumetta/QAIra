# QAira Platform Stack

QAira already runs on Fastify, which means Pino logging is native through the backend logger. The platform work added here keeps that base intact and layers the stronger runtime pieces around it instead of replacing working behavior.

## What Is Included

- `Fastify + Pino`
  - QAira backend stays on Fastify and now honors `LOG_LEVEL`.
- `Health + readiness + metrics`
  - `GET /health`
  - `GET /health/ready`
  - `GET /metrics`
- `HAProxy`
  - front door for the web app and API
  - stats UI on `http://localhost:8404/stats`
- `Prometheus`
  - scrapes QAira API metrics and OpenTelemetry Collector metrics
- `Grafana`
  - ready with Prometheus and Loki datasources
- `Loki + Promtail`
  - collects container logs for QAira services
- `OpenTelemetry Collector`
  - receives future OTLP traces/logs/metrics and exposes collector metrics

## Current Scope

- Pino logging is active now through Fastify.
- Prometheus-ready API metrics are active now through `/metrics`.
- Request trace propagation is active now through `traceparent` and `X-Trace-ID` headers.
- The OpenTelemetry Collector is wired in now for future OTLP exporters, but the QAira API is not yet using the full OpenTelemetry SDK.
- The Promtail setup is intended for Linux Docker hosts such as EC2 because it reads Docker container logs from the host filesystem.

## Files

- [docker-compose.platform.yml](/Users/jayarajumetta/MJ/qaira/docker-compose.platform.yml:1)
- [backend/api/src/plugins/observability.js](/Users/jayarajumetta/MJ/qaira/backend/api/src/plugins/observability.js:1)
- [ops/haproxy/haproxy.cfg](/Users/jayarajumetta/MJ/qaira/ops/haproxy/haproxy.cfg:1)
- [ops/prometheus/prometheus.yml](/Users/jayarajumetta/MJ/qaira/ops/prometheus/prometheus.yml:1)
- [ops/grafana/provisioning/datasources/datasources.yml](/Users/jayarajumetta/MJ/qaira/ops/grafana/provisioning/datasources/datasources.yml:1)
- [ops/loki/loki-config.yml](/Users/jayarajumetta/MJ/qaira/ops/loki/loki-config.yml:1)
- [ops/promtail/promtail-config.yml](/Users/jayarajumetta/MJ/qaira/ops/promtail/promtail-config.yml:1)
- [ops/otel-collector/config.yaml](/Users/jayarajumetta/MJ/qaira/ops/otel-collector/config.yaml:1)

## Runtime Shape

- `docker-compose.full.yml`
  - current QAira app stack
  - PostgreSQL + API + frontend
- `docker-compose.platform.yml`
  - QAira app stack plus HAProxy, Prometheus, Grafana, Loki, Promtail, and OTel Collector
- `testengine/docker-compose.deploy.yml`
  - standalone Playwright Test Engine deployment for a separate EC2

## Release Flow

Use [release.sh](/Users/jayarajumetta/MJ/qaira/release.sh:1) from the main repo host to build and push:

- QAira backend image
- QAira frontend image
- QAira Test Engine image

Use [release-testengine.sh](/Users/jayarajumetta/MJ/qaira/release-testengine.sh:1) on the separate Test Engine host to pull the published image and refresh the standalone engine container.

## Service Start Scripts

- [run-postgres.sh](/Users/jayarajumetta/MJ/qaira/run-postgres.sh:1)
- [run-backend.sh](/Users/jayarajumetta/MJ/qaira/run-backend.sh:1)
- [run-frontend.sh](/Users/jayarajumetta/MJ/qaira/run-frontend.sh:1)
- [run-testengine.sh](/Users/jayarajumetta/MJ/qaira/run-testengine.sh:1)

Set `PULL_IMAGES=1` if you want those scripts to pull registry images before starting services.

## Recommended Deploy Split

- QAira EC2
  - PostgreSQL
  - QAira API
  - QAira frontend
  - HAProxy
  - Prometheus
  - Grafana
  - Loki
  - Promtail
  - OTel Collector
- Test Engine EC2
  - Playwright Test Engine only

That split keeps browser execution isolated from the core QA workspace while still giving the platform team one observability story.
