# Changelog

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
