import React, { useState } from 'react';
import { Download, FileSpreadsheet, FileJson, X } from 'lucide-react';

interface ExportModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const ExportModal: React.FC<ExportModalProps> = ({ isOpen, onClose }) => {
  const [downloading, setDownloading] = useState(false);

  if (!isOpen) return null;

  const downloadFile = async (endpoint: string, filename: string) => {
    setDownloading(true);
    try {
      const res = await fetch(endpoint);
      if (res.ok) {
        const blob = await res.blob();
        const url = window.URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        document.body.appendChild(a);
        a.click();
        a.remove();
      }
    } catch (err) {
      console.error(err);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4 animate-fadeIn">
      <div className="w-full max-w-md bg-[#0B0C0E] border border-[#22232A] rounded-lg p-5 space-y-4 shadow-2xl">
        <div className="flex items-center justify-between border-b border-[#1C1D22] pb-3">
          <div className="flex items-center gap-2">
            <Download className="w-4 h-4 text-[#5E6AD2]" />
            <h3 className="font-bold text-sm text-white font-sans">
              Export Usage & Accounting Data
            </h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded text-slate-400 hover:text-white hover:bg-[#1C1D22] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <p className="text-xs text-slate-400">
          Download structured session receipts, model breakdowns, and timeline logs for tax or accounting purposes.
        </p>

        <div className="space-y-2 pt-1 font-mono text-xs">
          <button
            onClick={() => downloadFile('/api/export/sessions?format=csv', 'pi-sessions-usage.csv')}
            disabled={downloading}
            className="w-full flex items-center justify-between p-3 rounded bg-[#111215] border border-[#22232A] hover:border-[#2E2F38] text-slate-200 transition-all text-left"
          >
            <div className="flex items-center gap-2.5">
              <FileSpreadsheet className="w-4 h-4 text-[#26B574]" />
              <div>
                <div className="font-bold text-white text-xs">Export Sessions (CSV)</div>
                <div className="text-[10px] text-slate-500 font-sans">Session IDs, turns, token breakdown & costs</div>
              </div>
            </div>
            <Download className="w-3.5 h-3.5 text-slate-500" />
          </button>

          <button
            onClick={() => downloadFile('/api/export/models?format=csv', 'pi-models-breakdown.csv')}
            disabled={downloading}
            className="w-full flex items-center justify-between p-3 rounded bg-[#111215] border border-[#22232A] hover:border-[#2E2F38] text-slate-200 transition-all text-left"
          >
            <div className="flex items-center gap-2.5">
              <FileSpreadsheet className="w-4 h-4 text-[#5E6AD2]" />
              <div>
                <div className="font-bold text-white text-xs">Export Model Rates (CSV)</div>
                <div className="text-[10px] text-slate-500 font-sans">Per-model turns, rates & total spent</div>
              </div>
            </div>
            <Download className="w-3.5 h-3.5 text-slate-500" />
          </button>

          <button
            onClick={() => downloadFile('/api/export/analytics?format=json', 'pi-usage-analytics.json')}
            disabled={downloading}
            className="w-full flex items-center justify-between p-3 rounded bg-[#111215] border border-[#22232A] hover:border-[#2E2F38] text-slate-200 transition-all text-left"
          >
            <div className="flex items-center gap-2.5">
              <FileJson className="w-4 h-4 text-[#F59E0B]" />
              <div>
                <div className="font-bold text-white text-xs">Full Raw Dump (JSON)</div>
                <div className="text-[10px] text-slate-500 font-sans">Complete JSON report with timeline & metrics</div>
              </div>
            </div>
            <Download className="w-3.5 h-3.5 text-slate-500" />
          </button>
        </div>
      </div>
    </div>
  );
};
