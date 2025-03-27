// authController.js
const bcrypt = require("bcryptjs");
const jwt = require("jsonwebtoken");
const { pool } = require("../config/db");
const crypto = require("crypto");
const nodemailer = require("nodemailer");
require("dotenv").config();

// register function
const register = async (req, res) => {
  console.log("Users Req Data: ", req.body);
  const { userName, email, password, phoneNumber, role, privacy } = req.body;

  if (!userName || !password) {
    return res
      .status(400)
      .json({ success: false, message: "Missing username or password" });
  }

  try {
    const connection = await pool.getConnection(); // Use pool to connect to the database

    // Check if user already exists
    const [existingUsers] = await connection.execute(
      "SELECT * FROM users WHERE LOWER(username) = LOWER(?)",
      [userName]
    );

    if (existingUsers.length > 0) {
      connection.release(); // Release connection back to the pool
      return res
        .status(409)
        .json({ success: false, message: "User already exists" });
    }

    // Check if email already exists
    const [existingEmail] = await connection.execute(
      "SELECT * FROM users WHERE LOWER(email) = LOWER(?)",
      [email]
    );

    if (existingEmail.length > 0) {
      connection.release(); // Release connection back to the pool
      return res
        .status(409)
        .json({ success: false, message: "Email already exists" });
    }

    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);

    // Insert new user
    const [result] = await connection.execute(
      "INSERT INTO users (username, email, password, phoneNumber, role, privacy) VALUES (?, ?, ?, ?, ?, ?)",
      [userName, email, hashedPassword, phoneNumber, role, privacy]
    );

    const userId = result.insertId; // Get the newly inserted user's ID

    connection.release(); // Release connection back to the pool

    // Create JWT token
    const token = jwt.sign(
      {
        userId,
        userName,
        email,
        phoneNumber,
        role,
      },
      process.env.JWT_SECRET,
      {
        expiresIn: "30m",
      }
    );

    const refreshToken = jwt.sign({ userId }, process.env.JWT_REFRESH_SECRET, {
      expiresIn: "30d",
    });

    await connection.execute(
      "UPDATE users SET refresh_token = ? WHERE user_id = ?",
      [refreshToken, userId]
    );

    return res.status(201).json({
      success: true,
      message: "Registration successful",
      token,
      refreshToken,
      userId,
      userName,
      email,
      phoneNumber,
      role,
    });
  } catch (error) {
    console.error("Error during registration:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// login function
const login = async (req, res) => {
  const { userNameOrEmail, password } = req.body;

  if (!userNameOrEmail || !password) {
    return res.status(400).json({
      success: false,
      message: "Missing username/email or password",
    });
  }

  // console.log("📥 ข้อมูลที่ได้รับจาก Postman:", req.body); // ✅ ตรวจสอบค่าที่ได้รับ

  try {
    const connection = await pool.getConnection();
    const [results] = await connection.execute(
      "SELECT * FROM users WHERE LOWER(userName) = LOWER(?) OR LOWER(email) = LOWER(?)",
      [userNameOrEmail, userNameOrEmail]
    );

    if (results.length === 0) {
      connection.release();
      return res.status(401).json({
        success: false,
        message: "Invalid username/email or password",
      });
    }

    const user = results[0];

    // ตรวจสอบรหัสผ่าน
    const match = await bcrypt.compare(password, user.password);
    if (!match) {
      connection.release();
      return res.status(401).json({
        success: false,
        message: "Invalid username/email or password",
      });
    }

    // ✅ สร้าง Access Token & Refresh Token
    const token = jwt.sign({ userId: user.user_id }, process.env.JWT_SECRET, {
      expiresIn: "30m",
    });

    const refreshToken = jwt.sign(
      { userId: user.user_id },
      process.env.JWT_REFRESH_SECRET,
      { expiresIn: "30d" }
    );

    await connection.execute(
      "UPDATE users SET refresh_token = ? WHERE user_id = ?",
      [refreshToken, user.user_id]
    );

    connection.release();
    return res.status(200).json({
      success: true,
      message: "Login successful",
      token,
      refreshToken,
      user: {
        userId: user.user_id,
        userName: user.userName,
        email: user.email,
        phoneNumber: user.phoneNumber,
        role: user.role,
      },
    });
  } catch (error) {
    console.error("Error during login:", error);
    return res.status(500).json({
      success: false,
      message: "Internal server error",
    });
  }
};

// logout
const logout = async (req, res) => {
  const { refreshToken, user_id } = req.body;
  console.log("refreshToken: ", refreshToken);
  console.log("user_id: ", user_id);

  try {
    const connection = await pool.getConnection();

    // 🔍 ตรวจสอบว่า Refresh Token มีอยู่จริงหรือไม่
    const [rows] = await connection.execute(
      "SELECT refresh_token FROM users WHERE refresh_token = ?",
      [refreshToken]
    );

    // ✅ ถ้าไม่พบ Refresh Token หรือเป็น NULL ให้คืนค่า 200 OK
    if (rows.length === 0 || rows[0].refresh_token === null) {
      console.log("⚠️ ไม่พบ Refresh Token หรือเป็น NULL, ออกจากระบบสำเร็จ");
      connection.release();
      return res
        .status(200)
        .json({ message: "ออกจากระบบสำเร็จ (ไม่มี Refresh Token อยู่แล้ว)" });
    }

    // ✅ ล้างค่า refresh_token
    await connection.execute(
      "UPDATE users SET refresh_token = NULL WHERE refresh_token = ?",
      [refreshToken]
    );

    // // ✅ ล้างค่า expo_push_token
    // await connection.execute(
    //   "UPDATE expo_tokens SET expo_push_token = NULL WHERE user_id = ?",
    //   [user_id]
    // );

    connection.release();
    res.status(200).json({ message: "ออกจากระบบสำเร็จ" });
  } catch (error) {
    console.error("Logout error:", error);
    res.status(500).json({ message: "เกิดข้อผิดพลาดของเซิร์ฟเวอร์" });
  }
};

//  Forget Password
const forgetPassword = async (req, res) => {
  const { email } = req.body;

  if (!email) {
    return res.status(400).json({ success: false, message: "Missing email" });
  }

  try {
    const connection = await pool.getConnection();

    // ตรวจสอบว่าอีเมลมีอยู่ในระบบหรือไม่
    const [users] = await connection.execute(
      "SELECT user_id, userName FROM users WHERE email = ?",
      [email]
    );

    if (users.length === 0) {
      connection.release();
      return res
        .status(404)
        .json({ success: false, message: "Email not found" });
    }

    const user = users[0];

    // สร้างโทเค็นสำหรับรีเซ็ตรหัสผ่าน
    const resetToken = crypto.randomBytes(32).toString("hex");
    const resetTokenExpire = new Date(Date.now() + 60 * 60 * 1000);

    // บันทึก Token ลงในฐานข้อมูล
    await connection.execute(
      "UPDATE users SET reset_token = ?, reset_token_expire = ? WHERE user_id = ?",
      [resetToken, resetTokenExpire, user.user_id]
    );

    connection.release();

    // ส่งอีเมลรีเซ็ตรหัสผ่าน
    const transporter = nodemailer.createTransport({
      service: "gmail",
      auth: {
        user: process.env.EMAIL_USER,
        pass: process.env.EMAIL_PASS,
      },
    });

    // const resetLink = `${process.env.EXPO_DEV_URL}/--/resetPassword?token=${resetToken}`; // For Test
    // const resetLink = `dekdek://reset-password?token=${resetToken}`; // Custome
    const resetLink = `https://senior-test-deploy-production-1362.up.railway.app/reset-password?token=${resetToken}`; // สำหรับ Mobile App
    const mailOptions = {
      from: "DekDek App",
      to: email,
      subject: "Reset Password",
      text: `สวัสดีค่ะ คุณ ${user.userName},\n\nคุณได้กดส่งคำขอเพื่อเปลี่ยนรหัสผ่านใหม่เมื่อสักครู่นี้ \n\nกรุณาคลิกที่ลิ้งด้านล่างเพื่อเปลี่ยนรหัสผ่านของคุณ:\n${resetLink}\n\nลิ้งนี้จะหมดอายุภายใน 1 ชั่วโมง\n\nหากคุณไม่ได้กดขอตั้งค่ารหัสผ่านใหม่ด้วยตนเอง หรือต้องการความช่วยเหลือเพิ่มเติม กรุณาติดต่อศูนย์บริการลูกค้าของเรา\n\nขอบคุณค่ะ\nDekDek Team`,
    };

    await transporter.sendMail(mailOptions);

    res.status(200).json({
      success: true,
      message: "Reset password email sent successfully",
    });
  } catch (error) {
    console.error("Error in forgot password:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

// ฟังก์ชัน Reset Password
const resetPassword = async (req, res) => {
  const { token, newPassword } = req.body;

  if (!token || !newPassword) {
    return res
      .status(400)
      .json({ success: false, message: "Missing token or new password" });
  }

  try {
    const connection = await pool.getConnection();

    // ✅ ตรวจสอบว่า Token ยังไม่หมดอายุ
    const [users] = await connection.execute(
      "SELECT user_id FROM users WHERE reset_token = ? AND reset_token_expire > NOW()",
      [token]
    );

    if (users.length === 0) {
      connection.release();
      return res
        .status(400)
        .json({ success: false, message: "Invalid or expired token" });
    }

    const user = users[0];

    // ✅ เข้ารหัสรหัสผ่านใหม่
    const hashedPassword = await bcrypt.hash(newPassword, 10);

    // ✅ อัปเดตรหัสผ่านใหม่ และล้าง Token
    await connection.execute(
      "UPDATE users SET password = ?, reset_token = NULL, reset_token_expire = NULL WHERE user_id = ?",
      [hashedPassword, user.user_id]
    );

    connection.release();

    res
      .status(200)
      .json({ success: true, message: "Password reset successfully" });
  } catch (error) {
    console.error("Error in reset password:", error);
    return res.status(500).json({ success: false, message: "Server error" });
  }
};

module.exports = { register, login, forgetPassword, resetPassword, logout };
