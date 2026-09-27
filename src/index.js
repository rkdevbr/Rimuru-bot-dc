import 'dotenv/config';
import {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelType,
  Client,
  EmbedBuilder,
  Events,
  GatewayIntentBits,
  ModalBuilder,
  Partials,
  PermissionFlagsBits,
  StringSelectMenuBuilder,
  TextInputBuilder,
  TextInputStyle
} from 'discord.js';
import { messageEmbedText, messageHasCustomId, newestMessage } from './panel-utils.js';
import { configureBumpChannel } from './bump-permissions.js';
import { repairWelcomeNames } from './repair-welcome-names.js';
import { createBotInvite, setupGenericGuild, handleGenericMemberAdd, handleGenericInteraction } from './generic-guild.js';
import { isGenericGuild } from './guild-profile.js';

const {
  DISCORD_TOKEN,
  WELCOME_CHANNEL_ID,
  MEMBER_ROLE_ID,
  LOG_CHANNEL_ID
} = process.env;

if (!DISCORD_TOKEN) {
  console.error('DISCORD_TOKEN não configurado.');
  process.exit(1);
}

const TEMPLATE_ART = {
  rules: 'https://raw.githubusercontent.com/paleascendancy/mangamorph/main/discord-bot/assets/rules.webp',
  applications: 'https://raw.githubusercontent.com/paleascendancy/mangamorph/main/discord-bot/assets/applications.webp',
  support: 'https://raw.githubusercontent.com/paleascendancy/mangamorph/main/discord-bot/assets/support.webp'
};

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildMembers],
  partials: [Partials.GuildMember]
});

const normalize = (value = '') => value
  .normalize('NFD')
  .replace(/[\u0300-\u036f]/g, '')
  .toLowerCase()
  .replace(/[^a-z0-9]/g, '');

function userIdentity(user, member = null) {
  const displayName = member?.displayName || user.globalName || user.username;
  const username = user.username ? `@${user.username}` : 'sem username';
  return `${displayName} (${username}) • ID: ${user.id}`;
}

const TICKET_REASONS = {
  tecnico: { label: 'Problema técnico', emoji: '🛠️' },
  obra: { label: 'Obra ou capítulo', emoji: '📚' },
  parceria: { label: 'Parceria / Scan', emoji: '🤝' },
  candidatura: { label: 'Candidatura para equipe', emoji: '📨' },
  denuncia: { label: 'Denúncia', emoji: '🚨' }
};

const STAFF_ROLE_NAMES = new Set([
  'direcao',
  'administrador',
  'moderador',
  'equipemangamorph'
]);

async function findTextChannel(guild, configuredId, expectedNames) {
  if (configuredId) {
    const byId = await guild.channels.fetch(configuredId).catch(() => null);
    if (byId?.isTextBased()) return byId;
  }

  const channels = await guild.channels.fetch();
  const wanted = expectedNames.map(normalize);
  return channels.find((channel) =>
    channel?.isTextBased() && wanted.includes(normalize(channel.name))
  ) || null;
}

async function findMemberRole(guild) {
  if (MEMBER_ROLE_ID) {
    const byId = await guild.roles.fetch(MEMBER_ROLE_ID).catch(() => null);
    if (byId) return byId;
  }

  const roles = await guild.roles.fetch();
  return roles.find((role) => normalize(role.name) === 'membro') || null;
}

async function findLogChannel(guild) {
  return findTextChannel(guild, LOG_CHANNEL_ID, ['📋・logs', 'logs', 'log']);
}

async function findTicketPanelChannel(guild) {
  return findTextChannel(guild, null, ['🎫・abrir-ticket', 'abrir-ticket', 'abrirticket']);
}

async function findRulesChannel(guild) {
  return findTextChannel(guild, null, ['📜・regras', 'regras']);
}

async function findApplicationChannel(guild) {
  return findTextChannel(guild, null, ['📨・candidaturas', 'candidaturas', 'candidatura']);
}

function buildRulesEmbeds() {
  const header = new EmbedBuilder()
    .setColor(0x6f7cff)
    .setAuthor({ name: 'MangaMorph • Comunidade Oficial' })
    .setTitle('Código da Comunidade')
    .setDescription(
      'Um servidor organizado começa com regras simples e claras. Leia antes de participar.\n\n' +
      '**8 regras essenciais • leitura rápida • canal somente leitura**'
    )
    .setThumbnail(TEMPLATE_ART.rules);

  const convivencia = new EmbedBuilder()
    .setColor(0x2f3545)
    .setTitle('01  ·  CONVIVÊNCIA')
    .setDescription(
      '`01` **Respeito**\n' +
      'Converse com educação. Assédio, discriminação, perseguição e ataques pessoais não são aceitos.\n\n' +
      '`02` **Sem spam ou flood**\n' +
      'Evite mensagens repetidas, menções em massa, correntes e excesso de emojis.'
    );

  const organizacao = new EmbedBuilder()
    .setColor(0x2f3545)
    .setTitle('02  ·  ORGANIZAÇÃO')
    .setDescription(
      '`03` **Use o canal certo**\n' +
      'Mantenha cada assunto no espaço correspondente e respeite avisos fixados pela equipe.\n\n' +
      '`04` **Divulgação com autorização**\n' +
      'Servidores, sites, perfis, projetos e publicidade precisam de autorização da staff.\n\n' +
      '`05` **Privacidade**\n' +
      'Não publique dados pessoais, informações privadas ou conteúdo usado para expor outras pessoas.'
    );

  const conteudo = new EmbedBuilder()
    .setColor(0x2f3545)
    .setTitle('03  ·  CONTEÚDO & SUPORTE')
    .setDescription(
      '`06` **Spoilers**\n' +
      'Use aviso de spoiler e não revele acontecimentos importantes sem contexto.\n\n' +
      '`07` **Suporte e denúncias**\n' +
      'Problemas, denúncias, parcerias e questões sobre obras devem ir para **🎫・abrir-ticket**.\n\n' +
      '`08` **Moderação**\n' +
      'A staff pode aplicar medidas conforme a situação. Contestações devem ser tratadas por ticket, com respeito.'
    )
    .setFooter({
      text: 'Ao participar do servidor, você concorda com estas diretrizes • MangaMorph'
    });

  return [header, convivencia, organizacao, conteudo];
}

async function ensureRulesPanel(guild) {
  let channel = await findRulesChannel(guild);

  if (!channel) {
    const channels = await guild.channels.fetch();
    const startCategory = channels.find((item) =>
      item?.type === ChannelType.GuildCategory && normalize(item.name).includes('inicio')
    ) || null;

    channel = await guild.channels.create({
      name: '📜・regras',
      type: ChannelType.GuildText,
      parent: startCategory?.id || null,
      topic: 'Diretrizes oficiais • leitura obrigatória • canal somente leitura',
      reason: 'Canal de regras do MangaMorph'
    });
    console.log(`[${guild.name}] Canal de regras criado.`);
  } else {
    await channel.setTopic('Diretrizes oficiais • leitura obrigatória • canal somente leitura').catch(() => {});
  }

  const readOnlyPermissions = {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    AddReactions: false
  };

  await channel.permissionOverwrites.edit(
    guild.roles.everyone.id,
    readOnlyPermissions,
    { reason: 'Canal de regras somente leitura' }
  );

  const memberRole = await findMemberRole(guild);
  if (memberRole) {
    await channel.permissionOverwrites.edit(
      memberRole.id,
      {
        SendMessages: false,
        SendMessagesInThreads: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        AddReactions: false
      },
      { reason: 'Bloquear interação do cargo Membro no canal de regras' }
    );
  }

  await channel.permissionOverwrites.edit(
    client.user.id,
    {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      EmbedLinks: true,
      ManageMessages: true
    },
    { reason: 'Permitir publicação das regras pelo bot' }
  );

  const embeds = buildRulesEmbeds();
  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const ruleMessages = recent?.filter((message) =>
    message.author.id === client.user.id &&
    message.embeds.some((embed) =>
      embed.title === '📜 Regras do MangaMorph' || embed.title === 'Código da Comunidade'
    )
  );

  const primary = ruleMessages ? newestMessage(ruleMessages.values()) : null;

  if (primary) {
    await primary.edit({ embeds });

    const duplicates = ruleMessages.filter((message) => message.id !== primary.id);
    for (const message of duplicates.values()) {
      await message.delete().catch(() => {});
    }

    console.log(`[${guild.name}] Template de regras atualizado.`);
    return;
  }

  await channel.send({ embeds });
  console.log(`[${guild.name}] Template de regras publicado.`);
}

function applicationPanelComponents() {
  const button = new ButtonBuilder()
    .setCustomId('mm_application_open')
    .setLabel('Abrir candidatura')
    .setEmoji('📨')
    .setStyle(ButtonStyle.Primary);

  return [new ActionRowBuilder().addComponents(button)];
}

function buildApplicationEmbeds() {
  const header = new EmbedBuilder()
    .setColor(0x6f7cff)
    .setAuthor({ name: 'MangaMorph • Equipe' })
    .setTitle('📨 Candidaturas MangaMorph')
    .setDescription(
      'Quer fazer parte da equipe do **MangaMorph**?\n\n' +
      'Buscamos pessoas responsáveis, comunicativas e com vontade de contribuir para o crescimento da comunidade e da plataforma.\n\n' +
      '**Clique em `Abrir candidatura` para começar.**'
    )
    .setThumbnail(TEMPLATE_ART.applications);

  const areas = new EmbedBuilder()
    .setColor(0x2f3545)
    .setTitle('01  ·  ÁREAS COM PRIORIDADE')
    .setDescription(
      '🛡️ **Moderação & suporte**\n' +
      'Atendimento, organização e apoio à comunidade.\n\n' +
      '📚 **Curadoria de obras**\n' +
      'Títulos, capítulos, capas e informações.\n\n' +
      '🗂️ **Organização de conteúdo**\n' +
      'Pedidos, correções e qualidade do catálogo.\n\n' +
      '🎨 **Design & divulgação**\n' +
      'Artes, identidade visual e materiais promocionais.\n\n' +
      '✍️ **Editorial / scan**\n' +
      'Revisão, tradução, clean, redraw e type.'
    );

  const perfil = new EmbedBuilder()
    .setColor(0x2f3545)
    .setTitle('02  ·  O QUE ESPERAMOS')
    .setDescription(
      '• Compromisso\n' +
      '• Boa comunicação\n' +
      '• Responsabilidade\n' +
      '• Respeito com a equipe\n' +
      '• Vontade de aprender e evoluir'
    );

  const processo = new EmbedBuilder()
    .setColor(0x2f3545)
    .setTitle('03  ·  COMO FUNCIONA')
    .setDescription(
      '`01` Área de interesse\n' +
      '`02` Disponibilidade\n' +
      '`03` Experiência\n' +
      '`04` Como você pode ajudar\n' +
      '`05` O que deseja aprender\n\n' +
      '**Não é obrigatório saber tudo.** Dedicação, responsabilidade e potencial também contam.'
    )
    .setFooter({ text: 'MangaMorph • Candidaturas oficiais da equipe' });

  return [header, areas, perfil, processo];
}

async function ensureApplicationPanel(guild) {
  let channel = await findApplicationChannel(guild);

  if (!channel) {
    const channels = await guild.channels.fetch();
    let contributeCategory = channels.find((item) =>
      item?.type === ChannelType.GuildCategory && normalize(item.name).includes('contribuir')
    ) || null;

    if (!contributeCategory) {
      contributeCategory = await guild.channels.create({
        name: '「 MM 」 CONTRIBUIR',
        type: ChannelType.GuildCategory,
        reason: 'Estrutura de candidaturas do MangaMorph'
      });
    }

    channel = await guild.channels.create({
      name: '📨・candidaturas',
      type: ChannelType.GuildText,
      parent: contributeCategory.id,
      topic: 'Entre para a equipe do MangaMorph • candidaturas abertas',
      reason: 'Canal de candidaturas do MangaMorph'
    });
    console.log(`[${guild.name}] Canal de candidaturas criado.`);
  } else {
    await channel.setTopic('Entre para a equipe do MangaMorph • candidaturas abertas').catch(() => {});
  }

  const readOnlyPermissions = {
    ViewChannel: true,
    ReadMessageHistory: true,
    SendMessages: false,
    SendMessagesInThreads: false,
    CreatePublicThreads: false,
    CreatePrivateThreads: false,
    AddReactions: false
  };

  await channel.permissionOverwrites.edit(
    guild.roles.everyone.id,
    readOnlyPermissions,
    { reason: 'Canal de candidaturas somente leitura' }
  );

  const memberRole = await findMemberRole(guild);
  if (memberRole) {
    await channel.permissionOverwrites.edit(
      memberRole.id,
      {
        SendMessages: false,
        SendMessagesInThreads: false,
        CreatePublicThreads: false,
        CreatePrivateThreads: false,
        AddReactions: false
      },
      { reason: 'Bloquear mensagens no canal de candidaturas' }
    );
  }

  await channel.permissionOverwrites.edit(
    client.user.id,
    {
      ViewChannel: true,
      SendMessages: true,
      ReadMessageHistory: true,
      EmbedLinks: true,
      ManageMessages: true
    },
    { reason: 'Permitir painel de candidaturas do MangaMorph' }
  );

  const recent = await channel.messages.fetch({ limit: 50 }).catch(() => null);
  const applicationMessages = recent?.filter((message) => {
    if (message.author.id !== client.user.id) return false;
    const text = messageEmbedText(message);
    return messageHasCustomId(message, 'mm_application_open') ||
      text.includes('candidaturasmangamorph') ||
      text.includes('mangamorphequipe');
  });
  const primary = applicationMessages ? newestMessage(applicationMessages.values()) : null;
  const payload = {
    embeds: buildApplicationEmbeds(),
    components: applicationPanelComponents()
  };

  if (primary) {
    await primary.edit(payload);
    const duplicates = applicationMessages.filter((message) => message.id !== primary.id);
    for (const message of duplicates.values()) {
      await message.delete().catch(() => {});
    }
    console.log(`[${guild.name}] Painel de candidaturas atualizado.`);
    return;
  }

  await channel.send(payload);
  console.log(`[${guild.name}] Painel de candidaturas publicado.`);
}

async function ensureSupportArea(guild) {
  const channels = await guild.channels.fetch();
  let category = channels.find((channel) =>
    channel?.type === ChannelType.GuildCategory && normalize(channel.name).includes('suporte')
  ) || null;

  if (!category) {
    category = await guild.channels.create({
      name: '「 MM 」 SUPORTE',
      type: ChannelType.GuildCategory,
      reason: 'Estrutura automática de suporte do MangaMorph'
    });
    console.log(`[${guild.name}] Categoria de suporte criada.`);
  }

  let panelChannel = await findTicketPanelChannel(guild);
  if (!panelChannel) {
    const roles = await guild.roles.fetch();
    const staffRoles = roles.filter((role) => STAFF_ROLE_NAMES.has(normalize(role.name)));

    const permissionOverwrites = [
      {
        id: guild.roles.everyone.id,
        allow: [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.ReadMessageHistory],
        deny: [PermissionFlagsBits.SendMessages]
      },
      {
        id: client.user.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory,
          PermissionFlagsBits.ManageChannels,
          PermissionFlagsBits.ManageMessages,
          PermissionFlagsBits.EmbedLinks
        ]
      }
    ];

    for (const role of staffRoles.values()) {
      permissionOverwrites.push({
        id: role.id,
        allow: [
          PermissionFlagsBits.ViewChannel,
          PermissionFlagsBits.SendMessages,
          PermissionFlagsBits.ReadMessageHistory
        ]
      });
    }

    panelChannel = await guild.channels.create({
      name: '🎫・abrir-ticket',
      type: ChannelType.GuildText,
      parent: category.id,
      topic: 'Abra um atendimento privado com a equipe do MangaMorph.',
      permissionOverwrites,
      reason: 'Canal automático de tickets do MangaMorph'
    });
    console.log(`[${guild.name}] Canal abrir-ticket criado.`);
  } else if (panelChannel.parentId !== category.id) {
    await panelChannel.setParent(category.id, { lockPermissions: false }).catch(() => {});
  }

  return { category, panelChannel };
}

async function getGuildMember(guild, userId) {
  return guild.members.fetch(userId).catch(() => null);
}

function isStaff(member) {
  if (!member) return false;
  if (member.permissions.has(PermissionFlagsBits.ManageMessages)) return true;
  return member.roles.cache.some((role) => STAFF_ROLE_NAMES.has(normalize(role.name)));
}

function getTicketOwnerId(channel) {
  const match = channel.topic?.match(/MM_TICKET:(\d+)/);
  return match?.[1] || null;
}

function isTicketChannel(channel) {
  return channel?.type === ChannelType.GuildText && channel.topic?.startsWith('MM_TICKET:');
}

async function findOpenTicket(guild, userId) {
  const channels = await guild.channels.fetch();
  return channels.find((channel) =>
    isTicketChannel(channel) && getTicketOwnerId(channel) === userId
  ) || null;
}

async function sendLog(guild, title, description, fields = []) {
  const logChannel = await findLogChannel(guild);
  if (!logChannel) return;

  const embed = new EmbedBuilder()
    .setColor(0x2b2f36)
    .setTitle(title)
    .setDescription(description)
    .addFields(fields)
    .setTimestamp();

  await logChannel.send({ embeds: [embed] }).catch((error) => {
    console.error('Falha ao enviar log:', error);
  });
}

function ticketPanelComponents() {
  const button = new ButtonBuilder()
    .setCustomId('mm_ticket_open')
    .setLabel('Abrir atendimento')
    .setEmoji('🎫')
    .setStyle(ButtonStyle.Primary);

  return [new ActionRowBuilder().addComponents(button)];
}

async function ensureTicketPanel(guild) {
  const { panelChannel: channel } = await ensureSupportArea(guild);
  const recent = await channel.messages.fetch({ limit: 100 }).catch(() => null);
  const matches = recent?.filter((message) => {
    if (message.author.id !== client.user.id) return false;
    const text = messageEmbedText(message);
    return messageHasCustomId(message, 'mm_ticket_open') ||
      text.includes('centraldeatendimentomangamorph') ||
      text.includes('mangamorphsuporte');
  });
  const existing = matches ? newestMessage(matches.values()) : null;

  const embed = new EmbedBuilder()
    .setColor(0x6f7cff)
    .setAuthor({ name: 'MangaMorph • Suporte' })
    .setTitle('Central de atendimento MangaMorph')
    .setDescription(
      'Precisa falar com a equipe? Abra um atendimento privado.\n\n' +
      'Você poderá escolher entre **problema técnico**, **obra ou capítulo**, **parceria/scan**, **candidatura** e **denúncia**.\n\n' +
      'Clique no botão abaixo para começar.'
    )
    .setThumbnail(TEMPLATE_ART.support)
    .setFooter({ text: 'MangaMorph • Suporte' });

  const payload = { embeds: [embed], components: ticketPanelComponents() };

  if (existing) {
    await existing.edit(payload);
    const duplicates = matches.filter((message) => message.id !== existing.id);
    for (const duplicate of duplicates.values()) {
      await duplicate.delete().catch(() => {});
    }
    console.log(`[${guild.name}] Painel de suporte atualizado.`);
    return;
  }

  await channel.send(payload);
  console.log(`[${guild.name}] Painel de suporte publicado.`);
}

async function createTicket(interaction, reasonKey) {
  const { guild, user } = interaction;
  const reason = TICKET_REASONS[reasonKey];

  if (!guild || !reason) {
    await interaction.reply({ content: 'Não foi possível abrir o ticket.', ephemeral: true });
    return null;
  }

  const alreadyOpen = await findOpenTicket(guild, user.id);
  if (alreadyOpen) {
    await interaction.reply({ content: `Você já tem um ticket aberto: ${alreadyOpen}`, ephemeral: true });
    return null;
  }

  const { category: supportCategory } = await ensureSupportArea(guild);
  const roles = await guild.roles.fetch();
  const staffRoles = roles.filter((role) => STAFF_ROLE_NAMES.has(normalize(role.name)));

  const permissionOverwrites = [
    { id: guild.roles.everyone.id, deny: [PermissionFlagsBits.ViewChannel] },
    {
      id: user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    },
    {
      id: client.user.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.ManageChannels
      ]
    }
  ];

  for (const role of staffRoles.values()) {
    permissionOverwrites.push({
      id: role.id,
      allow: [
        PermissionFlagsBits.ViewChannel,
        PermissionFlagsBits.SendMessages,
        PermissionFlagsBits.ReadMessageHistory,
        PermissionFlagsBits.AttachFiles,
        PermissionFlagsBits.EmbedLinks
      ]
    });
  }

  const safeName = normalize(user.username).slice(0, 16) || 'membro';
  const channelName = reasonKey === 'candidatura'
    ? `candidatura-${safeName}-${user.id.slice(-4)}`
    : `ticket-${safeName}-${user.id.slice(-4)}`;

  const channel = await guild.channels.create({
    name: channelName,
    type: ChannelType.GuildText,
    parent: supportCategory.id,
    topic: `MM_TICKET:${user.id}|TYPE:${reasonKey}|CLAIMED:`,
    permissionOverwrites
  });

  const actions = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId('mm_ticket_claim').setLabel('Assumir').setEmoji('🛡️').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mm_ticket_add').setLabel('Adicionar membro').setEmoji('➕').setStyle(ButtonStyle.Secondary),
    new ButtonBuilder().setCustomId('mm_ticket_close').setLabel('Fechar ticket').setEmoji('🔒').setStyle(ButtonStyle.Danger)
  );

  const embed = new EmbedBuilder()
    .setColor(reasonKey === 'candidatura' ? 0x6f7cff : 0x111318)
    .setTitle(`${reason.emoji} ${reason.label}`)
    .setDescription(
      reasonKey === 'candidatura'
        ? `${interaction.member?.displayName || user.globalName || user.username}, sua candidatura foi recebida. A equipe poderá conversar com você por este canal durante a análise.`
        : `${interaction.member?.displayName || user.globalName || user.username}, seu atendimento foi aberto. Explique o que aconteceu e envie as informações necessárias para a equipe analisar.\n\nA conversa deste canal é privada entre você e a equipe do MangaMorph.`
    )
    .addFields(
      { name: 'Solicitante', value: userIdentity(user, interaction.member), inline: false },
      { name: 'Motivo', value: reason.label, inline: true }
    )
    .setThumbnail(reasonKey === 'candidatura' ? TEMPLATE_ART.applications : TEMPLATE_ART.support)
    .setFooter({ text: 'MangaMorph • Ticket' })
    .setTimestamp();

  await channel.send({ content: `${user}`, embeds: [embed], components: [actions] });
  await interaction.reply({ content: `${reasonKey === 'candidatura' ? 'Candidatura' : 'Ticket'} criado: ${channel}`, ephemeral: true });

  await sendLog(guild, reasonKey === 'candidatura' ? 'Nova candidatura' : 'Ticket aberto', `${userIdentity(user, interaction.member)} abriu ${channel}.`, [
    { name: 'Motivo', value: reason.label, inline: true },
    { name: 'Canal', value: `${channel}`, inline: true }
  ]);

  return channel;
}

function buildApplicationModal() {
  const area = new TextInputBuilder()
    .setCustomId('application_area')
    .setLabel('Qual área você quer seguir?')
    .setPlaceholder('Ex.: curadoria de obras, design, moderação...')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true);

  const availability = new TextInputBuilder()
    .setCustomId('application_availability')
    .setLabel('Qual sua disponibilidade?')
    .setPlaceholder('Ex.: 1 hora por dia / fins de semana')
    .setStyle(TextInputStyle.Short)
    .setMaxLength(100)
    .setRequired(true);

  const experience = new TextInputBuilder()
    .setCustomId('application_experience')
    .setLabel('Você já tem experiência?')
    .setPlaceholder('Se não tiver, pode dizer que está começando.')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(500)
    .setRequired(true);

  const contribution = new TextInputBuilder()
    .setCustomId('application_contribution')
    .setLabel('Como você pode ajudar o MangaMorph?')
    .setPlaceholder('Conte de forma breve como pretende contribuir.')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(500)
    .setRequired(true);

  const learning = new TextInputBuilder()
    .setCustomId('application_learning')
    .setLabel('O que você gostaria de aprender?')
    .setPlaceholder('Opcional: função ou habilidade que quer desenvolver.')
    .setStyle(TextInputStyle.Paragraph)
    .setMaxLength(300)
    .setRequired(false);

  return new ModalBuilder()
    .setCustomId('mm_application_modal')
    .setTitle('Candidatura MangaMorph')
    .addComponents(
      new ActionRowBuilder().addComponents(area),
      new ActionRowBuilder().addComponents(availability),
      new ActionRowBuilder().addComponents(experience),
      new ActionRowBuilder().addComponents(contribution),
      new ActionRowBuilder().addComponents(learning)
    );
}

async function setupGuild(guild) {
  if (isGenericGuild(guild)) {
    await setupGenericGuild(guild, client).catch((error) => {
      console.error(`[MULTI] Falha ao preparar ${guild.name}:`, error);
    });
    return;
  }

  await ensureRulesPanel(guild).catch((error) => {
    console.error(`Falha ao preparar regras em ${guild.name}:`, error);
  });

  await ensureApplicationPanel(guild).catch((error) => {
    console.error(`Falha ao preparar candidaturas em ${guild.name}:`, error);
  });

  await ensureTicketPanel(guild).catch((error) => {
    console.error(`Falha ao preparar suporte em ${guild.name}:`, error);
  });
}

client.once(Events.ClientReady, async () => {
  console.log(`Rimuru online como ${client.user.tag}`);
  client.user.setActivity('Rimuru • /rimuru ajuda');

  createBotInvite(client)
    .then((invite) => console.log('[INVITE] ' + invite))
    .catch((error) => console.error('[INVITE] Falha ao gerar convite:', error));

  configureBumpChannel(client).catch((error) => {
    console.error('[BUMP] Falha ao configurar #bump:', error);
  });

  repairWelcomeNames(client).catch((error) => {
    console.error('[WELCOME-REPAIR] Falha na correção de nomes:', error);
  });

  const connectedGuilds = [...client.guilds.cache.values()];
  console.log(`[MULTI] Servidores conectados: ${connectedGuilds.map((guild) => `${guild.name} (${guild.id})`).join(' | ')}`);

  await Promise.allSettled(
    connectedGuilds.map((guild) => setupGuild(guild))
  );
});

client.on(Events.GuildCreate, async (guild) => {
  await setupGuild(guild);
});

client.on(Events.GuildMemberAdd, async (member) => {
  try {
    if (isGenericGuild(member.guild)) {
      await handleGenericMemberAdd(member, client);
      return;
    }

    const role = await findMemberRole(member.guild);
    if (role) {
      await member.roles.add(role, 'Entrada automática no MangaMorph').catch((error) => {
        console.error('Não foi possível adicionar o cargo Membro:', error);
      });
    } else {
      console.warn('Cargo Membro não encontrado.');
    }

    const welcomeChannel = await findTextChannel(
      member.guild,
      WELCOME_CHANNEL_ID,
      ['👋・boas-vindas', 'boas-vindas', 'boasvindas']
    );

    if (welcomeChannel) {
      const embed = new EmbedBuilder()
        .setColor(0x111318)
        .setAuthor({ name: 'MangaMorph', iconURL: client.user.displayAvatarURL() })
        .setTitle('Bem-vindo ao MangaMorph')
        .setDescription(
          `Olá, ${member.displayName || member.user.globalName || member.user.username}. Você acaba de entrar na comunidade oficial do **MangaMorph**.\n\n` +
          'Descubra novas obras, acompanhe lançamentos, participe das discussões e ajude a construir a plataforma.\n\n' +
          '**Comece por aqui**\n' +
          '🧭・comece-aqui\n' +
          '📜・regras\n' +
          '💬・geral'
        )
        .setThumbnail(member.user.displayAvatarURL({ size: 256 }))
        .setFooter({ text: `Membro #${member.guild.memberCount} • MangaMorph` })
        .setTimestamp();

      await welcomeChannel.send({ embeds: [embed] });
    } else {
      console.warn('Canal de boas-vindas não encontrado.');
    }

    await sendLog(member.guild, 'Novo membro', `${userIdentity(member.user, member)} entrou no servidor.`, [
      { name: 'Usuário', value: `${member.user.tag}`, inline: true },
      { name: 'ID', value: member.id, inline: true },
      { name: 'Total', value: String(member.guild.memberCount), inline: true }
    ]);
  } catch (error) {
    console.error('Falha ao processar entrada de membro:', error);
  }
});

client.on(Events.InteractionCreate, async (interaction) => {
  try {
    if (!interaction.inGuild()) return;

    if (await handleGenericInteraction(interaction, client)) return;

    if (interaction.isButton() && interaction.customId === 'mm_application_open') {
      const alreadyOpen = await findOpenTicket(interaction.guild, interaction.user.id);
      if (alreadyOpen) {
        await interaction.reply({
          content: `Você já tem um atendimento aberto: ${alreadyOpen}. Feche-o antes de iniciar uma candidatura.`,
          ephemeral: true
        });
        return;
      }

      await interaction.showModal(buildApplicationModal());
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'mm_application_modal') {
      const alreadyOpen = await findOpenTicket(interaction.guild, interaction.user.id);
      if (alreadyOpen) {
        await interaction.reply({
          content: `Você já tem um atendimento aberto: ${alreadyOpen}.`,
          ephemeral: true
        });
        return;
      }

      const application = {
        area: interaction.fields.getTextInputValue('application_area'),
        availability: interaction.fields.getTextInputValue('application_availability'),
        experience: interaction.fields.getTextInputValue('application_experience'),
        contribution: interaction.fields.getTextInputValue('application_contribution'),
        learning: interaction.fields.getTextInputValue('application_learning') || 'Não informado'
      };

      const channel = await createTicket(interaction, 'candidatura');
      if (!channel) return;

      const summary = new EmbedBuilder()
        .setColor(0x6f7cff)
        .setTitle('Ficha de candidatura')
        .setDescription(`Respostas enviadas por ${userIdentity(interaction.user, interaction.member)}.`)
        .addFields(
          { name: 'Área de interesse', value: application.area },
          { name: 'Disponibilidade', value: application.availability },
          { name: 'Experiência', value: application.experience },
          { name: 'Como pode ajudar', value: application.contribution },
          { name: 'O que gostaria de aprender', value: application.learning }
        )
        .setThumbnail(TEMPLATE_ART.applications)
        .setFooter({ text: 'MangaMorph • Processo de candidatura' })
        .setTimestamp();

      await channel.send({ embeds: [summary] });
      return;
    }

    if (interaction.isButton() && interaction.customId === 'mm_ticket_open') {
      const select = new StringSelectMenuBuilder()
        .setCustomId('mm_ticket_reason')
        .setPlaceholder('Escolha o motivo do atendimento')
        .addOptions(
          Object.entries(TICKET_REASONS).map(([value, reason]) => ({
            label: reason.label,
            value,
            emoji: reason.emoji
          }))
        );

      await interaction.reply({
        content: 'Qual é o motivo do seu atendimento?',
        components: [new ActionRowBuilder().addComponents(select)],
        ephemeral: true
      });
      return;
    }

    if (interaction.isStringSelectMenu() && interaction.customId === 'mm_ticket_reason') {
      await createTicket(interaction, interaction.values[0]);
      return;
    }

    if (!isTicketChannel(interaction.channel)) return;

    const actor = await getGuildMember(interaction.guild, interaction.user.id);
    const ownerId = getTicketOwnerId(interaction.channel);

    if (interaction.isButton() && interaction.customId === 'mm_ticket_claim') {
      if (!isStaff(actor)) {
        await interaction.reply({ content: 'Somente a equipe pode assumir tickets.', ephemeral: true });
        return;
      }

      const baseTopic = interaction.channel.topic?.replace(/\|CLAIMED:[^|]*/g, '') || `MM_TICKET:${ownerId}`;
      await interaction.channel.setTopic(`${baseTopic}|CLAIMED:${interaction.user.id}`);
      await interaction.reply({ content: `🛡️ Atendimento assumido por ${interaction.user}.` });
      await sendLog(interaction.guild, 'Ticket assumido', `${userIdentity(interaction.user, actor)} assumiu ${interaction.channel}.`);
      return;
    }

    if (interaction.isButton() && interaction.customId === 'mm_ticket_add') {
      if (!isStaff(actor)) {
        await interaction.reply({ content: 'Somente a equipe pode adicionar membros.', ephemeral: true });
        return;
      }

      const input = new TextInputBuilder()
        .setCustomId('member')
        .setLabel('ID ou menção do membro')
        .setPlaceholder('Ex.: 123456789012345678')
        .setStyle(TextInputStyle.Short)
        .setRequired(true);

      const modal = new ModalBuilder()
        .setCustomId('mm_ticket_add_modal')
        .setTitle('Adicionar membro ao ticket')
        .addComponents(new ActionRowBuilder().addComponents(input));

      await interaction.showModal(modal);
      return;
    }

    if (interaction.isModalSubmit() && interaction.customId === 'mm_ticket_add_modal') {
      if (!isStaff(actor)) {
        await interaction.reply({ content: 'Somente a equipe pode adicionar membros.', ephemeral: true });
        return;
      }

      const raw = interaction.fields.getTextInputValue('member');
      const memberId = raw.match(/\d{17,20}/)?.[0];
      const member = memberId ? await getGuildMember(interaction.guild, memberId) : null;

      if (!member) {
        await interaction.reply({ content: 'Não encontrei esse membro no servidor.', ephemeral: true });
        return;
      }

      await interaction.channel.permissionOverwrites.edit(member.id, {
        ViewChannel: true,
        SendMessages: true,
        ReadMessageHistory: true,
        AttachFiles: true,
        EmbedLinks: true
      });

      await interaction.reply({ content: `${member} foi adicionado ao ticket.` });
      await sendLog(
        interaction.guild,
        'Membro adicionado ao ticket',
        `${userIdentity(interaction.user, actor)} adicionou ${userIdentity(member.user, member)} em ${interaction.channel}.`
      );
      return;
    }

    if (interaction.isButton() && interaction.customId === 'mm_ticket_close') {
      if (interaction.user.id !== ownerId && !isStaff(actor)) {
        await interaction.reply({ content: 'Você não pode fechar este ticket.', ephemeral: true });
        return;
      }

      await interaction.reply({ content: '🔒 Ticket encerrado. Este canal será removido em alguns segundos.' });
      const ownerMember = ownerId ? await getGuildMember(interaction.guild, ownerId) : null;
      const ownerLabel = ownerMember
        ? userIdentity(ownerMember.user, ownerMember)
        : ownerId
          ? `ID: ${ownerId}`
          : null;

      await sendLog(
        interaction.guild,
        'Ticket fechado',
        `${userIdentity(interaction.user, actor)} fechou **#${interaction.channel.name}**.`,
        ownerLabel ? [{ name: 'Solicitante', value: ownerLabel, inline: false }] : []
      );

      setTimeout(() => {
        interaction.channel.delete('Ticket encerrado').catch((error) => {
          console.error('Falha ao excluir ticket:', error);
        });
      }, 5000);
    }
  } catch (error) {
    console.error('Falha ao processar interação:', error);
    if (interaction.isRepliable() && !interaction.replied && !interaction.deferred) {
      await interaction.reply({ content: 'Ocorreu um erro ao processar essa ação.', ephemeral: true }).catch(() => {});
    }
  }
});

client.on(Events.Error, (error) => {
  console.error('Erro do cliente Discord:', error);
});

process.on('unhandledRejection', (error) => {
  console.error('Erro não tratado:', error);
});

client.login(DISCORD_TOKEN);
