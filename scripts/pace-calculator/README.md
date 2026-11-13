# Pace Calculator

Running maths on the device: pace, time and distance for 5K to marathon, Riegel race predictions, even and negative split tables, treadmill conversions, and your recent runs from Apple Health.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium
- **Permissions:** `health` to read Apple Health data

## How it works

- Everything is computed on the device; nothing is sent anywhere. Apple Health is only read when you tap "Load from Health", and workout data never leaves the phone.
- Calculator tab: pick a distance (5K, 10K, half, marathon or custom), type a time or a pace, and it solves for the third value in km and miles. "Save as target" feeds the widget.
- Splits tab: a split table for the target, even or with a negative split by the percentage you choose. Predict tab: Riegel race-time predictions from a recent result or a Health workout. Treadmill tab: belt speed and incline to pace, with the equivalent flat pace.
- Widget: small shows the target pace, medium adds the first five splits, the halfway time and the finish.
- From Siri or Shortcuts, pass text such as "pace for 1:45 half", "10k at 4:30/km", "5k in 22 min" or "predict marathon from 45:00 10k". With no input it reads out the target race.
- Units follow your locale (miles for US English, kilometres elsewhere) and can be switched at the top of the mini-app.
