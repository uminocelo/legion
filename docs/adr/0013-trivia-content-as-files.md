# 0013. Trivia questions live in YAML files, synced by id

**Status:** Accepted

## Context
Questions must be reviewed (each one has a source), versioned with the code, and extensible by server owners without a database tool.

## Decision
Bundled questions in `packages/bot-jarvis/content/trivia/<locale>.yaml`, server packs in `./data/content/trivia/*.yaml`, validated with zod. On boot and on `/jarvis trivia recarregar` they are upserted by `id` with a content hash. Questions missing from the files become inactive, never deleted, so old attempts keep their question. If any file has errors nothing is deactivated.

## Consequences
- Fixing a question is a pull request; a typo cannot silently empty the pool.
- Ids must be stable; renaming an id creates a new question.

## Alternatives considered
- Staff-edited questions in Discord: needs moderation UI and loses review. Deleting removed rows: breaks history.
