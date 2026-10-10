# EGLL ATC SIMULATION — V1

> Historical planning document retained for design context. The current source of truth is `EGLL_ATC_Simulation_V1_Master_Spec.md`; provider choices, workflow instructions, and requirements in this archive may be outdated.

## Original Master Development Context

You are the primary development agent for this project.

This document is the product and simulation context you must understand BEFORE designing or implementing the game.

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

## V1 airport: EGLL — London Heathrow

The first version contains ONLY EGLL.

Do not attempt to build a multi-airport product before the EGLL simulation is operationally coherent.

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

The purpose of V1 is to make the simulation engine deep enough that adding another airport later becomes primarily a matter of adding another validated operational dataset rather than rewriting the entire ATC engine.

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

The exact schema should be designed by Claude, but the conceptual richness must remain.

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

Do NOT let an LLM freely invent radio calls.

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

The scoring system should be transparent enough that the player can understand why performance was good or bad.

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

Claude must follow these rules.

## Rule 1 — Never invent aviation facts

If a required operational value is unknown:

STOP.

Identify the missing value.

Identify the authoritative source needed.

Do not invent it.

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
* generic "pilot AI"
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

---

# 45. CLAUDE'S FIRST JOB

DO NOT immediately start coding the entire game.

First produce a detailed implementation/architecture plan based on this specification.

That plan must identify:

### A. Technology architecture

Determine the appropriate architecture based on the actual project environment.

Do not assume a framework, engine, database, language or deployment target unless already established.

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
* Frequency
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

# 48. LICENSING RULE

This project may eventually be distributed publicly/commercially.

Therefore:

DO NOT assume:

"publicly available" = "free to redistribute."

For every external asset/data source, Claude should identify:

* source
* data type
* license/terms
* whether modification is allowed
* whether redistribution is allowed
* whether commercial use is allowed
* attribution requirements
* restrictions on derived works

If licensing is unclear, flag it.

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

# 50. REQUIRED RESPONSE FROM CLAUDE BEFORE CODING

Before writing substantial implementation code, respond with:

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

---

# END OF MASTER CONTEXT

# VISUALIZATION

Dots are completely fine for the radar view. The image you sent is much closer to what I now understand you want for the airborne controller positions: a dense operational radar picture, not a stylized "game radar."

The distinction should be:

Surface / Ground

Use the airport's actual 2D plan-view geometry.

Runways
Taxiways
Aprons
Stands
Holding positions
Airport movement areas
Aircraft depicted as oriented aircraft symbols
Surface surveillance targets
Flight identification/data
Taxi routes and clearances

This is where aircraft shapes make sense because orientation and exact surface position matter.

Tower

A tower-oriented operational display, with the airport/runway environment prominent.

The player needs to understand:

who's approaching
who's departing
who's occupying a runway
who is lining up
who is taxiing
runway configuration
wind
sequencing
conflicts/incursions
Departure / Arrival / Center

The aircraft can absolutely become simple radar targets/dots.

Like your reference:

                  N

       ✈ KQ402
          350
          18
           \
            \
             • ET901
               270
               42

    ┌─────────────────────┐
    │       SECTOR A      │
    │                     │
    │  •       •          │
    │      •              │
    │             •       │
    └─────────────────────┘

But the critical part is the data attached to the target.

The radar isn't just showing:

● KQ402

It should represent the operational information available to that controller, including things such as:

callsign
altitude
speed
heading/track
flight-plan information
squawk
aircraft type where appropriate
controller-assigned information
route/fix information
selected/cleared data
relevant warnings/alerts

And the density should be able to become extremely high during rush-hour scenarios.

That's actually one of the things I think will make your game compelling: you start with a manageable sector, then the traffic builds until you're looking at something resembling the screenshot you provided and you have to maintain the picture mentally while issuing instructions.

So visually, we're talking about this hierarchy
                    GAME
                      │
          ┌───────────┴───────────┐
          │                       │
       SURFACE                 SURVEILLANCE
          │                       │
   Ground / Tower          Departure / Arrival
          │                       │
   Airport plan view          Radar scope
          │                       │
   Aircraft symbols             Targets
          │                       │
   Real airport geometry    Real airspace geometry

The representation changes because the controller's operational environment changes — not because we're simplifying the simulation.

And I agree with your correction: the underlying world should remain real-world-standard throughout. We can choose different visualizations for different controller positions without simplifying the aviation model underneath them.


