# Pokémon Restock Dashboard V2

Clean Railway build with a dependency-free `/health` route. The web server starts before Discord, email, storage, scraping, or push initialization.

## Deploy

Upload the **contents** of this folder to the root of your GitHub repository.

Repository root:

```text
package.json
package-lock.json
railway.json
src/
public/
```

Railway volume: mount at `/data`.

## Required Railway variables

```text
MICROCENTER_STORE_NAME=IL - Chicago
CHECK_INTERVAL_SECONDS=120
DATA_DIR=/data
SEED_DEFAULT_WATCH=true
DEFAULT_PRODUCT_URL=https://www.microcenter.com/product/713503/nintendo-pokemon-mega-evolution-pitch-black-elite-trainer-box
```

Do not set `PORT`; Railway provides it.

## Browser push

Generate keys locally:

```bash
npx web-push generate-vapid-keys
```

Then add:

```text
VAPID_PUBLIC_KEY=
VAPID_PRIVATE_KEY=
VAPID_SUBJECT=mailto:you@example.com
```

## Gmail email alerts

```text
EMAIL_ALERTS_ENABLED=true
EMAIL_TO=you@example.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=you@gmail.com
SMTP_PASS=your-google-app-password
EMAIL_FROM=Pokemon Restock Alerts <you@gmail.com>
```

## Optional Discord

```text
DISCORD_TOKEN=
DISCORD_CHANNEL_ID=
```
