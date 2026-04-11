import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import {
  CLI_AUTH_CALLBACK_MISSING_TOKEN_ERROR,
  CLI_AUTH_CALLBACK_PLAIN_KEY_QUERY_KEY,
  CLI_AUTH_REDIRECT_URI_QUERY_KEY,
  CLI_AUTH_SIGN_IN_PATH,
  buildCliAuthUrl,
  buildCliLocalhostRedirectUri,
  type CliAuthCallbackRequest,
  type CliAuthCallbackResponse,
  type CliAuthCallbackServer,
  type CreateCliAuthCallbackServer,
  createBrowserOpenInvocation,
  resolveCliAuthCallbackToken,
  resolveCliAppUrl,
  runCliAuthCommand,
} from "../apps/cli/src/commands/auth.ts";
import {
  WAKA_API_KEY_ENV_VAR,
  persistCliAuthToken,
  readCliAuthConfig,
  resolveCliAuthStorePath,
  resolveCliAuthToken,
} from "../apps/cli/src/config/auth-store.ts";
import { WAKA_CLI_HELP, executeWakaCli } from "../apps/cli/src/index.ts";

interface FakeCliAuthCallbackSnapshot {
  body: string;
  headers: Record<string, string>;
  statusCode: number;
}

class FakeCliAuthCallbackResponse implements CliAuthCallbackResponse {
  body = "";
  headers: Record<string, string> = {};
  statusCode = 200;

  end(body: string): void {
    this.body = body;
  }

  setHeader(name: string, value: string): void {
    this.headers[name] = value;
  }

  toSnapshot(): FakeCliAuthCallbackSnapshot {
    return {
      body: this.body,
      headers: { ...this.headers },
      statusCode: this.statusCode,
    };
  }
}

class FakeCliAuthCallbackServer implements CliAuthCallbackServer {
  readonly errorListeners = new Set<(error: Error) => void>();
  readonly listeningListeners = new Set<() => void>();
  private readonly handler: (
    request: CliAuthCallbackRequest,
    response: CliAuthCallbackResponse,
  ) => void;

  constructor(
    handler: (
      request: CliAuthCallbackRequest,
      response: CliAuthCallbackResponse,
    ) => void,
  ) {
    this.handler = handler;
  }

  close(callback: (error?: Error | null) => void): void {
    callback(null);
  }

  dispatch(
    url: string,
    method = "GET",
  ): FakeCliAuthCallbackSnapshot {
    const response = new FakeCliAuthCallbackResponse();

    this.handler(
      {
        method,
        url,
      },
      response,
    );

    return response.toSnapshot();
  }

  listen(_port: number, _host: string): void {
    queueMicrotask(() => {
      for (const listener of [...this.listeningListeners]) {
        listener();
      }
    });
  }

  off(event: "error" | "listening", listener: (...args: unknown[]) => void): void {
    if (event === "error") {
      this.errorListeners.delete(listener as (error: Error) => void);
      return;
    }

    this.listeningListeners.delete(listener as () => void);
  }

  on(event: "error", listener: (error: Error) => void): void {
    if (event === "error") {
      this.errorListeners.add(listener);
    }
  }

  once(event: "error", listener: (error: Error) => void): void;
  once(event: "listening", listener: () => void): void;
  once(
    event: "error" | "listening",
    listener: ((error: Error) => void) | (() => void),
  ): void {
    if (event === "error") {
      const wrappedListener = (error: Error): void => {
        this.off("error", wrappedListener);
        (listener as (error: Error) => void)(error);
      };

      this.errorListeners.add(wrappedListener);
      return;
    }

    const wrappedListener = (): void => {
      this.off("listening", wrappedListener);
      (listener as () => void)();
    };

    this.listeningListeners.add(wrappedListener);
  }
}

function createCliAuthCallbackTestHarness(): {
  completeAuthCallback: (
    authUrl: string,
    query: Record<string, string>,
  ) => FakeCliAuthCallbackSnapshot;
  createServer: CreateCliAuthCallbackServer;
} {
  let server: FakeCliAuthCallbackServer | null = null;

  return {
    completeAuthCallback(authUrl, query) {
      const parsedAuthUrl = new URL(authUrl);
      const redirectUri = parsedAuthUrl.searchParams.get(
        CLI_AUTH_REDIRECT_URI_QUERY_KEY,
      );

      assert.notEqual(redirectUri, null);
      assert.notEqual(server, null);

      const callbackUrl = new URL(redirectUri);

      for (const [key, value] of Object.entries(query)) {
        callbackUrl.searchParams.set(key, value);
      }

      return server.dispatch(`${callbackUrl.pathname}${callbackUrl.search}`);
    },
    createServer(handler) {
      server = new FakeCliAuthCallbackServer(handler);
      return server;
    },
  };
}

async function createTempCliHomeDirectory(): Promise<string> {
  return await mkdtemp(join(tmpdir(), "waka-cli-auth-"));
}

function escapeForRegExp(
  value: string,
): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

test("CLI auth defaults APP_URL to local development origin", () => {
  assert.equal(resolveCliAppUrl({}), "http://localhost:3000");
});

test("CLI auth normalizes APP_URL to its origin", () => {
  assert.equal(
    resolveCliAppUrl({
      APP_URL: "https://waka.app/",
    }),
    "https://waka.app",
  );
});

test("CLI auth rejects APP_URL values with a path", () => {
  assert.throws(
    () =>
      resolveCliAppUrl({
        APP_URL: "https://waka.app/dashboard",
      }),
    /APP_URL "https:\/\/waka\.app\/dashboard" must be an origin without a path, query, or hash/,
  );
});

test("CLI auth builds a localhost callback redirect URI", () => {
  assert.equal(
    buildCliLocalhostRedirectUri({
      port: 43_210,
      path: "oauth/callback",
    }),
    "http://localhost:43210/oauth/callback",
  );
});

test("CLI auth URL targets the Google sign-in route with the localhost callback attached", () => {
  const redirectUri = "http://localhost:45873/callback";
  const authUrl = new URL(
    buildCliAuthUrl(
      {
        APP_URL: "https://waka.app",
      },
      redirectUri,
    ),
  );

  assert.equal(authUrl.origin, "https://waka.app");
  assert.equal(authUrl.pathname, CLI_AUTH_SIGN_IN_PATH);
  assert.equal(
    authUrl.searchParams.get(CLI_AUTH_REDIRECT_URI_QUERY_KEY),
    redirectUri,
  );
});

test("CLI auth callback resolution prefers the plaintext API key response", () => {
  const resolution = resolveCliAuthCallbackToken(
    new URLSearchParams({
      [CLI_AUTH_CALLBACK_PLAIN_KEY_QUERY_KEY]: "waka_live_cliResolved",
      token: "ignored-fallback-token",
    }),
  );

  assert.deepEqual(resolution, {
    queryKey: CLI_AUTH_CALLBACK_PLAIN_KEY_QUERY_KEY,
    token: "waka_live_cliResolved",
  });
});

test("CLI auth callback resolution surfaces provider errors", () => {
  assert.throws(
    () =>
      resolveCliAuthCallbackToken(
        new URLSearchParams({
          error: "access_denied",
          error_description: "The user cancelled authentication.",
        }),
      ),
    /CLI auth callback failed: access_denied: The user cancelled authentication\./u,
  );
});

test("CLI auth chooses the native browser opener on macOS", () => {
  assert.deepEqual(
    createBrowserOpenInvocation(
      "https://waka.app/api/auth/signin/google",
      "darwin",
    ),
    {
      command: "open",
      args: ["https://waka.app/api/auth/signin/google"],
    },
  );
});

test("CLI auth chooses cmd start on Windows", () => {
  assert.deepEqual(
    createBrowserOpenInvocation(
      "https://waka.app/api/auth/signin/google",
      "win32",
    ),
    {
      command: "cmd",
      args: ["/c", "start", "", "https://waka.app/api/auth/signin/google"],
      options: {
        windowsVerbatimArguments: false,
      },
    },
  );
});

test("CLI auth chooses xdg-open on Linux", () => {
  assert.deepEqual(
    createBrowserOpenInvocation(
      "https://waka.app/api/auth/signin/google",
      "linux",
    ),
    {
      command: "xdg-open",
      args: ["https://waka.app/api/auth/signin/google"],
    },
  );
});

test("runCliAuthCommand opens the generated auth URL in the browser", async () => {
  const callbackHarness = createCliAuthCallbackTestHarness();
  const openedUrls: string[] = [];
  let output = "";
  const expectedToken = "waka_live_callbackSuccess";
  const homeDirectory = await createTempCliHomeDirectory();

  try {
    const env = {
      APP_URL: "https://waka.app",
      HOME: homeDirectory,
    };
    const result = await runCliAuthCommand({
      createServer: callbackHarness.createServer,
      env,
      async openBrowser(url) {
        openedUrls.push(url);
        const response = callbackHarness.completeAuthCallback(url, {
          [CLI_AUTH_CALLBACK_PLAIN_KEY_QUERY_KEY]: expectedToken,
        });

        assert.equal(response.statusCode, 200);
      },
      output: {
        write(chunk) {
          output += chunk;
        },
      },
      redirectUri: "http://localhost:42100/callback",
    });
    const configPath = resolveCliAuthStorePath({ env });
    const persistedConfig = JSON.parse(await readFile(configPath, "utf8")) as {
      apiKey: string;
    };

    assert.equal(openedUrls.length, 1);
    assert.equal(openedUrls[0], result.authUrl);
    assert.equal(result.token, expectedToken);
    assert.equal(result.configPath, configPath);
    assert.equal(persistedConfig.apiKey, expectedToken);
    assert.match(output, /Opening browser for Waka authentication/u);
    assert.match(output, /Waka authentication completed in the browser\./u);
    assert.match(output, new RegExp(escapeForRegExp(configPath), "u"));
    assert.match(output, /cli_redirect_uri=http%3A%2F%2Flocalhost%3A42100%2Fcallback/u);
  } finally {
    await rm(homeDirectory, {
      force: true,
      recursive: true,
    });
  }
});

test("runCliAuthCommand rejects callback payloads without a usable token", async () => {
  const callbackHarness = createCliAuthCallbackTestHarness();

  await assert.rejects(
    () =>
      runCliAuthCommand({
        createServer: callbackHarness.createServer,
        env: {
          APP_URL: "https://waka.app",
        },
        async openBrowser(url) {
          const response = callbackHarness.completeAuthCallback(url, {
            code: "google-oauth-code",
          });

          assert.equal(response.statusCode, 400);
          assert.match(response.body, new RegExp(CLI_AUTH_CALLBACK_MISSING_TOKEN_ERROR, "u"));
        },
        redirectUri: "http://localhost:42101/callback",
      }),
    new RegExp(CLI_AUTH_CALLBACK_MISSING_TOKEN_ERROR, "u"),
  );
});

test("executeWakaCli routes the auth command", async () => {
  const callbackHarness = createCliAuthCallbackTestHarness();
  const openedUrls: string[] = [];
  let stdout = "";
  const homeDirectory = await createTempCliHomeDirectory();

  try {
    const exitCode = await executeWakaCli(["auth"], {
      createServer: callbackHarness.createServer,
      env: {
        APP_URL: "https://waka.app",
        HOME: homeDirectory,
      },
      async openBrowser(url) {
        openedUrls.push(url);
        const response = callbackHarness.completeAuthCallback(url, {
          [CLI_AUTH_CALLBACK_PLAIN_KEY_QUERY_KEY]: "waka_live_cliRoute",
        });

        assert.equal(response.statusCode, 200);
      },
      stdout: {
        write(chunk) {
          stdout += chunk;
        },
      },
    });

    assert.equal(exitCode, 0);
    assert.equal(openedUrls.length, 1);
    assert.match(stdout, /https:\/\/waka\.app\/api\/auth\/signin\/google/u);
  } finally {
    await rm(homeDirectory, {
      force: true,
      recursive: true,
    });
  }
});

test("CLI auth token resolution prefers config.json over WAKA_API_KEY", async () => {
  const homeDirectory = await createTempCliHomeDirectory();

  try {
    const env = {
      HOME: homeDirectory,
      [WAKA_API_KEY_ENV_VAR]: "waka_live_envFallback",
    };
    const configPath = await persistCliAuthToken("waka_live_persistedConfig", {
      env,
    });

    assert.equal(configPath, resolveCliAuthStorePath({ env }));
    assert.deepEqual(
      await readCliAuthConfig({ env }),
      {
        apiKey: "waka_live_persistedConfig",
      },
    );
    assert.deepEqual(
      await resolveCliAuthToken({ env }),
      {
        source: "config",
        token: "waka_live_persistedConfig",
      },
    );
  } finally {
    await rm(homeDirectory, {
      force: true,
      recursive: true,
    });
  }
});

test("CLI auth token resolution falls back to WAKA_API_KEY when config.json is absent", async () => {
  const homeDirectory = await createTempCliHomeDirectory();

  try {
    assert.deepEqual(
      await resolveCliAuthToken({
        env: {
          HOME: homeDirectory,
          [WAKA_API_KEY_ENV_VAR]: "waka_live_envOnly",
        },
      }),
      {
        source: "env",
        token: "waka_live_envOnly",
      },
    );
  } finally {
    await rm(homeDirectory, {
      force: true,
      recursive: true,
    });
  }
});

test("CLI auth token resolution falls back to WAKA_API_KEY when config.json is malformed", async () => {
  const homeDirectory = await createTempCliHomeDirectory();
  const env = {
    HOME: homeDirectory,
    [WAKA_API_KEY_ENV_VAR]: "waka_live_envOnly",
  };

  try {
    await persistCliAuthToken("waka_live_seeded", { env });
    await writeFile(
      resolveCliAuthStorePath({ env }),
      "{not-valid-json}\n",
      "utf8",
    );

    assert.deepEqual(
      await resolveCliAuthToken({ env }),
      {
        source: "env",
        token: "waka_live_envOnly",
      },
    );
  } finally {
    await rm(homeDirectory, {
      force: true,
      recursive: true,
    });
  }
});

test("CLI auth token resolution still surfaces malformed config errors when WAKA_API_KEY is unset", async () => {
  const homeDirectory = await createTempCliHomeDirectory();
  const env = {
    HOME: homeDirectory,
  };

  try {
    await persistCliAuthToken("waka_live_seeded", { env });
    await writeFile(
      resolveCliAuthStorePath({ env }),
      "{not-valid-json}\n",
      "utf8",
    );

    await assert.rejects(
      async () => await resolveCliAuthToken({ env }),
      /contains invalid JSON/u,
    );
  } finally {
    await rm(homeDirectory, {
      force: true,
      recursive: true,
    });
  }
});

test("executeWakaCli prints help when no command is provided", async () => {
  let stderr = "";

  const exitCode = await executeWakaCli([], {
    stderr: {
      write(chunk) {
        stderr += chunk;
      },
    },
  });

  assert.equal(exitCode, 1);
  assert.equal(stderr, `${WAKA_CLI_HELP}\n`);
});
