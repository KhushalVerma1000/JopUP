# Refactor and Implement Multi-Tenant HR Platform Backend

We will refactor the existing flat Express backend into a professional, industry-standard, feature-based directory structure using Zod for request validation, custom error-handling middlewares, and clean separation of concerns (Routes -> Controllers -> Services -> Repositories/Models).

## Proposed Architecture

We will organize the code under a **feature-based folder structure**, where each domain has its own directory containing its routes, controllers, services, schemas, and tests.

```text
backend/
├── server.js               # Application entry point
├── src/
│   ├── app.js              # Express app setup and middleware registration
│   ├── config/             # Environment variables and configurations
│   ├── middlewares/        # Global middlewares (error handler, validation, multi-tenancy)
│   │   ├── errorHandler.js
│   │   ├── validate.js
│   │   └── tenant.js
│   ├── utils/              # Helper utilities and custom errors
│   │   └── errors.js
│   └── features/           # Feature-based modular code
│       ├── organizations/  # Tenants management
│       │   ├── organization.controller.js
│       │   ├── organization.service.js
│       │   ├── organization.schema.js
│       │   └── organization.routes.js
│       ├── candidates/     # Candidates management
│       ├── teams/          # Teams management
│       ├── clients/        # Clients management
│       └── plans/          # Subscription plans
└── test/                   # Feature-specific and integration test suite
```

### Components and Separation of Concerns

1. **Schemas (`*.schema.js`)**: Define Zod validation schemas for request bodies, query parameters, and URL route parameters.
2. **Routes (`*.routes.js`)**: Declare API routes and hook them to specific validation middleware and controller handlers.
3. **Controllers (`*.controller.js`)**: Handle HTTP request parsing, trigger validation, delegate business logic to services, and return responses.
4. **Services (`*.service.js`)**: House the core business logic (e.g. validating limits, checking modules).
5. **Repositories/Data-Store**: Interface with the database or in-memory arrays.

---

## Proposed Changes

### Configuration and Setup

- Add `zod` for schema validation.
- Add `express-async-errors` to handle async errors in Express routes cleanly.

### Core App & Middlewares

- **`validate.js`**: A reusable middleware factory that validates request body, query, or params against a Zod schema.
- **`errorHandler.js`**: Global middleware to format validation errors (Zod) and other custom errors.
- **`tenant.js`**: Middleware to extract and set the `tenant_id` (or `organization_id`) context for the request.

### Feature Folders

- **`features/organizations/`**: Organization logic.
- **`features/candidates/`**: Candidate logic.
- **`features/teams/`**: Team logic.
- **`features/clients/`**: Client logic.
- **`features/plans/`**: Plans logic.

---

## Verification Plan

### Automated Tests
- Run `npm test` to verify that all the refactored endpoints return exact expected results.
- Add unit tests for controllers and validation schemas using standard node testing.
