# Google sign-in setup

calibre signs in with Google the standard way for desktop apps: your browser opens Google's
consent page, you approve, and calibre stores a refresh token on your machine
(`google-token.json`, owner-only). To do that it needs an **OAuth client**: an ID + secret that
identify the app to Google. For a desktop app the secret is not really secret (Google says so
itself), but don't commit yours to a public repo.

## Create a client (about 5 minutes)

1. Open the [Google Cloud console](https://console.cloud.google.com) and create a project
   (for example `calibre`).
2. **APIs & Services -> Library**: enable **Google Calendar API**.
3. **Google Auth Platform** (or "OAuth consent screen"):
   - User type **External**, fill in the app name and your email.
   - **Data Access / Scopes**: add `https://www.googleapis.com/auth/calendar`.
   - **Audience / Publishing status**: click **Publish app** so it is *In production*.
     Leaving it on *Testing* makes Google expire your sign-in every 7 days.
     You don't need Google's verification for personal use; you will just see an
     "unverified app" warning when you sign in (**Advanced -> Go to calibre (unsafe)**).
4. **Clients -> Create client**: application type **Desktop app**. Copy the client ID and secret.

## Give it to calibre

Save this as `google-client.json` in calibre's data folder:

```json
{ "client_id": "1234-abc.apps.googleusercontent.com", "client_secret": "GOCSPX-..." }
```

| OS | Folder |
| --- | --- |
| Linux | `~/.local/share/dev.calibre.app/` |
| macOS | `~/Library/Application Support/dev.calibre.app/` |
| Windows | `%APPDATA%\dev.calibre.app\` |

Then start calibre and press **Sign in with Google**. If you ever see "login expired", just sign in
again from the same card.

## Official builds

A build can embed a client so users don't need steps 1-4:
`CALIBRE_GOOGLE_CLIENT_ID=... CALIBRE_GOOGLE_CLIENT_SECRET=... npm run tauri build`.
Because the Calendar scope is *sensitive*, shipping to the public needs Google's app verification
(and until then the app is limited to 100 users and shows the unverified warning).
