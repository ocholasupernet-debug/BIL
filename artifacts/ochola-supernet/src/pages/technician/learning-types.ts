export type TechnicianGuideCategory =
  | "setup" | "ports" | "wireless" | "recovery" | "connectivity" | "fiber" | "customer-care";

export type TechnicianDiagram = {
  kind: "router-ports" | "pon-leds" | "connection-path" | "decision-tree" | "wifi-coverage";
  caption: string;
  labels: string[];
};

export type TechnicianGuideStep = {
  title: string;
  instruction: string;
  check?: string;
  caution?: string;
};

export type TechnicianLearningGuide = {
  id: string;
  slug: string;
  title: string;
  summary: string;
  category: TechnicianGuideCategory;
  brands: string[];
  models: string[];
  firmwareNotes: string;
  symptomTags: string[];
  likelyCauses: string[];
  safeChecks: string[];
  escalateWhen: string[];
  warnings: string[];
  steps: TechnicianGuideStep[];
  diagrams: TechnicianDiagram[];
  imageUrl: string | null;
  imageCaption: string;
  customerScript: string;
  manualUrl: string | null;
  status: "draft" | "published" | "archived";
  updatedAt: string;
};

export type TechnicianDeviceModel = {
  id: string;
  brand: string;
  model: string;
  deviceType: string;
  hardwareRevisions: string[];
  firmwareVariants: string[];
  notes: string;
  warning: string;
  manualUrl: string | null;
  imageUrl: string | null;
  imageCaption: string;
  diagram: TechnicianDiagram | null;
  status: "draft" | "published" | "archived";
  updatedAt: string;
};
