/** Content-free aggregation for the prepared operator's SINGLE receipt.
 * Existing raw EMF is consumed, never forwarded or given new dimensions. */
export function createEmbeddingOperatorUsage(){
 const totals={requests:0,received:0,httpFailures:0,unknown:0,inputTokens:0,outputTokens:0,reportedCostUsd:0,pricedRequests:0,unpricedRequests:0,suppressedOtherRecords:0};
 const number=(v:unknown)=>typeof v==='number'&&Number.isFinite(v)&&v>=0?v:null;
 return {
  observe(line:unknown){
   if(typeof line!=='string'||Buffer.byteLength(line)>4096){totals.suppressedOtherRecords++;return;}
   let row:Record<string,unknown>;try{row=JSON.parse(line);if(!row||typeof row!=='object'||Array.isArray(row))throw Error();}catch{totals.suppressedOtherRecords++;return;}
   if(row.event!=='model_usage'||row.Provider!=='openrouter'||row.operation!=='embedding'||!['received','http_error','unknown'].includes(String(row.outcome))||row.ModelRequests!==1){totals.suppressedOtherRecords++;return;}
   totals.requests++;if(row.outcome==='received')totals.received++;else if(row.outcome==='http_error')totals.httpFailures++;else totals.unknown++;
   totals.inputTokens+=number(row.inputTokens)??0;totals.outputTokens+=number(row.outputTokens)??0;
   const cost=number(row.CostUsd);if(cost===null)totals.unpricedRequests++;else{totals.pricedRequests++;totals.reportedCostUsd+=cost;}
  },
  snapshot(){return {...totals,reportedCostUsd:Math.round(totals.reportedCostUsd*1e12)/1e12,tokenCountsMayBeIncomplete:true,invoice:false};},
 };
}
