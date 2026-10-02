/** Deployment preflight only; never connects or prints credentials. Endpoint
 * comparison cannot prove that separately named aliases aren't the same DB. */
function target(value, label) {
  if (!value) throw new Error(`${label} database URL is missing`);
  let url;
  try { url = new URL(value); } catch { throw new Error(`${label} database URL is invalid`); }
  if (!['postgres:', 'postgresql:'].includes(url.protocol) || !url.hostname || !url.pathname.slice(1)) {
    throw new Error(`${label} database URL must name a Postgres host and database`);
  }
  for (const key of url.searchParams.keys()) {
    if (['host', 'hostaddr', 'port', 'dbname', 'database', 'service', 'options'].includes(key.toLowerCase())) throw new Error(`${label} database URL has an unsupported target override`);
  }
  let database;
  try { database = decodeURIComponent(url.pathname.slice(1)); } catch { throw new Error(`${label} database name is invalid`); }
  return [url.hostname.replace(/-pooler(?=\.)/, ''), url.port || '5432', database].join('|');
}

try {
  const development = target(process.env.DB_CONNECTION_URL, 'Development');
  const production = target(process.env.PRODUCTION_DB_CONNECTION_URL, 'Production');
  if (development === production) throw new Error('Development and production database targets must be different');
  console.log('Configured development and production database endpoints differ. No credentials were logged.');
} catch (error) {
  console.error(error instanceof Error ? error.message : 'Database target validation failed');
  process.exitCode = 1;
}
