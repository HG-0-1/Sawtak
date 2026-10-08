# Judge demo: QR presence and location verification

This guide shows how to demonstrate that the entrance QR is part of voter registration, then how the server checks whether a phone's reported location is consistent with the event venue.

## Important: choose the right access mode

The local demo is seeded with `access.policy.mode = "OFF"` so it can be tried without venue checks. In `OFF`, development mode accepts OTP requests without requiring either the QR or GPS. Switch the policy for the part you are demonstrating:

| Mode | What the server requires |
|---|---|
| `OFF` | No venue check (development only). |
| `QR_ONLY` | A valid, redeemed entrance QR. Does not check GPS. |
| `STANDARD` | A valid enabled network check (IP or GPS). Does not require the QR. |
| `STRICT` | A redeemed entrance QR **and** a valid enabled network check (IP or GPS). |

For the location demonstration, use `STRICT`, disable the IP check, and enable the geofence check. This makes the QR and GPS requirements independently visible. The seeded geofence is centered at `31.9539, 35.9106` (Amman), with a `250 m` radius and maximum reported accuracy of `120 m`; change these to the actual venue before presenting.

## Before the judges arrive

1. Start the demo with `.\scripts\start-demo.ps1 -UseDocker -Lan -OpenDisplays`.
2. Confirm the phone and demo computer can reach each other on the same Wi-Fi. On the phone, use the LAN host printed by the launcher or embedded in the QR. Do not switch between `localhost` and the LAN address: the presence and voter cookies belong to the host that set them.
3. **For a successful GPS check on a phone, serve the app over HTTPS with a certificate the phone trusts.** Mobile browsers generally block browser geolocation on an ordinary `http://<LAN-IP>` page because it is not a secure context. The current plain-HTTP LAN demo can show QR-only behavior, but it cannot reliably demonstrate a successful GPS check on a phone. Do not ask judges to disable browser security.
4. Sign in to Admin and open **Settings → Venue access policy**. For the QR demonstration, set `"mode": "QR_ONLY"` and save. For the GPS demonstration, set `"mode": "STRICT"`, keep `"ip": { "enabled": false, "allowlist": [] }`, and ensure `"geo": { "enabled": true, ... }`; save.
5. Keep the entrance QR visible at `/display/qr`. It rotates every 60 seconds. Have a fresh private/incognito phone window ready; private browsing avoids an earlier presence cookie affecting the demonstration.

The location check uses the browser's Geolocation API when the voter presses **Continue securely**. The browser asks for permission, then sends latitude, longitude, and reported accuracy to the API with the OTP request. The server compares the location to the configured venue using a distance calculation. It requires the reported accuracy to be no worse than `maxAccuracyM` and the reported uncertainty area to overlap the configured radius (`distance - accuracy <= radius`). The API accepts the request only if the configured access policy's checks pass. In `STRICT` mode, the server checks access again when a voter submits a ballot; the voting page requests the location again when the voter confirms a vote.

## Part 1: show why the QR matters

1. In Admin settings, use `QR_ONLY`. Explain that this isolates the entrance-presence check from the GPS demonstration.
2. On the phone, open a fresh private window at the visitor site's LAN/HTTPS address **without scanning the QR**.
3. Enter a demo name and phone, tick consent, and press **Continue securely**. The request should be refused because the browser has no redeemed presence cookie. Point out the access error; no OTP challenge should be created.
4. Return to the display and scan the current QR. It opens a short-lived `/p/...` link. The app redeems the signed token, stores a short-lived presence cookie for this same site, and returns to the registration form.
5. Submit the form again. With `QR_ONLY`, the OTP request should now be accepted. Enter the local demo OTP `123456` and show that the voter reaches the ballot.
6. Explain that the QR is not the voter's account or OTP: it proves recent access to an event display. The phone number and OTP separately verify the voter.

## Part 2: show location validation

1. In Admin settings, switch to `STRICT`; keep IP checking disabled and GPS checking enabled. This policy requires both the fresh QR presence and a passing GPS check.
2. Ensure the phone is on the trusted HTTPS event site, scan a fresh QR, and allow location access when prompted. On iPhone, allow precise location for the browser; on Android, allow location for the browser and site.
3. From inside the configured venue radius, submit the registration form. The OTP request should succeed only when the device reports an acceptable accuracy and a location consistent with the configured venue. Then enter `123456` to finish verification.
4. Cast one vote. Explain that the server checks the location again when the vote is submitted; a valid OTP by itself does not bypass the venue policy.
5. Show a rejection case in a separate fresh private session: deny location permission or use a device outside the configured radius. The OTP request should fail with a location/access error. If you want to demonstrate the vote-time check instead, use a test device/account and change location between OTP verification and vote submission. Restore the correct venue policy afterward.
6. To explain the decision, show the saved policy values in Admin and, if useful, the `STRICT` access check in `apps/api/src/access.ts`. The app does not display raw coordinates or an on-screen distance. Do not project or share raw coordinates from browser developer tools.

## What to tell the judges

> “The QR proves that the phone recently reached an event display. In strict mode, that proof is not enough on its own: the browser also has to provide a sufficiently accurate location near the configured venue. The server makes the access decision before issuing an OTP challenge. Phone verification is a separate step, and the OTP is required before voting.”

The local demo uses a mock SMS provider, so no SMS is sent. `123456` is the configured development OTP and is valid for a newly issued challenge for five minutes. Request a fresh code for each attempt. OTP requests are rate-limited per phone number; if a demo number has been used repeatedly, use a fresh test number rather than repeatedly retrying it.

## Troubleshooting

| Symptom | Check |
|---|---|
| Registration works without QR | Confirm the active policy is `QR_ONLY` or `STRICT`, not `OFF` or `STANDARD`. |
| QR scanned but presence is still rejected | Rescan the current code; it rotates every 60 seconds. Keep using the same HTTPS/LAN host after the scan. |
| Browser never asks for location, or reports it unavailable | Confirm the phone is on a trusted HTTPS origin and the browser/site has location permission. Plain HTTP on a LAN IP is not sufficient in most mobile browsers. |
| Location is rejected inside the venue | Confirm the venue latitude/longitude, radius, and `maxAccuracyM`; enable GPS checking and disable IP checking for this isolated demonstration. Wait for a better accuracy reading and retry. |
| “Please wait before requesting another code” | OTP requests for that phone have reached the per-hour limit. Use a fresh test number; do not keep retrying the same one. |
| OTP screen says the code expired or is incorrect | Request a new challenge and enter `123456` within five minutes. |

After the presentation, restore the intended access policy. Never use `OFF` or the mock OTP provider for a production event.
