import { ArrowUpRight, Clock3, Info } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useConsole } from '../ConsoleContext';
import { ConsoleButton } from './ConsoleButton';
import { CardHint, CardTitle, ConsoleCard } from './ConsoleCard';
import { JsonBlock } from './JsonBlock';

interface EvidencePanelProps {
  title?: string;
  className?: string;
}

export function EvidencePanel({ title = 'Evidence Panel', className }: EvidencePanelProps) {
  const navigate = useNavigate();
  const { lastRequestResponse } = useConsole();

  const openInAudit = () => {
    if (!lastRequestResponse) {
      navigate('/command/audit');
      return;
    }
    navigate(`/command/audit?focusLog=${encodeURIComponent(lastRequestResponse.id)}`);
  };

  return (
    <ConsoleCard className={className}>
      <CardTitle>{title}</CardTitle>
      <CardHint>Latest request/response from console actions.</CardHint>

      {!lastRequestResponse ? (
        <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-600">
          <div className="flex items-center gap-2">
            <Info className="h-4 w-4" />
            Run any action to populate evidence.
          </div>
        </div>
      ) : (
        <>
          <div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 p-3 text-sm text-slate-700">
            <p>
              <span className="font-semibold text-slate-900">Last request:</span>{' '}
              {lastRequestResponse.method} {lastRequestResponse.path}
            </p>
            <div className="mt-2 flex flex-wrap items-center gap-3 text-xs">
              <span className="rounded-full border border-slate-300 bg-white px-2 py-1">
                Status: {lastRequestResponse.statusCode ?? '-'}
              </span>
              <span className="inline-flex items-center gap-1 rounded-full border border-slate-300 bg-white px-2 py-1">
                <Clock3 className="h-3.5 w-3.5" />
                {lastRequestResponse.durationMs} ms
              </span>
              <span
                className={`rounded-full border px-2 py-1 ${
                  lastRequestResponse.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-rose-200 bg-rose-50 text-rose-700'
                }`}
              >
                {lastRequestResponse.ok ? 'Success' : 'Failure'}
              </span>
            </div>
          </div>

          <div className="mt-3">
            <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Response JSON</p>
            <JsonBlock value={lastRequestResponse.responseBody ?? {}} compact />
          </div>
        </>
      )}

      <div className="mt-3">
        <ConsoleButton intent="secondary" size="sm" onClick={openInAudit}>
          <ArrowUpRight className="h-3.5 w-3.5" />
          Open in Audit
        </ConsoleButton>
      </div>
    </ConsoleCard>
  );
}
