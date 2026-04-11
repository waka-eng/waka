import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";

const root = process.cwd();

function read(relativePath: string) {
  return readFileSync(path.join(root, relativePath), "utf8");
}

test("SST stack modules are split by provisioning responsibility", () => {
  const requiredFiles = [
    ".env.development",
    "infra/index.ts",
    "infra/app-config.ts",
    "infra/storage-stack.ts",
    "infra/jobs-stack.ts",
    "infra/web-stack.ts",
    "sst.config.ts",
  ];

  for (const relativePath of requiredFiles) {
    assert.equal(
      existsSync(path.join(root, relativePath)),
      true,
      `${relativePath} should exist`,
    );
  }

  const storageStack = read("infra/storage-stack.ts");
  const jobsStack = read("infra/jobs-stack.ts");
  const webStack = read("infra/web-stack.ts");
  const appConfig = read("infra/app-config.ts");
  const infraIndex = read("infra/index.ts");
  const sstConfig = read("sst.config.ts");

  assert.match(appConfig, /export function resolveWakaSstAppConfig/);
  assert.match(appConfig, /export function resolveAwsRegion/);
  assert.match(appConfig, /export function resolveAppUrl/);
  assert.match(appConfig, /export function resolveLocalDevUrl/);
  assert.match(appConfig, /export function resolveLocalDevHost/);
  assert.match(appConfig, /export function resolveLocalDevPort/);
  assert.match(storageStack, /export function createStorageStack/);
  assert.match(
    storageStack,
    /export const MEDIA_BUCKET_RESOURCE_NAME = "MediaBucket";/,
  );
  assert.match(
    storageStack,
    /new sst\.aws\.Bucket\(MEDIA_BUCKET_RESOURCE_NAME,\s*\{/,
  );
  assert.match(storageStack, /cors:\s*\{/);
  assert.match(storageStack, /versioning:\s*true/);
  assert.match(jobsStack, /export function createJobsStack/);
  assert.match(jobsStack, /export const JOBS_QUEUE_RESOURCE_NAME = "JobsQueue";/);
  assert.match(
    jobsStack,
    /export const JOBS_DEAD_LETTER_QUEUE_RESOURCE_NAME = "JobsDeadLetterQueue";/,
  );
  assert.match(
    jobsStack,
    /export const JOBS_QUEUE_VISIBILITY_TIMEOUT = "5 minutes";/,
  );
  assert.match(
    jobsStack,
    /export const JOBS_QUEUE_MESSAGE_RETENTION = "14 days";/,
  );
  assert.match(
    jobsStack,
    /export const JOBS_QUEUE_REDRIVE_RETRY_LIMIT = 3;/,
  );
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_QUEUE_ACCESS_ACTIONS = \[/,
  );
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_DEAD_LETTER_QUEUE_ACCESS_ACTIONS = \[/,
  );
  assert.match(jobsStack, /"sqs:DeleteMessage"/);
  assert.match(jobsStack, /"sqs:GetQueueAttributes"/);
  assert.match(jobsStack, /"sqs:ReceiveMessage"/);
  assert.match(jobsStack, /"sqs:SendMessage"/);
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_FUNCTION_NAME = "InspirationProcessor";/,
  );
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_HANDLER_PACKAGE = "apps\/web";/,
  );
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_HANDLER_ENTRYPOINT =\s+"src\/jobs\/inspiration-queue-subscriber\.handler";/s,
  );
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_HANDLER =\s*`\$\{INSPIRATION_PROCESSOR_HANDLER_PACKAGE\}\/\$\{INSPIRATION_PROCESSOR_HANDLER_ENTRYPOINT\}`;/s,
  );
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_EXECUTION_ROLE_NAME =\s+"InspirationProcessorExecutionRole";/s,
  );
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_RUNTIME = "nodejs20\.x";/,
  );
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_MEMORY = "2048 MB";/,
  );
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_TIMEOUT = "1 minute";/,
  );
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_RESERVED_CONCURRENCY = 10;/,
  );
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_EVENT_SOURCE_BATCH_SIZE = 1;/,
  );
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_EVENT_SOURCE_BATCH_WINDOW = "0 seconds";/,
  );
  assert.match(
    jobsStack,
    /export const INSPIRATION_PROCESSOR_EVENT_SOURCE_MAX_CONCURRENCY =\s*INSPIRATION_PROCESSOR_RESERVED_CONCURRENCY;/,
  );
  assert.match(
    jobsStack,
    /export const JOBS_SUBSCRIBER_DATABASE_URL_SECRET_RESOURCE_NAME =\s*"JobsSubscriberDatabaseUrl";/s,
  );
  assert.match(
    jobsStack,
    /export const JOBS_SUBSCRIBER_OPENAI_API_KEY_SECRET_RESOURCE_NAME =\s*"JobsSubscriberOpenAiApiKey";/s,
  );
  assert.match(
    jobsStack,
    /export const JOBS_SUBSCRIBER_GEMINI_API_KEY_SECRET_RESOURCE_NAME =\s*"JobsSubscriberGeminiApiKey";/s,
  );
  assert.match(jobsStack, /export function createJobsSubscriberSecrets/);
  assert.match(
    jobsStack,
    /databaseUrl:\s*new sst\.Secret\(\s*JOBS_SUBSCRIBER_DATABASE_URL_SECRET_RESOURCE_NAME,\s*\),/s,
  );
  assert.match(
    jobsStack,
    /openAiApiKey:\s*new sst\.Secret\(\s*JOBS_SUBSCRIBER_OPENAI_API_KEY_SECRET_RESOURCE_NAME,\s*\),/s,
  );
  assert.match(
    jobsStack,
    /geminiApiKey:\s*new sst\.Secret\(\s*JOBS_SUBSCRIBER_GEMINI_API_KEY_SECRET_RESOURCE_NAME,\s*\),/s,
  );
  assert.match(jobsStack, /export function resolveJobsSubscriberSecretReferences/);
  assert.match(
    jobsStack,
    /new sst\.aws\.Queue\(\s*JOBS_DEAD_LETTER_QUEUE_RESOURCE_NAME,\s*\{/s,
  );
  assert.match(
    jobsStack,
    /retention:\s*JOBS_DEAD_LETTER_QUEUE_MESSAGE_RETENTION,/,
  );
  assert.match(
    jobsStack,
    /new sst\.aws\.Queue\(JOBS_QUEUE_RESOURCE_NAME,\s*\{/,
  );
  assert.match(
    jobsStack,
    /dlq:\s*resolveJobsQueueDeadLetterConfiguration\(jobsDeadLetterQueue\.arn\),/,
  );
  assert.match(jobsStack, /visibilityTimeout:\s*JOBS_QUEUE_VISIBILITY_TIMEOUT,/);
  assert.match(jobsStack, /retention:\s*JOBS_QUEUE_MESSAGE_RETENTION,/);
  assert.match(
    jobsStack,
    /new sst\.aws\.Function\(\s*INSPIRATION_PROCESSOR_FUNCTION_NAME,\s*\{/s,
  );
  assert.match(
    jobsStack,
    /const inspirationProcessorExecutionRole =\s*resolveInspirationProcessorExecutionRole\(\s*jobsQueue\.arn,\s*jobsDeadLetterQueue\.arn,\s*\);/s,
  );
  assert.match(
    jobsStack,
    /const jobsSubscriberSecrets = createJobsSubscriberSecrets\(llmProvider\);/,
  );
  assert.match(jobsStack, /handler:\s*INSPIRATION_PROCESSOR_HANDLER,/);
  assert.match(jobsStack, /runtime:\s*INSPIRATION_PROCESSOR_RUNTIME,/);
  assert.match(jobsStack, /memory:\s*INSPIRATION_PROCESSOR_MEMORY,/);
  assert.match(jobsStack, /timeout:\s*INSPIRATION_PROCESSOR_TIMEOUT,/);
  assert.match(
    jobsStack,
    /concurrency:\s*\{\s*reserved:\s*INSPIRATION_PROCESSOR_RESERVED_CONCURRENCY,\s*\},/s,
  );
  assert.match(
    jobsStack,
    /environment:\s*resolveJobsSubscriberEnvironment\(\s*appUrl,\s*region,\s*llmProvider,\s*jobsSubscriberSecrets,\s*jobsDeadLetterQueue\.url,\s*\),/s,
  );
  assert.match(
    jobsStack,
    /link:\s*\[\s*jobsQueue,\s*\.\.\.resolveJobsSubscriberSecretReferences\(jobsSubscriberSecrets\),\s*\],/s,
  );
  assert.match(
    jobsStack,
    /permissions:\s*inspirationProcessorExecutionRole\.permissions,/,
  );
  assert.match(
    jobsStack,
    /jobsQueue\.subscribe\(\s*inspirationProcessor\.arn,\s*resolveInspirationProcessorEventSourceMapping\(\),\s*\);/s,
  );
  assert.match(
    jobsStack,
    /functionResponseTypes:\s*\[\s*\.\.\.INSPIRATION_PROCESSOR_EVENT_SOURCE_FUNCTION_RESPONSE_TYPES,\s*\],/s,
  );
  assert.match(
    jobsStack,
    /scalingConfig:\s*\{\s*maximumConcurrency:\s*INSPIRATION_PROCESSOR_EVENT_SOURCE_MAX_CONCURRENCY,\s*\},/s,
  );
  assert.match(webStack, /export function createWebStack/);
  assert.match(webStack, /new sst\.aws\.Nextjs\("Web"/);
  assert.match(webStack, /command:\s*"node scripts\/web-dev\.mjs"/);
  assert.match(webStack, /directory:\s*"\."/);
  assert.match(webStack, /url:\s*localDevUrl\s*\?\?\s*appUrl,/);
  assert.match(
    infraIndex,
    /export \{ createStorageStack \} from "\.\/storage-stack";\s+export \{ createJobsStack \} from "\.\/jobs-stack";\s+export \{ createWebStack \} from "\.\/web-stack";/s,
  );
  assert.match(
    sstConfig,
    /import\s+\{\s+createStorageStack,\s+createJobsStack,\s+createWebStack,\s+\}\s+from "\.\/infra";/s,
  );
  assert.match(
    sstConfig,
    /import\s+\{\s+resolveWakaSstAppConfig\s+\}\s+from "\.\/infra\/app-config";/,
  );
  assert.match(
    sstConfig,
    /import\s+\{\s+loadWorkspaceEnv\s+\}\s+from "\.\/scripts\/workspace-env\.mjs";/,
  );
  assert.match(
    sstConfig,
    /const workspaceRoot = dirname\(fileURLToPath\(import\.meta\.url\)\);/,
  );
  assert.match(
    sstConfig,
    /const appRoot = resolve\(workspaceRoot,\s*"apps",\s*"web"\);/,
  );
  assert.match(
    sstConfig,
    /function resolveSstEnv\(\)\s*\{\s*return loadWorkspaceEnv\(\{\s*workspaceRoot,\s*appRoot,\s*env:\s*process\.env,\s*\}\);\s*\}/s,
  );
  assert.match(
    sstConfig,
    /const sstEnv = resolveSstEnv\(\);\s+const appConfig = resolveWakaSstAppConfig\(sstEnv,\s*input\?\.stage\);/s,
  );
  assert.match(
    sstConfig,
    /providers:\s*\{\s*aws:\s*\{\s*region:\s*appConfig\.region,\s*\},\s*\}/s,
  );
  assert.match(
    sstConfig,
    /const sstEnv = resolveSstEnv\(\);\s+const appConfig = resolveWakaSstAppConfig\(\s*sstEnv,\s*sstEnv\.SST_STAGE,\s*\);\s+const \{ mediaBucket \} = createStorageStack\(\);\s+const \{\s*jobsDeadLetterQueue,\s*jobsQueue\s*\} = createJobsStack\(\{\s*appUrl:\s*appConfig\.appUrl,\s*region:\s*appConfig\.region,\s*llmProvider:\s*sstEnv\.LLM_PROVIDER,\s*\}\);\s+const \{ web \} = createWebStack\(\{/s,
  );
  assert.match(
    sstConfig,
    /return\s*\{\s*appUrl:\s*appConfig\.appUrl,\s*serviceUrl:\s*web\.url,\s*localDevUrl:\s*appConfig\.localDevUrl,\s*webUrl:\s*web\.url,\s*mediaBucketName:\s*mediaBucket\.name,\s*jobsQueueUrl:\s*jobsQueue\.url,\s*jobsDeadLetterQueueUrl:\s*jobsDeadLetterQueue\.url,\s*\};/s,
  );
});
