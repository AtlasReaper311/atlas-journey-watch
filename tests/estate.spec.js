import { expect, test } from "@playwright/test";

const API = process.env.ATLAS_API_URL || "https://api.atlas-systems.uk";
const STATUS =
  process.env.ATLAS_STATUS_URL || "https://status.atlas-systems.uk";
const CORPUS =
  process.env.ATLAS_CORPUS_URL || "https://corpus.atlas-systems.uk";
const RAMONE =
  process.env.ATLAS_RAMONE_URL || "https://ramone.atlas-systems.uk";

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
  expect(contentType, `${label} did not return JSON`).toContain(
    "application/json",
  );

  return response.json();
}

async function optionalJson(response) {
  try {
    return await response.json();
  } catch {
    return {};
  }
}

test.describe("public estate journeys", () => {
  test("public API advertises a working OpenAPI contract", async ({
    request,
  }) => {
    const index = await jsonOrFail(
      await request.get(`${API}/v1`),
      "public API index",
    );
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

  test("registry data reaches the Lab system map", async ({
    page,
    request,
  }) => {
    const registry = await jsonOrFail(
      await request.get(`${API}/v1/registry`),
      "estate registry",
    );

    const entries = firstArray(registry, [
      "workers",
      "services",
      "components",
      "items",
    ]);
    expect(entries, "registry did not expose a component array").toBeTruthy();
    expect(entries.length).toBeGreaterThan(0);

    await page.goto("/lab/", { waitUntil: "domcontentloaded" });

    await expect(page).toHaveTitle(/Lab.*Atlas Systems/i);

    await expect(page.locator("body")).toContainText(/System map/i, {
      timeout: 20_000,
    });

    await expect(page.locator("body")).toContainText(
      /atlas-api-public|atlas-api-index|atlas-notify/i,
      { timeout: 20_000 },
    );

    await expect(page.locator("body")).not.toContainText(
      /application error|internal server error/i,
    );
  });

  test("estate search returns provenance, rate-limit honesty, or an honest sleep state", async ({
    request,
  }) => {
    const response = await request.get(`${API}/v1/search`, {
      params: { q: "zone_id Cloudflare route" },
    });

    expect([200, 429, 503]).toContain(response.status());

    const payload = await optionalJson(response);

    if (response.status() === 429) {
      expect(JSON.stringify(payload).toLowerCase()).toMatch(
        /rate|limit|too many/,
      );
      return;
    }

    if (response.status() === 503) {
      expect(payload.ok).toBeFalsy();

      const infra = await jsonOrFail(
        await request.get(`${API}/v1/infra/status`),
        "infra status",
      );

      const serialized = JSON.stringify(infra).toLowerCase();
      expect(serialized).toMatch(
        /down|offline|degraded|stale|unreachable|false/,
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
    expect(
      events,
      "notification feed did not expose an event array",
    ).toBeTruthy();
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

    if ([429, 503].includes(corpus.status())) {
      const payload = await optionalJson(corpus);
      expect(JSON.stringify(payload).toLowerCase()).toMatch(
        /rate|limit|sleep|down|offline|degraded|stale|unreachable|false/,
      );
      return;
    }

    expect(
      corpus.ok(),
      `corpus health returned ${corpus.status()}`,
    ).toBeTruthy();
  });

  test("public status surface renders service state", async ({ page }) => {
    const response = await page.goto(STATUS, { waitUntil: "networkidle" });

    expect(response).toBeTruthy();
    expect(response.ok()).toBeTruthy();

    await expect(page).toHaveTitle(/status|atlas/i);

    await expect(page.locator("body")).toContainText(
      /Atlas[_\s]Systems|atlas-systems\.uk/i,
      { timeout: 12_000 },
    );

    await expect(page.locator("body")).toContainText(
      /Live signal|Service levels|Operational|Unreachable/i,
      { timeout: 12_000 },
    );

    await expect(page.locator("body")).not.toContainText(
      /application error|internal server error/i,
    );
  });
});
