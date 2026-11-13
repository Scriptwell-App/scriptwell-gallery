# On This Day Quiz

A daily five-question quiz on events that happened on today's date: guess the year, read the story on Wikipedia, keep a streak. Events come from en.wikipedia.org; questions are shortened with on-device AI when available.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- Once a day the script loads the "on this day" events for today's date from en.wikipedia.org (the REST feed, with a descriptive User-Agent). The list is cached in Storage for the day.
- Five events are picked and turned into "In which year did this happen?" questions, each with three distractor years close to the real one. The picking is seeded by the date, so everyone gets the same quiz on the same day.
- When Apple Intelligence is available, the event text is rephrased on-device into a shorter sentence; otherwise the original text is used. Nothing is sent anywhere but Wikipedia.
- Answers play a sound and a haptic, show the real year with the story and a link to the Wikipedia page. Your first attempt each day counts towards the score history and streak.
- The widget shows a featured event (one that is not in the quiz) and today's score; the large size lists three events with their years. Tapping the widget opens the quiz.
