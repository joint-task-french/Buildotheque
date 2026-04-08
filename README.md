# Buildotheque

A Cloudflare Workers backend for storing and searching game builds, with Discord OAuth2 authentication.

## Features

- Store and retrieve builds (JSON objects with `nom`, `description`, `auteur`, `tags`, `encoded`, `likes`, `timestamp`)
- Search builds by text (matches `nom`, `description`, or `auteur`) and by tags (cumulative – the build must have **all** requested tags)
- Discord OAuth2 login
- JWT-based session management
- Full CRUD for builds (create, read, update, delete)
- Like system

---

## Setup

### 1. Install dependencies

```bash
npm install
```

### 2. Create KV namespaces

```bash
npx wrangler kv namespace create BUILDS_KV
npx wrangler kv namespace create BUILDS_KV --preview
```

Copy the generated IDs into `wrangler.toml`.

### 3. Configure environment variables

Edit `wrangler.toml` and set:

| Variable               | Description                                                                     |
|------------------------|---------------------------------------------------------------------------------|
| `DISCORD_CLIENT_ID`    | Your Discord application's Client ID                                            |
| `DISCORD_REDIRECT_URI` | OAuth2 redirect URI (e.g. `https://<worker>.workers.dev/auth/discord/callback`) |
| `FRONTEND_URL`         | URL to redirect users to after login (token is appended as `?token=...`)        |

Set secrets (never commit these):

```bash
npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put JWT_SECRET
```

### 4. Local development

```bash
npm run dev
```

### 5. Deploy

```bash
npm run deploy
```

---

## API Documentation

The complete API documentation is available in the [API.md](./API.md) file.
