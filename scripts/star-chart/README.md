# Star Chart

A chore chart for children: tick today's chores from the widget, collect stars towards a reward, and manage children, chores and rewards in a parent area behind a PIN. Nothing leaves the device.

- **Type:** Widget, Mini-app, Shortcuts action
- **Widget sizes:** medium, large
- **Permissions:** none

## How it works

- Open the mini-app once: choose a 4-digit parent PIN, then add your children, their chores and a reward.
- Every chore done today earns a star. Stars pile up towards the reward until the child redeems it.
- The widget shows one child's chores for today as switches. Set the widget Parameter to the child's name; without one it shows the first child.
- The chore grid starts again every Monday. Finished weeks are kept as a history in the parent area.
- The PIN is kept only as a salted SHA-256 hash in the script's storage. No network, no permissions.
