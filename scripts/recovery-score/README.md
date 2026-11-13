# Recovery Score

A 0–100 readiness score from Apple Health: last night's HRV, resting heart rate, breathing rate and sleep compared with your own 14-day baseline. Stays on the device; not medical advice.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, circular, rectangular, inline
- **Permissions:** `health` to read Apple Health data

## How it works

- Reads heart rate variability, resting heart rate, respiratory rate and sleep from Apple Health when you open the mini-app, run the script, or iOS gives it a background refresh. Nothing is sent anywhere: there is no network permission.
- Each metric is compared with your own previous 14 nights (a z-score): higher HRV and lower resting heart rate score better, breathing that drifts from usual scores worse, and sleep is measured against your goal (7.5 h by default). The parts are weighted and clamped to 0–100.
- Needs at least three nights of data for a baseline; an Apple Watch or another sleep tracker that writes to Health gives the best results. Open the mini-app once to approve Health access.
- Widgets read the last computed score from Storage; the Lock Screen ring shows the number.
- This is a wellbeing summary for your own curiosity, not a diagnosis or medical advice.
