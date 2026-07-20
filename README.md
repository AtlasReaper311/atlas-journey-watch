<div align="center">
  <img src="https://raw.githubusercontent.com/AtlasReaper311/AtlasReaper311/main/atlas-icon-dark-256.png" width="88" alt="Atlas Systems"/>
</div>

# atlas-journey-watch

```
┌─────────────────────────────────────────────┐
│  ATLAS SYSTEMS // atlas-journey-watch       │
│  scheduled proof that public user paths     │
│  work across service boundaries             │
└─────────────────────────────────────────────┘
```

[![Journey watch](https://github.com/AtlasReaper311/atlas-journey-watch/actions/workflows/journey-watch.yml/badge.svg)](https://github.com/AtlasReaper311/atlas-journey-watch/actions)
![Playwright](https://img.shields.io/badge/tests-playwright-f5a623?style=flat-square&labelColor=0a0a0f)
![Schedule](https://img.shields.io/badge/schedule-6_hourly-4ade80?style=flat-square&labelColor=0a0a0f)
![Cost](https://img.shields.io/badge/cost-%C2%A30-aaa9a0?style=flat-square&labelColor=0a0a0f)

Scheduled synthetic journeys across the public Atlas Systems estate. Component health checks prove that individual services answer. These tests prove that a person can traverse the system: the public API publishes a contract, the registry reaches the Lab map, search returns provenance, notification history remains readable, local AI surfaces report honest availability, and the public status page renders.

## Journeys

| Journey | What it proves |
|---|---|
| API contract | `/v1` and `/v1/openapi.json` answer, and core paths remain documented |
| Registry to Lab | Registry data exists and the Lab system map renders it |
| Estate search | `/v1/search` returns ranked results with source information, or a documented 503 while the machine sleeps |
| Recent activity | `/notify/recent` remains public and parseable |
| Local AI state | Corpus health and Ramone availability answer without requiring the machine to be awake |
| Status surface | The public status site renders without a server error |

The suite runs in desktop and mobile Chromium every six hours. A failure retains the HTML report, screenshot, trace, video, console output, and request evidence in one workflow artifact. Only one consolidated failure event is posted through `atlas-notify`.

## Release watch

Phase 3 adds an event-driven release assurance path without changing the
six-hourly estate run. `atlas-journey-watch` verifies one allowlisted service at
a time; `atlas-infra` owns the policy, `ReleaseEvidence` contract, calling
example, and recovery runbook.

The release verifier compares the expected repository, full commit SHA, service
ID, and environment with explicit live metadata. It never infers identity from
a display name, short SHA, or version string. It then reuses only the existing
journeys mapped to that service and emits JSON conforming to
`atlas-infra/contracts/v1/release-evidence.schema.json`.

Supported service targets are in `config/release-targets.json`. `simple-proxy`
is explicitly excluded because the Phase 1 classification marks it deprecated,
internal, external-derived, and ineligible for release ownership.

### Workflow interface

`.github/workflows/release-watch.yml` supports `workflow_dispatch` and
`repository_dispatch` event type `release-watch`. A request supplies:

- repository, full commit SHA, service ID, and environment;
- deployment target and deployment/workflow run ID;
- an allowlisted HTTPS metadata URL;
- deployment start time and a safe Markdown rollback reference.

The workflow has read-only repository permission, a 25-minute timeout,
release-keyed concurrency, immutable action pins, and 30-day evidence retention.
It requires no secret itself. A participating repository should call
`workflow_dispatch` with `RELEASE_WATCH_DISPATCH_TOKEN`, restricted to
`AtlasReaper311/atlas-journey-watch` with GitHub repository `Metadata: read` and
`Actions: write`. The alternative `repository_dispatch` API currently requires
`Contents: write` on the target repository, so it is supported but not the
least-privilege default. Neither path needs deployments, environments, secrets
administration, or Cloudflare permission.

### Local fixture mode

No release test needs a live endpoint:

```bash
npm run check
npm run test:unit
npm run test:offline
node scripts/release-watch.mjs verify \
  --request tests/fixtures/release-watch/request.json \
  --metadata-file tests/fixtures/release-watch/metadata.match.json \
  --journey tests/fixtures/release-watch/journey.passed.json \
  --fixture \
  --output release-evidence.json
python3 ../atlas-infra/scripts/validate_release_evidence.py \
  --instance release-evidence.json
```

Fixture mode fixes the completion timestamp, so identical inputs produce
byte-identical evidence. The offline Playwright runner injects an in-process
mock request fixture and exercises the existing desktop and mobile journeys
without opening a listener.

A measured baseline producer now exists:
`https://api.atlas-systems.uk/v1/reliability/baseline/{service_id}` on
[`atlas-api-public`](https://github.com/AtlasReaper311/atlas-api-public)
derives one from the estate's probe history, declaring
`latency_metric: "avg"` with `latency_ms_avg` because per-day probe
aggregates cannot support percentiles; the original `latency_ms_p95` shape
remains accepted, and a document mixing the two metrics is `unavailable`
rather than a comparison. The release workflow fetches the baseline with a
non-blocking step: a fetch failure, a service without an approved
objective, or history that cannot support an honest comparison records
`baseline-comparison` as `unknown` exactly as before. The CLI never
invents thresholds, and a stale baseline remains explicit and
non-blocking. Note the fetch-time honesty bound: minutes after a deploy,
the observed window necessarily holds mostly pre-release samples, so this
gate proves the service is within its measured norms; genuine post-release
regression evidence accrues later on `/dora/releases`.

### State and rollback limits

The v1 release states are `pending`, `live`, `mismatch`, `degraded`, `failed`,
`rolled-back`, and `unknown`. Endpoint absence uses
`live_identity: unavailable` and top-level `unknown`. Missing or malformed
identity never becomes `live`.

Release watch performs no deploy or rollback. `rollback_ref` is inert guidance,
an observed `rolled-back` state must come from a separate human-controlled
operation, and the CLI rejects `--auto-rollback`.

## Setup

```bash
npm ci
npx playwright install chromium
npm test
```

Set `NOTIFY_TOKEN` as a GitHub Actions secret. It is used only when a run fails. The tests themselves use public read endpoints and require no production credential.

`NOTIFY_TOKEN` belongs only to the scheduled estate-journey workflow. The
release-watch workflow does not read it or any other secret.

## Failure discipline

A sleeping SPECULAR-CORE is not automatically a failed journey. The Ramone check validates that `/status` reports the state honestly. When SPECULAR-CORE is awake, the suite requires the corpus health route to answer. While the machine sleeps, the public API must return its documented unavailable state instead of pretending search succeeded.

The suite does not mutate the estate. It submits no chat prompt, creates no incident, and changes no remote state. Its only write is a failure report to the existing notification channel.

## How it fits into Atlas Systems

This repository tests the paths assembled by [`atlas-systems`](https://github.com/AtlasReaper311/atlas-systems), [`atlas-api-public`](https://github.com/AtlasReaper311/atlas-api-public), [`atlas-api-index`](https://github.com/AtlasReaper311/atlas-api-index), [`atlas-corpus`](https://github.com/AtlasReaper311/atlas-corpus), [`ramone-edge`](https://github.com/AtlasReaper311/ramone-edge), and [`status`](https://github.com/AtlasReaper311/status). Failures flow through [`atlas-notify`](https://github.com/AtlasReaper311/atlas-notify), while evidence stays attached to the exact GitHub Actions run.

A green health endpoint proves a component can speak. A green journey proves the conversation still reaches the user.

---

Part of [atlas-systems.uk](https://atlas-systems.uk)
