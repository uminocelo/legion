import type { BotContext } from '@legion/core';
import { JarvisCampaigns } from './campaigns.js';
import type { JarvisConfig } from './config.js';
import { JarvisRepo } from './db/repo.js';
import { JarvisInventory } from './inventory-ui.js';
import { InventoryService, ItemCatalog } from './items.js';
import { JarvisLeaderboard } from './leaderboard.js';
import { MissionImports } from './mission-imports.js';
import { JarvisMissions } from './missions.js';
import { StaffTrivia } from './staff-trivia.js';
import { JarvisTrivia } from './trivia.js';
import { TriviaImports } from './trivia-imports.js';
import { WalletService } from './wallet.js';
import { JarvisWalletUi } from './wallet-ui.js';
import { XpService } from './xp-service.js';

export interface JarvisServices {
  repo: JarvisRepo;
  xp: XpService;
  trivia: JarvisTrivia;
  board: JarvisLeaderboard;
  missions: JarvisMissions;
  staffTrivia: StaffTrivia;
  imports: MissionImports;
  triviaImports: TriviaImports;
  campaigns: JarvisCampaigns;
  items: ItemCatalog;
  inventory: InventoryService;
  inventoryUi: JarvisInventory;
  wallet: WalletService;
  walletUi: JarvisWalletUi;
}

const cache = new WeakMap<object, JarvisServices>();

/** One set of services per bot context. */
export function jarvisServices(ctx: BotContext<JarvisConfig>): JarvisServices {
  let s = cache.get(ctx);
  if (!s) {
    const repo = new JarvisRepo(ctx.db, ctx.guildId, ctx.clock, ctx.newId);
    const partial = {
      repo,
      xp: new XpService(ctx, repo),
      wallet: new WalletService(ctx, repo),
    } as JarvisServices;
    partial.trivia = new JarvisTrivia(ctx, partial);
    partial.board = new JarvisLeaderboard(ctx, partial, partial.trivia.ui);
    partial.missions = new JarvisMissions(ctx, partial);
    partial.staffTrivia = new StaffTrivia(ctx, partial);
    partial.imports = new MissionImports(ctx, partial);
    partial.triviaImports = new TriviaImports(ctx, partial);
    partial.campaigns = new JarvisCampaigns(ctx, partial);
    partial.items = new ItemCatalog(repo);
    partial.inventory = new InventoryService(ctx, repo, partial.items);
    partial.inventoryUi = new JarvisInventory(ctx, partial);
    partial.walletUi = new JarvisWalletUi(ctx, partial);
    s = partial;
    cache.set(ctx, s);
  }
  return s;
}
