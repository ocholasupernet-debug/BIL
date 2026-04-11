import { Router, type IRouter, type Request, type Response } from "express";
import { sbSelect } from "../lib/supabase-client.js";
import {
  generateToken,
  validateToken,
  extractToken,
  lookupAdmin,
  lookupCustomer,
  type ApiTokenPayload,
} from "../lib/api-auth.js";

const router: IRouter = Router();

const SA_USERNAME = process.env.SUPERADMIN_USERNAME ?? "Latty";
const SA_API_KEY  = process.env.SUPERADMIN_API_KEY  ?? "Latex";
const SA_PASSWORD = process.env.SUPERADMIN_PASSWORD ?? "herina";

router.post("/auth/admin/login", async (req: Request, res: Response): Promise<void> => {
  const { username, password, api_key } = req.body as {
    username?: string; password?: string; api_key?: string;
  };

  if (!username || !password) {
    res.status(400).json({ ok: false, error: "username and password are required" });
    return;
  }

  if (
    username.trim() === SA_USERNAME &&
    password === SA_PASSWORD &&
    (!api_key || api_key.trim() === SA_API_KEY)
  ) {
    const token = generateToken("a", "superadmin");
    res.json({ ok: true, token, role: "superadmin", name: SA_USERNAME });
    return;
  }

  const rows = await sbSelect<Record<string, unknown>>(
    "isp_admins",
    `username=eq.${encodeURIComponent(username.trim())}&select=id,username,password,fullname,role&limit=1`,
  );
  const admin = rows[0];
  if (!admin || admin.password !== password) {
    setTimeout(() => {
      res.status(401).json({ ok: false, error: "Invalid credentials" });
    }, 400);
    return;
  }

  const token = generateToken("a", String(admin.id));
  const { password: _pw, ...safe } = admin;
  res.json({ ok: true, token, admin: safe });
});

router.post("/auth/customer/login", async (req: Request, res: Response): Promise<void> => {
  const { username, password, adminId } = req.body as {
    username?: string; password?: string; adminId?: string;
  };

  if (!username || !password) {
    res.status(400).json({ ok: false, error: "username and password are required" });
    return;
  }

  const idFilter = adminId ? `admin_id=eq.${adminId}&` : "";
  const rows = await sbSelect<Record<string, unknown>>(
    "isp_customers",
    `${idFilter}username=eq.${encodeURIComponent(username.trim())}&select=*&limit=1`,
  );
  const customer = rows[0];

  if (!customer || customer.password !== password) {
    setTimeout(() => {
      res.status(401).json({ ok: false, error: "Invalid credentials" });
    }, 400);
    return;
  }

  if (customer.status === "suspended") {
    res.status(403).json({ ok: false, error: "Account is suspended" });
    return;
  }

  const token = generateToken("c", String(customer.id));
  const { password: _pw, ...safe } = customer;
  res.json({ ok: true, token, customer: safe });
});

router.get("/auth/isValid", (req: Request, res: Response): void => {
  const token = extractToken(req);
  const payload = validateToken(token);

  if (!payload) {
    res.status(401).json({ ok: false, error: "Token is invalid or expired" });
    return;
  }

  const ageSeconds = payload.time === 0 ? 0 : Math.floor(Date.now() / 1000) - payload.time;
  res.json({ ok: true, type: payload.type, uid: payload.uid, ageSeconds });
});

router.get("/auth/me", async (req: Request, res: Response): Promise<void> => {
  const token = extractToken(req);
  const payload = validateToken(token);

  if (!payload) {
    res.status(401).json({ ok: false, error: "Token is invalid or expired" });
    return;
  }

  if (payload.type === "a") {
    const admin = await lookupAdmin(payload.uid);
    if (!admin) {
      res.status(401).json({ ok: false, error: "Admin not found" });
      return;
    }
    res.json({ ok: true, type: "admin", user: admin });
    return;
  }

  if (payload.type === "c") {
    const customer = await lookupCustomer(payload.uid);
    if (!customer) {
      res.status(401).json({ ok: false, error: "Customer not found" });
      return;
    }
    res.json({ ok: true, type: "customer", user: customer });
    return;
  }

  res.status(400).json({ ok: false, error: "Unknown token type" });
});

export default router;
