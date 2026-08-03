import React, { useState } from 'react';
import { TimelineDataPoint } from '../types';
import {
  ResponsiveContainer,
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from 'recharts';
import { TrendingUp, BarChart2 } from 'lucide-react';

interface UsageChartsProps {
  timeline: TimelineDataPoint[];
  unit: 'daily' | 'weekly' | 'monthly';
  setUnit: (u: 'daily' | 'weekly' | 'monthly') => void;
}

export const UsageCharts: React.FC<UsageChartsProps> = ({ timeline, unit, setUnit }) => {
  const [metric, setMetric] = useState<'cost' | 'tokens'>('cost');
  const [chartType, setChartType] = useState<'area' | 'bar'>('area');

  const formatTokens = (val: number) => {
    if (val >= 1_000_000) return `${(val / 1_000_000).toFixed(1)}M`;
    if (val >= 1_000) return `${(val / 1_000).toFixed(0)}k`;
    return val.toString();
  };

  const CustomTooltip = ({ active, payload }: any) => {
    if (active && payload && payload.length) {
      const data = payload[0].payload as TimelineDataPoint;
      return (
        <div className="bg-[#16171B] p-3 rounded-md border border-[#2A2B33] shadow-xl text-[11px] space-y-1 font-mono">
          <div className="font-semibold text-white border-b border-[#26272F] pb-1 flex justify-between gap-4">
            <span>{data.date}</span>
            <span className="text-slate-500">{data.turns} turns</span>
          </div>
          <div className="flex justify-between gap-4 text-[#26B574] font-bold">
            <span>Cost:</span>
            <span>${data.cost.toFixed(4)}</span>
          </div>
          <div className="flex justify-between gap-4 text-slate-300">
            <span>Input Tokens:</span>
            <span>{data.input.toLocaleString()}</span>
          </div>
          <div className="flex justify-between gap-4 text-slate-400">
            <span>Output Tokens:</span>
            <span>{data.output.toLocaleString()}</span>
          </div>
        </div>
      );
    }
    return null;
  };

  return (
    <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A] space-y-4">
      {/* Header controls */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#5E6AD2]" />
          <h3 className="font-semibold text-xs text-white">Usage & Financial Activity</h3>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {/* Metric Selector */}
          <div className="bg-[#0B0C0E] p-0.5 rounded-md border border-[#22232A] flex items-center gap-1 text-[10px] sm:text-[11px]">
            <button
              onClick={() => setMetric('cost')}
              className={`px-2.5 py-1 rounded font-medium transition-all ${
                metric === 'cost' ? 'bg-[#1C1D22] text-[#26B574] border border-[#2E2F38]' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Cost ($)
            </button>
            <button
              onClick={() => setMetric('tokens')}
              className={`px-2.5 py-1 rounded font-medium transition-all ${
                metric === 'tokens' ? 'bg-[#1C1D22] text-[#5E6AD2] border border-[#2E2F38]' : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              Token Volume
            </button>
          </div>

          {/* Granularity Selector */}
          <div className="bg-[#0B0C0E] p-0.5 rounded-md border border-[#22232A] flex items-center gap-0.5 text-[10px] sm:text-[11px]">
            {(['daily', 'weekly', 'monthly'] as const).map((u) => (
              <button
                key={u}
                onClick={() => setUnit(u)}
                className={`px-2 py-1 rounded font-medium capitalize transition-all ${
                  unit === u ? 'bg-[#1C1D22] text-white border border-[#2E2F38]' : 'text-slate-500 hover:text-slate-300'
                }`}
              >
                {u}
              </button>
            ))}
          </div>

          {/* Chart Type */}
          <div className="bg-[#0B0C0E] p-0.5 rounded-md border border-[#22232A] flex items-center text-[11px]">
            <button
              onClick={() => setChartType('area')}
              className={`p-1 rounded transition-all ${
                chartType === 'area' ? 'bg-[#1C1D22] text-white' : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              <TrendingUp className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setChartType('bar')}
              className={`p-1 rounded transition-all ${
                chartType === 'bar' ? 'bg-[#1C1D22] text-white' : 'text-slate-600 hover:text-slate-400'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Chart Canvas */}
      <div className="h-56 sm:h-64 w-full pt-2">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === 'area' ? (
            <AreaChart data={timeline} margin={{ top: 10, right: 5, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="costGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#26B574" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#26B574" stopOpacity={0.0} />
                </linearGradient>
                <linearGradient id="inputGrad" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="#5E6AD2" stopOpacity={0.25} />
                  <stop offset="95%" stopColor="#5E6AD2" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C1D22" vertical={false} />
              <XAxis dataKey="date" stroke="#474852" fontSize={10} tickLine={false} />
              <YAxis
                stroke="#474852"
                fontSize={10}
                tickLine={false}
                tickFormatter={metric === 'cost' ? (v) => `$${v}` : formatTokens}
              />
              <Tooltip content={<CustomTooltip />} />
              {metric === 'cost' ? (
                <Area type="monotone" dataKey="cost" stroke="#26B574" strokeWidth={2} fill="url(#costGrad)" />
              ) : (
                <>
                  <Area type="monotone" dataKey="input" stackId="1" stroke="#5E6AD2" strokeWidth={1.5} fill="url(#inputGrad)" />
                  <Area type="monotone" dataKey="output" stackId="1" stroke="#A855F7" strokeWidth={1.5} fill="#A855F7" fillOpacity={0.1} />
                </>
              )}
            </AreaChart>
          ) : (
            <BarChart data={timeline} margin={{ top: 10, right: 10, left: -25, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#1C1D22" vertical={false} />
              <XAxis dataKey="date" stroke="#474852" fontSize={10} tickLine={false} />
              <YAxis
                stroke="#474852"
                fontSize={10}
                tickLine={false}
                tickFormatter={metric === 'cost' ? (v) => `$${v}` : formatTokens}
              />
              <Tooltip content={<CustomTooltip />} />
              {metric === 'cost' ? (
                <Bar dataKey="cost" fill="#26B574" radius={[2, 2, 0, 0]} />
              ) : (
                <>
                  <Bar dataKey="input" stackId="a" fill="#5E6AD2" radius={[0, 0, 0, 0]} />
                  <Bar dataKey="output" stackId="a" fill="#A855F7" radius={[2, 2, 0, 0]} />
                </>
              )}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
};
