/** Publish a completed private inode without replacing any existing path. */
import {open,link,unlink} from 'node:fs/promises';
export async function publishCoverageMetadata(base:string,body:string){
 if(Buffer.byteLength(body)>16384)throw Error('coverage_private_size');
 const pending=base+'.pending';let created=false;
 try{
  const file=await open(pending,'wx',0o600);created=true;
  try{await file.chmod(0o600);await file.writeFile(body);await file.sync();}finally{await file.close();}
  await link(pending,base+'.private.json');
 }finally{if(created)await unlink(pending);}
}
