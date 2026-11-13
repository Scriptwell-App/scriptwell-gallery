# Golden Hour

Golden hour and blue hour for where you are: a live countdown, a light-quality strip for the day built from Apple Weather cloud and UV forecasts, sunrise, sunset and day length, in every widget size and a mini-app.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, circular, rectangular, inline
- **Permissions:** `location` to read your current location

## How it works

- Run it once in the app (or open the mini-app). It takes a coarse location fix and asks Apple Weather for sunrise and sunset (yesterday, today, tomorrow) and the hourly cloud cover and UV index. The answer is cached in Storage; background runs and the mini-app refresh it every few hours.
- Golden hour is worked out from the sun's elevation (−4° to 6°) and blue hour from −6° to −4°, using a standard solar-position formula on the device, so widgets never call Weather themselves.
- Each daylight hour gets a light-quality score: low sun scores high, thin or broken cloud helps, overcast and strong UV hurt. The strip in the widgets and the mini-app shows the day at a glance.
- Only your coordinates (rounded to about a kilometre) go to Apple Weather and Apple's geocoder for the place name. Nothing else leaves the device.
