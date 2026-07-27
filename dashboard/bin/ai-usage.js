#!/usr/bin/env bun
import { existsSync } from 'fs';
import { join } from 'path';
import { execSync, spawn } from 'child_process';
import { startServer } from '../src/server';

const args = process.argv.slice(2);
let port = 8080;
let noOpen = false;

for (let i = 0; i < args.length; i++) {
  if (args[i] === '--port' && args[i + 1]) {
    port = parseInt(args[i + 1], 10);
    i++;
  } else if (args[i] === '--no-open') {
    noOpen = true;
  } else if (args[i] === '--help' || args[i] === '-h') {
    console.log(`
Usage: ai-usage [options]

Options:
  --port <number>   Port to run the dashboard server on (default: 8080)
  --no-open         Do not automatically open browser on start
  --help, -h        Show help message
`);
    process.exit(0);
  }
}

process.env.PORT = port.toString();

const distDir = join(import.meta.dir, '../dist');
const indexHtml = join(distDir, 'index.html');

if (!existsSync(indexHtml)) {
  console.log('📦 Frontend bundle not found. Building dashboard UI with Vite...');
  try {
    execSync('bun run build', { cwd: join(import.meta.dir, '..'), stdio: 'inherit' });
  } catch (err) {
    console.error('Failed to build frontend bundle:', err);
  }
}

async function main() {
  const server = await startServer();
  const url = `http://localhost:${server.port}`;

  console.log(`
╔═══════════════════════════════════════════════════════════╗
║                                                           ║
║   🤖  AI USAGE DASHBOARD (Powered by Bun & SQLite)        ║
║                                                           ║
║   Dashboard:  ${url.padEnd(41)} ║
║   Database:   ~/.pi/token-usage.db                        ║
║   Sessions:   ~/.pi/agent/sessions/                       ║
║                                                           ║
║   Press Ctrl+C to stop the server                         ║
╚═══════════════════════════════════════════════════════════╝
`);

  if (!noOpen) {
    try {
      if (process.platform === 'darwin') {
        spawn('open', [url], { detached: true, stdio: 'ignore' });
      } else if (process.platform === 'win32') {
        spawn('cmd', ['/c', 'start', url], { detached: true, stdio: 'ignore' });
      } else {
        spawn('xdg-open', [url], { detached: true, stdio: 'ignore' });
      }
      console.log(`🌐 Opened Safari / Default Browser to ${url}`);
    } catch (err) {
      console.log(`Could not automatically open browser: ${err}`);
    }
  }
}

main();
