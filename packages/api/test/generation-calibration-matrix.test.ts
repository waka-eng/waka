/** No provider or database. These assertions preserve declared inputs, not
 * proof of generation quality; actual outputs require semantic review. */
import {createHash} from 'node:crypto';
import {describe,expect,it} from 'vitest';
import {generationCalibrationCases as cases} from '../../../tools/e2e/generation-calibration-cases.js';

describe('fixed generation calibration journeys',()=>{
  it('freezes 24 distinct cases and their predeclared rubric',()=>{
    expect(cases).toHaveLength(24);
    expect(new Set(cases.map(row=>row.id)).size).toBe(24);
    expect(createHash('sha256').update(JSON.stringify(cases)).digest('hex')).toBe('b142bfef0b000df1c79cf2484f5c2bf0358d4c1f576bb06559bfed45e4032f94');
    for(const row of cases)expect(row.expected.rubric.length).toBeGreaterThan(40);
  });
  it('includes abstention, human control, corrections, cadence and both media types',()=>{
    expect(cases.filter(row=>row.expected.principles==='none').length).toBeGreaterThanOrEqual(10);
    expect(cases.filter(row=>row.expected.principles==='some')).toHaveLength(4);
    expect(cases.filter(row=>row.locale==='ko-KR')).toHaveLength(4);
    expect(cases.some(row=>row.previous?.locked&&row.signals.some(signal=>signal.deleted))).toBe(true);
    expect(cases.some(row=>row.expected.held&&row.automatic)).toBe(true);
    expect(cases.some(row=>row.expected.unchanged)).toBe(true);
    expect(cases.some(row=>row.signals.some(signal=>signal.media==='image'))).toBe(true);
    expect(cases.some(row=>row.signals.some(signal=>signal.media==='audio'&&signal.correctedFrom))).toBe(true);
  });
});
