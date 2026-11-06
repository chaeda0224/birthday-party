---
title: Birthday candle deployment and phone microphone lessons
author: KINU
date: 2026-11-06
branch: codex/birthday-party-mvp
---

## Decided
The birthday app now uses a black candle-focused Three.js scene. User changes supersede the initial 2D/no-age/single-microphone plan: long candles represent ten years, short candles one year, photos can be toppers or full backgrounds, local orientation drives the camera, and one accepted breath from a valid participant extinguishes the entire room.

## Tried and ruled out
A frequency threshold above half the Nyquist range rejected phone microphone breath. Use a lower band, quiet-percentile baseline, short calibration and a visible input meter; physical phone retesting is still required. Never consider API simulations equivalent to hardware tests.

## Watch out
Remote session termination must reject every late response. Supabase managed realtime.messages already has RLS; attempting ALTER TABLE ENABLE RLS fails with an ownership error. magick-wasm at the pinned version stores its binary in dist/x86/magick.wasm. Backend maintenance works through a rate-limited atomic database gate. Review current source and report before deployment.
