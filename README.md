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

| Variable | Description |
|---|---|
| `DISCORD_CLIENT_ID` | Your Discord application's Client ID |
| `DISCORD_REDIRECT_URI` | OAuth2 redirect URI (e.g. `https://<worker>.workers.dev/auth/discord/callback`) |
| `FRONTEND_URL` | URL to redirect users to after login (token is appended as `?token=...`) |

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

## API Reference

### Authentication

#### `GET /auth/discord`
Redirects the user to Discord's OAuth2 authorization page.

Query params:
- `state` *(optional)* – forwarded back after login

#### `GET /auth/discord/callback`
Handles the Discord OAuth2 callback. On success, redirects to `FRONTEND_URL?token=<JWT>`.

#### `GET /auth/me`
Returns the authenticated user's profile.

**Headers:** `Authorization: Bearer <token>`

**Response:**
```json
{ "id": "discord_user_id", "username": "Username", "avatar": "avatar_hash" }
```

---

### Builds

#### `GET /builds`
Search and list builds.

Query params:
- `text` *(optional)* – text matched against `nom`, `description`, `auteur` (case-insensitive)
- `tags` *(optional)* – comma-separated tag IDs; builds must contain **all** of them
- `limit` *(optional)* – max results to return (default: 50, max: 200)
- `offset` *(optional)* – results to skip for pagination (default: 0)

**Response:**
```json
{ "builds": [...], "total": 42, "limit": 50, "offset": 0 }
```

#### `POST /builds` *(auth required)*
Create a new build.

**Body:**
```json
{
  "nom": "My Build",
  "description": "A great build",
  "auteur": "MyUsername",
  "tags": ["dps", "pvp"],
  "encoded": "base64encodedstring"
}
```

**Field limits:**
| Field | Max length | Notes |
|---|---|---|
| `nom` | 25 chars | Required |
| `description` | 250 chars | Required |
| `auteur` | 25 chars | Optional – defaults to Discord username |
| `encoded` | 8000 chars | Required |
| `tags` | 5 items, each ≤ 25 chars | Optional |

#### `GET /builds/:id`
Retrieve a single build by ID.

#### `PUT /builds/:id` *(auth required, owner only)*
Update a build. All fields are optional. Same limits as POST apply.

#### `DELETE /builds/:id` *(auth required, owner only)*
Delete a build.

#### `POST /builds/:id/like` *(auth required)*
Toggle the like on a build.
- First call: adds a like (one like per user per build)
- Second call: removes the like

**Response:** `{ "build": { ... }, "liked": true }`

---

## Build Object Schema

```json
{
  "id": "uuid",
  "nom": "string",
  "description": "string",
  "auteur": "string",
  "auteurId": "string",
  "tags": ["string"],
  "encoded": "string",
  "likes": 0,
  "timestamp": 1712345678000
}
```
