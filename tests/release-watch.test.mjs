import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import fsp from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { targetForService } from "../scripts/release-targets.mjs";
import {
  classifyLiveIdentity,
  createReleaseEvidence,
  loadBaselineResult,
  loadJourneyResult,
  loadMetadata,
  renderJson,
  runCli,
  validateReleaseRequest,
} from "../scripts/release-watch.mjs";

const FIXTURES = fileURLToPath(new URL("./fixtures/release-watch/", import.meta.url));
const INFRA_ROOT = process.env.ATLAS_INFRA_ROOT ||
  fileURLToPath(new URL("../../atlas-infra/", import.meta.url));

const fixture = (name) => path.join(FIXTURES, name);

async function request() {
  return validateReleaseRequest(
    JSON.parse(await fsp.readFile(fixture("request.json"), "utf8")),
  );
}

async function evidenceFor({
  metadata = "metadata.match.json",
  journey = "journey.passed.json",
  baseline = null,
  requestOverride = {},
} = {}) {
  const releaseRequest = validateReleaseRequest({ ...(await request()), ...requestOverride });
  const observation = await loadMetadata({ file: fixture(metadata) });
  const identity = classifyLiveIdentity(releaseRequest, observation);
  return createReleaseEvidence({
    request: releaseRequest,
    identity,
    journey: await loadJourneyResult(fixture(journey)),
    baseline: await loadBaselineResult(
      baseline ? fixture(baseline) : null,
      "2026-07-14T10:05:00Z",
    ),
    completedAt: "2026-07-14T10:05:00Z",
  });
}

test("expected commit equals live commit", async () => {
  const evidence = await evidenceFor();
  assert.equal(evidence.live_identity, "matched");
  assert.equal(evidence.status, "live");
});

test("equivalent HTML build metadata can prove the release identity", async () => {
  const evidence = await evidenceFor({ metadata: "metadata.match.html" });
  assert.equal(evidence.live_identity, "matched");
  assert.equal(evidence.status, "live");
});

test("live commit mismatch", async () => {
  const evidence = await evidenceFor({ metadata: "metadata.mismatch.json" });
  assert.equal(evidence.live_identity, "mismatched");
  assert.equal(evidence.status, "mismatch");
});

test("missing metadata never becomes live", async () => {
  const evidence = await evidenceFor({ metadata: "metadata.missing.json" });
  assert.equal(evidence.live_identity, "unknown");
  assert.equal(evidence.status, "failed");
});

test("malformed metadata is failed evidence", async () => {
  const evidence = await evidenceFor({ metadata: "metadata.malformed.txt" });
  assert.equal(evidence.live_identity, "unknown");
  assert.equal(evidence.status, "failed");
});

test("endpoint unavailable fixture is unknown", async () => {
  const evidence = await evidenceFor({ metadata: "metadata.unavailable.json" });
  assert.equal(evidence.live_identity, "unavailable");
  assert.equal(evidence.status, "unknown");
});

test("journey success permits live", async () => {
  const evidence = await evidenceFor({ journey: "journey.passed.json" });
  assert.equal(evidence.journey_result, "passed");
  assert.equal(evidence.status, "live");
});

test("journey failure fails release verification", async () => {
  const evidence = await evidenceFor({ journey: "journey.failed.json" });
  assert.equal(evidence.journey_result, "failed");
  assert.equal(evidence.status, "failed");
});

test("journey unavailable degrades a matched release", async () => {
  const evidence = await evidenceFor({ journey: "journey.unavailable.json" });
  assert.equal(evidence.journey_result, "unknown");
  assert.equal(evidence.status, "degraded");
});

test("baseline unavailable is explicit and non-blocking", async () => {
  const evidence = await evidenceFor();
  const baseline = evidence.checks.find((check) => check.check_id === "baseline-comparison");
  assert.equal(baseline.status, "unknown");
  assert.equal(baseline.state, "unavailable");
  assert.equal(evidence.status, "live");
});

test("supplied baseline compares healthy and degraded observations", async () => {
  assert.equal(
    (await evidenceFor({ baseline: "baseline.healthy.json" })).status,
    "live",
  );
  assert.equal(
    (await evidenceFor({ baseline: "baseline.degraded.json" })).status,
    "degraded",
  );
});

test("stale baseline is explicit and non-blocking", async () => {
  const evidence = await evidenceFor({ baseline: "baseline.stale.json" });
  const baseline = evidence.checks.find((check) => check.check_id === "baseline-comparison");
  assert.equal(baseline.state, "stale");
  assert.equal(baseline.status, "unknown");
  assert.equal(evidence.status, "live");
});

test("ReleaseEvidence validates with the atlas-infra v1 schema", async (context) => {
  const validator = path.join(INFRA_ROOT, "scripts", "validate_release_evidence.py");
  if (!fs.existsSync(validator)) {
    context.skip("set ATLAS_INFRA_ROOT or check out atlas-infra beside this repository");
    return;
  }
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "release-evidence-schema-"));
  const output = path.join(directory, "release-evidence.json");
  await fsp.writeFile(output, renderJson(await evidenceFor()), "utf8");
  execFileSync("python3", [validator, "--instance", output, "--quiet"], {
    stdio: "pipe",
  });
});

test("fixture output is deterministic and idempotent", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "release-watch-idempotent-"));
  const output = path.join(directory, "release-evidence.json");
  const args = [
    "verify",
    "--request",
    fixture("request.json"),
    "--metadata-file",
    fixture("metadata.match.json"),
    "--journey",
    fixture("journey.passed.json"),
    "--fixture",
    "--output",
    output,
  ];
  await runCli(args);
  const first = await fsp.readFile(output);
  await runCli(args);
  assert.deepEqual(first, await fsp.readFile(output));
});

test("workflow environment produces a validated release request", async () => {
  const directory = await fsp.mkdtemp(path.join(os.tmpdir(), "release-watch-request-"));
  const output = path.join(directory, "release-request.json");
  execFileSync(
    process.execPath,
    ["scripts/release-watch.mjs", "request", "--output", output],
    {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: {
        ...process.env,
        RELEASE_REPOSITORY: "AtlasReaper311/atlas-api-public",
        RELEASE_COMMIT: "1111111111111111111111111111111111111111",
        RELEASE_SERVICE_ID: "atlas-api-public",
        RELEASE_ENVIRONMENT: "production",
        RELEASE_DEPLOYMENT_TARGET: "cloudflare-worker:atlas-api-public",
        RELEASE_DEPLOYMENT_ID: "github-run:100",
        RELEASE_METADATA_URL: "https://api.atlas-systems.uk/v1/_meta",
        RELEASE_STARTED_AT: "2026-07-14T10:00:00Z",
        RELEASE_ROLLBACK_REF: "docs/runbooks/release-watch.md",
        RELEASE_EVIDENCE_REF:
          "https://github.com/AtlasReaper311/atlas-journey-watch/actions/runs/100",
      },
      stdio: "pipe",
    },
  );
  const releaseRequest = JSON.parse(await fsp.readFile(output, "utf8"));
  assert.equal(releaseRequest.service_id, "atlas-api-public");
  assert.equal(releaseRequest.observed_release_state, null);
});

test("automatic rollback is refused", async () => {
  await assert.rejects(
    runCli(["verify", "--auto-rollback"]),
    /automatic rollback is not supported/,
  );
});

test("invalid service id is refused", () => {
  assert.throws(() => targetForService("Atlas API"), /invalid service id/);
  assert.throws(() => targetForService("unknown-service"), /unknown release service id/);
});

test("invalid repository ownership is refused", async () => {
  const value = await request();
  assert.throws(
    () => validateReleaseRequest({ ...value, repository: "AtlasReaper311/atlas-infra" }),
    /does not own release service/,
  );
});

test("simple-proxy is excluded from release ownership", () => {
  assert.throws(
    () => targetForService("simple-proxy"),
    /excluded from release ownership/,
  );
});

test("an externally observed rollback is recorded but never initiated", async () => {
  const evidence = await evidenceFor({ requestOverride: { observed_release_state: "rolled-back" } });
  assert.equal(evidence.status, "rolled-back");
});

test("a caller-observed pending release is never reported live", async () => {
  const evidence = await evidenceFor({ requestOverride: { observed_release_state: "pending" } });
  assert.equal(evidence.status, "pending");
});

test("release workflow is read-only and hardened", async () => {
  const workflow = await fsp.readFile(
    fileURLToPath(new URL("../.github/workflows/release-watch.yml", import.meta.url)),
    "utf8",
  );
  assert.match(workflow, /^permissions:\n  contents: read$/m);
  assert.match(workflow, /^concurrency:$/m);
  assert.match(workflow, /timeout-minutes: 25/);
  assert.match(workflow, /retention-days: 30/);
  assert.doesNotMatch(workflow, /contents: write|deployments: write|secrets\./);
  const actions = [...workflow.matchAll(/uses: [^@\s]+@([0-9a-f]{40}) # (\S+)/g)];
  assert.equal(actions.length, 4);
});

test("average-latency baseline variant compares healthy and degraded observations", async () => {
  assert.equal(
    (await evidenceFor({ baseline: "baseline.avg.healthy.json" })).status,
    "live",
  );
  assert.equal(
    (await evidenceFor({ baseline: "baseline.avg.degraded.json" })).status,
    "degraded",
  );
});

test("a baseline mixing latency metrics is unavailable, not a comparison", async () => {
  const evidence = await evidenceFor({ baseline: "baseline.mixed-metrics.json" });
  const baseline = evidence.checks.find(
    (check) => check.check_id === "baseline-comparison",
  );
  assert.equal(baseline.state, "unavailable");
  assert.equal(baseline.status, "unknown");
  assert.equal(evidence.status, "live");
});
