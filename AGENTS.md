# AGENTS.md

Pixvitta is an Electron macOS and Linux image and video viewer.

Use `pnpm` for project commands.

Do not create tests for every little thing. Only create tests when something actually needs a test. Things that need tests are those that have a define spec, shape or well described functionality and that be liable to implemetation changes in the future to make them more perfomant or work on different systems. E2E tests should be highly focused on the complicated stuff that again hit modules that are complex and are liable to change in the future.

When you see the user intends to start working on something that requires actual planning and several decisions and steps, ask the user if they want to create a planning file to keep tracking of decisions and details of the work.

Ask the user questions if there's good options for solutions. Things like tech choices, artifact shapes, etc. Do not ask user for implementation details unless the user asks you to ask them for implementation details.

# Pushing to dev and main
Whenever pushing to dev or main update the version number so the autoupdater works correctly.
If the user doesn't explicit say that some new change should only be sent to dev, if they say "merge it and push it", assume they mean main. Merge first to dev, then merge dev into main.
