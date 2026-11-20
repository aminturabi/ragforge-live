# RAGForge durable storage - Supabase setup (one-time, ~5 minutes)

Goal: knowledge bases stop disappearing when the backend restarts.
The code is already live and switches itself on when two environment
variables appear. Only the account owner can do these steps.

## 1. Create the free project

1. Go to https://supabase.com and sign in with Google
   (aminturabi594@gmail.com).
2. New project: name `ragforge`, choose a database password (save it in
   your password manager - it is NOT needed by the app), region
   **South Asia (Mumbai)**, Free plan. Wait ~2 minutes for it to build.

## 2. Create the table

1. In the project, open **SQL Editor** > **New query**.
2. Paste the full contents of `supabase_schema.sql` (repository root)
   and tap **Run**. It should say "Success. No rows returned".

## 3. Copy the two values

**Project Settings > API** shows:

- **Project URL** - looks like `https://abcdefgh.supabase.co`
- **service_role key** (under "Project API keys", the secret one -
  NOT the anon key). This key is powerful: treat it like a password.

## 4. Put them in Render

Render dashboard > **ragforge-live** > **Environment** (the service's own
page, where ADMIN_KEY already lives) > Edit > add two variables:

- `SUPABASE_URL` = the Project URL
- `SUPABASE_KEY` = the service_role key

Then **Save, rebuild, and deploy**. Never paste the key into chat.

## 5. Tell Muse "Supabase done"

Muse verifies from the server side (`persistent: true`), re-uploads the
portfolio knowledge base once - into the database this time - and proves
persistence by restarting the service and confirming the chatbot still
answers.
