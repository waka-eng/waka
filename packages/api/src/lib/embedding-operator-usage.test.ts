/** WHAT THIS MOCKS, AND WHY (gate G6): nothing. Numeric fixed synthetic EMF
 * exercises the real operator aggregator, including private-field refusal. */
import {expect,it} from 'vitest';
import {createEmbeddingOperatorUsage} from './embedding-operator-usage.js';
it('preserves closed numeric usage and explicit unknown billing without forwarding raw EMF or extra fields',()=>{
 const usage=createEmbeddingOperatorUsage();
 usage.observe(JSON.stringify({event:'model_usage',Provider:'openrouter',operation:'embedding',outcome:'received',ModelRequests:1,CostUsd:.0000028,inputTokens:14,outputTokens:null,_aws:{private:'PRIVATE_RAW'},model:'PRIVATE_MODEL',rawBody:'PRIVATE_BODY',embedding:[1,2]}));
 usage.observe(JSON.stringify({event:'model_usage',Provider:'openrouter',operation:'embedding',outcome:'unknown',ModelRequests:1,inputTokens:null}));
 expect(usage.snapshot()).toMatchObject({requests:2,received:1,unknown:1,inputTokens:14,reportedCostUsd:.0000028,pricedRequests:1,unpricedRequests:1,invoice:false});expect(JSON.stringify(usage.snapshot())).not.toContain('PRIVATE');expect(JSON.stringify(usage.snapshot())).not.toContain('_aws');
});
it('does not coerce, log or retain arbitrary lines, vectors, foreign operations or invalid costs',()=>{
 const usage=createEmbeddingOperatorUsage();for(const line of ['PRIVATE_BODY','x'.repeat(5000),JSON.stringify([1,2]),JSON.stringify({event:'model_usage',Provider:'gemini',operation:'embedding',outcome:'received',ModelRequests:1})])usage.observe(line);
 usage.observe(JSON.stringify({event:'model_usage',Provider:'openrouter',operation:'embedding',outcome:'http_error',ModelRequests:1,CostUsd:'0.00',inputTokens:'500'}));expect(usage.snapshot()).toMatchObject({requests:1,httpFailures:1,unpricedRequests:1,inputTokens:0,suppressedOtherRecords:4});
});
