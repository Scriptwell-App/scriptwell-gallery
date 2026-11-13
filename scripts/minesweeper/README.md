# Minesweeper

Classic Minesweeper played entirely inside a Home Screen widget, with a bigger board in the mini-app, a flag mode, a live timer and best times per size.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** medium, large
- **Permissions:** none

## How it works

- Every cell is a widget button, so the whole game runs on the Home Screen: medium is 8×6 with 8 mines, large is 9×10 with 14 mines, and the mini-app plays 10×14 with 25 mines.
- The first tap is never a mine: mines are placed after the first reveal, away from where you tapped.
- Tap the flag button to switch between revealing and flagging. Empty areas open up by themselves.
- The timer is a live date node that counts from your first tap. Best times per board size are kept in Storage.
- Each board size keeps its own game, so a widget game and the mini-app game do not disturb each other.
- Nothing leaves the device and no permissions are needed. Haptics and sounds play in the mini-app only.
