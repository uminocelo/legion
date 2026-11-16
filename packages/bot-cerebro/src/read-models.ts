import type { MembersReadModel, MutantsReadModel } from '@legion/core';
import { type CerebroRepo, toMemberView, toMutantView } from './db/repo.js';

/** Read models other bots use (`ctx.read.members` / `ctx.read.mutants`). */
export function membersReadModel(repo: CerebroRepo): MembersReadModel {
  return {
    getById: async (id) => {
      const row = await repo.memberById(id);
      return row ? toMemberView(row) : null;
    },
    getByDiscordId: async (id) => {
      const row = await repo.memberByDiscordId(id);
      return row ? toMemberView(row) : null;
    },
    listRegistered: async (opts) => (await repo.listRegistered(opts ?? {})).map(toMemberView),
  };
}

export function mutantsReadModel(repo: CerebroRepo): MutantsReadModel {
  return {
    getByMemberId: async (memberId) => {
      const row = await repo.mutantByMemberId(memberId);
      return row ? toMutantView(row) : null;
    },
  };
}
