const { spawn } = require('child_process');
const path = require('path');

let child;
let restarting = false;
let startupFailed = false;

function printBanner() {
  console.clear();
  console.log('Hook API dev');
  console.log('Database: MongoDB from .env');
  console.log('Press r to restart, Ctrl+C to stop');
  console.log('');
}

function start() {
  printBanner();
  child = spawn(process.execPath, [
    '-r',
    'ts-node/register',
    '-r',
    'tsconfig-paths/register',
    path.join('src', 'server.ts'),
  ], {
    cwd: path.join(__dirname, '..'),
    env: {
      ...process.env,
      NODE_ENV: process.env.NODE_ENV || 'development',
      DOTENV_CONFIG_QUIET: 'true',
      NODE_NO_WARNINGS: '1',
      TS_NODE_FILES: 'true',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  child.stdout.on('data', (chunk) => {
    process.stdout.write(chunk);
  });

  child.stderr.on('data', (chunk) => {
    const text = chunk.toString();
    if (text.includes("SECURITY WARNING: The SSL modes 'prefer', 'require', and 'verify-ca'")) return;

    if (text.includes('Cannot find module')) {
      startupFailed = true;
      const reason = text
        .split('\n')
        .map((line) => line.trim())
        .find((line) => line.startsWith('Error: Cannot find module')) || text.trim();
      console.error('Failed to start Hook API');
      console.error(`Reason: ${reason.replace(/^Error:\s*/, '')}`);
      return;
    }

    if (text.includes('NODE_MODULE_VERSION') || text.includes('compiled against a different Node.js version')) {
      startupFailed = true;
      const reason = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .join(' ');
      console.error('Failed to start Hook API');
      console.error(`Reason: ${reason.replace(/^Error:\s*/, '')}`);
      return;
    }

    process.stderr.write(chunk);
  });

  child.on('exit', (code, signal) => {
    if (restarting) return;
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;
    if (startupFailed) {
      startupFailed = false;
    }
    process.exit(code ?? 0);
  });
}

function restart() {
  if (!child || restarting) return;

  restarting = true;
  child.once('exit', () => {
    restarting = false;
    start();
  });
  child.kill('SIGTERM');
}

function stop() {
  if (child) child.kill('SIGTERM');
  process.exit(0);
}

if (process.stdin.isTTY) {
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');
  process.stdin.on('data', (key) => {
    if (key === '\u0003') stop();
    if (key.toLowerCase() === 'r') restart();
  });
}

process.on('SIGINT', stop);
process.on('SIGTERM', stop);

start();
