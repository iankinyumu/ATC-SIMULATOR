# Contributing

Thanks for helping build the EGLL ATC Simulation. Contributions can improve simulation behaviour, data quality, usability, documentation, or the planned speech and radio experience.

## Start with an issue

For a bug, include what you did, what you expected, what happened, and enough steps to reproduce it. For a feature or a large refactor, open an issue or discussion first. This project is early and its simulation rules and data boundaries are still being worked out; a short design conversation can prevent wasted effort.

Good first contributions include documentation fixes, reproducible bug reports, accessibility improvements, small UI refinements, test scenarios for existing rules, and clearly sourced data-quality notes.

## Local setup

1. Install Node.js LTS and npm.
2. Run `npm install`.
3. For the full EGLL display, run `npm run data:fetch` and `npm run data:build`.
4. Run `npm run typecheck` and `npm test` before opening a pull request.
5. Start the display with `npm run display`.

Microphone transcription needs `OPENAI_API_KEY` in a local `.env` file. Copy `.env.example`; never put a real key in a commit, issue, screenshot, or pull request. Voice assets and generated airport data are local downloads and must stay out of commits unless their redistribution terms have been verified.

## Pull requests

* Keep a pull request focused and explain the problem it solves.
* Include steps to reproduce or verify user-visible changes; include tests for simulation rules where appropriate.
* Update documentation when setup, behaviour, data provenance, or user flows change.
* Keep the deterministic simulation core independent of browser/UI code and external model calls.
* Never allow generated dialogue to change simulation state without validation by the simulation rules.
* Do not add operational data, charts, model files, or audio unless the source and redistribution rights are documented.
* Be kind in reviews and follow the [Code of Conduct](CODE_OF_CONDUCT.md).

## Style and project structure

The project uses strict TypeScript, npm workspaces, and Vitest. Follow the existing formatting and naming patterns. Keep simulation rules in `packages/sim-core`, airport import/build work in `packages/egll-data`, and display/server code in `packages/display`.

Phraseology, aircraft behaviour, route rules, and operational data need source notes and careful review. Mark assumptions and placeholders instead of presenting uncertain details as established facts.

## License

By submitting a contribution, you agree that it may be distributed under this repository's MIT License. Third-party data and assets remain subject to their own licenses and terms.
