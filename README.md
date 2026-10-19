# Task Organizer

A to-do list that never drops a task.

## Problem

Unfinished tasks get lost from one day to the next. Today we rebuild the to-do list by hand from manual notes, which takes extra minutes each day and sometimes means missed follow-ups and deadlines.

## Solution

A Claude-built task organizer that **automatically carries undone tasks forward into today's list**. A task stays open until you check it off. Nothing is removed on its own.

### Features

- **Automatic rollover**: open tasks from earlier days show on Today with a "since <date> · Nd" badge
- **Boards**: separate lists (e.g. Official / Personal) with rename, delete, and bulk move between boards
- **Priorities**: High / Medium / Low, sorted automatically, or drag to reorder by hand
- **Notes**: a comment on each task
- **History**: see what was on the list on any past day
- **Completed**: every finished task in one place
- **Weekly & monthly review**: stats, a calendar view, review notes, and a "mark reviewed" flag
- **Midnight-aware**: a tab left open rolls over to the new day on its own
- Light and dark themes, works on mobile

## Running it

It's one static file with no build step. Open `index.html` in a browser.

**Storage:** when hosted as a Claude artifact, each viewer's data lives in their own private store. Opened anywhere else, it falls back to `localStorage`, so data stays on that device only.

## Scope & guardrails

Internal Qlub tool only. It must not store customer data, transaction info, PII, or payment details. Run the security skills from [clubpay/ai-builder-skills](https://github.com/clubpay/ai-builder-skills) before publishing, and deploy only through the approved Qlub Apps platform (Railway / qlubapps.com).

## Credits

Idea: Vinay Peter (Operations). Built for the Qlub hackathon.
