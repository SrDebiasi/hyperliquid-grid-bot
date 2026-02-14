
------------------------------------------------------------------------

## Telegram Integration

The bot sends:

- Profit notifications
- Order fills
- Error messages
- Startup confirmation

### How to Create Telegram Bot

1. Open Telegram
2. Search for **@BotFather**
3. Send `/start`
4. Send `/newbot`
5. Follow instructions
6. Copy the generated BOT TOKEN

Add to `.env`:

    TELEGRAM_BOT_TOKEN=your_token_here
    TELEGRAM_CHAT_ID=your_chat_id_here

To get your chat ID:

1. Start your bot in Telegram
2. Send any message to it
3. Open this URL in browser:

   https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates

4. Look for `"chat":{"id": ...}`

That number is your Chat ID.

--------------------------------------------------

If getUpdates Returns Empty Result

If you call:

https://api.telegram.org/bot<YOUR_TOKEN>/getUpdates

And receive:

{
"ok": true,
"result": []
}

This means Telegram has no new updates to return.

Common reasons:

- You have not sent a message to the bot yet.

How to Fix

Option 1 — Basic Method

1. Open Telegram.
2. Search your bot username.
3. Press Start.
4. Send any message (for example: "hi").
5. Call getUpdates again.

Security Notice

If you ever expose your Bot Token publicly:

1. Open @BotFather
2. Use /revoke
3. Generate a new token
4. Update your .env file immediately

Never share your Bot Token publicly.