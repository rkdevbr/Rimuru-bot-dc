import {
  ChannelType,
  EmbedBuilder,
  OAuth2Scopes,
  PermissionFlagsBits,
  SlashCommandBuilder
} from 'discord.js';
import {
  setupWelcomeManager,
  sendConfiguredWelcome
} from './welcome-manager.js';
import { setupLivePreview } from './live-preview.js';
import { setupEmbedStudio } from './embed-studio.js';
import { isGenericGuild } from './guild-profile.js';
import { removeLegacyMangaMorphArtifacts } from './generic-cleanup.js';
import { setupUcmSelfRoles, handleUcmSelfRoleInteraction } from './ucm-self-roles.js';

const rimuruCommand = new SlashCommandBuilder()
  .setName('rimuru')
  .setDescription('Informações e configuração básica do Rimuru')
  .addSubcommand((subcommand) => subcommand
    .setName('ajuda')
    .setDescription('Mostra os recursos disponíveis neste servidor'))
  .addSubcommand((subcommand) => subcommand
    .setName('status')
    .setDescription('Mostra o estado do bot neste servidor'))
  .addSubcommand((subcommand) => subcommand
    .setName('convite')
    .setDescription('Gera o link oficial para adicionar o Rimuru em outro servidor'));

const embedCommand = new SlashCommandBuilder()
  .setName('embed')
  .setDescription('Cria mensagens em embed com editor visual')
  .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
  .addSubcommand((subcommand) => subcommand
    .setName('criar')
    .setDescription('Abre o editor de embed')
    .addChannelOption((option) => option
      .setName('canal')
      .setDescription('Canal de destino')
      .addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement)));

async function upsertGuildCommand(guild, builder) {
  const data = builder.toJSON();
  const commands = await guild.commands.fetch();
  const existing = commands.find((command) => command.name === data.name);
  if (existing) await existing.edit(data);
  else await guild.commands.create(data);
}

export async function createBotInvite(client) {
  return client.generateInvite({
    scopes: [OAuth2Scopes.Bot, OAuth2Scopes.ApplicationsCommands],
    permissions: [
      PermissionFlagsBits.ViewChannel,
      PermissionFlagsBits.SendMessages,
      PermissionFlagsBits.EmbedLinks,
      PermissionFlagsBits.AttachFiles,
      PermissionFlagsBits.ReadMessageHistory,
      PermissionFlagsBits.AddReactions,
      PermissionFlagsBits.ManageMessages,
      PermissionFlagsBits.ManageChannels,
      PermissionFlagsBits.ManageRoles,
      PermissionFlagsBits.ManageWebhooks
    ]
  });
}

export async function setupGenericGuild(guild, client) {
  if (!isGenericGuild(guild)) return false;

  await setupUcmSelfRoles(guild).catch((error) => {
    console.error(`[UCM-ROLES] Falha ao preparar cargos em ${guild.name}:`, error);
  });

  await removeLegacyMangaMorphArtifacts(guild).catch((error) => {
    console.error(`[MULTI-CLEANUP] Falha ao limpar ${guild.name}:`, error);
  });

  await upsertGuildCommand(guild, rimuruCommand);
  await upsertGuildCommand(guild, embedCommand);
  await setupWelcomeManager(guild, client);
  await setupLivePreview(guild, client);
  await setupEmbedStudio(guild);

  console.log(`[MULTI] ${guild.name} (${guild.id}): modo genérico seguro preparado.`);
  return true;
}

export async function handleGenericMemberAdd(member, client) {
  if (!isGenericGuild(member.guild)) return false;

  await sendConfiguredWelcome(member, client).catch((error) => {
    console.error(`[MULTI] Falha nas boas-vindas de ${member.guild.name}:`, error);
  });

  return true;
}

export async function handleGenericInteraction(interaction, client) {
  if (!interaction.inGuild() || !isGenericGuild(interaction.guild)) return false;

  if (await handleUcmSelfRoleInteraction(interaction)) return true;

  if (!interaction.isChatInputCommand() || interaction.commandName !== 'rimuru') return false;

  const subcommand = interaction.options.getSubcommand();

  if (subcommand === 'convite') {
    const invite = await createBotInvite(client);
    await interaction.reply({
      content: `🔗 **Adicionar Rimuru a outro servidor**\n${invite}`,
      ephemeral: true
    });
    return true;
  }

  if (subcommand === 'status') {
    const me = interaction.guild.members.me;
    const embed = new EmbedBuilder()
      .setColor(0x5865F2)
      .setTitle('Rimuru • Status')
      .setDescription('O bot está funcionando neste servidor em modo multi-servidor seguro.')
      .addFields(
        { name: 'Servidor', value: interaction.guild.name, inline: true },
        { name: 'Latência', value: `${Math.max(0, Math.round(client.ws.ping))} ms`, inline: true },
        { name: 'Permissões', value: me?.permissions.has(PermissionFlagsBits.ManageChannels) ? 'Configuração completa' : 'Limitadas', inline: true }
      )
      .setFooter({ text: 'Nada é criado ou alterado automaticamente sem configuração.' });

    await interaction.reply({ embeds: [embed], ephemeral: true });
    return true;
  }

  const embed = new EmbedBuilder()
    .setColor(0x5865F2)
    .setTitle('Rimuru • Recursos')
    .setDescription(
      '**Disponível em qualquer servidor**\n' +
      '• `/boas-vindas` — configure uma mensagem automática personalizada.\n' +
      '• `/boas-vindas editor` — editor visual com prévia.\n' +
      '• `/embed criar` — editor profissional de embeds.\n' +
      '• `/embed editor` — edição visual com prévia ao vivo.\n' +
      '• `/rimuru status` — verifica o funcionamento do bot.\n' +
      '• `/rimuru convite` — gera o link oficial do bot.\n\n' +
      'O Rimuru não cria canais, cargos ou altera permissões automaticamente em servidores novos.'
    )
    .setFooter({ text: 'Recursos administrativos exigem as permissões adequadas.' });

  await interaction.reply({ embeds: [embed], ephemeral: true });
  return true;
}
