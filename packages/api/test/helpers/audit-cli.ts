/** Execute the real entrypoints with local executable stand-ins. No inherited
 * credentials/network clients; every AWS/PNPM response is an explicit fixture. */
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {resolve,dirname,delimiter} from 'node:path';
import {spawnSync} from 'node:child_process';
type Response={json?:unknown;stdout?:string;stderr?:string;status?:number};
export function executeAuditCli(script:string,options:{outputs?:unknown;outputsText?:string;missingOutputs?:boolean;responses?:Record<string,Response>;fallback?:Response;env?:Record<string,string>;preview?:{exit:number;events:string;stdout?:string;stderr?:string};artifactDirectory?:boolean}={}){
 const dir=mkdtempSync(resolve(tmpdir(),'waka-audit-cli-'));
 try{
  mkdirSync(resolve(dir,'.sst'));mkdirSync(resolve(dir,'bin'));
  if(!options.missingOutputs)writeFileSync(resolve(dir,'.sst/outputs.json'),options.outputsText??JSON.stringify(options.outputs??{}));
  writeFileSync(resolve(dir,'fixture.json'),JSON.stringify(options));
  const stub=`#!${process.execPath}
const fs=require('node:fs'),path=require('node:path'),c=JSON.parse(fs.readFileSync(process.env.FIXTURE_PATH,'utf8')),args=process.argv.slice(2);
if(path.basename(process.argv[1])==='pnpm'){
 if(args[1]==='version'){process.stdout.write('sst 3.19.3');process.exit(0);}
 if(!c.preview)process.exit(90);
 fs.mkdirSync('.sst/pulumi/fixture',{recursive:true});fs.writeFileSync('.sst/pulumi/fixture/eventlog.json',c.preview.events);
 process.stdout.write(c.preview.stdout||'');process.stderr.write(c.preview.stderr||'');process.exit(c.preview.exit);
}
const key=JSON.stringify(args.slice(0,-4)),r=c.responses?.[key]??c.fallback??{status:91,stderr:'Unexpected fixture command'};
process.stdout.write(r.stdout??(Object.hasOwn(r,'json')?JSON.stringify(r.json):''));process.stderr.write(r.stderr??'');process.exit(r.status??0);
`;
  for(const command of ['aws','pnpm'])writeFileSync(resolve(dir,'bin',command),stub,{mode:0o700});
  if(options.artifactDirectory)mkdirSync(resolve(dir,'production-monitoring-before.json'));
  const result=spawnSync(process.execPath,[resolve(__dirname,'../../../../scripts',script)],{
   cwd:dir,encoding:'utf8',timeout:8000,maxBuffer:2_000_000,
   env:{PATH:resolve(dir,'bin')+delimiter+dirname(process.execPath),HOME:dir,NODE_NO_WARNINGS:'1',FIXTURE_PATH:resolve(dir,'fixture.json'),...options.env},
  });
  if(result.error)throw Error('Audit CLI fixture failed to finish');
  const artifacts:Record<string,any>={};
  for(const name of ['production-monitoring-before.json','production-preview.json']){
   const path=resolve(dir,name);if(existsSync(path)&&!options.artifactDirectory)artifacts[name]=JSON.parse(readFileSync(path,'utf8'));
  }
  return {status:result.status,stdout:result.stdout,stderr:result.stderr,artifacts};
 }finally{rmSync(dir,{recursive:true,force:true});}
}
