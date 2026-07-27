import React, { useEffect, useState } from 'react';
import { Sidebar, NavTab } from './components/Sidebar';
import { UsagePage } from './pages/UsagePage';
import { ModelViewerPage } from './pages/ModelViewerPage';
import { SessionsPage } from './pages/SessionsPage';
import { ProviderAnalyticsPage } from './pages/ProviderAnalyticsPage';
import { SimulatorPage } from './pages/SimulatorPage';
import { SubscriptionAdvisorPage } from './pages/SubscriptionAdvisorPage';
import { DatabaseViewerPage } from './pages/DatabaseViewerPage';
import { UsageSummary } from './types';

export const App: React.FC = () => {
  const [activeTab, setActiveTab] = useState<NavTab>('usage');
  const [summary, setSummary] = useState<UsageSummary | null>(null);

  useEffect(() => {
    fetchSummary();
  }, []);

  const fetchSummary = async () => {
    try {
      const res = await fetch('/api/summary?timeframe=all');
      if (res.ok) setSummary(await res.json());
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="flex min-h-screen bg-bg text-slate-100 font-sans">
      {/* Fixed Sidebar */}
      <Sidebar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        totalCost={summary?.totalCost}
        totalTurns={summary?.totalTurns}
      />

      {/* Main Content Viewport */}
      <main className="flex-1 p-8 max-w-7xl mx-auto overflow-x-hidden">
        {activeTab === 'usage' && <UsagePage />}
        {activeTab === 'models' && <ModelViewerPage />}
        {activeTab === 'db' && <DatabaseViewerPage />}
        {activeTab === 'simulator' && <SimulatorPage />}
        {activeTab === 'subscriptions' && <SubscriptionAdvisorPage />}
        {activeTab === 'sessions' && <SessionsPage />}
        {activeTab === 'providers' && <ProviderAnalyticsPage />}
      </main>
    </div>
  );
};

export default App;
