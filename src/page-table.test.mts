/**
 * The bug report form's Page dropdown against `PAGES`. GitHub reads the form out of
 * `.github/ISSUE_TEMPLATE/bug_report.yaml` as it is committed, so it cannot be written from the table the way the
 * manifest is, and its options are a second copy of the tab labels, which the Inventory and Battle tabs were once
 * missing from.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { expect, test } from 'vitest';

import { PAGES } from './page-table.ts';

const FORM = join(import.meta.dirname, '..', '.github', 'ISSUE_TEMPLATE', 'bug_report.yaml');

/**
 * The options of the form's Page dropdown, read as text rather than parsed: the body item holding `id: 'page'`, then
 * each `- '…'` line after its `options:`. No label holds a quote, so none needs unescaping.
 */
const pageOptions = (form: string) => {
  const dropdown = form.split('\n  - type: ').find((item) => item.includes("id: 'page'")) ?? '';
  const [, options = ''] = dropdown.split('options:\n');

  return [...options.matchAll(/^ *- '([^']*)'$/gm)].map(([, option]) => option);
};

test('the bug report form offers every tab as a Page', () => {
  // Each tab is looked for among the options rather than each option checked against the tabs, since the form offers
  // more than the tabs, and so that a reading that found no options fails with every tab missing rather than passing.
  const options = pageOptions(readFileSync(FORM, 'utf8'));

  expect(PAGES.map((page) => page.label).filter((label) => !options.includes(label))).toEqual([]);
});
