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
  tunnel?: { address: string; expiresAt: string; technology: string };
}

export interface MigrationTunnelSession {
  leaseId: string;
  routerId: number;
  routerName: string;
  technology: "openvpn";
  tunnelAddress: string;
  serverEndpoint: string;
  interfaceName: string;
  scriptUrl: string;
  command: string;
  createdAt: string;
  expiresAt: string;
  status: "issued" | "script_issued" | "connected" | "exported" | "expired" | "revoked" | "server_unavailable";
}

export interface CollectorSession {
  sourceLabel: string;
  token: string;
  scriptUrl: string;
  command: string;
  tunnelScriptUrl?: string;
  tunnelCommand?: string;
  expiresAt: string;
  status: "waiting" | "processing" | "expired" | "exported" | "target_selected" | "dry_run" | "completed" | "failed";
  migrationId?: string;
  summary?: ExportResponse["summary"];
  findings?: ExportResponse["findings"];
  tunnel?: {
    leaseId: string;
    routerId: number;
    address: string;
    technology: string;
    expiresAt: string;
    status: MigrationTunnelSession["status"];
  };
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
