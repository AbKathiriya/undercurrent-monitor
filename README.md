# Undercurrent Monitor

A crash early-warning dashboard. It scores whether something is breaking *underneath* the index (credit, private credit, banks, breadth, labor, funding) before it shows up in the S&P 500, and tracks four confirmation gates that historically came before the real damage.

Data is pulled live when the page loads. Nothing is committed daily.

## How it works

```
browser ──▶ /api/snapshot  (Vercel function, cached at the edge 10 min while the market is open)
              ├─ Yahoo Finance chart API  (prices, 3 years daily; Stooq CSV as fallback)
              ├─ FRED CSV                 (10-yr, HY/CCC/IG spreads, 2s10s, SOFR/IORB, claims, Sahm, payrolls)
              ├─ FDIC failures API        (bank failures this year)
              └─ data/macro.json          (hand-maintained slow macro)
         ──▶ /api/backtest  (weekly history since 2007, cached 24 h)
```

- `public/lib/score.js` holds every threshold and weight. The browser and the API import the same file, so the live view, the 1-year history and the tests can't drift apart.
- `lib/compute.js` turns raw bars and FRED series into dated readings. History respects publication lag (claims ~5 days, jobs ~5 weeks), so past readings only use data that was public on that day.
- `lib/backtest.js` rebuilds the market-based half of the score weekly since 2007 and reports bear markets warned, lead time, false alarms and forward returns.

## Updating slow macro

Private-credit gates, auto delinquencies, office CMBS, bankruptcies and earnings revisions have no free API. Edit `data/macro.json`, set `updated` to today, and push. CI validates the file and Vercel redeploys. Entries older than `max_age_days` show as stale on the page.

## CI/CD

- **CI** (`.github/workflows/ci.yml`): every push and PR runs static checks (`npm run check`) and unit tests (`npm test`).
- **Deploy**: Vercel's GitHub integration deploys `main` to production and every PR to a preview URL.
- **Live data health** (`.github/workflows/health.yml`): weekdays after the close, calls the production API and fails if the reading errors, is stuck on an old session, or is missing inputs. GitHub emails you on failure. Set the repo variable `SITE_URL` if the domain changes.

## Local development

```
npm test
npx vercel dev   # serves public/ and api/ on localhost:3000
```

Optional: set `FRED_API_KEY` (free from fred.stlouisfed.org) in Vercel to use the FRED JSON API instead of the CSV endpoint.

Not investment advice.
