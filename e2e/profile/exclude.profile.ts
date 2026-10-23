// Ad-hoc profiler: PERF=1 npx playwright test --config playwright.perf.config.ts e2e/profile
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const ROWS = Number(process.env.PERF_ROWS || 10000);

test('profile exclude', async ({ page }) => {
  test.setTimeout(10 * 60_000);
  await page.goto('/');
  await expect(page.getByText('No data loaded')).toBeVisible({ timeout: 60_000 });
  await page.locator('input[type=file]').setInputFiles(path.resolve(`e2e/fixtures/perf/videos-${ROWS}.csv`));
  await page.getByRole('button', { name: 'Import CSV' }).click();
  const n = ROWS.toLocaleString('en-US');
  await expect(page.getByRole('contentinfo')).toContainText(`showing ${n} of ${n} rows`, { timeout: 5 * 60_000 });
  await page.waitForTimeout(3000);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send('HeapProfiler.collectGarbage');
  const heap = async () => (await cdp.send('Runtime.getHeapUsage')).usedSize / 1e6;
  console.log('HEAP after import (MB)', (await heap()).toFixed(0));

  const cell = page.locator('.ag-center-cols-container .ag-row[row-index="0"] .ag-cell').first();
  await cell.click();
  await expect(page.getByRole('contentinfo')).toContainText('1 selected');
  await page.waitForTimeout(1000);

  await cdp.send('Profiler.enable');
  await cdp.send('Profiler.setSamplingInterval', { interval: 200 });
  await cdp.send('Profiler.start');
  const t0 = Date.now();
  await page.keyboard.press('Delete');
  const m = (ROWS - 1).toLocaleString('en-US');
  await expect(page.getByRole('contentinfo')).toContainText(`showing ${m} of ${m} rows`, { timeout: 5 * 60_000 });
  const elapsed = Date.now() - t0;
  await page.waitForTimeout(1500);
  const { profile } = await cdp.send('Profiler.stop');
  console.log('EXCLUDE ms', elapsed);

  // Aggregate self time and inclusive time per function.
  const byId = new Map(profile.nodes.map((node) => [node.id, node]));
  const parent = new Map<number, number>();
  profile.nodes.forEach((node) => (node.children || []).forEach((child) => parent.set(child, node.id)));
  const self = new Map<number, number>();
  const deltas = profile.timeDeltas || [];
  (profile.samples || []).forEach((id, i) => self.set(id, (self.get(id) || 0) + (deltas[i] || 0) / 1000));
  const label = (node: any) => {
    const f = node.callFrame;
    return `${f.functionName || '(anon)'} ${f.url.split('/').slice(-1)[0].split('?')[0]}:${f.lineNumber + 1}`;
  };
  const selfBy = new Map<string, number>();
  const totalBy = new Map<string, number>();
  self.forEach((ms, id) => {
    const node: any = byId.get(id);
    selfBy.set(label(node), (selfBy.get(label(node)) || 0) + ms);
    const seen = new Set<string>();
    let cur: number | undefined = id;
    while (cur !== undefined) {
      const l = label(byId.get(cur));
      if (!seen.has(l)) { totalBy.set(l, (totalBy.get(l) || 0) + ms); seen.add(l); }
      cur = parent.get(cur);
    }
  });
  const top = (m: Map<string, number>, k: number) => [...m.entries()].sort((a, b) => b[1] - a[1]).slice(0, k)
    .map(([l, ms]) => `${ms.toFixed(0).padStart(6)} ms  ${l}`).join('\n');
  const appOnly = new Map([...totalBy].filter(([l]) => /\.(tsx?|js) ?:|App|data|filter|dashboard|Metadata|Detail|Channel|inclusion|selection/.test(l) && !/react-dom|ag-grid|chunk-|deps/.test(l)));
  const report = `SELF\n${top(selfBy, 25)}\n\nINCLUSIVE (app code)\n${top(appOnly, 40)}`;
  fs.mkdirSync('test-results', { recursive: true });
  fs.writeFileSync(`test-results/profile-exclude-${ROWS}.txt`, report);
  console.log(report);
});
