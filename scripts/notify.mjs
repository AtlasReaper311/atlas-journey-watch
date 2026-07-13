import fs from "node:fs/promises";

const notifyToken = process.env.NOTIFY_TOKEN || "";
const notifyUrl = process.env.NOTIFY_URL || "https://api.atlas-systems.uk/notify";
const runUrl = process.env.RUN_URL || "";
const resultPath = process.env.RESULT_PATH || "test-results/results.json";

if (!notifyToken) {
  console.log("NOTIFY_TOKEN is not set. Skipping atlas-notify delivery.");
  process.exit(0);
}

let summary = "Synthetic journey run failed before a JSON report was written.";
try {
  const raw = await fs.readFile(resultPath, "utf8");
  const report = JSON.parse(raw);
  const failures = [];
  for (const suite of report.suites || []) {
    for (const spec of suite.specs || []) {
      for (const test of spec.tests || []) {
        const failed = (test.results || []).some((result) => result.status !== "passed");
        if (failed) {
          failures.push(`${suite.title}: ${spec.title}`);
        }
      }
    }
  }
  if (failures.length > 0) {
    summary = `${failures.length} journey checks failed: ${failures.slice(0, 4).join("; ")}`;
  }
} catch (error) {
  summary = `Synthetic journey run failed and report parsing also failed: ${error.message}`;
}

const response = await fetch(notifyUrl, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${notifyToken}`,
    "Content-Type": "application/json",
  },
  body: JSON.stringify({
    source: "alert",
    level: "failure",
    title: "Estate journey failure",
    message: summary.slice(0, 900),
    url: runUrl,
    persist_only: true,
  }),
});

if (!response.ok) {
  const body = await response.text();
  throw new Error(`atlas-notify returned ${response.status}: ${body.slice(0, 300)}`);
}

console.log("Posted consolidated journey failure to atlas-notify.");
