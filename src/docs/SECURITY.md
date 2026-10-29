# Security

## Authentication Architecture [Implemented]

- **Strategy**: JWT Access Tokens + Opaque/JWT Refresh Tokens.
- **Token Rotation**: Refresh tokens are rotated upon use to prevent replay attacks.
- **Invalidation**: Refresh tokens are stored in the database (`refresh_tokens` table) to allow immediate revocation on logout or security breach.

## Authorization [Implemented]

- **API Guards**: Middleware enforces authorization at the action level.
- **Frontend Protection**: Protected routes and UI elements render dynamically based on the current user's evaluated permissions.

## Hardening & Protection [Implemented]

- **OWASP Guidelines**: The platform is built following the OWASP Top 10 recommendations.
- **Rate Limiting**: Applied globally and strictly on authentication endpoints to prevent brute force attacks.
- **Helmet**: Secures HTTP headers.
- **CORS**: Strict configuration limiting allowed origins, methods, and headers.
- **CSRF**: Mitigations are in place for cookie-based or session-based attacks (though standard JWT via Bearer headers bypasses most CSRF concerns natively).

## Audit Trails [Implemented]

- **Audit Logs**: An immutable `audit_logs` table records every sensitive action (login, role assignment, permission change, deletion).
- **Hash Chain**: Each record stores the SHA-256 hash of the previous record. Records are chained and verified in `sequence` order, and chain writes take a Postgres advisory lock so two writers can never link to the same record. `npm run audit:verify` walks the chain and reports the first broken record.
- **Log Structure**: Actions log the `userId`, `action`, `resource`, `status`, `ipAddress`, `userAgent`, and generic `details` JSON (e.g., method, URL, and status code).

## Structured Logging [Implemented]

- **Pino**: High-performance structured JSON logging.
- **Tracing**: Every request receives a unique `Trace ID` / `Correlation ID` that is passed through logs and down to database errors to enable rapid incident response.

## Automated Security Checking [Implemented]

To enforce security during development and within CI/CD pipelines, the project executes automated static analysis and dependency vulnerability testing:

- **Command**: `npm run security:check` executes both dependency analysis and SAST checks.
- **Dependency Audit**: `npm run audit` scans the dependency tree for known CVEs and high/critical issues.
- **SAST (Static Application Security Testing)**: `eslint-plugin-security` is integrated directly into the ESLint configuration, auditing code pattern issues (e.g., regex DOS vectors, unsafe input parsing, dangerous execution contexts, object injection).
