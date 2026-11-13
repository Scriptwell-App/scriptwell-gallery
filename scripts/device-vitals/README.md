# Device Vitals

Battery with a 24-hour charge history and time left, thermal state, free storage as a donut and uptime, on the Home Screen and Lock Screen; nothing leaves the device and no permissions are needed.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, circular, rectangular, inline
- **Permissions:** none

## How it works

- Reads the battery, thermal state, free storage and uptime with Device, which needs no permission, and shows them as a dashboard in the mini-app and in every widget size.
- Every run, background run and widget refresh logs the battery level and whether it was charging. The log stays in the script's own Storage for 48 hours and feeds the chart and the time-left estimate.
- The estimate comes from the slope of the most recent stretch of samples in the same state, so it needs about 20 minutes of history before it appears.
- Nothing is sent anywhere: there is no network access and no permission to approve.
- Tip: add a widget soon after installing; widget refreshes are what build the history quickly.
