# Pokémon Restock Dashboard + Discord Bot

A Railway-ready web dashboard and Discord bot that watches Micro Center product pages and alerts when a product becomes available at **IL - Chicago**.

## Included commands

- `/watch add url:<Micro Center URL>` — add a product
- `/watch list` — show everything being watched
- `/watch remove id:<watch ID>` — remove a watch
- `/watch check id:<optional watch ID>` — check now
- `/watch pause id:<watch ID>` — pause a watch
- `/watch resume id:<watch ID>` — resume a watch
- `/watch test` — send a test alert

The supplied Pitch Black Elite Trainer Box is seeded automatically on the first startup.

## Discord setup

1. Open the Discord Developer Portal.
2. Create an application and bot.
3. Copy the bot token into `DISCORD_TOKEN`.
4. Copy the application ID into `DISCORD_CLIENT_ID`.
5. Enable no privileged intents; this bot does not require Message Content Intent.
6. Invite the bot with scopes:
   - `bot`
   - `applications.commands`
7. Bot permissions:
   - View Channels
   - Send Messages
   - Embed Links

For fast slash-command registration, put your server ID into `DISCORD_GUILD_ID`.

## Railway setup

1. Upload this project to a GitHub repository.
2. Create a Railway service from the repository.
3. Add every required variable from `.env.example`.
4. Add a Railway Volume mounted at `/data`.
5. Deploy.

Required variables:

```text
DISCORD_TOKEN
DISCORD_CLIENT_ID
DISCORD_GUILD_ID
DISCORD_CHANNEL_ID
MICROCENTER_STORE_NAME=IL - Chicago
CHECK_INTERVAL_SECONDS=120
DATA_DIR=/data
SEED_DEFAULT_WATCH=true
DEFAULT_PRODUCT_URL=https://www.microcenter.com/product/713503/nintendo-pokemon-mega-evolution-pitch-black-elite-trainer-box
PORT=8080
```

## Alert behavior

The bot stores the previous state and sends an alert only when:

- a product changes from out of stock/unknown to in stock
- an in-stock product changes back to out of stock
- the price changes

The first scan establishes a baseline and does not send a restock alert. Use `/watch test` to verify the alert channel.

## Local test

```bash
npm install
cp .env.example .env
npm run check
npm start
```

## Notes

- Micro Center can change its page markup at any time. The checker has multiple parsing fallbacks, but may eventually need an update.
- Inventory can sell out quickly and an alert does not reserve the item.
- Keep the interval reasonable to avoid unnecessary traffic.


## Web dashboard

Open the public Railway domain for the service. The dashboard lets you:

- see total, in-stock, out-of-stock, and last-scan statistics
- add Micro Center product URLs
- check one product immediately
- check all products immediately
- pause or resume a watch
- remove a watch
- open the original product page
- see Discord connection status

Set `DASHBOARD_PASSWORD` to protect the dashboard with browser Basic Authentication.
Leave it blank only when you intentionally want a public dashboard.

The `/health` route remains public so Railway health checks continue to work.
