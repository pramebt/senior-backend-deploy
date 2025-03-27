// roomController.js
const fs = require("fs");
const { pool } = require("../config/db");
const multer = require("multer");
const path = require("path");

// ตรวจสอบและสร้างโฟลเดอร์ uploads/childrenPic หากยังไม่มี
const dir = "uploads/roomsPic";
if (!fs.existsSync(dir)) {
  fs.mkdirSync(dir, { recursive: true }); // สร้างโฟลเดอร์พร้อมกับโฟลเดอร์ย่อยที่ขาดหายไป
}

// ตั้งค่า multer สำหรับจัดการ multipart/form-data (การอัพโหลดไฟล์)
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, dir); // กำหนดโฟลเดอร์สำหรับเก็บไฟล์ที่อัพโหลด
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    cb(
      null,
      file.fieldname + "-" + uniqueSuffix + path.extname(file.originalname)
    ); // ตั้งชื่อไฟล์ใหม่พร้อมนามสกุลเดิม
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/; // รองรับไฟล์ JPEG, JPG และ PNG
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(new Error("กรุณาอัพโหลดไฟล์รูปภาพที่เป็นนามสกุล jpeg, jpg, หรือ png"));
  },
});

const addRooms = async (req, res) => {
  try {
    const { rooms_name, supervisor_id, colors } = req.body;
    console.log("RoomData Data: ", req.body);

    // ตรวจสอบข้อมูลที่จำเป็น
    if (!rooms_name || !supervisor_id) {
      throw new Error("Missing required fields: rooms_name or supervisor_id");
    }

    const roomsPic = req.file ? path.normalize(req.file.path) : null;

    const connection = await pool.getConnection();
    const [result] = await connection.execute(
      "INSERT INTO rooms (rooms_name, roomsPic, supervisor_id, colors) VALUES (?, COALESCE(?, NULL), ?, ?)",
      [rooms_name, roomsPic, supervisor_id, colors]
    );

    connection.release(); // คืน connection กลับสู่ pool

    return res.status(201).json({
      message: "Rooms added successfully",
      roomsData: {
        rooms_name,
        roomsPic,
        supervisor_id,
        colors,
        insertId: result.insertId,
      },
    });
  } catch (err) {
    console.error("Error adding room:", err.message);

    // ลบไฟล์หากมีข้อผิดพลาด
    if (req.file) {
      try {
        fs.unlinkSync(req.file.path);
      } catch (fileErr) {
        console.error("Error deleting uploaded file:", fileErr);
      }
    }

    return res
      .status(500)
      .json({ message: err.message || "Internal server error" });
  }
};

const getRoomData = async (req, res) => {
  let connection;
  try {
    const { supervisor_id } = req.query;

    if (!supervisor_id) {
      return res.status(400).json({ message: "supervisor_id is required" });
    }

    connection = await pool.getConnection();

    // ✅ ดึงข้อมูลห้องพร้อมนับจำนวนเด็ก
    const [rooms] = await connection.execute(
      `
      SELECT 
        r.rooms_id, r.rooms_name, r.roomsPic, r.supervisor_id, r.colors, 
        COALESCE(rc.child_count, 0) AS child_count 
      FROM rooms r
      LEFT JOIN (
        SELECT rooms_id, COUNT(child_id) AS child_count 
        FROM rooms_children 
        GROUP BY rooms_id
      ) rc ON r.rooms_id = rc.rooms_id
      WHERE r.supervisor_id = ?;
    `,
      [supervisor_id]
    );

    if (rooms.length === 0) {
      return res.status(200).json({
        message: "No rooms found for this supervisor",
        rooms: [],
      });
    }

    return res.status(200).json({
      message: "Rooms data retrieved successfully",
      rooms,
    });
  } catch (error) {
    console.error("Error fetching rooms data:", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

const getAllData = async (req, res) => {
  let connection;
  try {
    const { supervisor_id } = req.query;

    if (!supervisor_id) {
      return res.status(400).json({ message: "supervisor_id is required" });
    }

    connection = await pool.getConnection();

    // ✅ ดึงข้อมูลห้องพร้อมจำนวนเด็ก
    const [rooms] = await connection.execute(
      `
      SELECT 
        r.rooms_id, r.rooms_name, r.roomsPic, r.supervisor_id, r.colors, 
        COALESCE(rc.child_count, 0) AS child_count 
      FROM rooms r
      LEFT JOIN (
        SELECT rooms_id, COUNT(child_id) AS child_count 
        FROM rooms_children 
        GROUP BY rooms_id
      ) rc ON r.rooms_id = rc.rooms_id
      WHERE r.supervisor_id = ?;
    `,
      [supervisor_id]
    );

    if (rooms.length === 0) {
      return res.status(200).json({
        message: "No rooms found for this supervisor",
        rooms: [],
      });
    }

    return res.status(200).json({
      message: "All data retrieved successfully",
      rooms,
    });
  } catch (error) {
    console.error("Error fetching all data:", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

const getChildDataOfRoom = async (req, res) => {
  let connection;
  try {
    const { rooms_id, supervisor_id } = req.query;

    if (!rooms_id || !supervisor_id) {
      return res
        .status(400)
        .json({ message: "rooms_id and supervisor_id are required" });
    }

    connection = await pool.getConnection();

    // ✅ ตรวจสอบว่าห้องนี้เป็นของ Supervisor นี้หรือไม่
    const [room] = await connection.execute(
      `
      SELECT rooms_id, rooms_name, roomsPic, supervisor_id, colors 
      FROM rooms 
      WHERE rooms_id = ? AND supervisor_id = ?;
      `,
      [rooms_id, supervisor_id]
    );

    if (room.length === 0) {
      return res
        .status(404)
        .json({ message: "Room not found or not managed by this supervisor" });
    }

    // ✅ ดึงข้อมูลเด็กที่อยู่ในห้องนี้จากตาราง rooms_children และ children
    const [children] = await connection.execute(
      `
      SELECT 
        c.child_id, 
        c.firstName, 
        c.lastName, 
        c.nickName, 
        c.birthday, 
        c.gender, 
        c.childPic 
      FROM rooms_children rc
      JOIN children c ON rc.child_id = c.child_id
      WHERE rc.rooms_id = ?;
      `,
      [rooms_id]
    );

    return res.status(200).json({
      message: "Children data retrieved successfully",
      roomData: {
        room_id: room[0].rooms_id,
        room_name: room[0].rooms_name,
        room_pic: room[0].roomsPic,
        supervisor_id: room[0].supervisor_id,
        colors: room[0].colors,
      },
      children: children,
    });
  } catch (error) {
    console.error("Error fetching child data of room:", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

const updateRoomProfile = async (req, res) => {
  let connection;
  try {
    const { rooms_name } = req.body;
    const { rooms_id, supervisor_id } = req.params;

    console.log("RoomData Data: ", req.body);
    console.log("RoomId Data: ", req.params);

    if (!rooms_id || !supervisor_id) {
      return res.status(400).json({ message: "Missing required fields" });
    }

    const roomsPic = req.file ? path.normalize(req.file.path) : null;

    connection = await pool.getConnection();

    // ✅ ตรวจสอบว่าห้องเป็นของ Supervisor ที่ร้องขอหรือไม่
    const [room] = await connection.execute(
      `SELECT roomsPic FROM rooms WHERE rooms_id = ? AND supervisor_id = ?`,
      [rooms_id, supervisor_id]
    );

    if (room.length === 0) {
      return res
        .status(403)
        .json({ message: "You do not have permission to update this room" });
    }

    // ✅ ถ้ามีรูปใหม่ และมีรูปเก่าอยู่ → ลบรูปเก่าออก
    if (roomsPic && room[0].roomsPic) {
      const oldImagePath = room[0].roomsPic;

      if (fs.existsSync(oldImagePath)) {
        try {
          fs.unlinkSync(oldImagePath); // ลบไฟล์รูปเดิมออกจากเซิร์ฟเวอร์
          console.log(`Deleted old image: ${oldImagePath}`);
        } catch (error) {
          console.error("Error deleting old room image:", error);
        }
      } else {
        console.warn(`Old image not found, skipping deletion: ${oldImagePath}`);
      }
    }

    // ✅ ตรวจสอบว่าผู้ใช้ส่งค่าชื่อห้องหรือไม่
    let updateQuery = `UPDATE rooms SET `;
    let queryParams = [];

    if (rooms_name) {
      updateQuery += `rooms_name = ?, `;
      queryParams.push(rooms_name);
    }

    if (roomsPic) {
      updateQuery += `roomsPic = ?, `;
      queryParams.push(roomsPic);
    }

    // ลบ `, ` สุดท้ายออก
    updateQuery = updateQuery.replace(/,\s*$/, "");
    updateQuery += ` WHERE rooms_id = ? AND supervisor_id = ?`;
    queryParams.push(rooms_id, supervisor_id);

    // ✅ ดำเนินการอัปเดต
    await connection.execute(updateQuery, queryParams);
    connection.release();

    return res.status(200).json({
      message: "Room profile updated successfully",
      updatedData: {
        rooms_id,
        rooms_name: rooms_name || room[0].rooms_name,
        roomsPic: roomsPic || room[0].roomsPic,
      },
    });
  } catch (error) {
    console.error("Error updating room profile:", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// Delete room
const deleteRoom = async (req, res) => {
  let connection;
  try {
    const { rooms_id, supervisor_id } = req.params;

    if (!rooms_id || !supervisor_id) {
      return res
        .status(400)
        .json({ message: "rooms_id and supervisor_id are required" });
    }

    connection = await pool.getConnection();

    // ✅ ตรวจสอบว่า Supervisor เป็นเจ้าของห้องนี้หรือไม่
    const [room] = await connection.execute(
      `SELECT * FROM rooms WHERE rooms_id = ? AND supervisor_id = ?`,
      [rooms_id, supervisor_id]
    );

    if (room.length === 0) {
      return res
        .status(403)
        .json({ message: "You do not have permission to delete this room" });
    }

    // ✅ ดึงรายชื่อเด็กในห้องนี้
    const [children] = await connection.execute(
      `SELECT child_id FROM rooms_children WHERE rooms_id = ?`,
      [rooms_id]
    );

    // ✅ ลบข้อมูลการประเมินของเด็กทุกคนในห้องนี้
    await connection.execute(
      `DELETE FROM assessment_supervisor WHERE child_id IN (SELECT child_id FROM rooms_children WHERE rooms_id = ?)`,
      [rooms_id]
    );

    // ✅ ลบคำขอสิทธิ์ของเด็กทุกคนในห้องนี้
    await connection.execute(
      `DELETE FROM access_requests WHERE child_id IN (SELECT child_id FROM rooms_children WHERE rooms_id = ?)`,
      [rooms_id]
    );

    // ✅ ลบเด็กทั้งหมดออกจากห้องก่อน
    await connection.execute(`DELETE FROM rooms_children WHERE rooms_id = ?`, [
      rooms_id,
    ]);

    // ✅ ลบห้องออกจากระบบ
    await connection.execute(`DELETE FROM rooms WHERE rooms_id = ?`, [
      rooms_id,
    ]);

    // ✅ ตรวจสอบว่าเด็กเหล่านี้ยังอยู่ในห้องอื่นหรือไม่
    for (const child of children) {
      const [otherRooms] = await connection.execute(
        `SELECT * FROM rooms_children WHERE child_id = ?`,
        [child.child_id]
      );

      // ถ้าเด็กไม่มีห้องอื่น ให้ลบความสัมพันธ์กับครู
      if (otherRooms.length === 0) {
        await connection.execute(
          `DELETE FROM supervisor_children WHERE child_id = ?`,
          [child.child_id]
        );
      }
    }

    return res
      .status(200)
      .json({ message: "Room and related data deleted successfully" });
  } catch (error) {
    console.error("Error deleting room:", error);
    return res.status(500).json({ message: "Internal server error" });
  } finally {
    if (connection) connection.release();
  }
};

// Delete child from room
// const removeChildFromRoom = async (req, res) => {
//   let connection;
//   try {
//     const { rooms_id, child_id, supervisor_id } = req.body;

//     if (!rooms_id || !child_id || !supervisor_id) {
//       return res.status(400).json({
//         message: "rooms_id, child_id, and supervisor_id are required",
//       });
//     }

//     connection = await pool.getConnection();

//     // ตรวจสอบว่า supervisor เป็นเจ้าของห้องนี้หรือไม่
//     const [room] = await connection.execute(
//       `SELECT * FROM rooms WHERE rooms_id = ? AND supervisor_id = ?`,
//       [rooms_id, supervisor_id]
//     );

//     if (room.length === 0) {
//       return res.status(403).json({
//         message: "You do not have permission to remove children from this room",
//       });
//     }

//     // ลบเด็กออกจากห้อง
//     const [result] = await connection.execute(
//       `DELETE FROM rooms_children WHERE rooms_id = ? AND child_id = ?`,
//       [rooms_id, child_id]
//     );

//     if (result.affectedRows === 0) {
//       return res.status(404).json({ message: "Child not found in this room" });
//     }

//     return res
//       .status(200)
//       .json({ message: "Child removed from room successfully" });
//   } catch (error) {
//     console.error("Error removing child from room:", error);
//     return res.status(500).json({ message: "Internal server error" });
//   } finally {
//     if (connection) connection.release();
//   }
// };

module.exports = {
  addRooms,
  getRoomData,
  getAllData,
  getChildDataOfRoom,
  deleteRoom,
  // removeChildFromRoom,
  updateRoomProfile,
  upload,
};
