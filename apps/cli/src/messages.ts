import type { Locale } from '@legion/core';

const pt = {
  'doctor.title': 'Legion doctor',
  'doctor.summary_ok': 'Tudo certo! Nenhum problema bloqueante.',
  'doctor.summary_fail': '{count} problema(s) bloqueante(s). Corrija os ❌ e rode de novo.',
  'doctor.fix': 'Como corrigir',
  'check.env': 'Arquivo .env e variáveis',
  'check.env.ok': 'Variáveis obrigatórias preenchidas',
  'check.env.fix':
    'Copie .env.example para .env e preencha DISCORD_TOKEN, DISCORD_CLIENT_ID e DISCORD_GUILD_ID (ou rode "legion init")',
  'check.token': 'Token do bot',
  'check.token.ok': 'Token válido (bot {name})',
  'check.token.fail': 'O Discord recusou o token',
  'check.token.fix': 'Developer Portal → sua aplicação → Bot → Reset Token, e cole o novo token no .env',
  'check.app': 'ID da aplicação',
  'check.app.ok': 'DISCORD_CLIENT_ID confere com o token',
  'check.app.fail': 'DISCORD_CLIENT_ID ({given}) não é o ID desta aplicação ({actual})',
  'check.app.fix': 'Developer Portal → General Information → Application ID',
  'check.intents': 'Intent "Server Members"',
  'check.intents.ok': 'Server Members Intent ligada',
  'check.intents.fail': 'Server Members Intent desligada (o Cérebro precisa dela para ver quem entra)',
  'check.intents.fix':
    'Developer Portal → Bot → Privileged Gateway Intents → ligue "Server Members Intent" e salve',
  'check.guild': 'Bot no servidor',
  'check.guild.ok': 'O bot está no servidor {name}',
  'check.guild.fail': 'O bot não está no servidor {guild}',
  'check.guild.fix': 'Rode "legion invite-url", abra o link e adicione o bot ao servidor',
  'check.config': 'legion.config.yaml',
  'check.config.ok': 'Configuração válida (bots: {bots})',
  'check.config.fix': 'Corrija as linhas acima no legion.config.yaml',
  'check.channels': 'Permissões nos canais',
  'check.channels.ok': 'O bot pode ver, enviar e usar embeds em {count} canal(is) configurado(s)',
  'check.channels.missing': 'channels.{key} ({id}) não existe no servidor',
  'check.channels.perms': 'channels.{key} (#{name}): faltam {perms}',
  'check.channels.fix':
    'Confira os IDs dos canais e dê ao cargo do bot as permissões Ver canal, Enviar mensagens e Inserir links',
  'check.db': 'Banco de dados',
  'check.db.ok': 'Banco acessível ({dialect}); migrações em dia',
  'check.db.pending':
    'Banco acessível ({dialect}); migrações pendentes em: {pkgs} (serão aplicadas ao iniciar)',
  'check.db.fail': 'Não consegui abrir o banco: {error}',
  'check.db.fix': 'Confira DATABASE_URL (padrão file:./data/legion.db) e se a pasta ./data pode ser escrita',
  skipped: 'pulado (depende de um item anterior)',
  'init.intro': 'Configuração do Legion',
  'init.token': 'Token do bot (Developer Portal → Bot → Reset Token)',
  'init.client': 'Application ID (Developer Portal → General Information)',
  'init.guild': 'ID do servidor (modo desenvolvedor → botão direito no servidor → Copiar ID)',
  'init.locale': 'Idioma',
  'init.bots': 'Quais bots ligar?',
  'init.overwrite': '{file} já existe. Sobrescrever?',
  'init.kept': '{file} mantido sem mudanças.',
  'init.written': '{file} criado.',
  'init.done':
    'Pronto! Próximos passos: "legion invite-url" para convidar o bot e "legion doctor" para conferir tudo.',
  'init.invalid_id': 'Use só números (ID do Discord).',
  'init.required': 'Obrigatório.',
  'commands.registered': '{count} comando(s) registrado(s) no servidor: {names}',
} as const;

const en: Record<keyof typeof pt, string> = {
  'doctor.title': 'Legion doctor',
  'doctor.summary_ok': 'All good! No blocking problems.',
  'doctor.summary_fail': '{count} blocking problem(s). Fix the ❌ items and run again.',
  'doctor.fix': 'How to fix',
  'check.env': '.env file and variables',
  'check.env.ok': 'Required variables are set',
  'check.env.fix':
    'Copy .env.example to .env and fill DISCORD_TOKEN, DISCORD_CLIENT_ID and DISCORD_GUILD_ID (or run "legion init")',
  'check.token': 'Bot token',
  'check.token.ok': 'Valid token (bot {name})',
  'check.token.fail': 'Discord rejected the token',
  'check.token.fix':
    'Developer Portal → your application → Bot → Reset Token, then paste the new token into .env',
  'check.app': 'Application ID',
  'check.app.ok': 'DISCORD_CLIENT_ID matches the token',
  'check.app.fail': 'DISCORD_CLIENT_ID ({given}) is not this application ID ({actual})',
  'check.app.fix': 'Developer Portal → General Information → Application ID',
  'check.intents': '"Server Members" intent',
  'check.intents.ok': 'Server Members Intent is on',
  'check.intents.fail': 'Server Members Intent is off (Cérebro needs it to see who joins)',
  'check.intents.fix':
    'Developer Portal → Bot → Privileged Gateway Intents → turn on "Server Members Intent" and save',
  'check.guild': 'Bot in the server',
  'check.guild.ok': 'The bot is in {name}',
  'check.guild.fail': 'The bot is not in server {guild}',
  'check.guild.fix': 'Run "legion invite-url", open the link and add the bot to the server',
  'check.config': 'legion.config.yaml',
  'check.config.ok': 'Valid configuration (bots: {bots})',
  'check.config.fix': 'Fix the lines above in legion.config.yaml',
  'check.channels': 'Channel permissions',
  'check.channels.ok': 'The bot can view, send and embed in {count} configured channel(s)',
  'check.channels.missing': 'channels.{key} ({id}) does not exist in the server',
  'check.channels.perms': 'channels.{key} (#{name}): missing {perms}',
  'check.channels.fix':
    'Check the channel IDs and give the bot role View Channel, Send Messages and Embed Links',
  'check.db': 'Database',
  'check.db.ok': 'Database reachable ({dialect}); migrations up to date',
  'check.db.pending': 'Database reachable ({dialect}); pending migrations in: {pkgs} (applied on start)',
  'check.db.fail': 'Could not open the database: {error}',
  'check.db.fix': 'Check DATABASE_URL (default file:./data/legion.db) and that ./data is writable',
  skipped: 'skipped (depends on an earlier item)',
  'init.intro': 'Legion setup',
  'init.token': 'Bot token (Developer Portal → Bot → Reset Token)',
  'init.client': 'Application ID (Developer Portal → General Information)',
  'init.guild': 'Server ID (developer mode → right-click the server → Copy ID)',
  'init.locale': 'Language',
  'init.bots': 'Which bots to enable?',
  'init.overwrite': '{file} already exists. Overwrite?',
  'init.kept': '{file} kept unchanged.',
  'init.written': '{file} written.',
  'init.done': 'Done! Next: "legion invite-url" to invite the bot and "legion doctor" to check everything.',
  'init.invalid_id': 'Use digits only (Discord ID).',
  'init.required': 'Required.',
  'commands.registered': '{count} command(s) registered in the server: {names}',
};

export type MessageKey = keyof typeof pt;

export function msg(locale: Locale, key: MessageKey, vars: Record<string, string | number> = {}): string {
  const tpl: string = (locale === 'en' ? en : pt)[key];
  return tpl.replace(/\{(\w+)\}/g, (m, k: string) => (vars[k] === undefined ? m : String(vars[k])));
}

/** CLI language: LEGION_LANG, then the config locale, then pt-BR. */
export function cliLocale(configLocale?: string): Locale {
  const v = process.env.LEGION_LANG ?? configLocale;
  return v === 'en' ? 'en' : 'pt-BR';
}
