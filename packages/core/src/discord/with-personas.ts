import type { I18n } from '../i18n/i18n.js';
import type { DiscordGateway } from './gateway.js';
import { applyPersona } from './persona.js';
import type { OutgoingMessage } from './types.js';

/** Wraps a gateway so every outgoing message gets its persona styling and safe mentions. */
export function withPersonas(inner: DiscordGateway, i18n: I18n): DiscordGateway {
  const p = (m: OutgoingMessage) => applyPersona(m, i18n, i18n.defaultLocale);
  return {
    get botUserId() {
      return inner.botUserId;
    },
    sendMessage: (c, m) => inner.sendMessage(c, p(m)),
    editMessage: (c, id, m) => inner.editMessage(c, id, p(m)),
    sendDm: (u, m) => inner.sendDm(u, p(m)),
    createThread: (...a) => inner.createThread(...a),
    pinMessage: (...a) => inner.pinMessage(...a),
    reply: (i, m) => inner.reply(i, p(m)),
    deferReply: (...a) => inner.deferReply(...a),
    deferUpdate: (...a) => inner.deferUpdate(...a),
    editReply: (i, m) => inner.editReply(i, p(m)),
    followUp: (i, m) => inner.followUp(i, p(m)),
    updateMessage: (i, m) => inner.updateMessage(i, p(m)),
    showModal: (...a) => inner.showModal(...a),
    respondAutocomplete: (...a) => inner.respondAutocomplete(...a),
    fetchRoles: () => inner.fetchRoles(),
    createRole: (...a) => inner.createRole(...a),
    editRole: (...a) => inner.editRole(...a),
    fetchMember: (...a) => inner.fetchMember(...a),
    addMemberRole: (...a) => inner.addMemberRole(...a),
    removeMemberRole: (...a) => inner.removeMemberRole(...a),
    fetchChannels: () => inner.fetchChannels(),
    setChannelPermissionOverwrite: (...a) => inner.setChannelPermissionOverwrite(...a),
    timeoutMember: (...a) => inner.timeoutMember(...a),
    registerCommands: (...a) => inner.registerCommands(...a),
    fetchAttachment: (...a) => inner.fetchAttachment(...a),
    fetchCommandPermissions: () => inner.fetchCommandPermissions(),
  };
}
