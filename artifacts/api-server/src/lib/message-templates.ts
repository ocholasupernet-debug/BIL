import { sbSelect } from "./supabase-client.js";

export type MessageChannel = "sms" | "whatsapp" | "email" | "telegram";

export interface MessageTemplate {
  id: string;
  name: string;
  event: string;
  channels: MessageChannel[];
  subject?: string;
  body: string;
  enabled: boolean;
}

export const DEFAULT_MESSAGE_TEMPLATES: MessageTemplate[] = [
  { id: "t1", name: "Plan Activation", event: "customer_activated", channels: ["sms", "whatsapp"], body: "Hello [[name]], your internet plan [[plan]] has been activated. Enjoy browsing! Your plan expires on [[expired_date]]. - [[company]]", enabled: true },
  { id: "t2", name: "Expiry Reminder", event: "plan_expiring", channels: ["sms", "whatsapp", "email"], subject: "Your [[plan]] plan is expiring soon", body: "Dear [[name]], your internet plan [[plan]] (KES [[price]]) will expire on [[expired_date]]. Renew now to avoid disconnection: [[payment_link]]\n\n[[bills]]\n\n- [[company]]", enabled: true },
  { id: "t3", name: "Payment Confirmation", event: "payment_received", channels: ["sms"], body: "Payment of KES [[price]] received for [[plan]]. Thank you [[name]]! Your new expiry date is [[expired_date]]. - [[company]]", enabled: true },
  { id: "t4", name: "Invoice", event: "invoice_generated", channels: ["email"], subject: "Invoice [[invoice]] - [[company]]", body: "Dear [[name]],\n\nPlease find your invoice [[invoice]] for the internet service plan [[plan]].\n\n[[bills]]\n\nPay online: [[payment_link]]\n\nRegards,\n[[company]]", enabled: true },
  { id: "t5", name: "Balance Top-Up", event: "balance_topup", channels: ["sms", "whatsapp"], body: "Hi [[name]], your account has been credited. New balance: KES [[balance]]. Thank you! - [[company]]", enabled: false },
  { id: "t6", name: "Service Disconnection", event: "service_disconnected", channels: ["sms"], body: "Dear [[name]], your plan [[plan]] has expired and service has been disconnected. Renew at [[payment_link]] to reconnect. - [[company]]", enabled: true },
];

interface StoredTemplateRow {
  template_key: string;
  name: string;
  event: string;
  channels: unknown;
  subject: string | null;
  body: string;
  enabled: boolean;
}

const CHANNELS = new Set<MessageChannel>(["sms", "whatsapp", "email", "telegram"]);

function asChannels(value: unknown): MessageChannel[] {
  if (!Array.isArray(value)) return [];
  return value.filter((channel): channel is MessageChannel =>
    typeof channel === "string" && CHANNELS.has(channel as MessageChannel),
  );
}

export function toMessageTemplate(row: StoredTemplateRow): MessageTemplate {
  return {
    id: row.template_key,
    name: row.name,
    event: row.event,
    channels: asChannels(row.channels),
    ...(row.subject ? { subject: row.subject } : {}),
    body: row.body,
    enabled: row.enabled,
  };
}

/** Resolve the tenant's active template at delivery time, with a safe built-in default. */
export async function getMessageTemplate(adminId: number, event: string): Promise<MessageTemplate | null> {
  const rows = await sbSelect<StoredTemplateRow>(
    "isp_message_templates",
    `admin_id=eq.${adminId}&event=eq.${encodeURIComponent(event)}&select=template_key,name,event,channels,subject,body,enabled&limit=1`,
  );
  if (rows[0]) return rows[0].enabled ? toMessageTemplate(rows[0]) : null;
  return DEFAULT_MESSAGE_TEMPLATES.find(template => template.event === event) ?? null;
}

export function renderMessageTemplate(
  template: MessageTemplate,
  variables: Record<string, string | number | null | undefined>,
): { subject?: string; body: string } {
  const render = (value: string) => value.replace(/\[\[([a-z0-9_]+)\]\]/gi, (_match, key: string) => {
    const replacement = variables[key];
    return replacement === null || replacement === undefined ? "" : String(replacement);
  });
  return {
    ...(template.subject ? { subject: render(template.subject) } : {}),
    body: render(template.body),
  };
}