const { ROLES, User, packs } = require("../models");
const { encryption, compare } = require('../utils/encode');
const { createNewToken } = require('../middlewares/manageToken');
const { Sequelize, Op } = require('sequelize');

// Đăng kí tạo tài khoản
exports.register = async (req, res) => {
    const { name, email, phone, password } = req.body;
    const role = 3; // CUSTOMER

    try {
        // Kiểm tra email đã tồn tại chưa
        let user = await User.findOne({ where: { email } });
        if (user) {
            return res.status(400).json({
                status: 0,
                message: "Email exists",
                data: null,
            });
        }

        // Mã hóa mật khẩu
        const hashedPassword = await encryption(password);

        // Tạo user
        user = await User.create({
            name,
            email,
            phone,
            password: hashedPassword,
            balance: 20,
            role,
        });

        // Auto add pack (Free)
        await packs.create({
            userId: user.id,
            pack: "Free",
            renewal: new Date(), // ngày đăng ký
            expired: 0, // VD: 30 ngày
            status: 1,
        });

        // Response
        res.status(201).json({
            status: 1,
            message: "Register success",
            data: {
                id: user.id,
                name: user.name,
                phone: user.phone,
                email: user.email,
                role: user.role,
            },
        });
    } catch (err) {
        return res.status(500).json({
            status: 0,
            message: "Error services: " + err.message,
            data: null,
        });
    }
};

exports.login = async (req, res) => {
    const { email, password } = req.body;
    try {
        const user = await User.findOne({
            where:
            {
                [Op.or]: [
                    { email: email.trim() },
                    { phone: email.trim() }
                ]
            },
            include: [
                {
                    model: packs,
                    as: "pack",
                    attributes: ["id", "pack", "renewal", "expired"]
                },
            ],
        });
        if (!user) return res.status(400).json({
            success: false,
            message: "Login failed",
            data: null
        });

        const isMatch = await compare(password, user.password);
        if (!isMatch) return res.status(400).json({
            success: false,
            message: "Login failed",
            data: null
        });

        const payload = { id: user.id, role: user.role };
        const token = createNewToken(payload);

        // Xử lý lịch sử đăng nhập
        return res.status(200).json({
            success: true,
            message: "Login success",
            data: {
                id: user.id,
                name: user.name,
                token: token,
                balance: parseInt(user.balance),
                role: user.role
            }
        });
    } catch (err) {
        // Ghi lại lịch sử đăng nhập với trạng thái thất bại
        return res.status(500).json({
            success: false,
            message: "Error services",
            data: null
        });
    }
};

exports.verifyToken = async (req, res) => {
    const userId = req.user.id;
    try {
        const user = await User.findOne({
            where: { id: userId }, // ✅ phải bọc trong where
            include: [
                {
                    model: packs,
                    as: "pack",
                    attributes: ["id", "pack", "renewal", "expired"]
                },
            ],
        });

        const payload = { id: user.id, role: user.role };
        const token = createNewToken(payload);
        if (user) {
            return res.status(200).json({
                success: true,
                data: {
                    balance: parseInt(user.balance),
                    role: user.role,
                    pack: user.pack,
                    token
                }
            });
        } else {
            return res.status(500).json({
                success: false
            });
        }
    } catch (err) {
        return res.status(500).json({
            success: false,
            message: "Error services",
            data: null
        });
    }
};
// admin và giáo viên Tạo tài khoản sinh viên
exports.createUser = async (req, res) => {
    const { name, email, password, phone, role } = req.body;

    try {
        let user = await User.findOne({ where: { email } });
        if (user) return res.status(400).json({
            status: 0,
            message: req.t('errors.emailUsed'),
            data: null
        });

        if ((req.user.role === ROLES.TEACHER || req.user.role === ROLES.ADMIN) && ![ROLES.TEACHER, ROLES.STUDENT].includes(role)) {
            return res.status(403).json({
                status: 0,
                message: req.t('errors.forbidden'),
                data: null
            });
        }

        const hashedPassword = await encryption(password);
        user = await User.create({
            name,
            email,
            phone,
            password: hashedPassword,
            role
        });
        res.status(201).json({
            status: 1,
            message: req.t('success.created'),
            data: {
                id: user.id,
                name: user.name,
                phone: user.phone,
                email: user.email,
                role: user.role
            }
        });
    } catch (err) {
        return res.status(500).json({
            status: 0,
            message: req.t('errors.serverError'),
            data: null
        });
    }
};

// tìm kiếm xem có tài khoản đó không và gửi email

exports.forget = async (req, res) => {
    // ----
    try {
        const { email } = req.body
        const user = await User.findOne({
            where:
            {
                email: {
                    [Op.like]: `%${email}%`
                }
            }
        });
        if (!user) return res.status(404).json({
            success: false,
            message: "Not found account"
        });
        let randomNumber = Math.floor(10000000 + Math.random() * 90000000);
        await user.update({ verify: randomNumber });
        // Tiếp tục
        // sendEmailForget(user.email, user.name, randomNumber)
        return res.status(200).json({
            success: true,
            data: {
                name: user.name,
                email: user.email
            },
            message: "recovery success"
        });
    } catch (error) {
        return res.status(404).json({
            success: false,
            message: "error message"
        });
    }
}
exports.confirm = async (req, res) => {
    // ----
    try {
        const { code, email, new_password } = req.body
        const user = await User.findOne({
            where:
            {
                email: email,
                verify: code
            }
        });
        if (!user) return res.status(404).json({
            success: false,
            message: "wrong code"
        });
        const hashedPassword = await encryption(new_password);
        await user.update({ password: hashedPassword, verify: "" });
        // Tiếp tục
        // sendEmailChangePass(user.email, user.name)
        return res.status(200).json({
            success: true,
            message: "Password changed successfully"
        });
    } catch (error) {
        return res.status(404).json({
            success: false,
            message: "error message"
        });
    }
}
exports.confirmAdmin = async (req, res) => {
    // ----
    try {
        // Chỉ admin mới dùng hàm này
        const { nPassword, id_user } = req.body

        const user = await User.findOne({
            where:
            {
                id: id_user
            }
        });
        if (!user) return res.status(404).json({
            success: false,
            message: "Not found"
        });
        const hashedPassword = await encryption(nPassword);
        await user.update({ password: hashedPassword, verify: "" });
        // Tiếp tục
        // sendEmailChangePass(user.email, user.name)
        return res.status(200).json({
            success: true,
            message: "Password changed successfully"
        });
    } catch (error) {
        return res.status(404).json({
            success: false,
            message: "error message"
        });
    }
}
exports.changePass = async (req, res) => {
    try {
        const { oldPassword, nPassword, id_user } = req.body;

        // Tìm người dùng theo ID
        const user = await User.findOne({
            where: { id: id_user }
        });

        if (!user) {
            return res.status(404).json({
                success: false,
                message: "User does not exist"
            });
        }

        // So sánh mật khẩu cũ
        const isMatch = await compare(oldPassword, user.password);
        if (!isMatch) {
            return res.status(400).json({
                success: false,
                message: "Old password is incorrect"
            });
        }

        // Mã hóa mật khẩu mới
        const hashedPassword = await encryption(nPassword);

        // Cập nhật mật khẩu mới và xóa thông tin xác minh nếu có
        await user.update({ password: hashedPassword, verify: "" });

        // Gửi email thông báo thay đổi mật khẩu
        // sendEmailChangePass(user.email, user.name);

        return res.status(200).json({
            success: true,
            message: "Password changed successfully"
        });
    } catch (error) {
        // console.error("Lỗi khi đổi mật khẩu:", error);
        return res.status(500).json({
            success: false,
            message: "An error occurred during processing."
        });
    }
};
exports.contains = async (req, res) => {
    try {
        const { phone } = req.query;
        const users = await User.findAll({
            where: {
                phone: phone
            }
        });
        if (users.length > 0) {
            res.status(200).json({
                success: false
            });
        } else {
            res.status(200).json({
                success: true
            });
        }
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};



