/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. A temporary directory tests
 * real snapshot replacement without providers, credentials or database access. */
import {mkdtempSync,readFileSync,readdirSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {afterEach,expect,it} from 'vitest';
import {writeEvaluationSnapshot} from '../../../tools/e2e/evaluation-journal.js';
const directories:string[]=[];
afterEach(()=>{for(const directory of directories.splice(0))rmSync(directory,{recursive:true,force:true});});
it('preserves an unfinished dispatch before a final result exists',()=>{
  const directory=mkdtempSync(join(tmpdir(),'waka-eval-journal-'));directories.push(directory);
  const path=join(directory,'reply.json');
  const snapshot={finished:false,calls:1,costComplete:false,requests:[{phase:'dispatching',costUsd:null}]};
  writeEvaluationSnapshot(path,snapshot);
  expect(JSON.parse(readFileSync(path,'utf8'))).toEqual(snapshot);
  expect(readdirSync(directory)).toEqual(['reply.json']);
});
it('atomically replaces a snapshot with received usage and completed results',()=>{
  const directory=mkdtempSync(join(tmpdir(),'waka-eval-journal-'));directories.push(directory);
  const path=join(directory,'reply.json');
  writeEvaluationSnapshot(path,{finished:false,calls:1});
  const completed={finished:true,calls:1,costUsd:0.001,costComplete:true,results:[{semanticReview:'pending'}]};
  writeEvaluationSnapshot(path,completed);
  expect(JSON.parse(readFileSync(path,'utf8'))).toEqual(completed);
  expect(readdirSync(directory)).toEqual(['reply.json']);
});
