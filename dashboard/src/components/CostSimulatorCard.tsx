import React, { useState } from 'react';
import { UsageSummary } from '../types';
import { Calculator, ArrowRight, TrendingDown, TrendingUp } from 'lucide-react';

interface CostSimulatorCardProps {
  summary: UsageSummary | null;
}

const COMPARISON_MODELS = [
  { id: 'google/gemini-2.0-flash', name: 'Gemini 2.0 Flash', inputRate: 0.10, outputRate: 0.40 },
  { id: 'anthropic/claude-3.5-sonnet', name: 'Claude 3.5 Sonnet', inputRate: 3.00, outputRate: 15.00 },
  { id: 'openai/gpt-4o', name: 'GPT-4o', inputRate: 2.50, outputRate: 10.00 },
  { id: 'openai/gpt-4o-mini', name: 'GPT-4o Mini', inputRate: 0.15, outputRate: 0.60 },
  { id: 'deepseek/deepseek-chat', name: 'DeepSeek V3', inputRate: 0.14, outputRate: 0.28 },
];

export const CostSimulatorCard: React.FC<CostSimulatorCardProps> = ({ summary }) => {
  const [targetModelId, setTargetModelId] = useState(COMPARISON_MODELS[0].id);

  if (!summary) return null;

  const targetModel = COMPARISON_MODELS.find((m) => m.id === targetModelId) || COMPARISON_MODELS[0];

  const totalInputInM = (summary.totalInputTokens + summary.totalCacheReadTokens) / 1_000_000;
  const totalOutputInM = summary.totalOutputTokens / 1_000_000;

  const simulatedCost = Number(
    (totalInputInM * targetModel.inputRate + totalOutputInM * targetModel.outputRate).toFixed(2)
  );

  const diff = Number((simulatedCost - summary.totalCost).toFixed(2));
  const isSavings = diff < 0;
  const diffPct = summary.totalCost > 0 ? Math.abs(Math.round((diff / summary.totalCost) * 100)) : 0;

  return (
    <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A] space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[#1C1D22] pb-3">
        <div className="flex items-center gap-2">
          <Calculator className="w-4 h-4 text-[#5E6AD2]" />
          <h3 className="font-semibold text-xs text-white font-sans">
            "What If" Cost Simulator
          </h3>
        </div>
        <div className="text-[10px] text-slate-500 font-mono">
          Simulate past tokens on candidate models
        </div>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs font-mono">
        {/* Model Selector */}
        <div className="space-y-1">
          <label className="text-[10px] text-slate-500 uppercase">Target Model</label>
          <select
            value={targetModelId}
            onChange={(e) => setTargetModelId(e.target.value)}
            className="w-full bg-[#0B0C0E] border border-[#22232A] rounded px-2.5 py-1 text-xs text-white focus:outline-none focus:border-[#2E2F38]"
          >
            {COMPARISON_MODELS.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name} (${m.inputRate}/${m.outputRate})
              </option>
            ))}
          </select>
        </div>

        {/* Actual Spend */}
        <div className="space-y-1 p-2 rounded bg-[#0B0C0E] border border-[#1C1D22]">
          <div className="text-[10px] text-slate-500 uppercase">Actual Spend</div>
          <div className="font-bold text-white text-sm">${summary.totalCost.toFixed(2)}</div>
        </div>

        {/* Simulated Spend */}
        <div className="space-y-1 p-2 rounded bg-[#0B0C0E] border border-[#1C1D22]">
          <div className="text-[10px] text-slate-500 uppercase">Simulated ({targetModel.name})</div>
          <div className="font-bold text-[#5E6AD2] text-sm">${simulatedCost.toFixed(2)}</div>
        </div>
      </div>

      {/* Difference Banner */}
      <div className={`p-2.5 rounded border text-xs font-mono flex items-center justify-between ${
        isSavings ? 'bg-[#26B574]/10 border-[#26B574]/30 text-[#26B574]' : 'bg-[#E5484D]/10 border-[#E5484D]/30 text-[#E5484D]'
      }`}>
        <div className="flex items-center gap-1.5 font-sans font-medium">
          {isSavings ? <TrendingDown className="w-4 h-4" /> : <TrendingUp className="w-4 h-4" />}
          <span>
            {isSavings ? `Potential Savings with ${targetModel.name}` : `Additional Cost with ${targetModel.name}`}
          </span>
        </div>
        <div className="font-bold">
          {isSavings ? `-$${Math.abs(diff).toFixed(2)} (-${diffPct}%)` : `+$${diff.toFixed(2)} (+${diffPct}%)`}
        </div>
      </div>
    </div>
  );
};
