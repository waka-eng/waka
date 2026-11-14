/** WHAT THIS MOCKS, AND WHY: a callable postgres client records forwarding and
 * native Query identity only. Real SQL/protocol/rollback is covered separately. */
import {expect,it,vi} from 'vitest';
import {developmentPreparedQueries,preparedPostgresClient} from './postgres-transport.js';
function fixture(){
 const query={values:vi.fn(),raw:vi.fn(),cancel:vi.fn()},calls:unknown[][]=[];
 const make=()=>Object.assign(vi.fn((..._args:unknown[])=>query),{unsafe:vi.fn((...args:unknown[])=>{calls.push(args);return query;}),release:vi.fn()});
 const nested=make(),reserved=make();
 const tx=Object.assign(make(),{savepoint:vi.fn((...args:unknown[])=>{const fn=args.at(-1) as (db:unknown)=>unknown;return fn(nested);})});
 const root=Object.assign(make(),{options:{prepare:true},begin:vi.fn((...args:unknown[])=>{const fn=args.at(-1) as (db:unknown)=>unknown;return fn(tx);}),reserve:vi.fn(async()=>reserved)});
 return{root,tx,nested,reserved,query,calls};
}
it('opts bound unsafe into the prepared root without altering text/parameters or native Query methods',()=>{
 const f=fixture(),db=preparedPostgresClient(f.root),params=["x'); DROP TABLE private; --",null,123n],text='SELECT $1, $2, $3';
 expect(db.unsafe(text,params)).toBe(f.query);expect(f.calls[0][0]).toBe(text);expect(f.calls[0][1]).toBe(params);expect(f.calls[0][2]).toEqual({prepare:true});
 expect(db.unsafe).toBe(db.unsafe);expect(db`SELECT ${1}`).toBe(f.query);
 db.unsafe(text,params,{prepare:false});expect(f.calls[1][2]).toEqual({prepare:false});
 db.unsafe(text,params,{prepare:undefined});expect(f.calls[2][2]).toEqual({prepare:undefined});
 db.unsafe('SELECT 1',[]);expect(f.calls[3]).toEqual(['SELECT 1',[]]);
 const inherited=Object.create({prepare:false});db.unsafe(text,params,inherited);expect(f.calls[4][2]).toBe(inherited);
 const inheritedUndefined=Object.create({prepare:undefined});db.unsafe(text,params,inheritedUndefined);expect(f.calls[5][2]).toBe(inheritedUndefined);
 expect(()=>preparedPostgresClient({...f.root,options:{prepare:false}})).toThrow('prepared root');
});
it('propagates begin overloads, savepoints and reserve without replacing callbacks/results or adding retries',async()=>{
 const f=fixture(),db=preparedPostgresClient(f.root),params=[1];
 expect(db.begin((tx:typeof f.tx)=>tx.unsafe('SELECT $1',params))).toBe(f.query);
 expect(db.begin('read only',(tx:typeof f.tx)=>tx.savepoint('inner',(inner:typeof f.nested)=>inner.unsafe('SELECT $1',params)))).toBe(f.query);
 expect(f.root.begin.mock.calls[1][0]).toBe('read only');expect(f.tx.savepoint.mock.calls[0][0]).toBe('inner');
 const held=await db.reserve();expect(held.unsafe('SELECT $1',params)).toBe(f.query);held.release();expect(f.reserved.release).toHaveBeenCalledOnce();
 for(const args of f.calls)expect(args[2]).toEqual({prepare:true});
 const failure=new Error('ambiguous');f.root.unsafe.mockImplementationOnce(()=>{throw failure;});expect(()=>db.unsafe('INSERT INTO t VALUES($1)',params)).toThrow(failure);expect(f.root.unsafe).toHaveBeenCalledTimes(1);
});
it('keeps production/default/local off and refuses accidental or unknown activation',()=>{
 expect(developmentPreparedQueries({})).toBe(false);expect(developmentPreparedQueries({WAKA_STAGE:'production'})).toBe(false);
 expect(developmentPreparedQueries({WAKA_STAGE:'development',WAKA_DB_PREPARED_QUERIES:'1'})).toBe(true);
 expect(developmentPreparedQueries({WAKA_STAGE:'dev',WAKA_DB_PREPARED_QUERIES:'1'})).toBe(true);
 for(const stage of ['production','local','test','other',''])expect(()=>developmentPreparedQueries({WAKA_STAGE:stage,WAKA_DB_PREPARED_QUERIES:'1'})).toThrow();
 expect(()=>developmentPreparedQueries({WAKA_STAGE:'development',WAKA_DB_PREPARED_QUERIES:'true'})).toThrow();
 expect(developmentPreparedQueries({WAKA_STAGE:'production',WAKA_DB_PREPARED_QUERIES:'0'})).toBe(false);
});
