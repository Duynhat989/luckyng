const express = require('express');
const authController= require('../controllers/authController');
const router = express.Router();
const { validate } = require('../middlewares/validation.js');
const auth = require('../middlewares/authMiddleware.js');
// Đăng ký Giáo viên mới
router.post('/register',  validate(['email','password']), authController.register);

// Đăng nhập
router.post('/login',  validate(['email', 'password']), authController.login);

// Kiểm tra token
router.get('/verifyToken', auth([1,3]) , authController.verifyToken);

// Quên tài khoản
router.post("/forget",   validate(['email']),authController.forget); 

// Quên tài khoản
router.post("/confirm",   validate(['code']),authController.confirm); 
// Kiểm tra phone
router.get("/contains", authController.contains);


// Đổi mật khẩu bởi admin
router.post("/change", auth([1]),validate(['id_user']), authController.confirmAdmin);



// Đổi mật khẩu bởi admin
router.post("/change-user", auth([1,3]),validate(['id_user']), authController.changePass);
module.exports = router;
