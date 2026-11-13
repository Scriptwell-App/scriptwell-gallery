# Spelling Bee

A spelling game for children: the device says a word, the child types or spells it out loud, and letter tiles show what was right. Rounds of ten words at three levels, with stars, badges and a daily streak. Example sentences come from api.dictionaryapi.dev.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small
- **Permissions:** `network` to fetch data over HTTPS; `microphone` to listen to you and turn speech into text

## How it works

- Pick a level (easy, medium or hard: about thirty kid-safe words each) and start a round of ten words.
- "Say it" reads the word aloud. "In a sentence" asks api.dictionaryapi.dev for an example sentence; only the word itself is sent, and a built-in sentence is used when the request fails or nothing comes back.
- The child types the word, or taps the microphone and spells it out loud: "a p p l e" and "apple" both count. Speech is turned into text on the device.
- After each answer, letter tiles show which letters were right. Ten words make a round with a score, stars and a results screen. Stars unlock badges, and playing on consecutive days builds a streak.
- The small widget shows the streak, the current badge and total stars. Run the mini-app once first.
