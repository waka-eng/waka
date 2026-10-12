import {Hono} from 'hono';
import {z} from 'zod';
import {and,asc,desc,eq,gte,isNull,sql} from 'drizzle-orm';
import {conversationMessages,conversationReplyRequests,conversations,inspirationConversationOrigins,inspirations,principles,profiles} from '../db/index.js';
import {getDb} from '../lib/db.js';
import {requireAuth,humanSessionsOnly,type AuthEnv} from '../lib/middleware.js';
import {resolveTargetProfile} from './inspirations-tenancy.js';
import {profileQuerySchema} from './inspirations-validation.js';
import {CONVERSATION_LIMITS,conversationCapabilities,conversationRepliesEnabled,currentConversationReferences,readConversationContext,type ConversationSource} from '../lib/conversation-context.js';
import {conversationSearchQuery} from '../lib/conversation-material.js';
import {CONVERSATION_STARTERS,conversationPreview} from '../lib/conversation-preview.js';
import {ConversationReplyError,projectConversationMessages,readConversationReference,readConversationReplyState,requestConversationReply,requestConversationReplyInTransaction,stopConversationReply} from '../lib/conversation-replies.js';
import {wakeCommittedBackgroundJobs} from '../lib/queue.js';
import {personalPrincipleReadable} from '../lib/personal-output.js';
import {PRINCIPLE_MIN_SIGNALS} from '../lib/principle-generation.js';

const uuid=z.string().uuid().transform(value=>value.toLowerCase());
const messageInput=z.object({id:uuid,content:z.string().min(1).max(CONVERSATION_LIMITS.inputCharacters).refine(value=>value.trim().length>0),revision:z.number().int().min(0).max(CONVERSATION_LIMITS.messages),requestReply:z.boolean().optional(),correctsMessageId:uuid.optional()}).strict();
type ConversationEnv=AuthEnv&{Variables:{conversationProfileId:string}};
class ConversationError extends Error{constructor(message:string,readonly status:400|404|409|410|429){super(message);}}
type MessageWindow={from?:number;limit?:number};
function messageWindow(from?:string,limit?:string):MessageWindow|undefined{
  if(from===undefined&&limit===undefined)return undefined;
  if(from!==undefined&&limit!==undefined)throw new ConversationError('Choose one message window.',400);
  const value=Number(from??limit);if(!Number.isInteger(value)||value<1||value>200)throw new ConversationError('Invalid message window.',400);
  return from!==undefined?{from:value}:{limit:value};
}
function messageWindowStart(revision:number,window:MessageWindow){
  const start=window.from??Math.max(1,revision-window.limit!+1);
  if(start>Math.max(1,revision))throw new ConversationError('Invalid message window.',400);return start;
}
function windowedConversation<T extends{revision:number;messages:Array<{position:number;id:string}>}>(row:T,window?:MessageWindow,anchorId?:string){
  if(!window)return row;const start=messageWindowStart(row.revision,window);
  const first=Math.min(start,row.messages.find(message=>message.id===anchorId)?.position??start);
  return {...row,messageWindowStart:first,messages:row.messages.filter(message=>message.position>=first)};
}
type Db=ReturnType<typeof getDb>;
type Reader=Pick<Db,'select'>;
async function readConversation(db:Reader,profileId:string,id:string,window?:MessageWindow){
  const [row]=await db.select().from(conversations).where(and(eq(conversations.id,id),eq(conversations.profileId,profileId)));
  if(!row)throw new ConversationError('Conversation not found.',404);
  if(row.deletedAt)throw new ConversationError('This conversation was deleted.',410);
  const start=window?messageWindowStart(row.revision,window):1;
  const messages=await db.select().from(conversationMessages).where(and(eq(conversationMessages.profileId,profileId),eq(conversationMessages.conversationId,id),gte(conversationMessages.position,start))).orderBy(asc(conversationMessages.position)).limit(CONVERSATION_LIMITS.messages);
  const [initialPrinciple]=row.initialPrincipleId?await db.select({id:principles.id,statement:principles.statement,state:principles.state}).from(principles)
    .where(and(eq(principles.profileId,profileId),eq(principles.id,row.initialPrincipleId),personalPrincipleReadable(profileId,PRINCIPLE_MIN_SIGNALS))):[];
  /* The chip above the composer: which keep this conversation is pointed at.
   * Trimmed to 120 characters because that is this route's one and only text
   * budget for a label — `GET /` previews a thread with
   * `left(trim(m.content),120)` and `conversationPreview` slices to the same
   * 120 — and a keep's text is unbounded, so handing the whole thing over for
   * a chip would ship kilobytes per read to render one line. The reply reads
   * the full text through `readConversationContext`; this field exists only so
   * the person can see what they picked.
   *
   * No readability predicate, unlike `initialPrinciple` beside it: a principle
   * can be machine-minted and not yet earned enough evidence to be shown, so
   * reading one has a gate. A keep is the person's own saved words with no
   * such state — owner scoping is the entire test, and `eq(profileId)` plus
   * the composite FK are both already carrying it. */
  const [initialInspiration]=row.initialInspirationId?await db.select({id:inspirations.id,text:sql<string>`left(trim(${inspirations.text}),120)`}).from(inspirations)
    .where(and(eq(inspirations.profileId,profileId),eq(inspirations.id,row.initialInspirationId))):[];
  const saved=await db.select({messageId:inspirationConversationOrigins.messageId,inspirationId:inspirationConversationOrigins.inspirationId}).from(inspirationConversationOrigins)
    .where(and(eq(inspirationConversationOrigins.profileId,profileId),eq(inspirationConversationOrigins.conversationId,id)));
  const topic=window?await db.select({role:conversationMessages.role,content:conversationMessages.content}).from(conversationMessages)
    .where(and(eq(conversationMessages.profileId,profileId),eq(conversationMessages.conversationId,id),eq(conversationMessages.role,'user')))
    .orderBy(sql`CASE WHEN trim(${conversationMessages.content}) IN (${sql.join(CONVERSATION_STARTERS.map(value=>sql`${value}`),sql`, `)}) THEN 1 ELSE 0 END`,asc(conversationMessages.position)).limit(1):messages;
  return {...row,preview:conversationPreview(topic),...(window?{messageWindowStart:start}:{}),initialPrinciple:initialPrinciple??null,initialInspiration:initialInspiration??null,messages:(await projectConversationMessages(db,profileId,id,messages)).map(message=>({...message,savedInspirationIds:saved.filter(item=>item.messageId===message.id).map(item=>item.inspirationId)}))};
}
/**
 * The keep a conversation is being pointed at must exist AND be this
 * profile's. Checked here rather than left to the composite FK not because the
 * FK is unreliable — it is the thing that makes cross-profile pinning
 * impossible to store — but because its refusal arrives as SQLSTATE 23503,
 * which this route's `onError` does not translate and would therefore report
 * as a 500 "could not be updated". A person picking a keep that was deleted in
 * another tab has made an ordinary mistake and deserves the same 404 the
 * principle start already gives them, not a server error. Belt and braces, in
 * that order: the FK is the invariant, this is the sentence.
 */
async function requireOwnedInspiration(db:Reader,profileId:string,inspirationId:string){
  const [source]=await db.select({id:inspirations.id}).from(inspirations).where(and(eq(inspirations.profileId,profileId),eq(inspirations.id,inspirationId)));
  if(!source)throw new ConversationError('This inspiration is not available.',404);
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
    const query=profileQuerySchema.extend({from:z.string().optional(),limit:z.string().optional()}).safeParse(c.req.query());if(!query.success)return c.json({error:'Invalid profile'},400);
    const target=await resolveTargetProfile(database(),c.get('session'),query.data.profile,c.req.method==='GET'?'read':'write');
    if(!target.ok)return c.json(target.body,target.status);c.set('conversationProfileId',target.profileId);await next();
  });
  routes.get('/',async c=>{
    const profileId=c.get('conversationProfileId');
    const rows=await database().select({id:conversations.id,profileId:conversations.profileId,updatedAt:conversations.updatedAt,revision:conversations.revision,
      preview:sql<string>`coalesce((SELECT left(trim(m.content),120) FROM conversation_messages m
        WHERE m.profile_id=${profileId}::uuid AND m.conversation_id=conversations.id AND m.role='user'
        ORDER BY CASE WHEN trim(m.content) IN (${sql.join(CONVERSATION_STARTERS.map(value=>sql`${value}`),sql`, `)}) THEN 1 ELSE 0 END,m.position LIMIT 1),'')`})
      .from(conversations).where(and(eq(conversations.profileId,profileId),isNull(conversations.deletedAt))).orderBy(desc(conversations.updatedAt),asc(conversations.id)).limit(CONVERSATION_LIMITS.conversations);
    return c.json({profileId,conversations:rows,...conversationCapabilities()});
  });
  routes.post('/',async c=>{
    const window=messageWindow(c.req.query('from'),c.req.query('limit'));
    const input=z.object({id:uuid,principleId:uuid.optional(),inspirationId:uuid.optional(),firstMessage:messageInput.omit({revision:true,correctsMessageId:true}).optional()}).strict().safeParse(await c.req.json().catch(()=>null));if(!input.success)return c.json({error:'Invalid conversation'},400);
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
          //
          // The keep is compared on exactly the same terms as the principle,
          // for exactly the same reason: a create whose words match but whose
          // declared starting point does not is a different create wearing the
          // same id, and joining it would silently discard the caller's
          // intent. The asymmetry both share — a conversation that started
          // from nothing accepts a replay that names a source, but one that
          // started from a source rejects a replay naming another — is
          // deliberate: `null` is "unstated", not "stated as none".
          //
          // ONE KNOWN INTERACTION, recorded because it is not a bug to fix
          // here: a PATCH that re-points the keep makes a later replay of the
          // original create conflict, since the stored value is now the
          // current pick rather than the created one. That window needs a
          // first-send retry to arrive after a switch, and the person cannot
          // switch until the conversation exists — and a 409 here is
          // recoverable by re-reading, whereas storing a created-with value
          // purely to answer replays would add a column nothing else reads.
          if(current.initialPrincipleId!==null&&current.initialPrincipleId!==(input.data.principleId??null)||current.initialInspirationId!==null&&current.initialInspirationId!==(input.data.inspirationId??null)||!first||first.role!=='user'||first.id!==input.data.firstMessage.id||first.content!==input.data.firstMessage.content)
            throw new ConversationError('This conversation already began with different words.',409);
        }
        return windowedConversation(current,window,input.data.firstMessage?.id);
      }
      const [count]=await tx.select({n:sql<number>`count(*)::int`}).from(conversations).where(and(eq(conversations.profileId,profileId),isNull(conversations.deletedAt)));
      if(count.n>=CONVERSATION_LIMITS.conversations)throw new ConversationError('Conversation limit reached. Delete an old conversation first.',429);
      if(input.data.principleId){const [source]=await tx.select({id:principles.id}).from(principles).where(and(eq(principles.profileId,profileId),eq(principles.id,input.data.principleId),personalPrincipleReadable(profileId,PRINCIPLE_MIN_SIGNALS)));if(!source)throw new ConversationError('This principle is not available.',404);}
      if(input.data.inspirationId)await requireOwnedInspiration(tx,profileId,input.data.inspirationId);
      const first=input.data.firstMessage;
      await tx.insert(conversations).values({id:input.data.id,profileId,initialPrincipleId:input.data.principleId??null,initialInspirationId:input.data.inspirationId??null,revision:first?1:0});
      if(first){
        await tx.insert(conversationMessages).values({id:first.id,profileId,conversationId:input.data.id,position:1,role:'user',content:first.content});
        if(first.requestReply&&conversationRepliesEnabled())await requestConversationReplyInTransaction(tx,profileId,input.data.id,{messageId:first.id,afterRequestId:null});
      }
      return windowedConversation(await readConversation(tx,profileId,input.data.id),window,input.data.firstMessage?.id);
    });
    if(input.data.firstMessage?.requestReply&&conversationRepliesEnabled())await wakeCommittedBackgroundJobs();
    return c.json({conversation:row,...conversationCapabilities()});
  });
  routes.use('/:id/*',async(c,next)=>{if(!uuid.safeParse(c.req.param('id')).success)return c.json({error:'Invalid conversation'},400);await next();});
  routes.get('/:id',async c=>{
    const id=uuid.safeParse(c.req.param('id'));if(!id.success)return c.json({error:'Invalid conversation'},400);
    const window=messageWindow(c.req.query('from'),c.req.query('limit'));
    const row=await database().transaction(tx=>readConversation(tx,c.get('conversationProfileId'),id.data,window),{isolationLevel:'repeatable read',accessMode:'read only'});
    return c.json({conversation:row,...conversationCapabilities()});
  });
  /**
   * RE-POINT THE CONVERSATION AT A DIFFERENT KEEP, MID-THREAD.
   *
   * Founder: "user can pick an inspiration on the right and then like chat
   * about it" — the rail stays on screen while they talk, so the pick is
   * something they change, not something they declared once at create.
   *
   * PATCH `/:id` and not `POST /:id/inspiration`, because PATCH on the
   * resource is what this codebase already does for a small scoped field
   * change (`principles.ts`, `signals.ts`, `top-of-mind.ts`,
   * `inspirations-editing.ts`, `attachment-transcripts.ts`), and because the
   * field belongs to the conversation rather than being a sub-resource of it.
   * It returns the identical `{conversation, ...capabilities}` envelope that
   * GET and POST return, so the client re-renders from one shape instead of
   * learning a second one for this one write.
   *
   * `inspirationId: null` CLEARS IT, and the schema is `.nullable()` rather
   * than `.optional()` on purpose: an absent key and an explicit null would
   * otherwise be indistinguishable, and "stop talking about this" is a real
   * thing the person does. A strict body with exactly one required key means
   * an empty `{}` is a 400 — it cannot be read as either intent.
   *
   * NO REVISION BUMP. `conversations.revision` is the message count that every
   * concurrent writer compares against (`CONVERSATION_LIMITS.messages`, the
   * position bound, the reply's staleness check); moving it because the rail
   * changed would invalidate an in-flight send that is perfectly valid.
   * `updatedAt` does move, because the thread list is ordered by it and the
   * person did act on this conversation.
   *
   * NOTHING IS RE-GENERATED HERE. Switching the pick changes what the NEXT
   * reply reads; it does not rewrite replies already given, which were
   * grounded in what was pinned at the time and whose citations still prove
   * it. A conversation whose history silently re-interpreted itself when the
   * rail moved would be the world moving without the user moving it.
   */
  routes.patch('/:id',async c=>{
    const id=uuid.safeParse(c.req.param('id'));if(!id.success)return c.json({error:'Invalid conversation'},400);
    const window=messageWindow(c.req.query('from'),c.req.query('limit'));
    const input=z.object({inspirationId:uuid.nullable()}).strict().safeParse(await c.req.json().catch(()=>null));
    if(!input.success)return c.json({error:'Choose one of your saved inspirations, or null to clear it.'},400);
    const profileId=c.get('conversationProfileId');
    const row=await database().transaction(async tx=>{
      // Locked before reading for the same reason Send locks: two rails
      // clicked in two tabs must land in an order, and the one that returns
      // last must return what is actually stored.
      await tx.select({id:conversations.id}).from(conversations).where(and(eq(conversations.profileId,profileId),eq(conversations.id,id.data))).for('update');
      const current=await readConversation(tx,profileId,id.data);
      if(current.initialInspirationId===input.data.inspirationId)return windowedConversation(current,window);
      if(input.data.inspirationId)await requireOwnedInspiration(tx,profileId,input.data.inspirationId);
      await tx.update(conversations).set({initialInspirationId:input.data.inspirationId,updatedAt:new Date()})
        .where(and(eq(conversations.profileId,profileId),eq(conversations.id,id.data)));
      return windowedConversation(await readConversation(tx,profileId,id.data),window);
    });
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
    return readConversationContext(tx,profileId,conversationSearchQuery(row.messages),undefined,row.initialPrincipleId,row.initialInspirationId);
  },{isolationLevel:'repeatable read',accessMode:'read only'})));
  routes.post('/:id/messages',async c=>{
    const window=messageWindow(c.req.query('from'),c.req.query('limit'));
    const input=messageInput.safeParse(await c.req.json().catch(()=>null));if(!input.success)return c.json({error:'Write a message of up to 4,000 characters.'},400);
    const profileId=c.get('conversationProfileId'),id=c.req.param('id');
    const row=await database().transaction(async tx=>{
      await tx.select({id:conversations.id}).from(conversations).where(and(eq(conversations.profileId,profileId),eq(conversations.id,id))).for('update');
      const current=await readConversation(tx,profileId,id),existing=current.messages.find(message=>message.id===input.data.id);
      if(existing){if(existing.role!=='user'||existing.content!==input.data.content||existing.correctsMessageId!==(input.data.correctsMessageId??null))throw new ConversationError('This message id already holds different words.',409);return windowedConversation(current,window,input.data.id);}
      if(current.revision!==input.data.revision)throw new ConversationError('New messages arrived. Check the conversation before sending.',409);
      if(current.revision>=(input.data.requestReply&&conversationRepliesEnabled()?CONVERSATION_LIMITS.messages-1:CONVERSATION_LIMITS.messages))throw new ConversationError('This conversation is full. Start another one.',429);
      if(input.data.correctsMessageId&&!current.messages.some(message=>message.id===input.data.correctsMessageId&&message.role==='assistant'))throw new ConversationError('Choose a reply in this conversation to correct.',409);
      await tx.insert(conversationMessages).values({id:input.data.id,profileId,conversationId:id,position:current.revision+1,role:'user',content:input.data.content,correctsMessageId:input.data.correctsMessageId??null});
      await tx.update(conversations).set({revision:current.revision+1,updatedAt:new Date()}).where(and(eq(conversations.profileId,profileId),eq(conversations.id,id)));
      if(input.data.requestReply&&conversationRepliesEnabled())await requestConversationReplyInTransaction(tx,profileId,id,{messageId:input.data.id,afterRequestId:null});
      return windowedConversation(await readConversation(tx,profileId,id),window,input.data.id);
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
