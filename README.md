# VoiceClone

A React/Vite interface for speech generation with a reference voice using Replicate's XTTS-v2 model. Generated text is spoken, **not sung**. Replicate requires a paid API account.

## Setup

1. Run `npm ci`.
2. Create a Supabase project. Copy `.env.example` to `.env.local` and enter the project URL and publishable (or legacy anon) key from Project Settings → API. Never put the Replicate token or Supabase service key in a `VITE_` variable.
3. Apply the SQL migration in `supabase/migrations` using the Supabase SQL editor or CLI. It creates the public `voice-cloner` bucket and upload/read/delete policies. **This demo permits anonymous uploads** and needs server side rate limiting/authentication before public deployment.
4. Set `REPLICATE_API_TOKEN` as a Supabase Edge Function secret. Deploy `supabase/functions/voice-clone` with JWT verification disabled as set in `supabase/config.toml`.
5. Run `npm run dev`. For deployment, set the same two `VITE_` environment variables in the hosting service and redeploy the frontend.

Commands with Supabase CLI (after linking your project): `supabase db push`, `supabase secrets set REPLICATE_API_TOKEN=...`, `supabase functions deploy voice-clone --no-verify-jwt`.

## Troubleshooting

- Blank page or disabled Generate button: check both Vite environment variables and restart/redeploy.
- Upload error: apply the storage migration and check the bucket policies.
- Function error: deploy the function, set its Replicate secret, and inspect Supabase Edge Function logs. Check Replicate account credit and model access.
- The reference file is deleted after generation or failure; if the tab closes during processing, a file may remain in public storage. Configure a storage cleanup job for production.
- Long text is split into multiple model requests. Each chunk incurs Replicate usage and Edge Function runtime; very long jobs may hit platform limits.

Run `npm run typecheck`, `npm run lint`, and `npm run build` to verify the frontend.
