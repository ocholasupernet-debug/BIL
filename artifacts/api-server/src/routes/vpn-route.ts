import { Router, type IRouter } from "express";
import { readFileSync, existsSync } from "fs";

const router: IRouter = Router();

const CA_PATHS = [
  "/etc/openvpn/ca.crt",
  "/etc/openvpn/easy-rsa/pki/ca.crt",
];

/* GET /api/vpn/ca.crt — serves the OpenVPN CA certificate for MikroTik import */
router.get("/vpn/ca.crt", (_req, res): void => {
  const caPath = CA_PATHS.find(p => existsSync(p));
  if (!caPath) {
    res.status(404).send(
      "# CA certificate not found on server.\n" +
      "# Run: cd /etc/openvpn/easy-rsa && ./easyrsa build-ca nopass\n"
    );
    return;
  }
  try {
    const cert = readFileSync(caPath, "utf-8");
    res.set("Content-Type", "application/x-pem-file");
    res.set("Content-Disposition", "attachment; filename=ca.crt");
    res.set("Cache-Control", "no-cache");
    res.send(cert);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    res.status(500).send(`# Error reading CA cert: ${msg}\n`);
  }
});

/* GET /api/vpn/status — returns OpenVPN server status */
router.get("/vpn/status", (_req, res): void => {
  const caExists = CA_PATHS.some(p => existsSync(p));
  res.json({
    ca_cert_available: caExists,
    ca_path: CA_PATHS.find(p => existsSync(p)) ?? null,
    server_port: 1194,
    proto: "tcp",
  });
});

export default router;
