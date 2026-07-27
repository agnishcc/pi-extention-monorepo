import React, { useEffect, useState } from 'react';
import { TopModel, Timeframe } from '../types';
import { DollarSign, Layers } from 'lucide-react';
import { ProviderLogo } from './ProviderLogo';

interface TopModelsCardProps {
  timeframe: Timeframe;
}

export const TopModelsCard: React.FC<TopModelsCardProps> = ({ timeframe }) => {
  const [topByCost, setTopByCost] = useState<TopModel[]>([]);
  const [topByUsage, setTopByUsage] = useState<TopModel[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchTopModels(timeframe);
  }, [timeframe]);

  const fetchTopModels = async (tf: Timeframe) => {
    setLoading(true);
    try {
      const [resCost, resUsage] = await Promise.all([
        fetch(`/api/models/top?by=cost&limit=5&timeframe=${tf}`),
        fetch(`/api/models/top?by=usage&limit=5&timeframe=${tf}`),
      ]);

      const costData = resCost.ok ? await resCost.json() : [];
      const usageData = resUsage.ok ? await resUsage.json() : [];

      const costList = Array.isArray(costData) ? costData : [];
      let usageList = Array.isArray(usageData) ? usageData : [];

      // Fallback: If by=usage is empty but costList has items, compute top usage from costList
      if (usageList.length === 0 && costList.length > 0) {
        usageList = [...costList].sort((a, b) => (b.totalTokens || 0) - (a.totalTokens || 0)).slice(0, 5);
      }

      setTopByCost(costList);
      setTopByUsage(usageList);
    } catch (err) {
      console.error('Failed to fetch top models:', err);
    } finally {
      setLoading(false);
    }
  };

  const maxCost = topByCost.length > 0 ? Math.max(...topByCost.map((m) => m.cost || 0)) || 1 : 1;
  const maxTokens = topByUsage.length > 0 ? Math.max(...topByUsage.map((m) => m.totalTokens || 0)) || 1 : 1;

  const formatTokens = (num: number = 0) => {
    if (!num || isNaN(num)) return '0';
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toString();
  };

  return (
    <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
      {/* Top 5 by Cost */}
      <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A]">
        <div className="flex items-center justify-between mb-4 border-b border-[#1C1D22] pb-3">
          <div className="flex items-center gap-2">
            <DollarSign className="w-4 h-4 text-[#26B574]" />
            <h3 className="font-semibold text-xs text-white">Top 5 Models by Spend</h3>
          </div>
          <span className="text-[10px] font-mono text-slate-500 uppercase">{timeframe}</span>
        </div>

        {loading ? (
          <div className="py-8 text-center text-slate-600 text-xs font-mono">Loading data…</div>
        ) : topByCost.length === 0 ? (
          <div className="py-8 text-center text-slate-600 text-xs font-mono">No usage recorded in this interval</div>
        ) : (
          <div className="space-y-3">
            {topByCost.map((m, idx) => {
              const pct = maxCost > 0 ? Math.round(((m.cost || 0) / maxCost) * 100) : 0;
              return (
                <div key={m.model} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 truncate max-w-[70%]">
                      <span className="text-slate-600 font-mono text-[10px] w-3">#{idx + 1}</span>
                      <ProviderLogo logo={m.logo} name={m.providerName} size="sm" />
                      <span className="text-slate-200 truncate font-medium text-[11px]">{m.displayName}</span>
                      <span className="text-[9px] text-slate-500 font-mono">({m.providerName})</span>
                    </div>
                    <div className="font-mono text-[#26B574] font-semibold text-[11px]">${(m.cost || 0).toFixed(2)}</div>
                  </div>

                  {/* Progress line */}
                  <div className="w-full h-1 rounded-full bg-[#1C1D22] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#26B574] transition-all duration-300"
                      style={{ width: `${Math.max(3, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Top 5 by Volume */}
      <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A]">
        <div className="flex items-center justify-between mb-4 border-b border-[#1C1D22] pb-3">
          <div className="flex items-center gap-2">
            <Layers className="w-4 h-4 text-[#5E6AD2]" />
            <h3 className="font-semibold text-xs text-white">Top 5 Models by Token Volume</h3>
          </div>
          <span className="text-[10px] font-mono text-slate-500 uppercase">{timeframe}</span>
        </div>

        {loading ? (
          <div className="py-8 text-center text-slate-600 text-xs font-mono">Loading data…</div>
        ) : topByUsage.length === 0 ? (
          <div className="py-8 text-center text-slate-600 text-xs font-mono">No usage recorded in this interval</div>
        ) : (
          <div className="space-y-3">
            {topByUsage.map((m, idx) => {
              const pct = maxTokens > 0 ? Math.round(((m.totalTokens || 0) / maxTokens) * 100) : 0;
              return (
                <div key={m.model} className="space-y-1">
                  <div className="flex items-center justify-between text-xs">
                    <div className="flex items-center gap-2 truncate max-w-[70%]">
                      <span className="text-slate-600 font-mono text-[10px] w-3">#{idx + 1}</span>
                      <ProviderLogo logo={m.logo} name={m.providerName} size="sm" />
                      <span className="text-slate-200 truncate font-medium text-[11px]">{m.displayName}</span>
                      <span className="text-[9px] text-slate-500 font-mono">{m.turns} turns</span>
                    </div>
                    <div className="font-mono text-[#5E6AD2] font-semibold text-[11px]">{formatTokens(m.totalTokens)}</div>
                  </div>

                  {/* Progress line */}
                  <div className="w-full h-1 rounded-full bg-[#1C1D22] overflow-hidden">
                    <div
                      className="h-full rounded-full bg-[#5E6AD2] transition-all duration-300"
                      style={{ width: `${Math.max(3, pct)}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
};
