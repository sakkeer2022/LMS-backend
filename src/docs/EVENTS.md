# Events & Asynchronous Architecture

## Event-Driven Design

While initially a modular monolith, the architecture is designed to be **event-driven compatible**. High-latency operations and domain-spanning side effects are decoupled using domain events.

## Current Implementation

- Handled synchronously or asynchronously in-process via Node.js Event Emitters or a lightweight internal pub/sub service.
- Enables clear separation between modules (e.g., when a user is created in the `users` module, it emits a `USER_CREATED` event rather than directly calling the `email` module).

## Future Scalability

- **Message Brokers:** The internal pub/sub interface is abstracted. In the future, this can be swapped with RabbitMQ, Kafka, or AWS EventBridge without rewriting business logic.
- **Event Sourcing:** The system design accommodates future event sourcing implementations, specifically for maintaining historical timelines of permission changes and system states.

## Key Events

- `USER_REGISTERED`
- `ROLE_ASSIGNED`
- `PERMISSION_UPDATED`
- `TENANT_CREATED`
