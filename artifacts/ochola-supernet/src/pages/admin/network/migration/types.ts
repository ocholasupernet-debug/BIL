export interface RouterSummary {
  id: number;
  name: string;
  host: string;
  status: string;
}

export interface AnalyzeResponse {
  compatible: boolean;
  details: string;
  dataPoints: { type: string; count: number }[];
  readOnly: boolean;
  identity: { name?: string; version?: string; boardName?: string };
}

export interface ExportResponse {
  id: string;
  status: string;
  sourceLabel?: string;
  sourceMode?: string;
  summary: { configs: number; users: number; queues: number; pools: number };
  findings: { warnings: string[]; manual: string[]; unsupported: string[] };
}

export interface DryRunResponse {
  success: boolean;
  warnings: string[];
  conflicts: string[];
  plannedChanges: { id: string; category: string; label: string }[];
  skipped: string[];
  approvedItemIds?: string[];
}

export interface ReportResponse {
  success: boolean;
  importedItems: number;
  failedItems: number;
  logs: string[];
  recovery: string;
  recoveryPackage?: {
    migrationId: string;
    targetRouterId?: number;
    capturedAt: string;
    appliedItemIds: string[];
    failedStage: string;
    preChangeState: Record<string, unknown>;
    note: string;
  };
  status: string;
  verification: Record<string, unknown>;
}
