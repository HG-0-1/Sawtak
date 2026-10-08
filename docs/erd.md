# Entity relationship diagram

```mermaid
erDiagram
  ADMINS ||--o{ ADMIN_SESSIONS : owns
  ADMINS ||--o{ AUDIT_LOG : writes
  VOTING_ROUNDS ||--o{ VOTES : contains
  VISITORS ||--o{ VISITOR_SESSIONS : owns
  VISITORS ||--o{ VOTES : casts
  CATEGORIES ||--o{ EXHIBITOR_CATEGORIES : assigns
  EXHIBITORS ||--o{ EXHIBITOR_CATEGORIES : assigns
  EXHIBITOR_CATEGORIES ||--o{ VOTES : validates
  VOTES ||--o| VOTE_VOIDS : may_have
  ADMINS ||--o{ VOTE_VOIDS : creates
  DISPLAY_TOKENS ||--o{ DISPLAY_SESSIONS : exchanges
```

`visitors.phone_enc` is ciphertext only; `phone_hash` is the unique peppered HMAC lookup. `votes.signals` contains coarse policy outcomes and distance/accuracy, never raw location.
