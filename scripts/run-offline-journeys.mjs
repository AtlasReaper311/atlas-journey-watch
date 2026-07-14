import { spawnSync } from "node:child_process";

import { targetForService } from "./release-targets.mjs";

const serviceIndex = process.argv.indexOf("--service-id");
const serviceId = serviceIndex === -1 ? null : process.argv[serviceIndex + 1];

try {
  if (serviceId) {
    targetForService(serviceId);
  }
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  const tests = spawnSync(executable, ["playwright", "test"], {
    env: {
      ...process.env,
      ATLAS_FIXTURE_MODE: "1",
      ATLAS_API_URL: "https://fixture.invalid",
      ATLAS_SITE_URL: "https://site.fixture.invalid",
      ATLAS_STATUS_URL: "https://fixture.invalid/status-page",
      ATLAS_CORPUS_URL: "https://corpus.fixture.invalid",
      ATLAS_RAMONE_URL: "https://ramone.fixture.invalid",
      ...(serviceId ? { ATLAS_RELEASE_SERVICE_ID: serviceId } : {}),
    },
    stdio: "inherit",
  });
  process.exitCode = tests.status ?? 1;
} catch (error) {
  console.error(`offline journeys: ${error.message}`);
  process.exitCode = 1;
}
