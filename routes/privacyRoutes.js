// backend/routes/privacyRoutes.js
const express = require("express");
const router = express.Router();
const connection = require("../config/db"); // ปรับให้เป็นการเชื่อมต่อฐานข้อมูลของคุณ

router.post("/agree", (req, res) => {
  const { userId } = req.body;

  if (!userId) {
    return res
      .status(400)
      .json({ success: false, message: "User ID is required" });
  }

  connection.query(
    "UPDATE users SET agreed_to_privacy = ? WHERE id = ?",
    [true, userId],
    (err) => {
      if (err) {
        return res
          .status(500)
          .json({ success: false, message: "Server error" });
      }
      return res
        .status(200)
        .json({ success: true, message: "Privacy policy consent updated" });
    }
  );
});

module.exports = router;
