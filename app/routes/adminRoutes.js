const express = require("express");
const router = express.Router();
const auth = require("../middlewares/authMiddleware.js");
const apiKeyController = require("../controllers/apiKeyController.js");
const webhookController = require("../controllers/webhookController.js");

router.use(auth([1]));

router.post("/api-keys", apiKeyController.create);
router.get("/api-keys", apiKeyController.list);
router.patch("/api-keys/:id", apiKeyController.update);
router.delete("/api-keys/:id", apiKeyController.remove);

router.get("/stats/by-user", apiKeyController.statsByUserDay);
router.get("/stats/by-key", apiKeyController.statsByKeyDay);

router.post("/webhooks", webhookController.create);
router.get("/webhooks", webhookController.list);
router.patch("/webhooks/:id", webhookController.update);
router.delete("/webhooks/:id", webhookController.remove);

module.exports = router;
