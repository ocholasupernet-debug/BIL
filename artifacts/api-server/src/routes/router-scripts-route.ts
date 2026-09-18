import { Router, type IRouter, type Request, type Response } from "express";
import {
  compileCoreBootstrap,
  compileRouterScript,
  type CoreBootstrapOptions,
  type RouterScriptCompilerOptions,
  type ScriptProfile,
} from "../lib/script-compiler.js";
import { requireAdmin } from "../lib/api-auth.js";

const router: IRouter = Router();

function isProfile(value: unknown): value is ScriptProfile {
  return value === "greenfield" || value === "brownfield";
}

function parseOptions(value: unknown): RouterScriptCompilerOptions {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Compiler options are required.");
  }
  const options = value as Record<string, unknown>;
  if (typeof options.radiusAddress !== "string" || typeof options.radiusSecret !== "string") {
    throw new Error("radiusAddress and radiusSecret are required.");
  }
  return {
    bridgeName: typeof options.bridgeName === "string" ? options.bridgeName : undefined,
    bridgeAddress: typeof options.bridgeAddress === "string" ? options.bridgeAddress : undefined,
    radiusAddress: options.radiusAddress,
    radiusSecret: options.radiusSecret,
    radiusIncomingPort: typeof options.radiusIncomingPort === "number" ? options.radiusIncomingPort : undefined,
    dualServices: Array.isArray(options.dualServices) ? options.dualServices as RouterScriptCompilerOptions["dualServices"] : undefined,
    resellerQueues: Array.isArray(options.resellerQueues) ? options.resellerQueues as RouterScriptCompilerOptions["resellerQueues"] : undefined,
  };
}

/**
 * Compile an explicit RouterOS bundle for an authenticated administrator.
 * This endpoint deliberately uses one buffered response so RouterOS receives
 * one complete text document rather than a stream of partial chunks.
 */
router.post("/router-scripts/compile", requireAdmin(), (req: Request, res: Response): void => {
  try {
    const profile = req.body?.profile;
    if (!isProfile(profile)) {
      res.status(400).json({ ok: false, error: "profile must be greenfield or brownfield." });
      return;
    }
    const script = compileRouterScript(profile, parseOptions(req.body?.options));
    res
      .setHeader("Content-Type", "text/plain; charset=utf-8")
      .setHeader("Content-Disposition", `attachment; filename="ochola-${profile}.rsc"`)
      .setHeader("Cache-Control", "no-store")
      .send(script);
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not compile RouterOS script.",
    });
  }
});

router.post("/router-scripts/core-bootstrap", requireAdmin(), (req: Request, res: Response): void => {
  try {
    const options = req.body?.options;
    if (!options || typeof options !== "object" || Array.isArray(options)) {
      res.status(400).json({ ok: false, error: "Core bootstrap options are required." });
      return;
    }
    const script = compileCoreBootstrap(options as CoreBootstrapOptions);
    res
      .setHeader("Content-Type", "text/plain; charset=utf-8")
      .setHeader("Content-Disposition", 'attachment; filename="ocholasupernet-core-bootstrap.rsc"')
      .setHeader("Cache-Control", "no-store")
      .send(script);
  } catch (error) {
    res.status(400).json({
      ok: false,
      error: error instanceof Error ? error.message : "Could not compile the core bootstrap script.",
    });
  }
});

export default router;