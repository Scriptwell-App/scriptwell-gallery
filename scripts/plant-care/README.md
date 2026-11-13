# Plant Care

Watering reminders for your plants, with photos, light levels, a care log and an on-time streak. Hot days in the Apple Weather forecast for your location bring outdoor plants forward a day. Notifications are local; nothing is sent anywhere.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular
- **Permissions:** `location` to read your current location; `notifications` to schedule local notifications; `camera` to take photos and scan codes with the camera

## How it works

- Open the mini-app once to approve camera, location and notifications, then add plants: a name, a photo (camera or photo library), how often to water, when you last did, the light it gets and whether it lives outside.
- Each plant gets one local notification on its due date at 9:00. Background runs and every "Watered" tap keep those notifications up to date.
- In the mini-app the script asks Apple Weather for the next days at your location. When a day above 28 °C is coming, outdoor plants are due a day sooner. Only your coordinates go to Apple Weather.
- "Watered" works from the widget and the mini-app. Watering on or before the due date extends your streak.
- Widget Parameter: a plant's name pins the small and medium widgets to that plant. The large widget shows a grid of photos with a droplet on the plants that need water.
