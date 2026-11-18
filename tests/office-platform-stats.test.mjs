import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PROD_SUPABASE_URL, createStatsHandler, pragueDayWindow, pragueToday,
  secretMatches, validDay
} from '../supabase/functions/office-platform-stats/core.mjs';

const token = 'a'.repeat(64);
function fixture({secret=token,dbUrl=PROD_SUPABASE_URL,fail=null,counts=[30,2,11,1],clock='2026-11-18T11:00:00Z',readProcesses}={}) {
  const calls=[];
  let initialized=0;
  const getEnv=name=>({RENTULO_OFFICE_STATS_SECRET:secret,SUPABASE_URL:dbUrl})[name];
  const handler=createStatsHandler({getEnv,readProcesses,now:()=>new Date(clock),createCounter:()=>{
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


// A separate, strictly read-only process view; legacy offer and reservation
// counts must keep their exact existing URL, response shape and behavior.
const healthyJobs = Object.fromEntries(['no_show', 'notification_monitor',
  'owner_transfer_retry', 'return_followups'].map(key => [key, {
    present:true, active:true, last_state:'succeeded',
    last_started_at:'2026-11-18T10:59:00.000Z',
    last_finished_at:'2026-11-18T10:59:01.000Z'
  }]));
function sampleProcessSummary() {
  return {jobs: structuredClone(healthyJobs),
    worker_last_success_at:'2026-11-18T10:59:04.000Z'};
}

test('process view returns only whitelisted cron summaries and real worker pulse',async()=>{
  let reads=0;
  const fx=fixture({readProcesses:async()=>{reads++;return sampleProcessSummary();}});
  const res=await fx.handler(fx.request('?view=processes'));
  assert.equal(res.status,200);
  assert.deepEqual(await res.json(),{source:'rentulo-prod',view:'processes',
    checked_at:'2026-11-18T11:00:00.000Z',jobs:healthyJobs,
    worker:{last_success_at:'2026-11-18T10:59:04.000Z'}});
  assert.equal(reads,1);
  assert.equal(fx.initialized(),0);
  assert.equal(fx.calls.length,0);
});

test('process view is inaccessible without authorization or on TEST',async()=>{
  let reads=0;
  const readProcesses=async()=>{reads++;return sampleProcessSummary();};
  const prod=fixture({readProcesses});
  assert.equal((await prod.handler(prod.request('?view=processes','b'.repeat(64)))).status,401);
  const testEnv=fixture({dbUrl:'https://vspposovhdgvbeukoivh.supabase.co',readProcesses});
  assert.equal((await testEnv.handler(testEnv.request('?view=processes'))).status,503);
  assert.equal(reads,0);
});

test('process view rejects all unsupported query combinations before reading DB',async()=>{
  let reads=0;
  const fx=fixture({readProcesses:async()=>{reads++;return sampleProcessSummary();}});
  for(const query of ['?view=logs','?view=processes&day=2026-11-18',
    '?view=processes&view=processes','?view=processes&debug=true']) {
    assert.equal((await fx.handler(fx.request(query))).status,400);
  }
  assert.equal(reads,0);
});

test('missing jobs, failures and stale timestamps remain visible; no fabricated green state',async()=>{
  const snapshot=sampleProcessSummary();
  snapshot.jobs.no_show={present:false,active:null,last_state:null,
    last_started_at:null,last_finished_at:null};
  snapshot.jobs.owner_transfer_retry.last_state='failed';
  snapshot.jobs.return_followups.last_finished_at='2026-11-01T11:00:01.000Z';
  snapshot.worker_last_success_at=null;
  const fx=fixture({readProcesses:async()=>snapshot});
  const res=await fx.handler(fx.request('?view=processes'));
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(data.jobs.no_show.present,false);
  assert.equal(data.jobs.owner_transfer_retry.last_state,'failed');
  assert.equal(data.worker.last_success_at,null);
});

test('process read errors never expose partial data or SQL messages',async()=>{
  const fx=fixture({readProcesses:async()=>{throw Error('SECRET PG ERROR');}});
  const res=await fx.handler(fx.request('?view=processes'));
  assert.equal(res.status,503);
  assert.deepEqual(await res.json(),{error:'unavailable'});
  assert.equal(fx.initialized(),0);
});

test('invalid process results fail closed instead of leaking rows or command text',async()=>{
  for(const bad of [null,{jobs:{},worker_last_success_at:null},
    {...sampleProcessSummary(),worker_last_success_at:'wrong'},
    {...sampleProcessSummary(),jobs:{...healthyJobs,additional:{command:'SELECT secret'}}}]) {
    const fx=fixture({readProcesses:async()=>bad});
    const res=await fx.handler(fx.request('?view=processes'));
    assert.equal(res.status,503);
    assert.deepEqual(await res.json(),{error:'unavailable'});
  }
});


test('process view strips unrequested fields even from a nominally valid reader',async()=>{
  const snapshot=sampleProcessSummary();
  snapshot.jobs.no_show.command='SELECT internal_secret';
  const fx=fixture({readProcesses:async()=>snapshot});
  const res=await fx.handler(fx.request('?view=processes'));
  assert.equal(res.status,200);
  const data=await res.json();
  assert.equal(Object.hasOwn(data.jobs.no_show,'command'),false);
  assert.equal(JSON.stringify(data).includes('internal_secret'),false);
});
