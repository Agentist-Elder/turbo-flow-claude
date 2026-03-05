/**
 * Phase P4 — Motha'Ship Triage Dashboard
 *
 * Interactive CLI for reviewing, approving, and discarding quarantined attack
 * vectors.  Connects to the PoC server running locally.
 *
 * Usage:
 *   npx tsx scripts/poc/dashboard.ts [--server http://127.0.0.1:3000] [--all]
 *
 * Controls:
 *   ↑ / ↓    Navigate entries
 *   a        Approve selected entry  (POST /poc/promote/:id)
 *   d        Discard selected entry  (POST /poc/discard/:id)
 *   r        Refresh queue from server
 *   q / ^C   Quit
 *
 * External-context column (AlienVault OTX / VirusTotal / HaveIBeenPwned)
 * is reserved as a placeholder for the next iteration.
 */

// ---------------------------------------------------------------------------
// Types (mirror QuarantineEntry from poc-server.ts)
// ---------------------------------------------------------------------------

interface QuarantineEntry {
  id:             string;
  fingerprint:    string;
  preview:        string;
  attackType:     string;
  coreIntent:     string;
  recommendation: string;
  confidence:     number;
  receivedAt:     string;
  variantCount:   number;
  status:         'pending' | 'approved' | 'discarded';
  surgeonSource:  string;
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const args       = process.argv.slice(2);
const serverIdx  = args.indexOf('--server');
const SERVER     = (serverIdx >= 0 && args[serverIdx + 1])
  ? args[serverIdx + 1]!
  : 'http://127.0.0.1:3000';
const SHOW_ALL   = args.includes('--all');

// ---------------------------------------------------------------------------
// HTTP helpers
// ---------------------------------------------------------------------------

async function fetchQueue(): Promise<QuarantineEntry[]> {
  const res  = await fetch(`${SERVER}/poc/queue`);
  if (!res.ok) throw new Error(`GET /poc/queue → HTTP ${res.status}`);
  return res.json() as Promise<QuarantineEntry[]>;
}

async function promote(id: string): Promise<void> {
  const res = await fetch(`${SERVER}/poc/promote/${id}`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /poc/promote/${id} → HTTP ${res.status}`);
  // Also flush the SHA-256 cache so the next run of Step 5 hits Layer 0
  await fetch(`${SERVER}/poc/flush`, { method: 'POST' }).catch(() => { /* non-fatal */ });
}

async function discard(id: string): Promise<void> {
  const res = await fetch(`${SERVER}/poc/discard/${id}`, { method: 'POST' });
  if (!res.ok) throw new Error(`POST /poc/discard/${id} → HTTP ${res.status}`);
}

// ---------------------------------------------------------------------------
// Terminal helpers
// ---------------------------------------------------------------------------

const ESC  = '\x1b[';
const HIDE_CURSOR = '\x1b[?25l';
const SHOW_CURSOR = '\x1b[?25h';
const CLEAR_SCREEN = '\x1b[2J\x1b[H';

function cols(): number { return process.stdout.columns || 100; }
function rows(): number { return process.stdout.rows    || 30; }

function write(s: string): void { process.stdout.write(s); }

function moveTo(row: number, col: number): void {
  write(`${ESC}${row};${col}H`);
}

function clearLine(): void { write(`${ESC}2K`); }

// Colour helpers
const C = {
  reset:  '\x1b[0m',
  bold:   '\x1b[1m',
  dim:    '\x1b[2m',
  rev:    '\x1b[7m',   // reverse video (highlight)
  red:    '\x1b[31m',
  green:  '\x1b[32m',
  yellow: '\x1b[33m',
  cyan:   '\x1b[36m',
  white:  '\x1b[37m',
};

function pad(s: string, n: number): string {
  if (s.length >= n) return s.slice(0, n);
  return s + ' '.repeat(n - s.length);
}

function statusColour(s: QuarantineEntry['status']): string {
  if (s === 'approved')  return C.green;
  if (s === 'discarded') return C.dim;
  return C.yellow;
}

function fmtConf(c: number): string {
  const pct = (c * 100).toFixed(0).padStart(3);
  const col  = c >= 0.8 ? C.red : c >= 0.5 ? C.yellow : C.dim;
  return `${col}${pct}%${C.reset}`;
}

function fmtDate(iso: string): string {
  // Local time, compact: "03-05 16:30"
  try {
    const d = new Date(iso);
    const mo = String(d.getMonth() + 1).padStart(2, '0');
    const dd = String(d.getDate()).padStart(2, '0');
    const hh = String(d.getHours()).padStart(2, '0');
    const mm = String(d.getMinutes()).padStart(2, '0');
    return `${mo}-${dd} ${hh}:${mm}`;
  } catch {
    return iso.slice(0, 16);
  }
}

// ---------------------------------------------------------------------------
// Layout constants
// ---------------------------------------------------------------------------

// Column widths (fixed — adjust if you widen the terminal)
// # | AttackType | Conf | Vars | Received    | ExtContext   | Status
// 3 | 22         | 5    | 4    | 11          | 14           | 9
const COL_IDX  =  3;
const COL_TYPE = 22;
const COL_CONF =  5;
const COL_VARS =  4;
const COL_TIME = 11;
const COL_EXT  = 14;
const COL_SRC  =  7;
const COL_STAT =  9;

function tableWidth(): number {
  // separators: 1 + each col + 1 = N columns × 3 plus edges
  return 3 + COL_IDX + 3 + COL_TYPE + 3 + COL_CONF + 3 + COL_VARS +
         3 + COL_TIME + 3 + COL_EXT + 3 + COL_SRC + 3 + COL_STAT + 1;
}

function hr(char: string = '─'): string {
  return char.repeat(Math.min(tableWidth(), cols()));
}

function tableHeader(): string {
  return [
    C.bold + C.cyan,
    ` ${'#'.padStart(COL_IDX)} `,
    `│ ${pad('Attack Type', COL_TYPE)} `,
    `│ ${'Conf'.padEnd(COL_CONF)} `,
    `│ ${'Vars'.padEnd(COL_VARS)} `,
    `│ ${'Received'.padEnd(COL_TIME)} `,
    `│ ${'External Context'.padEnd(COL_EXT)} `,
    `│ ${'Source'.padEnd(COL_SRC)} `,
    `│ ${'Status'.padEnd(COL_STAT)} `,
    C.reset,
  ].join('');
}

function tableRow(entry: QuarantineEntry, idx: number, selected: boolean): string {
  const hi   = selected ? C.rev : '';
  const rst  = C.reset;
  const num  = String(idx + 1).padStart(COL_IDX);
  const type = pad(entry.attackType, COL_TYPE);
  const conf = pad(`${(entry.confidence * 100).toFixed(0)}%`, COL_CONF);
  const vars = String(entry.variantCount).padEnd(COL_VARS);
  const time = pad(fmtDate(entry.receivedAt), COL_TIME);
  // WIRE-IN: AlienVault OTX / VirusTotal / HaveIBeenPwned — replace '[External: N/A]' with live lookup
  const ext  = pad('[External: N/A]', COL_EXT);
  const src  = pad((entry.surgeonSource ?? '').slice(0, COL_SRC), COL_SRC);
  const stat = pad(entry.status, COL_STAT);

  const statC = statusColour(entry.status);

  return [
    hi,
    ` ${num} `,
    `│ ${type} `,
    `│ ${conf} `,
    `│ ${vars} `,
    `│ ${time} `,
    `│ ${C.dim}${ext}${rst}${hi} `,
    `│ ${src} `,
    `│ ${statC}${stat}${rst}${hi} `,
    rst,
  ].join('');
}

// ---------------------------------------------------------------------------
// Detail panel (bottom section, below the table)
// ---------------------------------------------------------------------------

function renderDetail(entry: QuarantineEntry | undefined, startRow: number): void {
  moveTo(startRow, 1);

  const W = Math.min(tableWidth(), cols());

  const rule = `${C.dim}${'─'.repeat(W)}${C.reset}`;

  if (!entry) {
    write(rule + '\n');
    clearLine(); write(`${C.dim}  (no entry selected)${C.reset}\n`);
    return;
  }

  write(rule + '\n');

  const lines = [
    `${C.bold}  ID:${C.reset}              ${entry.id}`,
    `${C.bold}  Fingerprint:${C.reset}     ${entry.fingerprint}`,
    `${C.bold}  Attack Type:${C.reset}     ${entry.attackType}`,
    `${C.bold}  Confidence:${C.reset}      ${(entry.confidence * 100).toFixed(0)}%  (${entry.surgeonSource ?? 'unknown'})`,
    `${C.bold}  Variants seen:${C.reset}   ${entry.variantCount}`,
    `${C.bold}  Core Intent:${C.reset}     ${entry.coreIntent.slice(0, cols() - 20)}`,
    `${C.bold}  Recommendation:${C.reset}  ${entry.recommendation.slice(0, cols() - 20)}`,
    `${C.bold}  Preview:${C.reset}         ${entry.preview.slice(0, cols() - 20)}`,
    ``,
    // WIRE-IN: AlienVault OTX / VirusTotal / HaveIBeenPwned — replace N/A values with live API responses
    `${C.dim}  External Context:  [AlienVault OTX: N/A]  [VirusTotal: N/A]  [HIBP: N/A]${C.reset}`,
  ];

  for (const line of lines) {
    clearLine();
    write(line + '\n');
  }
}

// ---------------------------------------------------------------------------
// Status bar
// ---------------------------------------------------------------------------

function renderStatusBar(msg: string, isError = false): void {
  const r = rows();
  moveTo(r, 1);
  clearLine();

  const controls = `${C.dim}[↑/↓] nav  [a] approve  [d] discard  [r] refresh  [q] quit${C.reset}`;
  const notice   = msg
    ? `  ${isError ? C.red : C.green}${msg}${C.reset}`
    : '';

  write(controls + notice);
}

// ---------------------------------------------------------------------------
// Render loop
// ---------------------------------------------------------------------------

interface State {
  entries:  QuarantineEntry[];
  cursor:   number;
  message:  string;
  isError:  boolean;
  loading:  boolean;
}

function renderAll(state: State): void {
  const { entries, cursor, message, isError } = state;

  write(CLEAR_SCREEN);

  const W = Math.min(tableWidth(), cols());
  const banner = `Motha'Ship Triage Dashboard — P4`;
  const bannerPad = Math.max(0, Math.floor((W - banner.length) / 2));

  // Header
  write(`${C.bold}${C.cyan}${'═'.repeat(W)}${C.reset}\n`);
  write(`${' '.repeat(bannerPad)}${C.bold}${C.cyan}${banner}${C.reset}\n`);
  write(`${C.dim}  Server: ${SERVER}  │  ${SHOW_ALL ? 'All entries' : 'Pending only'}  │  ${entries.length} entries${C.reset}\n`);
  write(`${C.bold}${C.cyan}${'═'.repeat(W)}${C.reset}\n`);

  if (state.loading) {
    write(`\n  ${C.dim}Loading…${C.reset}\n`);
    renderStatusBar('');
    return;
  }

  // Table header
  write(tableHeader() + '\n');
  write(`${C.dim}${'─'.repeat(W)}${C.reset}\n`);

  // Table rows — cap at available terminal height
  const DETAIL_LINES = 14;   // lines reserved for detail panel + status bar
  const maxRows = Math.max(1, rows() - 8 - DETAIL_LINES);

  // Scroll window
  const winStart = Math.max(0, Math.min(cursor - Math.floor(maxRows / 2), entries.length - maxRows));
  const winEnd   = Math.min(entries.length, winStart + maxRows);

  if (entries.length === 0) {
    write(`  ${C.dim}Queue is empty.${C.reset}\n`);
  } else {
    for (let i = winStart; i < winEnd; i++) {
      const row = tableRow(entries[i]!, i, i === cursor);
      clearLine();
      write(row + '\n');
    }
    if (winEnd < entries.length) {
      write(`  ${C.dim}… ${entries.length - winEnd} more entries (scroll)${C.reset}\n`);
    }
  }

  const currentRow = rows() - DETAIL_LINES + 1;
  renderDetail(entries[cursor], currentRow);
  renderStatusBar(message, isError);
}

// ---------------------------------------------------------------------------
// Keyboard handling
// ---------------------------------------------------------------------------

async function handleKey(key: string, state: State): Promise<Partial<State>> {
  if (key === 'q' || key === '\x03') {          // q or Ctrl+C
    cleanup();
    process.exit(0);
  }

  if (key === '\x1b[A' || key === 'k') {        // up arrow / k
    return { cursor: Math.max(0, state.cursor - 1), message: '' };
  }

  if (key === '\x1b[B' || key === 'j') {        // down arrow / j
    return { cursor: Math.min(state.entries.length - 1, state.cursor + 1), message: '' };
  }

  if (key === 'r') {                             // refresh
    try {
      const all = await fetchQueue();
      const entries = SHOW_ALL ? all : all.filter(e => e.status === 'pending');
      const cursor  = Math.min(state.cursor, Math.max(0, entries.length - 1));
      return { entries, cursor, message: `Refreshed — ${entries.length} entries`, isError: false };
    } catch (err) {
      return { message: `Refresh failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  }

  if (key === 'a') {                             // approve
    const entry = state.entries[state.cursor];
    if (!entry) return { message: 'Nothing to approve' };
    if (entry.status !== 'pending') return { message: `Entry is already ${entry.status}` };

    try {
      await promote(entry.id);
      const all     = await fetchQueue();
      const entries = SHOW_ALL ? all : all.filter(e => e.status === 'pending');
      const cursor  = Math.min(state.cursor, Math.max(0, entries.length - 1));
      return {
        entries, cursor,
        message:  `✓ Approved — fingerprint promoted to blocked set`,
        isError:  false,
      };
    } catch (err) {
      return { message: `Approve failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  }

  if (key === 'd') {                             // discard
    const entry = state.entries[state.cursor];
    if (!entry) return { message: 'Nothing to discard' };
    if (entry.status !== 'pending') return { message: `Entry is already ${entry.status}` };

    try {
      await discard(entry.id);
      const all     = await fetchQueue();
      const entries = SHOW_ALL ? all : all.filter(e => e.status === 'pending');
      const cursor  = Math.min(state.cursor, Math.max(0, entries.length - 1));
      return { entries, cursor, message: `Discarded`, isError: false };
    } catch (err) {
      return { message: `Discard failed: ${err instanceof Error ? err.message : String(err)}`, isError: true };
    }
  }

  return {};
}

// ---------------------------------------------------------------------------
// Cleanup
// ---------------------------------------------------------------------------

function cleanup(): void {
  write(SHOW_CURSOR);
  write(CLEAR_SCREEN);
  // Restore cooked mode
  if (process.stdin.isTTY) process.stdin.setRawMode(false);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  if (!process.stdin.isTTY) {
    console.error('Error: dashboard requires an interactive terminal (TTY).');
    process.exit(1);
  }

  // Initial load
  let all: QuarantineEntry[];
  try {
    all = await fetchQueue();
  } catch (err) {
    console.error(`Cannot reach PoC server at ${SERVER}.`);
    console.error(`Start it with:  npx tsx scripts/poc/poc-server.ts`);
    console.error(`Error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }

  const state: State = {
    entries: SHOW_ALL ? all : all.filter(e => e.status === 'pending'),
    cursor:  0,
    message: '',
    isError: false,
    loading: false,
  };

  write(HIDE_CURSOR);
  process.on('exit',   cleanup);
  process.on('SIGINT', () => { cleanup(); process.exit(0); });

  // Raw mode for key input
  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf-8');

  renderAll(state);

  process.stdin.on('data', async (raw: string) => {
    const update = await handleKey(raw, state);
    Object.assign(state, update);
    renderAll(state);
  });

  // Refresh on terminal resize
  process.stdout.on('resize', () => renderAll(state));
}

main().catch(err => {
  cleanup();
  console.error('Fatal:', err instanceof Error ? err.message : String(err));
  process.exit(1);
});
