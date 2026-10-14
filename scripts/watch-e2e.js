import fs from "node:fs";
import { spawn } from "node:child_process";

// Local E2E watch loop: reruns Playwright whenever the source or the E2E specs
// change, so a failing assertion surfaces within a second or two of the edit.
// Dependency-free — Node builtins only.
//
// Defaults are injected only when the caller has not already supplied them:
//   --project=chromium          the functional loop
//   --grep-invert @screenshots  keeps the screenshot matrix out of the fast loop
//   --reporter=line             compact, non-interactive output
//
// Any further arguments are passed straight through to `playwright test`, e.g.
//   node scripts/watch-e2e.js tests/e2e/core.spec.js
//
// The screenshot-matrix loop (`watch:matrix`) passes `--project=screenshots`.
// Because every matrix spec is tagged `@screenshots`, the grep-invert default
// is skipped whenever a non-chromium project is requested: injecting it there
// would filter out every spec the loop exists to run.

const WATCH_DIRS = ["src", "tests/e2e"];
const DEBOUNCE_MS = 300;
const KILL_GRACE_MS = 2000;
const FORCE_EXIT_MS = 3000;

function hasFlag(args, name) {
  return args.some((arg) => arg === name || arg.startsWith(`${name}=`));
}

function buildArgs() {
  const args = process.argv.slice(2);

  const projectArg = args.find((arg) => arg.startsWith("--project="));
  const projects = projectArg
    ? projectArg.slice("--project=".length).split(",")
    : [];
  const isMatrixLoop = projects.length > 0 && !projects.includes("chromium");

  if (!hasFlag(args, "--project")) args.push("--project=chromium");
  if (
    !hasFlag(args, "--grep-invert") &&
    !hasFlag(args, "--grep") &&
    !isMatrixLoop
  ) {
    args.push("--grep-invert", "@screenshots");
  }
  if (!hasFlag(args, "--reporter")) args.push("--reporter=line");

  return args;
}

const args = buildArgs();
const command = ["npx", "playwright", "test", ...args].join(" ");

let running = false;
let queued = false;
let child = null;
let debounceTimer = null;
let shuttingDown = false;
const watchers = [];

function runOnce() {
  if (shuttingDown) return;
  if (running) {
    queued = true;
    return;
  }

  running = true;
  const startedAt = Date.now();

  const promise = new Promise((resolve) => {
    child = spawn("npx", ["playwright", "test", ...args], {
      stdio: "inherit",
      detached: process.platform !== "win32",
    });
    child.on("error", (err) => {
      console.error(`[watch] could not start Playwright: ${err.message}`);
      resolve(null);
    });
    child.on("exit", (code, signal) => {
      resolve(signal ? `signal ${signal}` : code);
    });
  });

  promise.then((outcome) => {
    child = null;
    running = false;
    const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

    if (!shuttingDown) {
      if (typeof outcome === "number") {
        const label = outcome === 0 ? "passed" : "failed";
        console.log(`[watch] ${label} — exit ${outcome} — ${seconds}s`);
      } else {
        console.log(`[watch] stopped — ${outcome} — ${seconds}s`);
      }
    }

    if (queued) {
      queued = false;
      if (!shuttingDown) runOnce();
    } else if (!shuttingDown) {
      console.log("[watch] watching src/ and tests/e2e/ …");
    }
  });
}

function scheduleRun() {
  if (shuttingDown) return;
  if (debounceTimer) clearTimeout(debounceTimer);
  debounceTimer = setTimeout(() => {
    debounceTimer = null;
    if (running) {
      if (!queued) {
        console.log(
          "[watch] change detected — queued until the current run finishes…",
        );
      }
      queued = true;
    } else {
      console.log("[watch] change detected — rerunning…");
      runOnce();
    }
  }, DEBOUNCE_MS);
}

function startWatching() {
  for (const dir of WATCH_DIRS) {
    if (!fs.existsSync(dir)) {
      console.warn(`[watch] not found, skipping: ${dir}`);
      continue;
    }
    const watcher = fs.watch(dir, { recursive: true }, () => scheduleRun());
    watcher.on("error", (err) => {
      console.error(`[watch] watcher error in ${dir}: ${err.message}`);
    });
    watchers.push(watcher);
  }
}

function killChild() {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  const pid = child.pid;
  const signal = (sig) => {
    try {
      if (process.platform === "win32") child.kill(sig);
      else process.kill(-pid, sig);
    } catch {
      // The child may have exited between the check and the signal.
    }
  };
  signal("SIGINT");
  const fallback = setTimeout(() => signal("SIGKILL"), KILL_GRACE_MS);
  fallback.unref();
}

function shutdown() {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log("\n[watch] stopping…");

  if (debounceTimer) clearTimeout(debounceTimer);
  for (const watcher of watchers) {
    try {
      watcher.close();
    } catch {
      // Watcher already closed.
    }
  }

  if (!child) {
    process.exit(0);
  }

  const finish = () => process.exit(0);
  child.once("exit", finish);
  killChild();
  setTimeout(finish, FORCE_EXIT_MS);
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);

async function run() {
  console.log(`[watch] ${command}`);
  startWatching();
  runOnce();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
