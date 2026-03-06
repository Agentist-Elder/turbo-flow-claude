import type { QuarantineEntry, FilterKey } from '../types';

interface Props {
  entries: QuarantineEntry[];
  filter: FilterKey;
  onFilterChange: (f: FilterKey) => void;
  selected: QuarantineEntry | null;
  onSelect: (e: QuarantineEntry) => void;
  allCount: number;
  pendingCount: number;
  approvedCount: number;
  discardedCount: number;
}

const ATTACK_SHORT: Record<string, string> = {
  'identity-override':    'AI Identity Takeover',
  'privilege-escalation': 'Privilege Escalation',
  'prompt-injection':     'Prompt Injection',
  'jailbreak':            'Jailbreak Attempt',
  'data-extraction':      'Data Extraction',
  'sql-injection':        'SQL Injection',
  'sybil':                'Sybil Flood',
};

function humanType(t: string | undefined) {
  if (!t) return 'Unknown';
  return ATTACK_SHORT[t.toLowerCase()] ?? t;
}

function statusBadge(status: string): string {
  if (status === 'pending')   return 'bg-amber-500/20 text-amber-300 border border-amber-500/30';
  if (status === 'approved')  return 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/30';
  return 'bg-gray-700/40 text-gray-500 border border-gray-700/50';
}

function confidenceColor(c: number): string {
  if (c >= 0.85) return 'text-red-400 font-semibold';
  if (c >= 0.65) return 'text-amber-400 font-medium';
  return 'text-gray-400';
}

export function QueueTable({
  entries, filter, onFilterChange, selected, onSelect,
  allCount, pendingCount, approvedCount, discardedCount,
}: Props) {
  const tabs: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all',       label: 'All',       count: allCount },
    { key: 'pending',   label: 'Pending',   count: pendingCount },
    { key: 'approved',  label: 'Approved',  count: approvedCount },
    { key: 'discarded', label: 'Discarded', count: discardedCount },
  ];

  return (
    <div className="bg-gray-900 rounded-xl border border-gray-800 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-gray-800 px-4 pt-3 pb-0">
        <div className="flex gap-0.5">
          {tabs.map(t => (
            <button
              key={t.key}
              onClick={() => onFilterChange(t.key)}
              className={`px-4 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition-colors ${
                filter === t.key
                  ? 'border-orange-500 text-orange-300'
                  : 'border-transparent text-gray-500 hover:text-gray-300'
              }`}
            >
              {t.label}
              <span className={`ml-1.5 text-xs px-1.5 py-0.5 rounded-full ${
                filter === t.key
                  ? 'bg-orange-500/20 text-orange-300'
                  : 'bg-gray-800 text-gray-600'
              }`}>
                {t.count}
              </span>
            </button>
          ))}
        </div>
        <p className="text-xs text-gray-600 pb-3">
          Click any row to load it into the Live Threat Feed →
        </p>
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-800/80">
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Threat Type
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Confidence
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Surgeon
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Variants Seen
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Received
              </th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-gray-400 uppercase tracking-wider">
                Decision
              </th>
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-14 text-center text-gray-600 text-sm">
                  No entries in this view
                </td>
              </tr>
            )}
            {entries.map(entry => (
              <tr
                key={entry.id}
                onClick={() => onSelect(entry)}
                className={`border-b border-gray-800/50 cursor-pointer transition-colors ${
                  selected?.id === entry.id
                    ? 'bg-orange-500/10'
                    : 'hover:bg-gray-800/60'
                }`}
              >
                <td className="px-4 py-3 font-medium text-gray-200 max-w-[220px] truncate">
                  {humanType(entry.attackType)}
                </td>
                <td className={`px-4 py-3 tabular-nums ${confidenceColor(entry.confidence ?? 0)}`}>
                  {((entry.confidence ?? 0) * 100).toFixed(0)}%
                </td>
                <td className="px-4 py-3 text-gray-400">
                  {entry.surgeonSource || 'stub'}
                </td>
                <td className="px-4 py-3 text-gray-400 tabular-nums">
                  {entry.variantCount}
                </td>
                <td className="px-4 py-3 text-gray-500 text-xs tabular-nums whitespace-nowrap">
                  {new Date(entry.receivedAt).toLocaleTimeString()}
                </td>
                <td className="px-4 py-3">
                  <span className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(entry.status)}`}>
                    {entry.status === 'pending'   ? 'Pending Review'
                      : entry.status === 'approved'  ? 'Threat Alarm'
                      : 'False Alarm'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
