const express = require("express");
const router = express.Router();
const setupController = require("../controllers/setupController.js");
const auth = require('../middlewares/authMiddleware.js');

// Lấy danh sách cài đặt
router.get("/setup", auth([1]), setupController.getAllSetup);

// Lưu cài đặt
router.post("/setup/save",setupController.saveAllSetup);


router.get("/setup/status", setupController.getStatus);


router.get("/setup/payment", setupController.getPayment);
// api get setup 


module.exports = router;
