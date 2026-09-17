# Nudge

A glass board for the things you must not forget, inside Obsidian.

Reminders live as plain checkbox lines in **one note**. Nothing is locked in a
plugin database: the Tasks plugin reads them, a search finds them, and you can
edit them by hand on any device.

```markdown
## Family
- [ ] Sign papers for mom's medical aid 📅 2026-09-20 ⏰ 09:00 ⏫ 🔁 every month #family
```

## What it does

- **Buckets, not a pile.** Overdue, Today, Tomorrow, This week, Later, Someday —
  each answers a different question, so they never share a list.
- **One typed line.** `Sign papers for mom tomorrow at 9am !high #family` becomes
  a dated, prioritised, tagged reminder. It shows you what it understood before
  you commit, and it never eats a word it didn't understand.
- **Repeats that behave.** `🔁 every month` rolls the next one out when you tick
  the last, clamps month ends (the 31st stays month-end, it doesn't spill into
  the 3rd), and catches up past today rather than handing back another overdue
  date. `when done` counts from the day you ticked it — a chore, not a deadline.
- **Snooze** to tomorrow, three days, next week — counted from today, not from a
  date that has already passed.
- **Groups** are your own `##` headings. A `#` title is a title, not a group.
- **A count on the bell** in the ribbon: what is overdue or due today.

## Being told

Two mechanisms, because one of them cannot reach a locked phone:

1. **Notices in Obsidian** — while Obsidian is open. Timed reminders speak a
   settable number of minutes ahead; everything else, and anything overdue, is
   raised once at a daily hour you choose.
2. **A calendar file** — `Reminders.ics`, written into your vault. Open it on
   your phone and Apple Calendar adds the reminders with their alarms, which
   fire whether or not Obsidian is running. **This is one way**: ticking a
   reminder off in Calendar does not tick it off in the vault. Re-exporting
   updates the events it made before rather than duplicating them.

## The line format

Obsidian Tasks' emoji vocabulary, used as-is:

| Token | Means |
|---|---|
| `📅 2026-09-20` | due |
| `⏰ 09:00` | a clock time (Nudge's one addition; Tasks reads it as description text) |
| `🔺 ⏫ 🔼 🔽 ⏬` | highest, high, medium, low, lowest |
| `🔁 every month` | repeat — `every day / week / month / year`, `every 3 days`, `every weekday`, `every monday`, any of them `when done` |
| `✅ 2026-09-21` | ticked on |
| `➕ 🛫 ⏳ 🆔 ⛔` | read, kept and written back untouched |

Anything Nudge doesn't drive the UI from still round-trips, so a reminder edited
here never comes back smaller than it went in.

## Building it

```bash
./build.sh            # bundle src/ into main.js, copy styles, run the guard suite
./scripts/deploy.sh   # install into the vault and prove the bytes match
npm run preview       # browser harness: python3 -m http.server 8822 → /_preview/preview.html
```

`main.js` and the root `styles.css` are **build output** — edit `src/` only. The
build targets `safari15`, the real engine floor on iOS, not `minAppVersion`.

## Licence

AGPL-3.0-only.
