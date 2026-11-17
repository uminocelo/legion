import { describe, expect, it } from 'vitest';
import {
  guildPermissionsOf,
  missingGuildPermissions,
  permissionNames,
  topRolePosition,
} from './discord/guild-permissions.js';

describe('guild permissions', () => {
  const roles = [
    { id: 'g', name: '@everyone', color: 0, position: 0, managed: false, permissions: ['ViewChannel'] },
    { id: 'b', name: 'Bot', color: 0, position: 10, managed: true, permissions: ['SendMessages'] },
    { id: 'a', name: 'Admin', color: 0, position: 5, managed: false, permissions: ['Administrator'] },
  ];
  it('unions @everyone and roles, honours Administrator, and is unknown without permission data', () => {
    expect([...(guildPermissionsOf('g', { roleIds: ['b'] }, roles) ?? [])].sort()).toEqual([
      'SendMessages',
      'ViewChannel',
    ]);
    expect(
      missingGuildPermissions('g', { roleIds: ['b'] }, roles, ['ViewChannel', 'ModerateMembers']),
    ).toEqual(['ModerateMembers']);
    expect(missingGuildPermissions('g', { roleIds: ['a'] }, roles, ['ModerateMembers'])).toEqual([]);
    expect(missingGuildPermissions('g', { roleIds: ['x'] }, roles, ['ModerateMembers'])).toBeNull();
    expect(topRolePosition({ roleIds: ['a', 'b'] }, roles)).toBe(10);
    expect(permissionNames([1n << 40n, 1n << 11n])).toEqual(['SendMessages', 'ModerateMembers']);
  });
});
