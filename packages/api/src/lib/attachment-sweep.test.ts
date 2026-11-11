import { createServer } from 'node:http';
import { afterEach, expect, it, vi } from 'vitest';
import { deleteAttachmentObjectBatch } from './attachment-sweep.js';
afterEach(()=>vi.unstubAllEnvs());
it('parses real S3 HTTP-200 per-object errors instead of acknowledging the batch', async()=>{
  const server=createServer((_req,res)=>{res.writeHead(200,{'content-type':'application/xml'});res.end('<DeleteResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Error><Key>bad</Key><Code>AccessDenied</Code><Message>synthetic</Message></Error></DeleteResult>');});
  await new Promise<void>(r=>server.listen(0,'127.0.0.1',r));
  const address=server.address();if(!address||typeof address==='string')throw Error('listener');
  vi.stubEnv('ATTACHMENTS_ENDPOINT',`http://127.0.0.1:${address.port}`);vi.stubEnv('ATTACHMENTS_BUCKET','synthetic');
  try{expect(await deleteAttachmentObjectBatch(['good','bad'])).toEqual(['bad']);}
  finally{await new Promise<void>((resolve,reject)=>server.close(error=>error?reject(error):resolve()));}
});
