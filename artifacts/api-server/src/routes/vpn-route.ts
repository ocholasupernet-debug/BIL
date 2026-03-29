import { Router, type IRouter } from "express";
import { readFileSync, existsSync } from "fs";
import { execSync } from "child_process";

const router: IRouter = Router();

const SUPABASE_URL = process.env.SUPABASE_URL ?? process.env.VITE_SUPABASE_URL ?? "";
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY || process.env.VITE_SUPABASE_KEY || "";

const CA_PATHS = [
  "/etc/openvpn/ca.crt",
  "/etc/openvpn/easy-rsa/pki/ca.crt",
];
const EASYRSA_DIR = "/etc/openvpn/easy-rsa";
const PKI_ISSUED  = `${EASYRSA_DIR}/pki/issued`;
const PKI_PRIVATE = `${EASYRSA_DIR}/pki/private`;

function slugify(name: string): string {
  return name.toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9-]/g, "");
}

/* Generate a client certificate (nopass) using easy-rsa.
   No-ops if the cert already exists. Returns true on success. */
export function ensureClientCert(slug: string): boolean {
  const certPath = `${PKI_ISSUED}/${slug}.crt`;
  const keyPath  = `${PKI_PRIVATE}/${slug}.key`;
  if (existsSync(certPath) && existsSync(keyPath)) return true;
  if (!existsSync(`${EASYRSA_DIR}/easyrsa`)) return false;
  try {
    execSync(
      `cd ${EASYRSA_DIR} && ./easyrsa --batch build-client-full "${slug}" nopass`,
      { stdio: "pipe", timeout: 60_000 }
    );
    return existsSync(certPath) && existsSync(keyPath);
  } catch {
    return false;
  }
}

async function slugBySecret(secret: string): Promise<string | null> {
  if (!SUPABASE_URL || !SUPABASE_KEY || !secret) return null;
  try {
    const res = await fetch(
      `${SUPABASE_URL}/rest/v1/isp_routers?router_secret=eq.${encodeURIComponent(secret)}&select=name&limit=1`,
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as { name: string }[];
    return rows.length ? slugify(rows[0].name) : null;
  } catch {
    return null;
  }
}

/* ── GET /api/vpn/ca.crt ── serves CA cert (public) */
router.get("/vpn/ca.crt", (_req, res): void => {
  const caPath = CA_PATHS.find(p => existsSync(p));
  if (!caPath) { res.status(404).send("# CA cert not found\n"); return; }
  res.set("Content-Type", "text/plain");
  res.set("Cache-Control", "no-cache");
  res.send(readFileSync(caPath, "utf-8"));
});

/* ── GET /api/vpn/client-cert/:secret/ca.crt
       GET /api/vpn/client-cert/:secret/client.crt
       GET /api/vpn/client-cert/:secret/client.key

   Protected by the per-router routerSecret embedded in the .rsc.
   Returns the CA cert, per-router TLS client cert, or private key. ── */
router.get("/vpn/client-cert/:secret/:file", async (req, res): Promise<void> => {
  const { secret, file } = req.params;

  const slug = await slugBySecret(secret);
  if (!slug) { res.status(404).send("# Router not found\n"); return; }

  if (file === "ca.crt") {
    const caPath = CA_PATHS.find(p => existsSync(p));
    if (!caPath) { res.status(404).send("# CA not found\n"); return; }
    res.set("Content-Type", "text/plain");
    res.set("Cache-Control", "no-cache");
    res.send(readFileSync(caPath, "utf-8"));
    return;
  }

  if (file === "client.crt" || file === "client.key") {
    const ok = ensureClientCert(slug);
    if (!ok) {
      res.status(500).send("# Cert generation failed — easy-rsa may not be installed\n");
      return;
    }
    const filePath = file === "client.crt"
      ? `${PKI_ISSUED}/${slug}.crt`
      : `${PKI_PRIVATE}/${slug}.key`;
    if (!existsSync(filePath)) { res.status(404).send("# Cert file missing\n"); return; }
    res.set("Content-Type", "text/plain");
    res.set("Cache-Control", "no-cache");
    res.send(readFileSync(filePath, "utf-8"));
    return;
  }

  res.status(400).send("# Unknown file. Use: ca.crt | client.crt | client.key\n");
});

/* ── GET /api/vpn/status ── */
router.get("/vpn/status", (_req, res): void => {
  const caExists = CA_PATHS.some(p => existsSync(p));
  res.json({ ca_cert_available: caExists, server_port: 1194, proto: "tcp" });
});

export default router;
