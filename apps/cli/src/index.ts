#!/usr/bin/env node
import * as p from '@clack/prompts';
import { type BotId, ConfigError, createDb, type Locale, parseEnv, planApps } from '@legion/core';
import {
  AVAILABLE_BOTS,
  DEFAULT_CONFIG_PATH,
  describeBootError,
  loadConfigAndBots,
  loadDotEnv,
} from '@legion/runner';
import { Command } from 'commander';
import { CONTENT_TYPES, type ContentType, formatValidate, validateContent } from './content-validate.js';
import { doctorExitCode, formatDoctor, runDoctor } from './doctor.js';
import { isSnowflake, writeInitFiles } from './init.js';
import { inviteUrl } from './invite.js';
import { cliLocale, msg } from './messages.js';
import { formatPlaytest, parseSince, playtestReport } from './playtest.js';
import { registerCommands } from './register.js';
import { createDiscordRest } from './rest.js';

const program = new Command('legion').description('Legion: kit de bots de RPG para Discord').version('0.9.0');
const configOpt = ['-c, --config <path>', 'legion.config.yaml', DEFAULT_CONFIG_PATH] as const;

program
  .command('init')
  .description('Cria .env e legion.config.yaml com perguntas')
  .option('-o, --out <dir>', 'pasta onde escrever os arquivos', '.')
  .action(async (o: { out: string }) => {
    const L = cliLocale();
    p.intro(msg(L, 'init.intro'));
    const ask = async <T>(v: Promise<T | symbol>): Promise<Exclude<T, symbol>> => {
      const r = await v;
      if (p.isCancel(r)) process.exit(1);
      return r as Exclude<T, symbol>;
    };
    const id = (v: string | undefined) => (v && isSnowflake(v) ? undefined : msg(L, 'init.invalid_id'));
    const token = await ask(
      p.password({
        message: msg(L, 'init.token'),
        validate: (v) => (v ? undefined : msg(L, 'init.required')),
      }),
    );
    const clientId = await ask(p.text({ message: msg(L, 'init.client'), validate: id }));
    const guildId = await ask(p.text({ message: msg(L, 'init.guild'), validate: id }));
    const locale = await ask(
      p.select<Locale>({
        message: msg(L, 'init.locale'),
        options: [
          { value: 'pt-BR', label: 'Português (Brasil)' },
          { value: 'en', label: 'English' },
        ],
      }),
    );
    const bots = await ask(
      p.multiselect<BotId>({
        message: msg(L, 'init.bots'),
        options: AVAILABLE_BOTS.map((b) => ({ value: b, label: b })),
        initialValues: ['cerebro'],
        required: true,
      }),
    );
    const ownApps: Partial<Record<BotId, { token: string; clientId: string }>> = {};
    if (bots.length > 1) {
      const split = await ask(
        p.select<'one' | 'split'>({
          message: msg(L, 'init.apps'),
          options: [
            { value: 'one', label: msg(L, 'init.apps.one') },
            { value: 'split', label: msg(L, 'init.apps.split') },
          ],
        }),
      );
      if (split === 'split')
        for (const bot of bots.filter((b) => b !== 'cerebro')) {
          const botToken = await ask(
            p.password({
              message: msg(L, 'init.bot_token', { bot }),
              validate: (v) => (v ? undefined : msg(L, 'init.required')),
            }),
          );
          const botClient = await ask(p.text({ message: msg(L, 'init.bot_client', { bot }), validate: id }));
          ownApps[bot] = { token: botToken, clientId: botClient };
        }
    }
    const results = await writeInitFiles(
      o.out,
      { token, clientId, guildId, locale, bots, ownApps },
      async (file) => ask(p.confirm({ message: msg(L, 'init.overwrite', { file }), initialValue: false })),
    );
    for (const r of results) p.log.info(msg(L, r.written ? 'init.written' : 'init.kept', { file: r.file }));
    p.outro(msg(L, 'init.done'));
  });

program
  .command('doctor')
  .description('Confere token, intents, servidor, canais, banco e config')
  .option(...configOpt)
  .option('--json', 'saída em JSON')
  .action(async (o: { config: string; json?: boolean }) => {
    loadDotEnv();
    const configLocale = await loadConfigAndBots(o.config)
      .then((c) => c.config.locale)
      .catch(() => undefined);
    const L = cliLocale(configLocale);
    const results = await runDoctor({
      locale: L,
      envSource: process.env,
      configPath: o.config,
      rest: (t) => createDiscordRest(t),
    });
    console.log(
      o.json
        ? JSON.stringify({ ok: doctorExitCode(results) === 0, checks: results }, null, 2)
        : formatDoctor(results, L),
    );
    process.exitCode = doctorExitCode(results);
  });

program
  .command('register-commands')
  .description('Registra os comandos de barra no servidor agora')
  .option(...configOpt)
  .action(async (o: { config: string }) => {
    loadDotEnv();
    const L = cliLocale();
    const env = parseEnv(process.env, L);
    const apps = await registerCommands(env, o.config, (token) => createDiscordRest(token));
    for (const { app, names } of apps)
      console.log(
        `${apps.length > 1 ? `[${app}] ` : ''}${msg(L, 'commands.registered', { count: names.length, names: names.map((n) => `/${n}`).join(', ') })}`,
      );
  });

program
  .command('invite-url')
  .description('Mostra o link para convidar o bot com as permissões certas')
  .option(...configOpt)
  .action(async (o: { config: string }) => {
    loadDotEnv();
    const env = parseEnv(process.env, cliLocale());
    const { bots } = await loadConfigAndBots(o.config);
    const plan = planApps(
      env,
      bots.map((b) => b.id),
    );
    if (plan.errors.length) throw new ConfigError(plan.errors.map((e) => `.env → ${e}`));
    // One link per app, each with only its bots' permissions.
    for (const a of plan.apps) {
      const url = inviteUrl(
        a.clientId,
        bots.filter((b) => a.bots.includes(b.id)),
      );
      console.log(plan.apps.length > 1 ? `${a.bots.join(', ')}: ${url}` : url);
    }
  });

program
  .command('playtest-report')
  .description('Resumo de uma sessão de teste: missões, XP, limites, lutas e conteúdo, com conferência')
  .option(...configOpt)
  .option('-s, --since <quando>', 'início: 90m, 3h, 2d ou data/hora ISO', '6h')
  .option('--json', 'saída em JSON')
  .action(async (o: { config: string; since: string; json?: boolean }) => {
    loadDotEnv();
    const env = parseEnv(process.env, cliLocale());
    const { config, bots } = await loadConfigAndBots(o.config);
    const now = new Date();
    const since = parseSince(o.since, now);
    if (!since) throw new ConfigError([`--since: "${o.since}" não é 90m, 3h, 2d nem uma data ISO`]);
    const jarvis = (
      config as { jarvis?: { missions?: { limits?: { dailyPerMember: number; weeklyPerMember: number } } } }
    ).jarvis;
    // Read-only: no migrations, so it can run next to the live bot.
    const db = await createDb(env.DATABASE_URL);
    try {
      const report = await playtestReport(db, {
        guildId: env.DISCORD_GUILD_ID,
        since,
        now,
        bots: bots.map((b) => b.id),
        ...(jarvis?.missions?.limits ? { limits: jarvis.missions.limits } : {}),
      });
      console.log(o.json ? JSON.stringify(report, null, 2) : formatPlaytest(report));
      process.exitCode = report.problems.length ? 1 : 0;
    } catch (err) {
      const text = String((err as { cause?: unknown }).cause ?? err);
      if (/no such table|does not exist/i.test(text))
        throw new Error(
          'O banco ainda não tem as tabelas dos bots. Rode o comando dentro do container que já iniciou o bot\n' +
            '(docker compose exec legion legion playtest-report) ou confira o DATABASE_URL.',
        );
      throw err;
    } finally {
      await db.close();
    }
  });

const content = program
  .command('content')
  .description('Arquivos de conteúdo: trivia, missões, campanhas, inimigos, poderes');
content
  .command('validate')
  .description('Confere arquivos ou pastas de conteúdo com as mesmas regras dos bots (não usa o banco)')
  .argument('<caminhos...>', 'arquivos .yaml ou pastas')
  .option('-t, --type <tipo>', `força o tipo: ${CONTENT_TYPES.join(', ')}`)
  .option(
    '--categories <lista>',
    'categorias de trivia aceitas, separadas por vírgula (padrão: as do J.A.R.V.I.S.)',
  )
  .option('--json', 'saída em JSON')
  .action((paths: string[], o: { type?: string; categories?: string; json?: boolean }) => {
    if (o.type && !(CONTENT_TYPES as readonly string[]).includes(o.type)) {
      console.error(`--type: "${o.type}" não é um tipo; use ${CONTENT_TYPES.join(', ')}`);
      process.exitCode = 2;
      return;
    }
    const report = validateContent(paths, {
      ...(o.type ? { type: o.type as ContentType } : {}),
      ...(o.categories
        ? {
            categories: o.categories
              .split(',')
              .map((c) => c.trim())
              .filter(Boolean),
          }
        : {}),
    });
    console.log(o.json ? JSON.stringify(report, null, 2) : formatValidate(report));
    process.exitCode = report.exitCode;
  });

program.parseAsync().catch((err) => {
  console.error(describeBootError(err));
  process.exit(1);
});
