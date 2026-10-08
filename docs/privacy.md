# Privacy

| Data | Purpose | Storage / access | Retention default |
|---|---|---|---|
| Name | Voter identity and approved outreach | Postgres; admin only | 90 days after event |
| Phone | OTP, uniqueness and approved outreach | AES-GCM ciphertext plus peppered lookup HMAC | 90 days after event |
| Consent version/time | Evidence of consent | Postgres | With visitor record |
| Coarse policy signals | Fraud/venue enforcement | Vote JSON, no raw lat/lng | With vote audit record |
| Votes | Award integrity | Append-only Postgres | Retained for audit |

There are no analytics SDKs or third-party trackers in the web app. Admin screens mask phone numbers by default. Full PII export and data-subject handling must be enabled only for a named super-admin after MFA is implemented. The 90-day period, consent wording and outreach purpose need written CPF approval before event use.
