/**
 * API launcher (2026-08-28): the Azure Functions Node worker rejects Node >= 23
 * ("Incompatible Node.js version"), but this machine's system Node is v24. If a portable
 * supported Node is staged under .tools (a gitignored local download of node-v22.x), prepend it to PATH
 * and spawn the Core Tools' main.js with it; otherwise fall back to the current node and let the
 * host's own version check decide. Spawns in-process (stdio inherit) so Ctrl+C stops everything.
 */
import { spawn } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiRoot = dirname(fileURLToPath(import.meta.url));
const toolsDir = join(apiRoot, '.tools');

let nodeDir = null;
if (existsSync(toolsDir)) {
  const candidates = readdirSync(toolsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name.startsWith('node-v'))
    .map((entry) => join(toolsDir, entry.name));
  nodeDir = candidates[0] ?? null;
}

const funcMain = join(apiRoot, 'node_modules', 'azure-functions-core-tools', 'lib', 'main.js');
const env = { ...process.env };
let nodeExe = process.execPath;
if (nodeDir) {
  env.Path = `${nodeDir};${env.Path ?? env.PATH}`;
  nodeExe = join(nodeDir, 'node.exe');
  console.log(`[start] using portable Node from ${nodeDir}`);
} else {
  console.warn('[start] no portable Node staged under api/.tools — using the running node.');
  console.warn('[start] The Functions Node worker rejects Node >= 23; if startup fails with');
  console.warn('[start] "Incompatible Node.js version", stage node-v22.*-win-x64 under api/.tools/.');
}

const child = spawn(nodeExe, [funcMain, 'start'], {
  cwd: apiRoot,
  env,
  stdio: 'inherit',
  shell: false,
});
child.on('exit', (code) => process.exit(code ?? 0));