import { spawnSync } from "node:child_process";
import { pathToFileURL } from "node:url";

import { targetForService } from "./release-targets.mjs";

function serviceIdFromArgs(argv) {
  const index = argv.indexOf("--service-id");
  if (index === -1 || !argv[index + 1]) {
    throw new Error("--service-id is required");
  }
  return argv[index + 1];
}

export function runReleaseJourneys(serviceId, extraEnv = {}) {
  targetForService(serviceId);
  const executable = process.platform === "win32" ? "npx.cmd" : "npx";
  return spawnSync(executable, ["playwright", "test"], {
    env: {
      ...process.env,
      ...extraEnv,
      ATLAS_RELEASE_SERVICE_ID: serviceId,
    },
    stdio: "inherit",
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const result = runReleaseJourneys(serviceIdFromArgs(process.argv.slice(2)));
    process.exitCode = result.status ?? 1;
  } catch (error) {
    console.error(`release journeys: ${error.message}`);
    process.exitCode = 1;
  }
}
