# Q&A cheat-sheet

- **Why rotating QR?** A static key is shareable indefinitely; this one expires in a minute and is HMAC-verified server-side.
- **What stops duplicate votes?** OTP phone uniqueness plus a database unique constraint, not a client button state.
- **What if a QR is forwarded?** STRICT mode still needs IP/geofence evidence and the code expires; live relay is a documented residual risk.
- **Why SSE?** Results are one-way server updates, so SSE is simpler and reconnects automatically.
- **What if SMS fails?** Pause voting or fail over provider; never bypass OTP.
- **Are votes secret?** The brief requires identity linkage. We encrypt PII, restrict exports and do not offer a “who voted for whom” UI; this trade-off is documented.
