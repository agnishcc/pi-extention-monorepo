export type Timeframe = 'all' | 'monthly' | 'weekly' | 'daily';

export interface UsageSummary {
  totalTurns: number;
  totalSessions: number;
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCacheReadTokens: number;
  totalCacheWriteTokens: number;
  totalCost: number;
  totalCacheSavings: number;
  callerBreakdown: {
    main: { turns: number; cost: number };
    subagent: { turns: number; cost: number };
  };
  timeframe: Timeframe;
}

export interface TopModel {
  model: string;
  displayName: string;
  providerId: string;
  providerName: string;
  logo: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalTokens: number;
  cost: number;
}

export interface TimelineDataPoint {
  date: string;
  input: number;
  output: number;
  cacheRead: number;
  cost: number;
  turns: number;
}

export interface ProviderItem {
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
}

export interface ProviderBreakdownItem {
  model: string;
  providerId: string;
  providerName: string;
  logo: string;
  turns: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cost: number;
  rates: {
    input: number;
    output: number;
    cacheRead: number;
  };
}

export interface CrossProviderModel {
  baseModel: string;
  displayName: string;
  totalTurns: number;
  totalCost: number;
  providersCount: number;
  providers: ProviderBreakdownItem[];
}

export interface ModelDetailItem {
  model: string;
  displayName: string;
  providerId: string;
  providerName: string;
  logo: string;
  turns: number;
  sessionsCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheWriteTokens: number;
  totalCost: number;
  rates: {
    input: number;
    output: number;
    cacheRead: number;
  };
  modalities: string[];
}

export interface SessionItem {
  sessionId: string;
  firstTurn: string;
  lastTurn: string;
  turnCount: number;
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  totalCost: number;
  models: string[];
  hasTranscript: boolean;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string;
  timestamp?: string;
  model?: string;
  provider?: string;
  usage?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
  };
  tools?: Array<{
    name: string;
    args?: any;
    result?: string;
  }>;
}

export interface SessionTranscript {
  sessionId: string;
  filepath: string;
  firstTurn?: string;
  lastTurn?: string;
  messages: ChatMessage[];
  modelsUsed: string[];
}

export interface DbStats {
  dbPath: string;
  fileSizeBytes: number;
  fileSizeFormatted: string;
  tableCount: number;
  totalRows: number;
  journalMode: string;
  integrityStatus: string;
  indexCount: number;
  tables: Array<{ name: string; rowCount: number }>;
}

export interface DbRow {
  id: number;
  timestamp: string;
  session_id: string;
  caller: 'main' | 'subagent' | string;
  agent_id?: string | null;
  agent_type?: string | null;
  model: string;
  turn_number: number;
  input_tokens: number;
  output_tokens: number;
  cache_read_tokens: number;
  cache_write_tokens: number;
}

export interface DbRowsResponse {
  rows: DbRow[];
  total: number;
  limit: number;
  offset: number;
  page: number;
  totalPages: number;
}

export interface SqlQueryResult {
  columns: string[];
  rows: Record<string, any>[];
  rowCount: number;
  executionTimeMs: number;
  error?: string;
}

