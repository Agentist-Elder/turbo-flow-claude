import type { Stats, QuarantineEntry } from '../types';

interface Props {
  stats: Stats;
  entries: QuarantineEntry[];
}

function Bar({ label, pct, color, value }: { label: string; pct: number; color: string; value: string }) {
  return (
    <div>
      <div className="flex justify-between items-baseline mb-1.5">
        <span className="text-xs font-medium text-gray-300">{label}</span>
        <span className="text-xs font-bold text-gray-100 tabular-nums">{value}</span>
      </div>
      <div className="h-1.5 bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-700 ${color}`}
          style={{ width: `${Math.max(pct, 0)}%` }}
        />
      </div>
    </div>
  );
}

export function DetectionMetrics({ stats, entries }: Props) {
  const total        = stats.quarantine.total || 1;
  const hitRateNum   = parseFloat(stats.cache.hitRate) || 0;
  const pendingPct   = Math.round((stats.quarantine.pending / total) * 100);
  const approvedPct  = Math.round((stats.quarantine.approved / total) * 100);

  const pendingEntries = entries.filter(e => e.status === 'pending');
  const avgConf = pendingEntries.length > 0
    ? pendingEntries.reduce((s, e) => s + e.confidence, 0) / pendingEntries.length
    : 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 mb-3">
        <span className="text-blue-400 text-base">◈</span>
        <h2 className="text-xs font-semibold text-gray-300 uppercase tracking-widest">Detection Metrics</h2>
      </div>

      <div className="space-y-4 flex-1">
        <Bar
          label="Cache Hit Rate"
          pct={hitRateNum}
          value={stats.cache.hitRate}
          color="bg-blue-500"
        />
        <Bar
          label="Avg Threat Confidence"
          pct={Math.round(avgConf * 100)}
          value={`${(avgConf * 100).toFixed(0)}%`}
          color="bg-red-500"
        />
        <Bar
          label="Pending Review"
          pct={pendingPct}
          value={String(stats.quarantine.pending)}
          color="bg-amber-500"
        />
        <Bar
          label="Approved / Blocked"
          pct={approvedPct}
          value={String(stats.quarantine.approved)}
          color="bg-emerald-500"
        />
      </div>

      <div className="mt-5 space-y-2">
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800/60 border border-gray-700/40">
          <span className="text-xs font-medium text-gray-300">Blocked Fingerprints</span>
          <span className="text-xs font-bold text-red-400 tabular-nums">{stats.approvedSet.size}</span>
        </div>
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-gray-800/60 border border-gray-700/40">
          <span className="text-xs font-medium text-gray-300">Cache Checks</span>
          <span className="text-xs font-semibold text-gray-100 tabular-nums">{stats.cache.totalChecks}</span>
        </div>
        <div className="flex items-center justify-between px-3 py-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20">
          <span className="text-xs font-medium text-gray-300">Surgeon</span>
          <span className="text-xs font-bold text-emerald-400">● Active</span>
        </div>
      </div>
    </div>
  );
}
