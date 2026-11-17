import type { BotContext, DoctorCheck } from '../bot.js';
import { STAFF_ROLE_KEYS } from '../runtime.js';
import type { CommandPermissionOverwrite } from './types.js';

/** Allowed by a command overwrite for the role, else by an app-wide one. */
export function roleCanUse(
  perms: Record<string, CommandPermissionOverwrite[]>,
  command: string,
  roleId: string,
): boolean {
  const own = perms[command]?.find((p) => p.type === 'role' && p.id === roleId);
  if (own) return own.allow;
  return perms['*']?.find((p) => p.type === 'role' && p.id === roleId)?.allow ?? false;
}

/**
 * Staff-only commands are registered as "Administrators only". Staff roles without Administrator
 * only see them when allowed in Server Settings → Integrations; a bot cannot grant that itself.
 */
export function staffCommandsCheck(ctx: BotContext<unknown>, commands: string[]): DoctorCheck {
  return {
    id: `${ctx.id}.staff-commands`,
    title: `Comandos da staff visíveis (${commands.map((c) => `/${c}`).join(', ')})`,
    run: async () => {
      const ids = await ctx.roles.idsFor(STAFF_ROLE_KEYS);
      if (!ids.size)
        return { status: 'ok', message: 'Nenhum cargo de staff no servidor: só o dono usa esses comandos' };
      const roles = (await ctx.gateway.fetchRoles()).filter((r) => [...ids.values()].includes(r.id));
      const needing = roles.filter((r) => !r.permissions?.includes('Administrator'));
      if (!needing.length) return { status: 'ok', message: 'Os cargos de staff têm Administrador' };
      let perms: Record<string, CommandPermissionOverwrite[]>;
      try {
        perms = await ctx.gateway.fetchCommandPermissions();
      } catch (err) {
        return {
          status: 'warn',
          message: `Não consegui ler as permissões dos comandos: ${(err as Error).message}`,
        };
      }
      const blocked = needing.flatMap((role) =>
        commands.filter((c) => !roleCanUse(perms, c, role.id)).map((c) => `${role.name} → /${c}`),
      );
      if (!blocked.length)
        return { status: 'ok', message: 'Os cargos de staff podem usar os comandos da staff' };
      return {
        status: 'warn',
        message: `Cargos de staff sem Administrador não veem: ${blocked.join(', ')}`,
        fix: 'Configurações do servidor → Integrações → o bot → em cada comando, permita os cargos de staff (veja docs/STAFF.md)',
      };
    },
  };
}
