import React, { useEffect, useState } from 'react';
import { SessionItem, SessionTranscript } from '../types';
import {
  MessageSquare,
  Search,
  ChevronRight,
  ChevronDown,
  X,
  Bot,
  User,
  Wrench,
  Clock,
  Brain,
  Terminal,
  Code,
} from 'lucide-react';

export const SessionsPage: React.FC = () => {
  const [sessions, setSessions] = useState<SessionItem[]>([]);
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [selectedSessionId, setSelectedSessionId] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<SessionTranscript | null>(null);
  const [loadingList, setLoadingList] = useState(true);
  const [loadingChat, setLoadingChat] = useState(false);

  // Toggle for collapsible thinking blocks per message id
  const [openThinking, setOpenThinking] = useState<Record<string, boolean>>({});

  useEffect(() => {
    fetchSessions();
  }, [page, search]);

  useEffect(() => {
    if (selectedSessionId) {
      fetchChat(selectedSessionId);
    } else {
      setTranscript(null);
    }
  }, [selectedSessionId]);

  const fetchSessions = async () => {
    try {
      const res = await fetch(`/api/sessions?page=${page}&limit=15&search=${encodeURIComponent(search)}`);
      if (res.ok) {
        const data = await res.json();
        setSessions(data.items);
        setTotalPages(data.totalPages);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingList(false);
    }
  };

  const fetchChat = async (id: string) => {
    setLoadingChat(true);
    try {
      const res = await fetch(`/api/sessions/${id}/chat`);
      if (res.ok) {
        setTranscript(await res.json());
      }
    } catch (err) {
      console.error(err);
    } finally {
      setLoadingChat(false);
    }
  };

  const toggleThinking = (msgId: string) => {
    setOpenThinking((prev) => ({ ...prev, [msgId]: !prev[msgId] }));
  };

  const formatDate = (dateStr: string) => {
    if (!dateStr) return 'N/A';
    try {
      const d = new Date(dateStr);
      return d.toLocaleDateString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return dateStr;
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-[#1C1D22] pb-4">
        <div>
          <h2 className="text-lg font-bold text-white tracking-tight flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-[#5E6AD2]" />
            Sessions & Transcript Logs
          </h2>
          <p className="text-xs text-slate-500 font-mono mt-0.5">
            JSONL transcript reader from <code className="text-slate-400">~/.pi/agent/sessions/</code>
          </p>
        </div>

        {/* Search */}
        <div className="relative w-full sm:w-72">
          <Search className="w-3.5 h-3.5 text-slate-500 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search session ID or model…"
            value={search}
            onChange={(e) => {
              setSearch(e.target.value);
              setPage(1);
            }}
            className="w-full bg-[#111215] border border-[#22232A] rounded-md pl-9 pr-3 py-1.5 text-xs text-white placeholder-slate-600 focus:outline-none focus:border-[#2E2F38] transition-all"
          />
        </div>
      </div>

      {/* Sessions List */}
      {loadingList ? (
        <div className="flex items-center justify-center h-48 text-slate-500 font-mono text-xs">
          Loading sessions…
        </div>
      ) : (
        <div className="space-y-3">
          <div className="rounded-lg bg-[#111215] border border-[#22232A] divide-y divide-[#1C1D22]">
            {sessions.map((s) => (
              <div
                key={s.sessionId}
                onClick={() => setSelectedSessionId(s.sessionId)}
                className="p-3.5 hover:bg-[#16171B] transition-colors cursor-pointer flex flex-wrap items-center justify-between gap-4 group"
              >
                <div className="space-y-1 max-w-xl">
                  <div className="flex items-center gap-2">
                    <span className="font-mono text-xs font-semibold text-white group-hover:text-[#5E6AD2] transition-colors">
                      {s.sessionId.length > 36 ? `${s.sessionId.slice(0, 36)}…` : s.sessionId}
                    </span>
                    <span className="text-[10px] bg-[#1C1D22] text-slate-400 px-1.5 py-0.2 rounded font-mono border border-[#2A2B33]">
                      {s.turnCount} turns
                    </span>
                    {s.hasTranscript === false && (
                      <span
                        className="text-[10px] bg-[#F59E0B]/10 text-[#F59E0B] px-1.5 py-0.2 rounded font-mono border border-[#F59E0B]/30"
                        title="Transcript JSONL not found in ~/.pi/agent/sessions — token usage is recorded but the chat log is unavailable."
                      >
                        no transcript
                      </span>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2.5 text-[11px] text-slate-500">
                    <span className="flex items-center gap-1 font-mono">
                      <Clock className="w-3 h-3 text-slate-600" />
                      {formatDate(s.lastTurn)}
                    </span>
                    <span>•</span>
                    <div className="flex items-center gap-1 flex-wrap">
                      {s.models.slice(0, 2).map((m) => (
                        <span key={m} className="bg-[#1C1D22] text-slate-300 text-[10px] px-1.5 py-0.2 rounded font-mono border border-[#2A2B33]">
                          {m.split('/')[1] || m}
                        </span>
                      ))}
                      {s.models.length > 2 && (
                        <span className="text-[10px] text-slate-600 font-mono">+{s.models.length - 2} more</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-center gap-4">
                  <div className="text-right font-mono">
                    <div className="text-xs font-bold text-[#26B574]">
                      ${s.totalCost.toFixed(2)}
                    </div>
                    <div className="text-[10px] text-slate-500">
                      {(s.inputTokens + s.outputTokens).toLocaleString()} tokens
                    </div>
                  </div>
                  <ChevronRight className="w-4 h-4 text-slate-600 group-hover:text-white transition-colors" />
                </div>
              </div>
            ))}
          </div>

          {/* Pagination */}
          <div className="flex items-center justify-between pt-2 text-xs font-mono">
            <span className="text-slate-500">
              Page <span className="text-white font-bold">{page}</span> of <span className="text-white font-bold">{totalPages}</span>
            </span>
            <div className="flex items-center gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                className="px-2.5 py-1 rounded bg-[#111215] border border-[#22232A] text-slate-300 disabled:opacity-30 hover:bg-[#1C1D22] transition-colors"
              >
                Prev
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                className="px-2.5 py-1 rounded bg-[#111215] border border-[#22232A] text-slate-300 disabled:opacity-30 hover:bg-[#1C1D22] transition-colors"
              >
                Next
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Transcript Drawer Modal */}
      {selectedSessionId && (
        <div className="fixed inset-0 bg-black/80 z-50 flex justify-end animate-fadeIn">
          <div className="w-full max-w-3xl bg-[#0B0C0E] border-l border-[#1C1D22] h-full flex flex-col shadow-2xl">
            {/* Modal Header */}
            <div className="p-4 border-b border-[#1C1D22] flex items-center justify-between bg-[#111215]">
              <div className="space-y-0.5 font-mono">
                <div className="flex items-center gap-2">
                  <MessageSquare className="w-4 h-4 text-[#5E6AD2]" />
                  <h3 className="font-bold text-xs text-white">
                    {selectedSessionId}
                  </h3>
                </div>
                {transcript && (
                  <p className="text-[10px] text-slate-400">
                    {transcript.messages.length} log turns • Models: {transcript.modelsUsed.join(', ')}
                  </p>
                )}
              </div>

              <button
                onClick={() => setSelectedSessionId(null)}
                className="p-1.5 rounded-md text-slate-400 hover:text-white hover:bg-[#1C1D22] transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Transcript Body */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 font-mono text-xs">
              {loadingChat ? (
                <div className="flex items-center justify-center h-48 text-slate-400 text-xs">
                  Loading transcript log entries…
                </div>
              ) : transcript ? (
                transcript.messages.map((msg) => {
                  const isUser = msg.role === 'user';
                  const isAssistant = msg.role === 'assistant';
                  const isToolResult = msg.role === 'toolResult';
                  const isThinkingOpen = openThinking[msg.id] ?? false;

                  return (
                    <div
                      key={msg.id}
                      className={`p-3.5 rounded-lg border space-y-3 shadow-sm ${
                        isUser
                          ? 'bg-[#111215] border-[#22232A]'
                          : isToolResult
                          ? 'bg-[#0E0F13] border-[#1C1D22]'
                          : 'bg-[#14151C] border-[#5E6AD2]/30'
                      }`}
                    >
                      {/* Message Role & Model Header */}
                      <div className="flex items-center justify-between border-b border-[#1C1D22] pb-2 text-[11px]">
                        <div className="flex items-center gap-2">
                          {isUser && (
                            <span className="flex items-center gap-1 font-bold text-[#38BDF8] bg-[#38BDF8]/10 px-2 py-0.5 rounded border border-[#38BDF8]/20">
                              <User className="w-3 h-3" /> USER
                            </span>
                          )}
                          {isAssistant && (
                            <span className="flex items-center gap-1 font-bold text-[#A78BFA] bg-[#A78BFA]/10 px-2 py-0.5 rounded border border-[#A78BFA]/20">
                              <Bot className="w-3 h-3" /> ASSISTANT
                            </span>
                          )}
                          {isToolResult && (
                            <span className="flex items-center gap-1 font-bold text-[#26B574] bg-[#26B574]/10 px-2 py-0.5 rounded border border-[#26B574]/20">
                              <Terminal className="w-3 h-3" /> TOOL RESULT
                            </span>
                          )}

                          {msg.model && (
                            <span className="text-[10px] bg-[#0B0C0E] text-slate-300 px-2 py-0.5 rounded border border-[#22232A]">
                              {msg.model}
                            </span>
                          )}
                        </div>

                        {msg.usage && (
                          <div className="text-[10px] text-slate-400 font-mono">
                            in:{msg.usage.input} out:{msg.usage.output} cache:{msg.usage.cacheRead}
                          </div>
                        )}
                      </div>

                      {/* Agent Reasoning Thoughts (Collapsible) */}
                      {msg.thinking && (
                        <div className="rounded-md bg-[#F59E0B]/10 border border-[#F59E0B]/30 overflow-hidden">
                          <button
                            onClick={() => toggleThinking(msg.id)}
                            className="w-full px-3 py-2 text-left flex items-center justify-between text-[11px] font-bold text-[#F59E0B] hover:bg-[#F59E0B]/15 transition-colors"
                          >
                            <span className="flex items-center gap-1.5">
                              <Brain className="w-3.5 h-3.5" /> Agent Thinking Process
                            </span>
                            {isThinkingOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                          </button>
                          {isThinkingOpen && (
                            <div className="px-3 pb-3 pt-1 text-[11px] text-amber-200/90 whitespace-pre-wrap font-mono leading-relaxed border-t border-[#F59E0B]/20">
                              {msg.thinking}
                            </div>
                          )}
                        </div>
                      )}

                      {/* Message Main Content (High Contrast Light Text) */}
                      {msg.content && (
                        <div className="text-xs text-slate-100 whitespace-pre-wrap font-sans leading-relaxed selection:bg-[#5E6AD2] selection:text-white">
                          {msg.content}
                        </div>
                      )}

                      {/* Tool Calls Execution List */}
                      {msg.tools && msg.tools.length > 0 && (
                        <div className="space-y-2 pt-2 border-t border-[#1C1D22]">
                          <div className="text-[10px] uppercase font-bold text-[#F59E0B] flex items-center gap-1.5">
                            <Wrench className="w-3.5 h-3.5" /> Tool Executions ({msg.tools.length})
                          </div>
                          {msg.tools.map((t, idx) => (
                            <div key={idx} className="p-2.5 rounded-md bg-[#08080A] border border-[#22232A] space-y-1">
                              <div className="font-bold text-[#5E6AD2] text-[11px] font-mono flex items-center gap-1.5">
                                <Code className="w-3 h-3 text-[#5E6AD2]" /> {t.name}
                              </div>
                              {t.args && (
                                <pre className="text-[10px] text-slate-300 bg-[#0E0F12] p-2 rounded border border-[#1C1D22] overflow-x-auto font-mono leading-normal">
                                  {typeof t.args === 'string' ? t.args : JSON.stringify(t.args, null, 2)}
                                </pre>
                              )}
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })
              ) : (
                <div className="text-slate-400 text-xs text-center py-12">
                  No transcript logs recorded for this session.
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
