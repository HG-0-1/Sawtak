# Maker Collective 2026 technical write-up

Maker Collective needs an award flow that works for a busy, mixed-skill audience while making off-site voting materially harder. This prototype replaces manual ballots with a visitor-first mobile flow: a visitor scans a rotating on-site QR, verifies a Jordanian mobile number, and casts one vote in each database-driven category. A high-contrast TV dashboard reports counts live while an admin console runs the event.

The core idea is layered proof. A rotating HMAC QR is short-lived physical-presence evidence; an IP/geolocation policy is checked at registration and vote time; OTP-verified mobile uniqueness reduces duplicate identities; database constraints then make race conditions and double ballots impossible to accept. This is intentionally honest about residual risks such as a live QR relay, several SIMs, and spoofable location. Those risks are reduced and logged, not claimed solved.

The stack is React/Vite, Fastify/TypeScript and PostgreSQL. The app tier is stateless, allowing multiple API instances. Postgres persists session hashes, configuration, audit records, encrypted phone fields and append-only votes. Each vote is transactionally linked to a valid exhibitor/category pair and constrained to one row per round/visitor/category. Results are sent through SSE, a good match for displays that only receive data.

For the pilot, deploy behind TLS on an approved domain, use two API instances and managed Postgres, select an SMS provider, configure venue boundaries and enforce STRICT policy. Run load and failover drills before event day. The UI deliberately has three personalities: warm mobile cards for visitors, stark Vercel-inspired venue displays, and a dense but calm operations console for staff.
