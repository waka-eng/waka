/** Real postgres-js against the suite's migrated disposable schema. The only
 * transport stand-in is a local TCP proxy which drops a successful COMMIT's
 * acknowledgement; it forwards real PostgreSQL bytes and adds no query retry. */
import {afterAll,beforeAll,expect,it} from 'vitest';
import postgres,{type Sql} from 'postgres';
import net from 'node:net';
import {once} from 'node:events';
import {createTestDatabase,type TestDatabase} from '../../test/helpers/db';
import {preparedPostgresClient} from './postgres-transport';
import {requiredTlsMode} from './db';
let fixture:TestDatabase,uri:string;
const clients:Sql[]=[];
function client(url=uri,debug?:NonNullable<Parameters<typeof postgres>[1]>['debug']){
 const raw=postgres(url,{max:1,prepare:true,ssl:requiredTlsMode(url),onnotice:()=>{},debug});clients.push(raw);return preparedPostgresClient(raw);
}
beforeAll(async()=>{
 fixture=await createTestDatabase();const scoped=new URL(process.env.DB_CONNECTION_URL!);scoped.searchParams.set('options','-c search_path='+fixture.schemaName);uri=scoped.toString();
 await fixture.sql.unsafe('CREATE TABLE transport_rows(id integer PRIMARY KEY, value text NOT NULL)');
});
afterAll(async()=>{await Promise.all(clients.map(c=>c.end({timeout:1})));await fixture?.cleanup();});
it('retains native Query methods, bound values and PostgreSQL return types on a pool of one',async()=>{
 const db=client(),text="x'); DROP TABLE transport_rows; --",id='00000000-0000-4000-8000-000000000001',at=new Date('2026-11-13T12:00:00Z');
 const query=db.unsafe('SELECT $1::uuid AS id,$2::timestamptz AS at,$3::bigint AS large,$4::jsonb AS data,$5::text AS empty,$6::text AS text',[id,at.toISOString(),'9007199254740993',db.json({ok:true}),null,text]);
 expect(typeof query.values).toBe('function');expect(typeof query.raw).toBe('function');expect(typeof query.cancel).toBe('function');expect(typeof query.execute).toBe('function');
 const [row]=await query;expect(row).toEqual({id,at,large:'9007199254740993',data:{ok:true},empty:null,text});
 expect(await db.unsafe('SELECT $1::integer AS n',[7]).values()).toEqual([[7]]);
 const raw=await db.unsafe('SELECT $1::text AS n',['raw']).raw();expect(Buffer.isBuffer(raw[0][0])).toBe(true);expect(raw[0][0].toString()).toBe('raw');
 expect((await db.unsafe('SELECT $1::integer AS n',[8]).execute())[0].n).toBe(8);
 expect((await db.unsafe('SELECT $1::integer AS n',[9],{prepare:false}))[0].n).toBe(9);
});
it('opts the actual native bound Query into caching while respecting explicit and inherited opt-outs',async()=>{
 const db=client(),text='SELECT $1::integer AS cache_probe';
 const first=db.unsafe(text,[1]);await first;
 const repeated=db.unsafe(text,[2]);expect((await repeated)[0].cache_probe).toBe(2);
 expect(first).toMatchObject({prepare:true,prepared:false});expect(repeated).toMatchObject({prepare:true,prepared:true});
 for(const [options,expected] of [[{prepare:false},false],[Object.create({prepare:false}),false],[{prepare:undefined},undefined]] as const){
  const unprepared=db.unsafe(text,[3],options);expect((await unprepared)[0].cache_probe).toBe(3);expect(unprepared).toMatchObject({prepared:expected});
 }
});
it('preserves begin overloads, array returns, savepoint rollback and reserved-client release',async()=>{
 const db=client();
 expect(await db.begin('read only',tx=>[tx.unsafe('SELECT $1::integer AS n',[1]),tx.unsafe('SELECT $1::integer AS n',[2])])).toMatchObject([[{n:1}],[{n:2}]]);
 await db.begin(async tx=>{
  await tx.unsafe('INSERT INTO transport_rows(id,value) VALUES($1,$2)',[1,'committed']);
  await expect(tx.savepoint('discard',async inner=>{await inner.unsafe('INSERT INTO transport_rows(id,value) VALUES($1,$2)',[2,'discarded']);throw Error('rollback fixture');})).rejects.toThrow('rollback fixture');
  expect((await tx.unsafe('SELECT count(*)::integer AS n FROM transport_rows'))[0].n).toBe(1);
 });
 await expect(db.begin(async tx=>{await tx.unsafe('INSERT INTO transport_rows(id,value) VALUES($1,$2)',[3,'discarded']);throw Error('outer rollback');})).rejects.toThrow('outer rollback');
 const held=await db.reserve();try{expect((await held.unsafe('SELECT $1::integer AS n',[4]))[0].n).toBe(4);}finally{held.release();}
 expect((await db.unsafe('SELECT array_agg(id ORDER BY id) AS ids FROM transport_rows'))[0].ids).toEqual([1]);
});
it('keeps native cancellation effective and permits later work without replaying the cancelled query',async()=>{
 const db=client();const [{pid}]=await db.unsafe('SELECT pg_backend_pid() AS pid');
 const query=db.unsafe('SELECT pg_sleep($1::double precision)',[10]);const pending=query.execute();
 // Wait on actual server execution, not an arbitrary delay before cancellation.
 const deadline=Date.now()+4000;let sleeping=false;
 while(!sleeping&&Date.now()<deadline){const [state]=await fixture.sql`SELECT wait_event FROM pg_stat_activity WHERE pid=${pid}`;sleeping=state?.wait_event==='PgSleep';if(!sleeping)await new Promise(r=>setTimeout(r,10));}
 expect(sleeping).toBe(true);await query.cancel();await expect(pending).rejects.toMatchObject({code:'57014'});
 expect((await db.unsafe('SELECT $1::integer AS n',[5]))[0].n).toBe(5);
});
it('does not replay a durable write when the COMMIT acknowledgement is lost',async()=>{
 // This fault fixture is deliberately local-only even when other DB suites have
 // an explicitly authorized remote target. No TLS proxy/certificate weakening.
 const target=new URL(uri);if(!['127.0.0.1','localhost'].includes(target.hostname))throw Error('Commit fault fixture requires disposable loopback');
 let armed=false,dropped=false,insertAttempts=0;const sockets=new Set<net.Socket>();
 const server=net.createServer(front=>{
  const back=net.connect({host:target.hostname,port:Number(target.port||5432)});sockets.add(front);sockets.add(back);let buffer=Buffer.alloc(0);
  front.on('data',chunk=>back.write(chunk));back.on('data',chunk=>{
   buffer=Buffer.concat([buffer,chunk]);while(buffer.length>=5){const size=1+buffer.readInt32BE(1);if(buffer.length<size)return;const packet=buffer.subarray(0,size);buffer=buffer.subarray(size);
    if(armed&&packet[0]===67&&packet.subarray(5).toString()==='COMMIT\0'){dropped=true;front.destroy();back.destroy();return;}front.write(packet);
   }
  });
  for(const socket of [front,back]){socket.on('error',()=>{front.destroy();back.destroy();});socket.on('close',()=>{sockets.delete(socket);front.destroy();back.destroy();});}
 });
 server.listen(0,'127.0.0.1');await once(server,'listening');const proxy=new URL(uri);proxy.hostname='127.0.0.1';proxy.port=String((server.address() as net.AddressInfo).port);
 const db=client(proxy.toString(),(_connection,text)=>{if(text.startsWith('INSERT INTO transport_rows'))insertAttempts++;});
 try{
  await expect(db.begin(async tx=>{await tx.unsafe('INSERT INTO transport_rows(id,value) VALUES($1,$2)',[99,'durable before uncertain ack']);armed=true;})).rejects.toMatchObject({code:'CONNECTION_CLOSED'});
  expect(dropped).toBe(true);expect(insertAttempts).toBe(1);
  const rows=await fixture.sql.unsafe('SELECT value FROM transport_rows WHERE id=$1',[99]);expect(rows).toHaveLength(1);expect(rows[0].value).toBe('durable before uncertain ack');
 }finally{await db.end({timeout:1});for(const socket of sockets)socket.destroy();await new Promise<void>(r=>server.close(()=>r()));}
});
