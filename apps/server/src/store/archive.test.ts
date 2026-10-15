import { describe, expect, it } from 'vitest';
import { PGlite } from '@electric-sql/pglite';
import { createMemoryStore, createPostgresStore } from './index';
for(const mode of ['memory','postgres']) describe(mode+' archive records',()=>{
 it('saves notes atomically, survives restart and keeps manual archives through incoming events',async()=>{
  const db=mode==='postgres'?new PGlite():null;
  const query=async(sql:string,params:unknown[]=[])=>{if(!params.length){const rows=await db!.exec(sql),r=rows[rows.length-1];return {rows:r?.rows??[],rowCount:r?.affectedRows??0};}const r=await db!.query(sql,params);return {rows:r.rows,rowCount:r.affectedRows};};
  const pool={query,connect:async()=>({query,release(){}})};
  try{
   let store=db?await createPostgresStore({pool:pool as never}):createMemoryStore();
   if(db){await db.exec('ALTER TABLE issues DROP COLUMN IF EXISTS archive_record');store=await createPostgresStore({pool:pool as never});}
   const event={eventId:'one',appKey:'example',type:'error' as const,errorType:'js' as const,fingerprint:'a',message:'Example',timestamp:1,platform:'web' as const,sessionId:'s',anonymousId:'a',sdkVersion:'test',breadcrumbs:[]};
   await store.ingestEvents([event]);
   expect(await store.archiveIssue('example:a',100,'Server fixed')).toMatchObject({status:'archived',archiveRecord:{note:'Server fixed',archivedAt:100}});
   if(db)store=await createPostgresStore({pool:pool as never});
   expect((await store.getIssueDetail('example:a')).issue?.archiveRecord).toEqual({note:'Server fixed',archivedAt:100});
   await store.ingestEvents([{...event,eventId:'two',timestamp:2}]);
   expect((await store.getIssueDetail('example:a')).issue).toMatchObject({status:'archived',archivedAt:100,eventCount:2});
   await store.reopenIssue('example:a');
   expect((await store.getIssueDetail('example:a')).issue).toMatchObject({status:'open',archiveRecord:{note:'Server fixed'}});
  }finally{await db?.close();}
 },30000);
});
