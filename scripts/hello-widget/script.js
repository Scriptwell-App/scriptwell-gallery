// @name        Hello Widget
// @description A minimal widget to start from: a greeting and the time it last refreshed
// @widget      small, medium
// @icon        hand.wave.fill
// @color       #4F46E5
// @version     1.0.1
// @author      scriptwell
// @category    utilities

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
