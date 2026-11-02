#!/usr/bin/env node
// Local offline command. Requires Supabase TEST SQL CSV and accountant-approved FX.
// Explicit Stripe review reference is mandatory for positive extension commissions.
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  parseCsv, parseRates, prepareCommissions,
  createPohodaXml, createReconciliationCsv,
} from './pohoda-commissions.mjs';

function cliArgs(argv) {
  const args = {};
  const supported = ['--month', '--input', '--rates', '--rate', '--out', '--extension-review'];
  for (let i = 0; i < argv.length; i++) {
    const key = argv[i];
    if (!supported.includes(key)) throw new Error(`Neznamy parameter: ${key}`);
    const value = argv[++i];
    if (!value || value.startsWith('--') || Object.hasOwn(args, key)) {
      throw new Error('Parameter ma chybajucu alebo duplicitnu hodnotu.');
    }
    args[key] = value;
  }
  for (const key of ['--month', '--input']) {
    if (!args[key]) throw new Error(`Chyba povinny parameter ${key}`);
  }
  if (!!args['--rate'] === !!args['--rates']) {
    throw new Error('Pouzi prave jeden z --rate alebo --rates.');
  }
  return args;
}

async function main() {
  const opts = cliArgs(process.argv.slice(2));
  const csv = await readFile(resolve(opts['--input']), 'utf8');
  const sourceRows = parseCsv(csv);
  const rates = opts['--rates'] ?
    parseRates(await readFile(resolve(opts['--rates']), 'utf8')) : new Map();
  const documentsAndReconciliation = prepareCommissions(sourceRows, {
    month: opts['--month'], rates, fixedRate: opts['--rate'],
    extensionReviewRef: opts['--extension-review'],
  });
  if (!documentsAndReconciliation.length) {
    console.log('Ziadne financne riadky na export. Nevytvorili sa ziadne subory.');
    return;
  }
  const chargeable = documentsAndReconciliation.filter((x) => x.commission > 0);
  const folder = resolve(opts['--out'] || './pohoda-export');
  const prefix = `rentulo-provizie-${opts['--month']}`;
  const xmlName = resolve(folder, `${prefix}.xml`);
  const csvName = resolve(folder, `${prefix}-parovanie.csv`);
  // All data checks and XML generation finish BEFORE the first file is created.
  const xml = chargeable.length ? createPohodaXml(documentsAndReconciliation, opts['--month']) : '';
  const report = createReconciliationCsv(documentsAndReconciliation);
  await mkdir(folder, { recursive: true });
  if (chargeable.length) {
    await writeFile(xmlName, xml, { encoding: 'utf8', flag: 'wx' });
  }
  try {
    await writeFile(csvName, report, { encoding: 'utf8', flag: 'wx' });
  } catch (error) {
    if (chargeable.length) await unlink(xmlName).catch(() => {});
    throw error;
  }
  console.log(`OK: ${chargeable.length} dokladov, ${documentsAndReconciliation.length} kontrolnych riadkov, provizie ${chargeable.reduce((sum, x) => sum + x.commission, 0)} CZK`);
  if (chargeable.length) console.log(`XML: ${xmlName}`);
  else console.log('Len nulove provizie: XML nebol vytvoreny, CSV ano.');
  console.log(`CSV: ${csvName}`);
  console.log('Pred ostrym uctovanim skontroluj Stripe/refundy a vykonaj testovaci import POHODA.');
}

main().catch((error) => {
  console.error(`Export zastaveny: ${error.message}`);
  process.exitCode = 1;
});
