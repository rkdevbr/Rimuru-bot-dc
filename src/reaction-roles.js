import {
  ChannelType,
  EmbedBuilder
} from 'discord.js';
import { isMangaMorphGuild } from './guild-profile.js';

const normalize = (value = '') => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const ROLE_GROUPS = {
  interests: {
    title: '📚  INTERESSES',
    color: 0x2f3545,
    description: 'Escolha os tipos de obra que você mais acompanha. Você pode selecionar mais de um.',
    items: [
      { emoji: '📚', role: 'Mangá', label: 'Mangá' },
      { emoji: '🔥', role: 'Manhwa', label: 'Manhwa' },
      { emoji: '🌏', role: 'Manhua', label: 'Manhua' },
      { emoji: '📖', role: 'Webtoon', label: 'Webtoon' },
      { emoji: '✨', role: 'Novel', label: 'Novel' }
    ]
  },
  notifications: {
    title: '🔔  NOTIFICAÇÕES',
    color: 0x2f3545,
    description: 'Escolha quais avisos do MangaMorph você quer receber.',
    items: [
      { emoji: '📢', role: 'Anúncios', label: 'Anúncios' },
      { emoji: '🚀', role: 'Lançamentos', label: 'Lançamentos' },
      { emoji: '🆕', role: 'Novos capítulos', label: 'Novos capítulos' },
      { emoji: '🎉', role: 'Eventos', label: 'Eventos' },
      { emoji: '📨', role: 'Recrutamento', label: 'Recrutamento' }
    ]
  },
  colors: {
    title: '🌈  COR DO PERFIL',
    color: 0x2f3545,
    description: 'Escolha uma cor para o seu nome no servidor. Aqui, apenas uma cor fica ativa por vez.',
    exclusive: true,
    items: [
      { emoji: '🔴', role: 'Crimson', label: 'Crimson', roleColor: 0xc93f4d },
      { emoji: '🟡', role: 'Gold', label: 'Gold', roleColor: 0xe0ad3b },
      { emoji: '🟢', role: 'Emerald', label: 'Emerald', roleColor: 0x3ca66b },
      { emoji: '🔵', role: 'Azure', label: 'Azure', roleColor: 0x4b89dc },
      { emoji: '🟣', role: 'Violet', label: 'Violet', roleColor: 0x805ad5 },
      { emoji: '🌸', role: 'Rose', label: 'Rose', roleColor: 0xd95f8d },
      { emoji: '⚪', role: 'Silver', label: 'Silver', roleColor: 0xb8bec9 }
    ]
  }
};

const PANEL_TITLES = new Map(
  Object.entries(ROLE_GROUPS).map(([key, group]) => [group.title, key])
);

const ALL_ITEMS = Object.values(ROLE_GROUPS).flatMap((group) => group.items);

async function findRoleByName(guild, roleName) {
  const roles = await guild.roles.fetch();
  return roles.find((role) => normalize(role.name) === normalize(roleName)) || null;
}

async function ensureRole(guild, item) {
  let role = await findRoleByName(guild, item.role);
  if (role) return role;

  role = await guild.roles.create({
    name: item.role,
    color: item.roleColor ?? undefined,
    mentionable: false,
    hoist: false,
    reason: 'Cargo automático do painel de cargos do MangaMorph'
  });

  return role;
}

function buildRoleEmbed(group) {
  const lines = group.items
    .map((item) => `${item.emoji}  **${item.label}**`)
    .join('\n');

  return new EmbedBuilder()
    .setColor(group.color)
    .setTitle(group.title)
    .setDescription(`${group.description}\n\n${lines}`)
    .setFooter({ text: group.exclusive ? 'Seleção exclusiva • 1 cor por vez' : 'Você pode selecionar mais de uma opção' });
}

function buildIntroEmbed(guild, client) {
  return new EmbedBuilder()
    .setColor(0x6f7cff)
    .setAuthor({
      name: 'MangaMorph • Personalização',
      iconURL: guild.iconURL({ size: 128 }) || client.user.displayAvatarURL()
    })
    .setTitle('🎨 Escolha seus cargos')
    .setDescription(
      'Personalize sua experiência no servidor usando as reações abaixo.\n\n' +
      '**Interesses** definem o que você acompanha.\n' +
      '**Notificações** controlam os avisos que você quer receber.\n' +
      '**Cor do perfil** altera a cor do seu nome no servidor.'
    );
}

function buildSummaryEmbed() {
  return new EmbedBuilder()
    .setColor(0x232833)
    .setTitle('✅  COMO FUNCIONA')
    .setDescription(
      '**Adicionar cargo:** toque na reação correspondente.\n' +
      '**Remover cargo:** retire sua reação.\n' +
      '**Interesses e notificações:** você pode escolher vários.\n' +
      '**Cor do perfil:** apenas uma cor pode ficar ativa por vez.\n\n' +
      'As alterações são aplicadas automaticamente pelo bot.'
    )
    .setFooter({ text: 'MangaMorph • Cargos automáticos' });
}

async function setReadOnlyReactionPermissions(channel, guild, client) {
  await channel.permissionOverwrites.edit(
    guild.roles.everyone.id,
    {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: false,
      SendMessagesInThreads: false,
      CreatePublicThreads: false,
      CreatePrivateThreads: false,
      AddReactions: true
    },
    { reason: 'Canal de cargos somente leitura com reações liberadas' }
  );

  const roles = await guild.roles.fetch();
  const memberRole = roles.find((role) => normalize(role.name) === 'membro') || null;

  if (memberRole) {
    await channel.permissionOverwrites.edit(
      memberRole.id,
      {
        ViewChannel: true,
        ReadMessageHistory: true,
        SendMessages: false,
        SendMessagesInThreads: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        AddReactions: true
      },
      { reason: 'Permitir apenas reações do cargo Membro no canal de cargos' }
    );
  }

  await channel.permissionOverwrites.edit(
    client.user.id,
    {
      ViewChannel: true,
      ReadMessageHistory: true,
      SendMessages: true,
      EmbedLinks: true,
      AddReactions: true,
      ManageMessages: true
    },
    { reason: 'Permissões do bot para o sistema de cargos por reação' }
  );
}

async function findOrCreateStartCategory(guild) {
  const channels = await guild.channels.fetch();
  let category = channels.find((channel) =>
    channel?.type === ChannelType.GuildCategory && normalize(channel.name).includes('inicio')
  ) || null;

  if (!category) {
    category = await guild.channels.create({
      name: '「 MM 」 INÍCIO',
      type: ChannelType.GuildCategory,
      reason: 'Categoria inicial do MangaMorph'
    });
  }

  return category;
}

async function findOrCreateRolesChannel(guild) {
  const category = await findOrCreateStartCategory(guild);
  const channels = await guild.channels.fetch();

  let channel = channels.find((item) =>
    item?.type === ChannelType.GuildText &&
    ['cargos', 'identidade', 'personalizacao'].includes(normalize(item.name))
  ) || null;

  if (!channel) {
    channel = await guild.channels.create({
      name: '🎨・cargos',
      type: ChannelType.GuildText,
      parent: category.id,
      topic: 'Escolha seus interesses, notificações e cor de perfil • somente reações',
      reason: 'Canal de cargos por reação do MangaMorph'
    });
  } else {
    if (channel.parentId !== category.id) {
      await channel.setParent(category.id, { lockPermissions: false }).catch(() => {});
    }
    await channel.setTopic('Escolha seus interesses, notificações e cor de perfil • somente reações').catch(() => {});
  }

  return channel;
}

async function upsertPanelMessage(channel, client, title, embed, reactions = []) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const existing = recent?.find((message) =>
    message.author.id === client.user.id &&
    message.embeds.some((item) => item.title === title)
  ) || null;

  let message = existing;
  if (message) {
    await message.edit({ embeds: [embed] });
  } else {
    message = await channel.send({ embeds: [embed] });
  }

  for (const emoji of reactions) {
    if (!message.reactions.cache.some((reaction) => reaction.emoji.name === emoji)) {
      await message.react(emoji).catch((error) => {
        console.error(`Falha ao adicionar reação ${emoji}:`, error);
      });
    }
  }

  return message;
}

export async function setupReactionRoles(guild, client) {
  if (!isMangaMorphGuild(guild)) return false;

  const channel = await findOrCreateRolesChannel(guild);
  await setReadOnlyReactionPermissions(channel, guild, client);

  for (const item of ALL_ITEMS) {
    await ensureRole(guild, item);
  }

  await upsertPanelMessage(
    channel,
    client,
    '🎨 Escolha seus cargos',
    buildIntroEmbed(guild, client)
  );

  for (const group of Object.values(ROLE_GROUPS)) {
    await upsertPanelMessage(
      channel,
      client,
      group.title,
      buildRoleEmbed(group),
      group.items.map((item) => item.emoji)
    );
  }

  await upsertPanelMessage(
    channel,
    client,
    '✅  COMO FUNCIONA',
    buildSummaryEmbed()
  );

  console.log(`[${guild.name}] 🎨・cargos configurado com cargos por reação.`);
}

async function resolveReactionContext(reaction, user) {
  if (user.bot) return null;

  if (reaction.partial) {
    await reaction.fetch().catch(() => null);
  }

  if (reaction.message.partial) {
    await reaction.message.fetch().catch(() => null);
  }

  const message = reaction.message;
  const guild = message.guild;
  if (!guild || !isMangaMorphGuild(guild)) return null;
  const channel = message.channel;

  if (!guild || normalize(channel.name) !== 'cargos') return null;
  if (message.author?.bot !== true) return null;

  const title = message.embeds[0]?.title;
  const groupKey = PANEL_TITLES.get(title);
  if (!groupKey) return null;

  const group = ROLE_GROUPS[groupKey];
  const item = group.items.find((entry) => entry.emoji === reaction.emoji.name);
  if (!item) return null;

  const member = await guild.members.fetch(user.id).catch(() => null);
  if (!member) return null;

  return { guild, message, member, group, groupKey, item };
}

export async function handleReactionRoleAdd(reaction, user) {
  const context = await resolveReactionContext(reaction, user);
  if (!context) return;

  const { guild, message, member, group, groupKey, item } = context;
  const role = await findRoleByName(guild, item.role);
  if (!role) return;

  if (group.exclusive) {
    for (const colorItem of ROLE_GROUPS.colors.items) {
      if (colorItem.role === item.role) continue;

      const otherRole = await findRoleByName(guild, colorItem.role);
      if (otherRole && member.roles.cache.has(otherRole.id)) {
        await member.roles.remove(otherRole, 'Troca automática de cor no painel de cargos').catch(() => {});
      }

      const otherReaction = message.reactions.cache.find((entry) => entry.emoji.name === colorItem.emoji);
      if (otherReaction) {
        await otherReaction.users.remove(user.id).catch(() => {});
      }
    }
  }

  await member.roles.add(role, `Cargo por reação: ${groupKey}`).catch((error) => {
    console.error(`Falha ao adicionar cargo ${role.name} para ${user.tag}:`, error);
  });
}

export async function handleReactionRoleRemove(reaction, user) {
  const context = await resolveReactionContext(reaction, user);
  if (!context) return;

  const { guild, member, item } = context;
  const role = await findRoleByName(guild, item.role);
  if (!role) return;

  await member.roles.remove(role, 'Cargo removido ao retirar reação').catch((error) => {
    console.error(`Falha ao remover cargo ${role.name} para ${user.tag}:`, error);
  });
}
