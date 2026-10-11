# Airport ATC Simulation

An open-source air traffic control simulation built to support multiple airports through community-contributed airport data and scenarios. London Heathrow (EGLL) is the first airport and current development focus. The goal is a detailed, replayable operations sim with realistic ground movement, controller workload, pilot radio calls, and eventually connected tower and radar positions.

**Early-stage project:** the playable prototype currently focuses on ground operations. Many procedures, aircraft behaviours, data sources, and voice features are incomplete or marked as placeholders. This is a community-built simulation project, not an operational ATC tool or certified training product.

## What works today

* A deterministic TypeScript simulation core with seeded traffic, event logging, and replay foundations.
* EGLL ground map and taxi route finding from generated local airport data.
* Ground aircraft movement, stand occupancy/fit checks, clearances, pilot requests, and controller command checks.
* A PixiJS display with flight strips, radio log, map inspection, route preview, and command line.
* Server-side radio speech using ElevenLabs with distinct pilot/controller voices when configured; Piper or Kokoro remain available as local providers.
* Push-to-talk transcription through OpenAI Whisper (`whisper-1`), followed by a GPT-6 Luna command suggestion. The suggestion is parsed, shown for review, and never sent automatically.
* Typed instructions as an accessible and development fallback.

See [the master specification](EGLL_ATC_Simulation_V1_Master_Spec.md) for the first airport's goals and known gaps. The [roadmap](ROADMAP.md) tracks shared airport architecture and future airport contributions. The [radio and pilot communication plan](RADIO_AND_PILOT_COMMUNICATION_IMPROVEMENT_PLAN.md) describes the target dialogue system. GPT-6 Luna currently turns speech transcripts into reviewable command suggestions; pilot dialogue generation remains deterministic.

## Run it locally

Requirements: Node.js LTS and npm. From the repository root:

```powershell
npm install
npm run data:fetch
npm run data:build
npm run display
```

Open `http://localhost:5173`. Data fetching needs an internet connection. It downloads source material into ignored folders and builds the local EGLL dataset.

Copy `.env.example` to `.env`, add your OpenAI and ElevenLabs keys, and restart the display server. OpenAI receives recorded microphone audio for Whisper transcription and the transcript plus airport command context for GPT-6 Luna interpretation. The result stays in the command line for review and deterministic validation. ElevenLabs receives radio text for synthesis; the server loads up to ten English premade voices from your account and assigns stable voices to pilots and the controller. No keys are sent to the browser.

The current `whisper-1` model is scheduled for removal by OpenAI on February 26, 2027; see the communication plan for the migration requirement. If you prefer local speech output, set `VOICE_PROVIDER=local` and run `npm run voices:fetch` to download Piper/Kokoro assets. The app uses local voices when no ElevenLabs key is configured. API usage can incur provider charges; check your account limits.

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
* check airport data provenance and help build additional airport packs where redistribution rights allow;
* develop the planned conversational pilot and voice architecture;
* improve setup documentation and help test the project on different systems.

Start with [`CONTRIBUTING.md`](CONTRIBUTING.md), check the [roadmap](ROADMAP.md) and [governance](GOVERNANCE.md), and browse open issues for work in progress. For large changes, open an issue or discussion first so the design can be agreed before implementation.

## Project boundaries and data

This project uses real-world airport names and may use data from external sources. A source being publicly accessible does not automatically grant permission to redistribute its data. Downloaded and generated EGLL datasets are excluded from Git; review source terms before committing any data, chart, voice, or model file. See [`DATA_AND_ATTRIBUTIONS.md`](DATA_AND_ATTRIBUTIONS.md).

The source code and project documentation are released under the MIT License. Third-party assets and datasets remain under their own terms; the MIT License does not relicense them.

## License

MIT for the code and project-authored documentation. See [`LICENSE`](LICENSE) and the data/source notes above.
