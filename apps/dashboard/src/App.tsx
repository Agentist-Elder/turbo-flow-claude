import { useEffect, useState, useCallback } from 'react';
import type { QuarantineEntry, Stats, FilterKey } from './types';
import { ThreatIntake } from './components/ThreatIntake';
import { DetectionMetrics } from './components/DetectionMetrics';
import { LiveFeed } from './components/LiveFeed';
import { QueueTable } from './components/QueueTable';

type ServerStatus = 'online' | 'offline' | 'connecting';

/** Sort pending entries: highest confidence first, then most variants */
function prioritise(entries: QuarantineEntry[]): QuarantineEntry[] {
  return entries
    .filter(e => e.status === 'pending')
    .sort((a, b) => {
      const confDiff = (b.confidence ?? 0) - (a.confidence ?? 0);
      if (confDiff !== 0) return confDiff;
      return (b.variantCount ?? 0) - (a.variantCount ?? 0);
    });
}

export function App() {
  const [entries, setEntries]           = useState<QuarantineEntry[]>([]);
  const [stats, setStats]               = useState<Stats | null>(null);
  const [selected, setSelected]         = useState<QuarantineEntry | null>(null);
  const [filter, setFilter]             = useState<FilterKey>('all');
  const [serverStatus, setServerStatus] = useState<ServerStatus>('connecting');
  const [lastRefresh, setLastRefresh]   = useState<Date | null>(null);
  const [refreshing, setRefreshing]     = useState(false);
  const [flushing, setFlushing]         = useState(false);
  const [clearing, setClearing]         = useState(false);

  const refresh = useCallback(async () => {
    setRefreshing(true);
    try {
      const [qRes, sRes] = await Promise.all([
        fetch('/poc/queue'),
        fetch('/poc/stats'),
      ]);
      if (!qRes.ok || !sRes.ok) throw new Error('Server error');
      const [queue, statsData] = await Promise.all([
        qRes.json() as Promise<QuarantineEntry[]>,
        sRes.json() as Promise<Stats>,
      ]);
      setEntries(queue);
      setStats(statsData);
      setServerStatus('online');
      setLastRefresh(new Date());
      // Keep selected entry synced if it still exists; otherwise clear
      setSelected(prev =>
        prev ? (queue.find(e => e.id === prev.id) ?? null) : null,
      );
    } catch {
      setServerStatus('offline');
    } finally {
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const id = setInterval(() => void refresh(), 5000);
    return () => clearInterval(id);
  }, [refresh]);

  const approve = useCallback(async (id: string) => {
    setSelected(null); // clear so Live Feed auto-advances to next threat
    await fetch(`/poc/promote/${id}`, { method: 'POST' });
    await refresh();
  }, [refresh]);

  const discard = useCallback(async (id: string) => {
    setSelected(null); // clear so Live Feed auto-advances to next threat
    await fetch(`/poc/discard/${id}`, { method: 'POST' });
    await refresh();
  }, [refresh]);

  const flushCache = useCallback(async () => {
    setFlushing(true);
    await fetch('/poc/flush', { method: 'POST' });
    await refresh();
    setFlushing(false);
  }, [refresh]);

  const clearQueue = useCallback(async () => {
    setClearing(true);
    setSelected(null);
    await fetch('/poc/clear', { method: 'POST' });
    await refresh();
    setClearing(false);
  }, [refresh]);

  const filtered =
    filter === 'all' ? entries : entries.filter(e => e.status === filter);

  // Priority-sorted pending list
  const pendingByPriority = prioritise(entries);

  // Live Feed: show selected row, else highest-priority pending threat
  const liveFeedEntry = selected ?? pendingByPriority[0] ?? null;

  // Position counter for "1 of N threats"
  const pendingTotal = pendingByPriority.length;
  const pendingIndex = liveFeedEntry?.status === 'pending'
    ? (pendingByPriority.findIndex(e => e.id === liveFeedEntry.id) + 1) || 1
    : 0;

  const statusDot = {
    online:     'bg-emerald-400',
    offline:    'bg-red-500',
    connecting: 'bg-yellow-400 animate-pulse',
  }[serverStatus];

  return (
    <div className="min-h-screen" style={{ backgroundColor: '#0d1117' }}>

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="border-b border-gray-800/80 px-6 py-3">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-700 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white font-black text-sm">M</span>
            </div>
            <div>
              <h1 className="text-base font-bold text-gray-100 leading-tight tracking-tight">
                Motha'Ship
              </h1>
              <p className="text-[11px] text-gray-500">AI Threat Command Center</p>
            </div>
          </div>

          <div className="flex items-center gap-3">
            <div className="flex items-center gap-1.5">
              <div className={`w-2 h-2 rounded-full ${statusDot}`} />
              <span className="text-xs text-gray-400">
                {serverStatus === 'online'     ? 'Server online'
                  : serverStatus === 'offline' ? 'Server offline'
                  : 'Connecting…'}
              </span>
            </div>

            {lastRefresh && (
              <span className="text-xs text-gray-700 tabular-nums">
                {lastRefresh.toLocaleTimeString()}
              </span>
            )}

            {pendingTotal > 0 && (
              <span className="px-2.5 py-1 text-xs font-bold bg-red-600/20 text-red-400 border border-red-600/30 rounded-full">
                {pendingTotal} awaiting review
              </span>
            )}

            <button
              onClick={() => void clearQueue()}
              disabled={clearing || pendingTotal === 0}
              className="px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-800 border border-gray-700 rounded-md hover:bg-gray-700 hover:text-gray-200 disabled:opacity-40 transition-colors"
              title="Discard all pending entries — use to reset the demo queue"
            >
              {clearing ? 'Clearing…' : 'Clear Queue'}
            </button>

            <button
              onClick={() => void flushCache()}
              disabled={flushing}
              className="px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-800 border border-gray-700 rounded-md hover:bg-gray-700 hover:text-gray-200 disabled:opacity-40 transition-colors"
            >
              {flushing ? 'Flushing…' : 'Flush Cache'}
            </button>

            <button
              onClick={() => void refresh()}
              disabled={refreshing}
              className="px-3 py-1.5 text-xs font-medium text-gray-400 bg-gray-800 border border-gray-700 rounded-md hover:bg-gray-700 hover:text-gray-200 disabled:opacity-40 transition-colors"
            >
              {refreshing ? '↻ …' : '↻ Refresh'}
            </button>
          </div>
        </div>
      </header>

      <main className="px-6 py-5 space-y-5 relative">

        {/* Offline banner */}
        {serverStatus === 'offline' && (
          <div className="bg-red-950/60 border border-red-800/50 rounded-lg px-4 py-3 text-sm text-red-300">
            Cannot reach poc-server at{' '}
            <span className="font-mono text-red-200">localhost:3000</span>.
            {' '}Start it with:{' '}
            <code className="font-mono bg-red-900/40 px-1.5 py-0.5 rounded text-xs">
              npx tsx scripts/poc/poc-server.ts
            </code>
          </div>
        )}

        {/* ── Command Center — sticky so actions stay visible while scrolling ── */}
        <div className="sticky top-0 z-10 bg-gray-900 border border-gray-800 rounded-xl p-6">
          <div className="grid grid-cols-3 gap-0 divide-x divide-gray-800" style={{ minHeight: '360px' }}>

            {/* Left: Threat Intake */}
            <div className="pr-6">
              <ThreatIntake onInjected={() => void refresh()} />
            </div>

            {/* Center: Detection Metrics */}
            <div className="px-6">
              {stats ? (
                <DetectionMetrics stats={stats} entries={entries} />
              ) : (
                <div className="flex items-center justify-center h-full text-gray-600 text-sm">
                  {serverStatus === 'connecting' ? 'Connecting…' : 'Waiting for data'}
                </div>
              )}
            </div>

            {/* Right: Live Feed — primary action area */}
            <div className="pl-6">
              <LiveFeed
                entry={liveFeedEntry}
                pendingTotal={pendingTotal}
                pendingIndex={pendingIndex}
                onApprove={id => void approve(id)}
                onDiscard={id => void discard(id)}
              />
            </div>
          </div>
        </div>

        {/* ── Threat History ───────────────────────────────────────────── */}
        <QueueTable
          entries={filtered}
          filter={filter}
          onFilterChange={setFilter}
          selected={selected}
          onSelect={entry =>
            setSelected(prev => prev?.id === entry.id ? null : entry)
          }
          allCount={entries.length}
          pendingCount={entries.filter(e => e.status === 'pending').length}
          approvedCount={entries.filter(e => e.status === 'approved').length}
          discardedCount={entries.filter(e => e.status === 'discarded').length}
        />

      </main>
    </div>
  );
}
