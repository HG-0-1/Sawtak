# Decisions

## ADR-001: rotating QR rather than a static visitor key

**Context.** A static QR can be photographed and forwarded. **Decision.** The display requests a server-generated HMAC token tied to a 60-second window and the visitor redeems it immediately. **Consequences.** A forwarded code expires quickly; it does not eliminate a live relay, so STRICT mode also requires IP or geofence evidence.

## ADR-002: OTP remains mandatory

**Context.** QR presence alone does not establish uniqueness. **Decision.** Name, phone and SMS OTP create the visitor session; production blocks mock SMS. **Consequences.** The event needs a tested SMS provider and fallback plan; there is no OTP bypass.

## ADR-003: no mandatory booth

**Context.** Booth queues harm the zero-instruction flow. **Decision.** Two or more screens show the rotating QR; greeters are optional. **Consequences.** The operations runbook requires redundant screens.

## ADR-004: SSE for results

**Context.** TV clients only need server-to-client result snapshots. **Decision.** SSE is simpler than WebSockets and automatically reconnects. **Consequences.** The display keeps the last snapshot and falls back to periodic reconnects.

## ADR-005: Postgres is the invariant boundary

**Decision.** Votes, sessions, settings and audit data are persisted in Postgres. A unique constraint and composite foreign key protect ballot validity even under concurrent API requests. **Consequences.** App nodes stay stateless; `pg_notify` is emitted on a committed vote.

## ADR-006: votes are append-only; reset creates a round

**Decision.** Database triggers reject vote UPDATE/DELETE. Void and reset operations create compensating records/new rounds. **Consequences.** Tallies exclude voids and history remains auditable.

## ADR-007: encrypted phone plus keyed lookup hash

**Decision.** E.164 numbers are AES-256-GCM encrypted and a peppered HMAC provides uniqueness/search. **Consequences.** PII export needs elevated access. The identity-to-vote relationship is a necessary privacy trade-off in this client brief; no UI reveals who voted for whom.

## ADR-008: Fastify + React rather than Prisma

**Decision.** This prototype uses Fastify, zod, React/Vite and parameterized `pg` SQL directly. **Consequences.** Critical DDL constraints stay explicit in raw SQL, reducing ORM abstraction risk for the demo; migrations remain simple SQL files.
