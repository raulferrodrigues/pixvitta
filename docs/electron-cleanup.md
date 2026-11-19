# Electron cleanup

Housecleaning of the Electron app, with no behavior change. One task is one
commit. A task is ticked only after `pnpm verify` passes and a fresh review of
its commit finds nothing left to fix. This file is deleted before the PR merges.

## Dead code and indirection

- [ ] 1. Remove dead code in main: unused functions, exports, fields, options and handlers.
- [ ] 2. Remove dead code in the renderer: unused exports, props, parameters and branches.
- [ ] 3. Remove barrel files and aliases that only re-export, and import the real modules.
- [ ] 4. Remove `void x` and `_x` hacks for unused parameters.

## Main

- [ ] 5. Add a shared provider HTTP module: response cancelling, content type, file responses, user agent, image types, broker error mapping.
- [ ] 6. Share the index-keyed viewing adapter between fourChan and nhentai, and build each media key once.
- [ ] 7. Fold `MediaRegistry` into `MediaCatalog`; plain field for `selectedKey`; one loop instead of a side-effecting `map`.
- [ ] 8. Replace `ProviderRegistry` and its factory with a plain providers array and two functions.
- [ ] 9. Give `MediaLibrary` one outcome type (`AddSourceResult`) instead of a symbol, `SourceOperationResult` and `addResult`; drop `failProtocol` and the repeated phase check.
- [ ] 10. Small library loops and conditionals: `forEach`, side-effecting `filter`, `localFolder` file checks, `mergedSources` ternary, `mixId ?? undefined`.
- [ ] 11. E-Hentai: `ImageLimit` becomes an `AbortController`, flatten `html.ts` nesting, one thumbnail host check, sign-in message helpers, `auth.ts` cookie lookups, destructure `runtimeSession` options.
- [ ] 12. Collapse settings plumbing (`settingsFeature`, `stores.ts`, `SettingsStore`) into one module; one lazy per store.
- [ ] 13. Add a `subscribe` helper to preload for the `on*` listeners.
- [ ] 14. Slim the thumbnailer: shared cache-hit and atomic-write paths, a regex URL parser, one path-id hash, simpler runtime checks, one debug mechanism.
- [ ] 15. Simplify `DownloadManager`: a `kind` field, one duplicate check, no `run`/`operation` memo.
- [ ] 16. Windows: one chrome-state builder, one zoom setter, inline one-line forwarders.
- [ ] 17. Provider runtime: drop `detach`, no `Set` spread, one prefetch window shared by demand and prefetch.
- [ ] 18. Small main fixes: `resourceCache` metadata checks, `mediaResponses` range, `buildInfo` user data path, settings boolean helper, download name sanitizing, `recentSources` load and arrange, `mediaFeature` download errors.

## Renderer

- [ ] 19. Derive `loadState` instead of storing it.
- [ ] 20. `useAppLifecycle` and `useKeyboardShortcuts` read actions with `store.getState()` and register once.
- [ ] 21. Flatten `hotkeys.ts` into plain records and one match function; use it for Cmd+O and Cmd+R too.
- [ ] 22. Deduplicate `viewerStore`: API calls that log failures, load-unless-pushed, `goNext`/`goPrevious`, `openRecentSource`, audio save, retry state, needless `async`, small conditionals.
- [ ] 23. Remove thin layers: `videoController`, layout registry, `useAutoHideControls`, one-use selectors, `ViewerStoreProvider` hooks.
- [ ] 24. Key the single-item viewers and filmstrip items by item, and drop the per-item bookkeeping.
- [ ] 25. One video component shared by the single and continuous viewers.
- [ ] 26. Slim `useImageZoomInteractions`: `clampImageZoom`, no zero-delta ternaries, normalize the wheel once, inline `imageZoom.ts`.
- [ ] 27. Filmstrip: TanStack virtualizer defaults, one-ref resizer, inline thumbnail geometry.
- [ ] 28. Small parts fixes: context-menu helper, `DownloadButtons`, `VideoButtons`, `WebSourceDialog`, `SettingsList`, `UpdateRow`, sources panel, `ContinuousViewer` state, download-state selector, `RecentSourceItem` classes.
- [ ] 29. Stage: `for` loops, no nested ternaries, no build-then-strip objects.

## Not in this PR

These change behavior, so each gets its own branch.

- Broker: limit by host from the request URL instead of by policy; design first.
- Broker: let it see every status before provider code runs, so a 429 is never missed.
- Broker: treat 503 "slow down" as a rate limit.
- Broker: an already-aborted high-priority request must not interrupt active work.
- Broker stress-test suite.
- Update check: a cooldown on the manual check.
- `AccountRow`: no pulsing dot while signing in.
- `docs/e-hentai-provider.md`: thumbnail pacing is out of date.
