// notificateController.js
const { pool } = require("../config/db");

const { Expo } = require("expo-server-sdk");
const expo = new Expo();

// *** sendPushNotification ***
const sendPushNotification = async (expoPushToken, message) => {
  if (!Expo.isExpoPushToken(expoPushToken)) {
    console.error(`Invalid Expo push token: ${expoPushToken}`);
    return;
  }

  try {
    const messages = [
      {
        to: expoPushToken,
        sound: "default",
        body: message,
        data: { withSome: "data" },
      },
    ];

    const ticket = await expo.sendPushNotificationsAsync(messages);
    console.log("Push Notification Sent:", ticket);
  } catch (error) {
    console.error("Error sending push notification:", error);
  }
};

// ฟังก์ชันสำหรับการอนุมัติคำขอสิทธิ์
const approveAccessRequest = async (req, res) => {
  const { child_id, supervisor_id, parent_id, notification_id } = req.body;

  if (!child_id || !supervisor_id || !parent_id) {
    return res
      .status(400)
      .json({ message: "Child ID, Supervisor ID, and Parent ID are required" });
  }

  try {
    const connection = await pool.getConnection();

    // ดึง userName ของ Supervisor
    const [supervisorRows] = await connection.execute(
      "SELECT userName FROM users WHERE user_id = ?",
      [supervisor_id]
    );

    if (supervisorRows.length === 0) {
      return res.status(404).json({ message: "Supervisor not found" });
    }

    const supervisorName = supervisorRows[0].userName;

    // update status & template_id & message
    const [result] = await connection.execute(
      "UPDATE notifications SET status = 'read', template_id = 3, message = ? WHERE notification_id = ?",
      [
        `✅ คุณได้อนุมัติการเข้าถึงข้อมูลเด็กให้กับ ${supervisorName} แล้ว!`,
        notification_id,
      ]
    );

    // อัปเดตสถานะคำขอสิทธิ์
    await connection.execute(
      "UPDATE access_requests SET status = ? WHERE child_id = ? AND supervisor_id = ?",
      ["approved", child_id, supervisor_id]
    );

    // ดึง rooms_id ของ Supervisor
    const [roomsIdRows] = await connection.execute(
      "SELECT rooms_id FROM access_requests WHERE supervisor_id = ? AND child_id = ?",
      [supervisor_id, child_id]
    );

    if (roomsIdRows.length === 0) {
      return res.status(404).json({ message: "Supervisor not found" });
    }

    const roomsId = roomsIdRows[0].rooms_id;
    console.log("roomsId: ", roomsId);

    // เพิ่มเด็กใน rooms_children
    await connection.execute(
      "INSERT INTO rooms_children (rooms_id, child_id, supervisor_id) VALUES (?, ?, ?)",
      [roomsId, child_id, supervisor_id]
    );

    // เพิ่มเด็กในตาราง supervisor_children
    await connection.execute(
      "INSERT INTO supervisor_children (supervisor_id, child_id) VALUES (?, ?)",
      [supervisor_id, child_id]
    );

    // ✅ เพิ่ม Notification ลงในฐานข้อมูล
    await connection.execute(
      "INSERT INTO notifications (user_id, message, supervisor_id, child_id, template_id, status) VALUES (?, ?, ?, ?, ?, ?)",
      [
        supervisor_id,
        "✅ การขอเข้าถึงข้อมูลของเด็กได้รับการอนุมัติแล้ว!",
        supervisor_id,
        child_id,
        2,
        "unread",
      ]
    );

    // ค้นหา Expo Push Token ของ Supervisor
    const [supervisorSend] = await connection.execute(
      "SELECT expo_push_token FROM expo_tokens WHERE user_id = ?",
      [supervisor_id]
    );

    if (!supervisorSend.length) {
      return res.status(404).json({ message: "Supervisor not found" });
    }

    const supervisorPushToken = supervisorSend[0].expo_push_token;

    if (supervisorPushToken) {
      // ✅ ส่ง Push Notification ไปยังผู้ดูแล
      await sendPushNotification(
        supervisorPushToken,
        "การขอเข้าถึงข้อมูลของเด็กได้รับการอนุมัติแล้ว!"
      );
    }

    connection.release();

    return res.status(200).json({
      message:
        "Access request approved, notification saved, and push sent to supervisor",
    });
  } catch (err) {
    console.error("Error approving access request:", err);
    return res.status(500).json({ message: "Error approving access request" });
  }
};

// ฟังก์ชันสำหรับการปฏิเสธคำขอสิทธิ์
const rejectAccessRequest = async (req, res) => {
  const { child_id, supervisor_id, parent_id, notification_id } = req.body;

  if (!child_id || !supervisor_id || !parent_id) {
    return res
      .status(400)
      .json({ message: "Child ID, Supervisor ID, and Parent ID are required" });
  }

  try {
    const connection = await pool.getConnection();

    // ดึง userName ของ Supervisor
    const [supervisorRows] = await connection.execute(
      "SELECT userName FROM users WHERE user_id = ?",
      [supervisor_id]
    );

    if (supervisorRows.length === 0) {
      return res.status(404).json({ message: "Supervisor not found" });
    }

    const supervisorName = supervisorRows[0].userName;

    // update status & template_id & message
    const [result] = await connection.execute(
      "UPDATE notifications SET status = 'read', template_id = 3, message = ? WHERE notification_id = ?",
      [
        `✅ คุณได้ปฏิเสธการเข้าถึงข้อมูลเด็กให้กับ ${supervisorName} แล้ว!`,
        notification_id,
      ]
    );

    // อัปเดตสถานะคำขอสิทธิ์
    await connection.execute(
      "UPDATE access_requests SET status = ? WHERE child_id = ? AND supervisor_id = ?",
      ["rejected", child_id, supervisor_id]
    );

    // 🚫 เพิ่ม Notification ลงในฐานข้อมูล
    await connection.execute(
      "INSERT INTO notifications (user_id, message, supervisor_id, child_id, template_id, status) VALUES (?, ?, ?, ?, ?, ?)",
      [
        supervisor_id,
        "🚫 การขอเข้าถึงข้อมูลของเด็กไม่ได้รับการอนุมัติ!",
        supervisor_id,
        child_id,
        4,
        "unread",
      ]
    );

    // ค้นหา Expo Push Token ของ Supervisor
    const [supervisorSend] = await connection.execute(
      "SELECT expo_push_token FROM expo_tokens WHERE user_id = ?",
      [supervisor_id]
    );

    if (!supervisorSend.length) {
      return res.status(404).json({ message: "Supervisor not found" });
    }

    const supervisorPushToken = supervisorSend[0].expo_push_token;

    if (supervisorPushToken) {
      // ✅ ส่ง Push Notification ไปยังผู้ดูแล
      await sendPushNotification(
        supervisorPushToken,
        "🚫 การขอเข้าถึงข้อมูลของเด็กไม่ได้รับการอนุมัติ!"
      );
    }

    connection.release();

    return res.status(200).json({
      message:
        "Access request rejected, notification saved, and push sent to supervisor",
    });
  } catch (err) {
    console.error("Error rejected access request:", err);
    return res.status(500).json({ message: "Error rejected access request" });
  }
};

// saveExpoPushToken
const saveExpoPushToken = async (req, res) => {
  const { user_id, expoPushToken } = req.body;
  console.log("📩 Received Token at Backend:", expoPushToken);

  if (!user_id || !expoPushToken) {
    return res
      .status(400)
      .json({ message: "User ID and Expo Push Token are required" });
  }

  try {
    const connection = await pool.getConnection();

    // บันทึกหรืออัปเดต Token ในตาราง expo_tokens
    await connection.execute(
      `INSERT INTO expo_tokens (user_id, expo_push_token, updated_at)
   VALUES (?, ?, NOW())
   ON DUPLICATE KEY UPDATE 
     expo_push_token = VALUES(expo_push_token), 
     updated_at = NOW()`,
      [user_id, expoPushToken]
    );

    connection.release();

    return res
      .status(200)
      .json({ message: "Expo Push Token saved successfully" });
  } catch (error) {
    console.error("Error saving push token:", error);
    return res.status(500).json({ message: "Error saving push token" });
  }
};

// ฟังก์ชันสำหรับการดึงข้อมูลการแจ้งเตือนตาม user_id
const getAllNotifications = async (req, res) => {
  const { user_id } = req.query;
  try {
    const connection = await pool.getConnection();

    // ดึงข้อมูลการแจ้งเตือนของ user_id ที่ระบุ
    const [notifications] = await connection.execute(
      "SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10",
      [user_id]
    );

    connection.release();

    // ส่งกลับข้อมูลการแจ้งเตือน
    return res.status(200).json({ notifications });
  } catch (err) {
    console.error("Error fetching notifications:", err);
    return res.status(500).json({ message: "Error fetching notifications" });
  }
};

// ฟังก์ชันสำหรับลบการแจ้งเตือนเกิน 20 รายการต่อผู้ใช้
const deleteOldNotifications = async (user_id) => {
  try {
    const connection = await pool.getConnection();

    // ลบแจ้งเตือนที่เก่าที่สุดเกิน 20 รายการ
    await connection.execute(
      `
      DELETE FROM notifications
      WHERE notification_id NOT IN (
        SELECT notification_id FROM (
          SELECT notification_id FROM notifications
          WHERE user_id = ?
          ORDER BY created_at DESC
          LIMIT 20
        ) AS latest_notifications
      ) AND user_id = ?;
    `,
      [user_id, user_id]
    );
    console.log("✅ Old notifications deleted for User ID", user_id);

    connection.release();
  } catch (error) {
    console.error("❌ Error deleting old notifications:", error);
  }
};

const sendAssessmentReminder = async () => {
  let connection;
  try {
    connection = await pool.getConnection();

    // ดึงเฉพาะการประเมินล่าสุดของเด็กแต่ละคน
    const [childrenToNotify] = await connection.execute(`
      SELECT 
        c.child_id,
        c.firstName,
        c.lastName,
        MAX(a.assessment_date) AS last_assessment_date,
        a.user_id, 
        u.userName AS last_evaluator_name, 
        et.expo_push_token
      FROM children c
      JOIN assessments a ON c.child_id = a.child_id
      JOIN users u ON a.user_id = u.user_id 
      JOIN expo_tokens et ON a.user_id = et.user_id 
      WHERE a.assessment_date <= NOW() - INTERVAL 2 WEEK
      GROUP BY c.child_id, a.user_id, u.userName, et.expo_push_token
      ORDER BY last_assessment_date DESC; 
    `);

    if (childrenToNotify.length === 0) {
      console.log("No children need assessment reminders at this time.");
      return;
    }

    for (const child of childrenToNotify) {
      const message = `⚠️ ถึงเวลาอัปเดตการประเมินพัฒนาการของ ${child.firstName} ${child.lastName} แล้ว!`;

      // ✅ บันทึกแจ้งเตือนในฐานข้อมูล
      await connection.execute(
        "INSERT INTO notifications (user_id, message, supervisor_id, child_id, template_id, status) VALUES (?, ?, ?, ?, ?, ?)",
        [child.user_id, message, child.user_id, child.child_id, 2, "unread"]
      );

      // ✅ ลบแจ้งเตือนเก่าที่เกิน 20 รายการ
      await deleteOldNotifications(child.user_id);

      // ✅ ส่ง Push Notification
      if (child.expo_push_token) {
        await sendPushNotification(child.expo_push_token, message);
      }

      console.log(
        `✅ Reminder sent for child ID ${child.child_id} to User ID ${child.user_id}`
      );
    }
  } catch (error) {
    console.error("❌ Error sending assessment reminders:", error);
  } finally {
    if (connection) connection.release();
  }
};

// Function to mark a notification as read
const markNotificationAsRead = async (req, res) => {
  const { notification_id } = req.body;

  if (!notification_id) {
    return res.status(400).json({ message: "Notification ID is required" });
  }

  try {
    const connection = await pool.getConnection();

    // อัปเดต status เป็น 'read'
    const [result] = await connection.execute(
      "UPDATE notifications SET status = 'read' WHERE notification_id = ?",
      [notification_id]
    );

    connection.release();

    if (result.affectedRows === 0) {
      return res.status(404).json({ message: "Notification not found" });
    }

    return res.status(200).json({ message: "Notification marked as read" });
  } catch (error) {
    console.error("Error updating notification status:", error);
    return res
      .status(500)
      .json({ message: "Error updating notification status" });
  }
};

module.exports = {
  approveAccessRequest,
  getAllNotifications,
  saveExpoPushToken,
  sendAssessmentReminder,
  markNotificationAsRead,
  rejectAccessRequest,
};
