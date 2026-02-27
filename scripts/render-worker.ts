/**
 * Render Free Tier Worker Entry Point
 * 
 * Wraps the messaging workers (Telegram, Discord, WhatsApp) with a minimal
 * HTTP health-check server so Render treats this as a "Web Service" (free tier)
 * instead of a "Background Worker" (paid tier).
 * 
 * The HTTP server binds to PORT (required by Render) and serves:
 *   GET /           → Health check (returns JSON status)
 *   GET /health     → Same health check
 *   GET /logs       → Recent logs from all workers (HTML page, auto-refreshes)
 *   GET /logs/raw   → Raw JSON log entries
 * 
 * Meanwhile, the actual workers run as normal in the background.
 * 
 * Usage:
 *   npm run worker:render
 *   or
 *   tsx scripts/render-worker.ts
 * 
 * Environment Variables:
 *   PORT             - Required by Render (auto-set by Render)
 *   MONGODB_URI      - MongoDB connection string
 *   OPENAI_API_KEY   - OpenAI API key
 *   ENABLE_TELEGRAM  - Set to "false" to disable (default: enabled)
 *   ENABLE_DISCORD   - Set to "false" to disable (default: enabled)
 *   ENABLE_WHATSAPP  - Set to "true" to enable (default: disabled, needs too much RAM)
 */

import http from 'http';
import { spawn, ChildProcess } from 'child_process';
import path from 'path';

// ============================================================
// Configuration
// ============================================================
const PORT = parseInt(process.env.PORT || '10000', 10);
const ENABLE_TELEGRAM = process.env.ENABLE_TELEGRAM !== 'false'; // enabled by default
const ENABLE_DISCORD = process.env.ENABLE_DISCORD !== 'false';   // enabled by default
const ENABLE_WHATSAPP = process.env.ENABLE_WHATSAPP === 'true';  // disabled by default (Chromium uses too much RAM for Render free tier)

// ============================================================
// Log buffer (circular buffer for recent logs)
// ============================================================
const MAX_LOG_ENTRIES = 500;
interface LogEntry {
    timestamp: string;
    worker: string;
    level: 'info' | 'error' | 'warn';
    message: string;
}
const logBuffer: LogEntry[] = [];

function addLog(worker: string, level: 'info' | 'error' | 'warn', message: string) {
    const entry: LogEntry = {
        timestamp: new Date().toISOString(),
        worker,
        level,
        message: message.trim(),
    };
    logBuffer.push(entry);
    // Keep buffer size under limit
    while (logBuffer.length > MAX_LOG_ENTRIES) {
        logBuffer.shift();
    }
}

// Track worker processes
const workers: { name: string; process: ChildProcess; status: string; startedAt: Date; restarts: number }[] = [];
const startTime = new Date();

// ============================================================
// Start a worker as a child process
// ============================================================
function startWorker(name: string, scriptPath: string) {
    const fullPath = path.resolve(__dirname, scriptPath);
    console.log(`🚀 [RENDER] Starting ${name} worker: ${fullPath}`);
    addLog('RENDER', 'info', `Starting ${name} worker: ${fullPath}`);

    const child = spawn('npx', ['tsx', fullPath], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env },
        shell: true,
    });

    const workerInfo = {
        name,
        process: child,
        status: 'running',
        startedAt: new Date(),
        restarts: 0,
    };

    // Pipe worker stdout/stderr to main process with prefix + log buffer
    child.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
            if (line.trim()) {
                console.log(`[${name}] ${line}`);
                addLog(name, 'info', line);
            }
        });
    });

    child.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
            if (line.trim()) {
                console.error(`[${name}] ${line}`);
                addLog(name, 'error', line);
            }
        });
    });

    // Handle worker exit with auto-restart
    child.on('exit', (code, signal) => {
        workerInfo.status = `exited (code: ${code}, signal: ${signal})`;
        const msg = `${name} worker exited with code ${code}, signal ${signal}`;
        console.warn(`⚠️ [RENDER] ${msg}`);
        addLog('RENDER', 'warn', msg);

        // Auto-restart after delay (with backoff)
        const restartDelay = Math.min(5000 * Math.pow(2, workerInfo.restarts), 60000); // max 60s
        workerInfo.restarts++;
        const restartMsg = `Restarting ${name} worker in ${restartDelay / 1000}s (restart #${workerInfo.restarts})...`;
        console.log(`🔄 [RENDER] ${restartMsg}`);
        addLog('RENDER', 'info', restartMsg);

        setTimeout(() => {
            console.log(`🔄 [RENDER] Restarting ${name} worker now...`);
            addLog('RENDER', 'info', `Restarting ${name} worker now...`);
            const newWorkerInfo = startWorker(name, scriptPath);
            // Replace the old worker entry
            const idx = workers.findIndex(w => w.name === name);
            if (idx !== -1) {
                workers[idx] = { ...newWorkerInfo, restarts: workerInfo.restarts };
            }
        }, restartDelay);
    });

    child.on('error', (error) => {
        workerInfo.status = `error: ${error.message}`;
        console.error(`❌ [RENDER] ${name} worker error:`, error.message);
        addLog(name, 'error', `Worker error: ${error.message}`);
    });

    workers.push(workerInfo);
    return workerInfo;
}

// ============================================================
// HTML logs page
// ============================================================
function renderLogsHTML(filter?: string): string {
    const filteredLogs = filter
        ? logBuffer.filter(l => l.worker === filter.toUpperCase())
        : logBuffer;

    // Take last 200 entries for display
    const displayLogs = filteredLogs.slice(-200);

    const workerColors: Record<string, string> = {
        TELEGRAM: '#3B82F6',
        DISCORD: '#8B5CF6',
        WHATSAPP: '#22C55E',
        RENDER: '#F59E0B',
    };

    const levelColors: Record<string, string> = {
        info: '#E5E7EB',
        error: '#EF4444',
        warn: '#F59E0B',
    };

    const logRows = displayLogs.map(log => {
        const wColor = workerColors[log.worker] || '#9CA3AF';
        const lColor = levelColors[log.level] || '#E5E7EB';
        const time = log.timestamp.replace('T', ' ').substring(0, 19);
        // Escape HTML
        const msg = log.message
            .replace(/&/g, '&amp;')
            .replace(/</g, '&lt;')
            .replace(/>/g, '&gt;');

        return `<div class="log-line">
      <span class="time">${time}</span>
      <span class="worker" style="color:${wColor}">[${log.worker}]</span>
      <span class="msg" style="color:${lColor}">${msg}</span>
    </div>`;
    }).join('\n');

    const activeFilter = filter?.toUpperCase() || 'ALL';
    const filterButtons = ['ALL', 'TELEGRAM', 'DISCORD', 'WHATSAPP', 'RENDER'].map(f => {
        const isActive = activeFilter === f;
        const url = f === 'ALL' ? '/logs' : `/logs?worker=${f.toLowerCase()}`;
        return `<a href="${url}" class="filter-btn ${isActive ? 'active' : ''}">${f}</a>`;
    }).join('\n');

    return `<!DOCTYPE html>
<html>
<head>
  <title>ONFA Workers — Logs</title>
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta http-equiv="refresh" content="5">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0a0a0a;
      color: #e5e7eb;
      font-family: 'Courier New', monospace;
      font-size: 13px;
      line-height: 1.5;
    }
    .header {
      background: #111;
      border-bottom: 1px solid #333;
      padding: 12px 16px;
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex-wrap: wrap;
      gap: 10px;
      position: sticky;
      top: 0;
      z-index: 10;
    }
    .title {
      font-size: 16px;
      font-weight: 600;
      color: #f0b90b;
    }
    .controls {
      display: flex;
      gap: 8px;
      align-items: center;
      flex-wrap: wrap;
    }
    .filter-btn {
      padding: 4px 12px;
      border-radius: 4px;
      background: #222;
      color: #9ca3af;
      text-decoration: none;
      font-size: 12px;
      font-family: inherit;
      border: 1px solid #333;
      transition: all 0.2s;
    }
    .filter-btn:hover { background: #333; color: #fff; }
    .filter-btn.active { background: #f0b90b; color: #000; border-color: #f0b90b; font-weight: 600; }
    .meta {
      color: #6b7280;
      font-size: 11px;
      padding: 8px 16px;
      border-bottom: 1px solid #222;
    }
    .logs {
      padding: 8px 16px;
      overflow-x: auto;
    }
    .log-line {
      white-space: pre-wrap;
      word-break: break-all;
      padding: 1px 0;
    }
    .log-line:hover { background: #1a1a1a; }
    .time { color: #6b7280; margin-right: 8px; }
    .worker { font-weight: 600; margin-right: 8px; min-width: 100px; display: inline-block; }
    .msg { }
    .nav-links { display: flex; gap: 16px; }
    .nav-links a { color: #60a5fa; text-decoration: none; font-size: 12px; }
    .nav-links a:hover { text-decoration: underline; }
    .status-bar {
      display: flex;
      gap: 16px;
      padding: 8px 16px;
      background: #111;
      border-bottom: 1px solid #222;
      font-size: 11px;
      color: #9ca3af;
      flex-wrap: wrap;
    }
    .status-item { display: flex; gap: 4px; align-items: center; }
    .status-dot { width: 8px; height: 8px; border-radius: 50%; }
    .status-dot.running { background: #22c55e; }
    .status-dot.error { background: #ef4444; }
    .status-dot.exited { background: #f59e0b; }
    .empty { color: #6b7280; padding: 40px; text-align: center; }
  </style>
</head>
<body>
  <div class="header">
    <span class="title">🤖 ONFA Workers — Logs</span>
    <div class="controls">
      ${filterButtons}
    </div>
    <div class="nav-links">
      <a href="/health">Health JSON</a>
      <a href="/logs/raw">Raw JSON</a>
    </div>
  </div>
  <div class="status-bar">
    ${workers.map(w => {
        const dotClass = w.status === 'running' ? 'running' : w.status.startsWith('error') ? 'error' : 'exited';
        return `<div class="status-item">
        <div class="status-dot ${dotClass}"></div>
        <span>${w.name}: ${w.status} (PID: ${w.process.pid || '?'}, restarts: ${w.restarts})</span>
      </div>`;
    }).join('\n')}
    <div class="status-item">
      <span>Memory: ${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB RSS</span>
    </div>
  </div>
  <div class="meta">
    Showing last ${displayLogs.length} of ${logBuffer.length} entries (max ${MAX_LOG_ENTRIES}) · Auto-refreshes every 5s · Filter: ${activeFilter}
  </div>
  <div class="logs">
    ${displayLogs.length > 0 ? logRows : '<div class="empty">No logs yet. Workers are starting up...</div>'}
  </div>
  <script>
    // Auto-scroll to bottom on load
    window.scrollTo(0, document.body.scrollHeight);
  </script>
</body>
</html>`;
}

// ============================================================
// Health check HTTP server
// ============================================================
const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    const url = new URL(req.url || '/', `http://localhost:${PORT}`);

    // Health check (JSON)
    if (url.pathname === '/' || url.pathname === '/health') {
        res.setHeader('Content-Type', 'application/json');
        const uptime = Math.floor((Date.now() - startTime.getTime()) / 1000);
        const workerStatuses = workers.map(w => ({
            name: w.name,
            status: w.status,
            pid: w.process.pid || null,
            startedAt: w.startedAt.toISOString(),
            restarts: w.restarts,
        }));

        const health = {
            status: 'ok',
            service: 'onfaagent-workers',
            uptime: `${Math.floor(uptime / 3600)}h ${Math.floor((uptime % 3600) / 60)}m ${uptime % 60}s`,
            startedAt: startTime.toISOString(),
            workers: workerStatuses,
            memory: {
                rss: `${Math.round(process.memoryUsage().rss / 1024 / 1024)}MB`,
                heapUsed: `${Math.round(process.memoryUsage().heapUsed / 1024 / 1024)}MB`,
            },
            endpoints: ['/', '/health', '/logs', '/logs/raw'],
        };

        res.writeHead(200);
        res.end(JSON.stringify(health, null, 2));
        return;
    }

    // Logs page (HTML)
    if (url.pathname === '/logs') {
        res.setHeader('Content-Type', 'text/html; charset=utf-8');
        const filter = url.searchParams.get('worker') || undefined;
        res.writeHead(200);
        res.end(renderLogsHTML(filter));
        return;
    }

    // Raw logs (JSON)
    if (url.pathname === '/logs/raw') {
        res.setHeader('Content-Type', 'application/json');
        const filter = url.searchParams.get('worker')?.toUpperCase();
        const count = parseInt(url.searchParams.get('count') || '100', 10);
        const filtered = filter
            ? logBuffer.filter(l => l.worker === filter)
            : logBuffer;
        res.writeHead(200);
        res.end(JSON.stringify({
            total: filtered.length,
            showing: Math.min(count, filtered.length),
            filter: filter || 'ALL',
            logs: filtered.slice(-count),
        }, null, 2));
        return;
    }

    // 404 for everything else
    res.setHeader('Content-Type', 'application/json');
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found', endpoints: ['/', '/health', '/logs', '/logs/raw'] }));
});

// ============================================================
// Main startup
// ============================================================
console.log('='.repeat(60));
console.log('🚀 ONFA Agent Workers — Render Free Tier Mode');
console.log('='.repeat(60));
console.log(`📋 Configuration:`);
console.log(`   PORT: ${PORT}`);
console.log(`   Telegram: ${ENABLE_TELEGRAM ? '✅ Enabled' : '❌ Disabled'}`);
console.log(`   Discord:  ${ENABLE_DISCORD ? '✅ Enabled' : '❌ Disabled'}`);
console.log(`   WhatsApp: ${ENABLE_WHATSAPP ? '✅ Enabled' : '❌ Disabled'}`);
console.log(`   MongoDB:  ${process.env.MONGODB_URI ? '✅ Configured' : '❌ Missing'}`);
console.log(`   OpenAI:   ${process.env.OPENAI_API_KEY ? '✅ Configured' : '❌ Missing'}`);
console.log('='.repeat(60));

addLog('RENDER', 'info', 'ONFA Agent Workers starting...');
addLog('RENDER', 'info', `Telegram: ${ENABLE_TELEGRAM ? 'Enabled' : 'Disabled'}`);
addLog('RENDER', 'info', `Discord: ${ENABLE_DISCORD ? 'Enabled' : 'Disabled'}`);
addLog('RENDER', 'info', `WhatsApp: ${ENABLE_WHATSAPP ? 'Enabled' : 'Disabled'}`);

// Start HTTP server first (Render needs this to detect the service is alive)
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🌐 [RENDER] Health check server listening on port ${PORT}`);
    console.log(`   → http://0.0.0.0:${PORT}/health`);
    console.log(`   → http://0.0.0.0:${PORT}/logs\n`);
    addLog('RENDER', 'info', `HTTP server listening on port ${PORT}`);

    // Start workers AFTER the HTTP server is listening
    if (ENABLE_TELEGRAM) {
        startWorker('TELEGRAM', 'telegram-worker.ts');
    }

    if (ENABLE_DISCORD) {
        startWorker('DISCORD', 'discord-worker.ts');
    }

    if (ENABLE_WHATSAPP) {
        startWorker('WHATSAPP', 'whatsapp-web-worker.ts');
    }

    if (!ENABLE_TELEGRAM && !ENABLE_DISCORD && !ENABLE_WHATSAPP) {
        console.warn('⚠️ [RENDER] No workers enabled! Set ENABLE_TELEGRAM, ENABLE_DISCORD, or ENABLE_WHATSAPP to "true"');
        addLog('RENDER', 'warn', 'No workers enabled!');
    }
});

// ============================================================
// Graceful shutdown
// ============================================================
function shutdown(signal: string) {
    console.log(`\n🛑 [RENDER] Received ${signal}, shutting down gracefully...`);
    addLog('RENDER', 'warn', `Received ${signal}, shutting down...`);

    // Kill all worker child processes
    for (const worker of workers) {
        try {
            if (worker.process.pid) {
                console.log(`   Stopping ${worker.name} (PID: ${worker.process.pid})...`);
                worker.process.kill('SIGTERM');
            }
        } catch (error) {
            console.error(`   Error stopping ${worker.name}:`, error);
        }
    }

    // Close HTTP server
    server.close(() => {
        console.log('✅ [RENDER] HTTP server closed');
        process.exit(0);
    });

    // Force exit after 10 seconds
    setTimeout(() => {
        console.error('⚠️ [RENDER] Forced exit after timeout');
        process.exit(1);
    }, 10000);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
