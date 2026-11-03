export interface PlatformEmailBranding {
  companyName?: string;
  logoUrl?: string;
  supportEmail?: string;
  supportPhone?: string;
}

type InlineAttachment = {
  filename: string;
  content: Buffer;
  cid: string;
};

const DEFAULT_EMAIL_LOGO_URL = "https://isplatty.com/ocholasupernet-logo.png";

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}

function safeLogo(logoUrl: string | undefined): {
  source: string;
  attachment?: InlineAttachment;
} | null {
  if (!logoUrl || logoUrl.length > 1_000_000) return null;
  const embedded = logoUrl.match(/^data:image\/(png|jpeg|webp);base64,([A-Za-z0-9+/=\r\n]+)$/i);
  if (embedded) {
    const content = Buffer.from(embedded[2].replace(/\s/g, ""), "base64");
    if (!content.length || content.length > 512_000) return null;
    const extension = embedded[1].toLowerCase() === "jpeg" ? "jpg" : embedded[1].toLowerCase();
    const cid = "tenant-brand-logo@bil";
    return {
      source: `cid:${cid}`,
      attachment: {
        filename: `company-logo.${extension}`,
        content,
        cid,
      },
    };
  }
  try {
    const url = new URL(logoUrl);
    if (url.protocol !== "https:" || url.username || url.password) return null;
    return { source: url.toString() };
  } catch {
    return null;
  }
}

function renderText(text: string): string {
  return text.split(/\r?\n/).map((line) => {
    if (!line.trim()) return '<div style="height:8px"></div>';
    let content = escapeHtml(line).replace(
      /\b(\d{6})\b/g,
      '<strong style="font-size:24px;letter-spacing:4px;color:#12335b">$1</strong>',
    );
    content = content.replace(
      /(https:\/\/[^\s<]+)/g,
      '<a href="$1" style="color:#175cd3;word-break:break-word">$1</a>',
    );
    return `<p style="margin:0 0 8px;line-height:1.6;color:#344054">${content}</p>`;
  }).join("");
}

export function buildPlatformEmailHtml(
  text: string,
  branding: PlatformEmailBranding = {},
): { html: string; attachments: InlineAttachment[] } {
  const companyName = (branding.companyName || "OcholaSupernet Billing").trim().slice(0, 120)
    || "OcholaSupernet Billing";
  const logo = safeLogo(branding.logoUrl) ?? safeLogo(DEFAULT_EMAIL_LOGO_URL);
  const supportEmail = branding.supportEmail?.trim();
  const supportPhone = branding.supportPhone?.trim();
  const contact = [
    supportEmail && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(supportEmail)
      ? `<a href="mailto:${escapeHtml(supportEmail)}" style="color:#175cd3">${escapeHtml(supportEmail)}</a>`
      : "",
    supportPhone && /^[+()\d .-]{5,30}$/.test(supportPhone)
      ? `<a href="tel:${escapeHtml(supportPhone)}" style="color:#175cd3">${escapeHtml(supportPhone)}</a>`
      : "",
  ].filter(Boolean).join(" · ");

  const logoMarkup = logo
    ? `<img src="${escapeHtml(logo.source)}" alt="${escapeHtml(companyName)} logo" width="96" style="display:block;max-width:96px;max-height:64px;object-fit:contain;margin:0 0 12px;padding:8px;background:#fff;border-radius:10px">`
    : "";
  const html = `<!doctype html><html><body style="margin:0;background:#f3f6fb;font-family:Arial,Helvetica,sans-serif;color:#182230">
    <div style="padding:28px 12px">
      <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #d7e3f2;border-radius:18px;overflow:hidden;box-shadow:0 12px 32px rgba(16,48,86,.12)">
        <div style="height:7px;background:linear-gradient(90deg,#0879c9 0%,#13b8ca 58%,#ff7a23 100%)"></div>
        <div style="padding:26px 28px 18px;background:linear-gradient(135deg,#10345d 0%,#155b8f 100%)">
          ${logoMarkup}
          <div style="font-size:16px;font-weight:700;letter-spacing:.02em;color:#fff">${escapeHtml(companyName)}</div>
          <div style="margin-top:5px;font-size:12px;color:#c9e6fa">Account and security notification</div>
        </div>
        <div style="padding:26px 28px 30px;font-size:15px">${renderText(text)}</div>
        <div style="padding:18px 28px;background:#f8fafc;border-top:1px solid #e5eaf1;font-size:12px;line-height:1.6;color:#667085">
          ${contact ? `<div style="margin-bottom:5px">${contact}</div>` : ""}
          <div>Sent securely by OcholaSupernet Billing. If you did not request this message, you can ignore it.</div>
        </div>
      </div>
    </div>
  </body></html>`;
  return {
    html,
    attachments: logo?.attachment ? [logo.attachment] : [],
  };
}
