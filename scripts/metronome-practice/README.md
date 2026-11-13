# Metronome & Practice

A metronome with tap tempo, time signatures and an accented first beat, plus a practice log with pieces, a timer, weekly minutes and a streak. Everything stays on the device.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, rectangular
- **Permissions:** none

## How it works

- Metronome: set the tempo with the slider, the stepper or tap tempo (the average of your last four taps), pick 2/4, 3/4, 4/4 or 6/8, and tap Play. Beat one is a higher tone (Sound.tone), the rest a lower one. The screen stays awake while it plays.
- The beat loop is a setInterval started by the Play action. A mini-app keeps running while it is open, so the loop keeps ticking between redraws; the count-in bar is awaited inside the action so the first beats always play. A run stops itself after 20 minutes. The screen only redraws after a tap, so the beat indicator shows the current bar when you tap Play, Stop or Tap.
- Practice log: add pieces with a daily target, start the timer on one, stop to log the session. Sessions are kept in Files (practice-log.json); the widget shows the streak, this week's minutes and a chart.
- Nothing is sent anywhere. No permissions needed.
