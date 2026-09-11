// Tiny test runner: no deps, `node test/run.js`.
const tests = [];
let only = null;
export function test(name, fn) { tests.push({ name, fn }); }
export function assert(cond, msg) { if (!cond) throw new Error(msg || 'assertion failed'); }
export function eq(a, b, msg) {
  const sa = JSON.stringify(a), sb = JSON.stringify(b);
  if (sa !== sb) throw new Error(`${msg || 'expected equal'}\n  actual:   ${sa}\n  expected: ${sb}`);
}
export async function runAll() {
  let pass = 0; const fails = [];
  for (const t of tests) {
    if (only && t.name !== only) continue;
    try { await t.fn(); pass++; process.stdout.write('.'); }
    catch (e) { fails.push([t.name, e]); process.stdout.write('F'); }
  }
  process.stdout.write('\n');
  // Written straight to the stream: tests are allowed to stub console.error,
  // and the runner's own output must survive that.
  for (const [name, e] of fails) process.stderr.write(`\nFAIL ${name}\n  ${e.message}\n`);
  console.log(`\n${pass} passed, ${fails.length} failed`);
  if (fails.length) process.exitCode = 1;
}
