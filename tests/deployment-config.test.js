const { test } = require('node:test');
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const { readFileSync, mkdtempSync, rmSync, readdirSync, existsSync } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const vm = require('node:vm');

const root = path.join(__dirname, '..');
const buildScript = path.join(root, 'scripts/build-site.mjs');
const source = readFileSync(path.join(root, 'js/supabase-config.js'), 'utf8');
const vercel = JSON.parse(readFileSync(path.join(root, 'vercel.json'), 'utf8'));
const testRef = 'vspposovhdgvbeukoivh';
const prodRef = 'tfvgxrdjrpicgtvovehl';
const fakeProdKey = 'sb_publishable_' + 'ProdExampleKeyForBuildTest_'.repeat(2);

function runBuild(env, output) {
  const cleanEnv = { ...process.env };
  delete cleanEnv.RENTULO_DEPLOY_TARGET;
  delete cleanEnv.RENTULO_SUPABASE_URL;
  delete cleanEnv.RENTULO_SUPABASE_PUBLISHABLE_KEY;
  return spawnSync(process.execPath, [buildScript, output], {
    cwd: root,
    env: { ...cleanEnv, ...env },
    encoding: 'utf8'
  });
}
function inTemp(fn) {
  const dir = mkdtempSync(path.join(os.tmpdir(), 'rentulo-build-'));
  try { return fn(dir); } finally { rmSync(dir, { recursive: true, force: true }); }
}
function runtimeConfig(script, hostname) {
  const calls = [];
  const context = {
    window: {
      location: { hostname },
      supabase: { createClient: (...args) => { calls.push(args); return { connected: true }; } }
    }
  };
  const client = vm.runInNewContext(script + '\nrentuloSupabase;', context);
  return { calls, client };
}

test('TEST build uses existing connection by default and does not publish server sources', () => inTemp(dir => {
  const result = runBuild({}, dir);
  assert.equal(result.status, 0, result.stderr);
  const outputScript = readFileSync(path.join(dir, 'js/supabase-config.js'), 'utf8');
  assert.match(outputScript, new RegExp(`https://${testRef}\\.supabase\\.co/`));
  assert.match(outputScript, /RENTULO_DEPLOY_TARGET = "test"/);
  const html = readdirSync(root).filter(f => f.endsWith('.html'));
  assert.deepEqual(readdirSync(dir).filter(f => f.endsWith('.html')).sort(), html.sort());
  assert.ok(existsSync(path.join(dir, 'assets/flags/cz.svg')));
  assert.ok(existsSync(path.join(dir, 'css/home.css')));
  assert.equal(existsSync(path.join(dir, 'supabase')), false);
  assert.equal(existsSync(path.join(dir, 'tests')), false);
  assert.equal(runtimeConfig(outputScript, 'rentulo.eu').calls.length, 1);
  assert.equal(runtimeConfig(outputScript, 'rentulo.com').calls.length, 0);
}));

test('PROD build receives only PROD client config and refuses the TEST domain', () => inTemp(dir => {
  const result = runBuild({
    RENTULO_DEPLOY_TARGET: 'prod',
    RENTULO_SUPABASE_URL: `https://${prodRef}.supabase.co`,
    RENTULO_SUPABASE_PUBLISHABLE_KEY: fakeProdKey
  }, dir);
  assert.equal(result.status, 0, result.stderr);
  const outputScript = readFileSync(path.join(dir, 'js/supabase-config.js'), 'utf8');
  assert.ok(outputScript.includes(`https://${prodRef}.supabase.co/`));
  assert.ok(outputScript.includes(fakeProdKey));
  assert.ok(!outputScript.includes(testRef));
  assert.ok(!outputScript.includes('sb_publishable_1WQZ-gW9198Qu2amXZ-nPg_1dkadBSz'));
  assert.equal(runtimeConfig(outputScript, 'rentulo.com').calls.length, 1);
  assert.equal(runtimeConfig(outputScript, 'www.rentulo.eu').calls.length, 0);
}));

test('PROD stops instead of reusing TEST credentials or wrong project', () => inTemp(dir => {
  const cases = [
    [{ RENTULO_DEPLOY_TARGET: 'prod' }, 'required Supabase configuration is missing'],
    [{ RENTULO_DEPLOY_TARGET: 'prod', RENTULO_SUPABASE_URL: `https://${prodRef}.supabase.co` }, 'Set both'],
    [{ RENTULO_DEPLOY_TARGET: 'prod', RENTULO_SUPABASE_URL: `https://${testRef}.supabase.co`, RENTULO_SUPABASE_PUBLISHABLE_KEY: fakeProdKey }, 'does not belong'],
    [{ RENTULO_DEPLOY_TARGET: 'prod', RENTULO_SUPABASE_URL: `https://${prodRef}.supabase.co`, RENTULO_SUPABASE_PUBLISHABLE_KEY: 'sb_secret_DoNotUseInBrowser' }, 'Only a Supabase publishable key'],
    [{ RENTULO_DEPLOY_TARGET: 'invalid' }, 'Invalid RENTULO_DEPLOY_TARGET'],
    [{ RENTULO_DEPLOY_TARGET: 'test', RENTULO_SUPABASE_URL: `https://${prodRef}.supabase.co`, RENTULO_SUPABASE_PUBLISHABLE_KEY: fakeProdKey }, 'does not belong']
  ];
  for (const [env, msg] of cases) {
    const result = runBuild(env, dir);
    assert.notEqual(result.status, 0, `Build should reject ${JSON.stringify(env)}`);
    assert.ok(result.stderr.includes(msg), result.stderr);
    assert.equal(existsSync(path.join(dir, 'js/supabase-config.js')), false);
  }
}));

test('Vercel sets CSP per custom domain while previews allow both origins', () => {
  assert.equal(vercel.buildCommand, 'npm run build');
  assert.equal(vercel.outputDirectory, 'dist');
  const cspRules = vercel.headers.filter(r => r.headers.some(h => h.key === 'Content-Security-Policy'));
  assert.equal(cspRules.length, 3);
  function effectiveCsp(host) {
    const matching = cspRules.filter(r => {
      const spec = r.has ? r.has[0] : r.missing[0];
      const matched = new RegExp(spec.value.re).test(host);
      return r.has ? matched : !matched;
    });
    assert.equal(matching.length, 1, `Exactly one CSP for ${host}`);
    return matching[0].headers.find(h => h.key === 'Content-Security-Policy').value;
  }
  for (const hostname of ['rentulo.eu', 'www.rentulo.eu']) {
    const csp = effectiveCsp(hostname);
    assert.ok(csp.includes(testRef));
    assert.ok(!csp.includes(prodRef));
  }
  for (const hostname of ['rentulo.com', 'www.rentulo.com']) {
    const csp = effectiveCsp(hostname);
    assert.ok(csp.includes(prodRef));
    assert.ok(!csp.includes(testRef));
  }
  const previewCsp = effectiveCsp('rentulo-preview.vercel.app');
  assert.ok(previewCsp.includes(testRef));
  assert.ok(previewCsp.includes(prodRef));
  assert.equal(vercel.headers.filter(r => r.headers.some(h => h.key === 'X-Frame-Options')).length, 1);
});

test('HTML pages keep central Supabase config script, with no page rewrites', () => {
  const pages = readdirSync(root).filter(f => f.endsWith('.html'));
  assert.ok(pages.length >= 15);
  for (const page of pages) {
    const html = readFileSync(path.join(root, page), 'utf8');
    assert.ok(html.includes('js/supabase-config.js'), `Missing central config in ${page}`);
  }
  assert.ok(source.includes('RENTULO_WRONG_DOMAIN'));
});
