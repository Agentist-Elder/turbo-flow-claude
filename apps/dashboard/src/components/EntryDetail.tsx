import type { QuarantineEntry } from '../types';

interface Props {
  entry: QuarantineEntry;
  onApprove: () => void;
  onDiscard: () => void;
  onClose: () => void;
}

function confidenceColor(c: number): string {
  if (c >= 0.85) return 'text-red-600';
  if (c >= 0.65) return 'text-orange-500';
  return 'text-gray-500';
}

const EXTERNAL_INTEL = ['AlienVault OTX', 'VirusTotal', 'HIBP'] as const;

export function EntryDetail({ entry, onApprove, onDiscard, onClose }: Props) {
  return (
    <div className="bg-white rounded-lg border border-gray-200 sticky top-6">
      {/* Header */}
      <div className="flex items-start justify-between px-4 py-4 border-b border-gray-100">
        <div className="min-w-0 flex-1">
          <h3 className="font-semibold text-gray-900 text-sm truncate">
            {entry.attackType}
          </h3>
          <p className="text-xs text-gray-400 mt-0.5 font-mono">
            {entry.fingerprint.slice(0, 16)}…
          </p>
        </div>
        <button
          onClick={onClose}
          className="ml-2 text-gray-400 hover:text-gray-600 transition-colors text-lg leading-none"
          aria-label="Close detail panel"
        >
          ×
        </button>
      </div>

      <div className="px-4 py-4 space-y-4 text-sm">
        {/* Metrics row */}
        <div className="flex gap-6">
          <div>
            <p className="text-xs text-gray-500 mb-1">Confidence</p>
            <p
              className={`text-xl font-semibold tabular-nums ${confidenceColor(entry.confidence)}`}
            >
              {(entry.confidence * 100).toFixed(0)}%
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Surgeon</p>
            <p className="font-medium text-gray-700">
              {entry.surgeonSource || 'unknown'}
            </p>
          </div>
          <div>
            <p className="text-xs text-gray-500 mb-1">Variants</p>
            <p className="font-medium text-gray-700 tabular-nums">
              {entry.variantCount}
            </p>
          </div>
        </div>

        {/* Payload preview */}
        <div>
          <p className="text-xs text-gray-500 mb-1.5">Payload Preview</p>
          <pre className="text-xs bg-gray-50 border border-gray-100 rounded p-3 font-mono text-gray-700 break-all whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto">
            {entry.preview}
          </pre>
        </div>

        {/* Core intent */}
        <div>
          <p className="text-xs text-gray-500 mb-1">Core Intent</p>
          <p className="text-gray-700 leading-relaxed">{entry.coreIntent}</p>
        </div>

        {/* Recommendation */}
        <div>
          <p className="text-xs text-gray-500 mb-1">Recommendation</p>
          <p className="text-gray-700 leading-relaxed">{entry.recommendation}</p>
        </div>

        {/* External intel — WIRE-IN */}
        <div>
          <p className="text-xs text-gray-500 mb-2">External Intel</p>
          <div className="space-y-1.5">
            {EXTERNAL_INTEL.map(src => (
              <div
                key={src}
                className="flex items-center justify-between bg-gray-50 border border-gray-100 rounded px-3 py-2"
              >
                <span className="text-xs text-gray-600">{src}</span>
                <span className="text-xs text-gray-400 italic">
                  N/A — WIRE-IN
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Received */}
        <p className="text-xs text-gray-400">
          Received {new Date(entry.receivedAt).toLocaleString()}
        </p>

        {/* Actions */}
        {entry.status === 'pending' ? (
          <div className="flex gap-2 pt-2 border-t border-gray-100">
            <button
              onClick={onApprove}
              className="flex-1 py-2 text-sm font-medium bg-green-600 text-white rounded-md hover:bg-green-700 transition-colors"
            >
              Approve & Block
            </button>
            <button
              onClick={onDiscard}
              className="flex-1 py-2 text-sm font-medium bg-gray-100 text-gray-600 rounded-md hover:bg-gray-200 transition-colors"
            >
              Discard
            </button>
          </div>
        ) : (
          <div className="pt-2 border-t border-gray-100">
            <span
              className={`text-sm font-medium ${
                entry.status === 'approved' ? 'text-green-600' : 'text-gray-400'
              }`}
            >
              {entry.status === 'approved'
                ? '✓ Approved — fingerprint blocked'
                : '✕ Discarded'}
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
