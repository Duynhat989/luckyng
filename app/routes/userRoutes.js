const express = require("express");
const router = express.Router();
const userController = require("../controllers/userController");
const auth = require('../middlewares/authMiddleware.js');
const { validate } = require("../middlewares/validation.js");


// Lấy danh sách người dùng
router.get("/users", auth([1]), userController.users);
// 
router.get("/user/me", auth([1,3]), userController.me);
// 
router.post("/user/edit", auth([1,3]), userController.edit);

// cập nhật user

// Tìm người dùng
router.post("/user/find", auth([1]),validate(['id']), userController.find);
// Cập nhật người dùng
router.post("/user/update", auth([1]),validate(['id']), userController.update);
// Xóa người dùng
router.delete("/user/delete", auth([1,3]),validate(['id']), userController.delete);




module.exports = router;
