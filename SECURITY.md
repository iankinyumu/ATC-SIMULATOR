# Security Policy

## Supported versions

This project is an early-stage prototype. Security fixes are currently handled on the default branch; there are no versioned releases yet.

## Reporting a vulnerability

Please do not publish credentials, API keys, personal data, or exploitable details in a public issue. Use GitHub's private vulnerability reporting for this repository if it is enabled. Otherwise, contact the maintainer privately through [@iankinyumu on GitHub](https://github.com/iankinyumu).

Include the affected component, impact, and reproduction steps. The maintainer will acknowledge reports and coordinate a fix and disclosure where possible.

## Secrets and audio

Keep `OPENAI_API_KEY` and any future `ELEVENLABS_API_KEY` in local environment variables or an ignored `.env` file. Do not commit keys, raw microphone recordings, generated audio caches, or downloaded voice/data files.
