/**
 * DEMO / TEST SEED — one login for every role, plus realistic data.
 *
 * NOT for production. Run AFTER the base seed (`npm run db:seed`), which
 * creates the roles and plans this script depends on.
 *
 *   npm run db:seed:demo            # idempotent: skips orgs that already exist
 *   npm run db:seed:demo -- --reset # deletes the demo orgs, then re-creates them
 *
 * Every account uses the same password (DEMO_PASSWORD below), so testing a
 * role is just "sign in as <email>". The login table is printed at the end.
 */
import "dotenv/config";

import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { eq, inArray } from "drizzle-orm";
import bcrypt from "bcryptjs";
import * as schema from "./schema";

const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const db = drizzle(pool, { schema });

const DEMO_PASSWORD = "Password123!";
const RESET = process.argv.includes("--reset");

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000);
const daysAhead = (n: number) => new Date(Date.now() + n * 86_400_000);

type Login = { org: string; role: string; email: string; note?: string };
const logins: Login[] = [];

// ─── Demo organisations ──────────────────────────────────────

type OrgSpec = {
  slug: string;
  name: string;
  plan: "starter" | "pro" | "enterprise";
  status: "trialing" | "active" | "suspended" | "cancelled";
  createdDaysAgo: number;
  trialEndsInDays?: number;
  country: string;
  full?: boolean; // seed clients/candidates/jobs/trackers too
};

const ORGS: OrgSpec[] = [
  { slug: "acme-recruiting", name: "Acme Recruiting", plan: "pro", status: "active", createdDaysAgo: 150, country: "IN", full: true },
  { slug: "northwind-staffing", name: "Northwind Staffing", plan: "starter", status: "trialing", createdDaysAgo: 11, trialEndsInDays: 3, country: "IN", full: true },
  { slug: "globex-talent", name: "Globex Talent", plan: "enterprise", status: "active", createdDaysAgo: 75, country: "US" },
  { slug: "initech-hr", name: "Initech HR", plan: "starter", status: "suspended", createdDaysAgo: 40, country: "GB" },
];

async function main() {
  console.log("🎭 Seeding demo data...\n");
  const passwordHash = await bcrypt.hash(DEMO_PASSWORD, 10);

  const roles = await db.select().from(schema.role);
  const roleId = (name: string) => {
    const r = roles.find((x) => x.name === name);
    if (!r) throw new Error(`Role '${name}' missing — run \`npm run db:seed\` first`);
    return r.id;
  };
  const plans = await db.select().from(schema.plan);
  const planBySlug = (slug: string) => {
    const p = plans.find((x) => x.slug === slug);
    if (!p) throw new Error(`Plan '${slug}' missing — run \`npm run db:seed\` first`);
    return p;
  };

  if (RESET) {
    const slugs = ["jopup-platform", ...ORGS.map((o) => o.slug)];
    // Deleting an organisation cascades to its rows, but a few user->user
    // foreign keys (assigned_by, approved_by...) are NO ACTION and block the
    // cascade depending on delete order. Clearing the access grants first
    // (they reference users) lets the org delete go through cleanly.
    const orgRows = await db.select({ id: schema.organisation.id }).from(schema.organisation).where(inArray(schema.organisation.slug, slugs));
    const orgIds = orgRows.map((o) => o.id);
    if (orgIds.length) {
      const userRows = await db.select({ id: schema.user.id }).from(schema.user).where(inArray(schema.user.organisationId, orgIds));
      const userIds = userRows.map((u) => u.id);
      if (userIds.length) {
        await db.delete(schema.userTeamRole).where(inArray(schema.userTeamRole.userId, userIds));
        await db.update(schema.user).set({ approvedBy: null, rejectedBy: null }).where(inArray(schema.user.id, userIds));
      }
      await db.delete(schema.organisation).where(inArray(schema.organisation.id, orgIds));
    }
    console.log("  ↺ removed existing demo organisations\n");
  }

  async function exists(slug: string) {
    const [o] = await db.select({ id: schema.organisation.id }).from(schema.organisation).where(eq(schema.organisation.slug, slug));
    return !!o;
  }

  async function makeUser(orgId: string, email: string, first: string, last: string, status: "active" | "pending_approval" = "active", extra: Record<string, unknown> = {}) {
    const [u] = await db.insert(schema.user).values({
      organisationId: orgId, email, passwordHash, firstName: first, lastName: last, status,
      lastLoginAt: status === "active" ? daysAgo(Math.floor(Math.random() * 6)) : null,
      ...extra,
    }).returning();
    return u;
  }
  const grant = (userId: string, role: string, teamId: string | null, by: string) =>
    db.insert(schema.userTeamRole).values({ userId, teamId, roleId: roleId(role), assignedBy: by });

  // ── Platform staff ─────────────────────────────────────────
  if (!(await exists("jopup-platform"))) {
    const plan = planBySlug("enterprise");
    const [platformOrg] = await db.insert(schema.organisation).values({
      planId: plan.id, name: "JopUP Platform", slug: "jopup-platform", status: "active", timezone: "UTC",
    }).returning();
    const owner = await makeUser(platformOrg.id, "owner@jopup.dev", "Priya", "Owner");
    await grant(owner.id, "platform_owner", null, owner.id);
    const padmin = await makeUser(platformOrg.id, "padmin@jopup.dev", "Sam", "Support");
    await grant(padmin.id, "platform_admin", null, owner.id);
    logins.push(
      { org: "Platform", role: "platform_owner", email: owner.email, note: "manages platform admins" },
      { org: "Platform", role: "platform_admin", email: padmin.email },
    );
    console.log("  ✓ platform staff");
  } else console.log("  • platform org exists — skipped");

  // ── Tenants ────────────────────────────────────────────────
  for (const spec of ORGS) {
    if (await exists(spec.slug)) { console.log(`  • ${spec.slug} exists — skipped`); continue; }
    const plan = planBySlug(spec.plan);
    const created = daysAgo(spec.createdDaysAgo);

    const [org] = await db.insert(schema.organisation).values({
      planId: plan.id, name: spec.name, slug: spec.slug, status: spec.status,
      trialEndsAt: spec.trialEndsInDays ? daysAhead(spec.trialEndsInDays) : null,
      timezone: "UTC", defaultCountry: spec.country, createdAt: created, updatedAt: created,
    }).returning();

    await db.insert(schema.creditAccount).values({
      organisationId: org.id, balance: plan.creditAllowance, lifetimeEarned: plan.creditAllowance, lifetimeSpent: 0,
    });
    await db.insert(schema.subscription).values({
      organisationId: org.id, planId: plan.id,
      status: spec.status === "active" ? "active" : spec.status === "trialing" ? "trialing" : "cancelled",
      paymentProvider: null, currentPeriodStart: created,
      currentPeriodEnd: spec.trialEndsInDays ? daysAhead(spec.trialEndsInDays) : daysAhead(20),
      trialEndsAt: spec.trialEndsInDays ? daysAhead(spec.trialEndsInDays) : null,
      createdAt: created,
    });

    const short = spec.slug.split("-")[0];
    const admin = await makeUser(org.id, `admin@${short}.test`, "Alex", "Admin");
    await grant(admin.id, "org_admin", null, admin.id);
    logins.push({ org: spec.name, role: "org_admin", email: admin.email });

    if (!spec.full) { console.log(`  ✓ ${spec.slug} (admin only)`); continue; }

    // Teams ───────────────────────────────────────────────────
    const teamNames = spec.slug.startsWith("acme") ? ["Tech Hiring", "Sales Hiring"] : ["Operations Staffing"];
    const teams = [];
    for (const name of teamNames) {
      const [t] = await db.insert(schema.team).values({ organisationId: org.id, name, description: `${name} desk`, createdAt: created }).returning();
      teams.push(t);
    }

    // Staff: 1 manager + HR per team ──────────────────────────
    const staff: { team: typeof teams[number]; manager: typeof admin; hrs: typeof admin[] }[] = [];
    const people = spec.slug.startsWith("acme")
      ? [
          { m: ["manager.tech", "Meera", "Nair"], hr: [["hr.tech", "Rohan", "Shah"], ["hr.tech2", "Isha", "Verma"]] },
          { m: ["manager.sales", "Karan", "Mehta"], hr: [["hr.sales", "Neha", "Kulkarni"]] },
        ]
      : [{ m: ["manager", "Devika", "Rao"], hr: [["hr", "Arjun", "Iyer"]] }];

    for (let i = 0; i < teams.length; i++) {
      const p = people[i];
      const manager = await makeUser(org.id, `${p.m[0]}@${short}.test`, p.m[1], p.m[2]);
      await grant(manager.id, "manager", teams[i].id, admin.id);
      logins.push({ org: spec.name, role: `manager (${teams[i].name})`, email: manager.email });
      const hrs = [];
      for (const [local, f, l] of p.hr) {
        const hr = await makeUser(org.id, `${local}@${short}.test`, f, l);
        await grant(hr.id, "hr", teams[i].id, manager.id);
        logins.push({ org: spec.name, role: `hr (${teams[i].name})`, email: hr.email });
        hrs.push(hr);
      }
      staff.push({ team: teams[i], manager, hrs });
    }

    // Pending self-registrations (approval queue) ─────────────
    await makeUser(org.id, `new.hr@${short}.test`, "Tanvi", "Joshi", "pending_approval", {
      requestedTeamId: teams[0].id, requestedRoleId: roleId("hr"),
    });
    await makeUser(org.id, `new.manager@${short}.test`, "Vikram", "Sethi", "pending_approval", {
      requestedTeamId: teams[0].id, requestedRoleId: roleId("manager"),
    });
    logins.push({ org: spec.name, role: "pending approval", email: `new.hr@${short}.test`, note: "cannot sign in until approved" });

    // Same person in two orgs → exercises the workspace picker at login.
    if (short === "acme" || short === "northwind") {
      const multi = await makeUser(org.id, "multi@demo.test", "Maya", "Multi");
      await grant(multi.id, "hr", teams[0].id, admin.id);
      logins.push({ org: spec.name, role: "hr", email: "multi@demo.test", note: "exists in Acme AND Northwind → shows workspace picker" });
    }

    // Workflow templates + stages ─────────────────────────────
    const STAGES = [
      ["Applied", "applied"], ["Screening", "screening"], ["Lineup", "lineup"],
      ["Interview", "interview"], ["Offer", "offer"], ["Joined", "joined"],
    ];
    const stageMap = new Map<string, { templateId: string; stages: { id: string; key: string }[] }>();
    for (const s of staff) {
      const [tpl] = await db.insert(schema.workflowTemplate).values({
        organisationId: org.id, teamId: s.team.id, createdBy: s.manager.id, name: "Standard hiring", isDefault: true,
      }).returning();
      const stages = [];
      for (let i = 0; i < STAGES.length; i++) {
        const [st] = await db.insert(schema.workflowStage).values({
          workflowTemplateId: tpl.id, name: STAGES[i][0], stageKey: STAGES[i][1], orderIndex: (i + 1) * 10,
          requiresApproval: STAGES[i][1] === "offer", isFinalSuccess: STAGES[i][1] === "joined",
        }).returning();
        stages.push({ id: st.id, key: st.stageKey });
      }
      stageMap.set(s.team.id, { templateId: tpl.id, stages });
    }

    // Clients, positions, jobs, candidates, trackers ──────────
    const CLIENTS = [
      ["Zenith Fintech", "Financial Services"], ["Orbit Logistics", "Logistics"],
      ["Lumen Health", "Healthcare"], ["Vertex Retail", "Retail"],
    ];
    const ROLES_FOR = [
      ["Senior Backend Engineer", "Bengaluru", "5-8 years", ["Node.js", "PostgreSQL", "AWS"]],
      ["Frontend Developer", "Pune", "2-4 years", ["React", "TypeScript", "CSS"]],
      ["Sales Executive", "Mumbai", "1-3 years", ["B2B sales", "CRM", "Negotiation"]],
      ["Operations Analyst", "Hyderabad", "Fresher - 2 years", ["Excel", "SQL", "Reporting"]],
    ];
    const NAMES = [
      ["Aarav", "Kapoor"], ["Diya", "Menon"], ["Kabir", "Singh"], ["Ananya", "Reddy"], ["Ishaan", "Gupta"],
      ["Saanvi", "Bhat"], ["Vihaan", "Desai"], ["Myra", "Pillai"], ["Reyansh", "Joshi"], ["Anika", "Chopra"],
      ["Arnav", "Malhotra"], ["Kiara", "Bose"], ["Dhruv", "Naidu"], ["Tara", "Sinha"],
    ];
    const SOURCES = ["job_post", "manual", "referral", "linkedin", "agency", "resume_upload"] as const;

    let n = 0;
    for (let ti = 0; ti < staff.length; ti++) {
      const s = staff[ti];
      const flow = stageMap.get(s.team.id)!;

      const clients = [];
      for (let c = 0; c < 2; c++) {
        const [cl, ind] = CLIENTS[(ti * 2 + c) % CLIENTS.length];
        const [row] = await db.insert(schema.client).values({
          organisationId: org.id, ownerTeamId: s.team.id, createdBy: s.manager.id, companyName: cl, industry: ind,
          contactName: "Priya Contact", contactEmail: `hiring@${cl.split(" ")[0].toLowerCase()}.example`,
          website: `https://${cl.split(" ")[0].toLowerCase()}.example`, status: "active",
          sharedOrgWide: c === 0 && ti === 0, createdAt: daysAgo(30 + c * 10),
        }).returning();
        clients.push(row);
      }

      const positions = [];
      for (let p = 0; p < 2; p++) {
        const [designation, loc, exp, skills] = ROLES_FOR[(ti * 2 + p) % ROLES_FOR.length] as [string, string, string, string[]];
        const [op] = await db.insert(schema.openPosition).values({
          organisationId: org.id, teamId: s.team.id, clientId: clients[p].id, createdBy: s.manager.id,
          designation, location: loc, experienceRequired: exp, vacancies: 2 + p, status: "open", createdAt: daysAgo(20 - p * 5),
        }).returning();
        positions.push(op);
        await db.insert(schema.jobPosting).values({
          organisationId: org.id, teamId: s.team.id, clientId: clients[p].id, createdBy: s.hrs[0].id, openPositionId: op.id,
          workflowTemplateId: flow.templateId, title: designation,
          description: `We are hiring a ${designation} for our client in ${loc}. Join a fast-growing team and own meaningful work.`,
          requirements: `${exp} of relevant experience.`, location: loc, workMode: p === 0 ? "hybrid" : "onsite",
          employmentType: "full_time", salaryMin: "8", salaryMax: "16", salaryCurrency: "INR",
          requiredSkills: skills, vacancies: 2 + p, status: "published", publishedAt: daysAgo(15 - p * 3),
        });
      }

      // ~7 candidates per team, spread across stages
      for (let c = 0; c < 7; c++) {
        const [first, last] = NAMES[n % NAMES.length];
        const hr = s.hrs[c % s.hrs.length];
        const [cand] = await db.insert(schema.candidate).values({
          organisationId: org.id, ownerTeamId: s.team.id, createdBy: hr.id,
          firstName: first, lastName: last, email: `${first}.${last}${n}@mail.example`.toLowerCase(),
          phone: `98${String(10000000 + n * 137).slice(0, 8)}`, phoneCountry: "IN",
          location: ["Bengaluru", "Pune", "Mumbai", "Hyderabad"][n % 4], source: SOURCES[n % SOURCES.length],
          skills: (ROLES_FOR[n % ROLES_FOR.length][3] as string[]), status: "active",
          createdAt: daysAgo(25 - c * 3),
        }).returning();
        n++;

        // 5 of 7 get a live tracker at varying stages
        if (c < 5) {
          const stageIdx = [0, 1, 2, 3, 4][c];
          const status = c === 4 ? "on_hold" : "active";
          const [tr] = await db.insert(schema.candidateTracker).values({
            organisationId: org.id, teamId: s.team.id, candidateId: cand.id, openPositionId: positions[c % 2].id,
            workflowTemplateId: flow.templateId, assignedHr: hr.id, status,
            interviewDate: stageIdx === 3 ? daysAhead(2) : null, lineupDate: stageIdx === 2 ? daysAhead(1) : null,
            createdAt: daysAgo(18 - c * 2),
          }).returning();
          await db.insert(schema.candidateTrackerStageLog).values({
            trackerId: tr.id, stageId: flow.stages[stageIdx].id, movedBy: hr.id,
            status: status === "on_hold" ? "held" : "active", enteredAt: daysAgo(6 - c),
            // A held stage is closed (mirrors trackers.service holdTracker), so it has no "current" stage.
            exitedAt: status === "on_hold" ? daysAgo(1) : null,
          });
        }
      }
    }
    console.log(`  ✓ ${spec.slug} (teams, staff, clients, positions, jobs, candidates, trackers)`);
  }

  // ── Login sheet ────────────────────────────────────────────
  console.log(`\n🔑 Demo logins — password for all: ${DEMO_PASSWORD}\n`);
  const w = Math.max(...logins.map((l) => l.email.length));
  for (const l of logins) {
    console.log(`  ${l.email.padEnd(w)}  ${l.role.padEnd(26)} ${l.org}${l.note ? `  — ${l.note}` : ""}`);
  }
  console.log("\n✅ Demo seed complete.");
  await pool.end();
}

main().catch(async (err) => {
  console.error("Demo seed failed:", err);
  await pool.end();
  process.exit(1);
});
