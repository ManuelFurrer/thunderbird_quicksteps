import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const rootDir = process.cwd();
const srcDir = path.join(rootDir, 'src');
const manifestPath = path.join(srcDir, 'manifest.json');
const distDir = path.join(rootDir, 'dist');

const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

if (!manifest.version) {
  throw new Error('Version not found in src/manifest.json');
}

fs.mkdirSync(distDir, { recursive: true });

const zipFile = path.join(distDir, `quicksteps_${manifest.version}.zip`);
const outputFile = path.join(distDir, `quicksteps_${manifest.version}.xpi`);

if (fs.existsSync(zipFile)) {
  fs.unlinkSync(zipFile);
}

if (fs.existsSync(outputFile)) {
  fs.unlinkSync(outputFile);
}

if (process.platform === 'win32') {
  execFileSync(
    'powershell',
    [
      '-NoProfile',
      '-Command',
      `Compress-Archive -Path '${srcDir}\\*' -DestinationPath '${zipFile}'`
    ],
    { stdio: 'inherit' }
  );

  fs.renameSync(zipFile, outputFile);
} else {
  execFileSync('zip', ['-r', outputFile, '.'], {
    cwd: srcDir,
    stdio: 'inherit'
  });
}

console.log(`Created ${path.relative(rootDir, outputFile)}`);
