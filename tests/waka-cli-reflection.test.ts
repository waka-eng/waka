import assert from "node:assert/strict";
import { Readable } from "node:stream";
import test from "node:test";

import { executeWakaCli } from "../apps/cli/src/index.ts";
import {
  CLI_REFLECTION_INPUT_PROMPT,
  promptCliReflectionQuestion,
  waitForCliReflectionResolution,
} from "../apps/cli/src/reflection.ts";

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

test("waitForCliReflectionResolution polls until reflection is no longer pending", async () => {
  const responses = [
    {
      id: "insp_reflection",
      reflectionStatus: "PENDING" as const,
    },
    {
      id: "insp_reflection",
      reflectionPrompt: "What exactly sparked this thought?",
      reflectionStatus: "PROMPTED" as const,
    },
  ];
  const readCalls: string[] = [];
  const sleepDelays: number[] = [];

  const resolved = await waitForCliReflectionResolution({
    apiClient: {
      async readInspiration(inspirationId) {
        readCalls.push(inspirationId);
        return responses.shift() ?? {
          id: inspirationId,
          reflectionStatus: "NOT_NEEDED",
        };
      },
    },
    inspirationId: "insp_reflection",
    pollIntervalMs: 5,
    pollTimeoutMs: 50,
    async sleep(delayMs) {
      sleepDelays.push(delayMs);
    },
  });

  assert.deepEqual(readCalls, ["insp_reflection", "insp_reflection"]);
  assert.deepEqual(sleepDelays, [5]);
  assert.deepEqual(resolved, {
    id: "insp_reflection",
    reflectionPrompt: "What exactly sparked this thought?",
    reflectionStatus: "PROMPTED",
  });
});

test("promptCliReflectionQuestion returns timed_out when the 60s window expires", async () => {
  const prompts: string[] = [];
  let closed = false;
  let releasePendingQuestion: (() => void) | null = null;
  let stdout = "";

  const result = await promptCliReflectionQuestion({
    createPrompt() {
      return {
        close() {
          closed = true;
          releasePendingQuestion?.();
        },
        question(prompt) {
          prompts.push(prompt);

          return new Promise<string>((resolve) => {
            releasePendingQuestion = () => {
              resolve("");
            };
          });
        },
      };
    },
    input: createInteractiveStdin(),
    output: {
      write(chunk) {
        stdout += chunk;
      },
    },
    prompt: "What exactly sparked this thought?",
    timeoutMs: 5,
  });

  assert.deepEqual(prompts, [CLI_REFLECTION_INPUT_PROMPT]);
  assert.equal(closed, true);
  assert.deepEqual(result, {
    kind: "timed_out",
  });
  assert.equal(stdout, "💭 What exactly sparked this thought?\n\n");
});

test("executeWakaCli save prints the save confirmation before the post-save reflection question", async () => {
  const requests: Array<{
    method: string | undefined;
    url: string;
  }> = [];
  const prompts: string[] = [];
  let stdout = "";
  let releaseReflectionPrompt: (() => void) | null = null;
  let promptInvocationCount = 0;

  const exitCode = await executeWakaCli(["save"], {
    createPrompt() {
      promptInvocationCount += 1;

      if (promptInvocationCount === 1) {
        return {
          close() {},
          async question(prompt) {
            prompts.push(prompt);
            return "A deep idea worth revisiting.";
          },
        };
      }

      return {
        close() {
          releaseReflectionPrompt?.();
        },
        question(prompt) {
          prompts.push(prompt);

          return new Promise<string>((resolve) => {
            releaseReflectionPrompt = () => {
              resolve("");
            };
          });
        },
      };
    },
    env: {
      APP_URL: "https://waka.app",
      WAKA_API_KEY: "waka_live_cliReflection",
    },
    fetchImplementation: async (input, init) => {
      requests.push({
        method: init?.method,
        url: String(input),
      });

      if (init?.method === "POST") {
        return jsonResponse(
          {
            id: "insp_reflection",
            processingState: {
              status: "PENDING",
            },
            rawContent: "A deep idea worth revisiting.",
            sourceType: "CLI_CONVERSATION",
          },
          201,
        );
      }

      return jsonResponse({
        id: "insp_reflection",
        reflectionPrompt: "What exactly sparked this thought?",
        reflectionStatus: "PROMPTED",
      });
    },
    reflectionPollIntervalMs: 1,
    reflectionPollTimeoutMs: 10,
    reflectionPromptTimeoutMs: 5,
    stdin: createInteractiveStdin(),
    stdout: {
      write(chunk) {
        stdout += chunk;
      },
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(
    requests.map((request) => ({
      method: request.method,
      url: request.url,
    })),
    [
      {
        method: "POST",
        url: "https://waka.app/api/inspirations",
      },
      {
        method: "GET",
        url: "https://waka.app/api/inspirations/insp_reflection",
      },
    ],
  );
  assert.deepEqual(prompts, [
    "Type your thought: ",
    CLI_REFLECTION_INPUT_PROMPT,
  ]);
  assert.match(
    stdout,
    /^Saved inspiration insp_reflection\n  View: https:\/\/waka\.app\/inspiration\/insp_reflection\n💭 What exactly sparked this thought\?\n\n$/u,
  );
});

test("executeWakaCli save submits an answered reflection back to the inspiration update route", async () => {
  const requests: Array<{
    body?: string;
    method: string | undefined;
    url: string;
  }> = [];
  const prompts: string[] = [];

  const exitCode = await executeWakaCli(["save"], {
    createPrompt() {
      if (prompts.length === 0) {
        return {
          close() {},
          async question(prompt) {
            prompts.push(prompt);
            return "A system idea worth revisiting.";
          },
        };
      }

      return {
        close() {},
        async question(prompt) {
          prompts.push(prompt);
          return "It connected the offline queue with the clustering loop.";
        },
      };
    },
    env: {
      APP_URL: "https://waka.app",
      WAKA_API_KEY: "waka_live_cliReflectionAnswer",
    },
    fetchImplementation: async (input, init) => {
      requests.push({
        body:
          typeof init?.body === "string"
            ? init.body
            : init?.body === undefined
              ? undefined
              : String(init.body),
        method: init?.method,
        url: String(input),
      });

      if (init?.method === "POST") {
        return jsonResponse(
          {
            id: "insp_reflection_answer",
            processingState: {
              status: "PENDING",
            },
            rawContent: "A system idea worth revisiting.",
            sourceType: "CLI_CONVERSATION",
          },
          201,
        );
      }

      if (init?.method === "GET") {
        return jsonResponse({
          id: "insp_reflection_answer",
          reflectionPrompt: "What exactly sparked this thought?",
          reflectionStatus: "PROMPTED",
        });
      }

      return jsonResponse(
        {
          id: "insp_reflection_answer",
          rawContent: "A system idea worth revisiting.",
          sourceType: "CLI_CONVERSATION",
        },
        200,
      );
    },
    reflectionPollIntervalMs: 1,
    reflectionPollTimeoutMs: 10,
    stdin: createInteractiveStdin(),
    stdout: {
      write() {},
    },
  });

  assert.equal(exitCode, 0);
  assert.deepEqual(prompts, [
    "Type your thought: ",
    CLI_REFLECTION_INPUT_PROMPT,
  ]);
  assert.deepEqual(
    requests.map((request) => ({
      body: request.body,
      method: request.method,
      url: request.url,
    })),
    [
      {
        body: JSON.stringify({
          rawContent: "A system idea worth revisiting.",
          sourceType: "CLI_CONVERSATION",
        }),
        method: "POST",
        url: "https://waka.app/api/inspirations",
      },
      {
        body: undefined,
        method: "GET",
        url: "https://waka.app/api/inspirations/insp_reflection_answer",
      },
      {
        body: JSON.stringify({
          reflectionAnswer:
            "It connected the offline queue with the clustering loop.",
        }),
        method: "PUT",
        url: "https://waka.app/api/inspirations/insp_reflection_answer",
      },
    ],
  );
});
