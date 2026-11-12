/** Best-effort child-failure signals, never raw messages or arbitrary paths.
 * Known SST strings are pinned to 3.19.3; Pulumi paths to 3.210.0/aws 6.66.2.
 * Categories describe observed diagnostics, not a proven root cause.
 */
const signatures = [
 ['secret_missing', /\bSecretMissingError\b|\bSet a value for [A-Za-z][A-Za-z0-9]* with `sst secret set [A-Za-z][A-Za-z0-9]* <value>`/i],
 ['sdk_visible_error', /\bVisibleError\b|Cannot access the created function because it is referenced as an ARN\.|No function created for the "[^"\r\n]{1,200}" cron job\.|You cannot provide both "job" and "function"/],
 ['config_import', /\bERR_MODULE_NOT_FOUND\b|\bCannot find (?:module|package)\b|\bCould not resolve ["']/i],
 ['config_build', /\b(?:Transform|Build) failed\b|\bSyntaxError\b|\bUnexpected token\b/i],
 ['config_type', /\b(?:TypeError|ReferenceError)\b|\bCannot read propert(?:y|ies)\b|\bis not (?:a function|defined)\b|Invalid function definition for the "[^"\r\n]{1,200}" Function/],
 ['provider_diagnostic', /\brpc error\b|\bprovider plugin\b|\bfailed to load plugin\b|\bMissing required (?:argument|property)\b|\bInvalid or unknown (?:key|property)\b/i],
 ['cli_argument', /\b(?:unknown|unrecognized|invalid) (?:command|flag|option)\b|\bflag provided but not defined\b/i],
 ['permission', /\b(?:AccessDenied(?:Exception)?|UnauthorizedOperation|UnauthorizedException|InvalidClientTokenId|UnrecognizedClientException|ExpiredToken(?:Exception)?|NoCredentialProviders|CredentialsProviderError)\b|\bnot authorized to perform\b|\bfailed to refresh cached credentials\b/i],
 ['stage_locked', /\bConcurrentUpdateError\b|\b(?:app|stage|stack|state|update)\b[^\r\n]{0,100}\b(?:locked|lock already held)\b|\b(?:another|ongoing) update (?:is )?in progress\b/i],
 ['network', /\b(?:ENOTFOUND|ETIMEDOUT|ECONNRESET|ECONNREFUSED|EAI_AGAIN)\b|\bTLS handshake timeout\b|\bsocket hang up\b|\brequest timed out\b|\bconnect timeout\b/i],
];

// Only literal public source identities may leave the process. Prefixes such
// as runner home directories are discarded, never sanitized and re-exported.
const sources = new Map([
 ...[
  'sst.config.ts', 'infra/background-worker-event.json',
  'scripts/preview-production.mjs', 'scripts/production-preview-policy.mjs',
  'scripts/production-preview-diagnostics.mjs',
  'packages/api/src/monitoring/protocol.ts', 'packages/api/src/monitoring/relay.ts',
  'packages/api/src/monitoring/uptime.ts', 'packages/api/src/monitoring/probe-state.ts',
  'packages/api/src/lib/operational-fault.ts', 'packages/api/src/index.ts',
  'packages/api/src/background-worker.ts', 'packages/api/src/principle-refresh.ts',
  'packages/api/src/attachment-object-events.ts',
 ].map(path => [path, path]),
 ...[
  'aws/cron.ts', 'aws/queue.ts', 'aws/queue-lambda-subscriber.ts',
  'aws/function.ts', 'aws/helpers/function-builder.ts', 'secret.ts', 'error.ts',
 ].map(path => [`.sst/platform/src/components/${path}`, `sst@3.19.3/platform/src/components/${path}`]),
 ['.sst/platform/node_modules/@pulumi/pulumi/output.js', '@pulumi/pulumi@3.210.0/output.js'],
 ['.sst/platform/node_modules/@pulumi/aws/cloudwatch/metricAlarm.js', '@pulumi/aws@6.66.2/cloudwatch/metricAlarm.js'],
]);

export function classifyPreviewFailure(raw) {
 if (typeof raw !== 'string') return {parsed:false, categories:['unknown'], sourceLocations:[]};
 const text = raw.replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
 const categories = signatures.filter(([,pattern]) => pattern.test(text)).map(([category]) => category);
 const locations = new Map();
 const pattern = /(?:^|[\s(])((?:file:\/\/)?[^\s()\[\]'"<>?#]+?):([0-9]{1,6})(?::([0-9]{1,5}))?(?=[\s),]|$|:(?![0-9]))/gm;
 for (const match of text.matchAll(pattern)) {
  let path = match[1];
  if (/^[A-Za-z][A-Za-z0-9+.-]*:/.test(path) && !path.startsWith('file://')) continue;
  path = path.replace(/^file:\/\//, '').replaceAll('\\', '/');
  const line = Number(match[2]), column = match[3] === undefined ? undefined : Number(match[3]);
  if (line < 1 || line > 100000 || (column !== undefined && (column < 1 || column > 10000))) continue;
  const entry = [...sources].find(([allowed]) => path === allowed || path.endsWith('/'+allowed));
  if (!entry) continue;
  const location = {source:entry[1], line, ...(column === undefined ? {} : {column})};
  locations.set(`${entry[1]}:${line}:${column??''}`, location);
  if (locations.size === 8) break;
 }
 return {parsed:true, categories:categories.length ? categories : ['unknown'], sourceLocations:[...locations.values()]};
}
