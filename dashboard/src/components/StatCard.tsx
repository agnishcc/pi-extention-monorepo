import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  subValue?: string;
  icon: React.ReactNode;
  trend?: string;
  color?: 'emerald' | 'sky' | 'indigo' | 'amber';
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  subValue,
  icon,
  trend,
  color = 'sky',
}) => {
  return (
    <div className="p-4 rounded-lg bg-[#111215] border border-[#22232A] hover:border-[#2E2F38] transition-all duration-150">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-mono font-medium uppercase tracking-wider text-slate-500">
          {label}
        </span>
        <div className="text-slate-500">
          {icon}
        </div>
      </div>

      <div className="mt-2.5 flex items-baseline justify-between">
        <div className="font-mono text-xl font-bold text-white tracking-tight">
          {value}
        </div>
        {trend && (
          <span className="text-[10px] font-mono font-medium text-[#26B574] bg-[#26B574]/10 px-1.5 py-0.5 rounded border border-[#26B574]/20">
            {trend}
          </span>
        )}
      </div>

      {subValue && (
        <p className="mt-1 text-[11px] text-slate-500 font-sans">
          {subValue}
        </p>
      )}
    </div>
  );
};
