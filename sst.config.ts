import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  createStorageStack,
  createJobsStack,
  createWebStack,
} from "./infra";
import { resolveWakaSstAppConfig } from "./infra/app-config";
import { loadWorkspaceEnv } from "./scripts/workspace-env.mjs";

const workspaceRoot = dirname(fileURLToPath(import.meta.url));
const appRoot = resolve(workspaceRoot, "apps", "web");

function resolveSstEnv() {
  return loadWorkspaceEnv({
    workspaceRoot,
    appRoot,
    env: process.env,
  });
}

export default $config({
  app(input) {
    const sstEnv = resolveSstEnv();
    const appConfig = resolveWakaSstAppConfig(sstEnv, input?.stage);

    return {
      name: appConfig.name,
      home: appConfig.home,
      removal: appConfig.removal,
      providers: {
        aws: {
          region: appConfig.region,
        },
      },
    };
  },
  async run() {
    const sstEnv = resolveSstEnv();
    const appConfig = resolveWakaSstAppConfig(
      sstEnv,
      sstEnv.SST_STAGE,
    );
    const { mediaBucket } = createStorageStack();
    const { jobsDeadLetterQueue, jobsQueue } = createJobsStack({
      appUrl: appConfig.appUrl,
      region: appConfig.region,
      llmProvider: sstEnv.LLM_PROVIDER,
    });
    const { web } = createWebStack({
      appUrl: appConfig.appUrl,
      localDevUrl: appConfig.localDevUrl,
      mediaBucket,
      jobsQueue,
    });

    return {
      appUrl: appConfig.appUrl,
      serviceUrl: web.url,
      localDevUrl: appConfig.localDevUrl,
      webUrl: web.url,
      mediaBucketName: mediaBucket.name,
      jobsQueueUrl: jobsQueue.url,
      jobsDeadLetterQueueUrl: jobsDeadLetterQueue.url,
    };
  },
});
