import React, { useEffect, useState } from 'react';
import { Timeframe, UsageSummary, TimelineDataPoint } from '../types';
import { StatCard } from '../components/StatCard';
import { TopModelsCard } from '../components/TopModelsCard';
import { UsageCharts } from '../components/UsageCharts';
import { ExportModal } from '../components/ExportModal';
import {
  DollarSign,
  Zap,
  Activity,
  Bot,
  User,
  Coins,
  Clock,
  Download,
} from 'lucide-react';

export const UsagePage: React.FC = () => {
  const [timeframe, setTimeframe] = useState<Timeframe>('all');
  const [summary, setSummary] = useState<UsageSummary | null>(null);
  const [timeline, setTimeline] = useState<TimelineDataPoint[]>([]);
  const [unit, setUnit] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [loading, setLoading] = useState(true);

  // Automatically align timeline chart granularity with global timeframe
  useEffect(() => {
    if (timeframe === 'daily') setUnit('daily');
    else if (timeframe === 'weekly') setUnit('daily');
    else if (timeframe === 'monthly') setUnit('daily');
    else if (timeframe === 'all') setUnit('monthly');
  }, [timeframe]);

  useEffect(() => {
    fetchSummary();
  }, [timeframe]);

  useEffect(() => {
    fetchTimeline();
  }, [unit]);

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

  const fetchTimeline = async () => {
    try {
      const res = await fetch(`/api/timeline?unit=${unit}`);
      if (res.ok) setTimeline(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  const formatNum = (num: number = 0) => {
    if (num >= 1_000_000) return `${(num / 1_000_000).toFixed(2)}M`;
    if (num >= 1_000) return `${(num / 1_000).toFixed(1)}k`;
    return num.toString();
  };

  const timeframeLabels: Record<Timeframe, string> = {
    all: 'All Time',
    monthly: 'Past 30 Days',
    weekly: 'Past 7 Days',
    daily: 'Past 24 Hours',
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-500 font-mono text-xs">
        Loading analytics…
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Top Header & Single Global Interval Picker */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-[#1C1D22] pb-4">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base sm:text-lg font-bold text-white tracking-tight">
              Usage & Analytics Overview
            </h2>
            <span className="text-[10px] font-mono font-medium text-[#5E6AD2] bg-[#5E6AD2]/10 px-2 py-0.5 rounded border border-[#5E6AD2]/20">
              {timeframeLabels[timeframe]}
            </span>
          </div>
          <p className="text-[11px] sm:text-xs text-slate-500 font-mono mt-0.5">
            Pi Agent execution logs, token distribution, & model cost breakdown
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Export Modal Trigger */}
          <button
            onClick={() => setIsExportOpen(true)}
            className="px-2.5 py-1.5 rounded-md bg-[#111215] border border-[#22232A] hover:border-[#2E2F38] text-slate-300 hover:text-white text-xs font-mono flex items-center gap-1.5 transition-all"
          >
            <Download className="w-3.5 h-3.5 text-[#5E6AD2]" /> Export
          </button>

          {/* SINGLE Global Page Timeframe Selector */}
          <div className="bg-[#111215] p-0.5 rounded-md border border-[#22232A] flex items-center gap-0.5 sm:gap-1 text-[10px] sm:text-[11px] font-mono overflow-x-auto">
            <div className="px-1.5 sm:px-2 py-1 text-slate-500 text-[10px] flex items-center gap-1 border-r border-[#1C1D22] shrink-0">
              <Clock className="w-3 h-3 text-[#5E6AD2]" /> Period:
            </div>
            {(['all', 'monthly', 'weekly', 'daily'] as const).map((t) => (
              <button
                key={t}
                onClick={() => setTimeframe(t)}
                className={`px-2 sm:px-3 py-1 rounded font-medium transition-all shrink-0 ${
                  timeframe === t
                    ? 'bg-[#1C1D22] text-white border border-[#2E2F38] shadow-sm'
                    : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {t === 'all' ? 'All Time' : t === 'monthly' ? '30D' : t === 'weekly' ? '7D' : '24H'}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <StatCard
          label={`Total Spend (${timeframeLabels[timeframe]})`}
          value={`$${summary?.totalCost.toFixed(2) || '0.00'}`}
          subValue="models.dev catalog rates"
          icon={<DollarSign className="w-4 h-4" />}
          color="emerald"
        />
        <StatCard
          label={`Input Tokens (${timeframeLabels[timeframe]})`}
          value={formatNum(summary?.totalInputTokens)}
          subValue={`${formatNum(summary?.totalOutputTokens)} output tokens`}
          icon={<Zap className="w-4 h-4" />}
          color="sky"
        />
        <StatCard
          label={`Cache Savings (${timeframeLabels[timeframe]})`}
          value={`$${summary?.totalCacheSavings.toFixed(2) || '0.00'}`}
          subValue={`${formatNum(summary?.totalCacheReadTokens)} cache read`}
          icon={<Coins className="w-4 h-4" />}
          color="amber"
        />
        <StatCard
          label={`Turns & Sessions (${timeframeLabels[timeframe]})`}
          value={summary?.totalTurns.toLocaleString() || '0'}
          subValue={`${summary?.totalSessions} active sessions`}
          icon={<Activity className="w-4 h-4" />}
          color="indigo"
        />
      </div>

      {/* Top 5 Models Cards (Controlled by single global timeframe) */}
      <TopModelsCard timeframe={timeframe} />

      {/* Timeline Charts */}
      <UsageCharts timeline={timeline} unit={unit} setUnit={setUnit} />

      {/* Caller Execution Split & Caching Efficiency */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Subagent vs Main Agent */}
        <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A] space-y-3">
          <div className="flex items-center justify-between border-b border-[#1C1D22] pb-2.5">
            <div className="flex items-center gap-2">
              <Bot className="w-4 h-4 text-[#5E6AD2]" />
              <h3 className="font-semibold text-xs text-white">Caller Execution Split</h3>
            </div>
            <span className="text-[10px] font-mono text-slate-500 uppercase">{timeframe}</span>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-1">
            <div className="p-3 rounded-md bg-[#0B0C0E] border border-[#1C1D22] space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <User className="w-3.5 h-3.5 text-slate-500" /> Main Agent
              </div>
              <div className="font-mono text-base font-bold text-white">
                {summary?.callerBreakdown.main.turns.toLocaleString()} turns
              </div>
              <div className="text-[11px] font-mono text-[#26B574]">
                ${summary?.callerBreakdown.main.cost.toFixed(2)}
              </div>
            </div>

            <div className="p-3 rounded-md bg-[#0B0C0E] border border-[#1C1D22] space-y-1">
              <div className="flex items-center gap-1.5 text-[11px] text-slate-400">
                <Bot className="w-3.5 h-3.5 text-[#5E6AD2]" /> Subagents
              </div>
              <div className="font-mono text-base font-bold text-white">
                {summary?.callerBreakdown.subagent.turns.toLocaleString()} turns
              </div>
              <div className="text-[11px] font-mono text-[#26B574]">
                ${summary?.callerBreakdown.subagent.cost.toFixed(2)}
              </div>
            </div>
          </div>
        </div>

        {/* Caching Efficiency */}
        <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A] space-y-3">
          <div className="flex items-center justify-between border-b border-[#1C1D22] pb-2.5">
            <div className="flex items-center gap-2">
              <Zap className="w-4 h-4 text-[#F59E0B]" />
              <h3 className="font-semibold text-xs text-white">Cache Efficiency</h3>
            </div>
            <span className="text-[10px] font-mono text-slate-500 uppercase">{timeframe}</span>
          </div>

          <div className="space-y-2 pt-1 font-mono text-xs">
            <div className="flex items-center justify-between text-slate-400">
              <span>Cache Read Tokens:</span>
              <span className="text-[#F59E0B] font-bold">{formatNum(summary?.totalCacheReadTokens)}</span>
            </div>
            <div className="flex items-center justify-between text-slate-400">
              <span>Cache Write Tokens:</span>
              <span className="text-[#5E6AD2] font-bold">{formatNum(summary?.totalCacheWriteTokens)}</span>
            </div>
            <div className="flex items-center justify-between border-t border-[#1C1D22] pt-2 text-slate-200">
              <span className="font-sans font-medium">Prompt Cache Savings:</span>
              <span className="text-[#26B574] font-extrabold text-sm">${summary?.totalCacheSavings.toFixed(2)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Export Modal */}
      <ExportModal isOpen={isExportOpen} onClose={() => setIsExportOpen(false)} />
    </div>
  );
};
