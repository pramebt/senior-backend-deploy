// profileController.js
const fs = require("fs");
const path = require("path");
const multer = require("multer");
const { pool } = require("../config/db");

// ตรวจสอบและสร้างโฟลเดอร์ uploads/profilePic หากยังไม่มี
const dir = "uploads/childrenPic";
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true });
}

// ตั้งค่า multer สำหรับอัปโหลดไฟล์
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    );
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // จำกัดขนาดไฟล์ 20MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/;
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );
    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("กรุณาอัปโหลดไฟล์รูปภาพที่เป็นนามสกุล jpeg, jpg, หรือ png"));
  },
});

// ฟังก์ชันอัปเดตโปรไฟล์ทั้งหมด
const updateUserProfile = async (req, res) => {
  const { user_id, userName, email, phoneNumber } = req.body;
  const profilePic = req.file ? req.file.path : null;

  if (!user_id) {
    return res.status(400).json({ success: false, message: "Missing user_id" });
  }

  try {
    const connection = await pool.getConnection();

    // ตรวจสอบค่า ถ้า `undefined` ให้ใช้ `null`
    const updatedUserName = userName !== undefined ? userName : null;
    const updatedEmail = email !== undefined ? email : null;
    const updatedPhoneNumber = phoneNumber !== undefined ? phoneNumber : null;
    const updatedProfilePic = profilePic !== undefined ? profilePic : null;

    // อัปเดตข้อมูลผู้ใช้
    await connection.execute(
      `UPDATE users 
       SET userName = COALESCE(?, userName), 
           email = COALESCE(?, email), 
           phoneNumber = COALESCE(?, phoneNumber), 
           profilePic = COALESCE(?, profilePic) 
       WHERE user_id = ?`,
      [
        updatedUserName,
        updatedEmail,
        updatedPhoneNumber,
        updatedProfilePic,
        user_id,
      ]
    );

    connection.release();
    res
      .status(200)
      .json({ success: true, message: "Profile updated successfully" });
  } catch (error) {
    console.error("Error updating user profile:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

// ฟังก์ชันดึงรูปโปรไฟล์
const getProfilePic = async (req, res) => {
  try {
    const { userId } = req.query;
    if (!userId) {
      return res
        .status(400)
        .json({ success: false, message: "No userId provided" });
    }

    const [rows] = await pool.query(
      "SELECT profilePic FROM users WHERE user_id = ?",
      [userId]
    );

    if (rows.length === 0) {
      return res
        .status(404)
        .json({ success: false, message: "User not found" });
    }

    res.json({ success: true, profilePic: rows[0].profilePic });
  } catch (error) {
    console.error("Error fetching profile picture:", error);
    res.status(500).json({ success: false, message: "Internal server error" });
  }
};

// updateProfileChild
const updateProfileChild = async (req, res) => {
  const { child_id, firstName, lastName, nickName, birthday, gender } =
    req.body;
  const newChildPic = req.file ? req.file.path : null;

  if (!child_id) {
    return res
      .status(400)
      .json({ success: false, message: "Missing child_id" });
  }

  let connection;
  try {
    connection = await pool.getConnection();
    await connection.beginTransaction();

    // ดึงวันเกิดปัจจุบันของเด็ก
    const [oldChildData] = await connection.execute(
      "SELECT birthday FROM children WHERE child_id = ?",
      [child_id]
    );

    if (oldChildData.length === 0) {
      await connection.rollback();
      connection.release();
      return res
        .status(404)
        .json({ success: false, message: "Child not found" });
    }

    const oldBirthday = oldChildData[0].birthday;

    // ถ้ามีการเปลี่ยนแปลงวันเกิด ให้ลบข้อมูลการประเมินที่เกี่ยวข้อง
    if (birthday && oldBirthday !== birthday) {
      await connection.execute("DELETE FROM assessments WHERE child_id = ?", [
        child_id,
      ]);
    }

    // อัปเดตข้อมูลเด็ก
    await connection.execute(
      `UPDATE children 
       SET firstName = COALESCE(?, firstName), 
           lastName = COALESCE(?, lastName), 
           nickName = COALESCE(?, nickName), 
           birthday = COALESCE(?, birthday), 
           gender = COALESCE(?, gender), 
           childPic = COALESCE(?, childPic) 
       WHERE child_id = ?`,
      [
        firstName || null,
        lastName || null,
        nickName || null,
        birthday || null,
        gender || null,
        newChildPic || null,
        child_id,
      ]
    );

    await connection.commit();
    connection.release();

    res.status(200).json({
      success: true,
      message:
        "Child profile updated successfully, assessments reset if needed",
    });
  } catch (error) {
    if (connection) {
      await connection.rollback();
      connection.release();
    }
    console.error("Error updating child profile:", error);
    res.status(500).json({ success: false, message: "Server error" });
  }
};

const deleteUserAccount = async (req, res) => {
  const { user_id } = req.params;

  if (!user_id) {
    return res.status(400).json({ success: false, message: "Missing user_id" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction(); // 🔥 เริ่ม Transaction

    // 1️⃣ ดึงข้อมูลรูปโปรไฟล์ก่อนลบ
    const [userResult] = await connection.execute(
      "SELECT profilePic FROM users WHERE user_id = ?",
      [user_id]
    );

    // 2️⃣ ลบข้อมูลผู้ใช้ (MySQL จะลบข้อมูลที่เกี่ยวข้องทั้งหมดผ่าน `ON DELETE CASCADE`)
    await connection.execute("DELETE FROM users WHERE user_id = ?", [user_id]);

    // 3️⃣ ลบไฟล์โปรไฟล์ถ้ามี
    if (userResult.length > 0) {
      const profilePicPath = userResult[0].profilePic;
      if (profilePicPath && fs.existsSync(profilePicPath)) {
        fs.unlinkSync(profilePicPath);
      }
    }

    await connection.commit(); // ✅ ยืนยันการลบทั้งหมด
    connection.release();
    res
      .status(200)
      .json({ success: true, message: "User account deleted successfully" });
  } catch (error) {
    await connection.rollback(); // ❌ ยกเลิกการลบถ้ามีปัญหา
    connection.release();
    console.error("Error deleting user account:", error);
    res
      .status(500)
      .json({ success: false, message: "Failed to delete user account" });
  }
};

const deleteChild = async (req, res) => {
  const { child_id } = req.params;

  if (!child_id) {
    return res
      .status(400)
      .json({ success: false, message: "Missing child_id" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction(); // 🔥 เริ่ม Transaction

    // 🔥 ลบข้อมูลเด็ก (ข้อมูลที่เกี่ยวข้องจะถูกลบอัตโนมัติผ่าน `ON DELETE CASCADE`)
    await connection.execute("DELETE FROM children WHERE child_id = ?", [
      child_id,
    ]);

    await connection.commit(); // ✅ ยืนยันการลบทั้งหมด
    connection.release();
    res
      .status(200)
      .json({ success: true, message: "Child data deleted successfully" });
  } catch (error) {
    await connection.rollback(); // ❌ ยกเลิกการลบถ้ามีปัญหา
    connection.release();
    console.error("Error deleting child:", error);
    res.status(500).json({ success: false, message: "Failed to delete child" });
  }
};

const deleteChildForSupervisor = async (req, res) => {
  const { supervisor_id, child_id } = req.params;

  if (!supervisor_id || !child_id) {
    return res
      .status(400)
      .json({ success: false, message: "Missing supervisor_id or child_id" });
  }

  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction(); // 🔥 เริ่ม Transaction

    // 🔥 ลบเด็กออกจาก `room_children`
    await connection.execute(
      "DELETE FROM room_children WHERE child_id = ? AND room_id IN (SELECT room_id FROM rooms WHERE supervisor_id = ?)",
      [child_id, supervisor_id]
    );

    // 🔥 ลบการประเมินของเด็กที่เกี่ยวข้องกับ Supervisor
    await connection.execute(
      "DELETE FROM assessment_supervisor WHERE child_id = ? AND supervisor_id = ?",
      [child_id, supervisor_id]
    );

    // 🔥 ลบความสัมพันธ์เด็กออกจาก `supervisor_children`
    await connection.execute(
      "DELETE FROM supervisor_children WHERE child_id = ? AND supervisor_id = ?",
      [child_id, supervisor_id]
    );

    // 🔥 ลบความสัมพันธ์เด็กออกจาก `access_requests`
    await connection.execute(
      "DELETE FROM access_requests WHERE child_id = ? AND supervisor_id = ?",
      [child_id, supervisor_id]
    );

    await connection.commit(); // ✅ ยืนยันการลบทั้งหมด
    connection.release();

    res.status(200).json({
      success: true,
      message: "Child removed from supervisor successfully",
    });
  } catch (error) {
    await connection.rollback(); // ❌ ยกเลิกการลบถ้ามีปัญหา
    connection.release();
    console.error("Error deleting child for supervisor:", error);
    res.status(500).json({
      success: false,
      message: "Failed to remove child for supervisor",
    });
  }
};

module.exports = {
  updateUserProfile,
  getProfilePic,
  updateProfileChild,
  upload,
  deleteUserAccount,
  deleteChild,
  deleteChildForSupervisor,
};
