/** The native 001 benchmark is frozen in Git. Its exact case catalog remains inspectable. */
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {retrievalSources,retrievalCases,retrievalHoldoutCases,retrievalValidationCases,retrievalGate} from './conversation-retrieval-cases.js';
const holdout=process.argv.includes('--holdout'),validation=process.argv.includes('--validation'),large=process.argv.includes('--large'),cases=validation?retrievalValidationCases:holdout?retrievalHoldoutCases:retrievalCases;
assert.ok(!(holdout&&validation),'Choose one comparison set');
const baseDigest=createHash('sha256').update(JSON.stringify({retrievalSources,retrievalCases,retrievalGate})).digest('hex');
const heldDigest=createHash('sha256').update(JSON.stringify({retrievalSources,retrievalCases:retrievalHoldoutCases,retrievalGate})).digest('hex');
const digest=holdout||validation?createHash('sha256').update(JSON.stringify({retrievalSources,retrievalCases:cases,retrievalGate})).digest('hex'):baseDigest;
if(process.argv.includes('--list')){console.log(JSON.stringify({digest,sources:retrievalSources.length,queries:cases.length,gate:retrievalGate,cases},null,2));process.exit(0);}
throw new Error('The legacy 001 retrieval evaluation is retired. Use --list to inspect the historical case catalog.');
