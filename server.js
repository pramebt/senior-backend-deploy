const express = require("express");
const multer = require("multer");
const cors = require("cors");
const path = require("path");
const helmet = require("helmet");
const rateLimit = require("express-rate-limit");
const jwt = require("jsonwebtoken");
const csrf = require("csurf");
const cookieParser = require("cookie-parser");
require("dotenv").config();
const authRoutes = require("./routes/authRoutes");
const profileRoutes = require("./routes/profileRoutes");
const childRoutes = require("./routes/childRoutes");
const assessmentRoutes = require("./routes/assessmentRoutes");
const roomRoutes = require("./routes/roomRoutes");
const notificateRoutes = require("./routes/notificateRoutes");
const adminRoutes = require("./routes/adminRoute");
const {
  sendAssessmentReminder,
} = require("./controllers/notificateController");
const {
  refreshAccessToken,
  authenticateToken,
} = require("./middlewares/authMiddleware");

const app = express();
const port = process.env.PORT;

// === Middleware สำหรับ CORS ===
app.use(
  cors({
    origin: [
      process.env.CORS_ORIGIN ||
        "https://senior-test-deploy-production-1362.up.railway.app",
    ],
    methods: ["GET", "POST", "PUT"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// === Middleware สำหรับ JSON ===
app.use(express.json());

// Serve static files from 'uploads' folder
app.use("/uploads", express.static("uploads"));

// === ตั้งค่า Multer ===
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    cb(null, "uploads/"); // โฟลเดอร์สำหรับเก็บไฟล์ที่อัพโหลด
  },
  filename: (req, file, cb) => {
    const uniqueSuffix = Date.now() + "-" + Math.round(Math.random() * 1e9);
    const sanitizedFilename = path.basename(file.originalname); // ป้องกัน Directory Traversal
    cb(null, `${file.fieldname}-${uniqueSuffix}-${sanitizedFilename}`);
  },
});

const upload = multer({
  storage: storage,
  limits: { fileSize: 20 * 1024 * 1024 }, // จำกัดขนาดไฟล์ 20MB
  fileFilter: (req, file, cb) => {
    const filetypes = /jpeg|jpg|png/; // รองรับไฟล์ JPEG, JPG, และ PNG
    const mimetype = filetypes.test(file.mimetype);
    const extname = filetypes.test(
      path.extname(file.originalname).toLowerCase()
    );

    if (mimetype && extname) {
      return cb(null, true);
    }
    cb(
      new Error(
        "Invalid file type. Please upload an image file with jpeg, jpg, or png extension."
      )
    );
  },
}).single("file"); // รองรับอัปโหลดไฟล์เพียงไฟล์เดียวต่อครั้ง

// === Route สำหรับการอัปโหลดไฟล์ ===
app.post("/api/upload", (req, res) => {
  upload(req, res, (err) => {
    if (err instanceof multer.MulterError) {
      return res.status(400).json({ error: `Multer error: ${err.message}` });
    } else if (err) {
      return res.status(400).json({ error: `Upload error: ${err.message}` });
    }
    res.status(200).json({ message: "File uploaded successfully!" });
  });
});

app.use(cookieParser());

// === ✅ ป้องกันข้อมูลที่ถูกดักจับระหว่างการส่ง (MITM Attack) ===
// app.use((req, res, next) => {
//   if (!req.secure) {
//     return res.redirect("https://" + req.headers.host + req.url);
//   }
//   next();
// });

// === ปิด X-Powered-By Header เพื่อไม่ให้เปิดเผยข้อมูล Framework (เพื่อป้องกันผู้โจมตีรู้ว่าใช้ Express) ===
app.disable("x-powered-by");

// === ✅ บอกให้ Express เชื่อมต่อผ่าน Proxy ===
app.set("trust proxy", 1);

// === ✅ ป้องกันการส่งคำขอโดยไม่ได้รับอนุญาตจากผู้ใช้ (CSRF Attack) ===
// app.use(csrf());

// === ✅ ตั้งค่า Rate Limit เพื่อป้องกันการโจมตี DDoS ====
const limiter = rateLimit({
  windowMs: 5 * 60 * 1000, // time 5 min
  max: 2000, // requests limit by IP
  message: "Too many requests, please try again later.",
});
app.use(limiter);

// === Middleware Helmet ===
app.use(helmet());

// serve file static from `public`
app.use(express.static(path.join(__dirname, "public")));

// check assetlinks.json to serve
app.use(
  "/.well-known",
  express.static(path.join(__dirname, "public/.well-known"))
);

app.get("/reset-password", (req, res) => {
  const { token } = req.query;

  if (!token) {
    return res.status(400).send("Invalid request: Missing token");
  }

  // Redirect (Deep Linking)
  const appLink = `dekdek://reset-password?token=${token}`;
  res.redirect(appLink);
});

// === Routes ===
app.use("/api/middlewares/refresh-token", refreshAccessToken);
app.use("/api/admin", adminRoutes);
app.use("/api/auth", authRoutes);
app.use("/api/profiles", profileRoutes);
app.use("/api/childs", childRoutes);
app.use("/api/assessments", assessmentRoutes);
app.use("/api/rooms", roomRoutes);
app.use("/api/notifications", notificateRoutes);

// === Routes For Test ===
// app.use("/api/middlewares/refreshtoken", refreshAccessToken);
// app.use("/api/auth", authRoutes);
// app.use("/api/profiles", profileRoutes);
// app.use("/api/childs", childRoutes);
// app.use("/api/assessments", assessmentRoutes);
// app.use("/api/rooms", roomRoutes);
// app.use("/api/notifications", notificateRoutes);

// === Send Warning Assessment per 2 weeks ===
sendAssessmentReminder();
setInterval(sendAssessmentReminder, 24 * 60 * 60 * 1000);
// setInterval(sendAssessmentReminder, 10 * 60 * 1000); // for test 10 minutes

// === Server Start ===
app.listen(port, () => {
  console.log(`Server is running on: http://localhost:${port}`); // For localhost
  console.log("Ready for commands, Sir'Benz!");
});

module.exports = upload;
