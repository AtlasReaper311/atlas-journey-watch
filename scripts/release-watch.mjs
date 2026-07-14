import fs from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

import { targetForService, validateMetadataUrl } from "./release-targets.mjs";

const COMMIT = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/;
const DEPLOYMENT_ID = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const DEPLOYMENT_TARGET = /^[a-z0-9]+(?:[a-z0-9 .:/_-]*[a-z0-9])?$/;
const REPOSITORY = /^AtlasReaper311\/[A-Za-z0-9._-]+$/;
const ROLLBACK_REF = /^(?!\/)(?!.*(?:^|\/)\.\.(?:\/|$))[A-Za-z0-9._/-]+\.md$/;
const UTC_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,6})?Z$/;
const ENVIRONMENTS = new Set(["development", "preview", "production"]);
const OBSERVED_STATES = new Set(["pending", "rolled-back"]);
const FIXTURE_COMPLETED_AT = "2026-07-14T10:05:00Z";

function utcTimestamp(value, field) {
  if (!UTC_TIMESTAMP.test(value || "") || Number.isNaN(Date.parse(value))) {
    throw new Error(`${field} must be a UTC RFC 3339 timestamp ending in Z`);
  }
  return value;
}

function httpsEvidenceRef(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("evidence_ref must be an HTTPS URL");
  }
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search) {
    throw new Error("evidence_ref must be HTTPS without credentials or query");
  }
  return value;
}

export function validateReleaseRequest(input) {
  const serviceId = String(input.service_id || "");
  const target = targetForService(serviceId);
  const repository = String(input.repository || "");
  if (!REPOSITORY.test(repository)) {
    throw new Error("repository must use AtlasReaper311/name form");
  }
  if (repository !== target.repository) {
    throw new Error(
      `repository ${repository} does not own release service ${serviceId}`,
    );
  }

  const commit = String(input.commit || "");
  if (!COMMIT.test(commit)) {
    throw new Error("commit must be a full lowercase 40- or 64-character SHA");
  }
  const environment = String(input.environment || "");
  if (!ENVIRONMENTS.has(environment)) {
    throw new Error("environment must be development, preview, or production");
  }
  const deploymentTarget = String(input.deployment_target || "");
  if (!DEPLOYMENT_TARGET.test(deploymentTarget) || deploymentTarget.length > 160) {
    throw new Error("deployment_target does not match the ReleaseEvidence contract");
  }
  const deploymentId = String(input.deployment_id || "");
  if (!DEPLOYMENT_ID.test(deploymentId)) {
    throw new Error("deployment_id does not match the ReleaseEvidence contract");
  }
  const rollbackRef = String(input.rollback_ref || "");
  if (!ROLLBACK_REF.test(rollbackRef) || rollbackRef.length > 240) {
    throw new Error("rollback_ref must be a safe repository-relative Markdown path");
  }

  const metadataUrl = input.metadata_url
    ? validateMetadataUrl(String(input.metadata_url), target)
    : null;
  const observedReleaseState = input.observed_release_state
    ? String(input.observed_release_state)
    : null;
  if (observedReleaseState && !OBSERVED_STATES.has(observedReleaseState)) {
    throw new Error("observed_release_state may only be pending or rolled-back");
  }

  return {
    repository,
    commit,
    service_id: serviceId,
    environment,
    deployment_target: deploymentTarget,
    deployment_id: deploymentId,
    metadata_url: metadataUrl,
    started_at: utcTimestamp(String(input.started_at || ""), "started_at"),
    rollback_ref: rollbackRef,
    evidence_ref: httpsEvidenceRef(String(input.evidence_ref || "")),
    observed_release_state: observedReleaseState,
  };
}

function nestedValue(value, dottedPath) {
  let current = value;
  for (const part of dottedPath.split(".")) {
    if (!current || typeof current !== "object" || !(part in current)) {
      return undefined;
    }
    current = current[part];
  }
  return current;
}

function firstValue(value, paths) {
  for (const dottedPath of paths) {
    const found = nestedValue(value, dottedPath);
    if (typeof found === "string" && found.length > 0) {
      return found;
    }
  }
  return null;
}

function parseHtmlMetadata(text) {
  const metadata = {};
  for (const tag of text.match(/<meta\s+[^>]*>/gi) || []) {
    const attributes = {};
    for (const match of tag.matchAll(/([a-zA-Z][\w:-]*)\s*=\s*["']([^"']*)["']/g)) {
      attributes[match[1].toLowerCase()] = match[2];
    }
    if (attributes.name && attributes.content) {
      metadata[attributes.name.toLowerCase()] = attributes.content;
    }
  }
  return {
    repository: metadata["build-repository"],
    commit: metadata["build-commit"],
    service_id: metadata["service-id"],
    environment: metadata["build-environment"],
  };
}

function parseMetadataText(text, contentType = "") {
  if (contentType.includes("text/html") || text.trimStart().startsWith("<")) {
    return { source_state: "healthy", data: parseHtmlMetadata(text) };
  }
  try {
    const data = JSON.parse(text);
    if (data?.fixture_state === "unavailable") {
      return { source_state: "unavailable", data: null };
    }
    return { source_state: "healthy", data };
  } catch {
    return { source_state: "failed", data: null };
  }
}

export async function loadMetadata({ file, url, timeoutMs = 8_000, fetchImpl = fetch }) {
  if (file) {
    try {
      const text = await fs.readFile(file, "utf8");
      return parseMetadataText(text, file.endsWith(".html") ? "text/html" : "");
    } catch {
      return { source_state: "unavailable", data: null };
    }
  }
  if (!url) {
    return { source_state: "unavailable", data: null };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json, text/html;q=0.8" },
      signal: controller.signal,
    });
    if (!response.ok) {
      return { source_state: "unavailable", data: null };
    }
    return parseMetadataText(
      await response.text(),
      response.headers.get("content-type") || "",
    );
  } catch {
    return { source_state: "unavailable", data: null };
  } finally {
    clearTimeout(timer);
  }
}

export function classifyLiveIdentity(request, observation) {
  if (observation.source_state === "unavailable") {
    return {
      state: "unavailable",
      live_identity: "unavailable",
      check_status: "unknown",
      release_status: "unknown",
      reason: "live metadata endpoint unavailable",
    };
  }
  if (observation.source_state !== "healthy" || !observation.data) {
    return {
      state: "failed",
      live_identity: "unknown",
      check_status: "failed",
      release_status: "failed",
      reason: "live metadata response malformed",
    };
  }

  const live = {
    repository: firstValue(observation.data, [
      "repository",
      "release.repository",
      "source.repository",
    ]),
    commit: firstValue(observation.data, [
      "commit",
      "sha",
      "git_sha",
      "release.commit",
      "build.commit",
    ]),
    service_id: firstValue(observation.data, [
      "service_id",
      "release.service_id",
      "service.id",
    ]),
    environment: firstValue(observation.data, [
      "environment",
      "release.environment",
      "build.environment",
    ]),
  };
  const missing = Object.entries(live)
    .filter(([, value]) => !value)
    .map(([key]) => key);
  if (missing.length > 0) {
    return {
      state: "failed",
      live_identity: "unknown",
      check_status: "failed",
      release_status: "failed",
      reason: `live metadata missing required fields: ${missing.join(", ")}`,
    };
  }

  const mismatches = Object.entries(live)
    .filter(([key, value]) => value !== request[key])
    .map(([key]) => key);
  if (mismatches.length > 0) {
    return {
      state: "failed",
      live_identity: "mismatched",
      check_status: "failed",
      release_status: "mismatch",
      reason: `live metadata mismatch: ${mismatches.join(", ")}`,
    };
  }
  return {
    state: "healthy",
    live_identity: "matched",
    check_status: "passed",
    release_status: "live",
    reason: "live metadata matches the expected release identity",
  };
}

function playwrightTests(value, output = []) {
  if (!value || typeof value !== "object") {
    return output;
  }
  if (Array.isArray(value.tests)) {
    output.push(...value.tests);
  }
  for (const child of Object.values(value)) {
    if (child && typeof child === "object") {
      playwrightTests(child, output);
    }
  }
  return output;
}

export async function loadJourneyResult(file) {
  if (!file) {
    return {
      state: "unknown",
      pending: true,
      journey_result: "skipped",
      check_status: "skipped",
    };
  }
  let report;
  try {
    report = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return { state: "unavailable", journey_result: "unknown", check_status: "unknown" };
  }
  if (report.fixture_state === "passed") {
    return { state: "healthy", journey_result: "passed", check_status: "passed" };
  }
  if (report.fixture_state === "failed") {
    return { state: "failed", journey_result: "failed", check_status: "failed" };
  }
  if (report.fixture_state === "unavailable") {
    return { state: "unavailable", journey_result: "unknown", check_status: "unknown" };
  }

  const tests = playwrightTests(report);
  const terminal = tests
    .map((test) => (test.results || []).at(-1)?.status || test.status)
    .filter((status) => status && status !== "skipped");
  if (terminal.length === 0) {
    return { state: "unavailable", journey_result: "unknown", check_status: "unknown" };
  }
  if (terminal.some((status) => status !== "passed" && status !== "expected")) {
    return { state: "failed", journey_result: "failed", check_status: "failed" };
  }
  return { state: "healthy", journey_result: "passed", check_status: "passed" };
}

function nonNegativeNumber(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

export async function loadBaselineResult(file, observedAt = new Date().toISOString()) {
  if (!file) {
    return { state: "unavailable", check_status: "unknown" };
  }
  let report;
  try {
    report = JSON.parse(await fs.readFile(file, "utf8"));
  } catch {
    return { state: "unavailable", check_status: "unknown" };
  }
  const values = [
    report?.baseline?.latency_ms_p95,
    report?.baseline?.error_rate,
    report?.observed?.latency_ms_p95,
    report?.observed?.error_rate,
    report?.thresholds?.latency_regression_percent,
    report?.thresholds?.error_rate_increase,
  ];
  if (
    report.schema_version !== "atlas-journey-watch/release-baseline/v1" ||
    !UTC_TIMESTAMP.test(report.generated_at || "") ||
    !UTC_TIMESTAMP.test(report.stale_after || "") ||
    !values.every(nonNegativeNumber) ||
    report.baseline.latency_ms_p95 === 0
  ) {
    return { state: "unavailable", check_status: "unknown" };
  }
  if (
    Date.parse(report.generated_at) > Date.parse(observedAt) ||
    Date.parse(report.stale_after) < Date.parse(observedAt)
  ) {
    return { state: "stale", check_status: "unknown" };
  }

  const latencyRegression =
    ((report.observed.latency_ms_p95 - report.baseline.latency_ms_p95) /
      report.baseline.latency_ms_p95) *
    100;
  const errorIncrease = report.observed.error_rate - report.baseline.error_rate;
  if (
    latencyRegression > report.thresholds.latency_regression_percent ||
    errorIncrease > report.thresholds.error_rate_increase
  ) {
    return { state: "warning", check_status: "failed" };
  }
  return { state: "healthy", check_status: "passed" };
}

function finalReleaseStatus(request, identity, journey, baseline) {
  if (request.observed_release_state) {
    return request.observed_release_state;
  }
  if (identity.release_status !== "live") {
    return identity.release_status;
  }
  if (journey.pending) {
    return "pending";
  }
  if (journey.state === "failed") {
    return "failed";
  }
  if (journey.state !== "healthy" || baseline.state === "warning") {
    return "degraded";
  }
  return "live";
}

export function createReleaseEvidence({
  request,
  identity,
  journey,
  baseline,
  completedAt,
}) {
  utcTimestamp(completedAt, "completed_at");
  if (Date.parse(completedAt) < Date.parse(request.started_at)) {
    throw new Error("completed_at must not precede started_at");
  }
  return {
    schema_version: "atlas-control-plane/release-evidence/v1",
    repository: request.repository,
    service_id: request.service_id,
    commit: request.commit,
    deployment_id: request.deployment_id,
    deployment_target: request.deployment_target,
    environment: request.environment,
    started_at: request.started_at,
    completed_at: completedAt,
    checks: [
      {
        check_id: "live-identity",
        status: identity.check_status,
        state: identity.state,
        evidence_ref: request.evidence_ref,
      },
      {
        check_id: "targeted-journeys",
        status: journey.check_status,
        state: journey.state,
        evidence_ref: request.evidence_ref,
      },
      {
        check_id: "baseline-comparison",
        status: baseline.check_status,
        state: baseline.state,
        evidence_ref: request.evidence_ref,
      },
    ],
    journey_result: journey.journey_result,
    live_identity: identity.live_identity,
    rollback_ref: request.rollback_ref,
    status: finalReleaseStatus(request, identity, journey, baseline),
  };
}

export function renderJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function parseOptions(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (!token.startsWith("--")) {
      throw new Error(`unexpected argument: ${token}`);
    }
    const key = token.slice(2);
    if (key === "fixture" || key === "auto-rollback") {
      options[key] = true;
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      throw new Error(`missing value for --${key}`);
    }
    options[key] = value;
    index += 1;
  }
  return options;
}

async function readJson(file) {
  return JSON.parse(await fs.readFile(file, "utf8"));
}

async function writeJson(file, value) {
  await fs.mkdir(path.dirname(path.resolve(file)), { recursive: true });
  await fs.writeFile(file, renderJson(value), "utf8");
}

function requestFromEnvironment() {
  const runUrl = process.env.RELEASE_EVIDENCE_REF ||
    `${process.env.GITHUB_SERVER_URL}/${process.env.GITHUB_REPOSITORY}/actions/runs/${process.env.GITHUB_RUN_ID}`;
  return validateReleaseRequest({
    repository: process.env.RELEASE_REPOSITORY,
    commit: process.env.RELEASE_COMMIT,
    service_id: process.env.RELEASE_SERVICE_ID,
    environment: process.env.RELEASE_ENVIRONMENT,
    deployment_target: process.env.RELEASE_DEPLOYMENT_TARGET,
    deployment_id: process.env.RELEASE_DEPLOYMENT_ID,
    metadata_url: process.env.RELEASE_METADATA_URL,
    started_at: process.env.RELEASE_STARTED_AT || new Date().toISOString(),
    rollback_ref: process.env.RELEASE_ROLLBACK_REF,
    evidence_ref: runUrl,
    observed_release_state: process.env.RELEASE_OBSERVED_STATE,
  });
}

export async function runCli(argv) {
  const [command, ...rest] = argv;
  const options = parseOptions(rest);
  if (options["auto-rollback"]) {
    throw new Error("automatic rollback is not supported by release watch");
  }

  if (command === "request") {
    if (!options.output) {
      throw new Error("request requires --output");
    }
    const request = requestFromEnvironment();
    await writeJson(options.output, request);
    if (process.env.GITHUB_OUTPUT) {
      await fs.appendFile(process.env.GITHUB_OUTPUT, `service_id=${request.service_id}\n`);
    }
    return request;
  }

  if (command === "verify") {
    if (!options.request || !options.output) {
      throw new Error("verify requires --request and --output");
    }
    const request = validateReleaseRequest(await readJson(options.request));
    const metadata = await loadMetadata({
      file: options["metadata-file"],
      url: options["metadata-file"] ? null : request.metadata_url,
    });
    const completedAt = options["completed-at"] ||
      (options.fixture ? FIXTURE_COMPLETED_AT : new Date().toISOString());
    const identity = classifyLiveIdentity(request, metadata);
    const journey = await loadJourneyResult(options.journey);
    const baseline = await loadBaselineResult(options.baseline, completedAt);
    const evidence = createReleaseEvidence({
      request,
      identity,
      journey,
      baseline,
      completedAt,
    });
    await writeJson(options.output, evidence);
    return evidence;
  }

  if (command === "assert") {
    if (!options.evidence) {
      throw new Error("assert requires --evidence");
    }
    const evidence = await readJson(options.evidence);
    if (evidence.status !== "live") {
      throw new Error(`release verification is ${evidence.status}, not live`);
    }
    return evidence;
  }

  throw new Error("expected command: request, verify, or assert");
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  runCli(process.argv.slice(2))
    .then((result) => {
      console.log(`release-watch status=${result.status || "request-ready"}`);
    })
    .catch((error) => {
      console.error(`release-watch: ${error.message}`);
      process.exitCode = 1;
    });
}
