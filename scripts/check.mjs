import { spawnSync } from "node:child_process";

const files = [
  "playwright.config.js",
  "scripts/notify.mjs",
  "scripts/check.mjs",
  "tests/estate.spec.js",
];

for (const file of files) {
  const result = spawnSync(process.execPath, ["--check", file], {
    stdio: "inherit",
  });
  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
}
