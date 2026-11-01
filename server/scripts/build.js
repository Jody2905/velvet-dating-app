// "Build" for a plain Node API: syntax-check every source file and make sure the app loads.
// Does not connect to the database.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const files = [];
(function walk(dir) {
  for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
    if (f.name === 'node_modules' || f.name.startsWith('.')) continue;
    const p = path.join(dir, f.name);
    if (f.isDirectory()) walk(p);
    else if (f.name.endsWith('.js')) files.push(p);
  }
})(root);

for (const f of files) execFileSync(process.execPath, ['--check', f], { stdio: 'inherit' });

process.env.DATABASE_URL = process.env.DATABASE_URL || 'postgres://build:build@localhost:5432/build';
const { createApp } = require('../src/app');
createApp();
console.log(`Build OK: ${files.length} files checked, app loads.`);
process.exit(0);
