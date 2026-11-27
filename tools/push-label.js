// Which GitHub push a copy of the game was made from, for the line at the bottom of Options: " · push 8a26454 (26 Nov 2026)".
// Used by tools/build-www.js (the iOS app) and server/server.js (the hosted game); empty when git is not available.
const { execFileSync } = require('child_process'), path = require('path');
module.exports = function pushLabel() {
  try {
    const run = (...args) => execFileSync('git', args, { cwd: path.join(__dirname, '..'), stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
    const [hash, date] = run('log', '-1', '--format=%h|%cd', '--date=format:%d %b %Y').split('|');
    const dirty = run('status', '--porcelain', '--untracked-files=no') ? ' + local changes' : '';
    return hash ? ' &middot; push ' + hash + ' (' + date.replace(/^0/, '') + ')' + dirty : '';
  } catch (e) { return ''; }
};
