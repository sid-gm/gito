# Pushing & deploying Gito

This folder (`~/Desktop/gito`) is the canonical working copy.

## The normal flow

```bash
git add <files>
git commit -m "feat: ..."
git push origin main
```

That's it — the repo (`github.com/sid-gm/gito`) is git-connected to the Vercel
project **reputation-analyzer**, so every push to `main` auto-deploys to
**www.usegito.com** (~1 min build). No manual deploy step needed.

## Verifying a deploy

```bash
npx vercel ls reputation-analyzer   # newest deployment should be seconds/minutes old, "● Ready"
npx vercel inspect <deployment-url> --logs   # if a build failed
```

Or watch it in the dashboard: https://vercel.com/sid-gms-projects/reputation-analyzer

## ⚠️ The cron rule (this froze deploys for a month once)

The Vercel account is on the **Hobby plan: cron schedules in `vercel.json`
must run at most once per day.** Any cron like `0 * * * *` or `*/30 * * * *`
makes **every** subsequent build fail validation — pushes stop deploying and
nothing obvious tells you why. Keep all crons daily (`0 7 * * *` style) unless
the plan is upgraded to Pro. Frequent collection belongs to the browser
extension / local collector, not Vercel crons (see REDESIGN.md).

## Manual deploy (rarely needed)

```bash
npx vercel deploy --prod    # folder is already linked (.vercel/)
```

## The browser extension is NOT deployed by Vercel

Extension changes ship by rebuilding and reloading locally:

```bash
cd gito-extension && bash build.sh
# then chrome://extensions → reload the "Gito — Send to Gito" unpacked extension
# (first time: Load unpacked → ~/Desktop/gito/gito-extension/dist)
```

Commit + push extension source like any other change so GitHub stays the
source of truth, but remember the rebuild/reload step — pushing alone changes
nothing in your browser.
