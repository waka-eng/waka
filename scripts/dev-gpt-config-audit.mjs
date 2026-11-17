import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import profile from '../infra/model-profile.json' with {type:'json'};
import {readAuditAwsJson,readAuditOutputs,auditFailure,printAuditReport} from './audit-diagnostics.mjs';
export function auditDevelopmentGpt({outputs,expected,read}){
 const checks={},resources={};
 const account=read(['sts','get-caller-identity']).Account;
 for(const [role,output] of [['api','apiFunctionName'],['worker','backgroundWorkerFunctionName'],['principleRefresh','principleRefreshFunctionName']]){
  const name=outputs[output];if(typeof name!=='string'||!name){checks[role+'Identity']=false;checks.signupAdmissionIsolated=false;continue;}
  const fn=read(['lambda','get-function-configuration','--function-name',name]),env=fn.Environment?.Variables??{};
  checks.signupAdmissionIsolated=(checks.signupAdmissionIsolated??true)&&env.WAKA_TURNSTILE_SECRET===undefined&&env.WAKA_TURNSTILE_SITE_KEY===undefined&&(role==='api'?env.WAKA_SIGNUP_ADMISSION==='off':env.WAKA_SIGNUP_ADMISSION===undefined);
  checks.newHumanEmbeddingEnrollment=(checks.newHumanEmbeddingEnrollment??true)&&(role==='api'?env.WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2==='1':env.WAKA_ENROLL_NEW_EMPTY_HUMAN_EMBEDDING_2===undefined);
  resources[role]=name;checks[role+'Identity']=typeof account==='string'&&/^\d{12}$/.test(account)&&fn.FunctionName===name&&fn.FunctionArn===`arn:aws:lambda:us-west-2:${account}:function:${name}`;
  let app;try{app=JSON.parse(env.SST_RESOURCE_App??'{}');}catch{app={};}
  checks[role+'Stage']=['development','dev'].includes(expected.stage)&&env.WAKA_STAGE===expected.stage&&app.name==='waka'&&app.stage===expected.stage;
  checks[role+'OpenAiKey']=!!expected.openAi&&env.OPENAI_API_KEY===expected.openAi;
  checks[role+'Database']=!!expected.database&&env.DB_CONNECTION_URL===expected.database;
  checks[role+'Profile']=Object.entries(profile).every(([key,value])=>env[key]===value);
  checks[role+'Chat']=env.WAKA_CONVERSATION_REPLIES===expected.replies;
  checks[role+'DatabaseTransport']=role==='api'||role==='worker'?env.WAKA_DB_PREPARED_QUERIES==='1':env.WAKA_DB_PREPARED_QUERIES===undefined||env.WAKA_DB_PREPARED_QUERIES==='0';
  checks.signupAdmissionIsolated=checks.signupAdmissionIsolated===true&&checks[role+'Identity']===true&&checks[role+'Stage']===true;
 }
 const cleanupName=outputs.monitorCleanupFunctionName;
 if(typeof cleanupName!=='string'||!/^[A-Za-z0-9_-]{1,64}$/.test(cleanupName))checks.signupAdmissionIsolated=false;
 else{
  const fn=read(['lambda','get-function-configuration','--function-name',cleanupName]),env=fn.Environment?.Variables??{};let app;try{app=JSON.parse(env.SST_RESOURCE_App??'null');}catch{}
  resources.cleanup=cleanupName;
  checks.signupAdmissionIsolated=checks.signupAdmissionIsolated===true&&fn.FunctionName===cleanupName&&fn.FunctionArn===`arn:aws:lambda:us-west-2:${account}:function:${cleanupName}`&&app?.name==='waka'&&app?.stage===expected.stage&&
   ['WAKA_TURNSTILE_SECRET','WAKA_TURNSTILE_SITE_KEY','WAKA_SIGNUP_ADMISSION','OPENAI_API_KEY','OPENROUTER_API_KEY','GEMINI_API_KEY'].every(key=>env[key]===undefined);
 }
 checks.workerPointer=read(['lambda','get-function-configuration','--function-name',outputs.apiFunctionName]).Environment?.Variables?.WAKA_BACKGROUND_WORKER_FUNCTION===outputs.backgroundWorkerFunctionName;
 return {stage:'development',observedAt:new Date().toISOString(),checks,resources,passed:Object.values(checks).every(v=>v===true),liveModelCapabilityExercised:false,embeddingParityApproved:false};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 try{printAuditReport(auditDevelopmentGpt({outputs:readAuditOutputs(),expected:{openAi:process.env.OPENAI_API_KEY,database:process.env.DB_CONNECTION_URL,replies:process.env.WAKA_CONVERSATION_REPLIES,stage:process.env.SST_STAGE},read:readAuditAwsJson}),'dev-gpt-config-audit.json');}
 catch(error){printAuditReport(auditFailure('development_gpt_config',error),'dev-gpt-config-audit.json');}
}
