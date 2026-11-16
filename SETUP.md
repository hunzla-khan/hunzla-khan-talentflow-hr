# TalentFlow HR CRM – Setup Guide (about 20 minutes, all free)

You will put the CRM on the internet with a free link like `https://your-name.onrender.com`.
Anyone can open the link. Candidates apply with no account. Your ma'am and team sign in
with a username and password that YOU create inside the CRM.

You need three free accounts: **GitHub** (stores the code), **Supabase** (stores the data
safely) and **Render** (runs the website).

---

## STEP 1 – Put the code on GitHub
1. Go to https://github.com and sign up or sign in.
2. Click **+** (top right) → **New repository**. Name it `talentflow-hr`. Choose **Private**. Click **Create repository**.
3. Click **uploading an existing file**. Drag in these files from the unzipped folder:
   `server.js`, `index.html`, `package.json`, `.gitignore`
4. Click **Commit changes**.

## STEP 2 – Create the database (Supabase)
1. Go to https://supabase.com → **Start your project** → sign in with GitHub.
2. **New project**. Name: `talentflow`. Set a database password (save it). Pick the nearest region. Click **Create**. Wait about 2 minutes.
3. In the left menu open **SQL Editor** → **New query**. Paste this and click **Run**:

```sql
create table kv (key text primary key, value jsonb not null);
alter table kv enable row level security;
```
4. Open **Project Settings → API** (or "API Keys"). Copy two things:
   - **Project URL** (looks like `https://abcdxyz.supabase.co`)
   - The **service_role / secret** key (long text). Keep it private. Never share it.

## STEP 3 – Put the website online (Render)
1. Go to https://render.com → sign up with GitHub.
2. **New +** → **Web Service** → pick your `talentflow-hr` repository → **Connect**.
3. Fill in:
   - **Runtime:** Node
   - **Build Command:** `npm install`
   - **Start Command:** `node server.js`
   - **Instance type:** Free
4. Open **Environment Variables** and add these 5:

| Name | Value |
|---|---|
| `ADMIN_USER` | your login name, e.g. `hradmin` |
| `ADMIN_PASS` | a strong password (min 8 characters) |
| `SESSION_SECRET` | any long random text, e.g. `k29dh38sjd02ksl29dj38` |
| `SUPABASE_URL` | the Project URL from Step 2 |
| `SUPABASE_KEY` | the service_role key from Step 2 |

   Optional: add `SEED_DEMO` = `0` if you do NOT want the sample jobs and candidates.
5. Click **Create Web Service**. After 2-3 minutes it shows **Live**, with your link at the top.

## STEP 4 – First login
1. Open your Render link. Sign in with `ADMIN_USER` and `ADMIN_PASS`.
2. Open **Users** and create an account for your ma'am (role **HR Admin** or **HR Staff**) and for each manager (role **Hiring Manager**). Send them the link plus their username and password.

---

## HOW TO USE THE CRM (the daily flow)
1. **Jobs** – post a job (title, department, sector, minimum experience, ATS keywords).
2. **Get candidates**
   - Click **🔗 Apply links** on a job. Use the *LinkedIn* link on LinkedIn, the *Indeed* link on Indeed, the *Rozee.pk* link on Rozee, and the *WhatsApp* link in groups. Candidates open it with no login, apply, and appear in **Candidates** tagged with their source.
   - Or open **Import**, upload the CSV exported from LinkedIn Recruiter, Indeed, Rozee.pk or a Google Form, choose the job and import.
3. **ATS Screening** – set the pass mark and click **Run ATS**. Good matches move to *Screened*; weak ones are auto-rejected (HR can override).
4. **Pipeline** – managers open a candidate, read the profile and ATS score, then **Shortlist → Interview → Select / Reject**, with notes. Every action is logged.
5. **Candidates / Dashboard** – see the Selected list, the funnel and sources, and **Export CSV**.

## GOOD TO KNOW
- **Free plan sleeps:** after about 15 minutes with no visits, the first load takes 30-60 seconds. For daily live use, upgrade Render to a paid plan, or ping the link with a free monitor such as UptimeRobot.
- **Your data is safe in Supabase**, so it survives restarts and redeploys. Without the Supabase variables the CRM falls back to a local file that Render erases on restart, so always set them.
- **Change the admin password** after first login (sidebar → Password).
- **Custom domain later:** Render → Settings → Custom Domains, whenever you buy one.
- **Try it on your own computer first:** install Node 18+, open a terminal in the folder, run `node server.js`, then open http://localhost:3000 (login `admin` / `admin123`).
