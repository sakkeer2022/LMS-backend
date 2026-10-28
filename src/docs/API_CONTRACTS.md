# API Contracts

## Overview

All REST APIs in the platform must adhere to a strict, standardized JSON contract for both successful and error responses. This ensures consistency across mobile, web, and external consumers.

## Success Response [Implemented]

All `2xx` responses must follow this structure:

```json
{
  "success": true,
  "message": "A human-readable success message",
  "data": { ... }, // T - The generic payload
  "meta": {        // Optional metadata (e.g., pagination)
    "total": 100,
    "page": 1,
    "limit": 10
  }
}
```

## Error Response [Implemented]

All `4xx` and `5xx` responses must follow this structure. The `errors` object provides granular validation context if applicable, grouping messages by field name.

```json
{
  "success": false,
  "message": "A human-readable error summary",
  "errors": {
    "email": ["Invalid email format"]
  }
}
```

## Validation & DTOs [Implemented]

- Every request payload is validated using a **Zod** schema.
- The schema serves as the single source of truth for the payload definition, generating TypeScript types dynamically (`z.infer<typeof Schema>`).
- If validation fails, the global error handler intercepts the Zod error and automatically formats it into the standard Error Response above.

## OpenAPI & Swagger [Planned]

- API contracts will be documented using OpenAPI specifications.
- `swagger-jsdoc` and `swagger-ui-express` are utilized to auto-generate interactive documentation based on route annotations.
- API endpoints must be fully documented, including possible error codes, auth requirements, and response schemas.
