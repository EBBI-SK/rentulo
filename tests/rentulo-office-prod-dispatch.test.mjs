import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { dispatchOfficeEvents, officeEventConfigValid, signOfficeEvent } from
  '../supabase/functions/_shared/rentulo-office-dispatch.mjs';

const SECRET = 'PROD_TEST_ONLY_' + 's'.repeat(80);
const BYPASS = 'test-bypass-' + 'b'.repeat(42);
const CONFIG = {
  enabled: 'true',
  url: 'https://office.example.com/api/integrations/rentulo/events',
  secret: SECRET, bypassSecret: BYPASS,
};
const NOW = Date.parse('2026-11-15T10:00:00.000Z');
const EVENT = {
  event_id: 'return:00000000-0000-4000-8000-000000000001:open',
  claim_token: '00000000-0000-4000-8000-000000000099',
  issue_key: 'return:00000000-0000-4000-8000-000000000001',
  event_type: 'return_not_received', state: 'open', severity: 'high',
  occurred_at: '2026-11-15T08:00:00+00:00', reservation_number: 'R-000125',
  diagnostic_code: 'RETURN_NOT_RECEIVED',
  reporter_email: 'must-never-leave@rentulo.com',
};
function fixture(rows=[EVENT], options={}) {
  const calls=[];
  const admin = {
    rpc(name, args) {
      calls.push({name,args});
      return { async abortSignal() {
        if (options.claimError && name === 'claim_rentulo_office_event_deliveries')
          return {data:null, error:{message:'db failure'}};
        if (name === 'claim_rentulo_office_event_deliveries') return {data:rows,error:null};
        return {data:options.ackFailed ? false : true,error:null};
      }};
    }
  };
  return {admin,calls};
}

const fakes = () => ({now:()=>NOW,cryptoImpl:globalThis.crypto});

test('configuration requires explicit activation, protected URL, two strong secrets', () => {
  assert.equal(officeEventConfigValid(CONFIG), true);
  for(const changed of [
    {enabled:'false'}, {secret:'short'}, {bypassSecret:''},
    {url:'http://office.example.com/api/integrations/rentulo/events'},
    {url:'https://office.example.com/other'},
    {url:'https://localhost/api/integrations/rentulo/events'},
    {url:'https://office.example.com/api/integrations/rentulo/events?bypass=secret'},
  ]) assert.equal(officeEventConfigValid({...CONFIG,...changed}), false);
});

test('signature exactly matches the Office HMAC wire protocol', async () => {
  const payload='{"event_id":"sample"}';const t='1794736800';
  const expected='sha256='+createHmac('sha256',SECRET).update(t+'\nprod\n'+payload).digest('hex');
  assert.equal(await signOfficeEvent(SECRET,t,payload), expected);
});

test('disabled transport does not even touch the database', async () => {
  const f=fixture();
  const result=await dispatchOfficeEvents({admin:f.admin,config:{...CONFIG,enabled:'false'},...fakes()});
  assert.deepEqual(result,{enabled:false,ok:true,claimed:0});
  assert.equal(f.calls.length,0);
});

test('valid event travels with HMAC, bypass, no PII and confirms delivery', async () => {
  const f=fixture(); let request;
  const r=await dispatchOfficeEvents({admin:f.admin,config:CONFIG,...fakes(),fetchImpl:async(url,opts)=>{
    request={url,...opts};return Response.json({accepted:true},{status:201});
  }});
  assert.equal(r.sent,1);
  assert.equal(r.ok,true);
  assert.equal(request.url,CONFIG.url);
  assert.equal(request.headers['x-rentulo-environment'],'prod');
  assert.equal(request.headers['x-vercel-protection-bypass'],BYPASS);
  assert.equal(request.headers['x-rentulo-signature'],'sha256='+createHmac('sha256',SECRET)
    .update(request.headers['x-rentulo-timestamp']+'\nprod\n'+request.body).digest('hex'));
  const body=JSON.parse(request.body);
  assert.equal(body.occurred_at,'2026-11-15T08:00:00.000Z');
  assert.equal(body.reporter_email,undefined);
  assert.equal(Object.hasOwn(body,'claim_token'),false);
  assert.equal(body.reservation_number,'R-000125');
  assert.equal(f.calls[1].args.p_outcome,'sent');
  assert.equal(f.calls[1].args.p_event_id,EVENT.event_id);
});

test('Office duplicate acknowledgement is treated as delivered', async () => {
  const f=fixture();
  const x=await dispatchOfficeEvents({admin:f.admin,config:CONFIG,...fakes(),fetchImpl:async()=>
    Response.json({accepted:true,duplicate:true},{status:200})});
  assert.equal(x.sent,1);
});

test('Office outage leaves event retryable and does not print provider payload', async () => {
  const f=fixture();
  const x=await dispatchOfficeEvents({admin:f.admin,config:CONFIG,...fakes(),fetchImpl:async()=>
    Response.json({error:'sensitive explanation'}, {status:503})});
  assert.equal(x.retry,1); assert.equal(x.ok,false);
  assert.deepEqual(f.calls[1].args,{p_event_id:EVENT.event_id,p_claim_token:EVENT.claim_token,
    p_outcome:'retry',p_error:'OFFICE_HTTP_503'});
});

test('400/401 responses retry; 409 content conflicts are marked for review', async () => {
  for(const [status,expected] of [[400,'retry'],[401,'retry'],[409,'dead']]){
    const f=fixture();
    const x=await dispatchOfficeEvents({admin:f.admin,config:CONFIG,...fakes(),fetchImpl:async()=>new Response('',{status})});
    assert.equal(x[expected],1);
    assert.equal(f.calls[1].args.p_outcome,expected);
  }
});

test('network failure, unconfirmed 200 and ack failure never acknowledge success', async () => {
  const f=fixture();
  const x=await dispatchOfficeEvents({admin:f.admin,config:CONFIG,...fakes(),fetchImpl:async()=>{throw new Error('offline')}});
  assert.equal(x.retry,1);
  const n=fixture();
  const unconfirmed=await dispatchOfficeEvents({admin:n.admin,config:CONFIG,...fakes(),fetchImpl:async()=>
    Response.json({accepted:false},{status:200})});
  assert.equal(unconfirmed.retry,1);
  const a=fixture([EVENT],{ackFailed:true});
  const result=await dispatchOfficeEvents({admin:a.admin,config:CONFIG,...fakes(),fetchImpl:async()=>
    Response.json({accepted:true},{status:201})});
  assert.equal(result.ack_failed,1);
  assert.equal(result.ok,false);
});

test('failed DB claim or incomplete config cannot send data', async () => {
  const f=fixture([EVENT],{claimError:true});let requests=0;
  const bad=await dispatchOfficeEvents({admin:f.admin,config:CONFIG,...fakes(),fetchImpl:async()=>{requests++}});
  assert.deepEqual({ok:bad.ok,error:bad.error},{ok:false,error:'OUTBOX_UNAVAILABLE'});
  const missing=await dispatchOfficeEvents({admin:f.admin,config:{...CONFIG,secret:undefined},...fakes(),fetchImpl:async()=>{requests++}});
  assert.equal(missing.error,'CONFIGURATION_MISSING');
  assert.equal(requests,0);
});

test('SQL contract stages PROD guard, source triggers, lease RPCs and no new cron', () => {
  const base=path.resolve(import.meta.dirname,'..');
  const sql=fs.readFileSync(path.join(base,'supabase/prod-release-20261115-office-events/migrations/20261115090000_office_event_outbox_PROD_PENDING.sql'),'utf8');
  for(const term of [
    'PENDING - NOT APPLIED', "s.name = 'rentulo_prod_release_target'",
    "s.decrypted_secret = 'tfvgxrdjrpicgtvovehl'", 'create table public.rentulo_office_event_outbox',
    'enable row level security', 'public.platform_incident_events',
    'public.reservation_return_incidents','public.reservation_notification_monitor_alerts',
    'public.reservation_dispute_settlement_events','public.payments',
    'create function public.claim_rentulo_office_event_deliveries',
    'create function public.finish_rentulo_office_event_delivery',
    'for update skip locked', 'grant execute',
  ]) assert(sql.toLowerCase().includes(term.toLowerCase()),term);
  assert(!/cron\.schedule\s*\(/i.test(sql));
  assert(!/stripe_secret|stripe_charge_id|recipient_email/i.test(sql));
  const monitor=fs.readFileSync(path.join(base,'supabase/functions/monitor-reservation-notifications-prod/index.ts'),'utf8');
  for(const expected of ['import { dispatchOfficeEvents }', 'RENTULO_OFFICE_EVENTS_ENABLED', 'claim_reservation_notification_monitor_alerts', 'finish_reservation_notification_monitor_alert'])
    assert(monitor.includes(expected),expected);
});
