import React, { useEffect, useState } from 'react';
import { Timeframe, UsageSummary, SessionItem } from '../types';
import { ProviderLogo } from '../components/ProviderLogo';
import {
  Calculator,
  Search,
  Clock,
  TrendingDown,
  TrendingUp,
  DollarSign,
  Zap,
  Check,
  Building2,
} from 'lucide-react';

interface CatalogSearchResult {
  id: string;
  name: string;
  providerId: string;
  providerName: string;
  logo: string;
  inputRate: number;
  outputRate: number;
  cacheReadRate: number;
}

const PRESET_MODELS: CatalogSearchResult[] = [
  {
    id: 'google/gemini-2.0-flash',
    name: 'Gemini 2.0 Flash',
    providerId: 'google',
    providerName: 'Google',
    logo: '/logos/google.svg',
    inputRate: 0.10,
    outputRate: 0.40,
    cacheReadRate: 0.025,
  },
  {
    id: 'anthropic/claude-3-5-sonnet',
    name: 'Claude 3.5 Sonnet',
    providerId: 'anthropic',
    providerName: 'Anthropic',
    logo: '/logos/anthropic.svg',
    inputRate: 3.00,
    outputRate: 15.00,
    cacheReadRate: 0.30,
  },
  {
    id: 'openai/gpt-4o',
    name: 'GPT-4o',
    providerId: 'openai',
    providerName: 'OpenAI',
    logo: '/logos/openai.svg',
    inputRate: 2.50,
    outputRate: 10.00,
    cacheReadRate: 1.25,
  },
  {
    id: 'openai/gpt-4o-mini',
    name: 'GPT-4o Mini',
    providerId: 'openai',
    providerName: 'OpenAI',
    logo: '/logos/openai.svg',
    inputRate: 0.15,
    outputRate: 0.60,
    cacheReadRate: 0.075,
  },
  {
    id: 'deepseek/deepseek-chat',
    name: 'DeepSeek V3',
    providerId: 'deepseek',
    providerName: 'DeepSeek',
    logo: '/logos/deepseek.svg',
    inputRate: 0.14,
    outputRate: 0.28,
    cacheReadRate: 0.014,
  },
];

export const SimulatorPage: React.FC = () => {
  const [timeframe, setTimeframe] = useState<Timeframe>('all');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<CatalogSearchResult[]>([]);
  const [selectedModel, setSelectedModel] = useState<CatalogSearchResult>(PRESET_MODELS[0]);
  const [loading, setLoading] = useState(true);
  const [searching, setSearching] = useState(false);
  const [showDropdown, setShowDropdown] = useState(false);

  useEffect(() => {
    fetchSummary();
    fetchSessions();
  }, [timeframe]);

  useEffect(() => {
    if (searchQuery.trim().length > 0) {
      searchCatalog(searchQuery);
    } else {
      setSearchResults([]);
    }
  }, [searchQuery]);

  const fetchSummary = async () => {
    try {
      const res = await fetch(`/api/summary?timeframe=${timeframe}`);
      if (res.ok) setSummary(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchSessions = async () => {
    try {
      const res = await fetch(`/api/sessions?page=1&limit=50`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.items);
      }
    } catch (err) {
      console.error(err);
    }
  };

  const searchCatalog = async (q: string) => {
    setSearching(true);
    try {
      const res = await fetch(`/api/catalog/search?q=${encodeURIComponent(q)}&limit=15`);
      if (res.ok) {
        const data = await res.json();
        setSearchResults(data);
        setShowDropdown(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setSearching(false);
    }
  };

  const formatNum = (num: number = 0) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toString();
  };

  // Calculations
  const actualCost = summary?.totalCost || 0;
  const inputInM = (summary?.totalInputTokens || 0) / 1_000_000;
  const outputInM = (summary?.totalOutputTokens || 0) / 1_000_000;
  const cacheInM = (summary?.totalCacheReadTokens || 0) / 1_000_000;

  const simulatedCost = Number(
    (inputInM * selectedModel.inputRate + outputInM * selectedModel.outputRate + cacheInM * selectedModel.cacheReadRate).toFixed(2)
  );

  const diff = Number((simulatedCost - actualCost).toFixed(2));
  const isSavings = diff < 0;
  const diffPct = actualCost > 0 ? Math.abs(Math.round((diff / actualCost) * 100)) : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1C1D22] pb-4">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <Calculator className="w-5 h-5 text-[#5E6AD2]" />
            "What If" Cost Simulator
          </h2>
          <p className="text-[11px] sm:text-xs text-slate-500 font-mono mt-0.5">
            Search 5,700+ catalog models to recalculate past session expenditure
          </p>
        </div>

        {/* Global Timeframe Selector */}
        <div className="bg-[#111215] p-0.5 rounded-md border border-[#22232A] flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-[11px] font-mono overflow-x-auto self-start sm:self-auto">
          <div className="px-1.5 sm:px-2 py-1 text-slate-500 text-[10px] flex items-center gap-1 border-r border-[#1C1D22] shrink-0">
            <Clock className="w-3 h-3 text-[#5E6AD2]" /> Period:
          </div>
          {(['all', 'monthly', 'weekly', 'daily'] as const).map((t) => (
            <button
              key={t}
              onClick={() => setTimeframe(t)}
              className={`px-2 sm:px-3 py-1 rounded font-medium transition-all shrink-0 ${
                timeframe === t
                  ? 'bg-[#1C1D22] text-white border border-[#2E2F38]'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              {t === 'all' ? 'All Time' : t === 'monthly' ? '30D' : t === 'weekly' ? '7D' : '24H'}
            </button>
          ))}
        </div>
      </div>

      {/* Model Search & Presets Bar */}
      <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A] space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-1">
          <label className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400">
            Search Candidate Model
          </label>
          <span className="text-[10px] text-slate-500 font-mono">5,700+ models in catalog</span>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search any model (e.g. claude-3-5-sonnet, gpt-4o, gemini-2.0-flash, deepseek-v3, qwen)…"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onFocus={() => setShowDropdown(searchResults.length > 0)}
            className="w-full bg-[#0B0C0E] border border-[#22232A] rounded-md pl-10 pr-4 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#2E2F38] font-mono transition-all"
          />

          {/* Search Results Dropdown */}
          {showDropdown && searchResults.length > 0 && (
            <div className="absolute left-0 right-0 top-full mt-1 bg-[#0E0F12] border border-[#22232A] rounded-md shadow-2xl z-40 max-h-60 overflow-y-auto divide-y divide-[#1C1D22] font-mono text-xs">
              {searchResults.map((m) => (
                <div
                  key={m.id}
                  onClick={() => {
                    setSelectedModel(m);
                    setSearchQuery('');
                    setShowDropdown(false);
                  }}
                  className="p-2.5 hover:bg-[#16171B] cursor-pointer flex items-center justify-between transition-colors"
                >
                  <div className="flex items-center gap-2.5">
                    <ProviderLogo logo={m.logo} name={m.providerName} size="sm" />
                    <div>
                      <div className="font-bold text-white text-xs">{m.name}</div>
                      <div className="text-[10px] text-slate-500">{m.id}</div>
                    </div>
                  </div>
                  <div className="text-right text-[10px] text-slate-400">
                    <div>In: ${m.inputRate}/1M</div>
                    <div>Out: ${m.outputRate}/1M</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Popular Presets Pills */}
        <div className="flex flex-wrap items-center gap-2 pt-1 font-mono text-xs">
          <span className="text-[10px] text-slate-500 uppercase w-full sm:w-auto">Popular Presets:</span>
          {PRESET_MODELS.map((m) => {
            const isSelected = selectedModel.id === m.id;
            return (
              <button
                key={m.id}
                onClick={() => setSelectedModel(m)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium transition-all ${
                  isSelected
                    ? 'bg-[#1C1D22] text-[#5E6AD2] border border-[#5E6AD2]/40 font-bold'
                    : 'bg-[#0B0C0E] text-slate-400 hover:text-slate-200 border border-[#1C1D22]'
                }`}
              >
                <ProviderLogo logo={m.logo} name={m.providerName} size="sm" />
                <span>{m.name}</span>
              </button>
            );
          })}
        </div>
      </div>

      {/* Selected Model Details & Simulation Summary Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 font-mono">
        {/* Selected Target Model Card */}
        <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A] space-y-3">
          <div className="text-[10px] font-semibold text-slate-500 uppercase">Target Model Selected</div>
          <div className="flex items-center gap-3">
            <ProviderLogo logo={selectedModel.logo} name={selectedModel.providerName} size="lg" />
            <div>
              <div className="font-bold text-white text-sm font-sans">{selectedModel.name}</div>
              <div className="text-[10px] text-slate-500">{selectedModel.id}</div>
            </div>
          </div>
          <div className="space-y-1 pt-2 border-t border-[#1C1D22] text-xs text-slate-300">
            <div className="flex justify-between">
              <span className="text-slate-500">Input Rate:</span>
              <span>${selectedModel.inputRate} / 1M</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Output Rate:</span>
              <span>${selectedModel.outputRate} / 1M</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Cache Read Rate:</span>
              <span>${selectedModel.cacheReadRate} / 1M</span>
            </div>
          </div>
        </div>

        {/* Actual vs Simulated Spend */}
        <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A] space-y-3">
          <div className="text-[10px] font-semibold text-slate-500 uppercase">Cost Comparison ({timeframe})</div>
          <div className="grid grid-cols-2 gap-2 pt-1">
            <div className="p-2.5 rounded bg-[#0B0C0E] border border-[#1C1D22]">
              <div className="text-[10px] text-slate-500">Actual Spend</div>
              <div className="font-bold text-white text-base">${actualCost.toFixed(2)}</div>
            </div>
            <div className="p-2.5 rounded bg-[#0B0C0E] border border-[#1C1D22]">
              <div className="text-[10px] text-[#5E6AD2]">Simulated Spend</div>
              <div className="font-bold text-[#5E6AD2] text-base">${simulatedCost.toFixed(2)}</div>
            </div>
          </div>
          <div className="text-[10px] text-slate-500">
            Based on {formatNum(summary?.totalInputTokens)} in + {formatNum(summary?.totalOutputTokens)} out
          </div>
        </div>

        {/* Net Delta / Savings Banner */}
        <div className={`p-4 rounded-lg border flex flex-col justify-between space-y-3 sm:col-span-2 lg:col-span-1 ${
          isSavings ? 'bg-[#26B574]/10 border-[#26B574]/30 text-[#26B574]' : 'bg-[#E5484D]/10 border-[#E5484D]/30 text-[#E5484D]'
        }`}>
          <div className="flex items-center gap-2 font-sans font-bold text-sm">
            {isSavings ? <TrendingDown className="w-5 h-5" /> : <TrendingUp className="w-5 h-5" />}
            <span>{isSavings ? 'Net Cost Reduction' : 'Net Cost Surcharge'}</span>
          </div>

          <div>
            <div className="text-2xl font-extrabold font-mono">
              {isSavings ? `-$${Math.abs(diff).toFixed(2)}` : `+$${diff.toFixed(2)}`}
            </div>
            <div className="text-xs font-mono font-semibold mt-0.5">
              {isSavings ? `${diffPct}% overall savings` : `${diffPct}% cost increase`}
            </div>
          </div>

          <div className="text-[10px] font-sans opacity-80">
            {isSavings
              ? `Switching to ${selectedModel.name} would save ~$${Math.abs(diff).toFixed(2)}`
              : `Switching to ${selectedModel.name} would add ~$${diff.toFixed(2)} to LLM expenses`}
          </div>
        </div>
      </div>

      {/* Per-Session Simulation Table */}
      <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A] space-y-3">
        <div className="flex items-center justify-between border-b border-[#1C1D22] pb-3">
          <h3 className="font-semibold text-xs text-white">Past Session Cost Simulation</h3>
          <span className="text-[10px] font-mono text-slate-500">Top 50 sessions</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse font-mono text-xs min-w-[600px]">
            <thead>
              <tr className="border-b border-[#1C1D22] text-[10px] text-slate-500 uppercase">
                <th className="py-2.5 px-3">Session ID</th>
                <th className="py-2.5 px-3 text-right">Turns</th>
                <th className="py-2.5 px-3 text-right">Actual Cost</th>
                <th className="py-2.5 px-3 text-right">Simulated ({selectedModel.name})</th>
                <th className="py-2.5 px-3 text-right">Difference</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-[#1C1D22]">
              {sessions.map((s) => {
                const sInM = s.inputTokens / 1_000_000;
                const sOutM = s.outputTokens / 1_000_000;
                const sCacheM = s.cacheReadTokens / 1_000_000;
                const sSim = Number((sInM * selectedModel.inputRate + sOutM * selectedModel.outputRate + sCacheM * selectedModel.cacheReadRate).toFixed(2));
                const sDiff = Number((sSim - s.totalCost).toFixed(2));
                const sSaved = sDiff < 0;

                return (
                  <tr key={s.sessionId} className="hover:bg-[#16171B] transition-colors">
                    <td className="py-2 px-3 text-slate-300 font-bold">
                      {s.sessionId.slice(0, 20)}…
                    </td>
                    <td className="py-2 px-3 text-right text-slate-400">{s.turnCount}</td>
                    <td className="py-2 px-3 text-right text-slate-200">${s.totalCost.toFixed(2)}</td>
                    <td className="py-2 px-3 text-right text-[#5E6AD2] font-bold">${sSim.toFixed(2)}</td>
                    <td className={`py-2 px-3 text-right font-bold ${sSaved ? 'text-[#26B574]' : 'text-[#E5484D]'}`}>
                      {sSaved ? `-$${Math.abs(sDiff).toFixed(2)}` : `+$${sDiff.toFixed(2)}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
