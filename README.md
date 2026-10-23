# AI GITHUB RESOURCE HUB: Public Website + Owner Admin

This edition uses **Cloudflare Workers static assets** instead of GitHub Pages. GitHub Pages cannot securely hold OAuth client secrets or process owner-only GitHub commits. The Worker serves the public Vite website and same-origin OAuth/API endpoints.

## Setup
1. Create a **public** GitHub repository named `ai-github-resource-hub` and upload all project files.
2. Create a GitHub **OAuth App** under GitHub Settings → Developer settings → OAuth Apps. Set homepage to your Cloudflare Worker URL (`https://ai-github-resource-hub.YOUR_SUBDOMAIN.workers.dev`) and callback URL to `https://ai-github-resource-hub.YOUR_SUBDOMAIN.workers.dev/api/callback`. You may need to deploy once before knowing the URL.
3. Update `wrangler.toml`: `CLIENT_ID` (`OWNER_LOGIN` is already set to `vakulkumarmore`, and `REPO_NAME` is set to `ai-github-resource-hub`). `OWNER_LOGIN` must match the GitHub account owning the repository (this version assumes a personal repository, not an organization).
4. Install Node.js 20+, then run `npm install` and `npx wrangler login`.
5. Store credentials **only as Worker secrets**, never in the frontend, git, or wrangler.toml:
   - `npx wrangler secret put CLIENT_SECRET` (paste GitHub OAuth client secret)
   - `npx wrangler secret put SESSION_SECRET` (paste a long, random secret, 32+ bytes)
6. Deploy with `npm run deploy`. Update OAuth App URLs if needed.
7. Visit the deployed website, sign in as owner, import URLs, click **Preview in library**, then **Publish to GitHub**.

## Publishing and public access
The catalog is committed through the GitHub Contents API to `src/resources.json`. The public Worker reads the current catalog from GitHub at `/api/catalog`, cached for up to 60 seconds. No redeployment is required for catalog edits. Cloudflare Worker deploys are required for changes to website code. To auto-deploy code changes, connect the GitHub repository in the Cloudflare dashboard and set build command `npm run build` with assets `dist` and Worker entry `worker/index.js`, or configure CI using a Cloudflare API token stored as a GitHub Actions secret.

## Security and limitations
- Only `OWNER_LOGIN` is authorized to publish; authorization is checked on the server using GitHub `/user`.
- OAuth client secret and encrypted session key remain on the Worker; cookies are HttpOnly, Secure, SameSite=Lax.
- OAuth requests ask for `public_repo` permission. GitHub OAuth Apps cannot grant repository-scoped fine-grained access; the token can access other public repositories the user can write to. Consider a GitHub App for narrower access in a later version.
- The public bulk importer is still visible, but only the owner can publish changes. Other visitors can locally preview or export JSON, not modify the live catalog.
- Sessions last seven days. Logging out clears the session cookie; token revocation must be done through GitHub settings.
- The importer uses unauthenticated public GitHub API requests and may be rate limited. Break 200 URLs into batches. Verify suggestions before publishing.
- Do not enable branch protection that prevents the OAuth user from updating `src/resources.json` without adjusting the workflow.

## Local development
`npm run dev` previews the website; the OAuth API requires the deployed Worker environment. `npm run build` checks TypeScript and creates `dist`.

## Account-specific configuration
GitHub owner: `vakulkumarmore`
Planned repository: `https://github.com/vakulkumarmore/ai-github-resource-hub` (create it first)
The Cloudflare subdomain and OAuth Client ID are not yet known. Do not commit secrets.
