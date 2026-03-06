import type { Stats } from '../types';

interface StatCard {
  label: string;
  value: string | number;
  color: string;
  bg: string;
  border: string;
}

export function StatsBar({ stats }: { stats: Stats }) {
  const cards: StatCard[] = [
    {
      label: 'Pending Review',
      value: stats.quarantine.pending,
      color: 'text-amber-600',
      bg: 'bg-amber-50',
      border: 'border-amber-200',
    },
    {
      label: 'Approved',
      value: stats.quarantine.approved,
      color: 'text-green-600',
      bg: 'bg-green-50',
      border: 'border-green-200',
    },
    {
      label: 'Discarded',
      value: stats.quarantine.discarded,
      color: 'text-gray-500',
      bg: 'bg-gray-50',
      border: 'border-gray-200',
    },
    {
      label: 'Cache Hit Rate',
      value: stats.cache.hitRate,
      color: 'text-blue-600',
      bg: 'bg-blue-50',
      border: 'border-blue-200',
    },
    {
      label: 'Blocked Fingerprints',
      value: stats.approvedSet.size,
      color: 'text-red-600',
      bg: 'bg-red-50',
      border: 'border-red-200',
    },
  ];

  return (
    <div className="grid grid-cols-5 gap-4">
      {cards.map(c => (
        <div
          key={c.label}
          className={`rounded-lg border p-4 ${c.bg} ${c.border}`}
        >
          <p className="text-xs text-gray-500 mb-1 truncate">{c.label}</p>
          <p className={`text-2xl font-semibold tabular-nums ${c.color}`}>
            {c.value}
          </p>
        </div>
      ))}
    </div>
  );
}
