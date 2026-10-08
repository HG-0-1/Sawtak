# Deployment

## Local development

1. Install Node 20+ and PostgreSQL 15+.
2. Copy `.env.example` to `.env`; point `DATABASE_URL` at Postgres.
3. Run `npm install && npm run db:migrate && npm run db:seed && npm run dev`.

## Compose

`docker compose up --build` starts Postgres, migrates/seeds from the API container and exposes nginx on port 8080. It is a local demo topology, not HA. Delete the named volume only when intentionally destroying all demo data.

## Production shape

Use a real domain/TLS proxy, two or more stateless API containers, managed HA Postgres with PITR, object storage/CDN, and an approved SMS provider. Run migrations as a one-off release job before moving traffic. Back up Postgres before updates; rollback the application image first, never delete votes to roll back.

Required production values: unique key rings, PII/OTP/IP peppers, `SMS_PROVIDER=http`, `STORAGE_DRIVER=s3`, public HTTPS base URL, trusted proxy policy, approved geofence/CIDRs and `access.policy=STRICT`. Boot refuses known unsafe demo settings.

## Backups and restore

Take encrypted logical dumps plus managed-PITR snapshots. Test restore into an isolated environment and validate `votes`, `vote_voids`, `settings` and `audit_log` counts. Restores are read-only until the event operator confirms the target round.
