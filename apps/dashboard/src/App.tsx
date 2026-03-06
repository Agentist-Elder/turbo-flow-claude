import { useEffect, useState, useCallback } from 'react';
import type { QuarantineEntry, Stats, FilterKey } from './types';
import { StatsBar } from './components/StatsBar';
import { QueueTable } from './components/QueueTable';
import { EntryDetail } from './components/EntryDetail';

type ServerStatus = 'online' | 'offline' | 'connecting';

export function App() {
  const [entries, setEntries] = useState<QuarantineEntry[]>([]);
  const [stats, setStats] = useState<Stats | null>(null);
  const [selected, setSelected] = useState<QuarantineEntry | null>(null);
  const [filter, setFilter] = useState<FilterKey>('all');
  const [serverStatus, setServerStatus] = useState<ServerStatus>('connecting');
  const [lastRefresh, setLastRefresh] = useState<Date | null>(null);
  const [refreshing, setRefreshing] = useState(false);

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
      // Keep selected entry in sync
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
    await fetch(`/poc/promote/${id}`, { method: 'POST' });
    await refresh();
  }, [refresh]);

  const discard = useCallback(async (id: string) => {
    await fetch(`/poc/discard/${id}`, { method: 'POST' });
    await refresh();
  }, [refresh]);

  const filtered =
    filter === 'all' ? entries : entries.filter(e => e.status === filter);

  return (
    <div className="min-h-screen bg-gray-50">
      {/* Header */}
      <header className="bg-white border-b border-gray-200 px-6 py-4">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 bg-red-600 rounded-lg flex items-center justify-center flex-shrink-0">
              <span className="text-white font-bold text-sm">M</span>
            </div>
            <div>
              <h1 className="text-lg font-semibold text-gray-900 leading-tight">
                Motha'Ship
              </h1>
              <p className="text-xs text-gray-500">
                Threat Triage Dashboard — P7
              </p>
            </div>
          </div>

          <div className="flex items-center gap-4">
            <div className="flex items-center gap-2">
              <div
                className={`w-2 h-2 rounded-full ${
                  serverStatus === 'online'
                    ? 'bg-green-500'
                    : serverStatus === 'offline'
                      ? 'bg-red-500'
                      : 'bg-yellow-400'
                }`}
              />
              <span className="text-sm text-gray-600">
                {serverStatus === 'online'
                  ? 'Server online'
                  : serverStatus === 'offline'
                    ? 'Server offline'
                    : 'Connecting…'}
              </span>
            </div>

            {lastRefresh && (
              <span className="text-xs text-gray-400">
                {lastRefresh.toLocaleTimeString()}
              </span>
            )}

            <button
              onClick={() => void refresh()}
              disabled={refreshing}
              className="px-3 py-1.5 text-sm bg-white border border-gray-200 rounded-md hover:bg-gray-50 disabled:opacity-50 transition-colors"
            >
              {refreshing ? 'Refreshing…' : 'Refresh'}
            </button>
          </div>
        </div>
      </header>

      <main className="px-6 py-6 space-y-5">
        {/* Stats */}
        {stats && <StatsBar stats={stats} />}

        {/* Offline notice */}
        {serverStatus === 'offline' && (
          <div className="bg-red-50 border border-red-200 rounded-lg p-4 text-sm text-red-700">
            Cannot reach poc-server at{' '}
            <span className="font-mono">localhost:3000</span>. Start it with:{' '}
            <code className="font-mono bg-red-100 px-1.5 py-0.5 rounded">
              npx tsx scripts/poc/poc-server.ts
            </code>
          </div>
        )}

        {/* Table + Detail panel */}
        <div className="flex gap-5 items-start">
          <div className={selected ? 'flex-1 min-w-0' : 'w-full'}>
            <QueueTable
              entries={filtered}
              filter={filter}
              onFilterChange={setFilter}
              selected={selected}
              onSelect={entry =>
                setSelected(prev =>
                  prev?.id === entry.id ? null : entry,
                )
              }
              onApprove={id => void approve(id)}
              onDiscard={id => void discard(id)}
              allCount={entries.length}
              pendingCount={entries.filter(e => e.status === 'pending').length}
              approvedCount={entries.filter(e => e.status === 'approved').length}
              discardedCount={
                entries.filter(e => e.status === 'discarded').length
              }
            />
          </div>

          {selected && (
            <div className="w-96 flex-shrink-0">
              <EntryDetail
                entry={selected}
                onApprove={() => void approve(selected.id)}
                onDiscard={() => void discard(selected.id)}
                onClose={() => setSelected(null)}
              />
            </div>
          )}
        </div>
      </main>
    </div>
  );
}
