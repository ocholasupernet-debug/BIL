import assert from "node:assert/strict";
import { test } from "node:test";
import { buildPlatformEmailHtml } from "./platform-email-html.js";

test("branded email includes the company logo and saved support contacts", () => {
  const image = Buffer.from("test-logo").toString("base64");
  const rendered = buildPlatformEmailHtml(
    "Your verification code is 123456.\nIt expires in five minutes.",
    {
      companyName: "Ochola & Co",
      logoUrl: `data:image/png;base64,${image}`,
      supportEmail: "help@example.com",
      supportPhone: "+254 700 123 456",
    },
  );

  assert.match(rendered.html, /Ochola &amp; Co/);
  assert.match(rendered.html, /cid:tenant-brand-logo@bil/);
  assert.match(rendered.html, /123456/);
  assert.match(rendered.html, /mailto:help@example\.com/);
  assert.match(rendered.html, /tel:\+254 700 123 456/);
  assert.equal(rendered.attachments.length, 1);
  assert.equal(rendered.attachments[0].cid, "tenant-brand-logo@bil");
});

test("unsafe or malformed logo sources are not embedded", () => {
  for (const logoUrl of [
    "http://example.com/logo.png",
    "javascript:alert(1)",
    "data:image/svg+xml;base64,PHN2Zz4=",
    `data:image/png;base64,${"A".repeat(700_000)}`,
  ]) {
    const rendered = buildPlatformEmailHtml("Your code is 654321.", {
      logoUrl,
      companyName: "Example ISP",
    });
    assert.match(rendered.html, /<img\b/);
    assert.match(rendered.html, /https:\/\/isplatty\.com\/ocholasupernet-logo\.png/);
    assert.equal(rendered.attachments.length, 0);
  }
});

test("email content is escaped and remote logos require HTTPS", () => {
  const rendered = buildPlatformEmailHtml("<script>alert(1)</script>", {
    logoUrl: "https://cdn.example.com/isp-logo.png",
  });
  assert.match(rendered.html, /https:\/\/cdn\.example\.com\/isp-logo\.png/);
  assert.match(rendered.html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(rendered.html, /<script>/);
  assert.equal(rendered.attachments.length, 0);
});
