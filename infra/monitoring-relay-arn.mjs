/** Called inside Pulumi all().apply(), never on unresolved Outputs. A failed
 * Lambda creation can leave a known-null computed ARN in the checkpoint even
 * though its physical name is known. Build only this exact owned identity. */
export function monitorRelayAlarmActions(region, account, name) {
  if (region !== 'us-west-2' || typeof account !== 'string' || !/^\d{12}$/.test(account) ||
      typeof name !== 'string' || name.length > 64 || !/^waka-production-MonitorRelayFunction-[A-Za-z0-9_-]+$/.test(name)) {
    throw Error('monitor_relay_identity_invalid');
  }
  return [`arn:aws:lambda:${region}:${account}:function:${name}`];
}
