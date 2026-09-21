const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware.js");
const apiKeyController = require("../controllers/apiKeyController.js");

router.use(auth([1]));

router.post("/api-keys", apiKeyController.create);
router.get("/api-keys", apiKeyController.list);
router.patch("/api-keys/:id", apiKeyController.update);
router.delete("/api-keys/:id", apiKeyController.remove);

router.get("/stats/by-user", apiKeyController.statsByUserDay);
router.get("/stats/by-key", apiKeyController.statsByKeyDay);

module.exports = router;
