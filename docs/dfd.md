# Data flow diagram

```mermaid
flowchart LR
  Phone[Visitor] -->|QR token| Presence[Presence redemption]
  Presence -->|signed cookie| Registration[Name + phone + OTP]
  Registration -->|encrypted phone / hash| DB[(Postgres)]
  Registration -->|SMS code| SMS[SMS provider]
  Phone -->|visitor cookie + category choice| Vote[Vote transaction]
  Vote --> DB
  DB -->|result notification| Results[SSE display]
  Admin -->|admin cookie| Operations[Admin API]
  Operations --> DB
```

Trust boundaries are browser↔TLS gateway, gateway↔API, and API↔external SMS/object storage. PII crosses only from registration to the API and encrypted database field; raw OTP and precise location must not enter logs.
