import type { DiscordGateway } from './gateway.js';
import type { Modal, OutgoingMessage } from './types.js';

/** Interaction response helper that tracks state, so callers can always "send" the right way. */
export class Responder {
  replied = false;
  deferred = false;

  constructor(
    private readonly gateway: DiscordGateway,
    readonly interactionId: string,
  ) {}

  get pending(): boolean {
    return !this.replied && !this.deferred;
  }

  async reply(msg: OutgoingMessage): Promise<void> {
    await this.gateway.reply(this.interactionId, msg);
    this.replied = true;
  }
  /** Acknowledge now (3-second rule), answer later with `send`/`editReply`. */
  async defer(ephemeral = true): Promise<void> {
    if (!this.pending) return;
    await this.gateway.deferReply(this.interactionId, ephemeral);
    this.deferred = true;
  }
  /** Component interactions: acknowledge and later update the message it belongs to. */
  async deferUpdate(): Promise<void> {
    if (!this.pending) return;
    await this.gateway.deferUpdate(this.interactionId);
    this.deferred = true;
  }
  async update(msg: OutgoingMessage): Promise<void> {
    if (this.deferred) await this.gateway.editReply(this.interactionId, msg);
    else await this.gateway.updateMessage(this.interactionId, msg);
    this.replied = true;
  }
  async editReply(msg: OutgoingMessage): Promise<void> {
    await this.gateway.editReply(this.interactionId, msg);
    this.replied = true;
  }
  async followUp(msg: OutgoingMessage): Promise<void> {
    await this.gateway.followUp(this.interactionId, msg);
  }
  async showModal(modal: Modal): Promise<void> {
    await this.gateway.showModal(this.interactionId, modal);
    this.replied = true;
  }
  async autocomplete(choices: { name: string; value: string }[]): Promise<void> {
    await this.gateway.respondAutocomplete(this.interactionId, choices.slice(0, 25));
    this.replied = true;
  }
  /** Replies, edits the deferred reply, or follows up — whichever is valid now. */
  async send(msg: OutgoingMessage): Promise<void> {
    if (this.deferred && !this.replied) await this.editReply(msg);
    else if (this.replied) await this.followUp(msg);
    else await this.reply(msg);
  }
}
