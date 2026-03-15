// Shared TypeScript interfaces, enums, and utility types
// Used across: apps/unix-adaptive-sentinel, apps/l3-api-gateway, packages/host-rpc-server

export {
  HazmatEnvelopeSchema,
  createHazmatEnvelope,
  validateFreshness,
} from './hazmat-envelope.js';

export type { HazmatEnvelope, HazmatEnvelopeShape, IHazmatEnvelope } from './hazmat-envelope.js';

export {
  JournalismReportSchema,
  JsonBeadSchema,
  createJournalismReport,
  BEAD_TYPES,
} from './journalism-report.js';

export type { JournalismReport, JsonBead, BeadType } from './journalism-report.js';
