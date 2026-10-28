# ADR 0001: Modular Monolith to Microservices Path

## Status

Accepted

## Context

The platform requires an enterprise-grade architecture that can scale massively in the future. Starting with microservices introduces premature operational complexity (network latency, distributed transactions, complex CI/CD), while a traditional monolith can become a "big ball of mud," hindering future scaling.

## Decision

We will build the system as a **Modular Monolith**.

- The application will deploy as a single unit.
- Internally, the codebase will be strictly divided into independent domain modules (e.g., `users`, `roles`, `permissions`, `audit`).
- Modules will communicate via explicit Service APIs or internal Event Emitters, never via direct cross-module database joins.

## Consequences

- **Positive:** Deployment is simple. Transactions can be easily maintained across modules if strictly necessary (though discouraged). Developer velocity is high.
- **Positive:** Because domains are strictly segregated at the code level, extracting a module into its own microservice in the future will only require changing the communication layer (from an internal method call / event to an HTTP/gRPC / Message Broker call).
- **Negative:** Requires extreme discipline. Developers might be tempted to bypass boundaries or make cross-module DB queries. This must be caught in code review.
