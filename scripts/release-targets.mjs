import fs from "node:fs";

const SERVICE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const REPOSITORY = /^AtlasReaper311\/[A-Za-z0-9._-]+$/;
const CONFIG_URL = new URL("../config/release-targets.json", import.meta.url);

let cachedConfig;

export function loadReleaseTargets() {
  if (cachedConfig) {
    return cachedConfig;
  }

  const config = JSON.parse(fs.readFileSync(CONFIG_URL, "utf8"));
  if (config.schema_version !== "atlas-journey-watch/release-targets/v1") {
    throw new Error("release target configuration has an unsupported schema version");
  }

  const ids = new Set();
  for (const target of config.targets || []) {
    if (!SERVICE_ID.test(target.service_id) || !REPOSITORY.test(target.repository)) {
      throw new Error(`release target configuration is invalid for ${target.service_id}`);
    }
    if (ids.has(target.service_id)) {
      throw new Error(`duplicate release target: ${target.service_id}`);
    }
    if (!Array.isArray(target.metadata_hosts) || target.metadata_hosts.length === 0) {
      throw new Error(`release target has no metadata hosts: ${target.service_id}`);
    }
    if (!Array.isArray(target.journey_ids) || target.journey_ids.length === 0) {
      throw new Error(`release target has no journeys: ${target.service_id}`);
    }
    ids.add(target.service_id);
  }

  cachedConfig = config;
  return config;
}

export function targetForService(serviceId) {
  if (!SERVICE_ID.test(serviceId || "")) {
    throw new Error(`invalid service id: ${serviceId || "<empty>"}`);
  }

  const config = loadReleaseTargets();
  const excluded = (config.excluded || []).find((item) => item.service_id === serviceId);
  if (excluded) {
    throw new Error(`${serviceId} is excluded from release ownership: ${excluded.reason}`);
  }

  const target = config.targets.find((item) => item.service_id === serviceId);
  if (!target) {
    throw new Error(`unknown release service id: ${serviceId}`);
  }
  return target;
}

export function journeyIdsForService(serviceId) {
  return [...targetForService(serviceId).journey_ids];
}

export function validateMetadataUrl(value, target) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("metadata_url must be an absolute HTTPS URL");
  }
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.search ||
    parsed.hash
  ) {
    throw new Error("metadata_url must be HTTPS without credentials, query, or fragment");
  }
  if (!target.metadata_hosts.includes(parsed.hostname)) {
    throw new Error(`metadata_url host is not allowlisted for ${target.service_id}`);
  }
  return parsed.toString();
}
