import { Router, type IRouter } from "express";
import healthRouter from "./health";
import customersRouter from "./customers";
import plansRouter from "./plans";
import vouchersRouter from "./vouchers";
import transactionsRouter from "./transactions";
import routersRouter from "./routers-route";
import syncRouter from "./sync-route";

const router: IRouter = Router();

router.use(healthRouter);
router.use(customersRouter);
router.use(plansRouter);
router.use(vouchersRouter);
router.use(transactionsRouter);
router.use(routersRouter);
router.use(syncRouter);

export default router;
