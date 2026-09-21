const { check } = require('express-validator');

// Quy tắc kiểm tra tên
const checkName = check('name')
  .notEmpty()
  .withMessage((value, { req }) => 'Name not found');

// Quy tắc kiểm tra email
const checkEmail = check('email')
  .isEmail()
  .withMessage((value, { req }) => 'Email not found');

// Quy tắc kiểm tra mật khẩu
const checkPassword = check('password')
  .notEmpty()
  .withMessage((value, { req }) => 'Password empty')
  .isLength({ min: 6 })
  .withMessage((value, { req }) => 'Password too short');

// Quy tắc kiểm tra số điện thoại
const checkPhone = check('phone')
  .notEmpty()
  .withMessage((value, { req }) => 'Phone error')
  .matches(/^[0-9]{10,11}$/)
  .withMessage((value, { req }) => 'Phone error');

module.exports = {
  checkName,
  checkEmail,
  checkPassword,
  checkPhone
};
