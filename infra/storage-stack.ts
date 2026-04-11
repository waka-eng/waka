export const MEDIA_BUCKET_RESOURCE_NAME = "MediaBucket";

export const MEDIA_BUCKET_CORS_METHODS = [
  "DELETE",
  "GET",
  "HEAD",
  "POST",
  "PUT",
] as const;

export function createStorageStack() {
  const mediaBucket = new sst.aws.Bucket(MEDIA_BUCKET_RESOURCE_NAME, {
    // Voice and photo capture depend on direct browser upload/download flows.
    cors: {
      allowHeaders: ["*"],
      allowMethods: [...MEDIA_BUCKET_CORS_METHODS],
      allowOrigins: ["*"],
      exposeHeaders: ["ETag"],
      maxAge: "1 day",
    },
    // Retain prior object versions so media capture is not overwrite-only.
    versioning: true,
  });

  return {
    mediaBucket,
  };
}
