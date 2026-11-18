import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROD_SUPABASE_URL, createStatsHandler, pragueDayWindow, pragueToday,
  secretMatches, validDay
} from '../supabase/functions/office-platform-stats/core.mjs';

const token = 'a'.repeat(64);
function fixture({secret=token,dbUrl=PROD_SUPABASE_URL,fail=null,counts=[30,2,11,1],clock='2026-11-18T11:00:00Z'}={}) {
  const calls=[];
  let initialized=0;
  const getEnv=name=>({RENTULO_OFFICE_STATS_SECRET:secret,SUPABASE_URL:dbUrl})[name];
  const handler=createStatsHandler({getEnv,now:()=>new Date(clock),createCounter:()=>{
    initialized++;
    return async (table,start,end)=>{
      calls.push({table,start,end});
      if(fail===table || fail==='all') throw Error('Sensitive SQL failure');
      return counts[calls.length-1];
    };
  }});
  const request=(path='?day=2026-11-18',supplied=token,method='GET')=>new Request(
    `https://prod.supabase.co/functions/v1/office-platform-stats${path}`,
    {method,headers:{'x-rentulo-office-stats-secret':supplied}}
  );
  return {handler,request,calls,initialized:()=>initialized};
}

test('requires a correctly shaped 256-bit token without accepting prefixes',()=>{
  assert.equal(secretMatches(token,token),true);
  for(const candidate of ['',token.slice(0,-1),token+'b','b'+token.slice(1),'A'.repeat(64),'xyz']) {
    assert.equal(secretMatches(candidate,token),false);
  }
  assert.equal(secretMatches(token,'short'),false);
});

test('rejects unauthorized calls before any database initialization',async()=>{
  const fx=fixture();
  for(const bad of ['',token.slice(0,-1),'f'.repeat(64)]) {
    const response=await fx.handler(fx.request('',bad));
    assert.equal(response.status,401);
    assert.deepEqual(await response.json(),{error:'unauthorized'});
    assert.match(response.headers.get('cache-control'),/no-store/);
    assert.equal(response.headers.get('access-control-allow-origin'),null);
  }
  assert.equal(fx.initialized(),0);
  assert.equal(fx.calls.length,0);
});

test('missing secret, wrong environment and wrong HTTP method fail closed',async()=>{
  const none=fixture({secret:null});
  assert.equal((await none.handler(none.request())).status,503);
  assert.equal(none.initialized(),0);
  const missing=fixture({secret:'invalid'});
  assert.equal((await missing.handler(missing.request())).status,503);
  assert.equal(missing.initialized(),0);
  const testEnv=fixture({dbUrl:'https://vspposovhdgvbeukoivh.supabase.co'});
  assert.equal((await testEnv.handler(testEnv.request())).status,503);
  assert.equal(testEnv.initialized(),0);
  const wrongMethod=fixture();
  const res=await wrongMethod.handler(wrongMethod.request('',token,'POST'));
  assert.equal(res.status,405);
  assert.equal(res.headers.get('allow'),'GET');
  assert.equal(wrongMethod.initialized(),0);
});

test('date validation excludes nonexistent dates and unsupported query parameters',async()=>{
  assert.equal(validDay('2026-02-29'),false);
  assert.equal(validDay('2024-02-29'),true);
  assert.equal(validDay('2026-11-18'),true);
  assert.equal(validDay('2026-13-01'),false);
  assert.equal(validDay('2026-11-18Z'),false);
  const fx=fixture();
  for(const path of ['?day=2026-02-29','?day=x','?day=2026-11-18&day=2026-11-17',
    '?other=1','?day=2026-11-18&extra=1']) {
    assert.equal((await fx.handler(fx.request(path))).status,400,path);
  }
  assert.equal(fx.initialized(),0);
});

test('Prague day filter includes correct daylight-saving time windows',()=>{
  assert.deepEqual(pragueDayWindow('2026-03-29'),{
    start:'2026-03-28T23:00:00.000Z',end:'2026-03-29T22:00:00.000Z'});
  assert.deepEqual(pragueDayWindow('2026-10-25'),{
    start:'2026-10-24T22:00:00.000Z',end:'2026-10-25T23:00:00.000Z'});
  assert.deepEqual(pragueDayWindow('2026-11-18'),{
    start:'2026-11-17T23:00:00.000Z',end:'2026-11-18T23:00:00.000Z'});
  assert.equal(pragueToday(new Date('2026-11-17T23:30:00Z')),'2026-11-18');
});

test('authorized counts return exactly four aggregate numbers without row details',async()=>{
  const fx=fixture();
  const response=await fx.handler(fx.request());
  assert.equal(response.status,200);
  assert.deepEqual(await response.json(),{
    source:'rentulo-prod',day:'2026-11-18',timezone:'Europe/Prague',
    offers:{total:30,day:2},reservations:{total:11,day:1}
  });
  assert.deepEqual(fx.calls,[
    {table:'offers',start:null,end:null},
    {table:'offers',start:'2026-11-17T23:00:00.000Z',end:'2026-11-18T23:00:00.000Z'},
    {table:'reservations',start:null,end:null},
    {table:'reservations',start:'2026-11-17T23:00:00.000Z',end:'2026-11-18T23:00:00.000Z'}
  ]);
  assert.equal(fx.initialized(),1);
});

test('without a day parameter it uses the current day in Europe/Prague',async()=>{
  const fx=fixture({clock:'2026-11-17T23:30:00Z'});
  const response=await fx.handler(fx.request(''));
  assert.equal(response.status,200);
  assert.equal((await response.json()).day,'2026-11-18');
});

test('database errors and invalid counts never return partial or invented totals',async()=>{
  const dbError=fixture({fail:'reservations'});
  const res=await dbError.handler(dbError.request());
  assert.equal(res.status,503);
  assert.deepEqual(await res.json(),{error:'unavailable'});
  const invalidCount=fixture({counts:[2,1,null,0]});
  const second=await invalidCount.handler(invalidCount.request());
  assert.equal(second.status,503);
  assert.deepEqual(await second.json(),{error:'unavailable'});
});
