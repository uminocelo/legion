ALTER TABLE `members` ADD `pending_origin` text;--> statement-breakpoint
ALTER TABLE `mutants` ADD `origin_type` text DEFAULT 'mutante' NOT NULL;--> statement-breakpoint
ALTER TABLE `mutants` ADD `origin_rechoice` integer DEFAULT 0 NOT NULL;--> statement-breakpoint
-- Heroes created before origins existed may change origin once (/heroi origem).
UPDATE `mutants` SET `origin_rechoice` = 1;--> statement-breakpoint
-- The faction step is gone: members mid-registration choose an origin next (their faction is kept).
UPDATE `members` SET `onboarding_step` = 'rules_accepted' WHERE `onboarding_step` = 'faction_chosen';
