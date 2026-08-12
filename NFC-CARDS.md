# Writing a Patient Tap Card

How to turn a visit into a card the patient taps to her phone, using **Card Studio**
and the orange **NFC Tools** app (by wakdev).

Two apps, five minutes, one tag. Nothing is stored on a server — the whole
protocol travels in the link.

---

## 1. Build the URL in Card Studio

Open **https://ca-tap.netlify.app/studio.html** on your laptop or iPad.

1. **Patient** — type her first name as it should appear on the card. This is the
   name the portal greets her with ("Welcome Back, JESSICA"). First name only
   keeps the link short and keeps a full name off a tag that could be lost.
2. **Protocol** — start typing a peptide (Glow, Wolverine, Tirzepatide, NAD,
   2x, BPC…) and pick it from the list. Add as many as she was dispensed.
3. **Phases** — adjust the units and days if you deviated from the template.
   The milligram column recalculates as you type, so you can dose by mg and
   read off the dial number.
4. **The card** — the URL appears at the bottom, with two numbers under it:

   ```
   38 chars · 38 bytes on tag       fits Ultralight 64B
   ```

   **The bytes number is the one that matters.** See the tag table below.
5. **Copy URL.** Mail or AirDrop it to the phone you write tags from.

### What the URL looks like

```
https://ca-tap.netlify.app/#Jessica~glo~2x
                            │       │   └── second pen (2x Blend)
                            │       └────── first pen (Glow Blend)
                            └────────────── patient name
```

A pen with custom dosing carries its titration after a colon — units-days,
phases separated by dots:

```
https://ca-tap.netlify.app/#Christie~glo~nad:30-28
                                          └── NAD+, 30 units, 28 days
```

Everything after the `#` is a **fragment**. Browsers never send it to a server,
so the protocol is never transmitted, never logged, and never stored anywhere
but the tag itself and her phone.

---

## 2. Pick the right tag

The URL is stored without the `https://` (that is one byte in NDEF), plus about
eight bytes of record overhead. Card Studio already does this arithmetic for you.

| Tag | Total memory | Usable for a URL | Good for |
|---|---|---|---|
| MIFARE Ultralight | 64 B | **~40 characters** | one name + two pens, no custom dosing |
| NTAG213 | 144 B | ~130 characters | anything routine |
| NTAG215 | 504 B | ~490 characters | long protocols, custom titrations |
| NTAG216 | 888 B | ~870 characters | never needed here |

**Buy NTAG215.** They cost pennies more and remove the whole category of
"it won't fit". The Ultralight cards are the cheap white ones that ship with
most starter packs — usable, but you will hit the ceiling the first time a
patient has three pens.

To find out what you're holding: **NFC Tools → READ → hold the tag to the
phone.** It reports the tag type, total memory, and how much is writable.

---

## 3. Write the tag

On the phone, in **NFC Tools** (orange icon):

1. **WRITE** tab → **Add a record**.
2. Choose **URL / URI**.
3. In the prefix dropdown pick **`https://`**, then type the rest of the link
   *without* the scheme:

   ```
   ca-tap.netlify.app/#Jessica~glo~2x
   ```

   Picking the prefix from the list stores it as a single byte. Typing
   `https://` out in full costs seven more bytes — enough to overflow an
   Ultralight.
4. Tap **OK**. The record is added and the button now reads
   **Write / 38 Bytes** or similar. **Check that number against the tag's
   capacity** before you write.
5. Tap **Write**, then hold the tag flat against the phone.
   - **iPhone:** the antenna is at the *top edge*, behind the camera bar.
     Hold the tag against the top third of the back of the phone.
   - **Android:** the antenna is usually in the *middle* of the back.
6. Wait for **"Write complete"**. Don't move the tag until it appears.

### Watch the fragment

Some keyboards autocapitalise after `/`. The name is case-sensitive in the sense
that it is displayed exactly as typed — `#jessica` greets her as "JESSICA" in
small caps either way, but `#Jessica` is what Card Studio produces. Copy-paste
rather than retype whenever you can. The `~` characters must survive: on iOS
they're on the `123` → `#+=` keyboard.

---

## 4. Verify before you lock

**Always tap the finished card with your own phone first.**

The portal should open to the ivory screen with her name. Open **Today's Ritual**
and confirm the dial number matches what you dispensed.

If it opens to a "Page not found", the URL was mistyped — rewrite it. If it opens
to the portal but greets the wrong name, you wrote an older card.

### Then lock it (optional but recommended)

**NFC Tools → OTHER → Set tag as read-only** (or *Lock tag*), hold the tag.

This is **permanent and irreversible**. A locked tag can never be rewritten —
if her dose changes you will need a new card. Lock cards you hand out; leave
your own test tags unlocked.

**If a dose changes between visits, generate a new URL and write a new tag.**
There is no way to update a card remotely — the protocol lives on the tag.

---

## 5. What the patient sees

She taps the card to the back of her phone. No app, no login, no account. Safari
(or Chrome) opens the portal.

**Most peptides** land straight on Today's Ritual: what to turn the pen to,
the steps in order, what it delivers in milligrams, and how much is left in
the pen.

**On her first open**, the portal asks which day she actually started, so the
whole schedule counts from her, not from the date in the chart.

**Tirzepatide** asks three more questions before it draws anything, one per
screen:

1. **Which vial do you have?** — 1 mL or 2 mL. This changes only how long the
   vial lasts, never her dose.
2. **Which are you starting with?**
   - *It's my first time — follow the guide* → the printed titration:
     17 units for two weeks, 19, 22, 25, 27, then 30 from week ten.
   - *I'm an established patient* → she types her own number of units.
     **Anything above 50 is refused**, at the field and again at Continue.
3. **Which day do you inject?** — one weekday. Her whole calendar counts from it,
   and **Add to Calendar** puts the reminder at **9:00 a.m.** on that day
   every week.

Her answers are stored on her own phone, next to her start day. They never
leave the device.

### The plus sign

Top right of Today's Ritual. If you dispense something between visits and
haven't re-written her tag, she can add it herself from the same template list
Card Studio uses. It counts from the day she adds it, and it lives on her
phone only — her card is unchanged.

---

## Troubleshooting

**"This tag is too small" / the byte count exceeds the tag.**
Card Studio's byte counter told you this before you left the desk. Options, in
order: use an NTAG215; drop the patient's surname; drop custom titrations and
let the template defaults stand.

**The tag won't take a write — "Tag is read-only".**
It was locked, by you or at the factory. Locking cannot be undone. Use a new tag.

**Nothing happens when the patient taps.**
- iPhone 7 and later read NFC tags with the screen on and unlocked. Older
  iPhones cannot.
- On an iPhone the antenna is at the top edge — a tag held against the middle
  of the phone often does nothing.
- A case thicker than about 3 mm, or one with a metal plate or magnet ring,
  will block the read.
- Two tags in the same wallet interfere. One card per sleeve.

**It opens the portal but Today's Ritual is empty.**
The pen short code on the tag isn't in `templates.json`. That happens if a
card was written by hand rather than from Card Studio. Rebuild it in Studio.

**The patient changed phones.**
Her start day, her tirzepatide answers and anything she added herself live in
the old phone's browser storage and do not travel. She taps the card on the new
phone and answers the questions again. Her card still works.

**The link leaked.**
The URL is unlisted but guessable, and anyone holding it sees a first name and
a dosing schedule. That is the trade for a portal with no login. Don't put a
surname, a date of birth, or a chart number on a card.

---

## What is not on the tag

No account. No password. No server-side patient record. The tag holds a name and
a set of dial numbers, and the phone that reads it holds her start day. Netlify
has not signed a BAA, so nothing that would count as a clinical record is ever
sent to it — injection logging is off, and everything the patient enters stays
in her own browser.
