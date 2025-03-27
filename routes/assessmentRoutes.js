// assessmentRoutes.js
const express = require("express");
const router = express.Router();

const assessmentController = require("../controllers/assessmentController");

// const { protect, restrictTo } = require("../controllers/authController");

// ============ Parent Routes =================

// Route to fetch assessment details by child_id and aspect
router.get(
  "/assessments-get-details/:child_id/:aspect/:user_id/:childAgeInMonths",
  assessmentController.getAssessmentsByAspect
);

// Route to fetch the next assessment for a child
router.post(
  "/assessments-next/:child_id/:aspect",
  assessmentController.fetchNextAssessment
);

// Route to fetch assessments for a child "in_progress"
router.get(
  "/assessments-child/:parent_id/:child_id",
  assessmentController.getAssessmentsByChild
);

// Route to update an assessment result and get next assessment
router.post(
  "/assessments-update-status/:child_id/:aspect",
  assessmentController.updateAssessmentStatus
);

// ============ Supervisor Routes =================

// Route to fetch assessment details by child_id and aspect
router.get(
  "/assessments-get-details-supervisor/:child_id/:aspect/:supervisor_id/:childAgeInMonths",
  assessmentController.getAssessmentsForSupervisor
);

// Route to update assessment status
router.post(
  "/assessments-update-status-supervisor/:child_id/:aspect",
  assessmentController.updateSupervisorAssessment
);

// Route to fetch the next assessment
router.post(
  "/assessments-next-supervisor/:child_id/:aspect",
  assessmentController.fetchNextAssessmentSupervisor
);

// Route for not_passed
router.post(
  "/assessments-not-passed-supervisor",
  assessmentController.updateAssessmentStatusNotPassed
);

// Route to fetch all assessments for a supervisor
router.get(
  "/assessments-data-supervisor/:supervisor_id",
  assessmentController.getSupervisorAssessmentsAllData
);

//
router.get(
  "/assessments-data-supervisor-more/:supervisor_id",
  assessmentController.getSupervisorAssessmentsAllDataMoreDetails
);

// Route to getAssessmentsByChildForSupervisor
router.get(
  "/assessments-child-supervisor/:supervisor_id/:child_id",
  assessmentController.getAssessmentsByChildForSupervisor
);

// Route to getAssessmentsByChildPRforSP
router.get(
  "/assessments-child-supervisor-pr/:child_id",
  assessmentController.getAssessmentsByChildPRforSP
);

router.post(
  "/assessments-history/:child_id/:aspect",
  assessmentController.getAssessmentsByChildHistory
);

module.exports = router;
