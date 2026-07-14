class FixtureResponse {
  constructor(status, payload, contentType = "application/json") {
    this.statusCode = status;
    this.payload = payload;
    this.contentType = contentType;
  }

  ok() {
    return this.statusCode >= 200 && this.statusCode < 300;
  }

  status() {
    return this.statusCode;
  }

  headers() {
    return { "content-type": this.contentType };
  }

  async json() {
    return this.payload;
  }

  async text() {
    return typeof this.payload === "string"
      ? this.payload
      : JSON.stringify(this.payload);
  }
}

const fixtureHtml = (text) =>
  `<!doctype html><html><body>${text}${" fixture".repeat(80)}</body></html>`;

export function createOfflineRequest() {
  return {
    async get(value) {
      const { pathname } = new URL(value);
      if (pathname === "/v1") {
        return new FixtureResponse(200, { service: "atlas-api-public", status: "ok" });
      }
      if (pathname === "/v1/openapi.json") {
        return new FixtureResponse(200, {
          openapi: "3.1.0",
          paths: {
            "/v1/registry": {},
            "/v1/search": {},
            "/v1/stats": {},
            "/v1/slo": {},
          },
        });
      }
      if (pathname === "/v1/registry") {
        return new FixtureResponse(200, {
          services: [{ service_id: "atlas-api-public" }],
        });
      }
      if (pathname === "/v1/search") {
        return new FixtureResponse(200, {
          hits: [{ repository: "atlas-infra", path: "README.md" }],
        });
      }
      if (pathname === "/notify/recent") {
        return new FixtureResponse(200, { events: [{ title: "fixture event" }] });
      }
      if (pathname === "/status") {
        return new FixtureResponse(200, {
          awake: false,
          checked_at: "2026-07-14T10:00:00Z",
        });
      }
      if (pathname === "/quota") {
        return new FixtureResponse(200, {
          meters: [{ id: "worker-requests", state: "healthy" }],
          period: "2026-07",
          generated_at: "2026-07-14T10:00:00Z",
        });
      }
      if (pathname === "/lab/") {
        return new FixtureResponse(
          200,
          fixtureHtml("Atlas Systems Lab Live systems System map atlas-api-public"),
          "text/html; charset=utf-8",
        );
      }
      if (pathname === "/status-page") {
        return new FixtureResponse(
          200,
          fixtureHtml("Atlas Systems Every service Operational public API event router"),
          "text/html; charset=utf-8",
        );
      }
      return new FixtureResponse(404, { error: "not found" });
    },
  };
}
