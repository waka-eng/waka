import {Hono} from 'hono';
import {z} from 'zod';
import {and,asc,desc,eq,isNull,sql} from 'drizzle-orm';
import {conversationMessages,conversationReplyRequests,conversations,inspirationConversationOrigins,principles,profiles} from '../db/index.js';
import {getDb} from '../lib/db.js';
import {requireAuth,humanSessionsOnly,type AuthEnv} from '../lib/middleware.js';
import {resolveTargetProfile} from './inspirations-tenancy.js';
import {profileQuerySchema} from './inspirations-validation.js';
import {CONVERSATION_LIMITS,conversationCapabilities,conversationRepliesEnabled,currentConversationReferences,readConversationContext,type ConversationSource} from '../lib/conversation-context.js';
import {conversationSearchQuery} from '../lib/conversation-material.js';
import {ConversationReplyError,projectConversationMessages,readConversationReference,readConversationReplyState,requestConversationReply,requestConversationReplyInTransaction,stopConversationReply} from '../lib/conversation-replies.js';
import {wakeCommittedBackgroundJobs} from '../lib/queue.js';
import {personalPrincipleReadable} from '../lib/personal-output.js';
import {PRINCIPLE_MIN_SIGNALS} from '../lib/principle-generation.js';

const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const messageInput=z.object({id:uuid,content:z.string().min(1).max(CONVERSATION_LIMITS.inputCharacters).refine(value=>value.trim().length>0),revision:z.number().int().min(0).max(CONVERSATION_LIMITS.messages),requestReply:z.boolean().optional(),correctsMessageId:uuid.optional()}).strict();
type ConversationEnv=AuthEnv&{Variables:{conversationProfileId:string}};
class ConversationError extends Error{constructor(message:string,readonly status:404|409|410|429){super(message);}}
type Db=ReturnType<typeof getDb>;
type Reader=Pick<Db,'select'>;
async function readConversation(db:Reader,profileId:string,id:string){
  const [row]=await db.select().from(conversations).where(and(eq(conversations.id,id),eq(conversations.profileId,profileId)));
  if(!row)throw new ConversationError('Conversation not found.',404);
  if(row.deletedAt)throw new ConversationError('This conversation was deleted.',410);
  const messages=await db.select().from(conversationMessages).where(and(eq(conversationMessages.profileId,profileId),eq(conversationMessages.conversationId,id))).orderBy(asc(conversationMessages.position)).limit(CONVERSATION_LIMITS.messages);
  const [initialPrinciple]=row.initialPrincipleId?await db.select({id:principles.id,statement:principles.statement,state:principles.state}).from(principles)
    .where(and(eq(principles.profileId,profileId),eq(principles.id,row.initialPrincipleId),personalPrincipleReadable(profileId,PRINCIPLE_MIN_SIGNALS))):[];
  const saved=await db.select({messageId:inspirationConversationOrigins.messageId,inspirationId:inspirationConversationOrigins.inspirationId}).from(inspirationConversationOrigins)
    .where(and(eq(inspirationConversationOrigins.profileId,profileId),eq(inspirationConversationOrigins.conversationId,id)));
  return {...row,initialPrinciple:initialPrinciple??null,messages:(await projectConversationMessages(db,profileId,id,messages)).map(message=>({...message,savedInspirationIds:saved.filter(item=>item.messageId===message.id).map(item=>item.inspirationId)}))};
}


export function createConversationRoutes(deps:{getDatabase?:typeof getDb;authMiddleware?:typeof requireAuth}={}){
  const routes=new Hono<ConversationEnv>(),database=deps.getDatabase??getDb;
  routes.use('*',async(c,next)=>{c.header('Cache-Control','private, no-store');await next();});
  routes.use('*',deps.authMiddleware??requireAuth,humanSessionsOnly);
  routes.onError((error,c)=>{
    if(error instanceof ConversationError)return c.json({error:error.message},error.status);
    if(error instanceof ConversationReplyError)return c.json({error:error.message},error.status);
    const code=(error as {code?:string;cause?:{code?:string}}).cause?.code??(error as {code?:string}).code;
    if(['23505','40001','40P01','55P03'].includes(code??''))return c.json({error:'The conversation changed. Check your saved messages before retrying.'},409);
    console.error('[conversations]',{code:typeof code==='string'&&/^[0-9A-Z]{5}$/.test(code)?code:'unknown'});
    return c.json({error:'The conversation could not be updated.'},500);
  });
  routes.use('*',async(c,next)=>{
    const query=profileQuerySchema.safeParse(c.req.query());if(!query.success)return c.json({error:'Invalid profile'},400);
    const target=await resolveTargetProfile(database(),c.get('session'),query.data.profile,c.req.method==='GET'?'read':'write');
    if(!target.ok)return c.json(target.body,target.status);c.set('conversationProfileId',target.profileId);await next();
  });
  routes.get('/',async c=>{
    const profileId=c.get('conversationProfileId');
    const rows=await database().select({id:conversations.id,profileId:conversations.profileId,updatedAt:conversations.updatedAt,revision:conversations.revision,
      preview:sql<string>`coalesce((SELECT left(m.content,120) FROM conversation_messages m WHERE m.profile_id=${profileId}::uuid AND m.conversation_id=conversations.id ORDER BY m.position LIMIT 1),'')`})
      .from(conversations).where(and(eq(conversations.profileId,profileId),isNull(conversations.deletedAt))).orderBy(desc(conversations.updatedAt),asc(conversations.id)).limit(CONVERSATION_LIMITS.conversations);
    return c.json({profileId,conversations:rows,...conversationCapabilities()});
  });
  routes.post('/',async c=>{
    const input=z.object({id:uuid,principleId:uuid.optional(),firstMessage:messageInput.omit({revision:true,correctsMessageId:true}).optional()}).strict().safeParse(await c.req.json().catch(()=>null));if(!input.success)return c.json({error:'Invalid conversation'},400);
    const profileId=c.get('conversationProfileId');
    const row=await database().transaction(async tx=>{
      await tx.select({id:profiles.id}).from(profiles).where(eq(profiles.id,profileId)).for('update');
      const [existing]=await tx.select().from(conversations).where(and(eq(conversations.profileId,profileId),eq(conversations.id,input.data.id)));
      if(existing){
        const current=await readConversation(tx,profileId,input.data.id);
        if(input.data.firstMessage){
          const first=current.messages[0];
          // Source deletion clears its FK, but cannot make a committed first
          // message impossible to recover. A replay never restores that source.
          if(current.initialPrincipleId!==null&&current.initialPrincipleId!==(input.data.principleId??null)||!first||first.role!=='user'||first.id!==input.data.firstMessage.id||first.content!==input.data.firstMessage.content)
            throw new ConversationError('This conversation already began with different words.',409);
        }
        return current;
      }
      const [count]=await tx.select({n:sql<number>`count(*)::int`}).from(conversations).where(and(eq(conversations.profileId,profileId),isNull(conversations.deletedAt)));
      if(count.n>=CONVERSATION_LIMITS.conversations)throw new ConversationError('Conversation limit reached. Delete an old conversation first.',429);
      if(input.data.principleId){const [source]=await tx.select({id:principles.id}).from(principles).where(and(eq(principles.profileId,profileId),eq(principles.id,input.data.principleId),personalPrincipleReadable(profileId,PRINCIPLE_MIN_SIGNALS)));if(!source)throw new ConversationError('This principle is not available.',404);}
      const first=input.data.firstMessage;
      await tx.insert(conversations).values({id:input.data.id,profileId,initialPrincipleId:input.data.principleId??null,revision:first?1:0});
      if(first){
        await tx.insert(conversationMessages).values({id:first.id,profileId,conversationId:input.data.id,position:1,role:'user',content:first.content});
        if(first.requestReply&&conversationRepliesEnabled())await requestConversationReplyInTransaction(tx,profileId,input.data.id,{messageId:first.id,afterRequestId:null});
      }
      return readConversation(tx,profileId,input.data.id);
    });
    if(input.data.firstMessage?.requestReply&&conversationRepliesEnabled())await wakeCommittedBackgroundJobs();
    return c.json({conversation:row,...conversationCapabilities()});
  });
  routes.use('/:id/*',async(c,next)=>{if(!uuid.safeParse(c.req.param('id')).success)return c.json({error:'Invalid conversation'},400);await next();});
  routes.get('/:id',async c=>{
    const id=uuid.safeParse(c.req.param('id'));if(!id.success)return c.json({error:'Invalid conversation'},400);
    const row=await database().transaction(tx=>readConversation(tx,c.get('conversationProfileId'),id.data),{isolationLevel:'repeatable read',accessMode:'read only'});
    return c.json({conversation:row,...conversationCapabilities()});
  });
  routes.get('/:id/context',async c=>c.json(await database().transaction(async tx=>{
    const profileId=c.get('conversationProfileId'),row=await readConversation(tx,profileId,c.req.param('id'));
    const lastUser=[...row.messages].reverse().find(message=>message.role==='user');
    const [request]=lastUser?await tx.select({sources:conversationReplyRequests.contextSources}).from(conversationReplyRequests)
      .where(and(eq(conversationReplyRequests.profileId,profileId),eq(conversationReplyRequests.conversationId,row.id),eq(conversationReplyRequests.userMessageId,lastUser.id)))
      .orderBy(desc(conversationReplyRequests.createdAt),desc(conversationReplyRequests.id)).limit(1):[];
    if(request?.sources){
      const sources=(await currentConversationReferences(tx,profileId,request.sources)).filter((source):source is ConversationSource=>source!==null);
      const bound=(kind:ConversationSource['kind'],remaining:number)=>sources.filter(source=>source.kind===kind).flatMap(source=>{
        if(remaining<=0)return [];const text=source.text.slice(0,remaining);remaining-=text.length;
        return [{...source,text,truncated:source.truncated||text.length<source.text.length}];
      });
      return {profileId,principles:bound('principle',8000),reading:bound('top_of_mind_entry',4000),inspirations:bound('inspiration',4000),...conversationCapabilities()};
    }
    return readConversationContext(tx,profileId,conversationSearchQuery(row.messages),undefined,row.initialPrincipleId);
  },{isolationLevel:'repeatable read',accessMode:'read only'})));
  routes.post('/:id/messages',async c=>{
    const input=messageInput.safeParse(await c.req.json().catch(()=>null));if(!input.success)return c.json({error:'Write a message of up to 4,000 characters.'},400);
    const profileId=c.get('conversationProfileId'),id=c.req.param('id');
    const row=await database().transaction(async tx=>{
      await tx.select({id:conversations.id}).from(conversations).where(and(eq(conversations.profileId,profileId),eq(conversations.id,id))).for('update');
      const current=await readConversation(tx,profileId,id),existing=current.messages.find(message=>message.id===input.data.id);
      if(existing){if(existing.role!=='user'||existing.content!==input.data.content||existing.correctsMessageId!==(input.data.correctsMessageId??null))throw new ConversationError('This message id already holds different words.',409);return current;}
      if(current.revision!==input.data.revision)throw new ConversationError('New messages arrived. Check the conversation before sending.',409);
      if(current.revision>=(input.data.requestReply&&conversationRepliesEnabled()?CONVERSATION_LIMITS.messages-1:CONVERSATION_LIMITS.messages))throw new ConversationError('This conversation is full. Start another one.',429);
      if(input.data.correctsMessageId&&!current.messages.some(message=>message.id===input.data.correctsMessageId&&message.role==='assistant'))throw new ConversationError('Choose a reply in this conversation to correct.',409);
      await tx.insert(conversationMessages).values({id:input.data.id,profileId,conversationId:id,position:current.revision+1,role:'user',content:input.data.content,correctsMessageId:input.data.correctsMessageId??null});
      await tx.update(conversations).set({revision:current.revision+1,updatedAt:new Date()}).where(and(eq(conversations.profileId,profileId),eq(conversations.id,id)));
      if(input.data.requestReply&&conversationRepliesEnabled())await requestConversationReplyInTransaction(tx,profileId,id,{messageId:input.data.id,afterRequestId:null});
      return readConversation(tx,profileId,id);
    });if(input.data.requestReply&&conversationRepliesEnabled())await wakeCommittedBackgroundJobs();return c.json({conversation:row,...conversationCapabilities()});
  });
  routes.get('/:id/reply',async c=>c.json(await readConversationReplyState(database(),c.get('conversationProfileId'),c.req.param('id'))));
  routes.post('/:id/replies',async c=>{
    const input=z.object({messageId:uuid,afterRequestId:uuid.nullable()}).strict().safeParse(await c.req.json().catch(()=>null));
    if(!input.success)return c.json({error:'Invalid reply request'},400);
    return c.json(await requestConversationReply(database(),c.get('conversationProfileId'),c.req.param('id'),input.data));
  });
  routes.post('/:id/replies/:requestId/stop',async c=>{
    const requestId=uuid.safeParse(c.req.param('requestId'));if(!requestId.success)return c.json({error:'Invalid reply request'},400);
    return c.json(await stopConversationReply(database(),c.get('conversationProfileId'),c.req.param('id'),requestId.data));
  });
  routes.get('/:id/replies/:requestId/references/:index',async c=>{
    const requestId=uuid.safeParse(c.req.param('requestId')),index=Number(c.req.param('index'));
    if(!requestId.success||!Number.isInteger(index)||index<0||index>2)return c.json({error:'Invalid reference'},400);
    return c.json(await readConversationReference(database(),c.get('conversationProfileId'),c.req.param('id'),requestId.data,index));
  });
  routes.delete('/:id',async c=>{
    const id=uuid.safeParse(c.req.param('id'));if(!id.success)return c.json({error:'Invalid conversation'},400);
    const profileId=c.get('conversationProfileId');
    await database().transaction(async tx=>{
      const [row]=await tx.select().from(conversations).where(and(eq(conversations.profileId,profileId),eq(conversations.id,id.data))).for('update');
      if(!row)throw new ConversationError('Conversation not found.',404);
      await tx.update(conversationReplyRequests).set({status:'stopped',userMessageId:null,assistantMessageId:null,references:[],contextSources:[],followUpQuestion:null,contextHash:'',failureCode:null,finishedAt:new Date()})
        .where(and(eq(conversationReplyRequests.profileId,profileId),eq(conversationReplyRequests.conversationId,id.data)));
      await tx.delete(conversationMessages).where(and(eq(conversationMessages.profileId,profileId),eq(conversationMessages.conversationId,id.data)));
      await tx.update(conversations).set({deletedAt:row.deletedAt??new Date(),updatedAt:new Date()}).where(and(eq(conversations.profileId,profileId),eq(conversations.id,id.data)));
    });return c.json({deleted:true});
  });
  return routes;
}
