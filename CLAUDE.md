# SMA Tool — Claude Instructions

## After every code change

Always offer to commit and push to GitHub after making any code change. Most fixes need to be verified on Vercel, so a deployment is almost always needed after a change.

## Reddit API — never use

Do NOT use the Reddit JSON API (`reddit.com/search.json`, `reddit.com/r/*/new.json`, OAuth API, or any `reddit.com/*.json` endpoint). Reddit's updated ToS prohibits third-party API access for this kind of data collection. All Reddit data collection must go through DOM scraping via the extension's `chrome.scripting.executeScript` on a real tab — same pattern as X and Threads.

## Pushing & deploying

See PUSHING.md. Short version: push to main → auto-deploys to www.usegito.com
(Vercel project "reputation-analyzer"). CRITICAL: Hobby plan — every cron in
vercel.json must be daily or slower, or ALL future deploys fail validation.
Extension changes additionally need `cd gito-extension && bash build.sh` and a
reload at chrome://extensions.
