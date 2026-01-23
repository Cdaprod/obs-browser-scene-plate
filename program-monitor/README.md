# Program Monitor

A browser-only **Program + Monitor** UI for stacking URL-based media nodes into a timeline. Each node is a multiline textbox:

- **Line 1**: base video URL (duration source)
- **Lines 2+**: overlay videos/images/audio that loop and are clipped to the base duration

## Usage

1. Start the stack:
   ```sh
   docker-compose up -d --build
   ```
2. Open the Program Monitor UI:
   ```
   http://<HOST_IP>:8789/program-monitor/
   ```

## Controls

- **Add Node / Delete Node**: manage the timeline.
- **Transport**: preview the timeline in sequence.
- **Save**: persist to localStorage.
- **Export / Import JSON**: move timelines between machines.
- **Validate**: basic checks for missing base URLs and non-http(s) entries.
- **Open Base**: open the active node base URL in a new tab.

## Tests

Run the minimal utility tests:

```sh
node --test program-monitor/timeline-utils.test.mjs
```
