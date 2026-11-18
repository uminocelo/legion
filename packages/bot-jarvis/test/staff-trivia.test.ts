import type { Modal, TestContext } from '@legion/core';
import { afterEach, describe, expect, it } from 'vitest';
import { parse as parseYaml } from 'yaml';
import { questionSchema, staffTriviaIds } from '../src/index.js';
import { addMember, servicesOf, setupJarvis } from './helpers.js';

let t: TestContext | undefined;
afterEach(async () => {
  await t?.close();
  t = undefined;
});

const STAFF = '900';
const STAFF2 = '901';
const QUEUE = '300000000000000030';
const fields = (over: Record<string, string> = {}) => ({
  question: 'Em qual edição Shang-Chi enfrenta a Sociedade das Cinco Armas?',
  choices: 'Shang-Chi #1\nShang-Chi #4\nShang-Chi #9',
  answer: '2',
  explanation: 'O confronto acontece na quarta edição.',
  source: 'Shang-Chi #4 (2021)',
  ...over,
});

async function setup(config: Record<string, unknown> = {}) {
  t = await setupJarvis({ channels: { modQueue: QUEUE }, ...config });
  return { t, s: servicesOf(t) };
}
const staffCmd = (
  tc: TestContext,
  subcommand: string,
  options: Record<string, string | number> = {},
  userId = STAFF,
) => tc.interact({ kind: 'command', userId, isGuildOwner: true, commandName: 'jarvis', subcommand, options });
const submitNew = (tc: TestContext, f = fields(), userId = STAFF, category = 'quadrinhos') =>
  tc.interact({
    kind: 'modal',
    userId,
    isGuildOwner: true,
    customId: staffTriviaIds.create(category, 'normal', 'pt-BR'),
    fields: f,
  });
const reply = (tc: TestContext, id: string) => tc.gateway.lastReply(id);
const staffRows = async (tc: TestContext) =>
  (await servicesOf(tc).repo.allQuestions()).filter((q) => q.origin === 'staff');

describe('staff trivia from Discord', () => {
  it('opens a form, saves a valid question and puts it in play at once (no review)', async () => {
    const { t, s } = await setup();
    await staffCmd(t, 'trivia nova', { categoria: 'quadrinhos', dificuldade: 'normal' });
    const [[, modal]] = t.gateway.callsOf('showModal') as [string, Modal][];
    expect(modal?.inputs.map((x) => x.customId)).toEqual([
      'question',
      'choices',
      'answer',
      'explanation',
      'source',
    ]);
    const id = await submitNew(t);
    expect(reply(t, id)?.content).toMatch(/criada e já está em jogo/);
    const [q] = await staffRows(t);
    expect(q).toMatchObject({
      active: 1,
      review: 'approved',
      createdBy: STAFF,
      answerIndex: 1,
      source: 'Shang-Chi #4 (2021)',
    });
    expect((await s.repo.activeQuestions('pt-BR', 'quadrinhos')).map((x) => x.id)).toContain(q?.id);
    const edits = await t.db.orm.select().from(s.repo.t.jarvisTriviaEdits);
    expect(edits.map((e) => e.action)).toEqual(['create']);
  });

  it('refuses invalid forms with readable errors and non-staff users', async () => {
    const { t } = await setup();
    const bad = await submitNew(t, fields({ answer: '5', choices: 'A\nA' }));
    expect(reply(t, bad)?.content).toMatch(/não foi salva/);
    expect(reply(t, bad)?.content).toMatch(/choices: as alternativas precisam ser diferentes/);
    expect(await staffRows(t)).toEqual([]);
    await addMember(t, '111');
    const no = await t.interact({
      kind: 'modal',
      userId: '111',
      customId: staffTriviaIds.create('quadrinhos', 'normal', 'pt-BR'),
      fields: fields(),
    });
    expect(reply(t, no)?.content).toMatch(/Apenas a staff/);
    const cmd = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'jarvis',
      subcommand: 'trivia lista',
    });
    expect(reply(t, cmd)?.content).toMatch(/Apenas a staff/);
  });

  it('with review on, a second staff member approves; the author cannot', async () => {
    const { t, s } = await setup({ jarvis: { trivia: { review: 'second_staff' } } });
    const id = await submitNew(t);
    expect(reply(t, id)?.content).toMatch(/enviada para revisão em <#300000000000000030>/);
    const [q] = await staffRows(t);
    expect(q).toMatchObject({ active: 0, review: 'pending' });
    const post = t.gateway.messages.find((m) => m.channelId === QUEUE);
    expect(post?.msg.embeds?.[0]?.description).toMatch(/✅ Shang-Chi #4/);
    const approve = staffTriviaIds.review(q?.id ?? '', 'approve');
    const own = await t.interact({ kind: 'component', userId: STAFF, isGuildOwner: true, customId: approve });
    expect(reply(t, own)?.content).toMatch(/não pode aprová-la/);
    const ok = await t.interact({ kind: 'component', userId: STAFF2, isGuildOwner: true, customId: approve });
    expect(reply(t, ok)?.embeds?.[0]?.description).toMatch(/Aprovada por <@901>/);
    expect(await s.repo.question(q?.id ?? '')).toMatchObject({
      active: 1,
      review: 'approved',
      reviewedBy: STAFF2,
    });
    const twice = await t.interact({
      kind: 'component',
      userId: STAFF2,
      isGuildOwner: true,
      customId: approve,
    });
    expect(reply(t, twice)?.content).toMatch(/já foi revisada/);

    await submitNew(t, fields({ question: 'Outra pergunta sobre a mesma edição?' }));
    const second = (await staffRows(t)).find((x) => x.review === 'pending');
    await t.interact({
      kind: 'component',
      userId: STAFF2,
      isGuildOwner: true,
      customId: staffTriviaIds.review(second?.id ?? '', 'reject'),
    });
    expect(await s.repo.question(second?.id ?? '')).toMatchObject({ active: 0, review: 'rejected' });
  });

  it('edits keep history; file questions are edited as files', async () => {
    const { t, s } = await setup();
    await submitNew(t);
    const [q] = await staffRows(t);
    await staffCmd(t, 'trivia editar', { pergunta: q?.id ?? '' });
    const [[, modal]] = t.gateway.callsOf('showModal').slice(-1) as [string, Modal][];
    expect(modal?.inputs.find((x) => x.customId === 'choices')?.value).toBe(
      'Shang-Chi #1\nShang-Chi #4\nShang-Chi #9',
    );
    await t.interact({
      kind: 'modal',
      userId: STAFF2,
      isGuildOwner: true,
      customId: staffTriviaIds.edit(q?.id ?? ''),
      fields: fields({ answer: '3' }),
    });
    expect((await s.repo.question(q?.id ?? ''))?.answerIndex).toBe(2);
    const edits = await t.db.orm.select().from(s.repo.t.jarvisTriviaEdits);
    const edit = edits.find((e) => e.action === 'edit');
    expect(edit?.staffId).toBe(STAFF2);
    expect(JSON.parse(edit?.before ?? '{}').answerIndex).toBe(1);
    const fileQ = (await s.repo.allQuestions()).find((x) => x.origin === 'file');
    const refused = await staffCmd(t, 'trivia editar', { pergunta: fileQ?.id ?? '' });
    expect(reply(t, refused)?.content).toMatch(/vem de um arquivo de conteúdo/);
  });

  it('disabled questions leave the pool at once and stay out after a file reload', async () => {
    const { t, s } = await setup();
    const fileQ = (await s.repo.activeQuestions('pt-BR', null))[0];
    await staffCmd(t, 'trivia desativar', { pergunta: fileQ?.id ?? '' });
    expect((await s.repo.activeQuestions('pt-BR', null)).map((x) => x.id)).not.toContain(fileQ?.id);
    await s.trivia.reload();
    expect(await s.repo.question(fileQ?.id ?? '')).toMatchObject({ active: 0, review: 'disabled' });
    await staffCmd(t, 'trivia ativar', { pergunta: fileQ?.id ?? '' });
    expect(await s.repo.question(fileQ?.id ?? '')).toMatchObject({ active: 1, review: null });
  });

  it('file reloads never touch staff questions', async () => {
    const { t, s } = await setup();
    await submitNew(t);
    const res = await s.trivia.reload();
    expect(res.deactivated).toBe(0);
    expect((await staffRows(t))[0]?.active).toBe(1);
  });

  it('lists with filters and exports a YAML file in the content format', async () => {
    const { t } = await setup({ jarvis: { trivia: { review: 'second_staff' } } });
    await submitNew(t);
    const list = await staffCmd(t, 'trivia lista', { status: 'pendente' });
    const embed = reply(t, list)?.embeds?.[0];
    expect(embed?.title).toBe('Perguntas de trivia (1)');
    expect(embed?.description).toMatch(/pendente · quadrinhos · normal · <@900>/);
    const none = await staffCmd(t, 'trivia lista', { autor: STAFF2 });
    expect(reply(t, none)?.embeds?.[0]?.title).toBe('Perguntas de trivia (0)');

    const [q] = await staffRows(t);
    await t.interact({
      kind: 'component',
      userId: STAFF2,
      isGuildOwner: true,
      customId: staffTriviaIds.review(q?.id ?? '', 'approve'),
    });
    const ex = await staffCmd(t, 'trivia exportar');
    const file = reply(t, ex)?.files?.[0];
    expect(file?.name).toBe('trivia-staff.yaml');
    const items = parseYaml(String(file?.content)) as unknown[];
    expect(items).toHaveLength(1);
    expect(questionSchema.safeParse(items[0]).success).toBe(true);
  });

  it('accepts categories added in the config, and shows a text source in the footer', async () => {
    const { t } = await setup({
      jarvis: { trivia: { categories: ['quadrinhos', 'rivals', 'geral', 'marvel'] } },
    });
    const id = await submitNew(t, fields(), STAFF, 'marvel');
    expect(reply(t, id)?.content).toMatch(/criada/);
    const [q] = await staffRows(t);
    expect(q?.category).toBe('marvel');
    const bad = await staffCmd(t, 'trivia nova', { categoria: 'nope', dificuldade: 'normal' });
    expect(reply(t, bad)?.content).toMatch(/não está em jarvis.trivia.categories/);

    await addMember(t, '111');
    const ask = await t.interact({
      kind: 'command',
      userId: '111',
      commandName: 'trivia',
      options: { categoria: 'marvel' },
    });
    expect(reply(t, ask)?.embeds?.[0]?.title).toMatch(/marvel/);
    const btn = reply(t, ask)?.components?.[0]?.[0];
    const answered = await t.interact({
      kind: 'component',
      userId: '111',
      customId: btn && 'customId' in btn ? (btn.customId ?? '') : '',
    });
    const msg = reply(t, answered);
    expect(msg?.embeds?.[0]?.footer?.text).toBe('Fonte: Shang-Chi #4 (2021)');
    expect(msg?.components?.[1]?.some((b) => 'url' in b && b.url)).toBe(false);
  });
});
