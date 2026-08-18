/**
 * SCHEMA BARREL INDEX
 *
 * Single import point for the full schema.
 * Usage in your app:
 *   const schema = require('./schema'); // CommonJS from compiled JS
 *
 * Usage in drizzle.config.ts:
 *   schema: "./src/schema/index.ts"
 *
 * Module order matches implementation priority:
 *   01 Platform      → plans, module registry, subscriptions
 *   02 Identity      → orgs, users, roles, teams
 *   03 Clients       → client management
 *   04 Candidates    → candidate database
 *   05 Job Postings  → vacancy listings
 *   06 Workflow      → pipeline templates + stages
 *   07 Pipeline      → applications, stage log, actions, documents
 *   08 Performance   → KPIs, reviews, goals, strategy
 *   09 Credits       → credit accounts, transactions, pricing
 *   10 Events/Audit  → event bus + audit log
 *   11 Job Portal    → public-facing job seeker tables
 *   12 Vendor        → vendor relationship ops (VRO)
 *   13 Finance       → invoicing, AR/AP (FinMa)
 *   14 Employee HR   → internal staff profiles, payroll (PowerEmp)
 *   15 Bench         → bench sales, prospect pipeline (BenchPro)
 *   16 Communication  → client SPOC directory + targeted mailer (trackers, updates)
 *
 * Modules 12–16 bring the schema in line with the full Vybog Tal
 * seven-module suite (Recruit, Parser, CRM, FinMa, PowerEmp, BenchPro,
 * EmailPro, VRO) — module 16 is scoped as a targeted SPOC/candidate
 * mailer (trackers, status updates, offer letters) rather than a bulk
 * marketing tool. Every module_key referenced by plan.modules or
 * org_module_override MUST have a corresponding module_definition row
 * (module 01) — that table is the single source of truth the
 * plan-builder / org-toggle UI renders from.
 */

// ── Module 01: Platform ───────────────────────────────────────
export {
  plan,
  subscription,
  moduleDefinition,
  planStatusEnum,
  subscriptionStatusEnum,
  billingCycleEnum,
  moduleCategoryEnum,
  moduleStatusEnum,
} from "./01-platform";

// ── Module 02: Identity & Access ─────────────────────────────
export {
  organisation,
  orgModuleOverride,
  team,
  user,
  role,
  userTeamRole,
  invitation,
  orgStatusEnum,
  userStatusEnum,
  roleScopeEnum,
  invitationStatusEnum,
} from "./02-identity";

// ── Module 03: Client Management ─────────────────────────────
export {
  client,
  clientTeamAccess,
  clientStatusEnum,
} from "./03-clients";

// ── Module 04: Candidate Database ────────────────────────────
export {
  candidate,
  candidateTeamAccess,
  candidateSourceEnum,
  candidateStatusEnum,
} from "./04-candidates";

// ── Module 05: Job Postings ───────────────────────────────────
export {
  jobPosting,
  jobStatusEnum,
  workModeEnum,
  employmentTypeEnum,
} from "./05-job-postings";

// ── Module 06: Workflow Engine ────────────────────────────────
export {
  workflowTemplate,
  workflowStage,
} from "./06-workflow";

// ── Module 07: Pipeline Tracker ───────────────────────────────
export {
  application,
  applicationStageLog,
  stageAction,
  document,
  applicationStatusEnum,
  stageLogStatusEnum,
  stageActionTypeEnum,
  documentTypeEnum,
} from "./07-pipeline";

// ── Module 08: Performance & Strategy ────────────────────────
export {
  kpiDefinition,
  kpiEntry,
  performanceReview,
  goal,
  teamStrategy,
  kpiFrequencyEnum,
  kpiDirectionEnum,
  reviewStatusEnum,
  goalStatusEnum,
  strategyStatusEnum,
} from "./08-performance";

// ── Module 09: Credits ────────────────────────────────────────
export {
  creditAccount,
  creditTransaction,
  creditCost,
  creditTransactionTypeEnum,
} from "./09-credits";

// ── Module 10: Events & Audit ─────────────────────────────────
export {
  eventLog,
  auditLog,
} from "./10-events-audit";

// ── Module 11: Job Portal ─────────────────────────────────────
export {
  jobSeeker,
  portalApplication,
  jobSeekerStatusEnum,
  portalApplicationStatusEnum,
} from "./11-job-portal";

// ── Module 12: Vendor Relationship Ops (VRO) ──────────────────
export {
  vendor,
  vendorDocument,
  vendorSlaLog,
  vendorRiskAlert,
  vendorCategoryEnum,
  vendorStatusEnum,
  vendorDocumentTypeEnum,
  riskAlertSeverityEnum,
} from "./12-vendor";

// ── Module 13: Finance & Invoicing (FinMa) ────────────────────
export {
  invoice,
  invoiceLineItem,
  payment,
  invoiceTypeEnum,
  invoiceStatusEnum,
  paymentMethodEnum,
} from "./13-finance";

// ── Module 14: Employee HR & Payroll (PowerEmp) ───────────────
export {
  employeeProfile,
  payrollRun,
  payrollEntry,
  employmentTypeInternalEnum,
  employeeStatusEnum,
  payrollRunStatusEnum,
  payrollEntryStatusEnum,
} from "./14-employee-hr";

// ── Module 15: Bench Sales (BenchPro) ─────────────────────────
export {
  benchProfile,
  benchProspect,
  benchActivityLog,
  benchAvailabilityEnum,
  benchHeatEnum,
  benchProspectStatusEnum,
  benchActivityTypeEnum,
} from "./15-bench";

// ── Module 16: Client & Candidate Communication (SPOC Mailer) ─
export {
  emailSenderIdentity,
  clientSpoc,
  clientInternalContact,
  trackerTemplate,
  tracker,
  emailTemplate,
  emailMessage,
  emailRecipient,
  emailAttachment,
  emailMessageReference,
  spocTypeEnum,
  spocStatusEnum,
  internalContactRoleEnum,
  trackerTypeEnum,
  emailMessageTypeEnum,
  emailMessageStatusEnum,
  emailRecipientRoleEnum,
  emailRecipientSourceEnum,
  emailRecipientStatusEnum,
  emailAttachmentSourceEnum,
} from "./16-client-communications";
