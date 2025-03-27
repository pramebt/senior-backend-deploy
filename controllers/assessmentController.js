// assessmentController.js
const { pool } = require("../config/db");

// ====================================================================================================================================================================================
// For Parent

const getAssessmentsByAspect = async (req, res) => {
  const { child_id, aspect, user_id, childAgeInMonths } = req.params;

  try {
    console.log("child_id: ", child_id);
    console.log("aspect: ", aspect);
    console.log("user_id: ", user_id);
    console.log("childAgeInMonths: ", childAgeInMonths);

    const ageInMonths = parseInt(childAgeInMonths, 10);
    const tableName = `assessment_details`;

    // ✅ ค้นหาการประเมินล่าสุดของเด็กใน aspect นี้
    const query = `
      SELECT a.assessment_id, a.assessment_date, ad.assessment_rank, a.status
      FROM assessments a
      JOIN ${tableName} ad ON a.assessment_details_id = ad.assessment_details_id
      WHERE a.child_id = ? AND ad.aspect = ?
      ORDER BY ad.assessment_rank DESC LIMIT 1
    `;
    const [rows] = await pool.query(query, [child_id, aspect]);

    // ✅ กรณีไม่มีการประเมินเลย → สร้างการประเมินใหม่
    if (rows.length === 0) {
      const defaultQuery = `
        SELECT assessment_details_id, aspect, assessment_rank, assessment_name, age_range
        FROM ${tableName}
        WHERE aspect = ?
        ORDER BY assessment_rank ASC
      `;
      const [defaultAssessments] = await pool.query(defaultQuery, [aspect]);

      const defaultAssessment = defaultAssessments.find((assessment) => {
        const [start, end] = assessment.age_range.split("-").map(Number);
        return ageInMonths >= start && ageInMonths <= end;
      });

      if (!defaultAssessment) {
        return res
          .status(404)
          .json({ error: "ไม่พบข้อมูลการประเมินสำหรับด้านที่ระบุ" });
      }

      const insertQuery = `
        INSERT INTO assessments (child_id, assessment_rank, aspect, status, user_id, assessment_details_id)
        VALUES (?, ?, ?, 'in_progress', ?, ?)
      `;
      const [result] = await pool.query(insertQuery, [
        child_id,
        defaultAssessment.assessment_rank,
        aspect,
        user_id,
        defaultAssessment.assessment_details_id,
      ]);

      const assessmentDetailsQuery = `
        SELECT * FROM ${tableName}
        WHERE assessment_rank = ? AND aspect = ?
      `;
      const [assessmentDetails] = await pool.query(assessmentDetailsQuery, [
        defaultAssessment.assessment_rank,
        aspect,
      ]);

      return res.status(201).json({
        message: "เริ่มต้นการประเมินใหม่",
        data: {
          assessment_id: result.insertId,
          child_id,
          assessment_rank: defaultAssessment.assessment_rank,
          aspect: defaultAssessment.aspect,
          assessment_name: defaultAssessment.assessment_name,
          status: "in_progress",
          assessment_date: new Date().toISOString(),
          details: assessmentDetails[0],
        },
      });
    }

    // ✅ กรณีมี `in_progress` → คืนค่าการประเมินปัจจุบัน
    const inProgressAssessments = rows.filter(
      (row) => row.status === "in_progress"
    );

    if (inProgressAssessments.length > 0) {
      const inProgressAssessment = inProgressAssessments
        .sort((a, b) => a.assessment_rank - b.assessment_rank)
        .pop();

      const assessmentDetailsQuery = `
        SELECT * FROM ${tableName}
        WHERE assessment_rank = ? AND aspect = ?
      `;
      const [assessmentDetails] = await pool.query(assessmentDetailsQuery, [
        inProgressAssessment.assessment_rank,
        aspect,
      ]);

      return res.status(200).json({
        message: "กำลังดำเนินการประเมิน",
        data: {
          assessment_id: inProgressAssessment.assessment_id,
          assessment_date: inProgressAssessment.assessment_date,
          ...inProgressAssessment,
          details: assessmentDetails[0],
        },
      });
    }

    // ✅ กรณีมี `passed_all` → ส่ง `assessmentDetails: null`
    const passedAllAssessments = rows.filter(
      (row) => row.status === "passed_all"
    );

    if (passedAllAssessments.length > 0) {
      return res.status(200).json({
        message: "การประเมินเสร็จสมบูรณ์สำหรับ aspect นี้",
        data: {
          assessment_id: null,
          child_id,
          aspect,
          assessment_rank: null,
          assessment_name: null,
          status: "passed_all",
          assessment_date: null,
          details: null,
        },
      });
    }

    return res.status(404).json({
      message: "ไม่พบการประเมินที่อยู่ในสถานะ 'in_progress' หรือ 'passed_all'",
    });
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ error: "เกิดข้อผิดพลาดในการดึงข้อมูลการประเมิน" });
  }
};

const fetchNextAssessment = async (req, res) => {
  const { assessment_id, user_id } = req.body;
  const { child_id, aspect } = req.params;

  try {
    const updateQuery = `
      UPDATE assessments 
      SET status = 'passed'
      WHERE assessment_id = ? AND status = 'in_progress'`;

    const [updateResult] = await pool.query(updateQuery, [assessment_id]);

    if (updateResult.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "ไม่พบการประเมินหรือเสร็จสิ้นแล้ว" });
    }

    const getAssessmentDetailsIdQuery = `
      SELECT assessment_details_id 
      FROM assessments 
      WHERE assessment_id = ?`;
    const [assessmentDetailsIdResult] = await pool.query(
      getAssessmentDetailsIdQuery,
      [assessment_id]
    );

    if (!assessmentDetailsIdResult.length) {
      return res.status(404).json({
        message: "ไม่พบ assessment_details_id สำหรับ assessment_id นี้",
      });
    }

    const assessmentDetailsId =
      assessmentDetailsIdResult[0].assessment_details_id;

    const rankQuery = `
      SELECT assessment_rank 
      FROM assessment_details 
      WHERE assessment_details_id = ?`;
    const [rankResult] = await pool.query(rankQuery, [assessmentDetailsId]);

    if (!rankResult.length) {
      return res.status(404).json({ message: "ไม่พบรายละเอียดการประเมิน" });
    }

    const assessmentRank = rankResult[0].assessment_rank;

    const nextAssessmentQuery = `
      SELECT ad.assessment_details_id AS assessment_detail_id, ad.aspect, ad.assessment_rank, ad.assessment_name
      FROM assessment_details ad
      WHERE ad.assessment_rank > ? AND ad.aspect = ?
      ORDER BY ad.assessment_rank ASC
      LIMIT 1`;

    const [nextAssessment] = await pool.query(nextAssessmentQuery, [
      assessmentRank,
      aspect,
    ]);

    if (nextAssessment.length > 0) {
      const insertQuery = `
        INSERT INTO assessments (child_id, assessment_details_id, assessment_rank, aspect, status, user_id)
        VALUES (?, ?, ?, ?, 'in_progress', ?)`;
      const [result] = await pool.query(insertQuery, [
        child_id,
        nextAssessment[0].assessment_detail_id,
        nextAssessment[0].assessment_rank,
        aspect,
        user_id,
      ]);

      const assessmentDetailsQuery = `
        SELECT * FROM assessment_details
        WHERE assessment_rank = ? AND aspect = ?`;
      const [assessmentDetails] = await pool.query(assessmentDetailsQuery, [
        nextAssessment[0].assessment_rank,
        aspect,
      ]);

      return res.status(201).json({
        message: "สร้างและโหลดการประเมินถัดไปสำเร็จ",
        next_assessment: {
          assessment_id: result.insertId,
          child_id,
          user_id,
          assessment_rank: nextAssessment[0].assessment_rank,
          aspect: nextAssessment[0].aspect,
          assessment_name: nextAssessment[0].assessment_name,
          status: "in_progress",
          assessment_date: new Date().toISOString(),
          details: assessmentDetails[0],
        },
      });
    } else {
      const updateLastAssessmentQuery = `
        UPDATE assessments
        SET status = 'passed_all'
        WHERE assessment_id = ?`;

      await pool.query(updateLastAssessmentQuery, [assessment_id]);

      return res.status(200).json({
        message:
          "ผ่านการประเมินและไม่มีการประเมินเพิ่มเติมสำหรับ aspect นี้ (passed_all)",
        next_assessment: {
          assessment_id: null,
          child_id,
          user_id,
          assessment_rank: null,
          aspect,
          assessment_name: null,
          status: "passed_all",
          assessment_date: null,
          details: null, // ไม่ต้องส่งรายละเอียดเพราะไม่มี assessment ถัดไป
        },
      });
    }
  } catch (error) {
    console.error(error);
    return res
      .status(500)
      .json({ error: "ไม่สามารถอัปเดตสถานะหรือดึงการประเมินถัดไปได้" });
  }
};

// ฟังก์ชันสำหรับดึงรายละเอียดการประเมินทั้งหมดของเด็ก
const getAssessmentsAllChild = async (req, res) => {
  const { child_id } = req.params;

  // Validate child_id
  if (!Number.isInteger(Number(child_id))) {
    return res.status(400).json({ error: "Invalid child ID provided." });
  }

  try {
    const query = `
      SELECT 
        a.id AS assessment_id,
        c.childName AS child_name, -- ชื่อเด็ก
        a.child_id AS child_id,
        a.user_id AS evaluator_id,
        u.username AS evaluator_name, -- ชื่อผู้ประเมิน
        a.aspect AS aspect_name,
        a.assessment_rank AS aspect_rank,
        a.assessment_date AS assessment_date,
        a.status AS status
      FROM assessments a
      JOIN children c ON a.child_id = c.child_id
      JOIN users u ON a.user_id = u.user_id
      WHERE a.child_id = ?`;

    const [results] = await pool.query(query, [child_id]);

    if (results.length === 0) {
      return res
        .status(200)
        .json({ message: "No assessments found.", data: [] });
    }

    res
      .status(200)
      .json({ message: "Assessments retrieved successfully.", data: results });
  } catch (error) {
    console.error("Error fetching assessments:", error);
    res.status(500).json({ error: "Failed to retrieve assessments" });
  }
};

// Get Assessment Last For a Child
const getAssessmentsByChild = async (req, res) => {
  const { parent_id, child_id } = req.params;

  if (!parent_id || !child_id) {
    return res.status(400).json({ message: "parent_id and child_id required" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // ✅ ดึงข้อมูลเด็กที่ Parent ดูแล
    const [childRows] = await connection.execute(
      `SELECT * FROM children 
       JOIN parent_children ON children.child_id = parent_children.child_id 
       WHERE children.child_id = ? AND parent_children.parent_id = ?`,
      [child_id, parent_id]
    );

    if (childRows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลเด็ก" });
    }

    // ✅ ดึงข้อมูล `in_progress` หรือ `passed_all`
    const [assessments] = await connection.execute(
      `SELECT a.assessment_id, a.assessment_rank, a.aspect, 
              a.assessment_details_id, a.assessment_date, a.status 
       FROM assessments a 
       WHERE a.child_id = ? AND (a.status = 'in_progress' OR a.status = 'passed_all')`,
      [child_id]
    );

    // ✅ ดึงรายละเอียดของ assessment_details
    for (let i = 0; i < assessments.length; i++) {
      const [details] = await connection.execute(
        `SELECT * FROM assessment_details WHERE assessment_details_id = ?`,
        [assessments[i].assessment_details_id]
      );
      assessments[i].details = details.length > 0 ? details[0] : null;
    }

    connection.release();

    return res.status(200).json({
      message: "ดึงข้อมูลการประเมินของเด็กสำเร็จ",
      parent_id,
      child: {
        ...childRows[0],
        assessments,
      },
    });
  } catch (error) {
    console.error("Error fetching child assessment data:", error);
    return res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลการประเมิน" });
  } finally {
    if (connection) connection.release();
  }
};

// Update assessment status to 'not_passed'
const updateAssessmentStatus = async (req, res) => {
  const { assessment_id } = req.body;
  const { child_id, aspect } = req.params;

  try {
    const updateQuery = `
      UPDATE assessments
      SET status = 'not_passed'
      WHERE assessment_id = ? AND status = 'in_progress'`;

    const [updateResult] = await pool.query(updateQuery, [assessment_id]);

    if (updateResult.affectedRows === 0) {
      return res.status(200).json({
        message: "assessment not found or already completed",
      });
    }

    return res.status(200).json({
      message: "อัปเดตสถานะการประเมินเป็น 'not_passed' สำเร็จ",
      updated_assessment_id: assessment_id,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: "Failed to update supervisor assessment status" });
  }
};

const updateAssessmentStatusRetryPassed = async (req, res) => {
  const { assessment_id } = req.body;


  try {
    const updateQuery = `
      UPDATE assessments
      SET status = 'passed'
      WHERE assessment_id = ? `;

    const [updateResult] = await pool.query(updateQuery, [assessment_id]);

    if (updateResult.affectedRows === 0) {
      return res.status(200).json({
        message: "assessment not found or already completed",
      });
    }

    return res.status(200).json({
      message: "อัปเดตสถานะการประเมินเป็น 'passed' สำเร็จ",
      updated_assessment_id: assessment_id,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: "Failed to update supervisor assessment status" });
  }
};
const updateAssessmentStatusRetryNotPassed = async (req, res) => {
  const { assessment_id } = req.body;


  try {
    const updateQuery = `
      UPDATE assessments
      SET status = 'passed'
      WHERE assessment_id = ? `;

    const [updateResult] = await pool.query(updateQuery, [assessment_id]);

    if (updateResult.affectedRows === 0) {
      return res.status(200).json({
        message: "assessment not found or already completed",
      });
    }

    return res.status(200).json({
      message: "อัปเดตสถานะการประเมินเป็น 'passed' สำเร็จ",
      updated_assessment_id: assessment_id,
    });
  } catch (error) {
    console.error(error);
    res
      .status(500)
      .json({ error: "Failed to update supervisor assessment status" });
  }
};
// ====================================================================================================================================================================================
// For Supervisor

const getAssessmentsForSupervisor = async (req, res) => {
  const { child_id, aspect, supervisor_id, childAgeInMonths } = req.params;

  try {
    console.log("child_id: ", child_id);
    console.log("aspect: ", aspect);
    console.log("supervisor_id: ", supervisor_id);
    console.log("childAgeInMonths: ", childAgeInMonths);

    const ageInMonths = parseInt(childAgeInMonths, 10);
    const tableName = `assessment_details`;

    // ✅ ค้นหาการประเมินล่าสุดของเด็กใน aspect นี้
    const query = `
      SELECT a.supervisor_assessment_id, a.assessment_date, ad.assessment_rank, a.status
      FROM assessment_supervisor a
      JOIN ${tableName} ad ON a.assessment_details_id = ad.assessment_details_id
      WHERE a.child_id = ? AND ad.aspect = ?
      ORDER BY ad.assessment_rank DESC LIMIT 1
    `;
    const [rows] = await pool.query(query, [child_id, aspect]);

    // ✅ กรณีไม่มีการประเมินเลย → สร้างการประเมินใหม่
    if (rows.length === 0) {
      const defaultQuery = `
        SELECT assessment_details_id, aspect, assessment_rank, assessment_name, age_range
        FROM ${tableName}
        WHERE aspect = ?
        ORDER BY assessment_rank ASC
      `;
      const [defaultAssessments] = await pool.query(defaultQuery, [aspect]);

      const defaultAssessment = defaultAssessments.find((assessment) => {
        const [start, end] = assessment.age_range.split("-").map(Number);
        return ageInMonths >= start && ageInMonths <= end;
      });

      if (!defaultAssessment) {
        return res
          .status(404)
          .json({ error: "ไม่พบข้อมูลการประเมินสำหรับด้านที่ระบุ" });
      }

      const insertQuery = `
        INSERT INTO assessment_supervisor (child_id, assessment_rank, aspect, status, supervisor_id, assessment_details_id)
        VALUES (?, ?, ?, 'in_progress', ?, ?)
      `;
      const [result] = await pool.query(insertQuery, [
        child_id,
        defaultAssessment.assessment_rank,
        aspect,
        supervisor_id,
        defaultAssessment.assessment_details_id,
      ]);

      const assessmentDetailsQuery = `
        SELECT * FROM ${tableName}
        WHERE assessment_rank = ? AND aspect = ?
      `;
      const [assessmentDetails] = await pool.query(assessmentDetailsQuery, [
        defaultAssessment.assessment_rank,
        aspect,
      ]);

      return res.status(201).json({
        message: "เริ่มต้นการประเมินใหม่สำหรับ Supervisor",
        data: {
          supervisor_assessment_id: result.insertId,
          child_id,
          assessment_rank: defaultAssessment.assessment_rank,
          aspect: defaultAssessment.aspect,
          assessment_name: defaultAssessment.assessment_name,
          status: "in_progress",
          assessment_date: new Date().toISOString(),
          details: assessmentDetails[0],
        },
      });
    }

    // ✅ กรณีมี `in_progress` → คืนค่าการประเมินปัจจุบัน
    const inProgressAssessments = rows.filter(
      (row) => row.status === "in_progress"
    );

    if (inProgressAssessments.length > 0) {
      const inProgressAssessment = inProgressAssessments
        .sort((a, b) => a.assessment_rank - b.assessment_rank)
        .pop();

      const assessmentDetailsQuery = `
        SELECT * FROM ${tableName}
        WHERE assessment_rank = ? AND aspect = ?
      `;
      const [assessmentDetails] = await pool.query(assessmentDetailsQuery, [
        inProgressAssessment.assessment_rank,
        aspect,
      ]);

      return res.status(200).json({
        message: "กำลังดำเนินการประเมิน",
        data: {
          supervisor_assessment_id:
            inProgressAssessment.supervisor_assessment_id,
          assessment_date: inProgressAssessment.assessment_date,
          ...inProgressAssessment,
          details: assessmentDetails[0],
        },
      });
    }

    // ✅ กรณีมี `passed_all` → ส่ง `null` ใน `assessmentDetails`
    const passedAllAssessments = rows.filter(
      (row) => row.status === "passed_all"
    );

    if (passedAllAssessments.length > 0) {
      return res.status(200).json({
        message: "การประเมินเสร็จสมบูรณ์สำหรับ aspect นี้",
        data: {
          supervisor_assessment_id: null,
          child_id,
          assessment_rank: null,
          aspect,
          assessment_name: null,
          status: "passed_all",
          assessment_date: null,
          details: null, // ✅ ส่ง `null`
        },
      });
    }

    // ✅ กรณีมี `not_passed`
    const notPassedAssessments = rows.filter(
      (row) => row.status === "not_passed"
    );

    if (notPassedAssessments.length > 0) {
      const latestNotPassed = notPassedAssessments.pop();

      const assessmentDetailsQuery = `
        SELECT * FROM ${tableName}
        WHERE assessment_rank = ? AND aspect = ?
      `;
      const [assessmentDetails] = await pool.query(assessmentDetailsQuery, [
        latestNotPassed.assessment_rank,
        aspect,
      ]);

      return res.status(200).json({
        message: "การประเมินสถานะ 'not_passed'",
        data: {
          supervisor_assessment_id: latestNotPassed.supervisor_assessment_id,
          child_id,
          assessment_rank: latestNotPassed.assessment_rank,
          aspect,
          assessment_name: assessmentDetails[0]?.assessment_name || null,
          status: "not_passed",
          assessment_date: latestNotPassed.assessment_date,
          details: assessmentDetails[0] || null,
        },
      });
    }

    return res.status(404).json({
      message:
        "ไม่พบการประเมินที่อยู่ในสถานะ 'in_progress', 'passed_all' หรือ 'not_passed'",
    });
  } catch (error) {
    console.error("Error fetching supervisor assessments:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลการประเมินสำหรับ Supervisor",
    });
  }
};

const updateSupervisorAssessment = async (req, res) => {
  const { supervisor_assessment_id } = req.params;

  if (!supervisor_assessment_id) {
    return res
      .status(400)
      .json({ message: "supervisor_assessment_id is required" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // ✅ 1. ดึงสถานะล่าสุด
    const [currentStatus] = await connection.query(
      `SELECT status FROM assessment_supervisor WHERE supervisor_assessment_id = ? LIMIT 1`,
      [supervisor_assessment_id]
    );

    // ✅ 2. ถ้าสถานะเดิมเป็น 'not_passed' อยู่แล้ว ไม่ต้องอัปเดตซ้ำ
    if (currentStatus.length > 0 && currentStatus[0].status === "not_passed") {
      connection.release();
      return res
        .status(200)
        .json({ message: "Already 'not_passed', no update performed." });
    }

    // ✅ 3. อัปเดตสถานะเป็น 'not_passed'
    const [updateResult] = await connection.query(
      `UPDATE assessment_supervisor 
       SET status = "not_passed", assessment_date = NOW() 
       WHERE supervisor_assessment_id = ?`,
      [supervisor_assessment_id]
    );

    connection.release();

    // ✅ 4. ตรวจสอบว่ามีการอัปเดตจริงหรือไม่
    if (updateResult.affectedRows === 0) {
      return res
        .status(404)
        .json({ message: "ไม่พบการประเมิน หรืออัปเดตไม่สำเร็จ" });
    }

    return res.status(200).json({
      message: "อัปเดตสถานะเป็น 'not_passed' สำเร็จ",
      supervisor_assessment_id,
    });
  } catch (error) {
    console.error("Error updating supervisor assessment:", error);
    return res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการอัปเดตการประเมิน" });
  } finally {
    if (connection) connection.release();
  }
};

const fetchNextAssessmentSupervisor = async (req, res) => {
  const { supervisor_assessment_id, supervisor_id } = req.body;
  const { child_id, aspect } = req.params;

  try {
    // ✅ อัปเดตการประเมินปัจจุบันเป็น 'passed'
    const updateQuery = `
      UPDATE assessment_supervisor
      SET status = 'passed'
      WHERE supervisor_assessment_id = ? AND (status = 'in_progress' OR status = 'not_passed')
    `;
    const [updateResult] = await pool.query(updateQuery, [
      supervisor_assessment_id,
    ]);

    if (updateResult.affectedRows === 0) {
      return res.status(404).json({
        message: "ไม่พบการประเมินหรือเสร็จสิ้นแล้ว",
      });
    }

    // ✅ ค้นหา assessment_details_id ปัจจุบัน
    const getAssessmentDetailsIdQuery = `
      SELECT assessment_details_id 
      FROM assessment_supervisor 
      WHERE supervisor_assessment_id = ?
    `;
    const [assessmentDetailsIdResult] = await pool.query(
      getAssessmentDetailsIdQuery,
      [supervisor_assessment_id]
    );

    if (!assessmentDetailsIdResult.length) {
      return res.status(404).json({
        message: "ไม่พบ assessment_details_id สำหรับ assessment นี้",
      });
    }

    const assessmentDetailsId =
      assessmentDetailsIdResult[0].assessment_details_id;

    // ✅ ค้นหา assessment_rank ปัจจุบัน
    const rankQuery = `
      SELECT assessment_rank 
      FROM assessment_details 
      WHERE assessment_details_id = ?
    `;
    const [rankResult] = await pool.query(rankQuery, [assessmentDetailsId]);

    if (!rankResult.length) {
      return res.status(404).json({ message: "ไม่พบรายละเอียดการประเมิน" });
    }

    const assessmentRank = rankResult[0].assessment_rank;

    // ✅ ค้นหา assessment ถัดไป
    const nextAssessmentQuery = `
      SELECT ad.assessment_details_id AS assessment_detail_id, ad.aspect, ad.assessment_rank, ad.assessment_name
      FROM assessment_details ad
      WHERE ad.assessment_rank > ? AND ad.aspect = ?
      ORDER BY ad.assessment_rank ASC
      LIMIT 1
    `;
    const [nextAssessment] = await pool.query(nextAssessmentQuery, [
      assessmentRank,
      aspect,
    ]);

    if (nextAssessment.length > 0) {
      // ✅ สร้าง assessment ถัดไปเป็น `in_progress`
      const insertQuery = `
        INSERT INTO assessment_supervisor (child_id, assessment_details_id, assessment_rank, aspect, status, supervisor_id)
        VALUES (?, ?, ?, ?, 'in_progress', ?)
      `;
      const [result] = await pool.query(insertQuery, [
        child_id,
        nextAssessment[0].assessment_detail_id,
        nextAssessment[0].assessment_rank,
        aspect,
        supervisor_id,
      ]);

      // ✅ ดึงรายละเอียดของ assessment ใหม่
      const assessmentDetailsQuery = `
        SELECT * FROM assessment_details
        WHERE assessment_rank = ? AND aspect = ?
      `;
      const [assessmentDetails] = await pool.query(assessmentDetailsQuery, [
        nextAssessment[0].assessment_rank,
        aspect,
      ]);

      return res.status(201).json({
        message: "สร้างและโหลดการประเมินถัดไปสำเร็จ",
        next_assessment: {
          supervisor_assessment_id: result.insertId,
          child_id,
          supervisor_id,
          assessment_rank: nextAssessment[0].assessment_rank,
          aspect: nextAssessment[0].aspect,
          assessment_name: nextAssessment[0].assessment_name,
          status: "in_progress",
          assessment_date: new Date().toISOString(),
          details: assessmentDetails[0],
        },
      });
    } else {
      // ✅ ถ้าไม่มี assessment ถัดไป → อัปเดตเป็น `passed_all`
      const updateLastAssessmentQuery = `
        UPDATE assessment_supervisor
        SET status = 'passed_all'
        WHERE supervisor_assessment_id = ?
      `;
      await pool.query(updateLastAssessmentQuery, [supervisor_assessment_id]);

      return res.status(200).json({
        message:
          "ผ่านการประเมินและไม่มีการประเมินเพิ่มเติมสำหรับ aspect นี้ (passed_all)",
        next_assessment: {
          supervisor_assessment_id: null,
          child_id,
          supervisor_id,
          assessment_rank: null,
          aspect,
          assessment_name: null,
          status: "passed_all",
          assessment_date: null,
          details: null,
        },
      });
    }
  } catch (error) {
    console.error("Error fetching next assessment for supervisor:", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลการประเมินถัดไปสำหรับ Supervisor",
    });
  }
};

const updateAssessmentStatusNotPassed = async (req, res) => {
  const { supervisor_assessment_id } = req.body;

  try {
    // ✅ อัปเดตสถานะเป็น 'not_passed'
    const updateQuery = `
      UPDATE assessment_supervisor
      SET status = 'not_passed'
      WHERE supervisor_assessment_id = ? AND status = 'in_progress'
    `;
    const [updateResult] = await pool.query(updateQuery, [
      supervisor_assessment_id,
    ]);

    if (updateResult.affectedRows === 0) {
      return res.status(200).json({
        message: "assessment not found or already completed",
      });
    }

    return res.status(200).json({
      message: "อัปเดตสถานะการประเมินเป็น 'not_passed' สำเร็จ",
      supervisor_assessment_id,
      new_status: "not_passed",
    });
  } catch (error) {
    console.error("Error updating assessment status to 'not_passed':", error);
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการอัปเดตสถานะการประเมินเป็น 'not_passed'",
    });
  }
};

const getSupervisorAssessmentsAllData = async (req, res) => {
  const { supervisor_id } = req.params;

  try {
    const query = `
      WITH LatestStatus AS (
        SELECT 
          a.child_id,
          c.firstName AS child_first_name,
          c.lastName AS child_last_name,
          c.nickName AS child_nickname,
          c.birthday,
          c.gender,
          c.childPic,
          a.aspect,
          a.status,
          d.age_range,
          TIMESTAMPDIFF(MONTH, c.birthday, CURDATE()) AS child_age_months,  
          ROW_NUMBER() OVER (PARTITION BY a.child_id, a.aspect ORDER BY a.assessment_date DESC) AS row_num
        FROM assessment_supervisor a
        JOIN children c ON a.child_id = c.child_id  
        JOIN assessment_details d ON a.assessment_details_id = d.assessment_details_id  
        WHERE a.supervisor_id = ?
      )
      SELECT 
        aspect,
        SUM(
          CASE 
            WHEN status IN ('in_progress', 'not_passed', 'passed_all') 
                 AND (
                   (age_range REGEXP '^[0-9]+-[0-9]+$' 
                   AND child_age_months < CAST(SUBSTRING_INDEX(age_range, ' - ', -1) AS UNSIGNED)) 
                   OR (age_range REGEXP '^[0-9]+$'
                   AND child_age_months < CAST(age_range AS UNSIGNED))
                 ) 
            THEN 1 ELSE 0 
          END
        ) AS passed_count,
        SUM(
          CASE 
            WHEN status = 'not_passed' 
                 AND (
                   (age_range REGEXP '^[0-9]+-[0-9]+$' 
                   AND child_age_months >= CAST(SUBSTRING_INDEX(age_range, ' - ', -1) AS UNSIGNED)) 
                   OR (age_range REGEXP '^[0-9]+$'
                   AND child_age_months >= CAST(age_range AS UNSIGNED))
                 ) 
            THEN 1 ELSE 0 
          END
        ) AS not_passed_count,
        JSON_ARRAYAGG(
          CASE 
            WHEN status = 'not_passed' 
            AND (
                   (age_range REGEXP '^[0-9]+-[0-9]+$' 
                   AND child_age_months >= CAST(SUBSTRING_INDEX(age_range, ' - ', -1) AS UNSIGNED)) 
                   OR (age_range REGEXP '^[0-9]+$'
                   AND child_age_months >= CAST(age_range AS UNSIGNED))
                 ) 
            THEN JSON_OBJECT(
              'child_id', child_id,
              'firstName', child_first_name,
              'lastName', child_last_name,
              'nickName', child_nickname,
              'birthday', birthday,
              'gender', gender,
              'childPic', childPic,
              'age_months', child_age_months
            )
            ELSE NULL 
          END
        ) AS not_passed_children
      FROM LatestStatus
      WHERE row_num = 1
      GROUP BY aspect
      ORDER BY aspect ASC;
    `;

    const [results] = await pool.query(query, [supervisor_id]);

    if (results.length === 0) {
      return res.status(200).json({
        message: "No assessments found for this supervisor.",
        data: [],
      });
    }

    res.status(200).json({
      message: "Supervisor assessments retrieved successfully.",
      data: results,
    });
  } catch (error) {
    console.error("Error fetching supervisor assessments:", error);
    res
      .status(500)
      .json({ error: "Failed to retrieve supervisor assessments" });
  }
};

const getSupervisorAssessmentsAllDataMoreDetails = async (req, res) => {
  const { supervisor_id } = req.params;

  if (!supervisor_id) {
    return res.status(400).json({ message: "ต้องระบุ Supervisor ID" });
  }

  try {
    const query = `
    WITH ChildAssessmentDetails AS (
      SELECT 
        a.child_id,
        c.firstName,
        c.lastName,
        c.nickName,
        c.birthday,
        a.supervisor_id,
        a.aspect,
        a.status,
        d.age_range,
        d.assessment_name,
        d.assessment_image,
        TIMESTAMPDIFF(MONTH, c.birthday, CURDATE()) AS child_age_months
      FROM assessment_supervisor a
      JOIN children c ON a.child_id = c.child_id
      JOIN assessment_details d ON a.assessment_details_id = d.assessment_details_id
      WHERE a.supervisor_id = ?
    )
    SELECT 
      aspect,
      age_range,
      COUNT(CASE WHEN status = 'passed' THEN 1 END) AS passed_count,
      COUNT(CASE WHEN status = 'not_passed' THEN 1 END) AS not_passed_count
    FROM ChildAssessmentDetails
    GROUP BY aspect, age_range
    ORDER BY aspect ASC, age_range;
  `;

    const [results] = await pool.query(query, [supervisor_id]);

    if (results.length === 0) {
      return res.status(200).json({
        message: "No assessments found for this supervisor.",
        data: [],
      });
    }

    res.status(200).json({
      message: "Supervisor assessments retrieved successfully.",
      data: results,
    });
  } catch (error) {
    console.error("Error fetching supervisor assessments:", error);
    res
      .status(500)
      .json({ error: "Failed to retrieve supervisor assessments" });
  }
};

// Get Assessment Last For a Child for Supervisor
const getAssessmentsByChildForSupervisor = async (req, res) => {
  const { supervisor_id, child_id } = req.params;

  if (!supervisor_id || !child_id) {
    return res
      .status(400)
      .json({ message: "supervisor_id and child_id required" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // ✅ ดึงข้อมูลเด็กที่ Supervisor ดูแล
    const [childRows] = await connection.execute(
      `SELECT * FROM children 
       JOIN supervisor_children ON children.child_id = supervisor_children.child_id 
       WHERE children.child_id = ? AND supervisor_children.supervisor_id = ?`,
      [child_id, supervisor_id]
    );

    if (childRows.length === 0) {
      return res
        .status(404)
        .json({ message: "ไม่พบข้อมูลเด็กสำหรับ supervisor" });
    }

    // ✅ ดึงการประเมินล่าสุดของแต่ละ `aspect`
    const [assessments] = await connection.execute(
      `SELECT a.supervisor_assessment_id AS assessment_id, 
              a.assessment_rank, a.aspect, 
              a.assessment_details_id, a.assessment_date, a.status 
       FROM assessment_supervisor a 
       WHERE a.child_id = ? AND a.supervisor_id = ?
             AND (a.assessment_rank = (
               SELECT MAX(assessment_rank) 
               FROM assessment_supervisor 
               WHERE child_id = a.child_id AND aspect = a.aspect
             ))
       ORDER BY a.aspect ASC, a.assessment_rank DESC`,
      [child_id, supervisor_id]
    );

    // ✅ ดึงรายละเอียดของ assessment_details
    for (let i = 0; i < assessments.length; i++) {
      const [details] = await connection.execute(
        `SELECT * FROM assessment_details WHERE assessment_details_id = ?`,
        [assessments[i].assessment_details_id]
      );
      assessments[i].details = details.length > 0 ? details[0] : null;
    }

    connection.release();

    return res.status(200).json({
      message: "ดึงข้อมูลการประเมินล่าสุดของเด็กแต่ละด้านสำเร็จ",
      supervisor_id,
      child: {
        ...childRows[0],
        assessments,
      },
    });
  } catch (error) {
    console.error(
      "Error fetching latest child assessment data for supervisor:",
      error
    );
    return res.status(500).json({
      message: "เกิดข้อผิดพลาดในการดึงข้อมูลการประเมินสำหรับ Supervisor",
    });
  } finally {
    if (connection) connection.release();
  }
};

// getAssessmentsByChildPRforSP
const getAssessmentsByChildPRforSP = async (req, res) => {
  const { child_id } = req.params;

  if (!child_id) {
    return res.status(400).json({ message: "child_id is required" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // ✅ ค้นหา parent_id จาก child_id
    const [parentRows] = await connection.execute(
      `SELECT parent_id 
       FROM parent_children 
       WHERE child_id = ? 
       LIMIT 1`,
      [child_id]
    );

    if (parentRows.length === 0) {
      return res.status(404).json({ message: "ไม่พบ parent ของเด็กคนนี้" });
    }

    const parent_id = parentRows[0].parent_id;

    // ✅ ดึงข้อมูลเด็ก
    const [childRows] = await connection.execute(
      `SELECT * FROM children WHERE child_id = ?`,
      [child_id]
    );

    if (childRows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลเด็ก" });
    }

    // ✅ ดึงข้อมูลการประเมิน
    const [assessments] = await connection.execute(
      `SELECT a.assessment_id, a.assessment_rank, a.aspect, 
              a.assessment_details_id, a.assessment_date, a.status 
       FROM assessments a 
       WHERE a.child_id = ? AND (a.status = 'in_progress' OR a.status = 'passed_all')`,
      [child_id]
    );

    // ✅ ดึงรายละเอียดของ assessment_details
    for (let i = 0; i < assessments.length; i++) {
      const [details] = await connection.execute(
        `SELECT * FROM assessment_details WHERE assessment_details_id = ?`,
        [assessments[i].assessment_details_id]
      );
      assessments[i].details = details.length > 0 ? details[0] : null;
    }

    connection.release();

    return res.status(200).json({
      message: "ดึงข้อมูลการประเมินของเด็กสำเร็จ (โดย Supervisor ผ่าน Parent)",
      parent_id,
      child: {
        ...childRows[0],
        assessments,
      },
    });
  } catch (error) {
    console.error("Error fetching child assessment data:", error);
    return res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการดึงข้อมูลการประเมิน" });
  } finally {
    if (connection) connection.release();
  }
};

// ====================================================================================================================================================================================

const getAssessmentsByChildHistory = async (req, res) => {
  const { child_id, aspect } = req.params;
  const { supervisor_id, parent_id } = req.body;

  if (!child_id || !aspect) {
    return res
      .status(400)
      .json({ message: "child_id และ aspect จำเป็นต้องระบุ" });
  }

  let connection;
  try {
    connection = await pool.getConnection();

    // ✅ 1. ตรวจสอบสิทธิ์ว่าใครเป็นคนดึงข้อมูล
    if (supervisor_id) {
      const [check] = await connection.execute(
        `SELECT * FROM supervisor_children WHERE supervisor_id = ? AND child_id = ?`,
        [supervisor_id, child_id]
      );
      if (check.length === 0) {
        return res.status(403).json({
          message: "ไม่มีสิทธิ์เข้าถึงข้อมูลเด็กสำหรับ supervisor นี้",
        });
      }
    } else if (parent_id) {
      const [check] = await connection.execute(
        `SELECT * FROM parent_children WHERE parent_id = ? AND child_id = ?`,
        [parent_id, child_id]
      );
      if (check.length === 0) {
        return res
          .status(403)
          .json({ message: "ไม่มีสิทธิ์เข้าถึงข้อมูลเด็กสำหรับ parent นี้" });
      }
    } else {
      return res.status(400).json({
        message: "ต้องระบุ supervisor_id หรือ parent_id อย่างน้อยหนึ่งอย่าง",
      });
    }

    // ✅ 2. ดึงข้อมูลเด็ก
    const [childRows] = await connection.execute(
      `SELECT * FROM children WHERE child_id = ?`,
      [child_id]
    );
    if (childRows.length === 0) {
      return res.status(404).json({ message: "ไม่พบข้อมูลเด็ก" });
    }

    // ✅ 3. ดึงประวัติการประเมินจากตารางที่เหมาะสม
    let assessments = [];
    if (supervisor_id) {
      [assessments] = await connection.execute(
        `SELECT a.supervisor_assessment_id AS assessment_id,
                a.assessment_rank, a.assessment_details_id, 
                a.assessment_date, a.status
         FROM assessment_supervisor a
         WHERE a.child_id = ? AND a.supervisor_id = ? AND a.aspect = ?
         ORDER BY a.assessment_date DESC`,
        [child_id, supervisor_id, aspect]
      );
    } else if (parent_id) {
      [assessments] = await connection.execute(
        `SELECT a.assessment_id,
                a.assessment_rank, a.assessment_details_id, 
                a.assessment_date, a.status
         FROM assessments a
         WHERE a.child_id = ? AND a.aspect = ?
         ORDER BY a.assessment_date DESC`,
        [child_id, aspect]
      );
    }

    // ✅ 4. ดึงรายละเอียดของ assessment_details
    for (let i = 0; i < assessments.length; i++) {
      const [details] = await connection.execute(
        `SELECT * FROM assessment_details WHERE assessment_details_id = ?`,
        [assessments[i].assessment_details_id]
      );
      assessments[i].details = details.length > 0 ? details[0] : null;
    }

    connection.release();

    return res.status(200).json({
      message: "ดึงประวัติการประเมินของเด็กสำเร็จ",
      child: {
        ...childRows[0],
        assessments,
      },
    });
  } catch (error) {
    console.error("Error fetching child assessment history:", error);
    return res
      .status(500)
      .json({ message: "เกิดข้อผิดพลาดในการดึงประวัติการประเมิน" });
  } finally {
    if (connection) connection.release();
  }
};

module.exports = {
  getAssessmentsByAspect,
  getAssessmentsByChild,
  updateAssessmentStatus,
  fetchNextAssessment,
  getAssessmentsForSupervisor,
  updateSupervisorAssessment,
  fetchNextAssessmentSupervisor,
  getSupervisorAssessmentsAllData,
  getAssessmentsAllChild,
  getAssessmentsByChildForSupervisor,
  updateAssessmentStatusNotPassed,
  getSupervisorAssessmentsAllDataMoreDetails,
  getAssessmentsByChildPRforSP,
  getAssessmentsByChildHistory,
};
