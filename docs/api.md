# API reference

All JSON errors use `application/problem+json` and expose a stable `code`.

| Endpoint | Purpose |
|---|---|
| `GET /healthz`, `GET /readyz` | Liveness and database readiness. |
| `GET /api/config/public` | Public event and voting state. |
| `POST /api/presence/redeem` | Redeem `{token}` into a signed presence cookie. |
| `POST /api/auth/otp/request`, `/verify` | Request / verify name, phone, consent and OTP. |
| `GET /api/categories`, `/api/me` | Directory and visitor progress. |
| `POST /api/votes` | Authenticated `{categoryId, exhibitorId, geo?}` ballot. |
| `GET /api/results`, `/stream` | Snapshot/SSE results for a verified visitor, display session, or admin (development is open for demo). |
| `POST /api/display/session`, `GET /api/display/qr` | Display token exchange and rotating QR URL. |
| `/api/admin/*` | Admin login, status, directory, settings, voting control and result export. |

See `docs/openapi.yaml` for the machine-readable starter specification.
