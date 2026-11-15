/** Offline build only. No env files, provider calls or database connections. */
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {resolve,relative} from 'node:path';
import {createHash} from 'node:crypto';
const root=fileURLToPath(new URL('../../',import.meta.url)),req=createRequire(new URL('../../packages/api/package.json',import.meta.url));
const {build}=req('esbuild'),output=resolve(process.argv[2]??'');
if(!process.argv[2]||!output.startsWith('/tmp/waka-embedding-2-20261114/'))throw Error('An explicit owned preparation directory is required');
const result=await build({entryPoints:[resolve(root,'tools/embeddings/shadow-index.ts')],bundle:true,write:false,platform:'node',format:'esm',target:'node20',metafile:true,banner:{js:"import {createRequire as __operatorCreateRequire} from 'node:module';const require=__operatorCreateRequire(import.meta.url);"},alias:{postgres:req.resolve('postgres'),'drizzle-orm/postgres-js':req.resolve('drizzle-orm/postgres-js'),zod:req.resolve('zod')}});
await mkdir(output,{recursive:true});const body=result.outputFiles[0].contents,sha=createHash('sha256').update(body).digest('hex');
const inputs=[];for(const path of Object.keys(result.metafile.inputs)){const absolute=resolve(path);if(/(^|\/)\.env(?:\.|$)/.test(path)||!absolute.startsWith(root))throw Error('Unexpected build input');const bytes=await readFile(absolute);inputs.push({path:relative(root,absolute),sha256:createHash('sha256').update(bytes).digest('hex'),bytes:bytes.length});}
await writeFile(resolve(output,'shadow-index-'+sha+'.mjs'),body,{mode:0o600,flag:'wx'});await writeFile(resolve(output,'build-inputs-'+sha+'.json'),JSON.stringify({bundleSha256:sha,bytes:body.length,inputs},null,2)+'\n',{mode:0o600,flag:'wx'});
console.log(JSON.stringify({bundleSha256:sha,bytes:body.length,inputCount:inputs.length,outputDirectory:output,executed:false}));
