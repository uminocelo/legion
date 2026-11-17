# 0019. Member language preference via a core LocaleResolver

**Status:** Accepted

## Context
Some members prefer English. Every bot's private replies should follow that choice without each bot storing its own preference.

## Decision
`/idioma` stores the member's locale in `herbie_preferences`. H.E.R.B.I.E. provides `localeResolver` to core i18n; `i18n.localeFor(discordUserId)` (used for ephemeral replies by every bot) asks it and falls back to `config.locale`. Public messages always use `config.locale`.

## Consequences
- One place for the preference; bots only call `localeFor`.
- Without H.E.R.B.I.E. everyone gets the server language.

## Alternatives considered
- Discord's client locale (`interaction.locale`): automatic but not a choice, and unavailable for DMs and scheduled messages.
