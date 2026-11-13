# Vocab Trainer

Learn English words with spaced repetition: definitions and phonetics from api.dictionaryapi.dev, on-device translation into your language, spoken pronunciation, flip-card reviews, streaks and accuracy stats.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, rectangular, inline
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- Type a word in the mini-app. Its definitions, part of speech, phonetics and an example sentence come from api.dictionaryapi.dev; only the word itself is sent there.
- Pick your language once and the word and its first definition are translated on the device with Apple's translation models. "Say" reads the word aloud with the system voice.
- Reviews use SM-2 style spaced repetition: flip the card, then rate it Again, Hard, Good or Easy. Each rating sets the next due date, from ten minutes to months away. Everything stays in Storage.
- Stats show words learned (an interval of three weeks or more), what is due today, your streak and a fourteen-day accuracy chart.
- The widget shows the word that is due now with a short definition and the due count; the Lock Screen sizes show how many words are waiting. Tapping the widget opens the trainer.
- From Shortcuts or Siri, run the script with a word as input to add it.
