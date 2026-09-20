import { describe, it, expect } from 'vitest'
import {
  NAV_BACK, NAV_FWD,
  localYMD, weekMondayDate, weekMondayISO, weekOffsetForDate,
  weekRangeLabel, weekRelative, tzLabel, timeLabel,
} from '@/lib/weekDates.js'
import { mondayOf } from '../../api/_lib/strategist.js'

// Week math for the /week board, extracted from YourWeek.jsx (2,387 lines,
// none of this reachable from a test before). It is a client/server mirror
// pair with mondayOf() in api/_lib/strategist.js, so the agreement is pinned
// below rather than left to a code comment.

const EN_DASH = '–' // weekRangeLabel joins with an en dash, not a hyphen

// Sun 13 Sep 2026, 10:30pm PDT — which is already Mon 14 Sep in UTC, and also
// already Mon 14 Sep in New York. The single instant that separates all three.
const SUN_LATE = new Date('2026-09-14T05:30:00Z')

describe('weekMondayDate / weekMondayISO — the local-midnight rollover', () => {
  it('does NOT roll to next week just because UTC has ticked over', () => {
    // The documented regression: using getUTCDay() on `new Date()` made a
    // Pacific workspace jump to next week from ~5pm Sunday local, hiding the
    // running week's posts and labelling the board a day early.
    expect(weekMondayISO(0, 'America/Los_Angeles', SUN_LATE)).toBe('2026-09-07')
    expect(weekMondayISO(0, 'America/Los_Angeles', SUN_LATE)).not.toBe('2026-09-14')
  })

  it('DOES roll for a zone where local time has actually reached Monday', () => {
    // Same instant, different workspace: New York is already Monday 1:30am, so
    // it is correctly in the new week. This is what makes the tz argument
    // load-bearing rather than decorative.
    expect(weekMondayISO(0, 'America/New_York', SUN_LATE)).toBe('2026-09-14')
  })

  it('steps by whole weeks in both directions', () => {
    expect(weekMondayISO(1, 'America/Los_Angeles', SUN_LATE)).toBe('2026-09-14')
    expect(weekMondayISO(-1, 'America/Los_Angeles', SUN_LATE)).toBe('2026-08-31')
    expect(weekMondayISO(4, 'America/Los_Angeles', SUN_LATE)).toBe('2026-10-05')
  })

  it('returns a Date at UTC midnight, so callers can read getUTC* off it', () => {
    const d = weekMondayDate(0, 'America/Los_Angeles', SUN_LATE)
    expect(d.getUTCHours()).toBe(0)
    expect(d.getUTCMinutes()).toBe(0)
    expect(d.getUTCSeconds()).toBe(0)
    expect(d.getUTCMilliseconds()).toBe(0)
    expect(d.getUTCDay()).toBe(1) // Monday
  })

  it('defaults to Pacific when tz is missing', () => {
    expect(weekMondayISO(0, null, SUN_LATE)).toBe(weekMondayISO(0, 'America/Los_Angeles', SUN_LATE))
    expect(weekMondayISO(0, undefined, SUN_LATE)).toBe('2026-09-07')
  })

  it('lands on a Monday from every day of the week', () => {
    for (let i = 0; i < 7; i++) {
      const at = new Date(Date.UTC(2026, 8, 7 + i, 19, 0, 0)) // noon PDT each day
      expect(weekMondayISO(0, 'America/Los_Angeles', at)).toBe('2026-09-07')
    }
  })
})

// TWO EQUIVALENT MUTANTS, found by mutation testing and left alone deliberately:
//
//  1. The UTC-noon anchor in weekMondayDate/weekOffsetForDate can be moved to
//     UTC-midnight with no observable change — every step after it is pure UTC
//     arithmetic and the result is normalised with setUTCHours(0,0,0,0) anyway.
//     It is kept because the SERVER's mondayOf() anchors at noon for the same
//     defensive reason, and keeping the two byte-comparable is the entire point
//     of the mirror. Do not "simplify" it on one side only.
//
//  2. Math.round vs Math.floor in weekOffsetForDate are equivalent here: the
//     target is anchored at noon and `thisMonday` at midnight, so the quotient
//     is always offset + 0.071, never near the .5 boundary. Math.ceil IS caught
//     by the round-trip test below, so the rounding itself is pinned.
//
// Neither is a weak test. Do not add assertions trying to kill them.

describe('MIRROR PAIR: client weekMondayDate vs server mondayOf', () => {
  // api/_lib/strategist.js mondayOf() is the server's copy of this rule. If
  // these drift, the board and the scheduler disagree about which week it is.
  const zones = ['America/Los_Angeles', 'America/New_York', 'America/Chicago', 'Pacific/Honolulu', 'UTC']

  it('agrees with the server for every zone at a UTC/local boundary instant', () => {
    for (const tz of zones) {
      expect(
        weekMondayDate(0, tz, SUN_LATE).toISOString().slice(0, 10),
        `zone ${tz}`,
      ).toBe(mondayOf(SUN_LATE, tz))
    }
  })

  it('agrees across a full week of instants', () => {
    for (let i = 0; i < 7; i++) {
      for (const hourUTC of [0, 6, 12, 18]) {
        const at = new Date(Date.UTC(2026, 8, 7 + i, hourUTC))
        for (const tz of zones) {
          expect(
            weekMondayDate(0, tz, at).toISOString().slice(0, 10),
            `${tz} @ ${at.toISOString()}`,
          ).toBe(mondayOf(at, tz))
        }
      }
    }
  })
})

describe('localYMD', () => {
  it('reports the workspace-local calendar date, not the UTC one', () => {
    expect(localYMD(SUN_LATE, 'America/Los_Angeles')).toEqual([2026, 9, 13])
    expect(localYMD(SUN_LATE, 'America/New_York')).toEqual([2026, 9, 14])
    expect(localYMD(SUN_LATE, 'UTC')).toEqual([2026, 9, 14])
  })
})

describe('weekOffsetForDate', () => {
  it('round-trips against weekMondayISO', () => {
    for (const offset of [-3, -1, 0, 1, 2, 4]) {
      const iso = weekMondayISO(offset, 'America/Los_Angeles', SUN_LATE)
      expect(weekOffsetForDate(iso, 'America/Los_Angeles', SUN_LATE)).toBe(offset)
    }
  })

  it('maps any day in a week to that week\'s offset, not just its Monday', () => {
    // Thu 24 Sep sits in the week of Mon 21 Sep = 2 weeks after Mon 7 Sep.
    expect(weekOffsetForDate('2026-09-24', 'America/Los_Angeles', SUN_LATE)).toBe(2)
    expect(weekOffsetForDate('2026-09-21', 'America/Los_Angeles', SUN_LATE)).toBe(2)
    expect(weekOffsetForDate('2026-09-27', 'America/Los_Angeles', SUN_LATE)).toBe(2)
  })

  it('returns a negative offset for a past date', () => {
    expect(weekOffsetForDate('2026-08-31', 'America/Los_Angeles', SUN_LATE)).toBe(-1)
  })
})

describe('weekRangeLabel', () => {
  it('omits the repeated month when the week does not straddle one', () => {
    expect(weekRangeLabel(0, 'America/Los_Angeles', SUN_LATE)).toBe(`Sep 7 ${EN_DASH} 13`)
  })

  it('repeats the month when the week straddles a month boundary', () => {
    expect(weekRangeLabel(3, 'America/Los_Angeles', SUN_LATE)).toBe(`Sep 28 ${EN_DASH} Oct 4`)
  })

  it('joins with an en dash, not a hyphen', () => {
    expect(weekRangeLabel(0, 'America/Los_Angeles', SUN_LATE)).toContain(EN_DASH)
    expect(weekRangeLabel(0, 'America/Los_Angeles', SUN_LATE)).not.toContain(' - ')
  })
})

describe('weekRelative', () => {
  it('names the three adjacent weeks', () => {
    expect(weekRelative(0)).toBe('This week')
    expect(weekRelative(1)).toBe('Next week')
    expect(weekRelative(-1)).toBe('Last week')
  })

  it('counts plural weeks in both directions', () => {
    expect(weekRelative(2)).toBe('In 2 weeks')
    expect(weekRelative(-2)).toBe('2 weeks ago')
    expect(weekRelative(NAV_FWD)).toBe(`In ${NAV_FWD} weeks`)
    expect(weekRelative(-NAV_BACK)).toBe(`${NAV_BACK} weeks ago`)
  })
})

describe('tzLabel', () => {
  it('uses the friendly label for a known zone', () => {
    expect(tzLabel('America/Los_Angeles')).toBe('Pacific time')
    expect(tzLabel('America/Phoenix')).toBe('Mountain time')
  })

  it('derives a readable fallback for an unknown zone', () => {
    expect(tzLabel('Europe/Paris')).toBe('Paris time')
    expect(tzLabel('America/Argentina/Buenos_Aires')).toBe('Buenos Aires time')
  })

  it('says "local time" when no zone is set', () => {
    expect(tzLabel(null)).toBe('local time')
    expect(tzLabel(undefined)).toBe('local time')
    expect(tzLabel('')).toBe('local time')
  })
})

describe('timeLabel', () => {
  it('formats in the workspace zone, not UTC', () => {
    expect(timeLabel('2026-09-14T00:30:00Z', 'America/Los_Angeles')).toBe('5:30 PM')
    expect(timeLabel('2026-09-14T00:30:00Z', 'America/New_York')).toBe('8:30 PM')
  })

  it('returns empty string for missing input', () => {
    expect(timeLabel(null, 'America/Los_Angeles')).toBe('')
    expect(timeLabel('', 'America/Los_Angeles')).toBe('')
    expect(timeLabel(undefined, 'America/Los_Angeles')).toBe('')
  })

  // KNOWN QUIRK, pinned rather than fixed (this PR is an extraction, not a
  // behaviour change): the try/catch only catches a bad *timezone*, because
  // toLocaleTimeString on an Invalid Date RETURNS the string 'Invalid Date'
  // instead of throwing. So an unparseable scheduled_at renders the literal
  // text "Invalid Date" in the /week board rather than an empty cell.
  it('renders the literal "Invalid Date" for an unparseable date string', () => {
    expect(timeLabel('not-a-date', 'America/Los_Angeles')).toBe('Invalid Date')
  })

  it('does not throw on a bad timezone', () => {
    expect(timeLabel('2026-09-14T00:30:00Z', 'Not/AZone')).toBe('')
  })
})

describe('navigation bounds', () => {
  it('are the values the server also enforces', () => {
    expect(NAV_BACK).toBe(8)
    expect(NAV_FWD).toBe(4)
  })
})
