import type { QuarantineEntry, FilterKey } from '../types';

interface Props {
  entries: QuarantineEntry[];
  filter: FilterKey;
  onFilterChange: (f: FilterKey) => void;
  selected: QuarantineEntry | null;
  onSelect: (e: QuarantineEntry) => void;
  onApprove: (id: string) => void;
  onDiscard: (id: string) => void;
  allCount: number;
  pendingCount: number;
  approvedCount: number;
  discardedCount: number;
}

function statusBadge(status: string): string {
  if (status === 'pending') return 'bg-amber-100 text-amber-700';
  if (status === 'approved') return 'bg-green-100 text-green-700';
  return 'bg-gray-100 text-gray-500';
}

function confidenceColor(c: number): string {
  if (c >= 0.85) return 'text-red-600 font-semibold';
  if (c >= 0.65) return 'text-orange-500 font-medium';
  return 'text-gray-500';
}

export function QueueTable({
  entries,
  filter,
  onFilterChange,
  selected,
  onSelect,
  onApprove,
  onDiscard,
  allCount,
  pendingCount,
  approvedCount,
  discardedCount,
}: Props) {
  const tabs: { key: FilterKey; label: string; count: number }[] = [
    { key: 'all', label: 'All', count: allCount },
    { key: 'pending', label: 'Pending', count: pendingCount },
    { key: 'approved', label: 'Approved', count: approvedCount },
    { key: 'discarded', label: 'Discarded', count: discardedCount },
  ];

  return (
    <div className="bg-white rounded-lg border border-gray-200 overflow-hidden">
      {/* Filter tabs */}
      <div className="flex border-b border-gray-200 px-4 pt-3 gap-1">
        {tabs.map(t => (
          <button
            key={t.key}
            onClick={() => onFilterChange(t.key)}
            className={`px-4 py-2 text-sm font-medium rounded-t border-b-2 -mb-px transition-colors ${
              filter === t.key
                ? 'border-gray-900 text-gray-900'
                : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}
          >
            {t.label}
            <span className="ml-1.5 bg-gray-100 text-gray-500 text-xs px-1.5 py-0.5 rounded-full">
              {t.count}
            </span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-100 bg-gray-50/50">
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Attack Type
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Conf
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Surgeon
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Variants
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Received
              </th>
              <th className="text-left px-4 py-3 text-xs font-medium text-gray-500 uppercase tracking-wide">
                Status
              </th>
              <th className="px-4 py-3 w-20" />
            </tr>
          </thead>
          <tbody>
            {entries.length === 0 && (
              <tr>
                <td
                  colSpan={7}
                  className="px-4 py-10 text-center text-gray-400 text-sm"
                >
                  No entries
                </td>
              </tr>
            )}
            {entries.map(entry => (
              <tr
                key={entry.id}
                onClick={() => onSelect(entry)}
                className={`border-b border-gray-50 cursor-pointer transition-colors ${
                  selected?.id === entry.id
                    ? 'bg-blue-50 hover:bg-blue-50'
                    : 'hover:bg-gray-50'
                }`}
              >
                <td className="px-4 py-3 font-medium text-gray-900 max-w-[200px] truncate">
                  {entry.attackType}
                </td>
                <td
                  className={`px-4 py-3 tabular-nums ${confidenceColor(entry.confidence)}`}
                >
                  {(entry.confidence * 100).toFixed(0)}%
                </td>
                <td className="px-4 py-3 text-gray-500">
                  {entry.surgeonSource || 'unknown'}
                </td>
                <td className="px-4 py-3 text-gray-500 tabular-nums">
                  {entry.variantCount}
                </td>
                <td className="px-4 py-3 text-gray-400 text-xs tabular-nums whitespace-nowrap">
                  {new Date(entry.receivedAt).toLocaleTimeString()}
                </td>
                <td className="px-4 py-3">
                  <span
                    className={`inline-flex px-2 py-0.5 rounded-full text-xs font-medium ${statusBadge(entry.status)}`}
                  >
                    {entry.status}
                  </span>
                </td>
                <td className="px-4 py-3">
                  {entry.status === 'pending' && (
                    <div
                      className="flex gap-1"
                      onClick={e => e.stopPropagation()}
                    >
                      <button
                        onClick={() => onApprove(entry.id)}
                        title="Approve & block"
                        className="px-2 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                      >
                        ✓
                      </button>
                      <button
                        onClick={() => onDiscard(entry.id)}
                        title="Discard"
                        className="px-2 py-1 text-xs bg-gray-200 text-gray-600 rounded hover:bg-gray-300 transition-colors"
                      >
                        ✕
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
