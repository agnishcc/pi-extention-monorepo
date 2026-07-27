import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';

export interface ModelCost {
  input?: number;
  output?: number;
  cache_read?: number;
  cache_write?: number;
  context_over_200k?: {
    input?: number;
    output?: number;
    cache_read?: number;
  };
}

export interface CatalogModel {
  name?: string;
  cost?: ModelCost;
  modalities?: {
    input?: string[];
    output?: string[];
  };
}

export interface CatalogProvider {
  name?: string;
  models?: Record<string, CatalogModel>;
}

export interface Catalog {
  providers?: Record<string, CatalogProvider>;
  models?: Record<string, any>;
}

const CATALOG_URL = 'https://models.dev/catalog.json';
const CACHE_FILE = join(import.meta.dir, '../.catalog_cache.json');
const CACHE_TTL = 3600 * 1000; // 1 hour

const PROVIDER_ALIASES: Record<string, string> = {
  'openai-codex': 'openai',
  'github-copilot': 'openai',
  'codex': 'openai',
  'gemini': 'google',
  'claude': 'anthropic',
};

export async function loadCatalog(): Promise<Catalog> {
  if (existsSync(CACHE_FILE)) {
    try {
      const stats = await Bun.file(CACHE_FILE).stat();
      if (Date.now() - stats.mtimeMs < CACHE_TTL) {
        const text = await Bun.file(CACHE_FILE).text();
        return JSON.parse(text);
      }
    } catch {
      // Fall through to fetch
    }
  }

  try {
    const res = await fetch(CATALOG_URL, {
      headers: { 'User-Agent': 'ai-usage-dashboard/2.0' },
    });
    if (res.ok) {
      const data = (await res.json()) as Catalog;
      writeFileSync(CACHE_FILE, JSON.stringify(data));
      return data;
    }
  } catch (err) {
    console.warn('Failed to fetch catalog from models.dev:', err);
  }

  if (existsSync(CACHE_FILE)) {
    try {
      const text = await Bun.file(CACHE_FILE).text();
      return JSON.parse(text);
    } catch {
      // ignore
    }
  }

  return { providers: {}, models: {} };
}

export function parseModelString(dbModel: string): { providerId: string; modelId: string } {
  const parts = dbModel.split('/');
  if (parts.length >= 2) {
    return { providerId: parts[0], modelId: parts.slice(1).join('/') };
  }
  return { providerId: 'unknown', modelId: dbModel };
}

const DISPLAY_NAMES: Record<string, string> = {
  crof: 'Crof AI',
  crofai: 'Crof AI',
  bytedance: 'ByteDance',
  'bytedance-ark': 'ByteDance Ark',
  'opencode-go': 'OpenCode Go',
  'openai-codex': 'OpenAI Codex',
  'github-copilot': 'GitHub Copilot',
};

export function resolveProvider(catalog: Catalog, dbProviderId: string): { resolvedId: string; providerName: string } {
  const provs = catalog.providers || {};
  const lowerId = (dbProviderId || '').toLowerCase();

  const customName = DISPLAY_NAMES[lowerId];
  const alias = PROVIDER_ALIASES[lowerId];

  const targetId = alias || dbProviderId;
  const rawName = customName || (provs[dbProviderId] ? provs[dbProviderId].name : undefined) || dbProviderId;

  return { resolvedId: targetId, providerName: rawName };
}

export function findModelEntry(catalog: Catalog, dbModel: string): { entry: CatalogModel | null; providerId: string; providerName: string } {
  const { providerId, modelId } = parseModelString(dbModel);
  const provs = catalog.providers || {};
  const lowerPid = providerId.toLowerCase();

  const candidates = [providerId];
  const alias = PROVIDER_ALIASES[lowerPid];
  if (alias) candidates.push(alias);

  const customName = DISPLAY_NAMES[lowerPid];
  const provDisplayName = customName || provs[providerId]?.name || providerId;

  // Model ID candidates: original model ID, plus model ID with "-free", ":free", " free" stripped
  const modelCandidates = [modelId];
  const stripped = modelId.replace(/[-:\s]free$/i, '').replace(/[-:\s]free[-_\w]*$/i, '');
  if (stripped && stripped !== modelId) {
    modelCandidates.push(stripped);
  }

  for (const pid of candidates) {
    const prov = provs[pid];
    if (!prov || !prov.models) continue;

    for (const midCandidate of modelCandidates) {
      if (prov.models[midCandidate]) {
        return { entry: prov.models[midCandidate], providerId, providerName: provDisplayName };
      }
      // Case-insensitive lookup
      for (const [mid, m] of Object.entries(prov.models)) {
        if (mid.toLowerCase() === midCandidate.toLowerCase()) {
          return { entry: m, providerId, providerName: provDisplayName };
        }
      }
    }
  }

  return { entry: null, providerId, providerName: provDisplayName };
}

export function searchCatalogModels(catalog: Catalog, query: string, limit = 40) {
  const rawQ = query.toLowerCase().trim();
  if (!rawQ) return [];

  const normQ = rawQ.replace(/[\._]/g, '-');
  const tokens = normQ.split(/[\s-]+/).filter(Boolean);

  const candidates: Array<{
    id: string;
    name: string;
    providerId: string;
    providerName: string;
    logo: string;
    inputRate: number;
    outputRate: number;
    cacheReadRate: number;
    score: number;
  }> = [];

  const provs = catalog.providers || {};
  const PRIMARY_PROVIDERS = new Set(['anthropic', 'openai', 'google', 'deepseek', 'opencode', 'meta-llama', 'mistralai', 'qwen', 'minimax']);

  for (const [pid, prov] of Object.entries(provs)) {
    if (!prov.models) continue;
    const providerName = prov.name || pid;
    const logo = `/logos/${pid}.svg`;

    for (const [mid, m] of Object.entries(prov.models)) {
      const name = m.name || mid;
      const fullId = `${pid}/${mid}`;

      const fullIdNorm = fullId.toLowerCase().replace(/[\._]/g, '-');
      const nameNorm = name.toLowerCase().replace(/[\._]/g, '-');
      const pidNorm = pid.toLowerCase().replace(/[\._]/g, '-');

      const allTokensMatch = tokens.every(
        (t) => fullIdNorm.includes(t) || nameNorm.includes(t) || pidNorm.includes(t)
      );

      if (allTokensMatch) {
        let score = 0;
        if (fullIdNorm === normQ || mid.toLowerCase() === normQ) score += 100;
        if (nameNorm === normQ) score += 90;
        if (PRIMARY_PROVIDERS.has(pid.toLowerCase())) score += 50;
        score += Math.max(0, 30 - mid.length);

        const cost = m.cost || {};
        candidates.push({
          id: fullId,
          name,
          providerId: pid,
          providerName,
          logo,
          inputRate: cost.input || 0,
          outputRate: cost.output || 0,
          cacheReadRate: cost.cache_read || 0,
          score,
        });
      }
    }
  }

  candidates.sort((a, b) => b.score - a.score);
  return candidates.slice(0, limit);
}

export function calculateTurnCost(
  catalog: Catalog,
  dbModel: string,
  inputTokens: number,
  outputTokens: number,
  cacheReadTokens: number,
  cacheWriteTokens: number = 0
): { cost: number; inputCost: number; outputCost: number; cacheSavings: number; rates: { input: number; output: number; cacheRead: number } } {
  const { entry } = findModelEntry(catalog, dbModel);
  const costDict = entry?.cost || {};

  let inputRate = costDict.input || 0;
  let outputRate = costDict.output || 0;
  let cacheReadRate = costDict.cache_read || 0;

  if (costDict.context_over_200k) {
    inputRate = costDict.context_over_200k.input ?? inputRate;
    outputRate = costDict.context_over_200k.output ?? outputRate;
    cacheReadRate = costDict.context_over_200k.cache_read ?? cacheReadRate;
  }

  const inputCost = (inputTokens / 1_000_000) * inputRate;
  const outputCost = (outputTokens / 1_000_000) * outputRate;
  const cacheCost = (cacheReadTokens / 1_000_000) * cacheReadRate;

  // Potential cost if cacheReadTokens had been charged as full inputTokens
  const fullInputCostForCache = (cacheReadTokens / 1_000_000) * inputRate;
  const cacheSavings = Math.max(0, fullInputCostForCache - cacheCost);

  const totalCost = inputCost + outputCost + cacheCost;

  return {
    cost: Number(totalCost.toFixed(4)),
    inputCost: Number(inputCost.toFixed(4)),
    outputCost: Number(outputCost.toFixed(4)),
    cacheSavings: Number(cacheSavings.toFixed(4)),
    rates: {
      input: inputRate,
      output: outputRate,
      cacheRead: cacheReadRate,
    },
  };
}
