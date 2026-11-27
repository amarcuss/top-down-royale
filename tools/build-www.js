// Copies the game into www/ for the iOS wrapper (Capacitor's webDir): just the files the game loads.
// Run: npm run www
const fs = require('fs'), path = require('path');
const root = path.join(__dirname, '..'), out = path.join(root, 'www');
fs.rmSync(out, { recursive: true, force: true }); fs.mkdirSync(out);
for (const f of ['index.html', 'style.css', 'privacy.html', 'manifest.webmanifest', 'sw.js']) fs.copyFileSync(path.join(root, f), path.join(out, f));
const html = path.join(out, 'index.html'); fs.writeFileSync(html, fs.readFileSync(html, 'utf8').replace('<!--push-->', require('./push-label')())); // Options shows which push this build is
for (const dir of ['js', 'icons']) fs.cpSync(path.join(root, dir), path.join(out, dir), { recursive: true });
console.log('www/ ready:', fs.readdirSync(out).join(', '));
