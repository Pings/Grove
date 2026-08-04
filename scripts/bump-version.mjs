#!/usr/bin/env node
/**
 * Bump package.json patch version (0.1.0 → 0.1.1).
 * Run before each push to main: node scripts/bump-version.mjs
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const pkgPath = path.join(root, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const parts = String(pkg.version || '0.1.0')
  .split('.')
  .map((n) => Number(n));
while (parts.length < 3) parts.push(0);
parts[2] = (Number.isFinite(parts[2]) ? parts[2] : 0) + 1;
pkg.version = parts.join('.');

writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`);
console.log(`version → ${pkg.version}`);
