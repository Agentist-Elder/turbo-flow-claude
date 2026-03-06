export interface QuarantineEntry {
  id: string;
  fingerprint: string;
  preview: string;
  attackType: string;
  coreIntent: string;
  recommendation: string;
  confidence: number;
  receivedAt: string;
  variantCount: number;
  status: 'pending' | 'approved' | 'discarded';
  surgeonSource: string;
}

export interface Stats {
  cache: {
    size: number;
    totalChecks: number;
    totalHits: number;
    hitRate: string;
  };
  quarantine: {
    total: number;
    pending: number;
    approved: number;
    discarded: number;
  };
  approvedSet: {
    size: number;
  };
}

export type FilterKey = 'all' | 'pending' | 'approved' | 'discarded';
