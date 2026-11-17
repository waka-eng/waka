/** Native Responses transport; exactly the existing prompt builders/parsers. */
import {
  buildSignalExtractionRequest,parseSignalCandidates,buildSignalSupportRequest,parseSignalSupport,
  buildSignalMatchJudgementRequest,parseSignalMatchJudgement,buildTopOfMindSynthesisRequest,parseTopOfMindSynthesis,
  buildTopOfMindReviewRequest,parseTopOfMindReview,buildTopOfMindComparisonRequest,applyTopOfMindComparison,
  buildPrincipleDistillRequest,parseDistilledPrinciples,buildPrincipleGroundingRequest,parsePrincipleGrounding,
  buildPrincipleRelationRequest,parsePrincipleRelation,buildDeclarationRouteRequest,parseDeclarationRoute,
  buildReflectionQuestionRequest,parseReflectionQuestion,buildReviewQuestionRequest,parseReviewQuestion,
  buildConversationReplyRequest,parseConversationReply,buildReviewAnswerDerivationRequest,parseReviewAnswerDerivation,
} from '../queue/gemini.js';
import {MODEL_DECLINED,ModelDidNotAnswerError,DeclarationNotConsideredError,type ModelProvider} from './model-provider.js';
import {callOpenAi,openAiTextRequest} from './openai-http.js';
import {nativeGptTask,type GptTask} from './model-routing.js';
import type {GeminiShapedRequest} from './generation-schema.js';
import {emitOperationalMetric} from './operational-metrics.js';
import {recordOperationalFault} from './operational-fault.js';

export function createOpenAiModelProvider():ModelProvider {
  async function ask<T>(task:GptTask,label:string,schema:string,request:GeminiShapedRequest,parse:(value:unknown)=>T,
    onDeclined?:()=>T):Promise<T>{
    const config=nativeGptTask(task);
    const stage=['development','dev','production','local','test'].includes(process.env.WAKA_STAGE??'')?process.env.WAKA_STAGE:'other';
    const result=(outcome:'accepted'|'declined'|'rejected')=>emitOperationalMetric({event:'model_result',Stage:stage,Provider:'openai',
      task,model:config.model,reasoning:config.effort,outcome}); // No EMF, payloads, errors or identifiers.
    const payload=await callOpenAi(openAiTextRequest(task,request,schema),label);
    if(payload===MODEL_DECLINED){result('declined');if(onDeclined)return onDeclined();throw new ModelDidNotAnswerError(label);}
    if(payload===null){result('rejected');throw new ModelDidNotAnswerError(label);}
    try{const parsed=parse(payload);result('accepted');return parsed;}catch(error){result('rejected');recordOperationalFault('provider_failure');throw error;}
  }
  return {
    name:'openai',
    answerConversation:input=>ask('chat','conversation reply','conversation_reply',buildConversationReplyRequest(input),value=>parseConversationReply(value,input)),
    askReflectionQuestion:input=>ask('reflect','reflection follow-up','reflection_question',buildReflectionQuestionRequest(input),value=>parseReflectionQuestion(value,input)),
    askReviewQuestion:input=>ask('reflect','review question','review_question',buildReviewQuestionRequest(input),value=>parseReviewQuestion(value,input)),
    deriveReviewAnswer:input=>ask('extract','review derivation','review_derivation',buildReviewAnswerDerivationRequest(input),value=>parseReviewAnswerDerivation(value,input)),
    async extractSignalCandidates(input){
      if(!input.inspiration.text.trim()&&!input.reflections.length&&!input.attachments.length)return {statements:[],category:null};
      return ask('extract','signal extraction','signal_candidates',buildSignalExtractionRequest(input),value=>parseSignalCandidates(value,input),()=>({statements:[],category:null}));
    },
    assessSignalSupport:input=>ask('support','signal support assessment','signal_support',buildSignalSupportRequest(input),parseSignalSupport),
    judgeSignalMatch:input=>ask('judge','signal match judgement','signal_match',buildSignalMatchJudgementRequest(input),parseSignalMatchJudgement),
    synthesizeTopOfMind:input=>ask('synthesize','top-of-mind synthesis','top_of_mind',buildTopOfMindSynthesisRequest(input),parseTopOfMindSynthesis),
    async reviewTopOfMind(input){
      const reviewed=await ask('review','top-of-mind review','top_of_mind_review',buildTopOfMindReviewRequest(input),parseTopOfMindReview);
      if(!input.comparison)return reviewed;
      return ask('judge','top-of-mind comparison','top_of_mind_comparison',buildTopOfMindComparisonRequest(input,reviewed),value=>applyTopOfMindComparison(input,reviewed,value));
    },
    distillPrinciples:input=>ask('principles','principle distillation','principles',buildPrincipleDistillRequest(input),parseDistilledPrinciples,()=>({candidates:[]})),
    assessPrincipleGrounding:input=>ask('principles','principle grounding','principle_grounding',buildPrincipleGroundingRequest(input),value=>parsePrincipleGrounding(value,input)),
    judgePrincipleRelation:input=>ask('principleJudge','principle relation judgement','principle_relation',buildPrincipleRelationRequest(input),value=>parsePrincipleRelation(value,input)),
    async routeDeclaration(input){
      try{return await ask('route','declaration routing','declaration_route',buildDeclarationRouteRequest(input),parseDeclarationRoute);}
      catch(error){if(error instanceof ModelDidNotAnswerError)throw new DeclarationNotConsideredError('Declaration routing returned no usable verdict');throw error;}
    },
  };
}
