// @name Hello Widget
// @description A minimal widget: a greeting and the time it last refreshed.
// @widget small, medium
// @icon hand.wave
// @color #4F46E5

// The smallest useful Scriptwell widget. It needs no permissions.
// Script.widget registers a function that returns a plain object tree;
// the app renders that tree natively.
Script.widget(async (ctx) => ({
  type: "stack",
  direction: "vertical",
  padding: 12,
  children: [
    { type: "text", text: "Hello", font: "headline" },
    { type: "date", date: new Date().toISOString(), style: "time" },
  ],
}));
