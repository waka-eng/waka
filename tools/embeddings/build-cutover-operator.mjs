/** Offline C1 build. Records exact inputs; never loads env or contacts a DB. */
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url)),req=createRequire(new URL('../../packages/api/package.json',import.meta.url));
const {build}=req('esbuild'),output=resolve(process.argv[2]??''),hash=v=>createHash('sha256').update(v).digest('hex');
if(!process.argv[2]||!output.startsWith('/tmp/waka-embedding-2-20261115/c1-implementation-r0/'))throw Error('Explicit owned preparation directory required');
const result=await build({entryPoints:[resolve(root,'tools/embeddings/cutover-index.ts')],bundle:true,write:false,platform:'node',format:'esm',target:'node20',metafile:true,absWorkingDir:root,
 banner:{js:"import {createRequire as __cutoverCreateRequire} from 'node:module';const require=__cutoverCreateRequire(import.meta.url);"},alias:{postgres:req.resolve('postgres'),'drizzle-orm/postgres-js':req.resolve('drizzle-orm/postgres-js'),zod:req.resolve('zod')}});
const inputs=[];
for(const path of Object.keys(result.metafile.inputs)){
 const absolute=resolve(root,path);
 if(!absolute.startsWith(root)||/(^|\/)\.env(?:\.|$)/.test(path)||/node_modules\/.pnpm\/(?:@aws-sdk|@smithy|openai)/.test(path)||/packages\/api\/src\/(?:queue|app|handlers)\.ts/.test(path)||/packages\/api\/src\/lib\/(?:.*-http|openrouter.*|model-(?:provider|usage)|db|queue|background-job.*|embedding-indexer)\.ts/.test(path))throw Error('Unexpected provider, queue or private build input');
 const bytes=await readFile(absolute);inputs.push({path:relative(root,absolute),sha256:hash(bytes),bytes:bytes.length});
}
await mkdir(output,{recursive:true,mode:0o700});const body=result.outputFiles[0].contents,sha=hash(body),head=execFileSync('git',['-C',root,'rev-parse','HEAD'],{encoding:'utf8'}).trim();
await writeFile(resolve(output,'cutover-index-'+sha+'.mjs'),body,{mode:0o600,flag:'wx'});
await writeFile(resolve(output,'build-inputs-'+sha+'.json'),JSON.stringify({sourceHead:head,sourceWorktreeDirty:Boolean(execFileSync('git',['-C',root,'status','--porcelain'],{encoding:'utf8'}).trim()),bundleSha256:sha,bytes:body.length,inputs,providerOrQueueRuntimeInputs:0},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({bundleSha256:sha,bytes:body.length,inputCount:inputs.length,providerOrQueueRuntimeInputs:0,executed:false}));
