import React, { useEffect, useState } from 'react';
import { ModelDetailItem, ProviderItem, CrossProviderModel } from '../types';
import { Cpu, Search, Building2, Layers, DollarSign, ChevronRight, X, ArrowUpDown } from 'lucide-react';
import { ProviderLogo } from '../components/ProviderLogo';

export const ModelViewerPage: React.FC = () => {
  const [viewMode, setViewMode] = useState<'provider' | 'cross'>('cross');
  const [models, setModels] = useState<ModelDetailItem[]>([]);
  const [crossModels, setCrossModels] = useState<CrossProviderModel[]>([]);
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [selectedProvider, setSelectedProvider] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [selectedBaseModel, setSelectedBaseModel] = useState<CrossProviderModel | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProviders();
  }, []);

  useEffect(() => {
    if (viewMode === 'provider') {
      fetchModels();
    } else {
      fetchCrossModels();
    }
  }, [selectedProvider, viewMode]);

  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/providers');
      if (res.ok) setProviders(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const fetchModels = async () => {
    setLoading(true);
    try {
      const url = selectedProvider === 'all' ? '/api/models' : `/api/models?provider=${selectedProvider}`;
      const res = await fetch(url);
      if (res.ok) setModels(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const fetchCrossModels = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/models/cross-provider');
      if (res.ok) setCrossModels(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const filteredModels = models.filter(
    (m) =>
      m.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.model.toLowerCase().includes(searchQuery.toLowerCase()) ||
      m.providerName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const filteredCrossModels = crossModels.filter(
    (cm) =>
      cm.displayName.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cm.baseModel.toLowerCase().includes(searchQuery.toLowerCase()) ||
      cm.providers.some((p) => p.providerName.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const formatNum = (num: number = 0) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toString();
  };

  return (
    <div className="space-y-6">
      {/* Header & Controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1C1D22] pb-4">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <Cpu className="w-5 h-5 text-[#5E6AD2]" />
            Model Viewer & Cross-Provider Rates
          </h2>
          <p className="text-[11px] sm:text-xs text-slate-500 font-mono mt-0.5">
            Inspect individual models and compare pricing & spend across all providers
          </p>
        </div>

        <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 w-full sm:w-auto">
          {/* View Mode Toggle */}
          <div className="bg-[#111215] p-0.5 rounded-md border border-[#22232A] flex items-center gap-1 text-[11px] font-mono justify-center">
            <button
              onClick={() => setViewMode('cross')}
              className={`px-3 py-1 rounded font-medium transition-all flex-1 sm:flex-none text-center ${
                viewMode === 'cross' ? 'bg-[#1C1D22] text-[#5E6AD2] border border-[#2E2F38]' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Cross-Provider
            </button>
            <button
              onClick={() => setViewMode('provider')}
              className={`px-3 py-1 rounded font-medium transition-all flex-1 sm:flex-none text-center ${
                viewMode === 'provider' ? 'bg-[#1C1D22] text-white border border-[#2E2F38]' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              By Provider
            </button>
          </div>

          {/* Search Bar */}
          <div className="relative w-full sm:w-60">
            <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
            <input
              type="text"
              placeholder="Search model or provider…"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full bg-[#111215] border border-[#22232A] rounded-md pl-9 pr-3 py-1 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#2E2F38] transition-all"
            />
          </div>
        </div>
      </div>

      {/* Provider Tabs (When in By Provider view) */}
      {viewMode === 'provider' && (
        <div className="flex items-center gap-1.5 overflow-x-auto pb-1 scrollbar-none">
          <button
            onClick={() => setSelectedProvider('all')}
            className={`flex items-center gap-1.5 px-3 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
              selectedProvider === 'all'
                ? 'bg-[#1C1D22] text-white border border-[#2E2F38]'
                : 'bg-[#111215] text-slate-400 hover:text-slate-200 border border-[#22232A]'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" /> All Providers
          </button>

          {providers.map((p) => {
            const isSelected = selectedProvider.toLowerCase() === p.providerId.toLowerCase();
            return (
              <button
                key={p.providerId}
                onClick={() => setSelectedProvider(p.providerId)}
                className={`flex items-center gap-1.5 px-2.5 py-1 rounded-md text-xs font-medium whitespace-nowrap transition-all ${
                  isSelected
                    ? 'bg-[#1C1D22] text-white border border-[#2E2F38]'
                    : 'bg-[#111215] text-slate-400 hover:text-slate-200 border border-[#22232A]'
                }`}
              >
                <ProviderLogo logo={p.logo} name={p.providerName} size="sm" />
                <span>{p.providerName}</span>
                <span className="text-[10px] bg-[#0B0C0E] px-1.5 py-0.2 rounded text-slate-500 font-mono">
                  {p.modelsCount}
                </span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Content Area */}
      {loading ? (
        <div className="flex items-center justify-center h-48 text-slate-500 font-mono text-xs">
          Loading model comparison data…
        </div>
      ) : viewMode === 'cross' ? (
        /* Cross-Provider Comparison View */
        <div className="space-y-4">
          <div className="grid grid-cols-1 gap-3">
            {filteredCrossModels.map((cm) => (
              <div
                key={cm.baseModel}
                onClick={() => setSelectedBaseModel(cm)}
                className="p-4 rounded-lg bg-[#111215] border border-[#22232A] hover:border-[#2E2F38] transition-all cursor-pointer space-y-3 group"
              >
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <h3 className="font-bold text-sm text-white group-hover:text-[#5E6AD2] transition-colors">
                        {cm.displayName}
                      </h3>
                      <span className="text-[10px] bg-[#1C1D22] text-slate-400 px-2 py-0.5 rounded font-mono border border-[#26272F]">
                        {cm.baseModel}
                      </span>
                      <span className="text-[10px] bg-[#5E6AD2]/10 text-[#5E6AD2] px-2 py-0.5 rounded font-mono border border-[#5E6AD2]/20">
                        {cm.providersCount} {cm.providersCount === 1 ? 'provider' : 'providers'}
                      </span>
                    </div>
                    <p className="text-[11px] text-slate-500 mt-0.5 font-mono">
                      {cm.totalTurns.toLocaleString()} total turns logged
                    </p>
                  </div>

                  <div className="flex items-center justify-between sm:justify-end gap-4 border-t sm:border-t-0 pt-2 sm:pt-0 border-[#1C1D22]">
                    <div className="text-left sm:text-right font-mono">
                      <div className="text-sm font-bold text-[#26B574]">
                        ${cm.totalCost.toFixed(2)}
                      </div>
                      <div className="text-[10px] text-slate-500">Total Spend</div>
                    </div>
                    <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-white transition-colors" />
                  </div>
                </div>

                {/* Provider pills row */}
                <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-[#1C1D22] text-xs font-mono">
                  {cm.providers.map((p) => (
                    <div key={p.model} className="flex items-center gap-2 bg-[#0B0C0E] px-2.5 py-1 rounded border border-[#1C1D22]">
                      <ProviderLogo logo={p.logo} name={p.providerName} size="sm" />
                      <span className="text-slate-300 font-medium text-[11px]">{p.providerName}</span>
                      <span className="text-[10px] text-[#26B574] font-bold">${p.cost.toFixed(2)}</span>
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* By Provider Table View */
        <div className="rounded-lg bg-[#111215] border border-[#22232A] overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse min-w-[750px]">
              <thead>
                <tr className="border-b border-[#1C1D22] text-[10px] font-mono font-semibold text-slate-500 uppercase tracking-wider">
                  <th className="py-2.5 px-3">Model</th>
                  <th className="py-2.5 px-3 text-right">Turns</th>
                  <th className="py-2.5 px-3 text-right">Sessions</th>
                  <th className="py-2.5 px-3 text-right">Input Tokens</th>
                  <th className="py-2.5 px-3 text-right">Output Tokens</th>
                  <th className="py-2.5 px-3 text-right">Cache Read</th>
                  <th className="py-2.5 px-3 text-right">Rate / 1M (In / Out / Cache)</th>
                  <th className="py-2.5 px-3 text-right">Total Spent</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#1C1D22] text-xs font-mono">
                {filteredModels.map((m) => (
                  <tr key={m.model} className="hover:bg-[#16171B] transition-colors">
                    <td className="py-2.5 px-3">
                      <div className="flex items-center gap-2.5">
                        <ProviderLogo logo={m.logo} name={m.providerName} size="md" />
                        <div>
                          <div className="font-semibold text-white font-sans text-xs">{m.displayName}</div>
                          <div className="text-[10px] text-slate-500">{m.model}</div>
                        </div>
                      </div>
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-300">
                      {m.turns.toLocaleString()}
                    </td>
                    <td className="py-2.5 px-3 text-right text-slate-500">
                      {m.sessionsCount}
                    </td>
                    <td className="py-2.5 px-3 text-right text-[#5E6AD2]">
                      {formatNum(m.inputTokens)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-indigo-300">
                      {formatNum(m.outputTokens)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-purple-400">
                      {formatNum(m.cacheReadTokens)}
                    </td>
                    <td className="py-2.5 px-3 text-right text-[11px] text-slate-400">
                      ${m.rates.input} / ${m.rates.output} / ${m.rates.cacheRead}
                    </td>
                    <td className="py-2.5 px-3 text-right font-bold text-[#26B574]">
                      ${m.totalCost.toFixed(2)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Cross-Provider Model Breakdown Drawer Modal */}
      {selectedBaseModel && (
        <div className="fixed inset-0 bg-black/80 z-50 flex justify-end animate-fadeIn">
          <div className="w-full sm:max-w-xl bg-[#0B0C0E] border-l border-[#1C1D22] h-full flex flex-col">
            {/* Header */}
            <div className="p-4 border-b border-[#1C1D22] flex items-center justify-between bg-[#111215]">
              <div>
                <div className="flex items-center gap-2">
                  <Cpu className="w-4 h-4 text-[#5E6AD2]" />
                  <h3 className="font-bold text-sm text-white font-sans">
                    {selectedBaseModel.displayName}
                  </h3>
                </div>
                <p className="text-[10px] font-mono text-slate-500 mt-0.5">
                  Cost & rate comparison across {selectedBaseModel.providersCount} providers
                </p>
              </div>

              <button
                onClick={() => setSelectedBaseModel(null)}
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-[#1C1D22] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Provider Breakdown Table */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs">
              <div className="p-3 rounded bg-[#111215] border border-[#22232A] flex justify-between items-center text-xs">
                <span className="text-slate-400 font-sans">Total Spent across All Providers:</span>
                <span className="text-[#26B574] font-bold font-mono text-sm">
                  ${selectedBaseModel.totalCost.toFixed(2)}
                </span>
              </div>

              <div className="rounded bg-[#111215] border border-[#22232A] overflow-hidden">
                <table className="w-full text-left border-collapse text-[11px]">
                  <thead>
                    <tr className="border-b border-[#1C1D22] text-[10px] text-slate-500 uppercase tracking-wider">
                      <th className="py-2.5 px-3">Provider</th>
                      <th className="py-2.5 px-3 text-right">Turns</th>
                      <th className="py-2.5 px-3 text-right">Rate / 1M (In / Out)</th>
                      <th className="py-2.5 px-3 text-right">Spent</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#1C1D22]">
                    {selectedBaseModel.providers.map((p) => (
                      <tr key={p.model} className="hover:bg-[#16171B] transition-colors">
                        <td className="py-2.5 px-3">
                          <div className="flex items-center gap-2">
                            <img
                              src={p.logo}
                              alt={p.providerName}
                              className="w-4 h-4 rounded object-contain"
                              onError={(e) => {
                                (e.target as HTMLElement).style.display = 'none';
                              }}
                            />
                            <div>
                              <div className="font-semibold text-white font-sans text-xs">{p.providerName}</div>
                              <div className="text-[9px] text-slate-500">{p.model}</div>
                            </div>
                          </div>
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-300">
                          {p.turns.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-3 text-right text-slate-400">
                          ${p.rates.input} / ${p.rates.output}
                        </td>
                        <td className="py-2.5 px-3 text-right font-bold text-[#26B574]">
                          ${p.cost.toFixed(2)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
