/** Scripted model verdict for storage/lease tests, not semantic evidence.
 * Real-provider quality is checked by the separate live calibration. */
import type {PrincipleGroundingInput} from '../../src/lib/model-provider.js';
export async function acceptPrincipleGroundingForFixture(input:PrincipleGroundingInput){
  return {assessments:input.candidates.map(row=>({candidateId:row.id,supported:true}))};
}
