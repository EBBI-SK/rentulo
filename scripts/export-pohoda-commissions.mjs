#!/usr/bin/env node
// Local command: requires Supabase TEST SQL Editor CSV and accountant-approved FX.
import { readFile, writeFile, mkdir, unlink } from 'node:fs/promises';
import { resolve } from 'node:path';
import {
  parseCsv, parseRates, prepareCommissions,
  createPohodaXml, createReconciliationCsv,
} from './pohoda-commissions.mjs';

function cliArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (!['--month', '--input', '--rates', '--rate', '--out'].includes(argv[i])) {
      throw new Error(`Neznamy parameter: ${argv[i]}`);
    }
    const value = argv[++i];
    if (!value || value.startsWith('--') || args[argv[i - 1]]) throw new Error('Parameter ma chybajucu alebo duplicitnu hodnotu.');
    args[argv[i - 1]] = value;
  }
  for (const key of ['--month', '--input']) if (!args[key]) throw new Error(`Chyba povinny parameter ${key}`);
  if ((!!args['--rate']) === (!!args['--rates'])) throw new Error('Pouzi prave jeden z --rate alebo --rates.');
  return args;
}

async function main() {
  const opts = cliArgs(process.argv.slice(2));
  const csv = await readFile(resolve(opts['--input']), 'utf8');
  const rows = parseCsv(csv);
  const rates = opts['--rates'] ? parseRates(await readFile(resolve(opts['--rates']), 'utf8')) : new Map();
  const documents = prepareCommissions(rows, { month: opts['--month'], rates, fixedRate: opts['--rate'] });
  if (documents.length === 0) {
    console.log('Ziadne provizie na export. Nebol vytvoreny prazdny XML subor.');
    return;
  }
  const folder = resolve(opts['--out'] || './pohoda-export');
  await mkdir(folder, { recursive: true });
  const prefix = `rentulo-provizie-${opts['--month']}`;
  const xmlName = resolve(folder, `${prefix}.xml`);
  const csvName = resolve(folder, `${prefix}-parovanie.csv`);
  // Fail before either output is written if any record is invalid.
  const xml = createPohodaXml(documents, opts['--month']);
  const report = createReconciliationCsv(documents);
  await writeFile(xmlName, xml, { encoding: 'utf8', flag: 'wx' });
  try {
    await writeFile(csvName, report, { encoding: 'utf8', flag: 'wx' });
  } catch (e) {
    // Never leave an orphan XML file when the accompanying control CSV failed.
    await unlink(xmlName).catch(() => {});
    throw e;
  }
  console.log(`OK: ${documents.length} dokladov, provizie ${documents.reduce((sum, x) => sum + x.commission, 0)} CZK`);
  console.log(`XML: ${xmlName}\nCSV: ${csvName}`);
  console.log('Pred importom do ostrej POHODY vykonaj skusobny import v testovacej uctovnej jednotke.');
}

main().catch((error) => { console.error(`Export zastaveny: ${error.message}`); process.exitCode = 1; });
