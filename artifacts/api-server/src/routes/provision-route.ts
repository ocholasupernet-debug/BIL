import { Router, type IRouter } from "express";
import { exec } from "child_process";

const router: IRouter = Router();

router.post("/isp/provision", (req, res) => {
  const { slug } = req.body as { slug?: string };

  if (!slug || !/^[a-z0-9-]+$/.test(slug)) {
    res.status(400).json({ error: "Invalid slug" });
    return;
  }

  const script = "/usr/local/bin/ols-provision-subdomain.sh";

  exec(`bash ${script} ${slug}`, { timeout: 30000 }, (err, stdout, stderr) => {
    if (err) {
      console.error(`[provision] failed for ${slug}:`, stderr || err.message);
      res.status(500).json({ error: "Provisioning failed", detail: stderr });
      return;
    }
    console.log(`[provision] ${slug}: ${stdout.trim()}`);
    res.json({ ok: true, slug, output: stdout.trim() });
  });
});

export default router;
