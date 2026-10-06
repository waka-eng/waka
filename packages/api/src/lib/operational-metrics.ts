/** Raw JSON avoids console prefixes that invalidate CloudWatch EMF. Callers
 * supply closed operational fields, never user text or account identifiers. */
export function emitOperationalMetric(document:Record<string,unknown>){
  try{process.stdout.write(JSON.stringify(document)+'\n');}catch{/* Metrics cannot retry or fail application work. */}
}
