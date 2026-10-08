# Event theme rollback

The Maker Collective event treatment is isolated to two changes:

1. The final stylesheet import in `apps/web/src/main.tsx`.
2. `apps/web/src/theme/maker-collective-event.css`.

To return to the prior visual theme, remove this exact line from `main.tsx`:

```ts
import './theme/maker-collective-event.css';
```

The application will then use its original `styles.css` design immediately. The
theme stylesheet can be retained for later reactivation or deleted after the
import is removed. No routes, components, API endpoints, data, or settings are
affected by this theme change.

The palette in the theme is an event UI treatment, not an assertion of official
Maker Collective, CPF Makerspace, or Crown Prince Foundation colour standards.
