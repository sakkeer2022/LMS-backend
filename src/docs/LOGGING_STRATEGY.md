# Logging & Observability Strategy

## Overview

Logging is not just for debugging; it is a critical security and compliance feature. We use **Pino** to output structured JSON logs.

## Correlation & Trace IDs

Every incoming HTTP request is assigned a `traceId` (UUID) via middleware.
This ID is attached to the Request context and passed down to Services and Repositories.
If an error occurs deep in the DB layer, the resulting log includes the `traceId`, allowing us to search Kibana/Datadog and see the exact lifecycle of the request.

## Log Categories & JSON Schemas

### 1. Request Logging

Logged automatically by `pino-http` middleware on API entry and exit.

```json
{
  "level": "info",
  "type": "request",
  "traceId": "req-1234-abcd",
  "method": "POST",
  "url": "/api/v1/users",
  "statusCode": 201,
  "responseTimeMs": 45
}
```

### 2. Auth & Security Logging

Explicitly logged during login attempts, token refreshes, and unauthorized access attempts.

```json
{
  "level": "warn",
  "type": "security",
  "traceId": "req-1234-abcd",
  "event": "FAILED_LOGIN",
  "email": "admin@example.com",
  "ipAddress": "192.168.1.1",
  "reason": "Invalid password"
}
```

### 3. Audit Logging (Business Level)

While stored in the `audit_logs` SQL table for UI display, critical changes are ALSO emitted to the JSON logger for SIEM (Security Information and Event Management) ingestion.

```json
{
  "level": "info",
  "type": "audit",
  "traceId": "req-1234-abcd",
  "actorId": "user-999",
  "action": "ROLE_ASSIGNED",
  "resource": "user-888",
  "status": "success",
  "changes": { "roleAdded": "admin" }
}
```

### 4. Database Error Logging

Catching ORM/SQL errors. Redacts sensitive data but includes the exact query failure.

```json
{
  "level": "error",
  "type": "db_error",
  "traceId": "req-1234-abcd",
  "errorCode": "ER_DUP_ENTRY",
  "query": "INSERT INTO users...",
  "stack": "..."
}
```
