import { Router, type IRouter } from "express";
import healthRouter from "./health";
import cordRouter from "./cord";

const router: IRouter = Router();

router.use(healthRouter);
router.use(cordRouter);

export default router;
