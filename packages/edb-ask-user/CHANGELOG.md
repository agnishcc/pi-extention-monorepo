# Changelog

## [Unreleased]

## [0.10.4] - 2026-05-15

## [0.10.3] - 2026-05-15

## [0.8.2] - 2026-05-11

## [0.8.1] - 2026-05-11

## [0.6.0] - 2026-05-11

### Changed
- Migrated all imports and peerDependencies from `@mariozechner/pi-*` to `@earendil-works/pi-*` namespace

## [0.5.1] - 2026-05-05

## [0.5.0] - 2026-05-05

## [0.2.0] - 2026-04-29

### Changed
- Replaced question-level `allowOther` with option-level `isOther` boolean on `QuestionOption`
- Free-text input is always guaranteed for choice questions: if no option is marked `isOther: true`, a default "Type something." option is auto-appended; if an option is marked `isOther: true`, it replaces the default (eliminating redundant options)
- Updated prompt guidelines to document the `isOther` field

### Added
- Initial release: `ask_user` tool with text and choice question types
- Single-question focused UI and multi-question tabbed wizard
- `isOther` / inline editor for choice questions
- Submit review tab showing all answers before submission
