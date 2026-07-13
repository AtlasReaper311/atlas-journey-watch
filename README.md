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

## Setup

```bash
npm ci
npx playwright install chromium
npm test
```

Set `NOTIFY_TOKEN` as a GitHub Actions secret. It is used only when a run fails. The tests themselves use public read endpoints and require no production credential.

## Failure discipline

A sleeping SPECULAR-CORE is not automatically a failed journey. The Ramone check validates that `/status` reports the state honestly. When SPECULAR-CORE is awake, the suite requires the corpus health route to answer. While the machine sleeps, the public API must return its documented unavailable state instead of pretending search succeeded.

The suite does not mutate the estate. It submits no chat prompt, creates no incident, and changes no remote state. Its only write is a failure report to the existing notification channel.

## How it fits into Atlas Systems

This repository tests the paths assembled by [`atlas-systems`](https://github.com/AtlasReaper311/atlas-systems), [`atlas-api-public`](https://github.com/AtlasReaper311/atlas-api-public), [`atlas-api-index`](https://github.com/AtlasReaper311/atlas-api-index), [`atlas-corpus`](https://github.com/AtlasReaper311/atlas-corpus), [`ramone-edge`](https://github.com/AtlasReaper311/ramone-edge), and [`status`](https://github.com/AtlasReaper311/status). Failures flow through [`atlas-notify`](https://github.com/AtlasReaper311/atlas-notify), while evidence stays attached to the exact GitHub Actions run.

A green health endpoint proves a component can speak. A green journey proves the conversation still reaches the user.

---

Part of [atlas-systems.uk](https://atlas-systems.uk)
