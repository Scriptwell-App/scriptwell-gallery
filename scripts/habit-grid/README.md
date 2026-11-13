# Habit Grid

Tick habits off from an interactive widget, watch 12-week heatmaps and streaks grow, and get one evening reminder that lists only what is still unfinished.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `notifications` to schedule local notifications

## How it works

- Add habits in the mini-app with a name, colour, SF Symbol and schedule (every day or chosen weekdays). Everything is stored on the device; nothing is sent anywhere.
- The widget shows today's habits as toggles. Medium adds a GitHub-style heatmap of the last 12 weeks for one habit (set the widget Parameter to a habit's name to choose it); large shows up to three compressed 8-week grids with streaks.
- The mini-app has streaks, this month's completion rate, a monthly calendar per habit, and a JSON export.
- A background run schedules one evening notification (time of your choice) that lists the habits still unfinished today, and cancels it when everything is done. iOS decides when background runs happen, so the list is as fresh as the last run.
- Run the script once in the app to allow notifications before adding the widget.
