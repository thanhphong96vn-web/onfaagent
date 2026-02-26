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
 *   ENABLE_TELEGRAM  - Set to "true" to enable Telegram worker (default: true)
 *   ENABLE_DISCORD   - Set to "true" to enable Discord worker (default: true)
 *   ENABLE_WHATSAPP  - Set to "true" to enable WhatsApp worker (default: false)
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
const ENABLE_WHATSAPP = process.env.ENABLE_WHATSAPP === 'true';  // disabled by default (needs Puppeteer/Chromium)

// Track worker processes
const workers: { name: string; process: ChildProcess; status: string; startedAt: Date; restarts: number }[] = [];
const startTime = new Date();

// ============================================================
// Start a worker as a child process
// ============================================================
function startWorker(name: string, scriptPath: string) {
    const fullPath = path.resolve(__dirname, scriptPath);
    console.log(`🚀 [RENDER] Starting ${name} worker: ${fullPath}`);

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

    // Pipe worker stdout/stderr to main process with prefix
    child.stdout?.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
            if (line.trim()) console.log(`[${name}] ${line}`);
        });
    });

    child.stderr?.on('data', (data: Buffer) => {
        const lines = data.toString().trim().split('\n');
        lines.forEach(line => {
            if (line.trim()) console.error(`[${name}] ${line}`);
        });
    });

    // Handle worker exit with auto-restart
    child.on('exit', (code, signal) => {
        workerInfo.status = `exited (code: ${code}, signal: ${signal})`;
        console.warn(`⚠️ [RENDER] ${name} worker exited with code ${code}, signal ${signal}`);

        // Auto-restart after delay (with backoff)
        const restartDelay = Math.min(5000 * Math.pow(2, workerInfo.restarts), 60000); // max 60s
        workerInfo.restarts++;
        console.log(`🔄 [RENDER] Restarting ${name} worker in ${restartDelay / 1000}s (restart #${workerInfo.restarts})...`);

        setTimeout(() => {
            console.log(`🔄 [RENDER] Restarting ${name} worker now...`);
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
    });

    workers.push(workerInfo);
    return workerInfo;
}

// ============================================================
// Health check HTTP server
// ============================================================
const server = http.createServer((req, res) => {
    // CORS headers
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Content-Type', 'application/json');

    if (req.method === 'OPTIONS') {
        res.writeHead(204);
        res.end();
        return;
    }

    if (req.url === '/' || req.url === '/health') {
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
        };

        res.writeHead(200);
        res.end(JSON.stringify(health, null, 2));
        return;
    }

    // 404 for everything else
    res.writeHead(404);
    res.end(JSON.stringify({ error: 'Not found' }));
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

// Start HTTP server first (Render needs this to detect the service is alive)
server.listen(PORT, '0.0.0.0', () => {
    console.log(`\n🌐 [RENDER] Health check server listening on port ${PORT}`);
    console.log(`   → http://0.0.0.0:${PORT}/health\n`);

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
    }
});

// ============================================================
// Graceful shutdown
// ============================================================
function shutdown(signal: string) {
    console.log(`\n🛑 [RENDER] Received ${signal}, shutting down gracefully...`);

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
