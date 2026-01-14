# ARG Glitch Transitions for OBS

This folder contains a small, modular set of **Browser Source–based glitch transitions** designed for OBS.  
They are intended to be stacked, combined, and triggered rapidly to create **ARG / analog-horror / signal-interruption** style transitions.

All files render with **true transparency** and **do not require chroma keying**.

---

## What This Is

These are **HTML + CSS + JavaScript overlays** meant to be loaded as OBS **Browser Sources**.

They are:
- Alpha-transparent by default
- Lightweight (no external libraries)
- Parameterized via URL query strings
- Designed for burst usage (short, violent transitions)

They work especially well when:
- Layered together
- Triggered in sequence
- Used between scenes or as "interruptions"

---

## Files Included

**glitch.html**  
Core static / noise glitch. Analog-leaning base layer with tearing, flashes, and instability.

**glitch_bars.html**  
Blocky interruption bars and dropout flashes. Feels like signal corruption or compression failure.

**glitch_redact.html**  
Black redaction shutters with HUD-style text and stamped overlays. Strong "classified / denied" energy.

**glitch_wipe.html**  
Directional wipe glitch that sweeps across the screen while corrupting the image. Ideal as a scene-to-scene transition.

---

## OBS Usage

Add each file as a **Browser Source**.

Recommended settings:
- Width / Height: match your canvas (e.g. 1920×1080)
- Enable "Refresh browser when scene becomes active"
- Optionally enable "Shutdown source when not visible"

No chroma key or filters are required.

If you see a black rectangle, it means something in OBS or the HTML is forcing a background. These files are authored to be transparent by default.

---

## Stacking Strategy

Typical stack order (top to bottom):

1. glitch_wipe.html  
2. glitch_bars.html  
3. glitch.html  

You can:
- Put them all in one scene and toggle visibility
- Or create a dedicated "FX / TRANSITION" scene and cut to it briefly
- Or bind individual Browser Sources to hotkeys / Stream Deck buttons

Short bursts (400–800 ms) feel best.

---

## Customization

All effects are controlled via URL parameters such as:
- duration (ms)
- intensity
- direction (for wipes)
- text overlays
- randomness seed

You can duplicate a file and hard-code a "signature" version for specific transitions if desired.

---

## Design Intent

These are not clean, cinematic wipes.  
They are meant to feel:
- intrusive
- unstable
- intentional but imperfect
- like a broadcast being interfered with

They work best when used sparingly and decisively.

---

### How to actually feed it the "last frame"

You need OBS to write/update `lastframe.jpg` at the moment you trigger the transition.

Two practical ways:

#### 1) With a snapshot plugin (recommended)

Bind a hotkey:

- "Save screenshot of current scene/source to `lastframe.jpg`"
Then your Browser Source loads `glitch_wipe_lastframe.html?img=lastframe.jpg&mode=burst...`

Because the HTML cache-busts (`?v=timestamp`), it will pick up the new image.

#### 2) With a tiny local helper script (if you prefer)

OBS can run a script to grab a frame and save it, then you trigger the overlay.
(You’d run it on your streaming machine, not iPhone.)

---

### Your transition choreography (what it looks like live)

Hotkey press does:

1. Snapshot current scene → writes `lastframe.jpg`
2. Show Browser Source `glitch_wipe_lastframe.html` (burst 500–800ms)
3. Switch to the next scene at ~60–80% of the wipe
4. Hide Browser Source

That produces a "the old scene is being wiped away" effect that feels insanely ARG.

---

## License / Use

Use freely in streams, recordings, ARGs, or personal projects.  
Modify aggressively. Break them. Stack them. Abuse them.

If something looks "wrong," it’s probably correct.