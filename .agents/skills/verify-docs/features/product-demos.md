# Product demos

The home page plays two scripted product demos in a browser-window mock-up: a monitoring tour of five chapters (`Slow pages`, `Busy days`, `Errors`, `Alerts`, `Next steps`, 38 s in total) in the `#tour` section, and a three-chapter setup story (`Connect`, `See`, `Act`, 60.5 s in total) under the setup heading. Each has a player bar with pause, one segment per chapter and a clock, and chapters advance by themselves and loop.

## Sub-features

- `demo-chapter-jump` plays a chapter from its timeline segment and updates the clock and the chapter flag.
- `demo-pause-play` pauses and resumes; the clock stops while paused.
- `demo-autoplay` moves to the next chapter when the current one ends.
- `demo-chapter-index` marks the playing chapter in the chapter list beside the demo (wide screens).
- `demo-second-player` runs the setup demo independently of the tour.

## How to get to it (user POV)

- Choose `See it in action` in the hero, or scroll to the section titled `An app can be up and still let people down` (the tour).
- Scroll to the section titled `You shouldn’t need an expert to know your own app` (the setup demo).

## Driving it with verify-docs

Preconditions:

- `$V doctor` ends with `DOCS DOCTOR OK`; `eval "$($V browser-env)"` and `agent-browser set viewport 1280 800` ran in this shell; the home page is open (`agent-browser open $DOCS/`, `agent-browser wait --fn "$HYDRATED"`, `agent-browser wait --text "Know before"`).
- Define the readers once in the shell: `CLOCKS='JSON.stringify([...document.querySelectorAll("span")].filter(s => /^[0-9]+:[0-9]{2} \/ [0-9]+:[0-9]{2}$/.test(s.textContent)).map(s => s.textContent))'`, `FLAG='document.querySelector("section#tour [aria-live=polite]").textContent'` and `clk() { agent-browser screenshot "$SHOTS/_frame.png" >/dev/null; agent-browser eval "$CLOCKS"; }`. `clk` returns one clock per player (the tour first, the setup demo second). It takes a screenshot first because the clock text is drawn in animation frames, and headless Chrome produces frames only on a screenshot or input.

- **Reach the tour.** Run `agent-browser find role button click --name "See it in action"`, wait a second, then `agent-browser eval "$FLAG"`. It names the playing chapter (`Slow pages` from a fresh load).
- **Jump to a chapter.** Choose the `Errors` segment. Run `agent-browser find role button click --name "Play: Errors"`, wait a second, then `agent-browser eval "$FLAG"` prints `Errors` and `clk` shows the tour clock at least `0:13 / 0:38` (the start of that chapter; `0:14` measured). The mock-up shows the Errors page of the app. `ab_save demos-01-errors "Tour jumped to the Errors chapter, clock at or past 0:13 of 0:38"`.
- **Pause.** Choose the pause button of the tour. Run `agent-browser click "section#tour button[aria-label='Pause demo']"`, then `clk`, `agent-browser wait 2000`, `clk`. The tour clock is identical in both reads and the button is now named `Play demo`: `agent-browser eval 'document.querySelector("section#tour button[aria-label=\"Play demo\"]") !== null'` prints `true`.
- **Resume.** Run `agent-browser click "section#tour button[aria-label='Play demo']"`, `agent-browser wait 2000`, then `clk`: the tour clock moved forward (about 2 s) and the button is `Pause demo` again.
- **Autoplay.** Choose the `Busy days` segment (5.6 s long): `agent-browser find role button click --name "Play: Busy days"`, then `agent-browser wait --fn "document.querySelector('section#tour [aria-live=polite]').textContent === 'Errors'" --timeout 15000`. The flag moved on to `Errors` without a click (about 6 s, measured).
- **Chapter index.** At 1280 px wide a list named `Demo chapters` sits beside the demo. Run `agent-browser eval 'JSON.stringify([...document.querySelectorAll("section#tour nav[aria-label=\"Demo chapters\"] button")].map(b => b.getAttribute("aria-current")))'`: exactly one entry is `"step"`, the playing chapter. Choose a question in that list (`agent-browser find role button click --name "Will we hear about it"`), wait a second, and read again: `"step"` moved to the fourth entry and `agent-browser eval "$FLAG"` prints `Alerts`.
- **Second player.** Centre the setup demo, so the sticky header does not cover its bar: `agent-browser eval 'document.querySelector("button[aria-label=\"Play: See\"]").scrollIntoView({ block: "center" })'`. Choose the segment `agent-browser find role button click --name "Play: See"`, wait a second, then `clk`: the second clock is at least `0:20 / 1:00`. The tour keeps playing on its own clock. `ab_save demos-02-setup "Setup demo on the See chapter, clock at or past 0:20 of 1:00"`.
- **No analytics leave.** After the interactions, wait 10s and run `$V net demos-network`: `unexpected=0`.

## Gotchas

- Both players use the same accessible names for pause (`Pause demo`, `Play demo`): scope the tour with `section#tour`. Segment names are unique (`Play: Errors`, `Play: See`).
- The demo clock is drawn in animation frames, which run only while the player is on screen and not paused, and headless Chrome produces frames only on a screenshot or input. Read the clock through `clk` (screenshot first); the chapter flag and `aria-current` are React state and need no frame. Never run `requestAnimationFrame` inside `agent-browser eval`: without frames it never resolves and the command hangs until its timeout.
- The `Demo chapters` list is hidden below 1280 px (`xl`). At a narrower viewport the playing chapter's question shows above the demo instead; assert on the flag.
- Jumping to a chapter always resumes playback, so a paused demo plays again after a jump.
- Chapter lengths are hardcoded in `MonitoringDemo.tsx` (`CHAPTER_MS`) and `AgentDemo.tsx` (`AGENT_CHAPTER_MS`); the totals above move with them.
- Both players start playing from 0:00 when they scroll into view; the tour keeps running while you drive the setup demo.
- Header and floating UI cover elements near the top edge: `scrollIntoView` with `block: "center"` before clicking a segment.
- A screenshot of the demo is one instant of a script. Do not claim a transition from a still; read state twice.
