import React, { useEffect, useState } from 'react';
import {
  Database,
  Search,
  RefreshCw,
  Terminal,
  HardDrive,
  CheckCircle2,
  AlertCircle,
  Play,
  FileCode,
  Layers,
  ChevronLeft,
  ChevronRight,
  Sparkles,
  ArrowUpDown,
} from 'lucide-react';
import { DbStats, DbRowsResponse, SqlQueryResult } from '../types';

export const DatabaseViewerPage: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'explorer' | 'sql' | 'health'>('explorer');
  const [stats, setStats] = useState<DbStats | null>(null);

  // Table explorer state
  const [rowsData, setRowsData] = useState<DbRowsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [limit] = useState(25);
  const [search, setSearch] = useState('');
  const [callerFilter, setCallerFilter] = useState('');
  const [sortColumn, setSortColumn] = useState('id');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [loadingRows, setLoadingRows] = useState(false);

  // SQL Console state
  const [sqlQuery, setSqlQuery] = useState(
    'SELECT model, caller, COUNT(*) as turns, SUM(input_tokens) as total_input, SUM(output_tokens) as total_output FROM token_detailed GROUP BY model, caller ORDER BY total_output DESC LIMIT 10;'
  );
  const [sqlResult, setSqlResult] = useState<SqlQueryResult | null>(null);
  const [runningSql, setRunningSql] = useState(false);

  // Maintenance state
  const [actionMessage, setActionMessage] = useState<{ type: 'success' | 'error'; msg: string } | null>(null);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    fetchStats();
  }, []);

  useEffect(() => {
    if (activeTab === 'explorer') {
      fetchRows();
    }
  }, [activeTab, page, search, callerFilter, sortColumn, sortOrder]);

  const fetchStats = async () => {
    try {
      const res = await fetch('/api/db/stats');
      if (res.ok) setStats(await res.json());
    } catch (err) {
      console.error('Failed to fetch DB stats:', err);
    }
  };

  const fetchRows = async () => {
    setLoadingRows(true);
    try {
      const offset = (page - 1) * limit;
      const params = new URLSearchParams({
        limit: limit.toString(),
        offset: offset.toString(),
        search,
        caller: callerFilter,
        sortColumn,
        sortOrder,
      });
      const res = await fetch(`/api/db/rows?${params.toString()}`);
      if (res.ok) {
        setRowsData(await res.json());
      }
    } catch (err) {
      console.error('Failed to fetch rows:', err);
    } finally {
      setLoadingRows(false);
    }
  };

  const runQuery = async () => {
    if (!sqlQuery.trim()) return;
    setRunningSql(true);
    try {
      const res = await fetch('/api/db/query', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sql: sqlQuery }),
      });
      if (res.ok) {
        setSqlResult(await res.json());
      }
    } catch (err: any) {
      setSqlResult({
        columns: [],
        rows: [],
        rowCount: 0,
        executionTimeMs: 0,
        error: String(err),
      });
    } finally {
      setRunningSql(false);
    }
  };

  const performAction = async (action: 'vacuum' | 'reindex') => {
    setActionLoading(true);
    setActionMessage(null);
    try {
      const res = await fetch('/api/db/action', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setActionMessage({ type: 'success', msg: data.message });
        fetchStats();
      } else {
        setActionMessage({ type: 'error', msg: data.message || 'Action failed' });
      }
    } catch (err: any) {
      setActionMessage({ type: 'error', msg: String(err) });
    } finally {
      setActionLoading(false);
    }
  };

  const handleSort = (col: string) => {
    if (sortColumn === col) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortColumn(col);
      setSortOrder('desc');
    }
    setPage(1);
  };

  return (
    <div className="space-y-6">
      {/* Top Banner & Stats Overview */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 bg-[#141519] border border-[#23252E] rounded-xl p-4 sm:p-5 shadow-lg">
        <div className="flex items-center gap-3 sm:gap-4">
          <div className="w-10 h-10 sm:w-12 sm:h-12 rounded-xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center text-indigo-400 shrink-0">
            <Database className="w-5 h-5 sm:w-6 sm:h-6" />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-base sm:text-lg font-bold text-white tracking-tight">Postgres Database Viewer</h1>
              <span className="text-[10px] font-mono font-semibold px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                <CheckCircle2 className="w-3 h-3" /> PostgreSQL
              </span>
            </div>
            <p className="text-[11px] sm:text-xs text-slate-400 font-mono mt-0.5 truncate" title={stats?.dbPath || '~/.pi/token-usage.db'}>
              {stats?.dbPath || '~/.pi/token-usage.db'}
            </p>
          </div>
        </div>

        {/* Quick DB Stats Pills */}
        <div className="grid grid-cols-3 gap-2 w-full md:w-auto">
          <div className="bg-[#1C1D24] border border-[#282A36] px-2.5 py-1.5 rounded-lg text-center md:text-left">
            <div className="text-[9px] sm:text-[10px] font-mono text-slate-400">DB Size</div>
            <div className="text-xs sm:text-sm font-mono font-bold text-white">{stats?.fileSizeFormatted || '0 MB'}</div>
          </div>
          <div className="bg-[#1C1D24] border border-[#282A36] px-2.5 py-1.5 rounded-lg text-center md:text-left">
            <div className="text-[9px] sm:text-[10px] font-mono text-slate-400">Total Rows</div>
            <div className="text-xs sm:text-sm font-mono font-bold text-indigo-400">
              {stats?.totalRows ? stats.totalRows.toLocaleString() : '0'}
            </div>
          </div>
          <div className="bg-[#1C1D24] border border-[#282A36] px-2.5 py-1.5 rounded-lg text-center md:text-left">
            <div className="text-[9px] sm:text-[10px] font-mono text-slate-400">Integrity</div>
            <div className="text-xs sm:text-sm font-mono font-bold text-emerald-400 uppercase">
              {stats?.integrityStatus || 'OK'}
            </div>
          </div>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center border-b border-[#23252E] gap-1 sm:gap-2 overflow-x-auto scrollbar-none flex-nowrap">
        <button
          onClick={() => setActiveTab('explorer')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'explorer'
              ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Layers className="w-4 h-4" />
          Raw Table Explorer
        </button>

        <button
          onClick={() => setActiveTab('sql')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'sql'
              ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <Terminal className="w-4 h-4" />
          SQL Query Console
        </button>

        <button
          onClick={() => setActiveTab('health')}
          className={`flex items-center gap-2 px-3 sm:px-4 py-2.5 text-xs font-medium border-b-2 transition-all whitespace-nowrap ${
            activeTab === 'health'
              ? 'border-indigo-500 text-indigo-400 bg-indigo-500/5'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          <HardDrive className="w-4 h-4" />
          Health & Maintenance
        </button>
      </div>

      {/* TAB 1: RAW TABLE EXPLORER */}
      {activeTab === 'explorer' && (
        <div className="space-y-4">
          {/* Controls Bar */}
          <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-[#141519] border border-[#23252E] p-3 rounded-xl">
            <div className="flex items-center gap-2 flex-1 min-w-[240px]">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-500" />
                <input
                  type="text"
                  placeholder="Filter by Session ID, Model, or Caller..."
                  value={search}
                  onChange={(e) => {
                    setSearch(e.target.value);
                    setPage(1);
                  }}
                  className="w-full bg-[#1C1D24] border border-[#282A36] rounded-lg pl-9 pr-3 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-indigo-500"
                />
              </div>
            </div>

            <div className="flex items-center gap-2">
              <select
                value={callerFilter}
                onChange={(e) => {
                  setCallerFilter(e.target.value);
                  setPage(1);
                }}
                className="bg-[#1C1D24] border border-[#282A36] rounded-lg px-3 py-1.5 text-xs text-slate-300 focus:outline-none focus:border-indigo-500"
              >
                <option value="">All Callers</option>
                <option value="main">Main Agent</option>
                <option value="subagent">Subagents</option>
              </select>

              <button
                onClick={fetchRows}
                disabled={loadingRows}
                className="flex items-center gap-1.5 bg-[#1C1D24] border border-[#282A36] hover:bg-[#252733] text-slate-300 px-3 py-1.5 rounded-lg text-xs font-medium transition-all"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${loadingRows ? 'animate-spin' : ''}`} />
                Refresh
              </button>
            </div>
          </div>

          {/* Table */}
          <div className="bg-[#141519] border border-[#23252E] rounded-xl overflow-hidden shadow-lg">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse min-w-[800px]">
                <thead>
                  <tr className="bg-[#181920] border-b border-[#23252E] text-[11px] font-mono text-slate-400 uppercase tracking-wider">
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-white"
                      onClick={() => handleSort('id')}
                    >
                      <div className="flex items-center gap-1">
                        ID <ArrowUpDown className="w-3 h-3 opacity-50" />
                      </div>
                    </th>
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-white"
                      onClick={() => handleSort('timestamp')}
                    >
                      <div className="flex items-center gap-1">
                        Timestamp <ArrowUpDown className="w-3 h-3 opacity-50" />
                      </div>
                    </th>
                    <th className="py-3 px-4">Session ID</th>
                    <th className="py-3 px-4">Caller</th>
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-white"
                      onClick={() => handleSort('model')}
                    >
                      <div className="flex items-center gap-1">
                        Model <ArrowUpDown className="w-3 h-3 opacity-50" />
                      </div>
                    </th>
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-white text-right"
                      onClick={() => handleSort('turn_number')}
                    >
                      <div className="flex items-center justify-end gap-1">
                        Turn <ArrowUpDown className="w-3 h-3 opacity-50" />
                      </div>
                    </th>
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-white text-right"
                      onClick={() => handleSort('input_tokens')}
                    >
                      Input
                    </th>
                    <th
                      className="py-3 px-4 cursor-pointer hover:text-white text-right"
                      onClick={() => handleSort('output_tokens')}
                    >
                      Output
                    </th>
                    <th className="py-3 px-4 text-right">Cache Read</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#1F212B] text-xs font-mono">
                  {loadingRows ? (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500">
                        <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-indigo-400" />
                        Loading database rows...
                      </td>
                    </tr>
                  ) : rowsData?.rows && rowsData.rows.length > 0 ? (
                    rowsData.rows.map((row) => (
                      <tr key={row.id} className="hover:bg-[#1A1B22] transition-all">
                        <td className="py-2.5 px-4 text-slate-400 font-bold">#{row.id}</td>
                        <td className="py-2.5 px-4 text-slate-300">
                          {new Date(row.timestamp).toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 text-slate-400 font-mono text-[11px] truncate max-w-[160px]" title={row.session_id}>
                          {row.session_id}
                        </td>
                        <td className="py-2.5 px-4">
                          <span
                            className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                              row.caller === 'main'
                                ? 'bg-indigo-500/10 text-indigo-400 border border-indigo-500/20'
                                : 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                            }`}
                          >
                            {row.caller}
                          </span>
                        </td>
                        <td className="py-2.5 px-4 text-indigo-300 font-semibold">{row.model}</td>
                        <td className="py-2.5 px-4 text-right text-slate-300">{row.turn_number}</td>
                        <td className="py-2.5 px-4 text-right text-slate-400">
                          {row.input_tokens.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 text-right text-emerald-400 font-bold">
                          {row.output_tokens.toLocaleString()}
                        </td>
                        <td className="py-2.5 px-4 text-right text-cyan-400">
                          {(row.cache_read_tokens || 0).toLocaleString()}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={9} className="py-8 text-center text-slate-500">
                        No rows found matching search criteria.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            {/* Pagination Controls */}
            {rowsData && (
              <div className="flex items-center justify-between px-4 py-3 bg-[#181920] border-t border-[#23252E] text-xs text-slate-400">
                <div>
                  Showing {rowsData.offset + 1} -{' '}
                  {Math.min(rowsData.offset + rowsData.limit, rowsData.total)} of{' '}
                  <span className="text-white font-bold">{rowsData.total.toLocaleString()}</span> rows
                </div>

                <div className="flex items-center gap-2">
                  <button
                    disabled={page <= 1}
                    onClick={() => setPage(page - 1)}
                    className="p-1.5 rounded bg-[#23252E] hover:bg-[#2D2F3A] disabled:opacity-30 transition-all"
                  >
                    <ChevronLeft className="w-4 h-4 text-slate-300" />
                  </button>
                  <span className="font-mono text-slate-300">
                    Page {rowsData.page} of {rowsData.totalPages}
                  </span>
                  <button
                    disabled={page >= rowsData.totalPages}
                    onClick={() => setPage(page + 1)}
                    className="p-1.5 rounded bg-[#23252E] hover:bg-[#2D2F3A] disabled:opacity-30 transition-all"
                  >
                    <ChevronRight className="w-4 h-4 text-slate-300" />
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: SQL QUERY CONSOLE */}
      {activeTab === 'sql' && (
        <div className="space-y-4">
          <div className="bg-[#141519] border border-[#23252E] rounded-xl p-4 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-xs font-mono font-bold text-slate-300 flex items-center gap-2">
                <FileCode className="w-4 h-4 text-indigo-400" /> Read-Only SQL Query Console
              </label>
              <span className="text-[10px] font-mono text-slate-500">Only SELECT / EXPLAIN / SHOW queries allowed</span>
            </div>

            {/* Pre-made Query Templates */}
            <div className="flex flex-wrap gap-2 text-xs">
              <span className="text-[11px] font-mono text-slate-500 self-center">Templates:</span>
              <button
                onClick={() =>
                  setSqlQuery(
                    'SELECT model, caller, COUNT(*) as turns, SUM(input_tokens) as input, SUM(output_tokens) as output FROM token_detailed GROUP BY model, caller ORDER BY output DESC;'
                  )
                }
                className="px-2.5 py-1 rounded bg-[#1E202A] border border-[#2A2C3A] text-slate-300 hover:text-white hover:border-indigo-500 transition-all font-mono text-[11px]"
              >
                Model Breakdown
              </button>

              <button
                onClick={() =>
                  setSqlQuery(
                    'SELECT session_id, caller, COUNT(*) as turn_count, SUM(input_tokens + output_tokens) as total_tokens FROM token_detailed GROUP BY session_id ORDER BY total_tokens DESC LIMIT 15;'
                  )
                }
                className="px-2.5 py-1 rounded bg-[#1E202A] border border-[#2A2C3A] text-slate-300 hover:text-white hover:border-indigo-500 transition-all font-mono text-[11px]"
              >
                Top Sessions
              </button>

              <button
                onClick={() =>
                  setSqlQuery(
                    "SELECT date_trunc('hour', timestamp::timestamptz) as hour, SUM(output_tokens) as hourly_output FROM token_detailed GROUP BY hour ORDER BY hour DESC LIMIT 24;"
                  )
                }
                className="px-2.5 py-1 rounded bg-[#1E202A] border border-[#2A2C3A] text-slate-300 hover:text-white hover:border-indigo-500 transition-all font-mono text-[11px]"
              >
                Hourly Output
              </button>

              <button
                onClick={() => setSqlQuery("SELECT column_name, data_type, is_nullable FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'token_detailed' ORDER BY ordinal_position;")}
                className="px-2.5 py-1 rounded bg-[#1E202A] border border-[#2A2C3A] text-slate-300 hover:text-white hover:border-indigo-500 transition-all font-mono text-[11px]"
              >
                Schema Info
              </button>
            </div>

            {/* SQL Text Area */}
            <textarea
              rows={4}
              value={sqlQuery}
              onChange={(e) => setSqlQuery(e.target.value)}
              className="w-full bg-[#0E0F12] border border-[#282A36] rounded-lg p-3 text-xs font-mono text-emerald-400 focus:outline-none focus:border-indigo-500 leading-relaxed"
            />

            <div className="flex justify-end">
              <button
                onClick={runQuery}
                disabled={runningSql}
                className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-500 text-white font-medium px-4 py-2 rounded-lg text-xs transition-all shadow-md"
              >
                <Play className="w-3.5 h-3.5 fill-current" />
                {runningSql ? 'Executing...' : 'Run Query'}
              </button>
            </div>
          </div>

          {/* SQL Results */}
          {sqlResult && (
            <div className="bg-[#141519] border border-[#23252E] rounded-xl overflow-hidden p-4 space-y-3">
              <div className="flex items-center justify-between">
                <div className="text-xs font-bold text-slate-200 flex items-center gap-2 font-mono">
                  Results ({sqlResult.rowCount} rows)
                </div>
                {sqlResult.executionTimeMs > 0 && (
                  <span className="text-[10px] font-mono text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                    Executed in {sqlResult.executionTimeMs} ms
                  </span>
                )}
              </div>

              {sqlResult.error ? (
                <div className="p-3 bg-red-500/10 border border-red-500/20 text-red-400 text-xs rounded-lg font-mono flex items-center gap-2">
                  <AlertCircle className="w-4 h-4 shrink-0" />
                  {sqlResult.error}
                </div>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full text-left border-collapse">
                    <thead>
                      <tr className="bg-[#181920] border-b border-[#23252E] text-[11px] font-mono text-slate-400 uppercase">
                        {sqlResult.columns.map((col) => (
                          <th key={col} className="py-2.5 px-3">
                            {col}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-[#1F212B] text-xs font-mono">
                      {sqlResult.rows.map((row, idx) => (
                        <tr key={idx} className="hover:bg-[#1A1B22]">
                          {sqlResult.columns.map((col) => (
                            <td key={col} className="py-2 px-3 text-slate-300">
                              {row[col] !== null && row[col] !== undefined ? String(row[col]) : 'NULL'}
                            </td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* TAB 3: HEALTH & MAINTENANCE */}
      {activeTab === 'health' && (
        <div className="space-y-6">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Storage Card */}
            <div className="bg-[#141519] border border-[#23252E] rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 text-slate-200 font-bold text-sm">
                <HardDrive className="w-4 h-4 text-indigo-400" />
                Postgres Storage Metrics
              </div>

              <div className="space-y-2 text-xs font-mono">
                <div className="flex justify-between py-1.5 border-b border-[#1E202A]">
                  <span className="text-slate-400">Database URL:</span>
                  <span className="text-slate-200 truncate max-w-[200px]" title={stats?.dbPath}>
                    {stats?.dbPath}
                  </span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#1E202A]">
                  <span className="text-slate-400">Database Size:</span>
                  <span className="text-emerald-400 font-bold">{stats?.fileSizeFormatted}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#1E202A]">
                  <span className="text-slate-400">Backend:</span>
                  <span className="text-indigo-400 uppercase font-bold">{stats?.journalMode}</span>
                </div>
                <div className="flex justify-between py-1.5 border-b border-[#1E202A]">
                  <span className="text-slate-400">Total Tables:</span>
                  <span className="text-slate-200">{stats?.tableCount}</span>
                </div>
                <div className="flex justify-between py-1.5">
                  <span className="text-slate-400">Index Count:</span>
                  <span className="text-slate-200">{stats?.indexCount}</span>
                </div>
              </div>
            </div>

            {/* Maintenance Actions Card */}
            <div className="bg-[#141519] border border-[#23252E] rounded-xl p-5 space-y-4">
              <div className="flex items-center gap-2 text-slate-200 font-bold text-sm">
                <Sparkles className="w-4 h-4 text-amber-400" />
                Database Maintenance Tools
              </div>

              <p className="text-xs text-slate-400 leading-relaxed">
                Run lightweight Postgres maintenance against the active token usage tables to refresh statistics and rebuild index trees.
              </p>

              <div className="flex flex-col sm:flex-row gap-3 pt-2">
                <button
                  onClick={() => performAction('vacuum')}
                  disabled={actionLoading}
                  className="flex-1 bg-[#1E202A] hover:bg-[#282B38] border border-[#2F3244] text-white text-xs font-semibold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all"
                >
                  <RefreshCw className={`w-3.5 h-3.5 text-emerald-400 ${actionLoading ? 'animate-spin' : ''}`} />
                  VACUUM
                </button>

                <button
                  onClick={() => performAction('reindex')}
                  disabled={actionLoading}
                  className="flex-1 bg-[#1E202A] hover:bg-[#282B38] border border-[#2F3244] text-white text-xs font-semibold py-2.5 px-4 rounded-lg flex items-center justify-center gap-2 transition-all"
                >
                  <Layers className="w-3.5 h-3.5 text-indigo-400" />
                  REINDEX
                </button>
              </div>

              {actionMessage && (
                <div
                  className={`p-3 rounded-lg text-xs font-mono flex items-center gap-2 ${
                    actionMessage.type === 'success'
                      ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                      : 'bg-red-500/10 text-red-400 border border-red-500/20'
                  }`}
                >
                  {actionMessage.type === 'success' ? (
                    <CheckCircle2 className="w-4 h-4 shrink-0" />
                  ) : (
                    <AlertCircle className="w-4 h-4 shrink-0" />
                  )}
                  {actionMessage.msg}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
