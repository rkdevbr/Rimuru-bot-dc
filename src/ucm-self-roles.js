import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  EmbedBuilder,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  StringSelectMenuOptionBuilder
} from 'discord.js';

export const UCM_GUILD_ID = '1155332928755224678';

const normalize = (value = '') => String(value)
  .normalize('NFKD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

const ROLE_GROUPS = {
  country: [
    { key: 'brasil', name: '🇧🇷・Brasil', label: 'Brasil', emoji: '🇧🇷' },
    { key: 'eua', name: '🇺🇸・Estados Unidos', label: 'Estados Unidos', emoji: '🇺🇸' },
    { key: 'espanha', name: '🇪🇸・Espanha', label: 'Espanha', emoji: '🇪🇸' }
  ],
  team: [
    { key: 'capitao', name: '🛡️・Capitão América', label: 'Capitão América', emoji: '🛡️' },
    { key: 'ferro', name: '🤖・Homem de Ferro', label: 'Homem de Ferro', emoji: '🤖' }
  ],
  sneak: [
    { key: 'sneak', name: '👀・Sneak Peek', label: 'Sneak Peek', emoji: '👀' }
  ]
};

const ALL_ROLES = Object.values(ROLE_GROUPS).flat();

async function fetchRoles(guild) {
  return guild.roles.fetch();
}

async function findRole(guild, roleName) {
  const roles = await fetchRoles(guild);
  return roles.find((role) => normalize(role.name) === normalize(roleName)) || null;
}

async function ensureRole(guild, definition) {
  const existing = await findRole(guild, definition.name);
  if (existing) return existing;

  const me = await guild.members.fetchMe();
  if (!me.permissions.has(PermissionFlagsBits.ManageRoles)) {
    console.log(`[UCM-ROLES] Cargo ausente e sem Gerenciar Cargos: ${definition.name}`);
    return null;
  }

  return guild.roles.create({
    name: definition.name,
    hoist: false,
    mentionable: false,
    reason: 'Cargo de auto-seleção solicitado para o UCM Studios'
  });
}

async function ensureRoles(guild) {
  for (const definition of ALL_ROLES) {
    await ensureRole(guild, definition).catch((error) => {
      console.error(`[UCM-ROLES] Falha ao criar ${definition.name}:`, error.message);
    });
  }
}

async function findRolesChannel(guild) {
  const channels = await guild.channels.fetch();
  return channels.find((channel) =>
    channel?.type === ChannelType.GuildText &&
    normalize(channel.name) === 'cargos'
  ) || null;
}

async function findPortariaCategory(guild) {
  const channels = await guild.channels.fetch();
  return channels.find((channel) =>
    channel?.type === ChannelType.GuildCategory &&
    normalize(channel.name).includes('portaria')
  ) || null;
}

async function ensureRolesChannel(guild) {
  let channel = await findRolesChannel(guild);
  const category = await findPortariaCategory(guild);

  if (!channel) {
    channel = await guild.channels.create({
      name: '🪪・cargos',
      type: ChannelType.GuildText,
      parent: category?.id || null,
      topic: 'Escolha seu país, seu time e se deseja receber Sneak Peeks.',
      reason: 'Canal de auto-seleção de cargos do UCM Studios'
    });
    console.log('[UCM-ROLES] Canal 🪪・cargos criado.');
  } else {
    await channel.edit({
      name: '🪪・cargos',
      parent: category?.id || channel.parentId,
      topic: 'Escolha seu país, seu time e se deseja receber Sneak Peeks.',
      lockPermissions: false,
      reason: 'Padronização do canal de cargos do UCM Studios'
    }).catch((error) => {
      console.error('[UCM-ROLES] Falha ao ajustar canal de cargos:', error.message);
    });
  }

  await channel.permissionOverwrites.edit(guild.roles.everyone.id, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    AddReactions: false
  }).catch(() => {});

  await channel.permissionOverwrites.edit(guild.client.user.id, {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: true,
    EmbedLinks: true,
    ManageMessages: true
  }).catch(() => {});

  return channel;
}

function buildPanelEmbed(guild) {
  return new EmbedBuilder()
    .setColor(0x5865f2)
    .setAuthor({
      name: 'UCM Studios • Cargos',
      iconURL: guild.iconURL({ size: 128 }) || undefined
    })
    .setTitle('🪪 Escolha seus cargos')
    .setDescription(
      'Personalize seu perfil usando as opções abaixo.\n\n' +
      '🌎 **País** — escolha apenas um.\n' +
      '⚔️ **Time** — Capitão América ou Homem de Ferro.\n' +
      '👀 **Sneak Peek** — ative para receber prévias e novidades antecipadas.'
    )
    .addFields(
      {
        name: 'País',
        value: '🇧🇷 Brasil  •  🇺🇸 Estados Unidos  •  🇪🇸 Espanha'
      },
      {
        name: 'Time',
        value: '🛡️ Capitão América  •  🤖 Homem de Ferro'
      },
      {
        name: 'Notificações',
        value: '👀 Sneak Peek'
      }
    )
    .setFooter({ text: 'Você pode alterar suas escolhas quando quiser.' });
}

function buildComponents() {
  const country = new StringSelectMenuBuilder()
    .setCustomId('ucm_roles_country')
    .setPlaceholder('🌎 Escolha seu país')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Brasil').setValue('brasil').setEmoji('🇧🇷'),
      new StringSelectMenuOptionBuilder().setLabel('Estados Unidos').setValue('eua').setEmoji('🇺🇸'),
      new StringSelectMenuOptionBuilder().setLabel('Espanha').setValue('espanha').setEmoji('🇪🇸'),
      new StringSelectMenuOptionBuilder().setLabel('Remover país').setValue('none').setEmoji('🗑️')
    );

  const team = new StringSelectMenuBuilder()
    .setCustomId('ucm_roles_team')
    .setPlaceholder('⚔️ Escolha seu time')
    .setMinValues(1)
    .setMaxValues(1)
    .addOptions(
      new StringSelectMenuOptionBuilder().setLabel('Capitão América').setValue('capitao').setEmoji('🛡️'),
      new StringSelectMenuOptionBuilder().setLabel('Homem de Ferro').setValue('ferro').setEmoji('🤖'),
      new StringSelectMenuOptionBuilder().setLabel('Remover time').setValue('none').setEmoji('🗑️')
    );

  const sneak = new ButtonBuilder()
    .setCustomId('ucm_roles_sneak')
    .setLabel('Ativar / remover Sneak Peek')
    .setEmoji('👀')
    .setStyle(ButtonStyle.Secondary);

  return [
    new ActionRowBuilder().addComponents(country),
    new ActionRowBuilder().addComponents(team),
    new ActionRowBuilder().addComponents(sneak)
  ];
}

async function upsertPanel(channel, guild) {
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const matches = recent?.filter((message) =>
    message.author.id === guild.client.user.id &&
    (
      message.components.some((row) =>
        row.components.some((component) =>
          ['ucm_roles_country', 'ucm_roles_team', 'ucm_roles_sneak'].includes(component.customId)
        )
      ) ||
      message.embeds.some((embed) => normalize(embed.title).includes('escolhaseuscargos'))
    )
  );

  const payload = {
    embeds: [buildPanelEmbed(guild)],
    components: buildComponents()
  };

  const primary = matches?.sort((a, b) => b.createdTimestamp - a.createdTimestamp).first() || null;
  if (primary) {
    await primary.edit(payload);
    for (const duplicate of matches.values()) {
      if (duplicate.id === primary.id) continue;
      await duplicate.delete().catch(() => {});
    }
  } else {
    await channel.send(payload);
  }
}

export async function setupUcmSelfRoles(guild) {
  if (!guild || guild.id !== UCM_GUILD_ID) return false;

  const me = await guild.members.fetchMe();
  console.log(
    `[UCM-ROLES] Permissões: gerenciar-canais=${me.permissions.has(PermissionFlagsBits.ManageChannels)} gerenciar-cargos=${me.permissions.has(PermissionFlagsBits.ManageRoles)}`
  );

  const channel = await ensureRolesChannel(guild);
  await ensureRoles(guild);
  await upsertPanel(channel, guild);

  console.log('[UCM-ROLES] 🪪・cargos configurado.');
  return true;
}

async function removeGroupRoles(member, guild, groupName) {
  for (const definition of ROLE_GROUPS[groupName]) {
    const role = await findRole(guild, definition.name);
    if (role && member.roles.cache.has(role.id)) {
      await member.roles.remove(role, 'Troca de cargo de auto-seleção no UCM Studios');
    }
  }
}

async function applyExclusiveSelection(interaction, groupName, selectedKey) {
  const { guild, member } = interaction;
  await removeGroupRoles(member, guild, groupName);

  if (selectedKey === 'none') {
    await interaction.reply({ content: '✅ Seleção removida.', ephemeral: true });
    return true;
  }

  const definition = ROLE_GROUPS[groupName].find((item) => item.key === selectedKey);
  if (!definition) return false;

  const role = await findRole(guild, definition.name);
  if (!role) {
    await interaction.reply({
      content: 'Esse cargo ainda não está disponível. Um administrador precisa liberar **Gerenciar Cargos** para o Rimuru.',
      ephemeral: true
    });
    return true;
  }

  await member.roles.add(role, 'Cargo escolhido pelo próprio membro no UCM Studios');
  await interaction.reply({ content: `✅ Cargo **${definition.label}** aplicado.`, ephemeral: true });
  return true;
}

export async function handleUcmSelfRoleInteraction(interaction) {
  if (!interaction.inGuild() || interaction.guildId !== UCM_GUILD_ID) return false;

  if (interaction.isStringSelectMenu() && interaction.customId === 'ucm_roles_country') {
    return applyExclusiveSelection(interaction, 'country', interaction.values[0]);
  }

  if (interaction.isStringSelectMenu() && interaction.customId === 'ucm_roles_team') {
    return applyExclusiveSelection(interaction, 'team', interaction.values[0]);
  }

  if (interaction.isButton() && interaction.customId === 'ucm_roles_sneak') {
    const definition = ROLE_GROUPS.sneak[0];
    const role = await findRole(interaction.guild, definition.name);

    if (!role) {
      await interaction.reply({
        content: 'O cargo Sneak Peek ainda não está disponível. Um administrador precisa liberar **Gerenciar Cargos** para o Rimuru.',
        ephemeral: true
      });
      return true;
    }

    const member = interaction.member;
    const hasRole = member.roles.cache.has(role.id);

    if (hasRole) {
      await member.roles.remove(role, 'Sneak Peek removido pelo próprio membro');
      await interaction.reply({ content: '✅ Sneak Peek removido.', ephemeral: true });
    } else {
      await member.roles.add(role, 'Sneak Peek ativado pelo próprio membro');
      await interaction.reply({ content: '✅ Sneak Peek ativado.', ephemeral: true });
    }

    return true;
  }

  return false;
}
