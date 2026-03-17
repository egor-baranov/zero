#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const [zipArg, versionArg] = process.argv.slice(2);

if (!zipArg) {
  console.error('Usage: node scripts/generate-latest-mac-yml.mjs <zipPath> [version]');
  process.exit(1);
}

const zipPath = path.resolve(zipArg);

const readPackageVersion = async () => {
  const packageJsonPath = path.resolve(process.cwd(), 'package.json');
  const raw = await fs.readFile(packageJsonPath, 'utf8');
  const parsed = JSON.parse(raw);
  return typeof parsed?.version === 'string' ? parsed.version.trim() : '';
};

const ensureFileExists = async (targetPath) => {
  const stat = await fs.stat(targetPath);
  if (!stat.isFile()) {
    throw new Error(`Expected a file: ${targetPath}`);
  }
};

const main = async () => {
  await ensureFileExists(zipPath);

  const version = versionArg?.trim() || (await readPackageVersion());
  if (!version) {
    throw new Error('Missing application version.');
  }

  const zipBuffer = await fs.readFile(zipPath);
  const sha512 = createHash('sha512').update(zipBuffer).digest('base64');
  const { size } = await fs.stat(zipPath);
  const zipFileName = path.basename(zipPath);
  const releaseDate = new Date().toISOString();

  const ymlContent = [
    `version: ${version}`,
    'files:',
    `  - url: ${zipFileName}`,
    `    sha512: ${sha512}`,
    `    size: ${size}`,
    `path: ${zipFileName}`,
    `sha512: ${sha512}`,
    `releaseDate: '${releaseDate}'`,
    '',
  ].join('\n');

  const outputPath = path.join(path.dirname(zipPath), 'latest-mac.yml');
  await fs.writeFile(outputPath, ymlContent, 'utf8');
  console.log(`Generated ${outputPath}`);
};

void main().catch((error) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(message);
  process.exit(1);
});
