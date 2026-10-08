# Event-day runbook

## Local phone demo

- Start the demo with `.\scripts\start-demo.ps1`; use the printed Wi-Fi/LAN address on both the phone and the QR display. `localhost` only works on the computer running the app.
- If Windows Firewall blocks the phone, run this once in an Administrator PowerShell. It allows only the web port from devices on the local subnet:

  ```powershell
  New-NetFirewallRule -DisplayName 'MC2026 Demo Web (LAN)' -Direction Inbound -Action Allow -Protocol TCP -LocalPort 5173 -RemoteAddress LocalSubnet -Profile Any
  ```

- Open the printed visitor URL or scan the refreshed QR. Both lead to the registration screen, including if that browser had a previous voter session.

## T-24 hours

- Verify TLS/domain, Postgres backup, SMS sender and delivery on two Jordanian carriers.
- Confirm category/exhibitor data, approved consent wording, display tokens, venue CIDR/geofence and `STRICT` policy.
- Test QR redemption, OTP, all three ballots, dashboard SSE and an admin export.

## T-2 hours

- Mount two QR displays and one results display; open each with its own display session/token.
- Verify the code rotates, display URL is correct, TVs retain a last result if the network is briefly disconnected.
- Keep a second connected admin device and a hotspot as a fallback.

## Doors open

- In admin, validate access settings, then set voting `OPEN`.
- Watch OTP request/verification ratio, error rate and venue queue. Never bypass OTP.

## Failure playbooks

| Failure | Action |
|---|---|
| QR screen fails | Direct visitors to another display; replace device. Use STANDARD/QR_ONLY only after an audited operator decision. |
| SMS delay/outage | Pause voting; use contracted fallback provider. Do not weaken OTP. |
| Results screen disconnects | Keep the last view; dashboard reconnects. Reload after confirming API health. |
| Suspected abuse | Block the visitor, preserve evidence, review audit log; void only with documented reason. |
| API/DB health fails | Pause voting, preserve logs, restore service, retry only idempotently. |

## Close and after

Set voting to `CLOSED`, export CSV/JSON, record checksum and admin identity, announce winner from the final export, retain a database backup, and schedule the approved PII retention/anonymization process.
