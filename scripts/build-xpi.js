import fs from 'node:fs';
import path from 'node:path';
import AdmZip from 'adm-zip';

const rootDir = process.cwd();
const srcDir = path.join(rootDir, 'src');
const distDir = path.join(rootDir, 'dist');
const manifest = JSON.parse(fs.readFileSync(path.join(srcDir, 'manifest.json'), 'utf8'));

if (fs.existsSync(distDir)) {
  fs.rmSync(distDir, { recursive: true, force: true });
}
fs.mkdirSync(distDir, { recursive: true });

const outputFile = path.join(distDir, `quicksteps_${manifest.version}.xpi`);

const zip = new AdmZip();
zip.addLocalFolder(srcDir);
zip.writeZip(outputFile);

console.log(`Created ${path.relative(rootDir, outputFile)}`);
