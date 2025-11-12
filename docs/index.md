---
layout: home

hero:
  name: "Takos Docs"
  text: "ActivityPub specification"
  tagline: "Canonical reference published at https://docs.takos.jp"
  actions:
    - theme: brand
      text: "ActivityPub Spec"
      link: /activitypub

features:
  - title: ActivityPub extensions
    details: Custom actors, collections, and messaging envelopes used by Takos when federating stories, DMs, and channels.
  - title: Deployment guidance
    details: Domain mapping, authentication, and signature requirements shared by Worker deployments.
---

## Purpose

Takos publishes **https://docs.takos.jp** as the public contract for the platform’s ActivityPub extensions. This site tracks the worker implementation and is meant to be stable enough for external integrators.

## Scope

### ActivityPub customizations

Document every HTTP surface exposed under `/ap/*`, the object schemas used for delivery, and the authentication requirements for private collections. Each endpoint description in `activitypub.md` mirrors the code paths inside `platform/src/activitypub/*`.

## Using these docs

- English and Japanese pages live side-by-side; switch languages from the nav bar when needed.
- Link directly to sections (for example `/activitypub#story-federation`) when referencing the spec from issues or PRs so reviewers can validate behavior.
- Keep this site up to date whenever ActivityPub payloads change—`docs.takos.jp` is treated as the source of truth for partners.
