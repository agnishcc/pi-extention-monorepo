import pg from 'pg';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { basename, join } from 'path';
import { calculateTurnCost, Catalog, findModelEntry, loadCatalog, resolveProvider } from './pricing';

const { Pool } = pg;

const DEFAULT_DATABASE_URL = 'postgres://pi_token_tracker:pi_token_tracker@localhost:5432/pi_token_usage';
const DATABASE_URL = process.env.PI_TOKEN_TRACKER_DATABASE_URL || process.env.DATABASE_URL || DEFAULT_DATABASE_URL;
const SESSIONS_DIR = join(homedir(), '.pi', 'agent', 'sessions');

type TokenRow = {
  id: number | string;
  timestamp: string;
  session_id: string;
  caller: string;
  agent_id: string | null;
  agent_type: string | null;
  model: string;
  turn_number: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
};

function databaseLabel() {
  try {
    const url = new URL(DATABASE_URL);
    if (url.password) url.password = '***';
    return url.toString();
  } catch {
    return 'postgres';
  }
}

function quoteIdent(identifier: string) {
  return `"${identifier.replace(/"/g, '""')}"`;
}

export class DatabaseManager {
  private pool: pg.Pool;
  private initPromise: Promise<void>;
  public catalog: Catalog;

  constructor(catalog: Catalog) {
    this.catalog = catalog;
    this.pool = new Pool({
      connectionString: DATABASE_URL,
      application_name: 'ai-usage-dashboard',
      max: Number(process.env.PI_TOKEN_DASHBOARD_PG_POOL_MAX || 6),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
    this.pool.on('error', (err) => {
      console.error('[DatabaseManager] Postgres pool error:', err);
    });
    this.initPromise = this.initTables();
  }

  public async ready() {
    await this.initPromise;
  }

  private async safeQuery<T = any>(sql: string, params: any[] = []): Promise<T[]> {
    await this.ready();
    const result = await this.pool.query<T>(sql, params);
    return result.rows;
  }

  private async safeGet<T = any>(sql: string, params: any[] = []): Promise<T | null> {
    const rows = await this.safeQuery<T>(sql, params);
    return rows[0] || null;
  }

  private async safeRun(sql: string, params: any[] = []): Promise<void> {
    await this.ready();
    await this.pool.query(sql, params);
  }

  private async initTables() {
    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS token_detailed (
        id BIGSERIAL PRIMARY KEY,
        timestamp TEXT NOT NULL,
        session_id TEXT NOT NULL,
        caller TEXT NOT NULL,
        agent_id TEXT,
        agent_type TEXT,
        model TEXT NOT NULL,
        turn_number INTEGER NOT NULL,
        input_tokens INTEGER NOT NULL,
        output_tokens INTEGER NOT NULL,
        cache_read_tokens INTEGER DEFAULT 0,
        cache_write_tokens INTEGER DEFAULT 0
      );
    `);
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_token_detailed_session ON token_detailed(session_id);');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_token_detailed_model ON token_detailed(model);');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_token_detailed_timestamp ON token_detailed(timestamp);');
    await this.pool.query('CREATE INDEX IF NOT EXISTS idx_token_detailed_caller ON token_detailed(caller);');

    await this.pool.query(`
      CREATE TABLE IF NOT EXISTS provider_subscriptions (
        provider_id TEXT PRIMARY KEY,
        type TEXT DEFAULT 'subscription',
        cost REAL DEFAULT 0,
        cycle TEXT DEFAULT 'monthly',
        updated_at TEXT
      );
    `);
  }

  public async autoIngestHistoricSessions() {
    await this.ready();
    if (!existsSync(SESSIONS_DIR)) return;

    const existing = new Set<string>(
      (await this.safeQuery<{ session_id: string }>('SELECT DISTINCT session_id FROM token_detailed')).map((r) => r.session_id)
    );

    const jsonlFiles: string[] = [];
    const stack = [SESSIONS_DIR];

    while (stack.length > 0) {
      const current = stack.pop()!;
      try {
        const entries = readdirSync(current, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = join(current, entry.name);
          if (entry.isDirectory()) {
            if (entry.name !== 'subagent-artifacts' && !entry.name.startsWith('.')) {
              stack.push(fullPath);
            }
          } else if (entry.isFile() && entry.name.endsWith('.jsonl')) {
            jsonlFiles.push(fullPath);
          }
        }
      } catch {
        // ignore unreadable directories
      }
    }

    let newCount = 0;
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      for (const filepath of jsonlFiles) {
        let sessionId: string | null = null;
        const turns: any[][] = [];
        let turnNum = 0;
        let currentModel: string | null = null;

        try {
          const content = readFileSync(filepath, 'utf-8');
          const lines = content.split('\n');

          for (const line of lines) {
            if (!line.trim()) continue;
            try {
              const entry = JSON.parse(line);
              if (entry.type === 'session') {
                sessionId = entry.id || entry.data?.id;
              } else if (entry.type === 'model_change') {
                const prov = entry.provider;
                const mid = entry.modelId;
                if (mid) currentModel = prov ? `${prov}/${mid}` : mid;
              } else if (entry.type === 'message') {
                const msg = entry.message || {};
                if (msg.role === 'assistant' && msg.usage) {
                  turnNum++;
                  const ts = entry.timestamp || msg.timestamp || new Date().toISOString();
                  const m = msg.model ? (msg.provider ? `${msg.provider}/${msg.model}` : msg.model) : currentModel || 'unknown/unknown';
                  turns.push([
                    ts,
                    '',
                    'main',
                    null,
                    null,
                    m,
                    turnNum,
                    msg.usage.input || 0,
                    msg.usage.output || 0,
                    msg.usage.cacheRead || 0,
                    msg.usage.cacheWrite || 0,
                  ]);
                }
              }
            } catch {
              // skip malformed line
            }
          }

          if (!sessionId) {
            const fname = basename(filepath);
            const parts = fname.split('_');
            if (parts.length >= 2) {
              const cand = parts[1].replace('.jsonl', '');
              if (cand.includes('-') && cand.length > 20) sessionId = cand;
            }
          }

          if (sessionId && !existing.has(sessionId) && turns.length > 0) {
            for (const t of turns) {
              t[1] = sessionId;
              await client.query(
                `INSERT INTO token_detailed
                 (timestamp, session_id, caller, agent_id, agent_type, model, turn_number, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
                 VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
                t
              );
            }
            existing.add(sessionId);
            newCount++;
          }
        } catch {
          // skip unreadable file
        }
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      console.warn('[DatabaseManager] Historic session ingestion failed:', err);
    } finally {
      client.release();
    }

    if (newCount > 0) {
      console.log(`[DatabaseManager] Auto-ingested ${newCount} new sessions into Postgres.`);
    }
  }

  private timeframeWhere(timeframe: 'all' | 'monthly' | 'weekly' | 'daily') {
    const now = new Date();
    if (timeframe === 'monthly') return { clause: 'WHERE timestamp >= $1', params: [new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString()] };
    if (timeframe === 'weekly') return { clause: 'WHERE timestamp >= $1', params: [new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString()] };
    if (timeframe === 'daily') return { clause: 'WHERE timestamp >= $1', params: [new Date(now.getTime() - 24 * 3600 * 1000).toISOString()] };
    return { clause: '', params: [] };
  }

  public async getSummary(timeframe: 'all' | 'monthly' | 'weekly' | 'daily' = 'all') {
    const { clause, params } = this.timeframeWhere(timeframe);
    const rows = await this.safeQuery<TokenRow>(`SELECT * FROM token_detailed ${clause}`, params);

    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    let totalCacheSavings = 0;
    const sessionIds = new Set<string>();
    const callerAgg = { main: { turns: 0, cost: 0 }, subagent: { turns: 0, cost: 0 } };

    for (const r of rows) {
      sessionIds.add(r.session_id);
      totalInput += Number(r.input_tokens || 0);
      totalOutput += Number(r.output_tokens || 0);
      totalCacheRead += Number(r.cache_read_tokens || 0);
      totalCacheWrite += Number(r.cache_write_tokens || 0);

      const costRes = calculateTurnCost(this.catalog, r.model, Number(r.input_tokens || 0), Number(r.output_tokens || 0), Number(r.cache_read_tokens || 0), Number(r.cache_write_tokens || 0));
      totalCost += costRes.cost;
      totalCacheSavings += costRes.cacheSavings;

      const caller = r.caller === 'subagent' ? 'subagent' : 'main';
      callerAgg[caller].turns++;
      callerAgg[caller].cost += costRes.cost;
    }

    return {
      totalTurns: rows.length,
      totalSessions: sessionIds.size,
      totalInputTokens: totalInput,
      totalOutputTokens: totalOutput,
      totalCacheReadTokens: totalCacheRead,
      totalCacheWriteTokens: totalCacheWrite,
      totalCost: Number(totalCost.toFixed(4)),
      totalCacheSavings: Number(totalCacheSavings.toFixed(4)),
      callerBreakdown: {
        main: { turns: callerAgg.main.turns, cost: Number(callerAgg.main.cost.toFixed(4)) },
        subagent: { turns: callerAgg.subagent.turns, cost: Number(callerAgg.subagent.cost.toFixed(4)) },
      },
      timeframe,
    };
  }

  public async getTopModels(by: 'cost' | 'usage' = 'cost', limit = 5, timeframe: 'all' | 'monthly' | 'weekly' | 'daily' = 'all') {
    const { clause, params } = this.timeframeWhere(timeframe);
    const rows = await this.safeQuery<TokenRow>(`SELECT * FROM token_detailed ${clause}`, params);

    const agg: Record<string, { model: string; turns: number; input: number; output: number; cacheRead: number; cost: number }> = {};

    for (const r of rows) {
      const m = r.model || 'unknown';
      if (!agg[m]) {
        agg[m] = { model: m, turns: 0, input: 0, output: 0, cacheRead: 0, cost: 0 };
      }
      const inT = Number(r.input_tokens || 0);
      const outT = Number(r.output_tokens || 0);
      const crT = Number(r.cache_read_tokens || 0);
      const cwT = Number(r.cache_write_tokens || 0);
      const costRes = calculateTurnCost(this.catalog, m, inT, outT, crT, cwT);

      agg[m].turns++;
      agg[m].input += inT;
      agg[m].output += outT;
      agg[m].cacheRead += crT;
      agg[m].cost += Number(costRes.cost || 0);
    }

    const list = Object.values(agg).map((item) => {
      const rawPid = item.model.split('/')[0] || 'unknown';
      const { resolvedId, providerName } = resolveProvider(this.catalog, rawPid);
      const { entry } = findModelEntry(this.catalog, item.model);
      const input = Number(item.input || 0);
      const output = Number(item.output || 0);
      const cacheRead = Number(item.cacheRead || 0);

      return {
        model: item.model,
        displayName: entry?.name || item.model.split('/')[1] || item.model,
        providerId: resolvedId || rawPid,
        providerName: providerName || rawPid,
        logo: `/logos/${resolvedId || rawPid}.svg`,
        turns: item.turns || 0,
        inputTokens: input,
        outputTokens: output,
        cacheReadTokens: cacheRead,
        totalTokens: input + output + cacheRead,
        cost: Number((item.cost || 0).toFixed(4)),
      };
    });

    if (by === 'cost') {
      list.sort((a, b) => (b.cost || 0) - (a.cost || 0));
    } else {
      list.sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0));
    }

    return list.slice(0, limit);
  }

  public async getTimeline(unit: 'daily' | 'weekly' | 'monthly' = 'daily') {
    const rows = await this.safeQuery<TokenRow>('SELECT * FROM token_detailed ORDER BY timestamp ASC');

    const bucketMap: Record<string, { date: string; input: number; output: number; cacheRead: number; cost: number; turns: number }> = {};

    for (const r of rows) {
      let key = r.timestamp.slice(0, 10);
      if (unit === 'monthly') {
        key = r.timestamp.slice(0, 7);
      } else if (unit === 'weekly') {
        const d = new Date(r.timestamp);
        const day = d.getDay();
        const diff = d.getDate() - day + (day === 0 ? -6 : 1);
        const weekStart = new Date(d.setDate(diff));
        key = weekStart.toISOString().slice(0, 10);
      }

      if (!bucketMap[key]) {
        bucketMap[key] = { date: key, input: 0, output: 0, cacheRead: 0, cost: 0, turns: 0 };
      }

      const costRes = calculateTurnCost(this.catalog, r.model, Number(r.input_tokens || 0), Number(r.output_tokens || 0), Number(r.cache_read_tokens || 0), Number(r.cache_write_tokens || 0));

      bucketMap[key].input += Number(r.input_tokens || 0);
      bucketMap[key].output += Number(r.output_tokens || 0);
      bucketMap[key].cacheRead += Number(r.cache_read_tokens || 0);
      bucketMap[key].turns++;
      bucketMap[key].cost += costRes.cost;
    }

    return Object.values(bucketMap).map((b) => ({
      ...b,
      cost: Number(b.cost.toFixed(4)),
    }));
  }

  public async getProviders() {
    const rows = await this.safeQuery<TokenRow>('SELECT * FROM token_detailed');
    const provMap: Record<string, { providerId: string; providerName: string; turns: number; input: number; output: number; cacheRead: number; cost: number; models: Set<string>; sessions: Set<string> }> = {};

    for (const r of rows) {
      const rawPid = r.model.split('/')[0] || 'unknown';
      const { resolvedId, providerName } = resolveProvider(this.catalog, rawPid);

      if (!provMap[resolvedId]) {
        provMap[resolvedId] = {
          providerId: resolvedId,
          providerName,
          turns: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cost: 0,
          models: new Set(),
          sessions: new Set(),
        };
      }

      const costRes = calculateTurnCost(this.catalog, r.model, Number(r.input_tokens || 0), Number(r.output_tokens || 0), Number(r.cache_read_tokens || 0), Number(r.cache_write_tokens || 0));

      provMap[resolvedId].turns++;
      provMap[resolvedId].input += Number(r.input_tokens || 0);
      provMap[resolvedId].output += Number(r.output_tokens || 0);
      provMap[resolvedId].cacheRead += Number(r.cache_read_tokens || 0);
      provMap[resolvedId].cost += costRes.cost;
      provMap[resolvedId].models.add(r.model);
      provMap[resolvedId].sessions.add(r.session_id);
    }

    return Object.values(provMap).map((p) => ({
      providerId: p.providerId,
      providerName: p.providerName,
      logo: `/logos/${p.providerId}.svg`,
      turns: p.turns,
      modelsCount: p.models.size,
      sessionsCount: p.sessions.size,
      inputTokens: p.input,
      outputTokens: p.output,
      cacheReadTokens: p.cacheRead,
      totalCost: Number(p.cost.toFixed(4)),
    })).sort((a, b) => b.totalCost - a.totalCost);
  }

  public async getAllCatalogProviders() {
    const dbProvs = await this.getProviders();
    const dbMap = new Map(dbProvs.map((p) => [p.providerId, p]));
    const catalogProvs = this.catalog.providers || {};
    const result: Array<{
      providerId: string;
      providerName: string;
      logo: string;
      turns: number;
      modelsCount: number;
      sessionsCount: number;
      inputTokens: number;
      outputTokens: number;
      cacheReadTokens: number;
      totalCost: number;
      isDbActive: boolean;
    }> = [];

    for (const [pid, p] of Object.entries(catalogProvs)) {
      const dbEntry = dbMap.get(pid);
      if (dbEntry) {
        result.push({ ...dbEntry, isDbActive: true });
        dbMap.delete(pid);
      } else {
        result.push({
          providerId: pid,
          providerName: p.name || pid,
          logo: `/logos/${pid}.svg`,
          turns: 0,
          modelsCount: Object.keys(p.models || {}).length,
          sessionsCount: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          totalCost: 0,
          isDbActive: false,
        });
      }
    }

    for (const [_, dbEntry] of dbMap) {
      result.push({ ...dbEntry, isDbActive: true });
    }

    return result.sort((a, b) => (b.isDbActive ? 1 : 0) - (a.isDbActive ? 1 : 0) || a.providerName.localeCompare(b.providerName));
  }

  public async getModels(providerFilter?: string) {
    const rows = await this.safeQuery<TokenRow>('SELECT * FROM token_detailed');
    const modelMap: Record<string, { model: string; turns: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; sessions: Set<string> }> = {};

    for (const r of rows) {
      const m = r.model;
      if (!modelMap[m]) {
        modelMap[m] = { model: m, turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, sessions: new Set() };
      }
      const costRes = calculateTurnCost(this.catalog, m, Number(r.input_tokens || 0), Number(r.output_tokens || 0), Number(r.cache_read_tokens || 0), Number(r.cache_write_tokens || 0));

      modelMap[m].turns++;
      modelMap[m].input += Number(r.input_tokens || 0);
      modelMap[m].output += Number(r.output_tokens || 0);
      modelMap[m].cacheRead += Number(r.cache_read_tokens || 0);
      modelMap[m].cacheWrite += Number(r.cache_write_tokens || 0);
      modelMap[m].cost += costRes.cost;
      modelMap[m].sessions.add(r.session_id);
    }

    let list = Object.values(modelMap).map((item) => {
      const rawPid = item.model.split('/')[0] || 'unknown';
      const { resolvedId, providerName } = resolveProvider(this.catalog, rawPid);
      const { entry } = findModelEntry(this.catalog, item.model);
      const costRes = calculateTurnCost(this.catalog, item.model, 1_000_000, 1_000_000, 1_000_000);

      return {
        model: item.model,
        displayName: entry?.name || item.model.split('/')[1] || item.model,
        providerId: resolvedId,
        providerName,
        logo: `/logos/${resolvedId}.svg`,
        turns: item.turns,
        sessionsCount: item.sessions.size,
        inputTokens: item.input,
        outputTokens: item.output,
        cacheReadTokens: item.cacheRead,
        cacheWriteTokens: item.cacheWrite,
        totalCost: Number(item.cost.toFixed(4)),
        rates: costRes.rates,
        modalities: entry?.modalities?.input || ['text'],
      };
    });

    if (providerFilter && providerFilter !== 'all') {
      list = list.filter((m) => m.providerId.toLowerCase() === providerFilter.toLowerCase() || m.providerName.toLowerCase() === providerFilter.toLowerCase());
    }

    return list.sort((a, b) => b.totalCost - a.totalCost);
  }

  public async getCrossProviderModels() {
    const rows = await this.safeQuery<TokenRow>('SELECT * FROM token_detailed');
    const baseMap: Record<string, { baseModel: string; displayName: string; totalTurns: number; totalCost: number; providers: Record<string, { model: string; providerId: string; providerName: string; logo: string; turns: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cost: number; rates: { input: number; output: number; cacheRead: number } }> }> = {};

    for (const r of rows) {
      const fullModel = r.model;
      const parts = fullModel.split('/');
      const rawPid = parts.length > 1 ? parts[0] : r.caller;
      const rawBaseModel = parts.length > 1 ? parts.slice(1).join('/') : fullModel;
      const baseModel = rawBaseModel.replace(/[-:\s]free$/i, '').replace(/[-:\s]free[-_\w]*$/i, '') || rawBaseModel;
      const { resolvedId, providerName } = resolveProvider(this.catalog, rawPid);
      const { entry } = findModelEntry(this.catalog, fullModel);
      const displayName = entry?.name || baseModel;

      if (!baseMap[baseModel]) {
        baseMap[baseModel] = { baseModel, displayName, totalTurns: 0, totalCost: 0, providers: {} };
      }

      const bm = baseMap[baseModel];
      bm.totalTurns++;

      if (!bm.providers[rawPid]) {
        const costRes = calculateTurnCost(this.catalog, fullModel, 1_000_000, 1_000_000, 1_000_000);
        bm.providers[rawPid] = {
          model: fullModel,
          providerId: resolvedId,
          providerName,
          logo: `/logos/${resolvedId}.svg`,
          turns: 0,
          inputTokens: 0,
          outputTokens: 0,
          cacheReadTokens: 0,
          cost: 0,
          rates: costRes.rates,
        };
      }

      const provItem = bm.providers[rawPid];
      provItem.turns++;
      provItem.inputTokens += Number(r.input_tokens || 0);
      provItem.outputTokens += Number(r.output_tokens || 0);
      provItem.cacheReadTokens += Number(r.cache_read_tokens || 0);

      const costRes = calculateTurnCost(this.catalog, fullModel, Number(r.input_tokens || 0), Number(r.output_tokens || 0), Number(r.cache_read_tokens || 0), Number(r.cache_write_tokens || 0));
      provItem.cost += costRes.cost;
      bm.totalCost += costRes.cost;
    }

    return Object.values(baseMap).map((bm) => {
      const providersList = Object.values(bm.providers).map((p) => ({
        ...p,
        cost: Number(p.cost.toFixed(4)),
      })).sort((a, b) => b.cost - a.cost);

      return {
        baseModel: bm.baseModel,
        displayName: bm.displayName,
        totalTurns: bm.totalTurns,
        totalCost: Number(bm.totalCost.toFixed(4)),
        providersCount: providersList.length,
        providers: providersList,
      };
    }).sort((a, b) => b.totalCost - a.totalCost);
  }

  public async getSessions(page = 1, limit = 20, search = '', providerFilter = '', availableIds: Set<string> | null = null) {
    const rows = await this.safeQuery<TokenRow>('SELECT * FROM token_detailed ORDER BY timestamp DESC');
    const sessionMap: Record<string, { sessionId: string; firstTurn: string; lastTurn: string; turnCount: number; input: number; output: number; cacheRead: number; cost: number; models: Set<string> }> = {};

    for (const r of rows) {
      const sid = r.session_id;
      if (!sessionMap[sid]) {
        sessionMap[sid] = {
          sessionId: sid,
          firstTurn: r.timestamp,
          lastTurn: r.timestamp,
          turnCount: 0,
          input: 0,
          output: 0,
          cacheRead: 0,
          cost: 0,
          models: new Set(),
        };
      }
      const s = sessionMap[sid];
      s.turnCount++;
      s.firstTurn = r.timestamp < s.firstTurn ? r.timestamp : s.firstTurn;
      s.lastTurn = r.timestamp > s.lastTurn ? r.timestamp : s.lastTurn;
      s.input += Number(r.input_tokens || 0);
      s.output += Number(r.output_tokens || 0);
      s.cacheRead += Number(r.cache_read_tokens || 0);
      s.models.add(r.model);

      const costRes = calculateTurnCost(this.catalog, r.model, Number(r.input_tokens || 0), Number(r.output_tokens || 0), Number(r.cache_read_tokens || 0), Number(r.cache_write_tokens || 0));
      s.cost += costRes.cost;
    }

    let list = Object.values(sessionMap).map((s) => ({
      sessionId: s.sessionId,
      firstTurn: s.firstTurn,
      lastTurn: s.lastTurn,
      turnCount: s.turnCount,
      inputTokens: s.input,
      outputTokens: s.output,
      cacheReadTokens: s.cacheRead,
      totalCost: Number(s.cost.toFixed(4)),
      models: Array.from(s.models),
      hasTranscript: availableIds === null ? true : availableIds.has(s.sessionId),
    }));

    if (search) {
      const q = search.toLowerCase();
      list = list.filter((s) => s.sessionId.toLowerCase().includes(q) || s.models.some((m) => m.toLowerCase().includes(q)));
    }

    list.sort((a, b) => new Date(b.lastTurn).getTime() - new Date(a.lastTurn).getTime());

    const total = list.length;
    const startIndex = (page - 1) * limit;
    const items = list.slice(startIndex, startIndex + limit);

    return {
      items,
      total,
      page,
      limit,
      totalPages: Math.ceil(total / limit),
    };
  }

  private async ensureSubscriptionTable() {
    await this.ready();
  }

  public async getSubscriptions(): Promise<Array<{
    providerId: string;
    providerName: string;
    logo: string;
    cost: number;
    cycle: 'monthly' | 'yearly';
    updatedAt?: string;
  }>> {
    await this.ensureSubscriptionTable();
    const rows = await this.safeQuery<any>('SELECT * FROM provider_subscriptions');
    return rows.map((r) => {
      const { providerName } = resolveProvider(this.catalog, r.provider_id);
      return {
        providerId: r.provider_id,
        providerName,
        logo: `/logos/${r.provider_id}.svg`,
        cost: Number(r.cost || 0),
        cycle: (r.cycle as 'monthly' | 'yearly') || 'monthly',
        updatedAt: r.updated_at,
      };
    });
  }

  public async addSubscription(providerId: string, cost: number, cycle: 'monthly' | 'yearly' = 'monthly') {
    await this.ensureSubscriptionTable();
    const now = new Date().toISOString();
    await this.safeRun(
      `INSERT INTO provider_subscriptions (provider_id, cost, cycle, updated_at)
       VALUES ($1, $2, $3, $4)
       ON CONFLICT(provider_id) DO UPDATE SET
         cost = EXCLUDED.cost,
         cycle = EXCLUDED.cycle,
         updated_at = EXCLUDED.updated_at`,
      [providerId, cost, cycle, now]
    );
  }

  public async removeSubscription(providerId: string) {
    await this.ensureSubscriptionTable();
    await this.safeRun('DELETE FROM provider_subscriptions WHERE provider_id = $1', [providerId]);
  }

  public async getDbStats() {
    const formatSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    const sizeRow = await this.safeGet<{ size: string }>('SELECT pg_database_size(current_database()) AS size');
    const fileSizeBytes = Number(sizeRow?.size || 0);
    const totalRow = await this.safeGet<{ cnt: string }>('SELECT COUNT(*) AS cnt FROM token_detailed');
    const totalRows = Number(totalRow?.cnt || 0);
    const indexRow = await this.safeGet<{ cnt: string }>(
      `SELECT COUNT(*) AS cnt
       FROM pg_indexes
       WHERE schemaname = 'public'`
    );
    const indexCount = Number(indexRow?.cnt || 0);

    const tableRows = await this.safeQuery<{ table_name: string }>(
      `SELECT table_name
       FROM information_schema.tables
       WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
       ORDER BY table_name`
    );
    const tables: Array<{ name: string; rowCount: number }> = [];
    for (const t of tableRows) {
      const countRow = await this.safeGet<{ cnt: string }>(`SELECT COUNT(*) AS cnt FROM ${quoteIdent(t.table_name)}`);
      tables.push({ name: t.table_name, rowCount: Number(countRow?.cnt || 0) });
    }

    return {
      dbPath: databaseLabel(),
      fileSizeBytes,
      fileSizeFormatted: formatSize(fileSizeBytes),
      tableCount: tables.length,
      totalRows,
      journalMode: 'postgres',
      integrityStatus: 'online',
      indexCount,
      tables,
    };
  }

  public async getDbRows(
    limit: number = 50,
    offset: number = 0,
    search: string = '',
    model: string = '',
    caller: string = '',
    sortColumn: string = 'id',
    sortOrder: 'asc' | 'desc' = 'desc'
  ) {
    const conditions: string[] = [];
    const params: any[] = [];

    if (search.trim()) {
      const q = `%${search.trim()}%`;
      params.push(q, q, q);
      conditions.push(`(session_id ILIKE $${params.length - 2} OR model ILIKE $${params.length - 1} OR caller ILIKE $${params.length})`);
    }

    if (model.trim()) {
      params.push(model.trim());
      conditions.push(`model = $${params.length}`);
    }

    if (caller.trim()) {
      params.push(caller.trim());
      conditions.push(`caller = $${params.length}`);
    }

    const whereClause = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const safeSortCols: Record<string, string> = {
      id: 'id',
      timestamp: 'timestamp',
      session_id: 'session_id',
      caller: 'caller',
      model: 'model',
      turn_number: 'turn_number',
      input_tokens: 'input_tokens',
      output_tokens: 'output_tokens',
    };
    const col = safeSortCols[sortColumn] || 'id';
    const dir = sortOrder === 'asc' ? 'ASC' : 'DESC';

    const countSql = `SELECT COUNT(*) AS total FROM token_detailed ${whereClause}`;
    const totalRow = await this.safeGet<{ total: string }>(countSql, params);
    const total = Number(totalRow?.total || 0);

    const dataParams = [...params, limit, offset];
    const dataSql = `SELECT * FROM token_detailed ${whereClause} ORDER BY ${col} ${dir} LIMIT $${dataParams.length - 1} OFFSET $${dataParams.length}`;
    const rows = await this.safeQuery<TokenRow>(dataSql, dataParams);

    const page = Math.floor(offset / limit) + 1;
    const totalPages = Math.ceil(total / limit) || 1;

    return {
      rows,
      total,
      limit,
      offset,
      page,
      totalPages,
    };
  }

  public async executeReadOnlySql(sqlString: string) {
    const startTime = performance.now();
    const cleanSql = sqlString.trim();
    const lower = cleanSql.toLowerCase();
    const withoutTrailingSemicolon = cleanSql.replace(/;+\s*$/, '');

    if (!lower.startsWith('select') && !lower.startsWith('explain') && !lower.startsWith('show')) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: 0,
        error: 'Only SELECT, EXPLAIN, and SHOW read-only Postgres statements are allowed in the query console.',
      };
    }

    if (withoutTrailingSemicolon.includes(';')) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: 0,
        error: 'Only one read-only SQL statement is allowed.',
      };
    }

    const client = await this.pool.connect();
    try {
      await client.query('BEGIN READ ONLY');
      const result = await client.query(withoutTrailingSemicolon);
      await client.query('COMMIT');
      const executionTimeMs = Math.round((performance.now() - startTime) * 100) / 100;
      const rows = result.rows || [];
      const columns = result.fields?.map((f) => f.name) || (rows.length > 0 ? Object.keys(rows[0]) : []);

      return {
        columns,
        rows: rows.slice(0, 500),
        rowCount: rows.length,
        executionTimeMs,
      };
    } catch (err: any) {
      try {
        await client.query('ROLLBACK');
      } catch {
        // ignore rollback errors
      }
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
        error: err?.message || String(err),
      };
    } finally {
      client.release();
    }
  }

  public async performDbAction(action: 'vacuum' | 'reindex' | 'analyze') {
    if (action === 'analyze') {
      await this.safeRun('ANALYZE token_detailed');
      return { success: true, message: 'Postgres statistics refreshed with ANALYZE.' };
    }
    if (action === 'vacuum') {
      await this.safeRun('VACUUM token_detailed');
      return { success: true, message: 'Postgres vacuum completed for token_detailed.' };
    }
    if (action === 'reindex') {
      await this.safeRun('REINDEX TABLE token_detailed');
      return { success: true, message: 'Postgres indexes rebuilt for token_detailed.' };
    }
    return { success: false, message: 'Unknown action' };
  }
}

export async function initDatabase() {
  const catalog = await loadCatalog();
  const db = new DatabaseManager(catalog);
  await db.ready();
  return db;
}
