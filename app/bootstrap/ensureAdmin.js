const { User, ROLES } = require("../models/userModel");
const { packs } = require("../models/packModel");
const { encryption } = require("../utils/encode");

async function ensureDefaultAdmin() {
  const email = (process.env.EMAILADMIN || process.env.ADMIN_EMAIL || "").trim();
  const password = process.env.PASSWORDADMIN || process.env.ADMIN_PASSWORD;

  if (!email || !password) {
    console.warn("[bootstrap] Thiếu EMAILADMIN/PASSWORDADMIN — không tạo admin mặc định.");
    return;
  }

  const adminCount = await User.count({ where: { role: ROLES.ADMIN } });
  if (adminCount > 0) {
    return;
  }

  const existing = await User.findOne({ where: { email } });
  const hashedPassword = await encryption(password);

  if (existing) {
    await existing.update({
      role: ROLES.ADMIN,
      password: hashedPassword,
      status: 1,
    });
    console.log(`[bootstrap] Đã nâng quyền admin cho ${email}`);
    return;
  }

  const name = email.split("@")[0] || "Admin";
  const user = await User.create({
    name,
    email,
    password: hashedPassword,
    role: ROLES.ADMIN,
    balance: 0,
    status: 1,
  });

  await packs.create({
    userId: user.id,
    pack: "Free",
    renewal: new Date(),
    expired: 0,
    status: 1,
  });

  console.log(`[bootstrap] Đã tạo tài khoản admin: ${email}`);
}

module.exports = { ensureDefaultAdmin };
