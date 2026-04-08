# Food Calorie Camera

A mobile-first React + Vite app that uses the device camera or photo upload to estimate calories from a single plate of food. The frontend is designed for Cloudflare Pages, and the backend analysis endpoint runs as a Pages Function backed by Workers AI.

## What ships in this MVP

- Rear-camera capture on supported mobile browsers
- Photo upload fallback when camera permissions fail
- In-browser image compression before upload
- `POST /api/analyze` Cloudflare Pages Function
- Structured calorie estimate with confidence, item list, and summary
- Stateless processing with no saved meal history and no stored photo uploads

## Local development

1. Install dependencies:

   ```bash
   pnpm install
   ```

2. Run the frontend only:

   ```bash
   pnpm dev
   ```

3. Run the full Cloudflare flow after building:

   ```bash
   pnpm dev:pages
   ```

   `pnpm dev:pages` uses `wrangler pages dev` and exposes an AI binding named `AI` locally.

## Testing

```bash
pnpm test
pnpm build
```

## Cloudflare Pages deployment

1. Create a Cloudflare Pages project by importing the GitHub repo.
2. Use these build settings:
   - Build command: `pnpm build`
   - Build output directory: `dist`
   - Production branch: `main`
3. In the Cloudflare dashboard, add a Workers AI binding named `AI` for the Pages project.
4. Deploy and verify that `POST /api/analyze` can access the binding.

Cloudflare Pages must serve the site over HTTPS so mobile camera access works outside localhost.

## GitHub repository setup

If your local GitHub CLI token is invalid, re-authenticate first:

```bash
gh auth login -h github.com
```

Then initialize and publish the repository:

```bash
git init
git branch -M main
git add .
git commit -m "Initial Cloudflare calorie camera MVP"
gh repo create food-calorie-camera --public --source=. --remote=origin --push
```

If you prefer the GitHub UI, create an empty repository named `food-calorie-camera`, then run:

```bash
git remote add origin https://github.com/tuanngo1993/food-calorie-camera.git
git push -u origin main
```

## Notes on calorie estimation

- The app estimates calories from visible evidence in one image only.
- Results should be treated as rough guidance, not nutrition advice.
- Blurry or crowded images intentionally return retryable errors instead of unreliable numbers.
