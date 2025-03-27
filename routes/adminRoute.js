// assessmentRoutes.js
const express = require("express");
const router = express.Router();

const adminController = require("../controllers/adminController");

// Route User List
router.get("/get-user/:userId", adminController.user_list);

// Route children List
router.get("/get-children/:userId", adminController.child_list);

module.exports = router;
