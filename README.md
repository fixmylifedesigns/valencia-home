# Our Valencia home 🍊

Our shared shortlist of dog-friendly rentals in central Valencia (2–3 bedrooms, up to €1,400).

**Live site:** https://fixmylifedesigns.github.io/valencia-home/

## How it works

- **Source of truth:** `data/listings.json`. The live site reads it straight from `main`, so edits show up within a few minutes without a redeploy.
- **Photos:** each listing has an `images` array of image URLs. Paste photo URLs there (or let the idealista sync fill them). Listings with no photos show a map of the street instead.
- **Nearby places:** tap "Show what's nearby" on a flat to load Japanese restaurants and shops, Dominican/Caribbean spots and supermarkets live from OpenStreetMap.
- **Likes:** saved per browser.

## Editing a listing

Open `data/listings.json` on GitHub and edit. Useful fields:

| Field | What it does |
| --- | --- |
| `images` | Photo URLs shown in the card's gallery |
| `url` | Link to the idealista listing |
| `status` | `new`, `contacted`, `visited`, or `rejected` (rejected ones are hidden) |
| `notes` | Our own notes, shown on the card |
| `lat` / `lng` | Optional; otherwise the address is looked up automatically |

## Automatic listing updates

The workflow runs every 6 hours. If the repo has `IDEALISTA_API_KEY` and `IDEALISTA_API_SECRET` secrets (request API access at https://developers.idealista.com), it pulls new listings with photos and links from idealista's official API, keeps our notes and statuses, commits the data and redeploys. Without those secrets, it just rebuilds with the current data.

## Local development

```bash
npm install
npm run dev
```
