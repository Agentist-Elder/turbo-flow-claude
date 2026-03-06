import type { QuarantineEntry } from '../types';

interface Props {
  entry: QuarantineEntry | null;
  pendingTotal: number;
  pendingIndex: number;
  onApprove: (id: string) => void;
  onDiscard: (id: string) => void;
}

// Translate machine-generated labels into plain English
const ATTACK_LABELS: Record<string, { title: string; desc: string }> = {
  'identity-override':    { title: 'AI Identity Takeover',  desc: 'Tries to make the AI forget its rules and act as an unrestricted system' },
  'privilege-escalation': { title: 'Privilege Escalation',  desc: 'Attempts to gain unauthorized admin or system-level access' },
  'prompt-injection':     { title: 'Prompt Injection',      desc: 'Crafted text designed to override the AI\'s original instructions' },
  'jailbreak':            { title: 'Jailbreak Attempt',     desc: 'Uses roleplay or logic tricks to bypass the AI\'s safety restrictions' },
  'data-extraction':      { title: 'Data Extraction',       desc: 'Tries to steal API keys, system config, or internal instructions' },
  'sql-injection':        { title: 'SQL Injection',         desc: 'Database attack attempting unauthorized data access or modification' },
  'sybil':                { title: 'Sybil Flood',           desc: 'Multiple similar payloads designed to overwhelm detection by flooding' },
};

function getLabel(attackType: string | undefined) {
  if (!attackType) return { title: 'Unknown Threat', desc: 'Could not classify this payload' };
  return ATTACK_LABELS[attackType.toLowerCase()] ?? { title: attackType, desc: 'Unrecognised attack pattern — review payload manually' };
}

function confidenceRing(c: number) {
  if (c >= 0.85) return { card: 'border-red-500/50 bg-red-500/10',     text: 'text-red-400',     label: 'High Risk' };
  if (c >= 0.65) return { card: 'border-amber-500/50 bg-amber-500/10', text: 'text-amber-400',   label: 'Medium Risk' };
  return               { card: 'border-blue-500/50 bg-blue-500/10',    text: 'text-blue-400',    label: 'Low Risk' };
}

export function LiveFeed({ entry, pendingTotal, pendingIndex, onApprove, onDiscard }: Props) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="text-red-500 text-sm animate-pulse">●</span>
          <h2 className="text-xs font-semibold text-gray-200 uppercase tracking-widest">Live Threat Feed</h2>
        </div>
        {pendingTotal > 0 && (
          <span className="text-xs font-medium text-gray-500 tabular-nums">
            {pendingIndex} of {pendingTotal}
          </span>
        )}
      </div>

      {!entry ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center gap-2 py-8">
          <span className="text-4xl">🛡</span>
          <p className="text-sm font-semibold text-gray-300">No pending threats</p>
          <p className="text-xs text-gray-600 leading-relaxed max-w-[200px]">
            System nominal. Use Threat Intake to inject a demo threat.
          </p>
        </div>
      ) : (
        <div className="flex flex-col flex-1 min-h-0">
          {/* Confidence + label card */}
          {(() => {
            const ring = confidenceRing(entry.confidence ?? 0);
            const lbl = getLabel(entry.attackType);
            return (
              <div className={`rounded-lg border p-3 mb-4 ${ring.card}`}>
                <div className="flex items-start justify-between gap-2 mb-1">
                  <div className="min-w-0">
                    <p className="text-sm font-bold text-gray-100 leading-tight">{lbl.title}</p>
                    <p className="text-xs text-gray-400 mt-0.5 leading-relaxed">{lbl.desc}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className={`text-2xl font-black tabular-nums ${ring.text}`}>
                      {((entry.confidence ?? 0) * 100).toFixed(0)}%
                    </p>
                    <p className={`text-[10px] font-semibold uppercase tracking-wide ${ring.text}`}>{ring.label}</p>
                  </div>
                </div>
                <p className="text-[10px] text-gray-600 font-mono mt-1">
                  {entry.variantCount} variant{entry.variantCount !== 1 ? 's' : ''} · {entry.surgeonSource || 'stub'} · {new Date(entry.receivedAt).toLocaleTimeString()}
                </p>
              </div>
            );
          })()}

          {/* AI Surgeon findings */}
          <div className="space-y-3 flex-1 overflow-y-auto">
            <div>
              <p className="text-xs font-semibold text-gray-300 mb-1">What the AI Surgeon found</p>
              <p className="text-sm text-gray-300 leading-relaxed">{entry.coreIntent || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-300 mb-1">Recommendation</p>
              <p className="text-sm text-gray-300 leading-relaxed">{entry.recommendation || '—'}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-gray-300 mb-1">Raw payload (first 200 chars)</p>
              <pre className="text-xs text-gray-400 bg-gray-800/70 border border-gray-700/50 rounded p-2.5 font-mono break-all whitespace-pre-wrap leading-relaxed max-h-24 overflow-y-auto">
                {entry.preview || '(empty)'}
              </pre>
            </div>
          </div>

          {/* Action buttons */}
          {entry.status === 'pending' ? (
            <div className="mt-4 space-y-2 flex-shrink-0">
              <button
                onClick={() => onApprove(entry.id)}
                className="w-full py-3 text-sm font-bold bg-red-600 hover:bg-red-500 active:bg-red-700 text-white rounded-lg transition-colors"
              >
                Threat Alarm — Block this fingerprint
              </button>
              <button
                onClick={() => onDiscard(entry.id)}
                className="w-full py-3 text-sm font-bold bg-white hover:bg-gray-100 active:bg-gray-200 text-emerald-700 rounded-lg transition-colors"
              >
                False Alarm — Dismiss
              </button>
            </div>
          ) : (
            <div className="mt-4 flex-shrink-0 px-4 py-3 rounded-lg bg-gray-800/60 border border-gray-700/40 text-center">
              <span className={`text-sm font-semibold ${entry.status === 'approved' ? 'text-emerald-400' : 'text-gray-400'}`}>
                {entry.status === 'approved'
                  ? '✓ Threat Alarm confirmed — fingerprint is now blocked'
                  : '✕ Marked as False Alarm — dismissed'}
              </span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
