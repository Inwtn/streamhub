# Optional Discord bot

The `/stream` bot creates and manages StreamHub rooms and returns invite links. Capture and playback happen on the StreamHub website. The bot does not join voice channels, start Go Live, or carry media.

## Create a Discord application

1. Create an application in the [Discord Developer Portal](https://discord.com/developers/applications) and copy its **Application ID**.
2. In **Bot**, create or reset the bot token. Keep it only in your local `.env`; never commit or send it to anyone.
3. Configure guild installation with the `bot` and `applications.commands` scopes. Add the bot to your server using the Portal's install link. It only responds to slash commands and does not need administrator permissions.
4. For quick testing in one server, copy that server's ID to `DISCORD_GUILD_ID`. Without it, the bot registers a global command, which may take longer to appear.

See Discord's [application command documentation](https://discord.com/developers/docs/interactions/application-commands).

## Configure StreamHub

Copy `.env.example` to `.env` and set:

```dotenv
DISCORD_TOKEN=your_private_bot_token
DISCORD_CLIENT_ID=your_application_id
DISCORD_GUILD_ID=your_test_server_id
PUBLIC_ORIGIN=http://localhost:3001
```

Run `npm.cmd ci`, `npm.cmd run build`, and `npm.cmd start` from the repository root on Windows. The server should print `Discord bot connected`. If it prints `Discord bot unavailable`, check the token, IDs, server installation, and internet access.

To invite viewers on other networks, set `PUBLIC_ORIGIN` to your public HTTPS origin and restart the server. The [main README](../README.md#access-from-another-network) explains temporary Cloudflare tunnels and WebRTC connectivity.

## Commands

| Command | Result |
| --- | --- |
| `/stream create name:Game night` | Creates a room and privately returns the viewer invite and host code. Open the invite and enter the host code on the page to stream. |
| `/stream invite room:ROOM_ID` | Privately returns the viewer invite again. |
| `/stream status room:ROOM_ID` | Reports live state and viewer count. |
| `/stream close room:ROOM_ID` | Closes the room and disconnects participants. |

Share only the **viewer invite**. The host code permits broadcasting and closing the room. Bot ownership and rooms are held in memory; restarting the server clears them.
