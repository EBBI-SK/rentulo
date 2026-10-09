import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const output = resolve(process.argv[2] || join(root, 'dist'));
if (output === root || output === '/' || output === resolve(root, '..')) {
  throw new Error('Refusing to overwrite the source directory');
}

const sourceConfig = readFileSync(join(root, 'js/supabase-config.js'), 'utf8');
function readSourceConstant(name) {
  const match = sourceConfig.match(new RegExp(`^const ${name} = ("[^"\\n]*");$`, 'm'));
  if (!match) throw new Error(`Missing source configuration: ${name}`);
  return JSON.parse(match[1]);
}
function replaceConstant(source, name, value) {
  const expression = new RegExp(`^const ${name} = ("[^"\\n]*");$`, 'gm');
  if ([...source.matchAll(expression)].length !== 1) {
    throw new Error(`Cannot safely configure: ${name}`);
  }
  return source.replace(expression, `const ${name} = ${JSON.stringify(value)};`);
}

const target = (process.env.RENTULO_DEPLOY_TARGET || 'test').trim().toLowerCase();
if (!['test', 'prod'].includes(target)) throw new Error('Invalid RENTULO_DEPLOY_TARGET');

const testUrl = readSourceConstant('SUPABASE_URL');
const testKey = readSourceConstant('SUPABASE_PUBLISHABLE_KEY');
const configuredUrl = process.env.RENTULO_SUPABASE_URL?.trim();
const configuredKey = process.env.RENTULO_SUPABASE_PUBLISHABLE_KEY?.trim();

if (Boolean(configuredUrl) !== Boolean(configuredKey)) {
  throw new Error('Set both RENTULO_SUPABASE_URL and RENTULO_SUPABASE_PUBLISHABLE_KEY');
}
if (target === 'prod' && (!configuredUrl || !configuredKey)) {
  throw new Error('PROD build stopped: required Supabase configuration is missing');
}

const ref = target === 'prod' ? 'tfvgxrdjrpicgtvovehl' : 'vspposovhdgvbeukoivh';
const rawUrl = configuredUrl || testUrl;
let parsed;
try { parsed = new URL(rawUrl); } catch {
  throw new Error('Invalid Supabase URL');
}
if (
  parsed.protocol !== 'https:' || parsed.hostname !== `${ref}.supabase.co` ||
  parsed.port || parsed.username || parsed.password || parsed.search || parsed.hash ||
  (parsed.pathname !== '/' && parsed.pathname !== '')
) {
  throw new Error(`Supabase URL does not belong to the selected ${target.toUpperCase()} project`);
}
const key = configuredKey || testKey;
if (!/^sb_publishable_[A-Za-z0-9_-]{12,}$/.test(key)) {
  throw new Error('Only a Supabase publishable key may be exposed in the browser');
}
if (target === 'prod' && key === testKey) {
  throw new Error('PROD must not use the TEST publishable key');
}

let builtConfig = replaceConstant(sourceConfig, 'SUPABASE_URL', `${parsed.origin}/`);
builtConfig = replaceConstant(builtConfig, 'SUPABASE_PUBLISHABLE_KEY', key);
builtConfig = replaceConstant(builtConfig, 'RENTULO_DEPLOY_TARGET', target);

// Build static assets only. Never publish database migrations, tests, sources or secrets.
rmSync(output, { recursive: true, force: true });
mkdirSync(output, { recursive: true });
for (const filename of readdirSync(root).filter(name => name.endsWith('.html'))) {
  cpSync(join(root, filename), join(output, filename));
}
for (const directory of ['css', 'js', 'assets']) {
  cpSync(join(root, directory), join(output, directory), { recursive: true });
}
writeFileSync(join(output, 'js/supabase-config.js'), builtConfig, 'utf8');
console.log(`Rentulo ${target.toUpperCase()} static build completed (${parsed.hostname})`);
