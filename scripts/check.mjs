import { spawnSync } from "node:child_process";

const files = [
  "playwright.config.js",
  "scripts/notify.mjs",
  "scripts/check.mjs",
  "scripts/release-targets.mjs",
  "scripts/release-watch.mjs",
  "scripts/run-offline-journeys.mjs",
  "scripts/run-release-journeys.mjs",
  "tests/estate.spec.js",
  "tests/offline-request.mjs",
  "tests/release-watch.test.mjs",
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
