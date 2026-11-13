# Team Clocks

Local time, day offset, working hours and day-or-night tint for each teammate, an overlap finder with a slider that shifts your own time, and optional Apple Weather for their cities; no permissions needed.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular
- **Permissions:** none

## How it works

- Add a teammate with a name and a city. The city is looked up with Apple Maps place search (only the text you type is sent) and a time zone is suggested from the country and longitude; pick another from the list if it is wrong.
- Each clock shows the local time, +1 or −1 when it is already tomorrow or still yesterday there, whether it is inside their working hours, and a tint worked out from the sun's height at their coordinates.
- The overlap finder draws a 24-hour bar per person, coloured where their working hours overlap yours. The slider shifts "my time" so you can try a meeting hour and watch every clock move.
- Weather is off by default. Turn it on to fetch Apple Weather for each city while the mini-app is open; widgets only show the cached temperature.
- Widgets plan their next half hour as a timeline, so the times tick without a refresh. Everything stays in Storage on the device.
