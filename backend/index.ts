/**
 * SCHEMA BARREL INDEX
 *
 * Single import point for the full schema.
 * Usage in your app:
 *   import { user, candidate, application, ... } from "@/schema"
 *
 * Usage in drizzle.config.ts:
 *   schema: "./src/schema/index.ts"
 *
 * Module order matches implementation priority:
 *   01 Platform      → plans, subscriptions
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
 */

// ── Module 01: Platform ───────────────────────────────────────
export {
  plan,
  subscription,
  planStatusEnum,
  subscriptionStatusEnum,
  billingCycleEnum,
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
