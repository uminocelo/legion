import type { Locale } from '@legion/core';

const pt = {
  'doctor.title': 'Legion doctor',
  'doctor.summary_ok': 'Tudo certo! Nenhum problema bloqueante.',
  'doctor.summary_fail': '{count} problema(s) bloqueante(s). Corrija os ❌ e rode de novo.',
  'doctor.fix': 'Como corrigir',
  'check.env': 'Arquivo .env e variáveis',
  'check.env.ok': 'Variáveis obrigatórias preenchidas',
  'check.env.legacy': 'Funcionando, mas com nomes antigos: {vars}',
  'check.env.legacy_fix':
    'No .env, troque DISCORD_TOKEN por CEREBRO_TOKEN e DISCORD_CLIENT_ID por CEREBRO_CLIENT_ID (mesmos valores) e reinicie',
  'check.env.fix':
    'Copie .env.example para .env e preencha CEREBRO_TOKEN, CEREBRO_CLIENT_ID e DISCORD_GUILD_ID (ou rode "legion init")',
  'check.token': 'Token do bot',
  'check.token.ok': 'Token válido (bot {name})',
  'check.token.fail': 'O Discord recusou o token',
  'check.token.fix': 'Developer Portal → sua aplicação → Bot → Reset Token, e cole o novo token no .env',
  'check.app': 'ID da aplicação',
  'check.app.ok': '{var} confere com o token',
  'check.app.fail': '{var} ({given}) não é o ID desta aplicação ({actual})',
  'check.apps': 'Aplicações do Discord',
  'init.apps': 'Um app do Discord para todos os bots, ou um app por bot?',
  'init.apps.one': 'Um app só (mais simples)',
  'init.apps.split': 'Um app por bot (nome e avatar próprios; um token por bot)',
  'init.bot_token': 'Token do app do {bot} (Developer Portal → Bot → Reset Token)',
  'init.bot_client': 'Application ID do app do {bot}',
  'check.apps.fail': 'Tokens por bot incompletos ou repetidos',
  'check.apps.fix':
    'Defina <BOT>_TOKEN e <BOT>_CLIENT_ID juntos (ex.: JARVIS_TOKEN e JARVIS_CLIENT_ID), ou nenhum dos dois',
  'check.app_suffix': ' — app {app} ({bots})',
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
  'check.dashboard': 'Painel da staff',
  'check.dashboard.off': 'Desligado (dashboard.enabled: false)',
  'check.dashboard.ok': 'Ligado em {url} (porta {port}); segredo definido',
  'check.dashboard.no_secret':
    'dashboard.enabled está ligado, mas DASHBOARD_CLIENT_SECRET não está definido; o painel não vai abrir',
  'check.dashboard.no_secret_fix':
    'Developer Portal → app do Cérebro → OAuth2 → Reset Secret; coloque em DASHBOARD_CLIENT_SECRET no .env (veja docs/DASHBOARD.md)',
  'check.dashboard.port': 'A porta {port} está ocupada por outro programa',
  'check.dashboard.port_fix': 'Feche o programa que usa a porta ou mude dashboard.port',
  'check.dashboard.insecure':
    '{url} não é localhost nem https: o login e o cookie passariam sem criptografia',
  'check.dashboard.insecure_fix':
    'Use https (proxy reverso, veja docs/DASHBOARD.md) ou deixe em http://localhost',
  'check.config.ok': 'Configuração válida (bots: {bots})',
  'check.config.fix': 'Corrija as linhas acima no legion.config.yaml',
  'check.perms': 'Permissões no servidor',
  'check.perms.ok': 'O cargo do bot tem as {count} permissões que {bots} precisa(m)',
  'check.perms.missing': 'Faltam no cargo do bot: {perms}',
  'check.perms.fix':
    'Abra de novo o link de convite deste app (legion invite-url) e autorize, ou dê as permissões ao cargo do bot em Configurações do servidor → Cargos',
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
  'check.env.legacy': 'Working, but with old names: {vars}',
  'check.env.legacy_fix':
    'In .env, rename DISCORD_TOKEN to CEREBRO_TOKEN and DISCORD_CLIENT_ID to CEREBRO_CLIENT_ID (same values) and restart',
  'check.env.fix':
    'Copy .env.example to .env and fill CEREBRO_TOKEN, CEREBRO_CLIENT_ID and DISCORD_GUILD_ID (or run "legion init")',
  'check.token': 'Bot token',
  'check.token.ok': 'Valid token (bot {name})',
  'check.token.fail': 'Discord rejected the token',
  'check.token.fix':
    'Developer Portal → your application → Bot → Reset Token, then paste the new token into .env',
  'check.app': 'Application ID',
  'check.app.ok': '{var} matches the token',
  'check.app.fail': '{var} ({given}) is not this application ID ({actual})',
  'check.apps': 'Discord applications',
  'init.apps': 'One Discord app for all bots, or one app per bot?',
  'init.apps.one': 'One app (simplest)',
  'init.apps.split': 'One app per bot (own name and avatar; one token per bot)',
  'init.bot_token': 'Token of the {bot} app (Developer Portal → Bot → Reset Token)',
  'init.bot_client': 'Application ID of the {bot} app',
  'check.apps.fail': 'Per-bot tokens are incomplete or repeated',
  'check.apps.fix':
    'Set <BOT>_TOKEN and <BOT>_CLIENT_ID together (e.g. JARVIS_TOKEN and JARVIS_CLIENT_ID), or neither',
  'check.app_suffix': ' — app {app} ({bots})',
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
  'check.dashboard': 'Staff dashboard',
  'check.dashboard.off': 'Off (dashboard.enabled: false)',
  'check.dashboard.ok': 'On at {url} (port {port}); secret set',
  'check.dashboard.no_secret':
    'dashboard.enabled is on but DASHBOARD_CLIENT_SECRET is not set; the dashboard will not open',
  'check.dashboard.no_secret_fix':
    "Developer Portal → Cérebro's app → OAuth2 → Reset Secret; put it in DASHBOARD_CLIENT_SECRET in .env (see docs/DASHBOARD.md)",
  'check.dashboard.port': 'Port {port} is taken by another program',
  'check.dashboard.port_fix': 'Close the program using the port or change dashboard.port',
  'check.dashboard.insecure':
    '{url} is neither localhost nor https: the login and the cookie would travel unencrypted',
  'check.dashboard.insecure_fix': 'Use https (reverse proxy, see docs/DASHBOARD.md) or keep http://localhost',
  'check.config.ok': 'Valid configuration (bots: {bots})',
  'check.config.fix': 'Fix the lines above in legion.config.yaml',
  'check.perms': 'Server permissions',
  'check.perms.ok': 'The bot role has the {count} permissions {bots} need(s)',
  'check.perms.missing': 'The bot role is missing: {perms}',
  'check.perms.fix':
    "Open this app's invite link again (legion invite-url) and authorize, or give the permissions to the bot role in Server Settings → Roles",
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
