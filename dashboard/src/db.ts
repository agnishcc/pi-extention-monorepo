import { Database } from 'bun:sqlite';
import { existsSync, readdirSync, readFileSync } from 'fs';
import { homedir } from 'os';
import { join, basename } from 'path';
import { calculateTurnCost, Catalog, findModelEntry, loadCatalog, resolveProvider } from './pricing';

const DB_PATH = join(homedir(), '.pi', 'token-usage.db');
const SESSIONS_DIR = join(homedir(), '.pi', 'agent', 'sessions');

export class DatabaseManager {
  private db: Database;
  public catalog: Catalog;

  constructor(catalog: Catalog) {
    this.catalog = catalog;
    try {
      this.db = new Database(DB_PATH, { create: true });
      this.db.run('PRAGMA journal_mode = WAL;');
      this.db.run('PRAGMA busy_timeout = 5000;');
      this.initTables();
    } catch (err: any) {
      if (String(err).includes('SQLITE_CORRUPT') || String(err).includes('malformed')) {
        console.warn('⚠️ SQLite Database corruption detected. Rebuilding database from session logs...');
        this.recoverCorruptDatabase();
      } else {
        throw err;
      }
    }
  }

  private recoverCorruptDatabase() {
    try {
      this.db?.close();
    } catch {
      // ignore
    }

    try {
      if (existsSync(DB_PATH)) {
        const backupPath = `${DB_PATH}.corrupt.${Date.now()}.bak`;
        const { renameSync, unlinkSync } = require('fs');
        renameSync(DB_PATH, backupPath);
        if (existsSync(`${DB_PATH}-wal`)) try { unlinkSync(`${DB_PATH}-wal`); } catch {}
        if (existsSync(`${DB_PATH}-shm`)) try { unlinkSync(`${DB_PATH}-shm`); } catch {}
        console.warn(`Backed up corrupt database to ${backupPath}`);
      }
    } catch (e) {
      console.warn('Backup error during recovery:', e);
    }

    this.db = new Database(DB_PATH, { create: true });
    this.db.run('PRAGMA journal_mode = WAL;');
    this.db.run('PRAGMA busy_timeout = 5000;');
    this.initTables();
  }

  private safeQuery(sql: string, params: any[] = []): any[] {
    try {
      return this.db.query(sql).all(...params);
    } catch (err: any) {
      if (String(err).includes('SQLITE_CORRUPT') || String(err).includes('malformed')) {
        console.warn('⚠️ SQLite Database corruption detected during query execution. Attempting REINDEX & VACUUM...');
        try {
          this.db.run('REINDEX;');
          this.db.run('VACUUM;');
          return this.db.query(sql).all(...params);
        } catch {
          console.warn('⚠️ REINDEX failed. Rebuilding database from session logs...');
          this.recoverCorruptDatabase();
          try {
            return this.db.query(sql).all(...params);
          } catch {
            return [];
          }
        }
      }
      throw err;
    }
  }

  private safeGet(sql: string, params: any[] = []): any {
    try {
      return this.db.query(sql).get(...params);
    } catch (err: any) {
      if (String(err).includes('SQLITE_CORRUPT') || String(err).includes('malformed')) {
        console.warn('⚠️ SQLite Database corruption detected during get query execution. Attempting REINDEX & VACUUM...');
        try {
          this.db.run('REINDEX;');
          this.db.run('VACUUM;');
          return this.db.query(sql).get(...params);
        } catch {
          console.warn('⚠️ REINDEX failed. Rebuilding database from session logs...');
          this.recoverCorruptDatabase();
          try {
            return this.db.query(sql).get(...params);
          } catch {
            return null;
          }
        }
      }
      throw err;
    }
  }

  private safeRun(sql: string, params: any[] = []): void {
    try {
      this.db.run(sql, params);
    } catch (err: any) {
      if (String(err).includes('SQLITE_CORRUPT') || String(err).includes('malformed')) {
        console.warn('⚠️ SQLite Database corruption detected during write execution. Recovering...');
        this.recoverCorruptDatabase();
        try {
          this.db.run(sql, params);
        } catch {
          // ignore retry failure
        }
      } else {
        throw err;
      }
    }
  }

  private initTables() {
    this.db.run(`
      CREATE TABLE IF NOT EXISTS token_detailed (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
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
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_session ON token_detailed(session_id);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_model ON token_detailed(model);`);
    this.db.run(`CREATE INDEX IF NOT EXISTS idx_timestamp ON token_detailed(timestamp);`);

    this.db.run(`
      CREATE TABLE IF NOT EXISTS provider_subscriptions (
        provider_id TEXT PRIMARY KEY,
        type TEXT DEFAULT 'subscription',
        cost REAL DEFAULT 0,
        cycle TEXT DEFAULT 'monthly',
        updated_at TEXT
      );
    `);
  }

  public autoIngestHistoricSessions() {
    if (!existsSync(SESSIONS_DIR)) return;

    // Get existing session_ids
    const existing = new Set<string>(
      this.safeQuery('SELECT DISTINCT session_id FROM token_detailed').map((r: any) => r.session_id)
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
        // ignore
      }
    }

    const insertStmt = this.db.prepare(`
      INSERT INTO token_detailed
      (timestamp, session_id, caller, agent_id, agent_type, model, turn_number, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);

    let newCount = 0;
    try {
      this.db.transaction(() => {
        for (const filepath of jsonlFiles) {
          let sessionId: string | null = null;
          const turns: any[] = [];
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
                      '', // placeholder for sessionId
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
                // line skip
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
                insertStmt.run(...t);
              }
              existing.add(sessionId);
              newCount++;
            }
          } catch {
            // file error
          }
        }
      })();
    } catch (err: any) {
      if (String(err).includes('SQLITE_CORRUPT') || String(err).includes('malformed')) {
        console.warn('⚠️ Database corruption during auto-ingestion transaction. Attempting REINDEX & VACUUM...');
        try {
          this.db.run('REINDEX;');
          this.db.run('VACUUM;');
        } catch {
          console.warn('⚠️ Recovery failed. Rebuilding database from session logs...');
          this.recoverCorruptDatabase();
        }
      }
    }

    if (newCount > 0) {
      console.log(`[DatabaseManager] Auto-ingested ${newCount} new sessions into SQLite database.`);
    }
  }

  public getSummary(timeframe: 'all' | 'monthly' | 'weekly' | 'daily' = 'all') {
    let dateFilter = '';
    const now = new Date();

    if (timeframe === 'monthly') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
      dateFilter = `WHERE timestamp >= '${monthAgo}'`;
    } else if (timeframe === 'weekly') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
      dateFilter = `WHERE timestamp >= '${weekAgo}'`;
    } else if (timeframe === 'daily') {
      const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
      dateFilter = `WHERE timestamp >= '${dayAgo}'`;
    }

    const rows: any[] = this.safeQuery(`SELECT * FROM token_detailed ${dateFilter}`);

    let totalInput = 0;
    let totalOutput = 0;
    let totalCacheRead = 0;
    let totalCacheWrite = 0;
    let totalCost = 0;
    let totalCacheSavings = 0;
    const sessionIds = new Set<string>();

    const modelAgg: Record<string, { turns: number; input: number; output: number; cacheRead: number; cost: number } > = {};
    const callerAgg = { main: { turns: 0, cost: 0 }, subagent: { turns: 0, cost: 0 } };

    for (const r of rows) {
      sessionIds.add(r.session_id);
      totalInput += r.input_tokens;
      totalOutput += r.output_tokens;
      totalCacheRead += r.cache_read_tokens;
      totalCacheWrite += r.cache_write_tokens;

      const costRes = calculateTurnCost(this.catalog, r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens);
      totalCost += costRes.cost;
      totalCacheSavings += costRes.cacheSavings;

      if (!modelAgg[r.model]) {
        modelAgg[r.model] = { turns: 0, input: 0, output: 0, cacheRead: 0, cost: 0 };
      }
      modelAgg[r.model].turns++;
      modelAgg[r.model].input += r.input_tokens;
      modelAgg[r.model].output += r.output_tokens;
      modelAgg[r.model].cacheRead += r.cache_read_tokens;
      modelAgg[r.model].cost += costRes.cost;

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

  public getTopModels(by: 'cost' | 'usage' = 'cost', limit = 5, timeframe: 'all' | 'monthly' | 'weekly' | 'daily' = 'all') {
    let dateFilter = '';
    const now = new Date();

    if (timeframe === 'monthly') {
      const monthAgo = new Date(now.getTime() - 30 * 24 * 3600 * 1000).toISOString();
      dateFilter = `WHERE timestamp >= '${monthAgo}'`;
    } else if (timeframe === 'weekly') {
      const weekAgo = new Date(now.getTime() - 7 * 24 * 3600 * 1000).toISOString();
      dateFilter = `WHERE timestamp >= '${weekAgo}'`;
    } else if (timeframe === 'daily') {
      const dayAgo = new Date(now.getTime() - 24 * 3600 * 1000).toISOString();
      dateFilter = `WHERE timestamp >= '${dayAgo}'`;
    }

    const rows: any[] = this.safeQuery(`SELECT * FROM token_detailed ${dateFilter}`);

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

  public getTimeline(unit: 'daily' | 'weekly' | 'monthly' = 'daily') {
    const rows: any[] = this.safeQuery('SELECT * FROM token_detailed ORDER BY timestamp ASC');

    const bucketMap: Record<string, { date: string; input: number; output: number; cacheRead: number; cost: number; turns: number }> = {};

    for (const r of rows) {
      let key = r.timestamp.slice(0, 10); // YYYY-MM-DD
      if (unit === 'monthly') {
        key = r.timestamp.slice(0, 7); // YYYY-MM
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

      const costRes = calculateTurnCost(this.catalog, r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens);

      bucketMap[key].input += r.input_tokens;
      bucketMap[key].output += r.output_tokens;
      bucketMap[key].cacheRead += r.cache_read_tokens;
      bucketMap[key].turns++;
      bucketMap[key].cost += costRes.cost;
    }

    return Object.values(bucketMap).map((b) => ({
      ...b,
      cost: Number(b.cost.toFixed(4)),
    }));
  }

  public getProviders() {
    const rows: any[] = this.safeQuery('SELECT * FROM token_detailed');

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

      const costRes = calculateTurnCost(this.catalog, r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens);

      provMap[resolvedId].turns++;
      provMap[resolvedId].input += r.input_tokens;
      provMap[resolvedId].output += r.output_tokens;
      provMap[resolvedId].cacheRead += r.cache_read_tokens;
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

  public getAllCatalogProviders() {
    const dbProvs = this.getProviders();
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

  public getModels(providerFilter?: string) {
    const rows: any[] = this.safeQuery('SELECT * FROM token_detailed');

    const modelMap: Record<string, { model: string; turns: number; input: number; output: number; cacheRead: number; cacheWrite: number; cost: number; sessions: Set<string> }> = {};

    for (const r of rows) {
      const m = r.model;
      if (!modelMap[m]) {
        modelMap[m] = { model: m, turns: 0, input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0, sessions: new Set() };
      }
      const costRes = calculateTurnCost(this.catalog, m, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens);

      modelMap[m].turns++;
      modelMap[m].input += r.input_tokens;
      modelMap[m].output += r.output_tokens;
      modelMap[m].cacheRead += r.cache_read_tokens;
      modelMap[m].cacheWrite += r.cache_write_tokens;
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

  public getCrossProviderModels() {
    const rows = this.safeQuery('SELECT * FROM token_detailed');

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
        baseMap[baseModel] = {
          baseModel,
          displayName,
          totalTurns: 0,
          totalCost: 0,
          providers: {},
        };
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
      provItem.inputTokens += r.input_tokens;
      provItem.outputTokens += r.output_tokens;
      provItem.cacheReadTokens += r.cache_read_tokens;

      const costRes = calculateTurnCost(this.catalog, fullModel, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens);
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

  public getSessions(page = 1, limit = 20, search = '', providerFilter = '', availableIds: Set<string> | null = null) {
    const rows: any[] = this.safeQuery('SELECT * FROM token_detailed ORDER BY timestamp DESC');

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
      s.input += r.input_tokens;
      s.output += r.output_tokens;
      s.cacheRead += r.cache_read_tokens;
      s.models.add(r.model);

      const costRes = calculateTurnCost(this.catalog, r.model, r.input_tokens, r.output_tokens, r.cache_read_tokens, r.cache_write_tokens);
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
      // If availableIds is null we couldn't check the filesystem — default to true
      // so the dashboard doesn't false-positive stale data.
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

  private ensureSubscriptionTable() {
    try {
      this.db.run(`
        CREATE TABLE IF NOT EXISTS provider_subscriptions (
          provider_id TEXT PRIMARY KEY,
          cost REAL NOT NULL,
          cycle TEXT DEFAULT 'monthly',
          updated_at TEXT
        );
      `);
    } catch (err) {
      console.error('Error ensuring provider_subscriptions table:', err);
    }
  }

  public getSubscriptions(): Array<{
    providerId: string;
    providerName: string;
    logo: string;
    cost: number;
    cycle: 'monthly' | 'yearly';
    updatedAt?: string;
  }> {
    this.ensureSubscriptionTable();
    const rows = this.safeQuery('SELECT * FROM provider_subscriptions');
    return rows.map((r: any) => {
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

  public addSubscription(providerId: string, cost: number, cycle: 'monthly' | 'yearly' = 'monthly') {
    this.ensureSubscriptionTable();
    const now = new Date().toISOString();
    this.safeRun(
      `INSERT INTO provider_subscriptions (provider_id, cost, cycle, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(provider_id) DO UPDATE SET
         cost = excluded.cost,
         cycle = excluded.cycle,
         updated_at = excluded.updated_at`,
      [providerId, cost, cycle, now]
    );
  }

  public removeSubscription(providerId: string) {
    this.ensureSubscriptionTable();
    this.safeRun('DELETE FROM provider_subscriptions WHERE provider_id = ?', [providerId]);
  }

  public getDbStats() {
    let fileSizeBytes = 0;
    try {
      if (existsSync(DB_PATH)) {
        fileSizeBytes = statSync(DB_PATH).size;
      }
    } catch {
      // ignore
    }

    const formatSize = (bytes: number) => {
      if (bytes < 1024) return `${bytes} B`;
      if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
      return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
    };

    let totalRows = 0;
    try {
      const row = this.safeGet('SELECT COUNT(*) as cnt FROM token_detailed');
      totalRows = row?.cnt || 0;
    } catch {
      // ignore
    }

    let journalMode = 'unknown';
    try {
      const jRow = this.safeGet('PRAGMA journal_mode');
      journalMode = jRow?.journal_mode || 'unknown';
    } catch {
      // ignore
    }

    let integrityStatus = 'ok';
    try {
      const iRow = this.safeGet('PRAGMA integrity_check');
      integrityStatus = iRow?.integrity_check || 'ok';
    } catch (err: any) {
      integrityStatus = err?.message || 'corrupt';
    }

    let indexCount = 0;
    try {
      const idxs = this.safeGet("SELECT COUNT(*) as cnt FROM sqlite_master WHERE type='index'");
      indexCount = idxs?.cnt || 0;
    } catch {
      // ignore
    }

    const tables: Array<{ name: string; rowCount: number }> = [];
    try {
      const tbls = this.safeQuery("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'");
      for (const t of tbls) {
        try {
          const countRow = this.safeGet(`SELECT COUNT(*) as cnt FROM "${t.name}"`);
          tables.push({ name: t.name, rowCount: countRow?.cnt || 0 });
        } catch {
          tables.push({ name: t.name, rowCount: 0 });
        }
      }
    } catch {
      // ignore
    }

    return {
      dbPath: DB_PATH,
      fileSizeBytes,
      fileSizeFormatted: formatSize(fileSizeBytes),
      tableCount: tables.length,
      totalRows,
      journalMode,
      integrityStatus,
      indexCount,
      tables,
    };
  }

  public getDbRows(
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
      conditions.push('(session_id LIKE ? OR model LIKE ? OR caller LIKE ?)');
      const q = `%${search.trim()}%`;
      params.push(q, q, q);
    }

    if (model.trim()) {
      conditions.push('model = ?');
      params.push(model.trim());
    }

    if (caller.trim()) {
      conditions.push('caller = ?');
      params.push(caller.trim());
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

    const countSql = `SELECT COUNT(*) as total FROM token_detailed ${whereClause}`;
    const totalRow = this.safeGet(countSql, params);
    const total = totalRow?.total || 0;

    const dataSql = `SELECT * FROM token_detailed ${whereClause} ORDER BY ${col} ${dir} LIMIT ? OFFSET ?`;
    const rows = this.safeQuery(dataSql, [...params, limit, offset]);

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

  public executeReadOnlySql(sqlString: string) {
    const startTime = performance.now();
    const cleanSql = sqlString.trim();

    if (!cleanSql.toLowerCase().startsWith('select') && !cleanSql.toLowerCase().startsWith('pragma') && !cleanSql.toLowerCase().startsWith('explain')) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: 0,
        error: 'Only SELECT, PRAGMA, and EXPLAIN read-only statements are allowed in the query console.',
      };
    }

    try {
      const rows = this.safeQuery(cleanSql);
      const executionTimeMs = Math.round((performance.now() - startTime) * 100) / 100;
      const columns = rows.length > 0 ? Object.keys(rows[0]) : [];

      return {
        columns,
        rows: rows.slice(0, 500),
        rowCount: rows.length,
        executionTimeMs,
      };
    } catch (err: any) {
      return {
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: Math.round((performance.now() - startTime) * 100) / 100,
        error: err?.message || String(err),
      };
    }
  }

  public performDbAction(action: 'vacuum' | 'reindex') {
    if (action === 'vacuum') {
      this.db.run('VACUUM;');
      return { success: true, message: 'Database successfully vacuumed & defragmented.' };
    }
    if (action === 'reindex') {
      this.db.run('REINDEX;');
      return { success: true, message: 'Database indexes successfully rebuilt.' };
    }
    return { success: false, message: 'Unknown action' };
  }
}

