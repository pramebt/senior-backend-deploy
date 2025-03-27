// assessmentDetailsController.js
const { pool } = require("../config/db");

// Function to fetch assessment details for a given `assessment_id`
const getAssessmentDetails = async (req, res) => {
  const { assessment_id } = req.query;

  if (!assessment_id) {
    return res.status(400).json({ error: "assessment_id is required" });
  }

  try {
    const query = `
      SELECT 
        assessment_id,
        aspect,
        assessment_rank,
        assessment_name,
        assessment_image,
        assessment_device_name,
        assessment_device_image,
        assessment_device_detail,
        assessment_method,
        assessment_sucession
      FROM assessment_details
      WHERE assessment_id = ?
    `;

    const [rows] = await pool.query(query, [assessment_id]);

    if (rows.length === 0) {
      return res.status(404).json({ error: "No assessment details found" });
    }

    res.status(200).json({ assessmentDetails: rows });
  } catch (error) {
    console.error("Error fetching assessment details:", error);
    res.status(500).json({ error: "Failed to fetch assessment details" });
  }
};

module.exports = {
  getAssessmentDetails,
};
