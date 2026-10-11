# Radio, Pilot Dialogue, and Voice Realism Improvement Plan

**Status:** Product/design proposal  
**Scope:** Speech, radio dialogue, pilot behaviour, and generated voices  
**Implementation:** No code changes are included in this document.

**Chosen speech stack:** OpenAI Whisper (`whisper-1`, with a required migration before its announced retirement) for player speech input/transcription; GPT-6 Luna (`gpt-6-luna`) for interpreting player intent and generating context-aware conversation; ElevenLabs for spoken audio output. These services have separate roles: Whisper recognizes speech, GPT-6 Luna handles the conversation, and ElevenLabs voices the resulting text. GPT-6 Luna is available in the project owner's API account; API access and billing still depend on the account's limits and credits.

Provider references: [Whisper transcription](https://platform.openai.com/docs/api-reference/audio/json-object), [GPT-6 Luna](https://developers.openai.com/api/docs/models/gpt-6-luna), and [ElevenLabs text to speech](https://elevenlabs.io/docs/overview/capabilities/text-to-speech).

## 1. Goal

Make the radio feel like an active conversation between a controller and many distinct crews. The player should be able to speak naturally, ask follow-up questions, issue instructions in more than one valid form, and hear pilots make varied, context-appropriate calls. Correctness should come from the live simulation state and applicable procedures, while wording and voice can vary naturally.

The experience should support an open-ended game: pilots can ask, report, clarify, acknowledge, correct, and respond to changing situations instead of only emitting the small set of prewritten requests currently represented in code. The system should not require one exact sentence to make a valid interaction.

“Open-ended” does not mean radio text can invent clearances, taxi routes, aircraft positions, or completed actions. Those remain grounded in the simulation and validated before they affect the world.

## 2. Current baseline and gaps

The current implementation and master spec establish useful foundations, but the communication layer is still narrow:

* The pilot agent mainly raises pushback, ready-for-taxi, taxi-to-stand, and holding reports on fixed state/timing rules.
* Readbacks are assembled from structured commands using a small number of fixed strings.
* Requests and pilot calls use fixed templates in `phraseology.ts`.
* The active voice configuration is Piper; Kokoro is an available local alternative. The audio-provider boundary is a good start, but the current voices do not meet the requested human-realistic target.
* Speech input currently sends a push-to-talk recording to OpenAI Whisper, then places the recognized text in the command line for review. The typed command parser still represents a bounded command set, rather than general radio conversation.
* The master spec has now been updated to reflect the selected cloud speech stack and grounded, open-ended dialogue direction. This plan contains the detailed communication requirements and rollout considerations.

The next design should broaden what pilots can communicate, how the system understands the player, how voice is produced, and how dialogue participates in game state.

## 3. Product principles

1. **Meaning first, wording second.** Every transmission has a clear communication purpose and grounded facts. Many natural phrasings may express the same purpose.
2. **Conversation is part of play.** Calls are triggered by aircraft intent, phase, workload, changing conditions, and prior conversation—not just a small fixed checklist.
3. **The player may use ordinary speech.** The player should not have to memorize one parser-specific sentence to make a valid request or instruction.
4. **Safety-relevant facts stay authoritative.** A language or audio model can interpret and express intent; deterministic simulation rules decide whether it is valid and what changes.
5. **Stable identity, varied delivery.** An aircraft should sound like the same crew over a session while varying wording and delivery appropriately.
6. **Radio realism over theatricality.** Aim for believable, clear, concise ATC audio with natural cadence, not dramatic acting or unnecessary chatter.
7. **Online services are allowed.** Design for cloud speech recognition and premium speech synthesis, with provider abstractions, secret handling, cost visibility, and graceful failure. Offline operation is not a product constraint.
8. **Simulation rules and phraseology require aviation review.** Generated language must be checked against the chosen UK operating context and current source material before it is presented as procedurally correct.

## 4. Target communication model

Represent each exchange in two layers.

### A. Grounded communication event

This is the authoritative meaning of the call. It should identify, as applicable:

* speaker and callsign;
* addressee, position, and frequency;
* communication act, such as request, instruction, readback, acknowledgement, report, correction, clarification, unable, or emergency;
* aircraft state and relevant clearance references;
* exact operational facts: runway, taxi limit, route, stand, restriction, frequency, or other values;
* intended state effect, if any;
* whether the call requires a controller response or readback check;
* confidence, ambiguity, and provenance of interpreted details.

This event is saved in the simulation log and can be replayed without rerunning a language model.

### B. Natural radio realization

The event is expressed as a spoken call. A generation layer may choose among valid concise phrasings and delivery styles while preserving every required fact. For example, a pilot may make a standard compact request or a more conversational request for clarification, depending on context. The exact wording should not be the only accepted key to an action.

Keep a normalized transcript separate from the audio realization. This supports replay, subtitles, evaluation, and provider changes without making an audio file the source of truth.

## 5. Open-ended player interaction

Replace the assumption that the player must issue only parser-ready command strings with an interaction pipeline that handles full radio turns:

1. Capture a push-to-talk transmission and retain its audio reference according to the user’s recording/privacy settings.
2. Transcribe it with the selected cloud speech recognition provider. Preserve alternatives or confidence where available.
3. Resolve the callsign, frequency, aircraft references, runway/taxiway/stand names, and conversational references such as “that route” against the current session.
4. Classify the turn into one or more typed dialogue acts and extract entities/values.
5. Validate authority, aircraft state, route feasibility, clearance rules, and phraseology constraints.
6. If valid and unambiguous, apply the resulting command. If ambiguous or invalid, keep the world unchanged and let the relevant pilot/controller ask a natural clarification or explain the issue.
7. Show the transcript and understood meaning to the player. Allow correction or retry.

The player should be able to:

* use accepted phraseology, shorter natural variants, and reasonable conversational wording;
* ask a pilot to repeat, clarify, confirm a route, or report its current state;
* make multi-part instructions when the scenario and clearance model allow them;
* correct a previous instruction and handle pilot readbacks that omit, alter, or misunderstand part of it;
* make requests such as “can you take the next taxiway?” and receive a grounded answer based on the aircraft’s actual route and restrictions;
* use a natural follow-up that refers to the preceding turn, without restating every callsign and detail each time.

Do not treat arbitrary conversation as a command. When speech is outside the current simulation’s capabilities, the system should respond in character with a short, useful clarification or limitation instead of silently ignoring it or fabricating a result.

## 6. Broader pilot call and response behaviour

Expand pilot behaviour from scheduled request emission into a stateful crew model. A pilot should know its flight intent, current phase, assigned clearance, route, position, frequency, pending request, and recent exchange. It should decide what to say based on that state and the scenario.

### Communication capabilities to add

For the current ground-focused game, plan support for:

* initial call and check-in, with the right callsign and relevant request;
* stand and pushback requests, including facing direction or local constraints;
* start-up/ready status and ready-for-taxi calls;
* taxi requests, route confirmation, progressive taxi requests, and requests to amend an impractical route;
* hold-short, runway-crossing, and other applicable clearance readbacks;
* reports at an assigned limit, after a stop, after a route change, or when a route is blocked;
* request to continue, stop, return, or taxi to a stand when those actions exist in the scenario;
* unable, unable-with-reason, request-for-clarification, say-again, and correction of a readback;
* repeat calls that respond to frequency activity and elapsed time rather than a single fixed retry loop;
* unusual but supported events such as an aircraft reporting a technical, passenger, or operational problem, with scenario-defined consequences and escalation.

Future tower and airborne scenarios can add line-up, take-off, landing, departure, approach, and handoff conversations once their state machines and approved operational rules exist. Do not make the current ground model pretend to simulate those operations.

### Crew variation

Give each flight/crew a stable profile for call style and voice, plus changing state for urgency, workload, and uncertainty. Profiles may vary in brevity, pace, confidence, and preferred valid wording. Avoid stereotypes based on nationality, gender, or accent. Accent should be an explicit voice choice or scenario attribute, not an inferred personality trait.

Variation should affect phrasing and delivery, not operational competence unless a scenario explicitly models an error. Readback mistakes and procedural misunderstandings should be deliberate, explainable, and scenario-controlled—not random decoration.

## 7. Readbacks that sound human and remain useful

Readbacks should convey what the crew actually understood. Remove the assumption that every pilot repeats a fixed, complete string in the same order.

Requirements:

* Include every mandatory safety-relevant element for the clearance type.
* Allow several valid ordering and wording patterns, with the callsign where required by the selected procedure.
* Use natural pauses and cadence without inserting filler into routine readbacks.
* Vary whether the crew reads back a complete route or the key elements, according to the clearance and chosen operating rules.
* If an element is ambiguous, omitted, or incorrect, preserve that distinction so the controller can catch it and correct it.
* Do not let paraphrasing change a limit, runway, stand, taxiway, crossing permission, or other operational fact.
* Generate the spoken version from a pronunciation-aware representation. Keep written transcript and spoken pronunciation separate; do not rely on a TTS engine to guess callsigns and designators from uppercase text.

Create a reviewed readback matrix by clearance type. Each row should list mandatory elements, acceptable variants, unacceptable substitutions, correction behaviour, and whether the aircraft may act before a corrected readback.

## 8. Human-realistic voice system

### Provider direction

Use **ElevenLabs for voice output**. The existing master spec already names ElevenLabs, and the product decision is to use its cloud TTS for pilot and controller audio. Its current documentation describes lifelike TTS, voice design, and streamed audio. Keep a provider boundary so another service can be added later if needed, but the initial implementation should target ElevenLabs. Audition available ElevenLabs voices against sample radio traffic before assigning the roster.

Official provider references:

* [ElevenLabs Text to Speech overview](https://elevenlabs.io/docs/overview/capabilities/text-to-speech) and [streaming API](https://elevenlabs.io/docs/eleven-api/guides/how-to/text-to-speech/streaming)

These links describe provider capabilities, not a guarantee that a voice will sound like a real pilot on an EGLL frequency. Test candidate voices with the same calls, pronunciation set, radio processing, and latency targets.

### Voice roster and direction

Create a real multi-voice roster for both pilot aircraft and controller positions; the system must not route all traffic through one default voice. Initial target: audition at least **16 distinct pilot voice IDs and 3–5 controller voice IDs**, then expand the pilot pool from playtest feedback and traffic density. Cover a deliberately chosen range of voice registers and accents/locales that fit the scenario, while keeping every voice clear through radio processing.

Assign one voice identity to each aircraft crew at spawn and keep it stable for the flight/session. Assign controller voices by position, with an optional player preference for their own controller voice. Store the voice ID, provider/model, locale, pronunciation profile, and generation settings as a versioned voice profile. Seed assignment for replay, avoid the same voice on adjacent calls where practical, and do not select an accent from airline nationality unless the scenario explicitly supplies that attribute. Use variation in wording, pace, and emphasis within each voice identity; do not change the voice identity from call to call.

Define each voice with an audition card: perceived age range, vocal register, accent/locale, speaking rate, clarity, radio suitability, and permitted usage. Keep attributes respectful and non-stereotyped. Use licensed synthetic voices or voices with explicit consent and commercial-use rights. Do not clone a real pilot, controller, or public figure without documented authorization.

For TTS, evaluate:

* natural prosody on callsigns, numerals, runway/taxiway designators, and abbreviations;
* intelligibility after radio filtering and at normal gameplay volume;
* stable identity from call to call;
* variation in stress and cadence without melodrama;
* streaming/first-audio latency and completion time;
* reproducibility or a stored audio artifact for replay;
* usage cost at expected traffic density and cache-hit rate;
* provider terms for voice usage, retention, and generated audio storage.

### Cost and usage budget

ElevenLabs TTS cost is driven primarily by the amount of text synthesized and the selected model/plan. **Having a roster of voice IDs does not by itself multiply the bill**; generating the same line separately in several voices does. Normal play should synthesize a line once in the assigned aircraft's voice. Reusing an exact cached line with the same voice/settings should avoid another synthesis request.

As checked on **11 October 2026**, ElevenLabs' public API pricing lists these example rates per 1,000 text characters:

| Model option | Published example rate | Cost per 10,000 uncached characters | Fit to evaluate |
|---|---:|---:|---|
| Eleven v3 Conversational | $0.05 | $0.50 | First low-latency conversational audition |
| Eleven v3 | $0.10 | $1.00 | Compare expressive quality against conversational mode |
| Eleven Multilingual v2 | $0.10 | $1.00 | Compare stable natural delivery and accent coverage |
| Flash/Turbo | $0.05 | $0.50 | Cost/latency comparison for routine high-volume calls |

These are published API examples, not a quote: rates, included credits, model availability, custom voice multipliers, and billing terms can change and should be checked in the account before launch. See [ElevenLabs API pricing](https://elevenlabs.io/pricing/api), [model pricing and plans](https://elevenlabs.io/pricing), and [credit usage details](https://elevenlabs.io/docs/help-center/product/core-capabilities/text-to-speech/how-much-does-it-cost-to-generate-using-eleven-v3-alpha).

Use this planning formula:

```text
monthly TTS spend ≈
  (uncached generated characters per session × sessions per month ÷ 1,000)
  × selected model's price per 1,000 characters
```

At the current example rates, 100,000 uncached characters cost about **$5 at $0.05/1K** or **$10 at $0.10/1K**; 1,000,000 cost about **$50** or **$100**. This excludes taxes, plan discounts/credits, premium voice multipliers, retries, and non-TTS services. Track actual generated character usage from provider response metadata and compare it with the estimate. Set a monthly budget and warning threshold before enabling cloud voices for long sessions.

Budget controls should include:

* cache generated audio by exact spoken text, voice ID, model/version, pronunciation profile, and delivery settings;
* synthesize only the selected voice for a call, not every possible voice variant;
* pre-generate/cache common short calls only for the voices actually assigned or likely to be used;
* keep a configurable cap for speculative prefetching and avoid retry loops that can synthesize duplicates;
* show estimated session and monthly spend, with a user-set spending cap and transcript-only fallback when reached;
* record per-model, per-voice, cache-hit, and uncached-character totals so a larger roster's real cost is visible.

### Speech realization and radio acoustics

Build speech from structured tokens and pronunciation dictionaries, not only a plain uppercase phrase. Add explicit pronunciation entries for airline callsigns, callsign abbreviations, EGLL positions, taxiways, stands, runways, numbers, and common UK radiotelephony terms. A reviewed lexicon should control spoken form while preserving a readable transcript.

Apply radio processing as a separate, adjustable audio layer: bandwidth limiting, mild compression, controlled static/noise, squelch, and frequency-specific level. The words must remain intelligible. Provide a clear mode and independent control for radio effect strength. Do not add cockpit ambience or overlapping chatter until it improves workload realism without masking critical instructions.

### Streaming, caching, and availability

Stream TTS when supported so a queued call can begin promptly. Prefetch likely calls when safe, cache generated speech by normalized text, voice ID, provider/model version, pronunciation version, and delivery settings, and allow replay to reuse stored output. Keep credentials on the server. Surface provider failure and fall back to transcript/subtitles or a configured alternate voice provider; never block simulation state on audio generation.

Cloud use means audio and text may leave the local machine. Make retention explicit, keep raw player audio off by default unless the player opts in, and provide a way to clear saved recordings/cache. Give the player a visible indicator when cloud speech services are in use.

## 9. GPT-6 Luna conversation layer and correctness boundary

Use **GPT-6 Luna as the conversation model**. It interprets Whisper transcripts into supported player intents and references, and generates context-aware pilot wording and replies. It is the actual dialogue layer; ElevenLabs only renders its approved text as audio. GPT-6 Luna is not the authority for the simulation.

Target flow:

```text
Player microphone
    ↓
OpenAI Whisper transcription
    ↓
GPT-6 Luna: intent/reference understanding + conversation turn
    ↓
deterministic simulation and clearance validation
    ↓
approved dialogue text + canonical event
    ↓
ElevenLabs voice generation
    ↓
radio playback + transcript
```

The model may need two short calls in a turn—one to interpret the player and another to generate the pilot reply—or one structured call where the player intent and response can both be safely prepared. Prefer the simplest design that meets latency and validation targets. Speech capture and transcription remain separate from the conversation call, and text can still be entered directly for testing and accessibility.

For pilot generation, provide GPT-6 Luna only the current aircraft state, relevant clearance, frequency context, crew profile, recent turns, allowed communication acts, and required facts. Require a structured result containing the selected act, factual slots, and candidate wording. Validate the act and every slot against live simulation state before scheduling audio. Reject or regenerate outputs that add permissions, change a route/limit, claim an unobserved event, or contradict the crew’s actual state.

For player understanding, Whisper provides the transcript and GPT-6 Luna maps varied natural speech to a typed intent and references, with uncertainty represented explicitly. The deterministic command/authority validator remains the gate. Ambiguity should trigger a clarification; a low-confidence model must not silently choose an aircraft or safety-critical value.

Keep language generation outside the deterministic simulation core. Save the validated communication event and the chosen transcript/audio asset so replay does not depend on nondeterministic cloud responses. Use seeded selection among preapproved variants where possible. If the player requests exact deterministic replay, reproduce the original transcript and audio asset.

### GPT-6 Luna roles

These are logical responsibilities assigned to the same GPT-6 Luna service, not separate autonomous agents. Keep prompts and outputs narrow, and combine compatible responsibilities into one structured request when it meets quality and latency goals.

| Role | When it runs | Inputs | Output and boundary |
|---|---|---|---|
| **Player radio interpreter** | After Whisper returns a transcript | Transcript, active frequency, active callsigns, aircraft/clearance snapshot, recent turns | Typed intent and referenced IDs/values, with uncertainty and missing details. It does not apply a command or invent a clearance. |
| **Dialogue context resolver** | Alongside interpretation | Recent canonical radio events and current selected/active aircraft | Resolves references such as “that route,” “the one on stand five,” or “say again” to known entities; asks for clarification when more than one resolution is plausible. Do not depend on hidden model memory: pass the small relevant context each time and store resolved references as events. |
| **Pilot communication planner** | When simulation state permits a pilot call or response | Aircraft state, clearance, pending request, frequency state, allowed communication acts, crew profile | Chooses from the allowed acts, or waits/asks for clarification. It may choose dialogue intent and timing within configured bounds; it cannot change aircraft state, create permission, or report an event absent from the supplied state. Initially combine this with the writer or retain deterministic act selection for routine calls. |
| **Pilot dialogue writer** | For an approved pilot act | Approved act, required factual slots, required readback elements, voice/style profile, recent exchange | Concise natural transcript that preserves every required fact. It cannot add a new request, alter a route/limit, or claim a state change. |
| **Clarification and repair writer** | When interpretation is ambiguous, a readback is incomplete, or a correction is needed | Specific ambiguity/error, relevant transcript, allowed repair acts and current state | A short, useful clarification, repeat, correction, or “say again” response. This can share the player interpreter or pilot writer request; it must not guess the unresolved value. |
| **Future bot-controller writer** | Only in a later phase when an AI controller speaks for an unstaffed position | Validated controller decision, position authority, aircraft state, required instruction details | Natural controller wording for an already-approved decision. Not part of the initial player-controller flow; any generated instruction still passes authority and route validation. |

The intended first implementation can use two principal model calls per exchange: one interpreter/context call after player speech, and one pilot act/writing call after simulation validation. Routine pilot act selection may stay deterministic at first. Do not add a separate GPT “fact checker” call on every turn; use schema validation and deterministic state checks, and add model calls only if evaluation proves they improve outcomes. These choices should match the cost assumptions in §15.

## 10. Frequency and interaction realism

Once the broader dialogue system is in place, add frequency behaviour that makes speech an operational resource:

* Calls are queued according to urgency, waiting time, controller response, and whether an aircraft is already transmitting.
* The player can speak while a frequency is occupied; the sim records blocked or stepped-on speech and the receiving aircraft may ask for a repeat.
* Pilots monitor their assigned frequency, wait for a clear gap, and avoid interrupting unless a scenario calls for urgency.
* Long or unnecessary transmissions affect frequency load and workload evaluation.
* Multiple aircraft may call close together; the system should present a manageable radio queue and make priority understandable.
* Add overlapping transmissions only as a deliberate audio feature with clear controls, a transcript fallback, and a way to hear the missed call again.
* Response timing should vary by communication context and traffic load within scenario-configured bounds, not use one identical delay for every exchange.

## 11. Memory, replay, and evaluation

Store conversation as linked events with speaker, frequency, time, transcript, communication act, referenced aircraft/clearance, interpretation, validation result, audio provider/model/voice metadata, and audio asset ID. Keep the canonical simulation event separate from generated dialogue and audio.

Add replay controls to inspect both what was said and what the system understood. For player speech, compare recognized text, parsed meaning, and actual submitted command so recognition errors do not get scored as controller phraseology errors.

Evaluate:

* **Semantic validity:** generated pilot calls match the live state and clearance.
* **Readback accuracy:** every mandatory clearance element is preserved and errors are detectable.
* **Dialogue breadth:** pilots produce meaningful requests, reports, clarifications, and replies beyond the original small set.
* **Variation:** repeated equivalent situations do not produce the same wording every time, while one crew retains a recognizable voice/style.
* **Recognition:** exact entity and intent accuracy on real radio-style test audio, including callsigns and designators.
* **Latency:** time to show transcript, resolve meaning, begin pilot response, and begin generated audio.
* **Intelligibility:** human ratings after radio effects at different noise/volume levels.
* **Workload:** frequency occupancy, repeats, blocked calls, unresolved requests, and time spent managing traffic.
* **Robustness:** ambiguous, unsupported, conflicting, and provider-failure cases leave simulation state unchanged until resolved.

Build a versioned audio corpus of scripted and naturally worded calls, including accents and noise levels chosen for the game. Have aviation-literate reviewers label acceptable interpretations, required readback elements, and unsafe substitutions. Track quality changes when providers, models, prompts, and pronunciation dictionaries change.

## 12. Delivery sequence

### Phase 1 — Product and phraseology foundation

* Update the master spec’s offline/local constraint and its blanket prohibition on LLM-generated wording.
* Define the communication-act catalogue, ground-only capabilities, callsign/reference resolution, and approved authority boundaries.
* Produce the reviewed readback matrix, pronunciation lexicon, interaction examples, and audio audition corpus.
* Choose what “open game” means for the first playable release and what operations are not yet simulated.

### Phase 2 — ElevenLabs voice quality

* Audition enough ElevenLabs voices to populate the multi-voice target roster using representative EGLL samples.
* Select the initial model configuration, assign stable pilot/controller voice IDs, and document rights, retention, usage budget, and spending alerts.
* Add spoken-text normalization, pronunciation controls, streaming, caching, radio acoustics controls, and a text fallback.
* Tune against intelligibility and latency measures, not voice count alone.

### Phase 3 — Conversational pilots

* Integrate GPT-6 Luna as the bounded dialogue layer; expand pilot state and communication acts.
* Add varied, context-grounded readbacks, corrections, routine reports, route clarifications, unable responses, and state-based requests.
* Add stable crew profiles, varied response timing, and scenario-controlled errors.
* Keep every utterance linked to a validated simulation event.

### Phase 4 — Natural player radio

* Pass Whisper transcripts into GPT-6 Luna for intent/entity interpretation and supported multi-turn dialogue.
* Add confidence and ambiguity handling, contextual references, clarification turns, and transcript/meaning review.
* Keep the deterministic validator as the only path from interpreted speech to world-state change.
* Evaluate recognition and conversational coverage with the versioned corpus.

### Phase 5 — Radio workload and scenario breadth

* Add frequency queues, blocked/stepped-on calls, repeats, workload-aware priorities, and optional overlap.
* Add scenario authoring for disruptions, unusual requests, readback errors, and traffic peaks.
* Add future control positions only alongside their data, rules, and reviewed communication patterns.

## 13. Acceptance criteria for the communication upgrade

The upgrade is ready for broad play when:

* Players can issue supported instructions in multiple natural forms, not only a single template.
* Pilots initiate and respond to a materially broader set of state-appropriate radio exchanges.
* Equivalent calls vary naturally while preserving all mandatory details.
* A pilot’s voice identity stays stable across a session; a larger roster sounds distinct after radio processing.
* The player can hear, read, and review what was understood; ambiguity does not silently mutate the simulation.
* Every generated pilot call and player command is traceable to the state and validated communication event that supports it.
* Replay reproduces the validated dialogue and its audio without asking cloud models to regenerate it.
* Provider outages degrade to transcript/text and do not break gameplay.
* A reviewed evaluation set shows no unauthorized clearances or invented operational facts, and meets agreed thresholds for recognition, intelligibility, latency, and dialogue breadth.

## 14. Decisions to make before implementation

1. What uncertainty threshold from Whisper/GPT-6 Luna should require a clarification?
2. Should raw player audio ever be saved, and what is the default retention period for audio and generated clips?
3. How much radio noise and overlap should be enabled by default, and what accessibility controls are required?
4. Which spoken accents/locales are in the initial 16-pilot/3–5-controller voice roster, and which operations are in the first dialogue catalogue?
5. Which ElevenLabs model should be the default after the quality/latency audition, and what monthly spend cap should apply?
6. Which aviation reviewer will sign off the readback matrix and any phraseology presented as UK-standard?
7. What quality/latency/cost budgets define a good session at target traffic density?

## 15. Costed budget for the chosen stack

This is an initial **usage budget**, not a vendor quote. It gives a comparable cost per active player-hour and a monthly planning envelope. Replace the assumptions with measured usage after instrumented playtests. API prices and subscription terms can change; the cited provider price pages are the source of truth before purchase.

### Current published unit prices

| Service | Planned use | Current planning rate | Cost basis |
|---|---|---:|---|
| OpenAI Whisper (`whisper-1`) | Transcribe controller push-to-talk audio | **$0.006/minute** | Duration of audio uploaded for transcription |
| GPT-6 Luna | Interpret turns and generate bounded dialogue | **$0.10/1M input tokens; $0.50/1M output tokens** | Tokens sent and returned |
| ElevenLabs v3 Conversational | Primary low-latency TTS candidate | **$0.05/1,000 characters** | Characters synthesized in the selected voice |
| ElevenLabs v3 or Multilingual v2 | Higher-quality audition candidate | **$0.10/1,000 characters** | Characters synthesized in the selected voice |

Sources: [OpenAI Whisper pricing](https://developers.openai.com/api/docs/models/whisper-1), [OpenAI transcription model lifecycle](https://developers.openai.com/api/docs/deprecations), [GPT-6 Luna pricing](https://developers.openai.com/api/docs/models/gpt-6-luna), and [ElevenLabs API pricing](https://elevenlabs.io/pricing/api). ElevenLabs model/plan discounts, included credits, premium voice multipliers, taxes, and account-specific terms may change the effective rate.

**Whisper lifecycle constraint:** OpenAI's current deprecation notice says `whisper-1` is scheduled for removal on **February 26, 2027**. Keep Whisper as the selected input during prototyping, but budget an integration and evaluation pass for `gpt-transcribe` or `gpt-live-transcribe` before that date. OpenAI currently lists `gpt-transcribe` at an estimated **$0.0045/minute**; validate that it meets the game's transcription and context needs before switching. The budget below prices the current Whisper selection and does not include one-time migration engineering.

### Usage assumptions per active player-hour

An active player-hour is one hour with the game running and voice output enabled. Rates count all pilot and controller transmissions synthesized for that player's session, not just the player's own spoken turns.

| Scenario | Uploaded player audio | GPT-6 Luna calls (input / output tokens) | Uncached ElevenLabs text | Whisper | GPT-6 Luna | ElevenLabs at $0.05–$0.10/1K | Total variable usage cost/player-hour |
|---|---:|---:|---:|---:|---:|---:|---:|
| Light | 5 min | 50 calls (50K / 7.5K) | 4K chars | $0.030 | $0.009 | $0.20–$0.40 | **$0.24–$0.44** |
| Typical | 10 min | 100 calls (150K / 20K) | 10K chars | $0.060 | $0.025 | $0.50–$1.00 | **$0.59–$1.09** |
| Busy | 20 min | 200 calls (400K / 50K) | 25K chars | $0.120 | $0.065 | $1.25–$2.50 | **$1.44–$2.69** |

GPT input/output totals in this table include the logical roles above. They assume roughly two model calls per full player/pilot exchange—player interpretation/context plus pilot act/writing—with compatible roles combined where practical, and no separate verifier call or cached-token discount. The light/typical/busy usage values are planning assumptions, not measured simulator telemetry. Whisper minutes mean total uploaded clip duration, including any silence the client does not trim. Separating every role into its own request, or adding a GPT-driven bot controller, will increase model usage and must be measured before raising the budget.

### Monthly usage envelope

At the **typical** profile, before contingency or fixed subscription charges:

| Active player-hours/month | At $0.05/1K TTS | At $0.10/1K TTS |
|---:|---:|---:|
| 30 hours (solo development) | **about $18/month** | **about $33/month** |
| 100 hours (small test group) | **about $59/month** | **about $109/month** |
| 1,000 hours (early public usage) | **about $585/month** | **about $1,085/month** |

Recommended planning envelope: use the typical profile and the **$0.10/1K higher TTS rate**, then add a **30% contingency** until playtest data is available. That gives about **$42 for 30 player-hours**, **$141 for 100 player-hours**, or **$1,411 for 1,000 player-hours**, plus any fixed ElevenLabs subscription/seat charge. A tighter envelope can be set after selecting the ElevenLabs model and measuring cache hit rate and characters per session.

### Per-service controls and total budget formula

```text
monthly variable budget =
  uploaded transcription minutes × Whisper rate
  + GPT input tokens × input rate + GPT output tokens × output rate
  + uncached ElevenLabs characters × TTS rate
  + contingency

monthly total = monthly variable budget + any fixed provider plan/seat charges
```

* **Whisper:** cap maximum clip duration and uploaded audio per player-hour; discard silence where practical; do not retranscribe retries without user action.
* **GPT-6 Luna:** limit context to the current aircraft, relevant clearance, and recent dialogue; use structured outputs; log input/output tokens per turn; alert on unusual call volume.
* **ElevenLabs:** assign one stable voice ID per aircraft and position; generate only the chosen voice; cache by text + voice + model/settings; cap speculative prefetch; log character cost and cache hits.
* **Whole stack:** provide monthly spend alerts at 50%, 80%, and 100% of the chosen cap. At the cap, pause new cloud audio/model calls and continue with transcript/text mode. Do not let a provider retry loop spend past the cap.
* **Budget review:** report actual cost per active player-hour, per scenario, per model, and per voice. Recalculate the published estimates whenever a provider changes price, model, or included-credit rules.

