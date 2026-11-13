import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const root = process.cwd();
const source = path.join(root, 'functions');
const target = path.join(root, 'cloud-functions');

await rm(target, { recursive: true, force: true });
await mkdir(target, { recursive: true });
await cp(source, target, {
  recursive: true,
  filter: (filePath) => !filePath.split(path.sep).includes('node_modules'),
});

console.log(`[edgeone] prepared Cloud Functions at ${target}`);