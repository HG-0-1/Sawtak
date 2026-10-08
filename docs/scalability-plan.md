# Scalability plan

## Design intent

The target is 1,000 concurrent/total participants with p95 vote latency below 500 ms and display propagation below two seconds. This has not yet been load-tested; it is a design target, not a measured claim.

API nodes are stateless. Use two or more nodes behind a load balancer, a small connection pool per node, Postgres indexes on vote tallies, settings/category cache, CDN/object storage for images, and cross-node results fan-out through Postgres `LISTEN/NOTIFY` or Redis. Rate counters should be distributed for production.

## Required evidence before pilot

- Journey ramp to 1,000 VUs using a mock SMS adapter.
- 200 parallel requests for the same voter/category: exactly one row and one success/idempotent response.
- Competing selections: exactly one accepted, remaining responses conflict.
- 1,000 SSE clients; measure memory, reconnect rate and update lag.
- Kill one API instance during voting; verify retry and no duplicate ballots.

Record p50/p95/p99, error rate, database CPU/connection count and host memory under `docs/scalability-plan/` with the command and deployment revision. Do not present the target as an achieved result without these artifacts.
