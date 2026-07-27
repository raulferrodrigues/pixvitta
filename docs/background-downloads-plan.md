# Background Downloads Redesign

## Status

Planning. This document belongs to draft PR #15.

The download implementation abandoned before this PR is not a starting point.
Its code and detailed product decisions are deliberately excluded. Draft PR #4
and the abandoned planning notes were read only to recover the useful request
broker concept described below.

## Goal

Design downloads as main-process work that can continue independently of the
currently selected media while remaining subject to every provider's request,
quota, authorization, and resource-validation rules.

The first implementation scope is not decided yet. In particular, this plan
does not yet assume collection downloads, persistence across restarts, a cache
architecture, a destination layout, a concurrency level, or a particular
downloads UI.

## Retained architectural idea

Pixvitta needs a shared request-admission seam for provider traffic. A download
must not obtain a URL and call the network transport independently of the
provider path used by viewing.

The useful broker idea is:

- providers declare governed request policies rather than scattering delays
  through individual call sites;
- policy state remains stable long enough that reopening a provider or
  receiving a short-lived media URL cannot reset a pacing boundary;
- callers describe the intent of queued work so interactive requests can be
  admitted before speculative or bulk background work;
- queued requests can be canceled without consuming a request slot, and
  cancellation of active work reaches the network transport;
- rate-limit and quota signals can suspend the relevant queued work instead of
  allowing a bulk job to keep probing the provider;
- download jobs ask a provider for authorized work, while the provider remains
  authoritative about whether and when its network request may start.

This is an architectural direction, not approval of the abandoned broker's
implementation or its exact policy model.

## Broker boundary

The broker may own:

- request admission time;
- policy-scoped concurrency;
- ordering between waiting request intents;
- cancellation before and after admission;
- policy suspension and resumption;
- enough state to prevent provider recreation from bypassing a limit.

The broker must not own:

- provider URLs, authentication, cookies, or request headers;
- host and redirect authorization;
- response parsing or media validation;
- download destination paths or filenames;
- cache identity or eviction;
- download job lifecycle or renderer presentation;
- provider-specific interpretation of quota and throttle responses.

A provider may translate a response such as HTTP 429 or E-Hentai HTTP 509 into
a typed policy signal. The broker can enforce the resulting suspension, but it
must not invent the provider's recovery policy.

## Existing provider constraints to preserve while planning

These are current Pixvitta rules, not newly chosen broker defaults:

- 4chan API calls are serialized and start no faster than one every 1.1
  seconds; a thread is not refreshed more often than every 10 seconds.
- E-Hentai normal displayed-image transfers are serialized with at least two
  seconds between starts.
- E-Hentai original and force-reload paths must not be used implicitly.
- E-Hentai HTTP 509 must stop automatic background full-image work rather than
  trigger retries.
- E-Hentai thumbnail traffic currently has a separate policy from displayed
  images because the project has no official numeric thumbnail limit to rely
  on.

Before changing or extending any network behavior, the relevant provider rules
and official sources must be checked again. Pixvitta must not probe a service to
discover an unpublished threshold.

## Product decisions

The following decisions must be made before the download architecture is
treated as settled:

1. Is the first release for individual downloads only, or individual and whole
   collection downloads together?
2. Should active downloads survive source navigation, closing the viewer
   window, application exit, or some subset of those events?
3. Which actions are required in the first UI: progress, cancel, retry, reveal,
   clear, pause, or none?
4. Is the OS Downloads directory always the destination, and do collections
   receive their own folders?
5. What constitutes the same completed download: provider identity, remote
   resource identity, destination path, content identity, or a combination?
6. Should viewing and downloading share stored bytes, or only share provider
   admission and in-flight network work?

## Broker design decisions

The following details from the abandoned implementation remain undecided:

- one process-wide broker versus a shared broker with provider-scoped
  schedulers;
- policy identifiers and their lifetime;
- fixed priority tiers versus named request intents and provider-defined
  ordering;
- strict priority versus weighted fairness that prevents starvation;
- whether queued work can be promoted when an interactive caller joins it;
- minimum start intervals, concurrency limits, burst windows, and which
  combinations the policy contract must express;
- whether HTTP 429 suspends one policy, one provider, or all traffic;
- how `Retry-After`, provider-specific cooldowns, and explicit recovery actions
  resume a policy;
- whether retries belong to the broker, the provider, the download job, or are
  excluded initially;
- what diagnostics are necessary to explain why a request is waiting without
  leaking browsing history, local paths, credentials, or media URLs.

## Investigation before implementation

1. Inventory every current provider network entry point and the request policy
   it is supposed to follow.
2. Verify the current 4chan and E-Hentai rules against their authoritative
   sources without generating test traffic.
3. Describe the download user experience and lifecycle independently of the
   broker.
4. Define a small provider-to-broker contract and a separate
   provider-to-download contract.
5. Specify cancellation, throttling, and shutdown state transitions.
6. Decide which contracts are durable enough to deserve focused automated
   tests.
7. Implement one narrow vertical slice before adding collection scheduling,
   persistence, or richer recovery.

## Decision log

- 2026-07-27: Restarted from `dev`; no abandoned download code was reused.
- 2026-07-27: Retained the provider-governed request broker as an architectural
  direction, without retaining its implementation or exact policies.
