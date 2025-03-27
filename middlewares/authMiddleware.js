require("dotenv").config();
const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");

// === Middleware สำหรับตรวจสอบ Token หรือ Authorization ===
const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers["authorization"];
  let accessToken = authHeader && authHeader.split(" ")[1];

  if (!accessToken) {
    return res.status(401).json({ error: "Access denied. No token provided." });
  }

  jwt.verify(accessToken, process.env.JWT_SECRET, async (err, user) => {
    if (!err) {
      req.user = user;
      return next(); // ✅ Token is valid, proceed
    }

    if (err.name === "TokenExpiredError") {
      console.log("🔄 Access Token expired. Attempting refresh...");
      console.log("🔎 Headers:", req.headers);
      console.log("🔎 Cookies:", req.cookies);

      const refreshToken =
        req.headers["x-refresh-token"] || req.cookies.refreshToken;

      if (!refreshToken) {
        return res.status(401).json({ error: "Refresh Token required." });
      }

      try {
        // ตรวจสอบ Refresh Token
        const decoded = jwt.verify(
          refreshToken,
          process.env.JWT_REFRESH_SECRET
        );
        const connection = await pool.getConnection();
        const [users] = await connection.execute(
          "SELECT user_id FROM users WHERE user_id = ? AND refresh_token = ?",
          [decoded.userId, refreshToken]
        );
        connection.release();

        if (users.length === 0) {
          return res.status(403).json({ error: "Invalid Refresh Token." });
        }

        // ✅ ออก Access Token ใหม่
        const newAccessToken = jwt.sign(
          { userId: decoded.userId },
          process.env.JWT_SECRET,
          { expiresIn: "30m" }
        );

        console.log("✅ Access Token refreshed successfully.");
        res.setHeader("x-new-access-token", newAccessToken);
        req.user = { userId: decoded.userId };
        return next();
      } catch (refreshError) {
        console.error(
          "❌ Refresh Token invalid or expired:",
          refreshError.message
        );
        return res
          .status(403)
          .json({ error: "Invalid or expired Refresh Token." });
      }
    }

    return res.status(403).json({ error: "Invalid Token." });
  });
};

// refreshAccessToken
const refreshAccessToken = async (req, res) => {
  const { token } = req.body;

  if (!token) {
    return res.status(401).json({ message: "Refresh Token จำเป็นต้องส่งมา" });
  }

  try {
    const decoded = jwt.verify(token, process.env.JWT_REFRESH_SECRET);
    const connection = await pool.getConnection();
    const [users] = await connection.execute(
      "SELECT user_id FROM users WHERE refresh_token = ?",
      [token]
    );

    if (users.length === 0) {
      connection.release();
      return res.status(403).json({ message: "Invalid Refresh Token" });
    }

    const user = users[0];

    // ✅ ออก Refresh Token ใหม่
    const newRefreshToken = jwt.sign(
      { userId: user.user_id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "30d" }
    );

    // ✅ บันทึก Refresh Token ใหม่ลงฐานข้อมูล
    await connection.execute(
      "UPDATE users SET refresh_token = ? WHERE user_id = ?",
      [newRefreshToken, user.user_id]
    );

    connection.release();

    // ✅ ออก Access Token ใหม่
    const newAccessToken = jwt.sign(
      { userId: user.user_id },
      process.env.JWT_SECRET,
      { expiresIn: "30m" }
    );

    res
      .status(200)
      .json({ accessToken: newAccessToken, refreshToken: newRefreshToken });
  } catch (error) {
    console.error("Refresh Token Error:", error);
    res.status(403).json({ message: "Invalid or expired Refresh Token" });
  }
};

module.exports = {
  authenticateToken,
  refreshAccessToken,
};
