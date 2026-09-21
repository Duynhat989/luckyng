const { User, packs } = require("../models");
const { Op } = require('sequelize');

// Lấy danh sách tất cả học sinh
exports.users = async (req, res) => {
    const { page = 1, limit = 10, search = "", pack = "" } = req.query;
    const offset = (parseInt(page) - 1) * parseInt(limit);

    try {
        // Điều kiện tìm kiếm chung
        let userWhere = {};
        // Nếu có search >= 3 ký tự thì lọc theo name/email/phone
        if (search && search.length > 2) {
            userWhere = {
                [Op.or]: [
                    { name: { [Op.like]: `%${search}%` } },
                    { email: { [Op.like]: `%${search}%` } },
                    { phone: { [Op.like]: `%${search}%` } },
                ],
            };
        }

        // Điều kiện pack
        let packWhere = {};
        if (pack) {
            packWhere = {
                pack: pack
            }
        }
        const users = await User.findAndCountAll({
            where: userWhere,
            include: [
                {
                    model: packs,
                    as: "pack",
                    where: packWhere,
                    required: !!pack,
                    attributes: ["id", "pack", "renewal", "expired"]
                },
            ],
            attributes: [
                "id",
                "name",
                "phone",
                "email",
                "role",
                "balance",
                "createdAt",
            ],
            order: [["createdAt", "DESC"]],
            limit: parseInt(limit),
            offset: offset,
        });

        res.status(200).json({
            success: true,
            message: "Success",
            data: users.rows,
            total: users.count,
            page: parseInt(page),
            limit: parseInt(limit),
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
exports.me = async (req, res) => {
    try {
        const user_id = req.user.id
        const users = await User.findAll({
            where: {
                id: user_id
            },
            include: [
                {
                    model: packs,
                    as: "pack",
                    attributes: ["id", "pack", "renewal", "expired"]
                },
            ],
            attributes: ['id', 'name', 'phone', 'email', 'role', 'createdAt'],
            order: [["createdAt", "DESC"]],
        });
        res.status(200).json({
            success: true,
            data: users[0]
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
exports.edit = async (req, res) => {
    try {
        const { name, phone, email } = req.body;
        const user_id = req.user.id
        // Tìm người dùng theo ID
        const user = await User.findByPk(user_id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Cập nhật thông tin người dùng
        user.name = name || user.name;
        user.phone = phone || user.phone;
        user.email = email || user.email;

        // Lưu thay đổi
        await user.save();

        res.status(200).json({
            success: true,
            message: "Update success",
            data: {
                id: user.id,
                name: user.name,
                phone: user.phone,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
exports.find = async (req, res) => {
    try {
        const { id } = req.body
        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        res.status(200).json({
            success: true,
            message: `Update success.`,
            data: {
                id: user.id,
                name: user.name,
                phone: user.phone,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
exports.update = async (req, res) => {
    try {
        const { id, name, phone, email, role, balance, pack } = req.body;

        // Tìm người dùng theo ID
        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }

        // Cập nhật thông tin người dùng
        user.name = name || user.name;
        user.phone = phone || user.phone;
        user.email = email || user.email;
        user.role = role || user.role;
        user.balance = balance || user.balance;
        await user.save();

        const packItem = await packs.findOne({
            where: { userId: user.id }
        });

        if (!packItem) {
            return res.status(404).json({ success: false, message: "Pack not found" });
        }

        // Chỉ cập nhật khi có giá trị từ pack (null/undefined thì bỏ qua)
        packItem.expired = pack?.expired ?? packItem.expired;
        packItem.pack = pack?.pack ?? packItem.pack;
        packItem.renewal = pack?.renewal ?? packItem.renewal;

        await packItem.save();

        console.log(pack)
        
        res.status(200).json({
            success: true,
            message: "Update success",
            data: {
                id: user.id,
                name: user.name,
                phone: user.phone,
                email: user.email,
                role: user.role
            }
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
exports.delete = async (req, res) => {
    try {
        const { id } = req.body;

        // Tìm người dùng theo ID
        const user = await User.findByPk(id);
        if (!user) {
            return res.status(404).json({ success: false, message: "User not found" });
        }
        await packs.destroy({ where: { userId: user.id } });
        await user.destroy();

        res.status(200).json({
            success: true,
            message: "Delete success"
        });
    } catch (error) {
        res.status(500).json({ success: false, message: error.message });
    }
};
