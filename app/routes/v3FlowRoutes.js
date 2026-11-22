const express = require("express");
const router = express.Router();
const apiv3Controller = require("../controllers/apiv3Controller.js");
const authV3ApiKey = require("../middlewares/authV3ApiKey.js");
const createRateLimiter = require("../middlewares/rateLimiter.js");

const rateLimiter = createRateLimiter(1000, 500);
const authV3Count = authV3ApiKey([1, 3], { countUsage: true });

router.post("/images/create", authV3Count, rateLimiter, apiv3Controller.imageFlow);
router.post("/images/upscale", authV3Count, rateLimiter, apiv3Controller.upscaleImageFlow);
router.post("/videos/create", authV3Count, rateLimiter, apiv3Controller.videoFlow);
router.post("/videos/upscale", authV3Count, rateLimiter, apiv3Controller.upscaleVideoFlow);
router.get("/task", apiv3Controller.getTask);

module.exports = router;
