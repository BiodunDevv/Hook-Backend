const { spawn } = require('child_process');
const path = require('path');

let child;
let restarting = false;
const useEnvDatabase = process.env.HOOK_USE_ENV_DB === 'true';

function printBanner() {
  console.clear();
  console.log('Hook API dev');
  console.log(`Database: ${useEnvDatabase ? 'from .env' : 'local SQLite'}`);
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
      ...(useEnvDatabase
        ? {}
        : {
            NODE_ENV: 'development',
            DB_TYPE: 'sqlite',
            DB_DATABASE: 'data/hook_dev.sqlite',
            DB_SYNCHRONIZE: 'true',
            DATABASE_URL: '',
            DB_HOST: '',
            DB_PORT: '',
            DB_USERNAME: '',
            DB_PASSWORD: '',
            DB_SSL: 'false',
          }),
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
    process.stderr.write(chunk);
  });

  child.on('exit', (code, signal) => {
    if (restarting) return;
    if (signal === 'SIGTERM' || signal === 'SIGINT') return;
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
