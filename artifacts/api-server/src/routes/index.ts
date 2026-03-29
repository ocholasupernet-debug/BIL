import { Router, type IRouter } from "express";
import healthRouter from "./health";
import customersRouter from "./customers";
import plansRouter from "./plans";
import vouchersRouter from "./vouchers";
import transactionsRouter from "./transactions";
import routersRouter from "./routers-route";
import syncRouter from "./sync-route";
import scriptsRouter from "./scripts-route";
import vpnRouter from "./vpn-route";
import provisionRouter from "./provision-route";
import routerEnsureRouter from "./router-ensure-route";
import mikrotikRouter from "./mikrotik-route";

const router: IRouter = Router();

router.use(healthRouter);
router.use(customersRouter);
router.use(plansRouter);
router.use(vouchersRouter);
router.use(transactionsRouter);
router.use(routersRouter);
router.use(syncRouter);
router.use(scriptsRouter);
router.use(vpnRouter);
router.use(provisionRouter);
router.use(routerEnsureRouter);
router.use(mikrotikRouter);

export default router;
