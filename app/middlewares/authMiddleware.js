const { getPayloadToken } = require('../middlewares/manageToken');

const auth = (roles = []) => {
  return (req, res, next) => {
    if (typeof roles === 'number') {
      roles = [roles];
    }
    const authHeader = req.headers['authorization']
    const token = authHeader && authHeader.split(' ')[1]
    if (!token) {
      return res.status(401).json({ message: "Not login" });
    }

    try {
      const decoded = getPayloadToken(token);
      req.user = decoded;
      // console.log(req.user)
      if (roles.length && !roles.includes(req.user.role)) {
        // Vai trò không được phép
        return res.status(403).json({ message: 'Not forbidden' });
      }

      next();
    } catch (err) {
      return res.status(401).json({ message: 'invalidToken' });
    }
  };
};

module.exports = auth;
