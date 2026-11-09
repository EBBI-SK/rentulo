const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const root = path.join(__dirname, '..');
const modulePromise = import(pathToFileURL(path.join(root, 'api/offers-directory.mjs')).href);
const id = 'cbf1184a-97fd-4fd1-8b62-e084a4452d28';
const original = { id, name: 'Aku vrtačka Bosch', city: 'Praha', category: 'Stavba', price_per_day: 250,
  photo_url: 'https://vspposovhdgvbeukoivh.supabase.co/storage/v1/object/public/offer-photos/test/photo.jpg' };
const makeId = n => `cbf1184a-97fd-4fd1-8b62-${String(n).padStart(12,'0')}`;
function responseMock() {
  return { statusCode: 200, headers: {}, body: '', setHeader(k,v) { this.headers[k.toLowerCase()] = v; }, end(value) { this.body=value; } };
}
async function request(data, options = {}) {
  const oldFetch = global.fetch;
  const names = ['RENTULO_DEPLOY_TARGET', 'RENTULO_SUPABASE_URL', 'RENTULO_SUPABASE_PUBLISHABLE_KEY'];
  const env = Object.fromEntries(names.map(name => [name,process.env[name]]));
  for(const name of names) delete process.env[name];
  let upstreamUrl;
  global.fetch = async url => {
    upstreamUrl = String(url);
    return {ok: options.failure !== true, async json() { return data; }};
  };
  const res = responseMock();
  try {
    const {default:handler} = await modulePromise;
    await handler({method: options.method || 'GET', query: options.query || {}, url: '/nabidky', headers: {host: options.host || 'rentulo.eu'}}, res);
    return {res,upstreamUrl};
  } finally {
    global.fetch=oldFetch;
    for(const name of names) env[name] === undefined ? delete process.env[name] : process.env[name]=env[name];
  }
}

test('crawlable SEO directory stays intact and homepage browse reuses existing results page', () => {
  const vercel=JSON.parse(readFileSync(path.join(root,'vercel.json'),'utf8'));
  assert.deepEqual(vercel.rewrites.find(x=>x.source==='/nabidky'),{source:'/nabidky',destination:'/api/offers-directory'});
  assert.match(vercel.functions['api/offers-directory.mjs'].includeFiles,/js\/supabase-config.js/);
  const home=readFileSync(path.join(root,'index.html'),'utf8');
  assert.match(home,/<a class="home-directory-link" href="vysledky\.html">\s*<span data-i18n="nav\.browse">Prohlédnout nabídky<\/span>\s*<span class="home-directory-link-arrow" aria-hidden="true">→<\/span>\s*<\/a>/);
  assert.match(home,/body\[data-navigation-page="uvod"\] \.home-directory-link\s*\{\s*order: 8;/);
  assert.match(home,/body\[data-navigation-page="uvod"\] \.home-map-previews \{ order: 7;/);
  const navigation=readFileSync(path.join(root,'js/navigation.js'),'utf8');
  assert.match(navigation,/<a href="vysledky\.html"[^>]*>\$\{navEscapeHtml\(navTranslate\("nav\.browse"/);
  const i18n=readFileSync(path.join(root,'js/i18n.js'),'utf8');
  assert.equal((i18n.match(/"nav\.browse"/g)||[]).length,5);
  const sitemap=readFileSync(path.join(root,'api/sitemap.mjs'),'utf8');
  assert.match(sitemap,/['"]\/nabidky['"]/);
  const categoryPage=readFileSync(path.join(root,'api/category-page.mjs'),'utf8');
  assert.match(categoryPage,/href=\"\/nabidky\"/);
  const map=readFileSync(path.join(root,'js/home-page.js'),'utf8');
  assert.doesNotMatch(map,/"detail\.html\?id=" \+ encodeURIComponent/);
  assert.equal((map.match(/"\/nabidka\/" \+ encodeURIComponent\(/g)||[]).length,2);
  const results=readFileSync(path.join(root,'js/results-page.js'),'utf8');
  assert.match(results,/"\/nabidka\/" \+ encodeURIComponent\(offerId\)/);
});

test('first page lists active offers in initial HTML and TEST stays noindex',async()=>{
  const {res,upstreamUrl}=await request([original]);
  assert.equal(res.statusCode,200);
  assert.equal(res.headers['x-robots-tag'],'noindex');
  assert.match(res.body,/<h1>Aktuální nabídky věcí k půjčení<\/h1>/);
  assert.match(res.body,/<h2><a href="\/nabidka\/cbf1184a-97fd-4fd1-8b62-e084a4452d28">Aku vrtačka Bosch<\/a><\/h2>/);
  assert.match(res.body,/Praha/);
  assert.match(res.body,/Stavba/);
  assert.match(res.body,/href="\/kategorie\/stavba"/);
  assert.equal((res.body.match(/href="\/kategorie\/(?:domacnost|zahrada|stavba|hobby|party|ostatni)"/g)||[]).length,7);
  assert.match(res.body,/250 Kč \/ den/);
  assert.match(res.body,/rel="canonical" href="https:\/\/rentulo.eu\/nabidky"/);
  const query = new URL(upstreamUrl).searchParams;
  assert.equal(query.get('status'),'eq.active');
  assert.equal(query.get('select'),'id,name,category,city,price_per_day,photo_url');
  assert.equal(query.get('offset'),'0');
  assert.equal(query.get('limit'),'21');
});

test('page 1 with no active offers is useful and has no fabricated links',async()=>{
  const {res}=await request([]);
  assert.equal(res.statusCode,200);
  assert.match(res.body,/Zatím nejsou zveřejněny žádné nabídky/);
  assert.doesNotMatch(res.body,/<article class="offer-card">/);
  assert.match(res.body,/<nav class="categories"/);
});

test('pagination provides crawlable next and prev links with stable canonical URLs',async()=>{
  const twentyOne = Array.from({length:21},(_,i)=>({...original,id:makeId(i+1)}));
  const first=await request(twentyOne);
  assert.equal((first.res.body.match(/<article class="offer-card">/g)||[]).length,20);
  assert.match(first.res.body,/href="\/nabidky\?page=2" rel="next"/);
  assert.doesNotMatch(first.res.body,/rel="prev"/);
  const second=await request([twentyOne[20]],{query:{page:'2'}});
  assert.equal(second.res.statusCode,200);
  assert.match(second.res.body,/href="\/nabidky" rel="prev"/);
  assert.match(second.res.body,/rel="canonical" href="https:\/\/rentulo.eu\/nabidky\?page=2"/);
  assert.equal(new URL(second.upstreamUrl).searchParams.get('offset'),'20');
  assert.doesNotMatch(second.res.body,/rel="next"/);
});

test('private data, unapproved images and markup never appear in HTML',async()=>{
  const attack={...original,name:'Vrtačka <script>alert(1)</script>',city:'<Praha>',category:'<b>Zahrada</b>',photo_url:'https://bad.example/x.jpg',pickup_phone:'+420123123123',pin:'987654',pickup_street:'Hidden street'};
  const {res}=await request([attack]);
  assert.equal(res.statusCode,200);
  assert.doesNotMatch(res.body,/<script>|<b>|bad\.example|Hidden street|987654|\+420123123123/);
  assert.match(res.body,/&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.match(res.body,/rentulo.eu\/assets\/rentulo-logo-mark.png/);
});

test('invalid, empty or excessive pagination returns 404/noindex',async()=>{
  for(const page of ['0','-1','2.1','abc','501','01']) {
    const {res,upstreamUrl}=await request([original],{query:{page}});
    assert.equal(res.statusCode,404,page);
    assert.equal(res.headers['x-robots-tag'],'noindex');
    assert.equal(upstreamUrl,undefined);
  }
  const absent=await request([],{query:{page:'3'}});
  assert.equal(absent.res.statusCode,404);
  assert.equal(absent.res.headers['x-robots-tag'],'noindex');
});

test('database failures result in 503/noindex, never stale offers',async()=>{
  const {res}=await request([original],{failure:true});
  assert.equal(res.statusCode,503);
  assert.equal(res.headers['x-robots-tag'],'noindex');
  assert.equal(res.headers['retry-after'],'60');
  assert.doesNotMatch(res.body,/Aku vrtačka/);
});

test('HEAD has no body and non-GET methods are rejected',async()=>{
  const head=await request([original],{method:'HEAD'});
  assert.equal(head.res.statusCode,200);
  assert.equal(head.res.body,'');
  const post=await request([original],{method:'POST'});
  assert.equal(post.res.statusCode,405);
  assert.equal(post.res.headers['allow'],'GET, HEAD');
});

test('wrong custom domain is rejected without database requests',async()=>{
  const {res,upstreamUrl}=await request([original],{host:'rentulo.com'});
  assert.equal(res.statusCode,404);
  assert.equal(upstreamUrl,undefined);
});
