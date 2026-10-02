/** Bucket identity, object ownership and URLs shared by capture and attachment routes. */
export function getAttachmentsBucket(): string {
  const direct = process.env.ATTACHMENTS_BUCKET;
  if (direct?.trim()) return direct;
  try {
    const linked = JSON.parse(process.env.SST_RESOURCE_Attachments ?? '{}') as { name?: string };
    if (linked.name) return linked.name;
  } catch { /* report configuration failure below without credential details */ }
  throw new Error('Attachments bucket name is not configured (ATTACHMENTS_BUCKET / SST_RESOURCE_Attachments).');
}
export function attachmentKeyPrefix(profileId: string): string { return `profiles/${profileId}/attachments/`; }
export function attachmentObjectUrl(bucket: string, region: string, key: string): string {
  return `https://${bucket}.s3.${region}.amazonaws.com/${key.split('/').map(encodeURIComponent).join('/')}`;
}
