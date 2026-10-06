/** A loopback-only gateway to the actual deployed dev app.
 * Its in-memory synthetic session cannot access a user's browser cookies.
 * stdin commands inject one request fault or print numeric request evidence.
 * SIGTERM/`cleanup` erases only the account this process created.
 * No database credentials, provider overrides or browser automation. */
import http from 'node:http';
import {randomUUID,randomBytes} from 'node:crypto';
import {createInterface} from 'node:readline';

const upstream='https://dev.waka.im';
const port=3018;
const email=`validation-${randomUUID()}@example.test`;
const password=randomBytes(24).toString('base64url');
let token,accountId,profileId,server,cleaning=false;
let fault=null;
const requests=[];
const report=value=>process.stdout.write(JSON.stringify(value)+'\n');
const sanitize=path=>path.replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi,':id');

async function api(path,{method='GET',body,headers={}}={}){
  const response=await fetch(upstream+path,{method,redirect:'error',signal:AbortSignal.timeout(30000),
    headers:{Origin:upstream,...(token?{Authorization:`Bearer ${token}`} :{}),
      ...(body?{'Content-Type':'application/json'}:{}),...headers},
    ...(body?{body:JSON.stringify(body)}:{})});
  const data=await response.json();
  if(!response.ok)throw new Error(`Dev ${method} ${sanitize(path)} returned ${response.status}`);
  return data;
}

async function cleanup(){
  if(cleaning)return;
  cleaning=true;
  try{
    if(token&&accountId){
      const identity=await api('/api/auth/me');
      if(identity.account.id!==accountId||identity.profile.id!==profileId||identity.account.email!==email)
        throw new Error('Cleanup identity mismatch');
      await api('/api/auth/me',{method:'DELETE',body:{confirmation:'DELETE'}});
      const check=await fetch(upstream+'/api/auth/me',{headers:{Authorization:`Bearer ${token}`},signal:AbortSignal.timeout(15000)});
      if(check.status!==401)throw new Error('Erasure did not revoke the synthetic session');
      report({cleanup:'synthetic account erased and session refused'});
    }
    server?.closeAllConnections();server?.close();process.exit(0);
  }catch(error){
    cleaning=false;
    report({cleanup:'failed',reason:error.message,syntheticAccountId:accountId});
  }
}

// Bind before creating an account: an occupied port cannot leave test data.
server=http.createServer(async(req,res)=>{
  if(req.headers.host!==`127.0.0.1:${port}`&&req.headers.host!==`localhost:${port}`){res.writeHead(421).end();return;}
  if(!token){res.writeHead(503).end('Validation session is starting');return;}
  const started=performance.now();
  try{
    const url=new URL(req.url,upstream);
    if(url.origin!==upstream){res.writeHead(400).end();return;}
    const isApi=url.pathname.startsWith('/api/');
    const injected=isApi&&fault&&req.method===fault.method&&url.pathname===fault.path?fault:null;
    if(injected)fault=null;
    if(injected?.delayMs)await new Promise(resolve=>setTimeout(resolve,injected.delayMs));
    if(injected?.kind==='before'){
      res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'}).end('{"error":"Synthetic request interruption"}');
      requests.push({method:req.method,path:sanitize(url.pathname),status:503,ms:Math.round(performance.now()-started),fault:'before'});return;
    }
    const chunks=[];let size=0;
    for await(const chunk of req){size+=chunk.length;if(size>1024*1024)throw new Error('Validation request exceeded size bound');chunks.push(chunk);}
    const headers=new Headers();
    for(const name of ['content-type','idempotency-key','accept','if-match'])if(req.headers[name])headers.set(name,req.headers[name]);
    if(isApi){headers.set('Authorization',`Bearer ${token}`);headers.set('Origin',upstream);}
    const response=await fetch(url,{method:req.method,headers,redirect:'manual',signal:AbortSignal.timeout(45000),
      ...(chunks.length?{body:Buffer.concat(chunks)}:{})});
    const body=Buffer.from(await response.arrayBuffer());
    if(isApi)requests.push({method:req.method,path:sanitize(url.pathname),status:response.status,ms:Math.round(performance.now()-started),...(injected?{fault:injected.kind}:{})});
    if(injected?.kind==='after'){
      res.writeHead(503,{'Content-Type':'application/json','Cache-Control':'no-store'}).end('{"error":"Synthetic lost response after commit"}');return;
    }
    const outgoing={'Cache-Control':'no-store'};
    for(const name of ['content-type','content-disposition'])if(response.headers.has(name))outgoing[name]=response.headers.get(name);
    const location=response.headers.get('location');
    if(location){const target=new URL(location,upstream);outgoing.Location=target.origin===upstream?target.pathname+target.search:target.href;}
    // Cookies stay in memory on the gateway, never in the user's browser.
    res.writeHead(response.status,outgoing).end(body);
  }catch(error){
    report({requestFailure:'upstream or gateway request failed'});
    if(!res.headersSent)res.writeHead(502,{'Content-Type':'application/json'}).end('{"error":"Validation gateway request failed"}');
    else res.end();
  }
});
await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'127.0.0.1',resolve);});
try{
  const session=await api('/api/auth/signup',{method:'POST',body:{email,password,name:'Validation Tester'}});
  token=session.token;accountId=session.account?.id;profileId=session.profile?.id;
  if(!token||!accountId||!profileId)throw new Error('Synthetic signup response incomplete');
  const identity=await api('/api/auth/me');
  if(identity.account.id!==accountId||identity.profile.id!==profileId)throw new Error('Synthetic account binding mismatch');
  report({ready:`http://127.0.0.1:${port}/`,upstream,syntheticAccountId:accountId,profileId});
}catch(error){report({startup:'failed',reason:error.message});await cleanup();}

process.on('SIGTERM',()=>void cleanup());process.on('SIGINT',()=>void cleanup());
const lines=createInterface({input:process.stdin});
lines.on('line',line=>{void(async()=>{
  try{
    const command=JSON.parse(line);
    if(command.action==='stats')report({requests});
    else if(command.action==='fault'){
      if(!['GET','POST'].includes(command.method)||!['before','after','delay'].includes(command.kind)||
        !/^\/api\/[a-z0-9\/-]+$/.test(command.path)||!Number.isInteger(command.delayMs??0)||
        (command.delayMs??0)<0||(command.delayMs??0)>20000)throw new Error('Invalid one-shot fault');
      fault={method:command.method,path:command.path,kind:command.kind,delayMs:command.delayMs??0};report({fault:'armed',...fault});
    }else if(command.action==='read'){
      if(!['/api/auth/me','/api/inspirations','/api/top-of-mind','/api/principles','/api/signals','/api/export','/api/review-sessions/active'].includes(command.path))throw new Error('Read path refused');
      const data=await api(command.path);
      // Only the synthetic account can reach this private diagnostic output.
      report({path:command.path,data});
    }else if(command.action==='cleanup')await cleanup();
    else throw new Error('Unknown validation command');
  }catch(error){report({command:'failed',reason:error.message});}
})();});
