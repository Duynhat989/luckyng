const express = require("express");
const router = express.Router();
const apiv3Controller = require("../controllers/apiv3Controller.js");
const authV3ApiKey = require("../middlewares/authV3ApiKey.js");
const createRateLimiter = require("../middlewares/rateLimiter.js");

const rateLimiter = createRateLimiter(1000, 50);

router.post("/images/create", authV3ApiKey([1, 3]), rateLimiter, apiv3Controller.imageFlow);
router.post("/images/upscale", authV3ApiKey([1, 3]), rateLimiter, apiv3Controller.upscaleImageFlow);
router.post("/videos/create", authV3ApiKey([1, 3]), rateLimiter, apiv3Controller.videoFlow);
router.post("/videos/upscale", authV3ApiKey([1, 3]), rateLimiter, apiv3Controller.upscaleVideoFlow);
router.post("/enhance-photo", authV3ApiKey([1, 3]), rateLimiter, apiv3Controller.enhancePhotoVer);
router.get("/task", authV3ApiKey([1, 3]), apiv3Controller.getTask);

module.exports = router;
