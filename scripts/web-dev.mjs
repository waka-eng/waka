import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { loadWorkspaceEnv } from "./workspace-env.mjs";
import {
  applyDevServerNetwork,
  resolveDevServerNetwork,
} from "./web-dev-network.mjs";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const workspaceRoot = resolve(scriptDir, "..");
const appRoot = join(workspaceRoot, "apps", "web");
const requireFromApp = createRequire(join(appRoot, "package.json"));
const loadedRuntimeEnv = loadWorkspaceEnv({
  workspaceRoot,
  appRoot,
  env: process.env,
});
const devNetwork = resolveDevServerNetwork(loadedRuntimeEnv);
const runtimeEnv = applyDevServerNetwork(loadedRuntimeEnv);

function resolveNextBin() {
  try {
    return requireFromApp.resolve("next/dist/bin/next");
  } catch {
    return null;
  }
}

function renderFallbackHtml() {
  return `<!DOCTYPE html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Waka Dev Bootstrap</title>
    <style>
      :root { color-scheme: dark; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        min-height: 100vh;
        display: grid;
        place-items: center;
        background: radial-gradient(circle at top, #292524, #0c0a09 55%);
        color: #f5f5f4;
        font-family: Arial, Helvetica, sans-serif;
      }
      main {
        width: min(720px, calc(100vw - 32px));
        padding: 32px;
        border: 1px solid rgba(231, 229, 228, 0.12);
        border-radius: 24px;
        background: rgba(28, 25, 23, 0.82);
        box-shadow: 0 24px 80px rgba(0, 0, 0, 0.35);
      }
      h1 {
        margin: 0 0 12px;
        font-size: clamp(2rem, 4vw, 3rem);
        line-height: 1;
      }
      p {
        margin: 0;
        color: #d6d3d1;
        line-height: 1.7;
      }
      code {
        font-family: "SFMono-Regular", Consolas, "Liberation Mono", Menlo, monospace;
        color: #fde68a;
      }
    </style>
  </head>
  <body>
    <main>
      <h1>Waka dev bootstrap is running.</h1>
      <p>
        This fallback keeps the local SST bootstrap responsive even before the
        Next.js dependency tree has been hydrated. As soon as <code>next</code> is
        installed in the workspace, the same dev flow will delegate to the real
        Next.js dev server automatically.
      </p>
    </main>
  </body>
</html>`;
}

function startFallbackServer() {
  const server = createServer((request, response) => {
    if (request.url === "/health") {
      response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, mode: "fallback" }));
      return;
    }

    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(renderFallbackHtml());
  });

  let keepAliveTimer = null;

  const shutdown = () => {
    if (keepAliveTimer !== null) {
      clearInterval(keepAliveTimer);
      process.exit(0);
      return;
    }

    server.close(() => {
      process.exit(0);
    });
  };

  server.on("error", (error) => {
    if (error.code !== "EACCES" && error.code !== "EPERM") {
      throw error;
    }

    keepAliveTimer = setInterval(() => {
      // Keep the dev process alive when sandbox policy forbids opening a port.
    }, 60_000);

    console.log(
      `Waka dev bootstrap is running without a bound port because the sandbox denied ${devNetwork.publicUrl}.`,
    );
    console.log(
      "Install dependencies and run this command outside the restricted sandbox to get the full Next.js dev server.",
    );
  });

  server.listen(devNetwork.port, devNetwork.bindHost, () => {
    console.log(`Waka fallback dev server listening on ${devNetwork.publicUrl}`);
    console.log(
      "Next.js dependencies are not installed yet; this command will switch to next dev automatically once they are available.",
    );
  });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

const nextBin = resolveNextBin();

if (nextBin !== null && existsSync(nextBin)) {
  const child = spawn(
    process.execPath,
    [
      nextBin,
      "dev",
      "--hostname",
      devNetwork.bindHost,
      "--port",
      String(devNetwork.port),
    ],
    {
      cwd: appRoot,
      env: runtimeEnv,
      stdio: "inherit",
    },
  );

  child.on("exit", (code, signal) => {
    if (signal !== null) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
} else {
  startFallbackServer();
}
