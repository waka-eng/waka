import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";

import {
  createCliApiClient,
} from "../apps/cli/src/api-client.ts";
import {
  CLI_SAVE_INTERACTIVE_PROMPT,
  readCliSaveInputFromStdin,
} from "../apps/cli/src/commands/save.ts";
import { executeWakaCli } from "../apps/cli/src/index.ts";

function createPipedStdin(
  chunks: readonly string[],
): Readable & { isTTY: false } {
  const stream = Readable.from(chunks);

  return Object.assign(stream, {
    isTTY: false as const,
  });
}

function createInteractiveStdin(): Readable & { isTTY: true } {
  const stream = Readable.from([]);

  return Object.assign(stream, {
    isTTY: true as const,
  });
}

function jsonResponse(
  body: unknown,
  status = 200,
): Response {
  return new Response(JSON.stringify(body), {
    headers: {
      "Content-Type": "application/json",
    },
    status,
  });
}

test("readCliSaveInputFromStdin preserves piped text exactly", async () => {
  const capturedInput = await readCliSaveInputFromStdin(
    createPipedStdin(["first line\n", "second line"]),
  );

  assert.equal(capturedInput, "first line\nsecond line");
});

test("createCliApiClient posts CLI conversation captures to the inspirations API", async () => {
  const requests: Array<{
    body: string;
    headers: HeadersInit | undefined;
    method: string | undefined;
    url: string;
  }> = [];
  const client = createCliApiClient({
    env: {
      APP_URL: "https://waka.app",
      WAKA_API_KEY: "waka_live_cliToken",
    },
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? init.body : "",
        headers: init?.headers,
        method: init?.method,
        url: String(input),
      });

      return jsonResponse({
        id: "insp_client",
        rawContent: "from client",
        sourceType: "CLI_CONVERSATION",
      }, 201);
    },
  });

  const response = await client.saveInspiration({
    rawContent: "from client",
    sourceType: "CLI_CONVERSATION",
  });

  assert.equal(response.id, "insp_client");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://waka.app/api/inspirations");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(
    String(new Headers(requests[0]?.headers).get("Authorization")),
    "Bearer waka_live_cliToken",
  );
  assert.deepEqual(JSON.parse(requests[0]?.body ?? ""), {
    rawContent: "from client",
    sourceType: "CLI_CONVERSATION",
  });
});

test("createCliApiClient posts URL imports to the inspirations API", async () => {
  const requests: Array<{
    body: string;
    headers: HeadersInit | undefined;
    method: string | undefined;
    url: string;
  }> = [];
  const client = createCliApiClient({
    env: {
      APP_URL: "https://waka.app",
      WAKA_API_KEY: "waka_live_cliToken",
    },
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? init.body : "",
        headers: init?.headers,
        method: init?.method,
        url: String(input),
      });

      return jsonResponse({
        id: "insp_url_client",
        rawContent: "https://example.com/article",
        sourceType: "URL_IMPORT",
      }, 201);
    },
  });

  const response = await client.saveInspiration({
    rawContent: "https://example.com/article",
    sourceType: "URL_IMPORT",
    sourceUrl: "https://example.com/article",
  });

  assert.equal(response.id, "insp_url_client");
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://waka.app/api/inspirations");
  assert.equal(requests[0]?.method, "POST");
  assert.deepEqual(JSON.parse(requests[0]?.body ?? ""), {
    rawContent: "https://example.com/article",
    sourceType: "URL_IMPORT",
    sourceUrl: "https://example.com/article",
  });
});

test("executeWakaCli save sends piped stdin to the inspirations API and exits successfully", async () => {
  const requests: Array<{
    body: string;
    headers: HeadersInit | undefined;
    method: string | undefined;
    url: string;
  }> = [];
  let stdout = "";

  const exitCode = await executeWakaCli(["save"], {
    env: {
      APP_URL: "https://waka.app",
      WAKA_API_KEY: "waka_live_cliPipe",
    },
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? init.body : "",
        headers: init?.headers,
        method: init?.method,
        url: String(input),
      });

      return jsonResponse({
        id: "insp_pipe_123",
        rawContent: "test",
        sourceType: "CLI_CONVERSATION",
      }, 201);
    },
    stdin: createPipedStdin(["test"]),
    stdout: {
      write(chunk) {
        stdout += chunk;
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://waka.app/api/inspirations");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(
    String(new Headers(requests[0]?.headers).get("Authorization")),
    "Bearer waka_live_cliPipe",
  );
  assert.deepEqual(JSON.parse(requests[0]?.body ?? ""), {
    rawContent: "test",
    sourceType: "CLI_CONVERSATION",
  });
  assert.equal(
    stdout,
    "Saved inspiration insp_pipe_123\n  View: https://waka.app/inspiration/insp_pipe_123\n",
  );
});

test("executeWakaCli save --file submits the file contents through the save API flow", async (t) => {
  const temporaryDirectory = await mkdtemp(
    path.join(os.tmpdir(), "waka-cli-save-file-"),
  );
  const filePath = path.join(temporaryDirectory, "capture.txt");
  const fileContents = "first line\nsecond line";
  const requests: Array<{
    body: string;
    headers: HeadersInit | undefined;
    method: string | undefined;
    url: string;
  }> = [];
  let stdout = "";

  t.after(async () => {
    await rm(temporaryDirectory, {
      force: true,
      recursive: true,
    });
  });

  await writeFile(filePath, fileContents, "utf8");

  const exitCode = await executeWakaCli(["save", "--file", filePath], {
    env: {
      APP_URL: "https://waka.app",
      WAKA_API_KEY: "waka_live_cliFile",
    },
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? init.body : "",
        headers: init?.headers,
        method: init?.method,
        url: String(input),
      });

      return jsonResponse({
        id: "insp_file_123",
        rawContent: fileContents,
        sourceType: "CLI_CONVERSATION",
      }, 201);
    },
    stdin: createInteractiveStdin(),
    stdout: {
      write(chunk) {
        stdout += chunk;
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://waka.app/api/inspirations");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(
    String(new Headers(requests[0]?.headers).get("Authorization")),
    "Bearer waka_live_cliFile",
  );
  assert.deepEqual(JSON.parse(requests[0]?.body ?? ""), {
    rawContent: fileContents,
    sourceType: "CLI_CONVERSATION",
  });
  assert.equal(
    stdout,
    "Saved inspiration insp_file_123\n  View: https://waka.app/inspiration/insp_file_123\n",
  );
});

test("executeWakaCli save --url submits a URL import through the save API flow", async () => {
  const requests: Array<{
    body: string;
    headers: HeadersInit | undefined;
    method: string | undefined;
    url: string;
  }> = [];
  let stdout = "";

  const exitCode = await executeWakaCli(["save", "--url", "https://example.com/article"], {
    env: {
      APP_URL: "https://waka.app",
      WAKA_API_KEY: "waka_live_cliUrl",
    },
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? init.body : "",
        headers: init?.headers,
        method: init?.method,
        url: String(input),
      });

      return jsonResponse({
        id: "insp_url_123",
        rawContent: "https://example.com/article",
        sourceType: "URL_IMPORT",
      }, 201);
    },
    stdin: createInteractiveStdin(),
    stdout: {
      write(chunk) {
        stdout += chunk;
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://waka.app/api/inspirations");
  assert.equal(requests[0]?.method, "POST");
  assert.equal(
    String(new Headers(requests[0]?.headers).get("Authorization")),
    "Bearer waka_live_cliUrl",
  );
  assert.deepEqual(JSON.parse(requests[0]?.body ?? ""), {
    rawContent: "https://example.com/article",
    sourceType: "URL_IMPORT",
    sourceUrl: "https://example.com/article",
  });
  assert.equal(
    stdout,
    "Saved inspiration insp_url_123\n  View: https://waka.app/inspiration/insp_url_123\n",
  );
});

test("executeWakaCli save prompts for input when stdin is a TTY", async () => {
  const requests: Array<{
    body: string;
    headers: HeadersInit | undefined;
    method: string | undefined;
    url: string;
  }> = [];
  const prompts: string[] = [];
  let stdout = "";

  const exitCode = await executeWakaCli(["save"], {
    createPrompt() {
      return {
        close() {},
        async question(prompt) {
          prompts.push(prompt);
          return "typed interactively";
        },
      };
    },
    env: {
      APP_URL: "https://waka.app",
      WAKA_API_KEY: "waka_live_cliInteractive",
    },
    fetchImplementation: async (input, init) => {
      requests.push({
        body: typeof init?.body === "string" ? init.body : "",
        headers: init?.headers,
        method: init?.method,
        url: String(input),
      });

      return jsonResponse({
        id: "insp_prompt_123",
        rawContent: "typed interactively",
        sourceType: "CLI_CONVERSATION",
      }, 201);
    },
    stdin: createInteractiveStdin(),
    stdout: {
      write(chunk) {
        stdout += chunk;
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(prompts, [CLI_SAVE_INTERACTIVE_PROMPT]);
  assert.equal(requests.length, 1);
  assert.equal(requests[0]?.url, "https://waka.app/api/inspirations");
  assert.equal(requests[0]?.method, "POST");
  assert.deepEqual(JSON.parse(requests[0]?.body ?? ""), {
    rawContent: "typed interactively",
    sourceType: "CLI_CONVERSATION",
  });
  assert.equal(
    stdout,
    "Saved inspiration insp_prompt_123\n  View: https://waka.app/inspiration/insp_prompt_123\n",
  );
});
