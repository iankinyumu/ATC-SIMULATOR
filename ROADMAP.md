# Roadmap

This is a community roadmap, not a promise that each item is scheduled. We welcome issue discussions and pull requests that help move a milestone forward.

## Current foundation

* Deterministic ground simulation core, seeded traffic, event log, and replay foundations.
* EGLL surface-data import/build workflow and route finding.
* PixiJS surface display, command entry, strips, and local radio TTS.
* OpenAI Whisper-based push-to-talk transcription with transcript review.

## Near term: make the ground game dependable

* Improve first-run setup and make data requirements clear.
* Validate taxi routes, stand connectivity, aircraft fit limits, and ground movement against sources that may be used and attributed.
* Expand deterministic ground scenarios and replay diagnostics.
* Improve command-line and speech error handling, accessibility, and microphone controls.
* Replace the deprecated Whisper API model before its announced retirement on 26 February 2027.

## Communication upgrade

The target service roles are OpenAI speech transcription, GPT-6 Luna for grounded dialogue and intent interpretation, and ElevenLabs for varied pilot/controller voices. See [Radio and Pilot Communication Improvement Plan](RADIO_AND_PILOT_COMMUNICATION_IMPROVEMENT_PLAN.md).

* Add a larger, stable multi-voice roster for aircraft crews and controller positions.
* Expand pilot requests, reports, clarifications, readbacks, corrections, and context-aware follow-ups.
* Let the player use natural wording and multi-turn references, with clarification when intent is uncertain.
* Keep model output behind deterministic authority, route, and clearance validation.
* Measure voice quality, intelligibility, service cost, latency, and radio workload.

## Later simulation milestones

* Keep the simulation engine airport-agnostic and define a documented airport-pack format.
* Invite community contributions for additional airports after the EGLL foundation and data workflow are stable; each pack needs verified provenance and redistribution terms.
* Surface conflict/give-way behaviour and runway operations.
* Tower, airborne movement, and radar display built on validated scenario data and rules.
* Handoffs and bot controller behaviour across a shared world.
* Weather, abnormal events, frequency congestion, and workload evaluation.

## Help wanted

Open issues for sourced data reviews, simulation scenarios, usability/accessibility, phraseology research, documentation, and onboarding are valuable even if you are not ready to write code. If a roadmap item interests you, open an issue to coordinate scope.
