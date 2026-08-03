import React, { useEffect, useState } from 'react';
import { ProviderSummary } from '../types';
import { ProviderLogo } from '../components/ProviderLogo';
import {
  CreditCard,
  Plus,
  Trash2,
  Clock,
  Sparkles,
  CheckCircle2,
  Search,
  X,
  Building2,
  DollarSign,
} from 'lucide-react';

export interface SavedSubscription {
  providerId: string;
  providerName: string;
  logo: string;
  cost: number;
  cycle: 'monthly' | 'yearly';
  updatedAt?: string;
}

interface AllProviderItem {
  providerId: string;
  providerName: string;
  logo: string;
  turns: number;
  totalCost: number;
  totalTokens: number;
}

export const SubscriptionAdvisorPage: React.FC = () => {
  const [subscriptions, setSubscriptions] = useState<SavedSubscription[]>([]);
  const [dbProvidersMap, setDbProvidersMap] = useState<Record<string, ProviderSummary>>({});
  const [allCatalogProviders, setAllCatalogProviders] = useState<AllProviderItem[]>([]);

  const [isAddModalOpen, setIsAddModalOpen] = useState(false);
  const [selectedProviderId, setSelectedProviderId] = useState('');
  const [costInput, setCostInput] = useState<number | ''>(20);
  const [cycleInput, setCycleInput] = useState<'monthly' | 'yearly'>('monthly');
  const [searchProviderQuery, setSearchProviderQuery] = useState('');

  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    fetchData();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const [resSub, resP, resAll] = await Promise.all([
        fetch('/api/subscriptions'),
        fetch('/api/providers'),
        fetch('/api/providers/all'),
      ]);

      const subData = resSub.ok ? await resSub.json() : [];
      const provData = resP.ok ? await resP.json() : [];
      const allData = resAll.ok ? await resAll.json() : [];

      setSubscriptions(Array.isArray(subData) ? subData : []);
      setAllCatalogProviders(allData);

      const pMap: Record<string, ProviderSummary> = {};
      for (const p of provData) {
        pMap[p.providerId] = p;
      }
      setDbProvidersMap(pMap);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  };

  const handleAddSubscription = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedProviderId || typeof costInput !== 'number' || costInput <= 0) return;

    setSubmitting(true);
    try {
      const res = await fetch('/api/subscriptions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          providerId: selectedProviderId,
          cost: costInput,
          cycle: cycleInput,
        }),
      });

      if (res.ok) {
        setIsAddModalOpen(false);
        setSelectedProviderId('');
        setSearchProviderQuery('');
        setCostInput(20);
        await fetchData();
      }
    } catch (err) {
      console.error('Failed to add subscription', err);
    } finally {
      setSubmitting(false);
    }
  };

  const handleRemoveSubscription = async (providerId: string) => {
    try {
      const res = await fetch(`/api/subscriptions/${providerId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        setSubscriptions((prev) => prev.filter((s) => s.providerId !== providerId));
      }
    } catch (err) {
      console.error('Failed to remove subscription', err);
    }
  };

  // Helper formatting
  const formatTokens = (num: number = 0) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(1)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(0)}k`;
    return num.toString();
  };

  // Calculate calculations for each saved subscription
  let totalSubMonthly = 0;
  let totalApiMonthly = 0;
  let totalSavingsMonthly = 0;

  const subscriptionDetails = subscriptions.map((sub) => {
    const dbP = dbProvidersMap[sub.providerId];
    const catP = allCatalogProviders.find((x) => x.providerId === sub.providerId);

    const providerName = sub.providerName || dbP?.providerName || catP?.providerName || sub.providerId;
    const logo = sub.logo || `/logos/${sub.providerId}.svg`;
    const turns = dbP?.turns || 0;
    const totalTokens = dbP?.totalTokens || 0;
    const totalCost = dbP?.totalCost || 0;

    const monthlySubCost = sub.cycle === 'yearly' ? sub.cost / 12 : sub.cost;
    const monthlyApiCost = Number((totalCost / 4).toFixed(2)); // ~4 months history

    const diff = Number((monthlyApiCost - monthlySubCost).toFixed(2));
    const advantage: 'subscription' | 'api' = monthlyApiCost > monthlySubCost && monthlySubCost > 0 ? 'subscription' : 'api';
    const netSavings = Math.abs(diff);

    totalSubMonthly += monthlySubCost;
    totalApiMonthly += monthlyApiCost;
    totalSavingsMonthly += netSavings;

    // Breakeven metrics
    const avgCostPerTurn = turns > 0 ? totalCost / turns : 0.05;
    const monthlyBreakevenTurns = monthlySubCost > 0 && avgCostPerTurn > 0 ? Math.ceil(monthlySubCost / avgCostPerTurn) : 0;
    const dailyBreakevenTurns = Math.ceil(monthlyBreakevenTurns / 30);
    const dailyBreakevenMinutes = Math.ceil(dailyBreakevenTurns * 1.5);

    const actualDailyTurns = Math.round(turns / 120);
    const actualDailyMinutes = Math.round(actualDailyTurns * 1.5);
    const breakevenPct = dailyBreakevenTurns > 0 ? Math.round((actualDailyTurns / dailyBreakevenTurns) * 100) : 0;

    return {
      sub,
      providerName,
      logo,
      turns,
      totalTokens,
      totalCost,
      monthlySubCost,
      monthlyApiCost,
      diff,
      advantage,
      netSavings,
      dailyBreakevenTurns,
      dailyBreakevenMinutes,
      actualDailyTurns,
      actualDailyMinutes,
      breakevenPct,
    };
  });

  // Filtered providers for Add modal search
  const filteredCatalogProviders = allCatalogProviders.filter((p) => {
    if (!searchProviderQuery.trim()) return true;
    const q = searchProviderQuery.toLowerCase().trim();
    return p.providerName.toLowerCase().includes(q) || p.providerId.toLowerCase().includes(q);
  });

  return (
    <div className="space-y-6 font-sans">
      {/* Top Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1C1D22] pb-4">
        <div>
          <h2 className="text-base sm:text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-[#5E6AD2]" />
            Subscription vs Pay-Per-Token Advisor
          </h2>
          <p className="text-[11px] sm:text-xs text-slate-500 font-mono mt-0.5">
            Persisted in SQLite database (~/.pi/token-usage.db) • Flat subscriptions vs API pricing
          </p>
        </div>

        {/* Add Subscription Button */}
        <button
          onClick={() => setIsAddModalOpen(true)}
          className="px-3.5 py-2 rounded-md bg-[#5E6AD2] hover:bg-[#4F5BBF] text-white text-xs font-bold font-mono flex items-center gap-2 shadow-sm transition-all self-start sm:self-auto"
        >
          <Plus className="w-4 h-4" /> Add Subscription
        </button>
      </div>

      {/* Portfolio Overview Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 font-mono">
        <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A] space-y-1">
          <div className="text-[10px] uppercase text-slate-500 font-semibold">Configured Monthly Subscriptions</div>
          <div className="text-2xl font-bold text-white">${totalSubMonthly.toFixed(2)} <span className="text-xs font-normal text-slate-500">/mo</span></div>
          <div className="text-[10px] text-slate-500 font-sans">{subscriptionDetails.length} active plans saved</div>
        </div>

        <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A] space-y-1">
          <div className="text-[10px] uppercase text-slate-500 font-semibold">Equivalent API Token Cost</div>
          <div className="text-2xl font-bold text-[#5E6AD2]">${totalApiMonthly.toFixed(2)} <span className="text-xs font-normal text-slate-500">/mo</span></div>
          <div className="text-[10px] text-slate-500 font-sans">Based on actual token volume history</div>
        </div>

        <div className="p-4 rounded-lg bg-[#26B574]/10 border border-[#26B574]/30 space-y-1 text-[#26B574]">
          <div className="text-[10px] uppercase font-semibold opacity-80">Portfolio Net Optimization Savings</div>
          <div className="text-2xl font-extrabold">+${totalSavingsMonthly.toFixed(2)} <span className="text-xs font-normal opacity-80">/mo</span></div>
          <div className="text-[10px] font-sans opacity-80">Saved by choosing optimal plan per provider</div>
        </div>
      </div>

      {/* Subscription Cards List */}
      <div className="space-y-4 font-mono">
        <div className="flex items-center justify-between">
          <div className="text-xs font-mono font-semibold uppercase tracking-wider text-slate-400">
            Active Subscriptions ({subscriptionDetails.length})
          </div>
          <span className="text-[10px] text-slate-500 hidden sm:inline">Stored in SQLite token-usage.db</span>
        </div>

        {loading ? (
          <div className="py-12 text-center text-slate-600 text-xs font-mono">Loading saved subscriptions…</div>
        ) : subscriptionDetails.length === 0 ? (
          <div className="p-8 sm:p-12 rounded-lg bg-[#111215] border border-[#22232A] text-center space-y-3 font-sans">
            <CreditCard className="w-8 h-8 text-slate-600 mx-auto" />
            <div className="text-sm font-semibold text-white">No subscriptions added yet</div>
            <p className="text-xs text-slate-500 max-w-sm mx-auto font-mono">
              Click the button below to add your model provider subscriptions (e.g. Anthropic $20/mo, OpenAI $20/mo).
            </p>
            <button
              onClick={() => setIsAddModalOpen(true)}
              className="px-4 py-2 rounded-md bg-[#5E6AD2] text-white text-xs font-bold font-mono inline-flex items-center gap-2"
            >
              <Plus className="w-4 h-4" /> Add Subscription
            </button>
          </div>
        ) : (
          <div className="space-y-4">
            {subscriptionDetails.map((item) => {
              const {
                sub,
                providerName,
                logo,
                turns,
                totalTokens,
                monthlySubCost,
                monthlyApiCost,
                advantage,
                netSavings,
                dailyBreakevenTurns,
                dailyBreakevenMinutes,
                actualDailyTurns,
                actualDailyMinutes,
                breakevenPct,
              } = item;

              const isSubAdvantage = advantage === 'subscription';

              return (
                <div key={sub.providerId} className="p-4 sm:p-5 rounded-lg bg-[#111215] border border-[#22232A] space-y-4">
                  {/* Top Bar: Provider logo/name + Price + Remove button */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1C1D22] pb-4">
                    <div className="flex items-center gap-3">
                      <ProviderLogo logo={logo} name={providerName} size="lg" />
                      <div>
                        <div className="font-bold text-white text-sm font-sans flex items-center gap-2">
                          {providerName}
                          <span className="text-[10px] font-mono font-bold px-2 py-0.5 rounded bg-[#5E6AD2]/10 text-[#5E6AD2] border border-[#5E6AD2]/30">
                            ${sub.cost}/{sub.cycle === 'yearly' ? 'yr' : 'mo'}
                          </span>
                        </div>
                        <div className="text-[10px] text-slate-500 mt-0.5">
                          {turns > 0 ? `${turns.toLocaleString()} turns • ${formatTokens(totalTokens)} tokens in DB` : 'No turn history in DB'}
                        </div>
                      </div>
                    </div>

                    {/* Actions */}
                    <div className="flex items-center gap-2 self-end sm:self-auto">
                      <button
                        onClick={() => handleRemoveSubscription(sub.providerId)}
                        title="Remove subscription from database"
                        className="px-3 py-1.5 rounded-md bg-[#0B0C0E] border border-[#22232A] hover:border-[#E5484D]/40 text-slate-400 hover:text-[#E5484D] text-xs font-mono flex items-center gap-1.5 transition-all"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Remove
                      </button>
                    </div>
                  </div>

                  {/* Recommendation Metric Cards */}
                  <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                    <div className="p-3 rounded bg-[#0B0C0E] border border-[#1C1D22] space-y-1">
                      <div className="text-[10px] text-slate-500">Monthly Pay-Per-Token API</div>
                      <div className="text-base font-bold text-white">${monthlyApiCost.toFixed(2)} <span className="text-[10px] font-normal text-slate-500">/mo</span></div>
                      <div className="text-[10px] text-slate-500 font-sans">Based on actual token volume</div>
                    </div>

                    <div className="p-3 rounded bg-[#0B0C0E] border border-[#1C1D22] space-y-1">
                      <div className="text-[10px] text-slate-500">Subscription Plan Cost</div>
                      <div className="text-base font-bold text-[#5E6AD2]">
                        ${monthlySubCost.toFixed(2)} <span className="text-[10px] font-normal text-slate-500">/mo</span>
                      </div>
                      <div className="text-[10px] text-slate-500 font-sans">
                        {sub.cycle === 'yearly' ? `$${sub.cost}/yr plan` : 'Flat monthly rate'}
                      </div>
                    </div>

                    <div className={`p-3 rounded border flex flex-col justify-between ${
                      isSubAdvantage ? 'bg-[#26B574]/10 border-[#26B574]/30 text-[#26B574]' : 'bg-[#5E6AD2]/10 border-[#5E6AD2]/30 text-[#5E6AD2]'
                    }`}>
                      <div className="flex items-center gap-1.5 text-xs font-bold font-sans">
                        {isSubAdvantage ? <Sparkles className="w-4 h-4" /> : <CheckCircle2 className="w-4 h-4" />}
                        <span>{isSubAdvantage ? 'Advantage: Use Subscription' : 'Advantage: Pay-Per-Token API'}</span>
                      </div>
                      <div className="text-sm font-bold mt-1">
                        Save ${netSavings.toFixed(2)} <span className="text-[10px] font-normal opacity-80">/month</span>
                      </div>
                    </div>
                  </div>

                  {/* Daily Breakeven Estimation */}
                  {monthlySubCost > 0 && (
                    <div className="p-3.5 rounded-md bg-[#0B0C0E] border border-[#1C1D22] space-y-2.5">
                      <div className="flex items-center justify-between text-xs">
                        <div className="flex items-center gap-2 font-semibold text-slate-300 font-sans">
                          <Clock className="w-3.5 h-3.5 text-[#5E6AD2]" />
                          Daily Coding Breakeven Estimate
                        </div>
                        <span className={`text-[10px] font-bold px-2 py-0.5 rounded border ${
                          breakevenPct >= 100 ? 'bg-[#26B574]/10 text-[#26B574] border-[#26B574]/30' : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
                        }`}>
                          {breakevenPct}% of Breakeven
                        </span>
                      </div>

                      <div className="text-xs text-slate-400 font-sans leading-relaxed">
                        To break even on the <span className="text-white font-bold">${monthlySubCost.toFixed(0)}/mo</span> plan, you need to use this provider for at least <span className="text-[#5E6AD2] font-bold">{dailyBreakevenTurns} turns/day</span> (~<span className="text-[#5E6AD2] font-bold">{dailyBreakevenMinutes} mins/day</span> of active coding).
                        Your current average is <span className="text-white font-bold">{actualDailyTurns} turns/day</span> (~<span className="text-white font-bold">{actualDailyMinutes} mins/day</span>).
                      </div>

                      <div className="w-full h-1.5 rounded-full bg-[#1C1D22] overflow-hidden">
                        <div
                          className={`h-full rounded-full transition-all duration-300 ${
                            breakevenPct >= 100 ? 'bg-[#26B574]' : 'bg-amber-400'
                          }`}
                          style={{ width: `${Math.min(100, Math.max(5, breakevenPct))}%` }}
                        />
                      </div>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* "+ Add Subscription" Modal */}
      {isAddModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn">
          <div className="w-full max-w-lg bg-[#0E0F12] border border-[#22232A] rounded-lg shadow-2xl overflow-hidden font-mono">
            {/* Modal Header */}
            <div className="p-4 border-b border-[#1C1D22] flex items-center justify-between bg-[#111215]">
              <h3 className="font-bold text-white text-sm flex items-center gap-2 font-sans">
                <Plus className="w-4 h-4 text-[#5E6AD2]" />
                Add New Subscription
              </h3>
              <button
                onClick={() => setIsAddModalOpen(false)}
                className="p-1 rounded-md text-slate-400 hover:text-white hover:bg-[#1C1D22] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Form */}
            <form onSubmit={handleAddSubscription} className="p-5 space-y-4">
              {/* Provider Search & Selection */}
              <div className="space-y-1.5">
                <label className="text-xs text-slate-400 font-semibold uppercase">
                  1. Select Provider (170+ Catalog Providers)
                </label>

                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    placeholder="Search provider (anthropic, openai, google, opencode, deepseek)…"
                    value={searchProviderQuery}
                    onChange={(e) => setSearchProviderQuery(e.target.value)}
                    className="w-full bg-[#0B0C0E] border border-[#22232A] rounded-md pl-9 pr-3 py-2 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#2E2F38]"
                  />
                </div>

                {/* Search Results Dropdown List */}
                <div className="max-h-40 overflow-y-auto bg-[#0B0C0E] border border-[#22232A] rounded-md divide-y divide-[#1C1D22] text-xs">
                  {filteredCatalogProviders.slice(0, 15).map((p) => {
                    const isSelected = selectedProviderId === p.providerId;
                    return (
                      <div
                        key={p.providerId}
                        onClick={() => setSelectedProviderId(p.providerId)}
                        className={`p-2.5 cursor-pointer flex items-center justify-between transition-colors ${
                          isSelected ? 'bg-[#5E6AD2]/20 text-white font-bold' : 'hover:bg-[#16171B] text-slate-300'
                        }`}
                      >
                        <div className="flex items-center gap-2.5">
                          <ProviderLogo logo={p.logo} name={p.providerName} size="sm" />
                          <span>{p.providerName}</span>
                        </div>
                        <span className="text-[10px] text-slate-500">{p.providerId}</span>
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* Selected Provider Indicator */}
              {selectedProviderId && (
                <div className="p-2.5 rounded bg-[#5E6AD2]/10 border border-[#5E6AD2]/30 flex items-center justify-between text-xs text-[#5E6AD2]">
                  <span>Selected Provider: <strong>{selectedProviderId}</strong></span>
                </div>
              )}

              {/* Cost & Cycle Inputs */}
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-semibold uppercase">
                    2. Subscription Price ($)
                  </label>
                  <div className="flex items-center gap-1.5 bg-[#0B0C0E] px-3 py-2 rounded-md border border-[#22232A]">
                    <span className="text-slate-500 text-xs">$</span>
                    <input
                      type="number"
                      min="1"
                      step="1"
                      required
                      value={costInput}
                      onChange={(e) => setCostInput(e.target.value === '' ? '' : parseFloat(e.target.value))}
                      placeholder="20"
                      className="w-full bg-transparent text-xs text-white font-bold focus:outline-none"
                    />
                  </div>
                </div>

                <div className="space-y-1.5">
                  <label className="text-xs text-slate-400 font-semibold uppercase">
                    3. Billing Cycle
                  </label>
                  <div className="grid grid-cols-2 gap-1 bg-[#0B0C0E] p-1 rounded-md border border-[#22232A] text-xs">
                    <button
                      type="button"
                      onClick={() => setCycleInput('monthly')}
                      className={`py-1.5 rounded transition-all font-bold ${
                        cycleInput === 'monthly' ? 'bg-[#1C1D22] text-white border border-[#2E2F38]' : 'text-slate-500'
                      }`}
                    >
                      Monthly
                    </button>
                    <button
                      type="button"
                      onClick={() => setCycleInput('yearly')}
                      className={`py-1.5 rounded transition-all font-bold ${
                        cycleInput === 'yearly' ? 'bg-[#1C1D22] text-white border border-[#2E2F38]' : 'text-slate-500'
                      }`}
                    >
                      Yearly
                    </button>
                  </div>
                </div>
              </div>

              {/* Modal Buttons */}
              <div className="flex items-center justify-end gap-2 pt-2 border-t border-[#1C1D22]">
                <button
                  type="button"
                  onClick={() => setIsAddModalOpen(false)}
                  className="px-4 py-2 rounded-md bg-[#111215] border border-[#22232A] text-slate-400 hover:text-white text-xs transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={!selectedProviderId || submitting}
                  className="px-4 py-2 rounded-md bg-[#5E6AD2] hover:bg-[#4F5BBF] disabled:opacity-50 text-white text-xs font-bold transition-all"
                >
                  {submitting ? 'Saving…' : 'Add Subscription to DB'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
