// profileRoute.js
const express = require("express");
const router = express.Router();

const {
  getChildData,
  addChildForParent,
  addChildForSupervisor,
  upload,
} = require("../controllers/childController");

// Route AddChildForParent
router.post("/addChild-P", upload.single("childPic"), addChildForParent);

// Route AddChildForSupervisor
router.post("/addChild-S", upload.single("childPic"), addChildForSupervisor);

// Route สำหรับการดึง
router.get("/get-child-data", getChildData);

module.exports = router;
