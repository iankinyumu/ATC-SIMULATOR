# EGLL ATC Simulation

An open-source air traffic control simulation project focused on London Heathrow (EGLL). The goal is to grow a detailed, replayable airport operations sim with realistic ground movement, controller workload, pilot radio calls, and eventually connected tower and radar positions.

**Early-stage project:** the playable prototype currently focuses on ground operations. Many procedures, aircraft behaviours, data sources, and voice features are incomplete or marked as placeholders. This is a community-built simulation project, not an operational ATC tool or certified training product.

## What works today

* A deterministic TypeScript simulation core with seeded traffic, event logging, and replay foundations.
* EGLL ground map and taxi route finding from generated local airport data.
* Ground aircraft movement, stand occupancy/fit checks, clearances, pilot requests, and controller command checks.
* A PixiJS display with flight strips, radio log, map inspection, route preview, and command line.
* Local pilot radio text-to-speech using Piper or Kokoro after downloading voice assets.
* Push-to-talk speech transcription through OpenAI Whisper (`whisper-1`); the transcript is reviewed in the command line before it is sent.
* Typed instructions as an accessible and development fallback.

See [the master specification](EGLL_ATC_Simulation_V1_Master_Spec.md) for the broader simulation goals and known gaps. The [radio and pilot communication plan](RADIO_AND_PILOT_COMMUNICATION_IMPROVEMENT_PLAN.md) describes the planned Whisper, GPT-4o mini, and ElevenLabs conversation stack; GPT-4o mini dialogue and ElevenLabs voice output are not integrated yet.

## Run it locally

Requirements: Node.js LTS and npm. From the repository root:

```powershell
npm install
npm run data:fetch
npm run data:build
npm run voices:fetch
npm run display
```

Open `http://localhost:5173`. Data fetching needs an internet connection. It downloads source material into ignored folders and builds the local EGLL dataset. Voice fetching downloads third-party model files; those assets are not committed.

To enable microphone transcription, set `OPENAI_API_KEY` in a root `.env` file (copy `.env.example`) or in the environment, then restart the display server. The current `whisper-1` model is scheduled for removal by OpenAI on February 26, 2027; see the communication plan for the migration requirement. Audio is sent to OpenAI when transcribed. Never commit API keys or raw audio.

Useful commands:

```powershell
npm run display       # start the display
npm run demo          # print a scripted simulation session
npm test              # run the test suite
npm run typecheck     # check TypeScript packages
npm run data:fetch    # download source airport data
npm run data:build    # build the local EGLL dataset
```

## Help build it

There are useful ways to contribute before the project is feature-complete:

* improve simulation rules and deterministic scenario coverage;
* review ground movement, clearances, phraseology, and pilot communications against appropriate sources;
* improve the map, strips, accessibility, onboarding, and visual/audio controls;
* check data provenance and help document what may be redistributed;
* develop the planned conversational pilot and voice architecture;
* improve setup documentation and help test the project on different systems.

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), check the [roadmap](ROADMAP.md) and [governance](GOVERNANCE.md), and browse open issues for work in progress. For large changes, open an issue or discussion first so the design can be agreed before implementation.

## Project boundaries and data

This project uses real-world airport names and may use data from external sources. A source being publicly accessible does not automatically grant permission to redistribute its data. Downloaded and generated EGLL datasets are excluded from Git; review source terms before committing any data, chart, voice, or model file. See [`DATA_AND_ATTRIBUTIONS.md`](DATA_AND_ATTRIBUTIONS.md).

The source code and project documentation are released under the MIT License. Third-party assets and datasets remain under their own terms; the MIT License does not relicense them.

## License

MIT for the code and project-authored documentation. See [`LICENSE`](LICENSE) and the data/source notes above.
