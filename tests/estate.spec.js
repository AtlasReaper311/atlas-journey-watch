import { expect, test } from "@playwright/test";

const API = process.env.ATLAS_API_URL || "https://api.atlas-systems.uk";
const STATUS = process.env.ATLAS_STATUS_URL || "https://status.atlas-systems.uk";
const SITE = process.env.ATLAS_SITE_URL || "https://atlas-systems.uk";
const CORPUS = process.env.ATLAS_CORPUS_URL || "https://corpus.atlas-systems.uk";
const RAMONE = process.env.ATLAS_RAMONE_URL || "https://ramone.atlas-systems.uk";

function firstArray(value, preferredKeys = []) {
  if (Array.isArray(value)) {
    return value;
  }

  if (!value || typeof value !== "object") {
    return null;
  }

  for (const key of preferredKeys) {
    if (Array.isArray(value[key])) {
      return value[key];
    }
  }

  for (const child of Object.values(value)) {
    const found = firstArray(child, preferredKeys);
    if (found) {
      return found;
    }
  }

  return null;
}

async function jsonOrFail(response, label) {
  expect(response, `${label} response was missing`).toBeTruthy();
  expect(response.ok(), `${label} returned ${response.status()}`).toBeTruthy();

  const contentType = response.headers()["content-type"] || "";
  expect(contentType, `${label} did not return JSON`).toContain("application/json");

  return response.json();
}

async function optionalJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

async function textOrFail(response, label) {
  expect(response, `${label} response was missing`).toBeTruthy();
  expect(response.ok(), `${label} returned ${response.status()}`).toBeTruthy();

  const text = await response.text();
  expect(text.length, `${label} returned an empty body`).toBeGreaterThan(200);
  expect(text.toLowerCase(), `${label} returned an obvious server error`).not.toMatch(
    /application error|internal server error|cannot read properties/,
  );

  return text;
}

test.describe("public estate journeys", () => {
  test("public API advertises a working OpenAPI contract", async ({ request }) => {
    const index = await jsonOrFail(await request.get(`${API}/v1`), "public API index");
    expect(index).toBeTruthy();

    const spec = await jsonOrFail(
      await request.get(`${API}/v1/openapi.json`),
      "OpenAPI document",
    );

    expect(spec.openapi).toMatch(/^3\./);
    expect(spec.paths).toBeTruthy();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(3);
    expect(spec.paths["/v1/registry"]).toBeTruthy();
    expect(spec.paths["/v1/search"]).toBeTruthy();
  });

  test("registry data reaches the public Lab surface", async ({ request }) => {
    const registry = await jsonOrFail(
      await request.get(`${API}/v1/registry`),
      "estate registry",
    );

    const entries = firstArray(registry, ["workers", "services", "components", "items"]);
    expect(entries, "registry did not expose a component array").toBeTruthy();
    expect(entries.length).toBeGreaterThan(0);

    const html = await textOrFail(await request.get(`${SITE}/lab/`), "Lab page");
    expect(html).toMatch(/Lab|Live systems|System map|atlas-api-public|atlas-notify/i);
  });

  test("estate search returns provenance, rate-limit honesty, or an honest upstream state", async ({ request }) => {
    const response = await request.get(`${API}/v1/search`, {
      params: { q: "zone_id Cloudflare route" },
    });

    expect([200, 429, 502, 503]).toContain(response.status());

    const payload = await optionalJson(response);

    if (response.status() === 429) {
      expect(JSON.stringify(payload).toLowerCase()).toMatch(/rate|limit|too many/);
      return;
    }

    if ([502, 503].includes(response.status())) {
      const infra = await jsonOrFail(
        await request.get(`${API}/v1/infra/status`),
        "infra status",
      );

      const serialized = `${JSON.stringify(payload)} ${JSON.stringify(infra)}`.toLowerCase();
      expect(serialized).toMatch(
        /down|offline|degraded|stale|unreachable|false|bad gateway|upstream|error/,
      );
      return;
    }

    const hits = firstArray(payload, ["hits", "results", "items"]);
    expect(hits, "search did not expose a result array").toBeTruthy();
    expect(hits.length).toBeGreaterThan(0);

    const first = hits[0];
    expect(first).toBeTruthy();

    const serialized = JSON.stringify(first).toLowerCase();
    expect(serialized).toMatch(/repo|source|path|file|provenance/);
  });

  test("notification history remains readable", async ({ request }) => {
    const payload = await jsonOrFail(
      await request.get(`${API}/notify/recent`),
      "recent notification feed",
    );

    const events = firstArray(payload, ["events", "entries", "items"]);
    expect(events, "notification feed did not expose an event array").toBeTruthy();
    expect(events.length).toBeLessThanOrEqual(200);
  });

  test("local AI services report honest availability", async ({ request }) => {
    const ramone = await jsonOrFail(
      await request.get(`${RAMONE}/status`),
      "Ramone status",
    );

    expect(typeof ramone.awake).toBe("boolean");
    expect(ramone.checked_at).toBeTruthy();

    if (!ramone.awake) {
      return;
    }

    const corpus = await request.get(`${CORPUS}/health`);

    if ([429, 502, 503].includes(corpus.status())) {
      const payload = await optionalJson(corpus);
      expect(JSON.stringify(payload).toLowerCase()).toMatch(
        /rate|limit|sleep|down|offline|degraded|stale|unreachable|false|bad gateway|upstream|error/,
      );
      return;
    }

    expect(corpus.ok(), `corpus health returned ${corpus.status()}`).toBeTruthy();
  });


  test("quota watchdog exposes a healthy usage snapshot", async ({ request }) => {
    const payload = await jsonOrFail(
      await request.get(`${API}/quota`),
      "quota watchdog",
    );

    expect(Array.isArray(payload.meters), "quota snapshot did not expose meters").toBeTruthy();
    expect(payload.meters.length).toBeGreaterThan(0);
    expect(payload.period).toBeTruthy();
    expect(payload.generated_at).toBeTruthy();
  });

  test("public status surface renders service state", async ({ request }) => {
    const html = await textOrFail(await request.get(STATUS), "Status page");

    expect(html).toMatch(
      /atlas[_\s-]?systems|atlas-systems\.uk|Every service|Live signal|Service levels/i,
    );

    expect(html).toMatch(
      /Operational|Unreachable|public API|event router|worker registry/i,
    );
  });
});
