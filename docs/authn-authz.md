# Authentication and authorization

| Principal | Authentication | Permissions |
|---|---|---|
| Visitor | Short presence session + phone OTP + HttpOnly visitor session | List makers; one vote per active category. |
| Display | Random display token exchanged once for a HttpOnly display session | QR and/or protected results according to token kind. |
| Viewer | Planned admin session with VIEWER role | Read-only operations views. |
| Admin | Argon2id password + opaque session | Directory, voting control, results export. |
| Super admin | Admin session; MFA step-up is a production extension | Settings, reset, PII export and display-token management. |

Cookies are signed, HttpOnly, `SameSite=Lax`, path `/`, and `Secure` in production. API mutations should be same-origin and carry a custom request header when the production CSRF middleware is added. Session identifiers are random and only SHA-256 hashes are stored.

Current prototype note: the schema reserves the MFA fields; TOTP setup/verification and step-up enforcement are tracked as P1 work before a pilot.
