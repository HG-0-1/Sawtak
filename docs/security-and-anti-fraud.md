# Security and anti-fraud

## Layered controls

1. **Presence:** HMAC-signed, short-lived QR codes are redeemed into a limited presence cookie.
2. **Venue policy:** `STRICT` requires presence and an enabled IP or geolocation pass; the check is re-run on every vote.
3. **Identity:** a normalized mobile number must complete OTP; hash uniqueness makes one phone one visitor.
4. **Database:** a unique vote constraint and exhibitor/category foreign key reject races and malformed choices.
5. **Operations:** admin audit events, visitor blocking and append-only vote history support response.

## Residual risks

Live QR relays, multiple SIMs and mocked GPS remain residual risks. They are reduced by the layers above but cannot be claimed eliminated. QR-only emergency mode is weaker and should be an audited event-day decision.

## Security checklist before a real event

- Replace `SMS_PROVIDER=mock` and test throughput/failover.
- Configure real TLS, DNS, `Secure` cookies, HSTS at the proxy and CSP without relaxed directives.
- Configure venue CIDRs and/or exact approved geofence. Set access mode to `STRICT`.
- Generate random production key rings in a secret manager; never reuse `.env.example` values.
- OTP sends are limited to five per normalized phone number per hour across initial requests and resends; the Postgres-backed send log serializes concurrent requests for the same number.
- Keep edge/IP rate limiting in addition to the per-phone OTP limit, backed by the production gateway or Redis/Postgres.
- Run dependency audit, integration race test, header scan and authorized load test.
- Enable MFA and super-admin step-up before PII export/reset is available to staff.
