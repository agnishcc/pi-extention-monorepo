import React, { useState } from 'react';
import {
  LayoutDashboard,
  Cpu,
  MessageSquare,
  Building2,
  Calculator,
  CreditCard,
  Zap,
  Activity,
  Database,
  Menu,
  X,
} from 'lucide-react';

export type NavTab = 'usage' | 'models' | 'sessions' | 'providers' | 'simulator' | 'subscriptions' | 'db';

interface SidebarProps {
  activeTab: NavTab;
  setActiveTab: (tab: NavTab) => void;
  totalCost?: number;
  totalTurns?: number;
}

export const Sidebar: React.FC<SidebarProps> = ({
  activeTab,
  setActiveTab,
  totalCost = 0,
  totalTurns = 0,
}) => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const navItems: { id: NavTab; label: string; icon: React.ReactNode; shortcut?: string }[] = [
    { id: 'usage', label: 'Overview & Usage', icon: <LayoutDashboard className="w-4 h-4" />, shortcut: 'G O' },
    { id: 'models', label: 'Model Viewer', icon: <Cpu className="w-4 h-4" />, shortcut: 'G M' },
    { id: 'db', label: 'Database Viewer', icon: <Database className="w-4 h-4" />, shortcut: 'G D' },
    { id: 'simulator', label: 'Cost Simulator', icon: <Calculator className="w-4 h-4" />, shortcut: 'G C' },
    { id: 'subscriptions', label: 'Subscription ROI', icon: <CreditCard className="w-4 h-4" />, shortcut: 'G R' },
    { id: 'sessions', label: 'Sessions & Logs', icon: <MessageSquare className="w-4 h-4" />, shortcut: 'G S' },
    { id: 'providers', label: 'Providers', icon: <Building2 className="w-4 h-4" />, shortcut: 'G P' },
  ];

  const currentNav = navItems.find((n) => n.id === activeTab);

  const handleSelectTab = (tab: NavTab) => {
    setActiveTab(tab);
    setMobileMenuOpen(false);
  };

  return (
    <>
      {/* MOBILE TOP BAR (< md) */}
      <header className="md:hidden sticky top-0 z-40 bg-[#0B0C0E] border-b border-[#1C1D22] px-4 py-3 flex items-center justify-between select-none">
        <div className="flex items-center gap-2.5">
          <div className="w-6 h-6 rounded-md bg-[#5E6AD2] flex items-center justify-center text-white font-mono font-extrabold text-xs shadow-sm">
            AI
          </div>
          <div>
            <span className="font-semibold text-xs tracking-tight text-white block">
              AI Usage
            </span>
            <span className="text-[10px] text-slate-400 font-mono">
              {currentNav?.label}
            </span>
          </div>
        </div>

        <div className="flex items-center gap-3">
          <div className="flex items-center gap-1.5 text-[11px] font-mono bg-[#16171B] px-2 py-1 rounded border border-[#22232A]">
            <Zap className="w-3 h-3 text-[#F59E0B]" />
            <span className="font-bold text-[#26B574]">${totalCost.toFixed(2)}</span>
          </div>

          <button
            onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
            className="p-1.5 rounded-md bg-[#16171B] text-slate-300 hover:text-white border border-[#22232A] transition-colors"
            aria-label="Toggle navigation menu"
          >
            {mobileMenuOpen ? <X className="w-5 h-5 text-white" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </header>

      {/* MOBILE OVERLAY DRAWER */}
      {mobileMenuOpen && (
        <div className="md:hidden fixed inset-0 z-50 flex flex-col bg-[#0B0C0E]/95 backdrop-blur-md animate-fadeIn">
          {/* Header inside drawer */}
          <div className="px-4 py-3 border-b border-[#1C1D22] flex items-center justify-between bg-[#0B0C0E]">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-md bg-[#5E6AD2] flex items-center justify-center text-white font-mono font-extrabold text-xs shadow-sm">
                AI
              </div>
              <span className="font-semibold text-xs text-white">AI Usage Dashboard</span>
            </div>
            <button
              onClick={() => setMobileMenuOpen(false)}
              className="p-1.5 rounded-md text-slate-400 hover:text-white bg-[#16171B] border border-[#22232A]"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          {/* Nav Links list */}
          <nav className="p-3 space-y-1 overflow-y-auto flex-1">
            <div className="px-2.5 py-1 text-[10px] font-mono font-semibold text-slate-500 uppercase tracking-wider">
              Workspace Navigation
            </div>
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => handleSelectTab(item.id)}
                  className={`w-full flex items-center justify-between px-3 py-2.5 rounded-lg text-xs transition-all ${
                    isActive
                      ? 'bg-[#18191E] text-white font-semibold border border-[#2E2F38]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#131418] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-3">
                    <span className={isActive ? 'text-[#5E6AD2]' : 'text-slate-500'}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </div>
                  {isActive && (
                    <span className="w-1.5 h-1.5 rounded-full bg-[#5E6AD2]"></span>
                  )}
                </button>
              );
            })}
          </nav>

          {/* Footer inside mobile menu */}
          <div className="p-4 border-t border-[#1C1D22] bg-[#0E0F12] space-y-2">
            <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
              <span className="flex items-center gap-1.5 text-slate-500">
                <Zap className="w-3.5 h-3.5 text-[#F59E0B]" /> Total Spent
              </span>
              <span className="font-bold text-[#26B574] text-sm">
                ${totalCost.toFixed(2)}
              </span>
            </div>
            <div className="flex items-center justify-between text-xs text-slate-400 font-mono">
              <span className="flex items-center gap-1.5 text-slate-500">
                <Activity className="w-3.5 h-3.5 text-[#5E6AD2]" /> Total Turns
              </span>
              <span className="text-slate-300 font-medium">
                {totalTurns.toLocaleString()}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* DESKTOP SIDEBAR (>= md) */}
      <aside className="hidden md:flex w-60 bg-[#0B0C0E] flex-col justify-between h-screen sticky top-0 border-r border-[#1C1D22] select-none z-30 shrink-0">
        <div>
          {/* Brand Header */}
          <div className="px-4 py-3.5 border-b border-[#1C1D22] flex items-center justify-between">
            <div className="flex items-center gap-2.5">
              <div className="w-6 h-6 rounded-md bg-[#5E6AD2] flex items-center justify-center text-white font-mono font-extrabold text-xs shadow-sm">
                AI
              </div>
              <span className="font-semibold text-xs tracking-tight text-white">
                AI Usage
              </span>
            </div>

            <div className="flex items-center gap-1.5 text-[10px] text-slate-400 font-mono bg-[#16171B] px-2 py-0.5 rounded border border-[#22232A]">
              <span className="w-1.5 h-1.5 rounded-full bg-[#26B574]"></span>
              Bun
            </div>
          </div>

          {/* Navigation Items */}
          <nav className="p-2 space-y-0.5">
            <div className="px-2.5 py-1.5 text-[10px] font-mono font-semibold text-slate-500 uppercase tracking-wider">
              Workspace
            </div>
            {navItems.map((item) => {
              const isActive = activeTab === item.id;
              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-md text-xs transition-all duration-150 ${
                    isActive
                      ? 'bg-[#18191E] text-white font-medium border border-[#2E2F38]'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-[#131418] border border-transparent'
                  }`}
                >
                  <div className="flex items-center gap-2.5">
                    <span className={isActive ? 'text-[#5E6AD2]' : 'text-slate-500'}>
                      {item.icon}
                    </span>
                    <span>{item.label}</span>
                  </div>
                  {item.shortcut && (
                    <span className="text-[9px] font-mono text-slate-600 bg-[#16171B] px-1 py-0.2 rounded border border-[#22232A]">
                      {item.shortcut}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>
        </div>

        {/* Footer Info */}
        <div className="p-3 border-t border-[#1C1D22] bg-[#0E0F12] space-y-2">
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1 text-slate-500 font-mono">
              <Zap className="w-3 h-3 text-[#F59E0B]" /> Spent
            </span>
            <span className="font-mono font-bold text-[#26B574]">
              ${totalCost.toFixed(2)}
            </span>
          </div>
          <div className="flex items-center justify-between text-[11px] text-slate-400">
            <span className="flex items-center gap-1 text-slate-500 font-mono">
              <Activity className="w-3 h-3 text-[#5E6AD2]" /> Turns
            </span>
            <span className="font-mono text-slate-300 font-medium">
              {totalTurns.toLocaleString()}
            </span>
          </div>
        </div>
      </aside>
    </>
  );
};

