import React, { useState, useEffect } from 'react';
import { Target, AlertTriangle, CheckCircle, TrendingUp, Edit2 } from 'lucide-react';

interface BudgetGaugeProps {
  currentSpend: number;
  dailyAvgSpend?: number;
}

export const BudgetGauge: React.FC<BudgetGaugeProps> = ({ currentSpend, dailyAvgSpend = 0 }) => {
  const [budgetCap, setBudgetCap] = useState<number>(() => {
    const saved = localStorage.getItem('ai_usage_monthly_budget');
    return saved ? parseFloat(saved) : 100; // default $100
  });

  const [isEditing, setIsEditing] = useState(false);
  const [tempBudget, setTempBudget] = useState(budgetCap.toString());

  const handleSave = () => {
    const val = parseFloat(tempBudget);
    if (!isNaN(val) && val > 0) {
      setBudgetCap(val);
      localStorage.setItem('ai_usage_monthly_budget', val.toString());
    }
    setIsEditing(false);
  };

  const pct = Math.min(100, Math.round((currentSpend / budgetCap) * 100));

  // Calculate forecast: current spend + (remaining days in month * daily avg)
  const now = new Date();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const currentDay = now.getDate();
  const remainingDays = daysInMonth - currentDay;
  const forecastedSpend = Number((currentSpend + remainingDays * dailyAvgSpend).toFixed(2));

  let statusColor = 'text-[#26B574] bg-[#26B574]/10 border-[#26B574]/30';
  let progressColor = 'bg-[#26B574]';
  let statusText = 'On Track';

  if (pct >= 100) {
    statusColor = 'text-[#E5484D] bg-[#E5484D]/10 border-[#E5484D]/30';
    progressColor = 'bg-[#E5484D]';
    statusText = 'Budget Exceeded';
  } else if (pct >= 75) {
    statusColor = 'text-[#F59E0B] bg-[#F59E0B]/10 border-[#F59E0B]/30';
    progressColor = 'bg-[#F59E0B]';
    statusText = 'Warning (>75%)';
  }

  return (
    <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A] space-y-3">
      <div className="flex items-center justify-between border-b border-[#1C1D22] pb-2.5">
        <div className="flex items-center gap-2">
          <Target className="w-4 h-4 text-[#5E6AD2]" />
          <h3 className="font-semibold text-xs text-white font-sans">
            Monthly Budget & Forecast
          </h3>
        </div>

        <div className={`px-2 py-0.5 rounded text-[10px] font-mono border flex items-center gap-1 ${statusColor}`}>
          {pct >= 75 ? <AlertTriangle className="w-3 h-3" /> : <CheckCircle className="w-3 h-3" />}
          <span>{statusText}</span>
        </div>
      </div>

      <div className="space-y-2 font-mono text-xs">
        <div className="flex items-center justify-between text-slate-400">
          <div className="flex items-center gap-1.5">
            <span>Budget Cap:</span>
            {isEditing ? (
              <div className="flex items-center gap-1">
                <input
                  type="number"
                  value={tempBudget}
                  onChange={(e) => setTempBudget(e.target.value)}
                  className="w-16 bg-[#0B0C0E] border border-[#2E2F38] rounded px-1.5 py-0.5 text-xs text-white"
                />
                <button
                  onClick={handleSave}
                  className="px-2 py-0.5 rounded bg-[#5E6AD2] text-white text-[10px] font-sans"
                >
                  Save
                </button>
              </div>
            ) : (
              <button
                onClick={() => setIsEditing(true)}
                className="flex items-center gap-1 text-slate-300 hover:text-white underline font-bold"
              >
                ${budgetCap} <Edit2 className="w-3 h-3 text-slate-500" />
              </button>
            )}
          </div>
          <div className="text-white font-bold">${currentSpend.toFixed(2)} / ${budgetCap}</div>
        </div>

        {/* Minimal Progress Bar */}
        <div className="w-full h-2 rounded-full bg-[#1C1D22] overflow-hidden">
          <div
            className={`h-full rounded-full transition-all duration-500 ${progressColor}`}
            style={{ width: `${pct}%` }}
          />
        </div>

        {/* Velocity Forecast */}
        <div className="grid grid-cols-2 gap-2 pt-2 border-t border-[#1C1D22] text-[11px]">
          <div>
            <div className="text-[10px] text-slate-500 font-sans">Avg Daily Burn</div>
            <div className="font-bold text-slate-300">${dailyAvgSpend.toFixed(2)}/day</div>
          </div>
          <div>
            <div className="text-[10px] text-slate-500 font-sans">Month End Forecast</div>
            <div className="font-bold text-[#5E6AD2]">${forecastedSpend.toFixed(2)}</div>
          </div>
        </div>
      </div>
    </div>
  );
};
