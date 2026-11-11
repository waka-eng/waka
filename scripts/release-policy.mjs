/** A checked ref must remain one immutable commit, including on manual dispatch. */
export function assertCheckoutSha(expected, actual) {
  if (!/^[a-f0-9]{40}$/.test(expected ?? '') || !/^[a-f0-9]{40}$/.test(actual ?? '')) throw new Error('Release requires a full immutable commit SHA');
  if (expected !== actual) throw new Error('Checked and deployed commit do not match');
}
export function assertProductionRelease({checkResult,expectedSha,actualSha}) {
  if (checkResult !== 'success') throw new Error('Production operations require successful CI');
  assertCheckoutSha(expectedSha,actualSha);
}
