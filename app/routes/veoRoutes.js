const express = require("express");
const router = express.Router();
const veoController = require("../controllers/veoController.js");
const authJwtOrApiKey = require('../middlewares/authJwtOrApiKey.js');

const createRateLimiter = require('../middlewares/rateLimiter.js');

const rateLimiter = createRateLimiter(1000, 15);

// Lấy danh sách cài đặt
router.get("/get-token", authJwtOrApiKey([1, 3]), veoController.getNewToken);


router.get("/token-aval", authJwtOrApiKey([1, 3]), veoController.getTokenAval);

router.post("/create-flow", authJwtOrApiKey([1, 3]), veoController.createVideoVeo3);

router.get("/task-status", authJwtOrApiKey([1, 3]), veoController.getTaskStatus);

router.post("/check-by-pass", authJwtOrApiKey([1, 3]), veoController.checkTokenByPass);

router.get("/get-token-v2", authJwtOrApiKey([1, 3]), veoController.getNewToken);

router.get("/request-hope", authJwtOrApiKey([1, 3]), veoController.getHope);


router.post("/upload-token", authJwtOrApiKey([1, 3]), veoController.addTokenCaptcha);

// Lưu cài đặt


// Image 

module.exports = router;
