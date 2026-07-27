import React, { useEffect, useState } from 'react';
import { ProviderItem } from '../types';
import { Building2 } from 'lucide-react';
import { ProviderLogo } from '../components/ProviderLogo';

export const ProviderAnalyticsPage: React.FC = () => {
  const [providers, setProviders] = useState<ProviderItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetchProviders();
  }, []);

  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/providers');
      if (res.ok) setProviders(await res.json());
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const formatNum = (num: number = 0) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toString();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-48 text-slate-500 font-mono text-xs">
        Loading providers…
      </div>
    );
  }

  const totalSpentAll = providers.reduce((sum, p) => sum + p.totalCost, 0) || 1;

  return (
    <div className="space-y-6">
      <div className="border-b border-[#1C1D22] pb-4">
        <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
          <Building2 className="w-5 h-5 text-[#5E6AD2]" />
          Provider Market Share
        </h2>
        <p className="text-xs text-slate-500 font-mono mt-0.5">
          Cost allocation across Anthropic, OpenAI, Google, DeepSeek, OpenRouter
        </p>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
        {providers.map((p) => {
          const pct = Math.round((p.totalCost / totalSpentAll) * 100);
          return (
            <div key={p.providerId} className="p-4 rounded-lg bg-[#111215] border border-[#22232A] space-y-3">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2.5">
                  <ProviderLogo logo={p.logo} name={p.providerName} size="lg" />
                  <div>
                    <h3 className="font-semibold text-xs text-white">{p.providerName}</h3>
                    <p className="text-[10px] text-slate-500 font-mono">
                      {p.modelsCount} models • {p.sessionsCount} sessions
                    </p>
                  </div>
                </div>
                <div className="text-right font-mono">
                  <div className="text-sm font-bold text-[#26B574]">
                    ${p.totalCost.toFixed(2)}
                  </div>
                  <div className="text-[9px] text-slate-500">{pct}% share</div>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1.5 rounded-full bg-[#1C1D22] overflow-hidden">
                <div
                  className="h-full rounded-full bg-[#5E6AD2]"
                  style={{ width: `${Math.max(4, pct)}%` }}
                />
              </div>

              <div className="grid grid-cols-3 gap-2 pt-2 border-t border-[#1C1D22] text-[11px] font-mono text-slate-400">
                <div>
                  <div className="text-[9px] text-slate-500">Turns</div>
                  <div className="font-bold text-slate-200">{p.turns.toLocaleString()}</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-500">Input</div>
                  <div className="font-bold text-[#5E6AD2]">{formatNum(p.inputTokens)}</div>
                </div>
                <div>
                  <div className="text-[9px] text-slate-500">Cache Read</div>
                  <div className="font-bold text-purple-400">{formatNum(p.cacheReadTokens)}</div>
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
};
