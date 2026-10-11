// Repeatable local gates. Browser suites only use isolated, fully routed fixtures.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const browserOnly = process.argv.includes('--browser-only');
const unitTests = fs.readdirSync(path.join(root, 'tests')).filter((name) => name.endsWith('.test.cjs')).sort().map((name) => `tests/${name}`);
const gates = [
  ...browserOnly ? [] : [
    ['offline tests', ['--test', ...unitTests]],
    ['TypeScript', ['node_modules/typescript/bin/tsc', '--noEmit']],
    ['production build', ['utils/build.js']],
  ],
  ['M4 browser compatibility', ['tests/m4-browser-smoke.cjs']],
  ['M5 UI, lifecycle and performance', ['tests/m5-browser-regression.cjs']],
  ['I1 vertical context and reading mode isolation', ['tests/i1-browser-regression.cjs']],
  ['I2 vertical original text operations', ['tests/i2-browser-regression.cjs']],
  ['I3 vertical thought interactions', ['tests/i3-browser-regression.cjs']],
];
for (const [name, args] of gates) {
  console.log(`\nAcceptance gate: ${name}`);
  const result = spawnSync(process.execPath, args, { cwd: root, env: process.env, stdio: 'inherit' });
  if (result.error || result.status !== 0) {
    console.error(`Acceptance failed: ${name}${result.error ? ` (${result.error.message})` : ''}`);
    process.exit(result.status || 1);
  }
}
console.log('\nAll fixture acceptance gates passed. Live signed-in Reader checks remain manual.');
