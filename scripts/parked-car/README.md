# Parked Car

Remembers where you parked: automatically when background runs see you switch from driving to walking, or with one tap. Map widget, street name, parking-meter countdown, walking directions, a photo of the spot and a history of past spots.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular
- **Permissions:** `location` to read your current location; `notifications` to schedule local notifications; `camera` to take photos and scan codes with the camera; `motion` to read the compass and motion sensors

## How it works

- Automatic detection: in background runs the script reads Motion.activity(). When the last run saw you driving (automotive) and this one sees you walking, your position is saved as the parking spot, with the street from Location.reverseGeocode (coordinates go to Apple's map servers; nothing else).
- Honest limit: iOS gives background runs only a few times a day, so automatic detection can be late or miss a short stop. The reliable trigger is a Shortcuts automation "When CarPlay disconnects" (or when your car's Bluetooth disconnects) with the action Scriptwell › Run Script › Parked Car and input "park". The "I parked here" button and Siri ("Run Parked Car") work too.
- Parking meter: pick the minutes and start it; a notification arrives 10 minutes before it runs out and again when it does. The widget shows a live countdown.
- Widgets show the map with the car pin, the street, how long ago you parked, the meter, and the straight-line distance from where you are when iOS refreshes the widget. "Walk me there" opens Apple Maps walking directions. The mini-app keeps the last 10 spots and can attach a photo (Camera).
- Run the script once in the app before adding a widget, so its permissions are approved.
