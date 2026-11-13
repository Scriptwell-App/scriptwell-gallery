# Word of the Day

One interesting English word a day with its definition, phonetics and an example from api.dictionaryapi.dev, read aloud on request; search any word, keep favourites, and ask Siri to define a word.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** small, medium, large, rectangular, inline
- **Permissions:** `network` to fetch data over HTTPS

## How it works

- A built-in list of 120 words is walked deterministically, so everyone sees the same word on the same day and it changes at midnight.
- Definition, part of speech, phonetic spelling, an example sentence and synonyms come from api.dictionaryapi.dev (the Free Dictionary API). Only the word being looked up is sent.
- The day's word is cached in Storage, so the widget fetches at most once a day and shows the last word when offline.
- The mini-app pronounces words with the system voice, searches any word, and keeps a history and favourites.
- From Shortcuts or Siri, run the script with text such as "define serendipity" and it returns the definition.
