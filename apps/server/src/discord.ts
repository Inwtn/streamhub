import { Client, GatewayIntentBits, REST, Routes, SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { RoomStore } from './rooms.js';

export async function startDiscordBot(store: RoomStore, endRoom: (id: string) => void, publicOrigin: string, botToken: string, clientId: string, guildId?: string) {
  // Discord ownership remains in memory, like the room store. A restart clears both.
  const owned = new Map<string, Set<string>>();
  const command = new SlashCommandBuilder().setName('stream').setDescription('Manage a StreamHub room')
    .addSubcommand(c => c.setName('create').setDescription('Create a private room').addStringOption(o => o.setName('name').setDescription('Room name').setRequired(true).setMaxLength(50)))
    .addSubcommand(c => c.setName('invite').setDescription('Get an invite to your room').addStringOption(o => o.setName('room').setDescription('Room ID').setRequired(true)))
    .addSubcommand(c => c.setName('close').setDescription('Close your room').addStringOption(o => o.setName('room').setDescription('Room ID').setRequired(true)))
    .addSubcommand(c => c.setName('status').setDescription('Get room status').addStringOption(o => o.setName('room').setDescription('Room ID').setRequired(true)));
  const rest = new REST({ version: '10' }).setToken(botToken);
  await rest.put(guildId ? Routes.applicationGuildCommands(clientId, guildId) : Routes.applicationCommands(clientId), { body: [command.toJSON()] });
  const client = new Client({ intents: [GatewayIntentBits.Guilds] });
  client.on('interactionCreate', async interaction => {
    if (!interaction.isChatInputCommand() || interaction.commandName !== 'stream') return;
    const sub = interaction.options.getSubcommand();
    const userId = interaction.user.id;
    const respond = (content: string) => interaction.reply({ content, flags: MessageFlags.Ephemeral });
    if (sub === 'create') {
      const room = store.create(interaction.options.getString('name', true).trim(), interaction.user.username.slice(0, 30));
      owned.set(userId, new Set([...(owned.get(userId) || []), room.id]));
      const localWarning = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(publicOrigin) ? '\n⚠️ This localhost URL only works on your computer. Set PUBLIC_ORIGIN to a public HTTPS URL.' : '';
      await respond(`Room **${room.name}** created. ID: \`${room.id}\`\nInvite: ${publicOrigin}/room/${room.id}#invite=${room.invite}\nPrivate host code: \`${room.ownerToken}\`. Enter this code on the page to start streaming. Share only the invite.${localWarning}`);
      return;
    }
    const id = interaction.options.getString('room', true);
    const room = store.rooms.get(id);
    if (!room || !owned.get(userId)?.has(id)) { await respond('Room not found or you do not own it.'); return; }
    if (sub === 'invite') await respond(`Invite: ${publicOrigin}/room/${room.id}#invite=${room.invite}`);
    if (sub === 'status') await respond(`**${room.name}** — ${room.live ? 'live' : 'offline'} — ${[...room.participants.values()].filter(p => p.role === 'viewer' && p.socketId).length}/${store.maxViewers} viewers.`);
    if (sub === 'close') { endRoom(id); owned.get(userId)?.delete(id); await respond('Room closed.'); }
  });
  await client.login(botToken);
  return () => client.destroy();
}
