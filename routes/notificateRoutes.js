// notificateRoute.js
const express = require("express");
const router = express.Router();

const {
  approveAccessRequest,
  getAllNotifications,
  saveExpoPushToken,
  markNotificationAsRead,
  rejectAccessRequest,
} = require("../controllers/notificateController");

// Route approveAccessRequest
router.post("/appprove-access-request", approveAccessRequest);

// Route rejectAccessReqeust
router.post("/reject-access-request", rejectAccessRequest);

// Route getAllNotifications
router.get("/get-all-notificate", getAllNotifications);

// Route saveExpoPushToken
router.post("/save-push-token", saveExpoPushToken);

// Route markNotificationAsRead
router.post("/mark-notification-read", markNotificationAsRead);

module.exports = router;
