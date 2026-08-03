import { loadCatalog } from './pricing';
import { DatabaseManager } from './db';
import { readSessionTranscript, getAvailableSessionIds } from './sessionsReader';
import { existsSync } from 'fs';
import { join } from 'path';

const PORT = parseInt(process.env.PORT || '8080', 10);
const DIST_DIR = join(import.meta.dir, '../dist');

async function startServer() {
  console.log('🚀 Initializing AI Usage Dashboard (Bun Runtime)...');

  // Load catalog
  const catalog = await loadCatalog();
  console.log(`  Catalog loaded with ${Object.keys(catalog.providers || {}).length} providers.`);

  // Load Database
  const dbManager = new DatabaseManager(catalog);
  await dbManager.ready();
  console.log('  Connected to Postgres token usage database');

  // Auto ingest historic sessions (deferred to avoid startup CPU spike)
  setTimeout(() => {
    dbManager.autoIngestHistoricSessions().catch(err => console.warn('Historic ingest error:', err));
  }, 10_000);

  const server = Bun.serve({
    port: PORT,
    async fetch(req) {
      const url = new URL(req.url);
      const path = url.pathname;

      // Enable CORS
      const corsHeaders = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      };

      if (req.method === 'OPTIONS') {
        return new Response(null, { headers: corsHeaders });
      }

      // API Endpoints
      if (path === '/api/summary') {
        const timeframe = (url.searchParams.get('timeframe') as any) || 'all';
        return Response.json(await dbManager.getSummary(timeframe), { headers: corsHeaders });
      }

      if (path === '/api/models/top') {
        const by = (url.searchParams.get('by') as any) || 'cost';
        const limit = parseInt(url.searchParams.get('limit') || '5', 10);
        const timeframe = (url.searchParams.get('timeframe') as any) || 'all';
        return Response.json(await dbManager.getTopModels(by, limit, timeframe), { headers: corsHeaders });
      }

      if (path === '/api/timeline') {
        const unit = (url.searchParams.get('unit') as any) || 'daily';
        return Response.json(await dbManager.getTimeline(unit), { headers: corsHeaders });
      }

      if (path === '/api/subscriptions' || path.startsWith('/api/subscriptions/')) {
        if (req.method === 'POST') {
          try {
            const body = (await req.json()) as any;
            const { providerId, cost, cycle = 'monthly' } = body;
            if (providerId && typeof cost === 'number') {
              await dbManager.addSubscription(providerId, cost, cycle);
              return Response.json({ success: true }, { headers: corsHeaders });
            }
            return Response.json({ error: 'Missing providerId or cost' }, { status: 400, headers: corsHeaders });
          } catch (err) {
            return Response.json({ error: String(err) }, { status: 400, headers: corsHeaders });
          }
        }

        if (req.method === 'DELETE') {
          const parts = path.split('/');
          const pid = parts[3] || url.searchParams.get('providerId');
          if (pid) {
            await dbManager.removeSubscription(pid);
            return Response.json({ success: true }, { headers: corsHeaders });
          }
          return Response.json({ error: 'Missing providerId' }, { status: 400, headers: corsHeaders });
        }

        return Response.json(await dbManager.getSubscriptions(), { headers: corsHeaders });
      }

      if (path === '/api/db/stats') {
        return Response.json(await dbManager.getDbStats(), { headers: corsHeaders });
      }

      if (path === '/api/db/rows') {
        const limit = parseInt(url.searchParams.get('limit') || '50', 10);
        const offset = parseInt(url.searchParams.get('offset') || '0', 10);
        const search = url.searchParams.get('search') || '';
        const model = url.searchParams.get('model') || '';
        const caller = url.searchParams.get('caller') || '';
        const sortColumn = url.searchParams.get('sortColumn') || 'id';
        const sortOrder = (url.searchParams.get('sortOrder') as any) || 'desc';

        return Response.json(
          await dbManager.getDbRows(limit, offset, search, model, caller, sortColumn, sortOrder),
          { headers: corsHeaders }
        );
      }

      if (path === '/api/db/query' && req.method === 'POST') {
        try {
          const body = (await req.json()) as any;
          const sql = body?.sql || '';
          return Response.json(await dbManager.executeReadOnlySql(sql), { headers: corsHeaders });
        } catch (err: any) {
          return Response.json({ error: err?.message || String(err) }, { status: 400, headers: corsHeaders });
        }
      }

      if (path === '/api/db/action' && req.method === 'POST') {
        try {
          const body = (await req.json()) as any;
          const action = body?.action as 'vacuum' | 'reindex' | 'analyze';
          return Response.json(await dbManager.performDbAction(action), { headers: corsHeaders });
        } catch (err: any) {
          return Response.json({ error: err?.message || String(err) }, { status: 400, headers: corsHeaders });
        }
      }

      if (path === '/api/providers/all') {
        return Response.json(await dbManager.getAllCatalogProviders(), { headers: corsHeaders });
      }

      if (path === '/api/providers') {
        return Response.json(await dbManager.getProviders(), { headers: corsHeaders });
      }

      if (path === '/api/catalog/search') {
        const q = url.searchParams.get('q') || '';
        const limit = parseInt(url.searchParams.get('limit') || '40', 10);
        const { searchCatalogModels } = await import('./pricing');
        return Response.json(searchCatalogModels(catalog, q, limit), { headers: corsHeaders });
      }

      if (path === '/api/models/cross-provider') {
        return Response.json(await dbManager.getCrossProviderModels(), { headers: corsHeaders });
      }

      if (path === '/api/models') {
        const provider = url.searchParams.get('provider') || undefined;
        return Response.json(await dbManager.getModels(provider), { headers: corsHeaders });
      }

      if (path === '/api/sessions') {
        const page = parseInt(url.searchParams.get('page') || '1', 10);
        const limit = parseInt(url.searchParams.get('limit') || '20', 10);
        const search = url.searchParams.get('search') || '';
        // Walk ~/.pi/agent/sessions once per request so the list can flag rows
        // whose transcript JSONL is missing or has been pruned.
        const availableIds = getAvailableSessionIds();
        return Response.json(await dbManager.getSessions(page, limit, search, '', availableIds), { headers: corsHeaders });
      }

      if (path === '/api/export/sessions') {
        const sessionsData = await dbManager.getSessions(1, 10000);
        let csv = 'Session ID,First Turn,Last Turn,Turns,Input Tokens,Output Tokens,Cache Read Tokens,Cost ($)\n';
        for (const s of sessionsData.items) {
          csv += `"${s.sessionId}","${s.firstTurn}","${s.lastTurn}",${s.turnCount},${s.inputTokens},${s.outputTokens},${s.cacheReadTokens},${s.totalCost}\n`;
        }
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="pi-sessions-usage.csv"',
            ...corsHeaders,
          },
        });
      }

      if (path === '/api/export/models') {
        const modelsData = await dbManager.getModels();
        let csv = 'Model,Provider,Turns,Sessions,Input Tokens,Output Tokens,Cache Read Tokens,Cost ($)\n';
        for (const m of modelsData) {
          csv += `"${m.model}","${m.providerName}",${m.turns},${m.sessionsCount},${m.inputTokens},${m.outputTokens},${m.cacheReadTokens},${m.totalCost}\n`;
        }
        return new Response(csv, {
          headers: {
            'Content-Type': 'text/csv',
            'Content-Disposition': 'attachment; filename="pi-models-breakdown.csv"',
            ...corsHeaders,
          },
        });
      }

      if (path === '/api/export/analytics') {
        const summary = await dbManager.getSummary('all');
        const timeline = await dbManager.getTimeline('daily');
        const models = await dbManager.getModels();
        const providers = await dbManager.getProviders();
        return Response.json({ summary, timeline, models, providers }, { headers: corsHeaders });
      }

      if (path.startsWith('/api/sessions/')) {
        const parts = path.split('/');
        const sessionId = parts[3];
        if (parts[4] === 'chat' || parts.length === 4) {
          const transcript = readSessionTranscript(sessionId);
          if (!transcript) {
            return Response.json({ error: 'Session transcript not found' }, { status: 404, headers: corsHeaders });
          }
          return Response.json(transcript, { headers: corsHeaders });
        }
      }

      // Proxy Logos from models.dev
      if (path.startsWith('/logos/')) {
        const logoUrl = `https://models.dev${path}`;
        try {
          const logoRes = await fetch(logoUrl);
          if (logoRes.ok) {
            const body = await logoRes.arrayBuffer();
            return new Response(body, {
              headers: {
                'Content-Type': logoRes.headers.get('Content-Type') || 'image/svg+xml',
                'Cache-Control': 'public, max-age=86400',
                ...corsHeaders,
              },
            });
          }
        } catch {
          // fallback
        }
        return new Response('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/></svg>', {
          headers: { 'Content-Type': 'image/svg+xml', ...corsHeaders },
        });
      }

      // Serve Static SPA (dist)
      let filePath = join(DIST_DIR, path === '/' ? 'index.html' : path);
      const isAsset = path.startsWith('/assets/');

      if (!existsSync(filePath) || (existsSync(filePath) && Bun.file(filePath).size === 0)) {
        filePath = join(DIST_DIR, 'index.html');
      }

      if (existsSync(filePath)) {
        const file = Bun.file(filePath);
        return new Response(file, {
          headers: {
            'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
            ...corsHeaders,
          },
        });
      }

      return new Response('Dashboard build not found. Run bun run build first.', { status: 404 });
    },
  });

  console.log(`\n✨ AI Usage Dashboard server running at http://localhost:${server.port}`);
  return server;
}

if (import.meta.main) {
  startServer();
}

export { startServer };
