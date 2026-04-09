<h1>Buildotheque</h1>

<p>A Cloudflare Workers backend for storing and searching game builds, with Discord OAuth2 authentication.</p>

<h2>Features</h2>

<ul>
  <li>Store and retrieve builds (JSON objects with <code>nom</code>, <code>description</code>, <code>auteur</code>, <code>tags</code>, <code>encoded</code>, <code>likes</code>, <code>timestamp</code>)</li>
  <li>Search builds by text (matches <code>nom</code>, <code>description</code>, or <code>auteur</code>) and by tags (cumulative – the build must have <strong>all</strong> requested tags)</li>
  <li>Discord OAuth2 login</li>
  <li>JWT-based session management</li>
  <li>Full CRUD for builds (create, read, update, delete)</li>
  <li>Like system</li>
  <li>Powered by Cloudflare D1 (SQL Database)</li>
</ul>

<hr />

<h2>Setup</h2>

<h3>1. Install dependencies</h3>

<pre><code class="language-bash">npm install</code></pre>

<h3>2. Create D1 Database</h3>

<pre><code class="language-bash">npx wrangler d1 create buildotheque-db</code></pre>

<p>Copy the generated <code>database_id</code> into your <code>wrangler.toml</code>.</p>

<p>Then, apply the database schema (create a <code>schema.sql</code> file at the root of the project with your SQL tables first):</p>

<pre><code class="language-bash"># For local development
npx wrangler d1 execute buildotheque-db --local --file=./schema.sql

# For production deployment
npx wrangler d1 execute buildotheque-db --remote --file=./schema.sql</code></pre>

<h3>3. Configure environment variables</h3>

<p>Edit <code>wrangler.toml</code> and set:</p>

<table>
  <thead>
    <tr>
      <th>Variable</th>
      <th>Description</th>
    </tr>
  </thead>
  <tbody>
    <tr>
      <td><code>DISCORD_CLIENT_ID</code></td>
      <td>Your Discord application's Client ID</td>
    </tr>
    <tr>
      <td><code>DISCORD_REDIRECT_URI</code></td>
      <td>OAuth2 redirect URI (e.g. <code>https://&lt;worker&gt;.workers.dev/auth/discord/callback</code>)</td>
    </tr>
    <tr>
      <td><code>FRONTEND_URL</code></td>
      <td>Default URL to redirect users to after login</td>
    </tr>
    <tr>
      <td><code>ALLOWED_DOMAINS</code></td>
      <td>Comma-separated list of allowed frontend domains (e.g., <code>joint-task-french.github.io, *.mon-domaine.fr</code>)</td>
    </tr>
  </tbody>
</table>

<p>Set secrets (never commit these):</p>

<pre><code class="language-bash">npx wrangler secret put DISCORD_CLIENT_SECRET
npx wrangler secret put JWT_SECRET</code></pre>

<h3>4. Local development</h3>

<pre><code class="language-bash">npm run dev</code></pre>

<h3>5. Deploy</h3>

<pre><code class="language-bash">npm run deploy</code></pre>

<hr />

<h2>API Documentation</h2>

<p>The complete API documentation is available in the <a href="./API.md">API.md</a> file.</p>