const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');

const cwd = process.cwd();
const isWin = process.platform === 'win32';
const shell = isWin ? true : false;
const electronPath = require('electron');
const viteCliPath = path.join(cwd, 'node_modules', 'vite', 'bin', 'vite.js');
const esbuildFallbackPath = path.join(
  cwd,
  'node_modules',
  '@esbuild',
  'win32-x64',
  'esbuild.exe'
);

const sharedEnv = {
  ...process.env
};

// On some Windows setups, esbuild inside pnpm .store cannot be spawned (EPERM).
// Pinning ESBUILD_BINARY_PATH to direct node_modules path avoids the failure.
if (isWin && !sharedEnv.ESBUILD_BINARY_PATH && fs.existsSync(esbuildFallbackPath)) {
  sharedEnv.ESBUILD_BINARY_PATH = esbuildFallbackPath;
}

const header = [
  '========================================',
  'AI course designer - dev mode',
  '========================================'
];
console.log(header.join('\n'));

let electronStarted = false;
let lastDevUrl = null;

const startElectron = (devUrl) => {
  if (electronStarted) return;
  electronStarted = true;
  lastDevUrl = devUrl;
  console.log(`Starting Electron with ${devUrl}`);
  const env = {
    ...sharedEnv,
    NODE_ENV: 'development',
    VITE_DEV_SERVER_URL: devUrl
  };
  delete env.ELECTRON_RUN_AS_NODE;
  spawn(electronPath, ['./src/main/index.js'], {
    cwd,
    env,
    stdio: 'inherit'
  });
};

const useDirectViteCli = fs.existsSync(viteCliPath);
const viteCommand = useDirectViteCli ? process.execPath : (isWin ? 'npx.cmd' : 'npx');
const viteArgs = useDirectViteCli ? [viteCliPath] : ['vite'];
const vite = spawn(viteCommand, viteArgs, {
  cwd,
  env: sharedEnv,
  stdio: ['ignore', 'pipe', 'pipe'],
  shell: useDirectViteCli ? false : shell
});

const tryParseDevUrl = (chunk) => {
  const text = chunk.toString();
  const plainText = text.replace(/\u001b\[[0-9;]*m/g, '');
  const match = plainText.match(/http:\/\/localhost:(\d+)/);
  if (match && !electronStarted) {
    startElectron(`http://localhost:${match[1]}`);
  }
};

vite.stdout.on('data', (chunk) => {
  process.stdout.write(chunk);
  tryParseDevUrl(chunk);
});

vite.stderr.on('data', (chunk) => {
  process.stderr.write(chunk);
  tryParseDevUrl(chunk);
});

vite.on('exit', (code) => {
  if (code !== 0) {
    console.error(`Vite exited with code ${code}`);
  }
  if (!electronStarted) {
    const fallbackUrl = lastDevUrl || 'http://localhost:5173';
    console.log('Vite exited before Electron started; using fallback URL.');
    startElectron(fallbackUrl);
  }
});
