# Final Voyage

Final Voyage is a live cooperative strategy game for 3–5 players. Each player joins from a phone or computer with a room code, votes through six ship crises, and pursues a private resource-based agenda.

## Netlify deployment

This package is prepared for a Git-based Netlify deployment. It uses:

- Next.js App Router for the game and API route
- Netlify Database for persistent multiplayer state
- Drizzle ORM with a PostgreSQL schema
- Automatic database migration from `netlify/database/migrations`

### Recommended deployment steps

1. In Netlify, choose **Add new project → Import an existing project**.
2. Select the GitHub repository `rob4493/Final-Voyage`.
3. Keep the detected build command as `npm run build` and publish directory as `.next`.
4. Open **Data & Storage → Database** and create a Netlify Database if Netlify does not provision it automatically during the first deploy.
5. Deploy the project. Netlify applies the included migration automatically.
6. Test with three separate browser sessions before sharing the public URL.

Do not use Netlify’s drag-and-drop static upload for this project. The game requires a server-side API and database, so it must be built from a connected Git repository.

## Local development

Install the Netlify CLI and dependencies, then run:

```bash
npm install
netlify dev
```

`netlify dev` supplies the local database environment used by `@netlify/database`.

## Checks

```bash
npm run lint
npm run build
```

## Game limits

- 3–5 players
- 6 crisis rounds
- A voyage ends immediately if Fuel, Hull, Supplies, or Morale reaches zero
