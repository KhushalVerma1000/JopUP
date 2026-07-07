# Backend Refactoring Walkthrough

## What Was Done

The flat, single-file Express backend (`src/app.js`) was refactored into a professional, industry-standard **feature-based architecture** with Zod validation, centralized error handling, and multi-tenant request scoping.

---

## Final Folder Structure

```
backend/
├── server.js                           # Entry point – starts the HTTP server
├── src/
│   ├── app.js                          # Express app setup, middleware + route registration
│   ├── utils/
│   │   ├── errors.js                   # Custom HTTP error classes (NotFoundError, BadRequestError …)
│   │   └── db.js                       # In-memory mock database (swap with real DB anytime)
│   ├── middlewares/
│   │   ├── validate.js                 # Zod schema validation middleware factory
│   │   ├── errorHandler.js             # Centralized global error handler
│   │   └── tenant.js                   # Multi-tenant context extractor (x-tenant-id header)
│   └── features/
│       ├── plans/
│       │   ├── plans.routes.js
│       │   ├── plans.controller.js
│       │   └── plans.service.js
│       ├── organizations/
│       │   ├── organization.routes.js
│       │   ├── organization.controller.js
│       │   ├── organization.service.js
│       │   └── organization.schema.js  # Zod schema for POST /organizations
│       ├── candidates/
│       │   ├── candidates.routes.js
│       │   ├── candidates.controller.js
│       │   └── candidates.service.js
│       ├── teams/
│       │   ├── teams.routes.js
│       │   ├── teams.controller.js
│       │   └── teams.service.js
│       ├── clients/
│       │   ├── clients.routes.js
│       │   ├── clients.controller.js
│       │   └── clients.service.js
│       └── workflow/
│           ├── workflow.routes.js
│           ├── workflow.controller.js
│           └── workflow.service.js
└── test/
    └── app.test.js                     # Integration tests (9 tests, all passing)
```

---

## Key Design Decisions

### 1. Feature-Based Folder Structure
Each domain (`plans`, `organizations`, `candidates`, etc.) owns its own `routes → controller → service` stack. This means adding a new feature is isolated and doesn't touch any other domain's files.

### 2. Zod Validation Middleware
A reusable `validate(schema)` middleware factory validates `req.body`, `req.query`, and `req.params` against any Zod schema before the request reaches a controller. Invalid requests are rejected immediately with a structured `400 Bad Request` response.

```js
// Example: organization.routes.js
router.post('/', validate(createOrganizationSchema), organizationController.createOrganization);
```

### 3. Centralized Error Handler
All errors — whether thrown by services, controllers, or middlewares — flow to a single `errorHandler.js` middleware. `express-async-errors` ensures async errors are captured automatically without try/catch blocks in every route.

**Error response format:**
```json
{
  "status": "fail",
  "message": "Validation failed: name: String must contain at least 1 character(s)"
}
```

### 4. Multi-Tenancy via `x-tenant-id` Header
The `tenant.js` middleware reads the `x-tenant-id` HTTP header and attaches it to `req.tenantId`. Services use this to scope queries to the correct organization — preventing cross-tenant data leaks.

```http
GET /api/candidates
x-tenant-id: org-1
```

### 5. In-Memory Database (`utils/db.js`)
All seeded data lives in a shared `db.js` module. The architecture is structured so any service can be swapped to a real database (PostgreSQL with Prisma, MongoDB, etc.) by simply updating its service file without touching routes or controllers.

---

## API Endpoints

| Method | Endpoint               | Description                      | Validation     |
|--------|------------------------|----------------------------------|----------------|
| GET    | `/api/health`          | Server health check              | —              |
| GET    | `/api/plans`           | List all subscription plans      | —              |
| GET    | `/api/organizations`   | List all organizations           | —              |
| POST   | `/api/organizations`   | Create a new organization        | Zod (name, slug) |
| GET    | `/api/candidates`      | List candidates (tenant-scoped)  | —              |
| GET    | `/api/teams`           | List teams (tenant-scoped)       | —              |
| GET    | `/api/clients`         | List clients (tenant-scoped)     | —              |
| GET    | `/api/workflow-stages` | List hiring workflow stages      | —              |

---

## Test Results

```
✅  9 tests passed, 0 failed
```

| # | Test                                           | Status |
|---|------------------------------------------------|--------|
| 1 | GET /api/health returns server status          | ✅ PASS |
| 2 | GET /api/plans returns seeded plans            | ✅ PASS |
| 3 | POST /api/organizations creates an org         | ✅ PASS |
| 4 | GET /api/candidates returns seeded candidates  | ✅ PASS |
| 5 | GET /api/teams returns seeded teams            | ✅ PASS |
| 6 | GET /api/clients returns seeded clients        | ✅ PASS |
| 7 | GET /api/workflow-stages returns stages        | ✅ PASS |
| 8 | POST /api/organizations fails on validation    | ✅ PASS |
| 9 | GET /api/candidates scopes by tenant context   | ✅ PASS |

---

## Running the Project

```bash
# Install dependencies
cd backend && npm install

# Start dev server (with hot reload)
npm run dev

# Run all tests
npm test
```

---

## Next Steps / Future Enhancements

- **Database Integration**: Replace `utils/db.js` with a Prisma + PostgreSQL setup
- **Authentication**: Add JWT-based auth middleware; extract `tenantId` from the JWT payload
- **Role-Based Access Control (RBAC)**: Add a permissions middleware to restrict endpoints
- **More Feature Schemas**: Add Zod schemas for `candidates`, `teams`, and `clients` creation
- **Logging**: Integrate a logger (e.g., `pino` or `winston`) for structured logging
- **API Versioning**: Prefix all routes with `/api/v1/` for forward compatibility
