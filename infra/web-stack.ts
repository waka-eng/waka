interface WebStackInput {
  appUrl: string;
  localDevUrl?: string;
  mediaBucket: sst.aws.Bucket;
  jobsQueue: sst.aws.Queue;
}

export function createWebStack({
  appUrl,
  localDevUrl,
  mediaBucket,
  jobsQueue,
}: WebStackInput) {
  const web = new sst.aws.Nextjs("Web", {
    path: "apps/web",
    dev: {
      command: "node scripts/web-dev.mjs",
      directory: ".",
      url: localDevUrl ?? appUrl,
    },
    link: [mediaBucket, jobsQueue],
  });

  return {
    web,
  };
}
