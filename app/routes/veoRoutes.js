const express = require("express");
const router = express.Router();
const veoController = require("../controllers/veoController.js");
const authJwtOrApiKey = require('../middlewares/authJwtOrApiKey.js');



// Lấy danh sách cài đặt
router.get("/get-token", authJwtOrApiKey([1, 3]), veoController.payToken);


router.get("/token-aval", authJwtOrApiKey([1, 3]), veoController.getTokenAval);

router.post("/create-flow", authJwtOrApiKey([1, 3], { countUsage: true }), veoController.createVideoVeo3);

router.get("/task-status", veoController.getTaskStatus)

router.post("/check-by-pass", veoController.checkTokenByPass);

router.get("/request-hope", veoController.getHope);


router.post("/upload-token", veoController.addTokenCaptcha);

// Lưu cài đặt


// Image 

module.exports = router;
