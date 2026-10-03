/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Production witness selection,
 * confidence and promotion constants run against explicit synthetic lineage.
 * These structural checks do not claim semantic extraction quality. */
import {expect,it} from 'vitest';
import {computeSignalConfidence,selectIndependentEvidence,type ConfidenceEvidence} from './signal-lifecycle.js';
import {SIGNAL_PROMOTION_MIN_EVIDENCE} from './signal-derivation-thresholds.js';
const now=new Date('2026-10-02T12:00:00Z');
const raw=(id:string,date=now):ConfidenceEvidence=>({createdAt:date,source:'app',lineage:{kind:'inspiration',unitId:id,originIds:[id]}});
const review=(id:string,origins:string[],date=now):ConfidenceEvidence=>({createdAt:date,source:'app',lineage:{kind:'review',unitId:id,originIds:origins}});
it('records the baseline risk without changing the existing arithmetic',()=>{
  const legacy={createdAt:now,source:'app' as const};
  expect(computeSignalConfidence([legacy],now)).toBe(24);expect(computeSignalConfidence([legacy,legacy,legacy],now)).toBe(43);
  expect(SIGNAL_PROMOTION_MIN_EVIDENCE).toBe(3);
});
it('counts one original once across repeated representations',()=>{
  const rows=[raw('audio'),raw('audio'),raw('audio')];
  expect(selectIndependentEvidence(rows)).toHaveLength(1);expect(computeSignalConfidence(rows,now)).toBe(24);
});
it('does not turn three references or three replies into three independent witnesses',()=>{
  const rows=[review('session',['a','b','c']),review('session',['a','b']),review('session',['c'])];
  const selected=selectIndependentEvidence(rows);expect(selected).toHaveLength(1);expect(selected.length).toBeLessThan(SIGNAL_PROMOTION_MIN_EVIDENCE);
  expect(computeSignalConfidence(rows,now)).toBe(24);
});
it('does not recount the original when a review revisits it',()=>{
  expect(selectIndependentEvidence([review('session',['a']),raw('a')])).toEqual([raw('a')]);
  expect(selectIndependentEvidence([review('first',['a']),review('second',['a'])])).toHaveLength(1);
});
it('preserves separate raw witnesses rather than merging a reviewed pair',()=>{
  const rows=[review('session',['a','b']),raw('b'),raw('a')];
  expect(selectIndependentEvidence(rows).map(row=>row.lineage?.unitId)).toEqual(['a','b']);
  expect(selectIndependentEvidence([...rows,raw('c')])).toHaveLength(3);
});
it('uses augmenting paths instead of losing an independent origin to greedy order',()=>{
  const rows=[review('first',['a','b']),review('second',['a'])];
  expect(selectIndependentEvidence(rows)).toHaveLength(2);expect(selectIndependentEvidence([...rows].reverse())).toEqual(selectIndependentEvidence(rows));
});
it('does not manufacture longevity from later replies or older context',()=>{
  const first=new Date('2026-09-30T12:00:00Z'),second=new Date('2026-10-01T12:00:00Z');
  expect(selectIndependentEvidence([review('session',['old-source'],second),review('session',['old-source'],first)])[0]?.createdAt).toEqual(first);
  expect(selectIndependentEvidence([review('session',['old-source'],now)])[0]?.createdAt).toEqual(now);
});
it('does not count ungrounded or context-only units',()=>{
  expect(selectIndependentEvidence([review('empty',[])])).toHaveLength(0);
  expect(selectIndependentEvidence([raw('a'),review('focused',['a'])])).toHaveLength(1);
});
it('is idempotent after grouping and never guesses anonymous lineage',()=>{
  const legacy={createdAt:now,source:'agent' as const},rows=[raw('c'),review('one',['a']),review('one',['b']),review('two',['a'])];
  const selected=selectIndependentEvidence(rows);expect(selected).toHaveLength(3);expect(selectIndependentEvidence(selected)).toEqual(selected);
  expect(()=>selectIndependentEvidence([legacy,review('one',['a'])])).toThrow('anonymous');
});
it('does not backdate a later origin to an earlier answer about a different source',()=>{
  const old=new Date('2026-01-01T12:00:00Z');
  const selected=selectIndependentEvidence([raw('a',old),review('one',['a'],old),review('one',['b'],now)]);
  expect(selected.map(row=>row.createdAt)).toEqual([old,now]);expect(selectIndependentEvidence(selected)).toEqual(selected);
});
it('handles a long overlapping chain without a recursive call stack',()=>{
  const key=(i:number)=>String(i).padStart(5,'0');
  const rows=Array.from({length:5000},(_,i)=>review(key(i),[key(i),key(i+1)]));
  rows.push(review('last',[key(0)]));expect(selectIndependentEvidence(rows)).toHaveLength(5001);
});
it('matches an exhaustive small-graph count while preserving direct evidence',()=>{
  const origins=['a','b','c'];
  const subsets=Array.from({length:7},(_,i)=>origins.filter((_,bit)=>((i+1)&(1<<bit))!==0));
  const maximum=(sets:string[][],used=new Set<string>(),index=0):number=>{
    if(index===sets.length)return 0;
    return Math.max(maximum(sets,used,index+1),...sets[index]!.filter(id=>!used.has(id)).map(id=>1+maximum(sets,new Set([...used,id]),index+1)));
  };
  for(const a of subsets)for(const b of subsets)for(const c of subsets){
    const selected=selectIndependentEvidence([raw('a'),review('first',a),review('second',b),review('third',c)]);
    expect(selected).toHaveLength(maximum([['a'],a,b,c]));
    expect(selected.some(row=>row.lineage?.kind==='inspiration'&&row.lineage.unitId==='a')).toBe(true);
    expect(new Set(selected.flatMap(row=>row.lineage!.originIds)).size).toBe(selected.length);
  }
});
