# Trivia Duel

A daily ten-question quiz from opentdb.com with a timer, streaks, per-category accuracy and a six-character duel code to compare scores with a friend.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, rectangular
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- Once a day the script fetches ten multiple-choice questions from opentdb.com (the Open Trivia Database) for the category and difficulty you chose, and keeps them in Storage, so the day's set is the same every time you open it.
- Play tab: answer each question against a live timer. Score, time, a streak across days, lifetime stats and a per-category accuracy chart build up on the device.
- Duel: share today's score with a six-character code that encodes the day, category and difficulty. A friend with the same script enters the code to check they played the same day's setup, then compares scores.
- Honest limitation: opentdb.com hands out random questions on every request, so two phones can receive different questions for the same code. The duel compares scores on the same day, category and difficulty, not identical questions.
- Widget: today's score and streak with a Play button that opens the mini-app. Sounds and haptics play in the mini-app only.
