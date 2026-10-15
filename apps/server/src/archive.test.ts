import { describe, expect, it } from 'vitest';
import { createServerApp } from './app';
import { createMemoryStore } from './store';
async function fixture() {
 const store=createMemoryStore(), app=createServerApp(store);
 const register=async (email:string)=>(await app.inject({method:'POST',url:'/api/auth/register',payload:{email,password:'test-password'}})).json();
 const owner=await register('owner@example.com'), other=await register('other@example.com');
 const headers={authorization:`Bearer ${owner.token}`}, foreign={authorization:`Bearer ${other.token}`};
 const project=(await app.inject({method:'POST',url:'/api/apps',headers,payload:{name:'Example',type:'web'}})).json().app;
 await store.ingestEvents([{eventId:'initial',appKey:project.appKey,type:'error',errorType:'js',fingerprint:'test',message:'Example',timestamp:1,platform:'web',sessionId:'s',anonymousId:'a',sdkVersion:'test',breadcrumbs:[]}]);
 return {app,store,headers,foreign,id:`${project.appKey}:test`};
}
describe('manual archive with optional note',()=>{
 it('archives an unverified issue, trims the note, persists it and remains archived after recurrence',async()=>{
  const f=await fixture();try{
   const response=await f.app.inject({method:'PATCH',url:`/api/issues/${encodeURIComponent(f.id)}/archive`,headers:f.headers,payload:{note:'  Server fixed; no App release needed  '}});
   expect(response.statusCode).toBe(200);
   expect(response.json().issue).toMatchObject({status:'archived',verifiedInRelease:null,archiveRecord:{note:'Server fixed; no App release needed'}});
   const detail=await f.store.getIssueDetail(f.id);expect(detail.issue?.archiveRecord?.note).toBe('Server fixed; no App release needed');
   await f.store.ingestEvents([{...detail.events[0],eventId:'recurrence',timestamp:2}]);
   expect((await f.store.getIssueDetail(f.id)).issue).toMatchObject({status:'archived',eventCount:2});
   const reopened=await f.app.inject({method:'PATCH',url:`/api/issues/${encodeURIComponent(f.id)}/reopen`,headers:f.headers});expect(reopened.json().issue.status).toBe('open');
  }finally{await f.app.close();}
 });
 it('accepts an empty optional note and keeps the first record on a duplicate request',async()=>{
  const f=await fixture();try{
   const first=await f.app.inject({method:'PATCH',url:`/api/issues/${encodeURIComponent(f.id)}/archive`,headers:f.headers});expect(first.statusCode).toBe(200);
   const second=await f.app.inject({method:'PATCH',url:`/api/issues/${encodeURIComponent(f.id)}/archive`,headers:f.headers,payload:{note:'duplicate'}});
   expect(second.json().issue.archiveRecord).toEqual(first.json().issue.archiveRecord);
  }finally{await f.app.close();}
 });
 it('requires authentication and ownership for archive and reopen',async()=>{
  const f=await fixture();try{
   for(const action of ['archive','reopen']){
    const url=`/api/issues/${encodeURIComponent(f.id)}/${action}`;
    expect((await f.app.inject({method:'PATCH',url})).statusCode).toBe(401);
    expect((await f.app.inject({method:'PATCH',url,headers:f.foreign})).statusCode).toBe(404);
   }
   expect((await f.store.getIssueDetail(f.id)).issue?.status).toBe('open');
  }finally{await f.app.close();}
 });
 it.each([{note:3},{note:'x'.repeat(4001)},{unknown:true}])('rejects invalid archive payloads',async payload=>{
  const f=await fixture();try{expect((await f.app.inject({method:'PATCH',url:`/api/issues/${encodeURIComponent(f.id)}/archive`,headers:f.headers,payload})).statusCode).toBe(400);}finally{await f.app.close();}
 });
});
