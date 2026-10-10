# EGLL ATC SIMULATION — V1

## PROJECT SPECIFICATION

This document records the product goals, simulation rules, source requirements, decisions, and known assumptions for the community project. Use it as a living design reference; implementation details and source status should be updated as the project changes.

---

# 0. CONFIRMED PRODUCT DECISIONS

These decisions were made by the project owner and override any conflicting text elsewhere in this document.

| # | Topic | Decision | Section |
|---|-------|----------|---------|
| D1 | Player role | The player is one air traffic controller who can work **up to two frequencies (positions) at the same time**. | §7A |
| D2 | Player input | Controller actions are issued by **speech recognition** (push-to-talk), not by clicking command menus. | §21A |
| D3 | Other positions | Positions not worked by the player are run by a **rule-based in-game controller bot**. A future dialogue layer may help phrase a validated bot instruction; it does not determine authority or change simulation state. | §7B |
| D4 | Pilot response time | Pilots respond **2–5 seconds** after a controller transmission ends. | §19A |
| D5 | Position structure | V1 has **one Ground position and one Tower position**. They are not split into sub-positions. | §7 |
| D6 | Distribution | The project is a **public open-source community repository**. Project-authored code/docs use MIT; external operational data and assets keep their own terms. | §48 |
| D7 | Frequency use | **Only one station transmits on a frequency at a time.** Pilots wait for the frequency to be clear. | §23A |
| D8 | Views | **All views are 2D. No 3D view and no tower out-of-the-window view.** Ground and Tower use a 2D surface plan; Departure, Arrival and Center use a 2D radar display. | §36A |
| D9 | Position combinations | The player can combine **any two positions** of their choice. | §7A |
| D10 | Time | The simulation runs on an **in-game clock**, not the real-world clock. Pause and speed changes are allowed. | §35B |

## 0A. RECOMMENDED DEFAULTS

These recommendations are defaults, not fixed requirements. Changes should be discussed with the maintainer and documented when they affect the architecture or simulation model.

| # | Topic | Recommendation | Section |
|---|-------|----------------|---------|
| R1 | Clearance delivery | Ground handles clearance delivery in V1. The data model keeps "Delivery" as a separate **function** that is merged into Ground, so it can be split out later. | §7 |
| R2 | Technology stack | TypeScript throughout. Headless simulation core, 2D rendering with PixiJS (WebGL), packaged as an Electron desktop app. | §45, B0 |
| R3 | Speech and dialogue | OpenAI Whisper transcription for player input, GPT-4o mini for bounded conversation/intent interpretation, and ElevenLabs for cloud voice output. Current `whisper-1` is scheduled for retirement; migrate before its announced removal. Simulation validation remains deterministic. | §21A, §22, communication plan |
| R4 | Aircraft performance | OpenAP (open-source) as the performance source, with ICAO Doc 8643 for type designators and wake categories. Values not covered are placeholders in the provenance register. | §15 |

Where a decision simplifies real-world operations, it is an approved simplification under Rule 2 (§41) and does not need to be re-approved.

---

# 1. CORE PRODUCT DEFINITION

We are building a serious Air Traffic Control operations simulation.

The most important sentence in this entire document is:

> **We are building a serious ATC operations simulation whose UI happens to be a game — not a game that happens to contain ATC.**

Do not interpret this project as an arcade traffic-management game.

Do not simplify aviation operations into arbitrary game mechanics merely because doing so is easier to implement.

Do not invent aviation procedures, frequencies, separation values, routes, airport geometry, phraseology, aircraft behavior, or controller responsibilities when authoritative real-world information is available.

The player is an air traffic controller.

The aircraft are simulated operational entities.

The airport and airspace are simulated operational environments.

The controller positions are different operational views and authorities over the SAME underlying simulation.

The game should therefore feel like a controller operating a working ATC environment rather than a player moving aircraft around a game board.

---

# 2. V1 SCOPE

## First airport pack: EGLL — London Heathrow

The first release focuses on EGLL. Keep the simulation engine and airport-data interfaces reusable so the community can add other airports as independently validated airport packs. Do not split early development across several incomplete airport packs; establish a coherent EGLL foundation and reusable data workflow first.

Do not hard-code EGLL assumptions into shared simulation rules when those rules can be expressed as airport data or configuration.

EGLL is intentionally being used as the first and primary simulation environment because Heathrow provides:

* high traffic density
* complex surface movement
* substantial arrival/departure traffic
* runway operations
* taxi operations
* multiple controller responsibilities
* significant procedural complexity
* realistic workload
* opportunities for abnormal/emergency scenarios
* weather-related operational effects
* controller handoffs
* airborne surveillance
* realistic radio workload

The purpose of the first release is to make the simulation engine deep enough that adding another airport later becomes primarily a matter of contributing a validated operational dataset rather than rewriting the ATC engine. Community airport packs must document their sources and redistribution rights.

---

# 3. REAL-WORLD OPERATIONS ARE THE FOUNDATION

The simulation must use the applicable real-world UK/EGLL operational framework.

This means:

* UK ATC procedures
* UK radiotelephony
* EGLL airport information
* EGLL runway configuration
* EGLL taxiway information
* EGLL stands/aprons
* EGLL published procedures
* applicable airspace structure
* applicable controller responsibilities
* applicable separation rules
* applicable transfer/handoff concepts
* applicable runway and surface procedures
* applicable aircraft/traffic information
* applicable temporary restrictions and operational changes

The game is not supposed to invent a fictional "generic Heathrow."

If real operational information says something works a particular way, model that behavior.

If the information changes through an AIRAC cycle, the data architecture must be able to represent that change.

---

# 4. AUTHORITATIVE SOURCE POLICY

Use authoritative sources as the foundation.

Primary sources:

UK AIP / NATS AIS:
https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/AIP

NATS Digital Datasets:
https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/digital-datasets/

NATS Dataset Checklist:
https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/digital-datasets/Checklists/

NATS EGLL Type A charts:
https://nats-uk.ead-it.com/cms-nats/opencms/en/Charts/type-a-charts

NATS AIP Supplements / AICs / Briefing Sheets:
https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/aip-supplements/

UK CAA CAP 493 — Manual of Air Traffic Services Part 1:
https://www.caa.co.uk/data-and-publications/publications/documents/content/cap-493/

UK CAA CAP 413 — Radiotelephony Manual:
https://www.caa.co.uk/data-and-publications/publications/documents/content/cap-413/

These are not optional background reading.

They should be treated as the authoritative starting point for the UK/EGLL operational model.

Current source status checked during preparation:

* NATS currently lists AIRAC 10/2026 as effective 1 October 2026.
* NATS states that its AIP links are dynamic and change with every AIRAC cycle.
* NATS publishes EGLL digital datasets.
* NATS publishes EGLL-specific chart material.
* NATS publishes EGLL-specific temporary supplements.
* CAA CAP 493 is the UK Manual of Air Traffic Services.
* CAA CAP 413 is the UK Radiotelephony Manual.
* Current CAP 413 Edition 24 became effective 1 July 2026.

Do not assume a URL or document version will remain permanently current.

The implementation should record which operational dataset/version a scenario uses.

---

# 5. DATA MUST BE VERSIONED

A major architectural requirement:

## The airport must be DATA-DRIVEN.

Do not scatter Heathrow-specific facts throughout source code.

For example, do NOT do things like:

```
if runway == "27R":
    ...
```

throughout dozens of unrelated classes.

Instead, airport and operational information should come from structured data.

Potential data categories include:

* airport
* runway
* runway thresholds
* runway declared distances
* taxiway
* taxiway intersections
* holding point
* stand
* apron
* runway entry point
* runway exit point
* navigation aid
* waypoint
* procedure
* SID
* STAR
* approach
* route
* frequency
* sector
* controller position
* airspace boundary
* aircraft type
* aircraft performance
* wake category
* operator
* callsign information
* scenario
* weather
* temporary restriction
* operational rule

Each operational dataset should have a version.

A scenario should know:

```
airport = EGLL
operational_dataset_version = X
scenario_version = Y
```

This is necessary for reproducibility.

---

# 6. TEMPORARY CONDITIONS MUST BE POSSIBLE

Real airports are not static.

EGLL can have:

* runway works
* taxiway works
* closures
* changed declared distances
* temporary restrictions
* changed procedures
* changed traffic distributions
* temporary route arrangements
* weather restrictions
* other operational changes

For example, NATS currently publishes an EGLL supplement concerning northern runway 09L/27R resurfacing works during 2026.

NATS supplement page:

https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/aip-supplements/

Therefore:

Do not design the airport model around the assumption that every runway/taxiway/procedure is permanently available.

Temporary operational state must be representable.

---

# 7. CONTROLLER POSITIONS

V1 contains five primary controller environments:

1. Ground
2. Tower
3. Departure
4. Arrival / Approach
5. Center / London Control

These are NOT separate games.

They are different controller positions operating on the same simulation.

An aircraft can therefore transition through multiple positions during one session.

Example conceptual flow:

```
Stand
  ↓
Ground
  ↓
Tower
  ↓
Departure
  ↓
Center
```

And an arriving aircraft may progress through:

```
Center
  ↓
Arrival / Approach
  ↓
Tower
  ↓
Ground
  ↓
Stand
```

The exact controller structure, transfer points, frequencies and authority boundaries must be based on the selected EGLL operational model.

Do not invent the real-world structure.

## Position structure in V1 (Decision D5)

* There is **one Ground** position and **one Tower** position.
* Real-world splits of these functions (for example separate planning/movement ground roles, or separate arrival/departure tower roles) are **not modelled in V1**.
* Clearance delivery duties (departure clearance, initial route/SID, squawk) are performed by **Ground** in V1, on the Ground frequency (Recommendation R1). In the data, Delivery is a separate function that is merged into the Ground position, so a later version can split it into its own position without code changes.
* In reality, Heathrow approach and departure control are provided from a terminal control centre rather than from the airport. V1 still presents them as the "Departure" and "Arrival / Approach" positions. Their real callsigns, frequencies and boundaries must still come from authoritative sources.

The data model should still allow positions to be split or merged later, so that a future version can add real sub-positions without rewriting the ATC engine.

---

# 7A. PLAYER ROLE (Decision D1)

The player is a single air traffic controller.

The player can work **up to two positions (frequencies) at the same time**.

Examples:

* Ground + Tower
* Departure + Arrival / Approach
* Tower only

Requirements:

* The player chooses their position(s) at session start.
* The player **hears both** frequencies.
* The player **transmits on one frequency at a time** and must choose which one (for example, a separate push-to-talk key for each frequency).
* Each frequency shows clearly whether it is busy, and who is transmitting.
* The authority model (§18) applies per position. Working two positions does not merge their authority. A Ground instruction cannot be issued on the Tower frequency.
* When the player works two positions, transfers between those two positions still happen as real transfers (§20). The aircraft still changes frequency and calls in.

Any two positions may be combined (Decision D9), including non-adjacent ones such as Ground + Center. When the two positions are not adjacent, the bot controllers handle everything between them.

---

# 7B. BOT CONTROLLERS (Decision D3)

Every position the player is not working is run by a **bot controller**.

The bot controller is:

* local and offline
* rule-based and deterministic (given the same seed and inputs, it makes the same decisions)
* preloaded with procedures from the operational dataset
* deterministic simulation rules; GPT-4o mini may select/realize bounded dialogue but does not apply world-state changes

The bot controller must use the **same** systems as the player:

* the same command system (§17)
* the same authority model (§18)
* the same phraseology generator (§21)
* the same frequency and transmission system (§23A)
* the same handoff process (§20)

The bot has **no special access** to the simulation. It cannot move aircraft directly. It can only issue commands, like the player.

The bot must be competent enough to keep its sector safe and to deliver traffic to the player in a reasonable state. Bot behaviour (sequencing logic, standard instructions, handoff timing) must be data-driven and testable.

Bot transmissions can be heard by the player only when the player is monitoring that frequency.

---

# 8. GROUND

Ground is primarily a SURFACE MOVEMENT environment.

The player needs to manage aircraft moving through:

* stands
* aprons
* taxiways
* holding points
* runway entry areas
* runway exit areas
* other operational surface positions

The display should be a real airport plan.

It should not look like a generic road map.

It should resemble an operational surface movement display in information hierarchy.

---

# 9. SURFACE MAP

The EGLL surface display should represent real airport geometry.

Important features include:

* runways
* taxiways
* taxiway intersections
* aprons
* stands
* holding points
* runway entry/exit areas
* other operationally relevant airport features

Aircraft can be displayed as small aircraft-shaped symbols.

They do NOT need to be photorealistic.

Orientation matters.

A surface aircraft should have a meaningful heading/orientation because:

* direction matters
* taxi route matters
* turning matters
* runway entry direction matters
* holding position matters

The surface aircraft should not simply slide along a line like an arcade piece.

---

# 10. TOWER

Tower is primarily concerned with runway operations and the immediate aerodrome traffic picture.

The Tower view should make it possible to understand:

* runway occupancy
* arrivals
* departures
* aircraft approaching the runway
* aircraft leaving the runway
* runway conflicts
* sequencing
* go-arounds
* runway crossings where applicable
* aircraft awaiting runway clearance
* relationship between runway traffic and surface traffic

Tower should have enough surface context to understand the runway environment.

But it should not necessarily use exactly the same presentation as Ground.

---

# 11. RADAR POSITIONS

Departure, Arrival/Approach and Center use airborne surveillance-style displays.

The aircraft CAN simply be dots.

This is intentional.

Do not force aircraft-shaped graphics into radar mode just because they look more visually impressive.

A simple target can be more appropriate.

The target can have an associated data tag.

The display should feel like a working surveillance scope.

---

# 12. RADAR DATA TAGS

Aircraft targets should be capable of showing operationally useful information.

Depending on controller position and configuration, this can include:

* callsign
* aircraft identification
* altitude
* assigned altitude
* speed
* heading
* route/procedure information
* controller status
* handoff state
* relevant alerts

Do not show every piece of database information simultaneously.

The player needs an operationally readable display.

The UI should support:

* target selection
* tag expansion
* decluttering
* filtering
* zoom
* scale changes
* relevant overlays

---

# 13. AIRCRAFT ARE NOT ICONS

This is a critical implementation principle.

An aircraft is an operational entity.

The visual target is only a representation of that entity.

The aircraft should have structured state.

At minimum, the simulation should support:

* callsign
* aircraft type
* registration where appropriate
* operator where appropriate
* origin
* destination
* route
* flight plan
* applicable procedure
* current position
* altitude
* vertical state
* speed
* heading
* track
* assigned altitude
* assigned heading
* assigned speed
* clearance state
* transponder identity
* communication state
* frequency
* current controller
* handoff state
* runway relationship
* stand relationship
* aircraft performance
* wake category
* navigation state

The exact schema should be designed during implementation, while preserving the conceptual richness.

---

# 14. FLIGHT PLAN VS CLEARANCE

This distinction is extremely important.

The flight plan is NOT the same thing as the aircraft's current ATC clearance.

The simulation must distinguish:

* filed flight plan
* planned route
* procedure
* assigned route
* current clearance
* latest controller instruction
* pilot readback/acknowledgement
* actual aircraft state

For example, an aircraft can have one planned route while temporarily being given a heading/vector by ATC.

Do not overwrite the entire flight plan every time ATC gives a tactical instruction.

---

# 15. AIRCRAFT PERFORMANCE

Different aircraft types must behave differently.

The simulation should support characteristics such as:

* acceleration
* deceleration
* climb performance
* descent performance
* speed ranges
* turn behavior
* runway performance
* wake category
* navigation capability
* communication capability

Do not make every aircraft a generic object with different textures.

Aircraft differences should affect controller workload.

Recommended data sources (R4):

* **OpenAP** (open-source aircraft performance model) for climb, descent, speed and related performance values.
* **ICAO Doc 8643** (Aircraft Type Designators) for type designators and ICAO wake turbulence categories.
* The wake categorisation actually applied at EGLL must still be confirmed (§30).
* Values neither source covers (for example pushback and taxi behaviour) are entered as placeholders in the provenance register (§41).
* EUROCONTROL BADA is the industry standard, but it requires a licence. Do not use it unless the owner obtains one.

---

# 16. AIRCRAFT RESPONSE

Aircraft should respond to controller instructions through the simulation.

Do NOT teleport an aircraft into compliance.

If the controller issues an instruction:

1. The instruction is created.
2. It is transmitted.
3. The aircraft/pilot acknowledges where applicable.
4. The clearance becomes active.
5. The aircraft responds.
6. The aircraft's state changes over time.

Response should be affected by realistic aircraft behavior.

---

# 17. ATC COMMAND SYSTEM

Controller actions should be structured commands.

Potential categories include:

* taxi instruction
* hold instruction
* runway instruction
* line-up clearance
* takeoff clearance
* landing clearance
* heading instruction
* altitude instruction
* speed instruction
* route instruction
* procedure assignment
* frequency change
* transponder instruction
* handoff
* other applicable controller instructions

The exact command set must be based on the controller position and applicable UK procedures.

---

# 18. AUTHORITY MODEL

A controller cannot issue every possible instruction at every position.

The simulation must understand:

* who controls the aircraft
* which position owns it
* what authority that controller has
* what coordination is required
* what transfer state exists
* what frequency is active

The UI should derive permissible commands from this authority model.

Do not build one universal command menu and simply hide random buttons.

---

# 19. READBACK / ACKNOWLEDGEMENT

Where operationally appropriate, communications must have state.

A controller issuing an instruction should not automatically mean:

```
instruction received
instruction understood
instruction accepted
instruction executed
```

Those are different concepts.

The simulation should support appropriate communication state.

---

# 19A. PILOT RESPONSE MODEL (Decision D4)

Pilot actions and timing are grounded in the simulation state. GPT-4o mini may plan a permitted communication act and phrase the call, but deterministic rules validate the facts and apply any world-state changes.

Timing:

* After a controller transmission ends, the pilot begins the readback/reply **2–5 seconds** later.
* The exact delay for each response is drawn from the session's seeded random number generator, so replays are identical.
* If the frequency is busy when the pilot is ready to reply, the pilot waits until it is clear (§23A).
* The aircraft begins to act on the instruction after the readback. How quickly the aircraft's state then changes is decided by aircraft performance (§15), not by the pilot model.

Pilot behaviours the model should support:

* correct readback
* "say again" when the controller transmission was not understood (for example, speech recognition confidence was too low, or the callsign was not recognised)
* "unable" when the instruction cannot be followed (for example, performance limits)
* pilot-initiated calls (initial contact, ready for departure, requests, abnormal situations)

Deliberate readback errors are optional for later versions. If added, they must be scenario-controlled and seeded.

---

# 20. HANDOFFS

Handoffs are real simulation events.

A handoff should involve:

* current controller
* receiving controller
* transfer initiation
* transfer acceptance where applicable
* frequency
* aircraft communication state
* controller ownership
* relevant timing/state changes

An aircraft should not magically belong to every controller at once.

---

# 21. PHRASEOLOGY

Phraseology is a formal subsystem.

Do NOT create random ATC-sounding sentences.

Do not let a language model invent ungrounded radio calls or operational facts. A bounded dialogue model may produce varied wording from validated simulation state and required facts; structured outputs must be checked before they can affect the world.

The underlying operational command should generate or select an appropriate phraseology structure.

The system should distinguish:

```
operational command
      ↓
phraseology construction
      ↓
validation
      ↓
transmission
      ↓
acknowledgement/readback
      ↓
simulation execution
```

UK phraseology should be based on the applicable current CAP 413 material.

Primary source:

UK CAA CAP 413:
https://www.caa.co.uk/data-and-publications/publications/documents/content/cap-413/

Current edition checked for this project:
CAP 413 Edition 24, effective 1 July 2026.

The same phraseology system is used in both directions:

* **Generation**: bot controllers and pilots build their transmissions from structured commands.
* **Recognition**: the player's spoken transmissions are parsed into structured commands (§21A).

---

# 21A. SPEECH RECOGNITION (Decision D2)

The player issues instructions by **voice**.

Pipeline:

```
push-to-talk (selected frequency)
      ↓
audio capture
      ↓
OpenAI Whisper transcription + GPT-4o mini intent interpretation
      ↓
typed intent + dialogue turn
      ↓
structured command + uncertainty
      ↓
deterministic authority / operational validation
      ↓
transmission on frequency
      ↓
grounded pilot dialogue + ElevenLabs voice output
```

Requirements:

* Speech-to-text and dialogue services run in the cloud and must be replaceable behind provider interfaces. API keys stay on the server.
* Recognition and intent interpretation should be **context-grounded** by current callsigns, frequency, clearances, airport identifiers, and recent turns. The player can use natural wording; the system should request clarification when a reference or intent is uncertain.
* The interpretation layer outputs a structured command or communication act. It never sends unvalidated free text into the simulation.
* If the callsign is not recognised, no aircraft responds, the same as on a real frequency.
* If the callsign is recognised but the instruction is unclear, the pilot replies "say again".
* The transcript of what was recognised is shown to the player, so they can see what the system heard.
* A typed command line should exist as a **development and accessibility fallback**. It uses the same parser.

Recommended implementation (R3):

* **Transcription**: OpenAI Whisper is the current input transcription service. The `whisper-1` model is scheduled to be removed on 26 February 2027; select and evaluate its replacement before that date.
* **Dialogue interpretation**: GPT-4o mini maps transcripts to typed intents, references, and confidence/ambiguity; generated pilot replies are grounded in current context and validated simulation facts.
* **Validation**: deterministic command, authority, and state checks decide whether an interpreted request can change the world. A model output alone never executes an action.
* **Interfaces**: transcription, conversation, and TTS remain separately replaceable services so a provider change does not change the simulation core.

Because the player composes the transmission, phraseology can be evaluated (§33). Evaluation must separate "the player used incorrect phraseology" from "the speech engine misheard the player". Low-confidence recognition must not be counted as a player phraseology error.

---

# 22. VOICE SYSTEM

The intended experience includes realistic synthetic ATC/pilot voices.

The user intends to use ElevenLabs for realistic voices.

The architecture must NOT make ElevenLabs the simulation engine.

Use an abstraction such as:

```
Phrase
  ↓
Audio Provider
  ↓
Generated Audio
  ↓
Cache
  ↓
Playback
```

The simulation should primarily store:

* phrase text
* speaker
* transmission metadata
* timing
* communication state

The audio provider should be replaceable.

Do not bury API calls throughout gameplay code.

Practical notes:

* Callsign + number + instruction combinations are almost always unique, so caching whole phrases will rarely hit. Consider caching reusable **segments** (callsigns, fixed phrases, numbers) as well as whole phrases.
* Provide a **local TTS fallback** so the simulation still works offline, when the API is slow, or when usage limits are reached.
* Give each aircraft a **consistent voice** for the whole session, and give each bot controller position its own voice.
* Apply a **radio effect** (band-pass filter, light noise, squelch) in playback, not in the stored audio.
* The duration of a transmission must be known by the simulation (§23A). If generated audio is not ready in time, the simulation uses an estimated duration and must not stall.

---

# 23. RADIO WORKLOAD

Radio traffic is part of the controller workload.

The player should hear:

* relevant aircraft transmissions
* controller transmissions
* readbacks where applicable
* handoff-related communication
* abnormal/emergency communications

The radio should not become an incoherent wall of audio.

The player needs to identify:

* who is speaking
* which aircraft is involved
* what was said
* what operational state changed

---

# 23A. FREQUENCY OCCUPANCY (Decision D7)

A frequency is a shared, half-duplex channel.

Rules:

* **Only one station transmits on a frequency at a time.** That station can be the player, a bot controller, or a pilot.
* Every transmission has a start time and a duration. The frequency is busy for that whole time.
* Pilots and bot controllers that want to transmit wait in a queue until the frequency is clear.
* Queue order should be realistic. For example, a readback of an instruction just given should come before a new call from another aircraft.
* The player cannot be blocked from pressing push-to-talk, but a transmission made while the frequency is busy should be flagged (and later evaluated).
* Simultaneous (stepped-on/blocked) transmissions are **not modelled in V1**.

Frequency time is a real resource. A busy frequency is a large part of controller workload, and the evaluation (§34) should measure it.

---

# 24. WEATHER

Weather is not decoration.

Weather should be part of the simulation.

Potential environmental variables include:

* wind direction
* wind speed
* visibility
* precipitation
* cloud/ceiling
* other relevant operational conditions

These can affect:

* aircraft behavior
* runway considerations
* operational procedures
* workload
* available operations
* traffic flow

The exact procedural consequences must come from the applicable operational model.

Do not create arbitrary “weather penalties.”

---

# 25. WIND

Wind must actually affect the simulation.

Do not display:

```
Wind: 270/15
```

while aircraft behavior ignores it.

Wind should be an environmental input to aircraft movement/flight and relevant operational calculations.

---

# 26. TRAFFIC GENERATION

EGLL should feel busy because the simulation produces realistic traffic.

Do not simply spawn random aircraft every few seconds.

Traffic should have structure.

Potential factors:

* arrival demand
* departure demand
* time period
* traffic direction
* aircraft type
* operator/callsign
* origin
* destination
* procedure
* runway configuration
* weather
* traffic density
* controller workload

The traffic system should create operational situations rather than random visual clutter.

---

# 27. RUSH HOUR

A busy scenario should create genuine controller workload.

The difficulty should come from:

* number of aircraft
* timing
* sequencing
* conflicting demands
* handoffs
* runway occupancy
* taxi complexity
* weather
* communication workload
* abnormal situations

Not from arbitrary game mechanics.

---

# 28. EMERGENCIES / ABNORMAL EVENTS

The scenario engine should eventually support realistic abnormal operations.

Examples can include:

* technical problems
* engine-related problems
* radio failure
* medical emergency
* go-around
* rejected takeoff
* runway obstruction
* runway incursion risk
* bird activity
* weather deterioration
* other operational events

These should NOT behave like video-game boss fights.

An emergency should alter the operational situation.

The controller must respond using appropriate procedures.

---

# 29. CONFLICTS

Conflicts should emerge from the simulation.

Do not script:

```
"At minute 14 aircraft A and aircraft B will conflict."
```

Instead, the conflict should emerge from:

* position
* altitude
* heading
* speed
* route
* clearance
* aircraft performance
* controller actions
* traffic state

This makes the simulation dynamic.

---

# 30. SEPARATION

Safety is the central mechanic.

The controller's primary responsibility is to maintain safe traffic.

The simulation must implement the applicable separation concepts and rules for the selected UK operational model.

Do NOT invent numerical separation minima.

Do NOT copy a random value from an aviation website.

Use the applicable authoritative source.

CAP 493 is a major reference for UK ATC procedures:

https://www.caa.co.uk/data-and-publications/publications/documents/content/cap-493/

Current CAP 493 checked for this project:
Edition 12, effective 31 October 2025.

CAP 493 covers areas including:

* arrivals
* departures
* aerodrome control
* coordination
* transfer of control
* weather effects
* low visibility procedures
* surface traffic
* runway crossings
* runway occupancy
* runway incursion prevention
* surface movement radar
* taxiing aircraft
* line-up
* takeoff
* wake turbulence
* arriving aircraft
* landing

Therefore it should be treated as a major operational reference.

EGLL-specific separation items to research and confirm before implementing (do not assume these from memory):

* whether EGLL arrivals use time-based separation on final approach, and how it works
* which wake turbulence categorisation scheme applies at EGLL (for example, a RECAT scheme versus the standard UK categories)
* runway operating modes (for example segregated or mixed mode) and any runway alternation pattern

These directly change how Arrival/Approach and Tower must sequence traffic.

---

# 31. RUNWAY SAFETY

Runway state needs to be explicit.

The simulation should know things such as:

* runway occupied
* runway vacated
* aircraft lined up
* aircraft cleared for takeoff
* aircraft landing
* aircraft approaching
* aircraft crossing where applicable
* conflicting movement
* relevant clearance state

The system should be able to detect operationally unsafe combinations.

---

# 32. CONFLICT ALERTS

Alerts can assist the player.

But the alert system must NOT become a replacement for simulation logic.

The same underlying world state should determine:

* aircraft positions
* clearances
* separation
* conflict state
* alerts

Do not build a fake alert system disconnected from the simulation.

---

# 33. SCORING

This is not an arcade score-chasing game.

Performance evaluation should reflect controller quality.

Possible evaluation categories:

* safety
* separation
* procedural compliance
* clearance correctness
* phraseology
* communication
* sequencing
* handoff quality
* runway management
* taxi efficiency
* unnecessary vectoring
* excessive delay
* response to abnormal situations
* traffic throughput
* frequency discipline (for example, transmitting while the frequency is busy)

The scoring system should be transparent enough that the player can understand why performance was good or bad.

Only the positions worked by the player are evaluated. Bot controller performance is logged for debugging but is not scored.

---

# 34. WORKLOAD

A controller handling 40 aircraft should not be judged exactly the same way as a controller handling 4.

The scenario's workload should be part of performance evaluation.

The game should measure both:

```
outcome
```

and

```
difficulty/workload
```

Workload measures can include: number of aircraft under control, number of frequencies worked (one or two), transmissions per minute, frequency occupancy percentage, and number of active conflicts or abnormal events.

---

# 35. REPLAY

A serious simulation should eventually support replay.

The replay should be able to show:

* aircraft trajectories
* clearances
* controller instructions
* communications
* handoffs
* conflicts
* errors
* timing
* important state transitions

This is also important for debugging.

## Determinism is required from day one

Replay should not be a separate recording system. It should come from a deterministic design:

* The simulation advances in **fixed time steps**.
* All randomness (traffic, pilot delays, events) comes from a **seeded random number generator**.
* Every input (player commands, recognised speech results, bot decisions, scenario events) is recorded as a timestamped **event**.
* Re-running the same dataset version + scenario version + seed + event log must reproduce the session exactly.

Speech recognition output is recorded as its recognised result, so replays do not depend on re-running speech recognition. The original player audio may also be saved for review.

---

# 35A. GEODESY, UNITS AND REFERENCES

These are common sources of serious bugs and must be handled deliberately:

* Store positions in **WGS84** latitude/longitude. Use a local projection for the surface display and for short-range calculations.
* Distinguish **magnetic** and **true** headings/tracks. Magnetic variation changes over time and must come from data, not be hard-coded.
* Distinguish **altitude** (on QNH) and **flight level** (on standard pressure). The transition altitude and transition level must come from the operational data.
* Use one consistent internal unit system (for example metres, seconds, metres per second) and convert only at the edges (display, phraseology, data import).
* Record which units every imported data field uses.

---

# 35B. GAME TIME (Decision D10)

The simulation runs on its own **in-game clock**. It is not tied to the real-world clock.

* Each scenario sets its own start date and time (for example a morning arrival peak). The date also decides which operational dataset version applies.
* The player can **pause** at any time. While paused, nothing in the simulation moves and no transmissions start.
* The player can change the **simulation speed** (recommended steps: 1×, 2×, 4×).
* All durations in the simulation are in game time: aircraft movement, pilot response delay (2–5 s game time), transmission length, handoff timing, weather changes.
* The simulation core never reads the computer's real clock. Only the outer game loop does, to decide how many fixed simulation steps to run. This keeps sessions deterministic and replayable (§35).

Recommended behaviour above 1×:

* Radio audio cannot be played faster without becoming unclear. At 2× and 4×, voice playback is muted and transmissions are shown as text only.
* The simulation automatically drops back to **1×** when the player presses push-to-talk, when an aircraft calls the player, or when a conflict alert starts.
* Evaluation (§33–34) records the time spent at each speed.

---

# 36. UI PHILOSOPHY

The UI should feel like an operational workstation.

It should be:

* clean
* information-dense where necessary
* readable
* calm
* structured
* responsive
* optimized for rapid interpretation

Avoid:

* giant arcade buttons
* excessive shadows
* floating decorative panels
* unnecessary animations
* cinematic effects
* excessive 3D scenery
* visual clutter
* fake “AI dashboard” aesthetics

The goal is operational clarity.

---

# 36A. VISUAL REFERENCES (Decision D8)

All controller views are **2D**. There is **no 3D view** and **no tower out-of-the-window view**.

The owner supplied two reference images for the intended look:

**Ground / Tower — 2D surface plan** (reference: NATS Heathrow tower ground display)

* black background
* airport drawn as a flat grey plan: runways, taxiways, aprons, stand outlines
* yellow stand numbers
* white taxiway letters
* red stop bars / holding points with their names
* clear markers for closed areas
* an alert strip along the top of the display
* aircraft drawn as small oriented aircraft symbols on top of the plan (§9)

**Departure / Arrival / Center — 2D radar display** (reference: busy radar picture with data tags)

* dark background
* thin lines for routes/airways, with fix names
* aircraft targets with leader lines to data tags
* multi-line data tags (for example callsign / altitude and speed / type and destination), following UK practice for the actual fields (§12)
* optional weather layer
* designed to stay readable at high traffic density

The reference images set the **style and information layout**. They are not exact templates, and their content (for example the non-UK airport in the radar reference) is not operational data.

## Owner notes on visualization

**Radar targets are dots.** Dots are completely fine for Departure, Arrival and Center. The radar picture should be a dense operational picture, not a stylised "game radar".

**Tower** needs a tower-oriented display with the airport/runway environment prominent. The player must be able to see: who is approaching, who is departing, who occupies a runway, who is lining up, who is taxiing, the runway configuration, wind, sequencing and conflicts/incursions.

**Radar data tags** represent the information available to that controller, such as: callsign, altitude, speed, heading/track, flight-plan information, squawk, aircraft type where appropriate, controller-assigned information, route/fix information, selected/cleared data, and relevant warnings/alerts.

**Density** must be able to become extremely high in rush-hour scenarios. A session can start with a manageable sector and build until the picture looks like the radar reference, and the player has to hold the picture mentally while issuing instructions.

Visual hierarchy:

```
                    GAME
                      │
          ┌───────────┴───────────┐
          │                       │
       SURFACE                 SURVEILLANCE
          │                       │
   Ground / Tower       Departure / Arrival / Center
          │                       │
   Airport plan view          Radar scope
          │                       │
   Aircraft symbols          Targets (dots)
          │                       │
   Real airport geometry    Real airspace geometry
```

The representation changes because the controller's operational environment changes, not because the simulation is simplified. The underlying world stays real-world-standard throughout.

---

# 37. DIFFERENT POSITIONS MUST LOOK DIFFERENT

Do not force every controller position into the same map.

Ground/Tower:

```
airport surface plan
```

Departure/Arrival/Center:

```
radar/surveillance environment
```

The representation changes because the controller's operational environment changes.

The underlying simulation does NOT become simpler.

---

# 38. THE SHARED WORLD

This is one of the most important architecture requirements.

Suppose an aircraft departs Heathrow.

Ground sees it.

Tower sees the relevant runway operation.

Departure receives it.

Center eventually receives it.

Every view is observing the same aircraft.

There must be ONE authoritative aircraft state.

Do not create:

```
GroundAircraft
TowerAircraft
DepartureAircraft
CenterAircraft
```

as separate copies that can drift apart.

There should be one authoritative simulation entity whose presentation differs by controller position.

---

# 39. SIMULATION ARCHITECTURE

Use clear conceptual layers.

## Simulation Engine

Responsible for:

* time
* aircraft movement
* navigation
* aircraft performance
* airport state
* weather
* procedures
* traffic
* conflicts
* separation
* abnormal events

## ATC Engine

Responsible for:

* controller positions
* controller authority
* commands
* clearances
* handoffs
* communication
* frequencies
* readbacks
* operational validation

## Presentation Layer

Responsible for:

* surface map
* radar
* targets
* tags
* UI
* panels
* audio playback
* alerts
* interaction

## Scenario Engine

Responsible for:

* traffic generation
* starting conditions
* weather
* airport state
* temporary conditions
* abnormal events
* objectives
* deterministic seeds

## Evaluation / Replay

Responsible for:

* logging
* scoring
* event history
* replay
* debugging

---

# 40. DOMAIN MODEL OVER UI

Do NOT make the UI the source of truth.

Bad architecture:

```
button clicked
    ↓
move plane
    ↓
change label
    ↓
play sound
```

Preferred conceptual architecture:

```
controller action
    ↓
command
    ↓
operational validation
    ↓
clearance state
    ↓
communication/readback
    ↓
aircraft state
    ↓
simulation update
    ↓
UI observes new state
```

This distinction is critical.

---

# 41. DEVELOPMENT RULES

Contributors should follow these rules.

## Rule 1 — Never invent aviation facts

If a required operational value is unknown:

STOP.

Identify the missing value.

Identify the authoritative source needed.

Do not invent it.

### Parameters with no authoritative source

Some values the simulation needs have no AIP or CAP source (for example pushback duration, typical taxi speeds, engine spool-up time). For these, do not stop development. Instead:

1. Use a clearly marked placeholder value.
2. Record it in the **parameter provenance register** (below).
3. Mention it in your response so the owner can see it.

### Parameter provenance register

Every operational value in the data must be traceable. Each value records:

* the value and its units
* its source tier (§47), or "owner decision"
* the citation (document, edition/AIRAC, section/page)
* its status: `sourced`, `derived`, `owner-decision`, or `placeholder`

Owner decisions (§0, for example pilot response time 2–5 s) are recorded as `owner-decision`. Placeholders must be easy to list, so they can be replaced later.

---

## Rule 2 — Never silently simplify operations

If implementing a simplified model would change real operational behavior:

STOP.

Explain the simplification.

Ask for approval.

---

## Rule 3 — UI convenience cannot override operational correctness

If the UI becomes difficult because the simulation is complex, improve the UI.

Do not weaken the simulation merely to make the UI easier.

---

## Rule 4 — Keep systems testable

Major systems must be independently testable.

Especially:

* aircraft state transitions
* navigation
* route following
* clearance application
* handoffs
* communications
* separation
* runway occupancy
* scenario events
* data loading

---

## Rule 5 — Log important transitions

During development, important state changes should be observable.

For example:

```
AIRCRAFT ABC123
controller: departure
assigned altitude: FL120
heading: 270
frequency: XXXX
handoff initiated: center
timestamp: ...
```

This will be extremely useful when debugging complex ATC behavior.

---

## Rule 6 — Don't build breadth before depth

Do not start building:

* five airports
* dozens of unrelated aircraft models
* decorative 3D environments
* huge menus
* multiplayer
* unnecessary visual systems

before EGLL's core simulation works.

---

## Rule 7 — Do not hardcode temporary data

If a runway is temporarily unavailable, that should be represented through operational data/state.

It should not require rewriting the code.

---

## Rule 8 — Ask when ambiguity affects operations

If two interpretations would produce materially different ATC behavior:

DO NOT GUESS.

Present the ambiguity and request a product decision.

---

# 42. WHAT NOT TO DO

Do not build:

* a generic airport with Heathrow branding
* a traffic-management puzzle
* an arcade runway game
* aircraft moving on invisible rails
* fake radar
* random ATC phrases
* generic "pilot AI" (the rule-based pilot model in §19A is required; an unstructured or LLM-driven pilot is not)
* LLM-driven controllers or pilots
* universal controller commands
* hardcoded procedures scattered across source files
* fake separation numbers
* fake frequencies
* invented taxiway behavior
* arbitrary emergency behavior
* decorative UI pretending to be a controller workstation

---

# 43. WHAT THE PLAYER SHOULD FEEL

The player should feel:

> "I am operating an ATC position."

Not:

> "I am playing a game about planes."

That distinction should influence every design decision.

The challenge should be mental workload.

The satisfaction should come from:

* understanding the traffic
* anticipating problems
* issuing correct instructions
* maintaining separation
* sequencing aircraft
* managing runway operations
* managing surface movement
* handling handoffs
* handling abnormal situations
* keeping the operation moving safely

---

# 44. V1 SUCCESS CRITERIA

V1 is successful when:

1. EGLL is represented using real operational data.
2. The surface display feels like an airport operational plan.
3. Airborne positions have a convincing surveillance/radar environment.
4. Aircraft are operational entities rather than moving icons.
5. Controller positions have meaningful authority boundaries.
6. Ground, Tower, Departure, Arrival and Center operate on one shared world.
7. Aircraft transition between controllers coherently.
8. Clearances actually affect aircraft behavior.
9. Communications have operational state.
10. Phraseology follows the appropriate UK framework.
11. Traffic density produces genuine workload.
12. Weather affects operations.
13. Conflicts emerge from the simulation.
14. Safety/separation matters.
15. Abnormal events change the operational situation.
16. Performance can be evaluated meaningfully.
17. Important events can be logged and replayed.
18. Operational data is versioned.
19. The engine does not depend on hardcoded Heathrow facts scattered throughout code.
20. Adding another airport later should not require rewriting the core simulation.
21. The player can work up to two frequencies at once using speech recognition.
22. Bot controllers run every other position safely, using the same command and phraseology systems as the player.
23. Only one station transmits on a frequency at a time, and pilots respond 2–5 seconds after a transmission ends.
24. A session can be replayed exactly from its dataset version, scenario version, seed and event log.

## Golden scenarios (acceptance tests)

The success criteria above should be checked by concrete, repeatable test scenarios. Examples (the exact stands, runways, SIDs and fixes must come from the dataset, not from this document):

1. **Single departure**: one aircraft from a stand to handoff to Center, in the runway configuration chosen by the dataset. It follows its cleared taxi route and SID, transfers between each position correctly, and no separation rule is broken.
2. **Single arrival**: one aircraft from Center to a stand, through Arrival/Approach, Tower and Ground.
3. **Player on two frequencies**: the player works Ground + Tower while the bot runs the radar positions. Both frequencies are heard, and transmissions are made on the correct one.
4. **Busy frequency**: several aircraft call at once. Calls are queued, only one station transmits at a time, and readbacks arrive 2–5 seconds after each instruction.
5. **Unrecognised speech**: the player says an unclear instruction. The pilot replies "say again" and nothing changes in the simulation.
6. **Replay**: any of the above, replayed from its log, produces an identical result.

---

# 45. IMPLEMENTATION ARCHITECTURE AND ROADMAP

Do not try to build the entire game in one change.

First produce a detailed implementation/architecture plan based on this specification.

That plan must identify:

### A. Technology architecture

Determine the appropriate architecture based on the actual project environment.

Do not assume a framework, engine, database, language or deployment target unless already established.

### B0. Recommended technology stack (R2)

This is the recommended starting point. It may be changed during Stage 1 planning if there is a clear reason, which must be explained.

| Layer | Recommendation | Why |
|-------|----------------|-----|
| Language | TypeScript (strict mode) everywhere | One language for simulation, UI and tools; strong typing for a large domain model. |
| Simulation core | Pure TypeScript package with no UI, DOM or real-clock access | Testable on its own (Rule 4); deterministic; runs in a background worker so the UI stays smooth. |
| 2D rendering | PixiJS (WebGL) | Fast 2D drawing of a detailed airport plan and many radar targets and tags. |
| UI panels | Simple web UI (for example React or plain TypeScript) | Lists, strips and settings around the main display. |
| Desktop shell | Browser-first Vite app; desktop packaging remains an option | Microphone access, local files, and future desktop distribution. |
| Speech and conversation | OpenAI Whisper input transcription; GPT-4o mini bounded conversation layer | Cloud services with server-side keys; replaceable; validated against the simulation. |
| Voice | ElevenLabs cloud TTS behind an audio provider interface | Human-realistic voice output with stable multi-voice roster. |
| Data | Versioned JSON files checked by schemas (for example Zod); SQLite later if needed | Easy to review and compare between dataset versions. |
| Tests | Vitest, plus golden scenario tests (§44) | Fast unit tests and full-session replay tests. |
| Randomness | Seeded random number generator inside the core | Deterministic replays (§35). |
| Source control | Git, in a **public** repository; downloaded third-party data kept out of version control unless redistribution rights are established | Community collaboration; §48. |

### B. Domain model

Define:

* Aircraft
* Flight
* FlightPlan
* Route
* Procedure
* Clearance
* Instruction
* Controller
* ControllerPosition
* PlayerSession (which positions/frequencies the player works)
* BotController
* PilotModel
* Frequency
* Transmission (speaker, frequency, start time, duration, content)
* RecognitionResult (transcript, parsed command, confidence)
* Handoff
* Airport
* Runway
* Taxiway
* Stand
* HoldingPoint
* Airspace
* Weather
* Scenario
* Event
* Conflict
* Separation state
* Evaluation event

### C. EGLL data model

Define exactly how EGLL operational information will be represented.

### D. Controller authority model

Define exactly what each V1 position can see and do.

### E. Clearance state machine

Define how:

```
planned
assigned
transmitted
acknowledged
active
completed
cancelled
```

states work.

### F. Handoff state machine

Define controller ownership and transfer.

### G. Aircraft state machine

Define:

```
parked
pushback
taxi
holding
runway
departure
climb
cruise
descent
approach
landing
rollout
taxi-in
stand
```

and whatever additional states are actually required by the chosen operational model.

Do not blindly use this list if authoritative operations require a better model.

### H. Scenario engine

Define:

* traffic generation
* weather
* demand
* events
* emergencies
* deterministic seeds

### I. Evaluation engine

Define:

* safety
* separation
* procedural correctness
* efficiency
* communication
* workload
* errors

### J. Replay/logging

Define the event model needed to reproduce a session.

---

# 46. IMPORTANT DATA SOURCES

Start your research from these sources.

## NATS UK AIP

Current UK AIP:

https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/AIP

The current page shows AIRAC 10/2026 effective 01 October 2026 and states that the AIP links are dynamic and change with each AIRAC cycle.

---

## NATS Digital Datasets

https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/digital-datasets/

---

## NATS Dataset Checklist

https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/digital-datasets/Checklists/

The current checklist includes EGLL London Heathrow datasets.

Do not assume that downloading data automatically grants redistribution rights. Check the applicable terms/licensing before embedding anything in the game.

---

## NATS EGLL Type A Charts

https://nats-uk.ead-it.com/cms-nats/opencms/en/Charts/type-a-charts

NATS lists EGLL runway charts including:

* 09R/27L
* 09L/27R

These should be treated as reference material and not automatically assumed to be game assets that can be redistributed.

---

## NATS AIP Supplements

https://nats-uk.ead-it.com/cms-nats/opencms/en/Publications/aip-supplements/

This is important for temporary operational conditions.

The current NATS listing includes:

EGLL — Northern Runway 09L/27R Resurfacing Works 2026.

It also lists London-area traffic distribution material affecting EGLL/EGKK.

---

## UK CAA CAP 493

https://www.caa.co.uk/data-and-publications/publications/documents/content/cap-493/

This is the UK Manual of Air Traffic Services Part 1.

Treat it as a core operational reference.

---

## UK CAA CAP 413

https://www.caa.co.uk/data-and-publications/publications/documents/content/cap-413/

This is the UK Radiotelephony Manual.

Use it as the core reference for UK phraseology/radiotelephony behavior.

Current edition checked during project preparation:

Edition 24
Effective 1 July 2026.

---

# 47. SOURCE HIERARCHY

When researching an operational behavior, use this hierarchy:

1. Applicable authoritative UK CAA/NATS/EGLL operational publication
2. Current applicable AIRAC/AIP material
3. Applicable official supplement or temporary information
4. Approved/licensed aviation dataset
5. Properly derived internal representation
6. Clearly marked development placeholder

Never reverse this order merely because a third-party website is easier to understand.

Third-party material can help explain something, but it should not override authoritative operational data.

---

# 48. LICENSING RULE (Decision D6)

This is a **public open-source community project**. Project-authored code and documentation are released under the MIT License in the root `LICENSE` file. The MIT License does not apply to third-party data, charts, models, audio, or assets unless their own terms explicitly allow it.

Public access to a source does not automatically grant permission to redistribute it. Review the applicable source terms before committing external material or derived datasets. Keep downloaded operational data and generated airport datasets out of the repository by default. Record attribution and license information in `DATA_AND_ATTRIBUTIONS.md` and next to any permitted included assets.

For every external asset/data source, record:

* source
* data type
* version / date retrieved
* terms of access, and whether personal use is allowed

Additional rules:

* Do not commit downloaded third-party datasets or charts to a **public** repository. If the code is ever shared, the data stays out of it.
* If personal use under a source's terms is unclear, flag it.

If the project's distribution plans ever change, this section must be revisited before anything is shared.

---

# 49. FINAL DEVELOPMENT PRINCIPLE

Keep this principle visible during development:

> **Do not confuse a simple representation with a simple simulation.**

A dot on radar can represent a sophisticated aircraft.

A 2D Heathrow surface map can represent sophisticated ground operations.

A clean interface can sit on top of a deep operational model.

The visuals should be optimized for controller interpretation.

The underlying simulation should be optimized for operational correctness.

The goal is not to make ATC look complicated.

The goal is to make ATC behave correctly.

---

# 50. ARCHITECTURE REVIEW CHECKLIST

Before making substantial architecture changes, document and discuss:

1. Your understanding of the product.
2. Your proposed architecture.
3. Your proposed domain model.
4. Your proposed EGLL data pipeline.
5. Your controller-position model.
6. Your aircraft state model.
7. Your clearance/handoff state machines.
8. Your radar/surface presentation architecture.
9. Your scenario architecture.
10. Your evaluation/replay architecture.
11. Every external data source you believe is required.
12. Every licensing question you identify.
13. Every assumption you would otherwise have to make.
14. Every point where the specification is ambiguous.
15. A staged implementation plan.

Do NOT hide assumptions.

Do NOT invent missing aviation facts.

Do NOT start by building a pretty UI and then trying to retrofit the simulation.

The simulation model comes first.

The operational data comes next.

The controller interfaces are built around that model.

The visual polish comes after the operational behavior is correct.

## Deliver the plan in stages

The 15 items above should not be delivered in one response. Deliver them in this order, and wait for owner review between stages:

1. **Stage 1**: items 1, 2, 3, 13, 14 (understanding, architecture, domain model, assumptions, ambiguities).
2. **Stage 2**: items 4, 11, 12 (EGLL data pipeline, data sources, terms of access).
3. **Stage 3**: items 5, 6, 7 (controller positions, aircraft states, clearance/handoff state machines), including the bot controller, pilot model, frequency and speech recognition design.
4. **Stage 4**: items 8, 9, 10, 15 (presentation, scenarios, evaluation/replay, staged implementation plan).

## Recommended first implementation milestone

Build one **walking skeleton** before adding breadth:

> A single departure from a stand to handoff to Center, using the real EGLL taxiway graph, with real clearance and readback states, frequency occupancy, the 2–5 s pilot response, the bot controller on unworked positions, a typed command fallback, and an exact replay.

Speech recognition and generated voices are added to the skeleton once the command and phraseology systems work with typed input.

---

# 51. OPEN ITEMS FOR THE OWNER

These still need a product decision. Do not guess them (Rule 8).

All earlier open items are now resolved:

| Item | Resolution |
|------|-----------|
| Clearance delivery | Recommendation R1: Ground handles it in V1 |
| Position combinations | Decision D9: any two positions |
| Time | Decision D10: in-game clock with pause and speed control |
| Tower view | Decision D8: 2D only |
| Technology stack | Recommendation R2 (§45, B0) |
| Speech-to-text engine | OpenAI Whisper for player input; current `whisper-1` must be migrated before its announced removal |
| Aircraft performance source | Recommendation R4: OpenAP + ICAO Doc 8643 |

New open items found during Stage 1 planning should be added here.

## Assumptions in the code awaiting confirmation

| # | Assumption | Where | Confirm against |
|---|-----------|-------|-----------------|
| A1 | Control of an aircraft passes to the receiving position when the aircraft makes its initial call on the new frequency, not when the handoff is accepted. | `src/atc/handoff.ts` | CAP 493 (transfer of control / transfer of communication) |
| A2 | The EGLL taxiway network, holding points and stands from OpenStreetMap are accurate enough to use until checked. The build cross-checks them against the AIP (runways, published taxiways, intersection holding points), but not yet against the AD 2.24 ground movement charts. | `packages/egll-data` | UK AIP EGLL AD 2.24 charts |
| A4 | Pushback moves the aircraft tail-first along the stand lead-in line onto the taxiway, then straight along it (about one aircraft length) so it ends facing the instructed direction (N/E/S/W). Real EGLL pushback procedures and phraseology are not yet modelled. | `src/movement/surfaceMovement.ts` | UK AIP EGLL AD 2.20, CAP 413 |
| A5 | Ground speeds, accelerations and turn limits are generic placeholders (20 kt straight, ≈5–12 kt in turns, 1 m/s pushback), the same for every aircraft type. | `src/movement/performance.ts` | Type-specific performance data (spec §15) |
| A6 | A taxi clearance limit is the named holding point; the aircraft stops at the holding point node. Holding short of intermediate points on the way, standard taxi routes and give-way between aircraft are not modelled yet, so aircraft can pass through each other. | `src/movement/surfaceMovement.ts` | CAP 493, EGLL AD 2.20 |
| A7 | The instruction parser (used by the typed command line now and by speech later) accepts common UK wording such as "PUSH BACK APPROVED FACE EAST" and "TAXI HOLDING POINT A10E VIA A", plus UI short forms. Its grammar has not yet been checked clause by clause against CAP 413. | `src/atc/instructionParser.ts` | CAP 413 |
| A8 | Aircraft dimensions and wake categories are entered from memory (manufacturer airport-planning figures, ICAO Doc 8643) and not yet checked against the documents. | `data/aircraft/aircraft-types.json` | Manufacturer ACAP documents, ICAO Doc 8643 |
| A9 | Stand size limits are estimated from the spacing between side-by-side stands (minus wingtip clearance); stands closer than 25 m are treated as overlapping alternatives (MARS / Multi Choice Apron). Not published stand data. | `packages/egll-data/src/standSizes.ts` | EGLL AD 2.24 parking charts / Heathrow stand data |
| A10 | Taxi routes are not yet restricted by aircraft size. EGLL AD 2.20 restricts A380 to specific routes (chart AD 2-EGLL-2-3) and limits Code E on some taxiways. | `src/movement/surfaceMovement.ts` | UK AIP EGLL AD 2.20, AD 2-EGLL-2-3 |
| A11 | Pilot timings (engine start 30–90 s, call after vacating 3–10 s, repeat after 90 s, at most 3 calls) and request wording are placeholders. In the demo, arrivals appear at holding points north of 09R/27L as if just vacated; landing is not modelled. | `src/pilots/pilotAgent.ts`, display demo | CAP 413, EGLL procedures |
| A12 | Pilot and controller wording (readbacks, requests, reports) and the spoken form (spelling alphabet; digits 3/5/9 as "tree", "fife", "niner") follow ICAO/UK usage from knowledge; not yet checked against CAP 413. | `src/phraseology/phraseology.ts` | CAP 413 |
| A13 | Airline designators, radio callsigns, terminals and fleets for demo traffic are entered from knowledge; flight numbers are generated. | `data/aircraft/operators.json` | ICAO Doc 8585, Heathrow terminal allocations |
| A14 | Current implementation uses local Piper/Kokoro text-to-speech; the target voice output is ElevenLabs with a larger stable roster, per the communication improvement plan. | `packages/display/server/voiceServer.ts`, `data/voices/voices.json` | Implementation status / product plan |
| A3 | Stands with several lead-in lines (e.g. 423, 440, 441, MARS/MCA stands) currently keep only the first line. | `packages/egll-data/src/osm.ts` | AD 2.24 Aircraft Parking/Docking charts |

## Known data gaps

* The current EGLL AIP supplement for the **09L/27R resurfacing works** is not applied. Temporary conditions (spec §6) need their own data layer.
* Taxiway restrictions (wingspan limits, one-way sections, standard taxi routes) are not yet imported.
* Two stand entries ("TBA East Pen", "TBA South Pen") have no lead-in line and are not connected to the network.

---

# 52. DOCUMENT MAINTENANCE

* The "current source status" notes in §4 and §46 were checked during project preparation and will go out of date with each AIRAC cycle. Re-check them before relying on them.
* When the owner makes a new product decision, add it to §0 and update the relevant section.

---

# END OF MASTER CONTEXT
