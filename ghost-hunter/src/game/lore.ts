import type { Note, RelicKind, Spot } from "../types";

/**
 * The six notes scattered round Hollow Creek High. Their relic hints are
 * written from the spots chosen for this run, so they are always right.
 */

export interface LoreNote extends Note {
  /** The relic this note points towards, if any. */
  hint: RelicKind | null;
}

export const RELIC_NAME: Record<RelicKind, string> = {
  crown: "rhinestone tiara",
  keys: "ring of keys",
  register: "attendance register",
};

/** Short names for the HUD tally and map markers. */
export const RELIC_SHORT: Record<RelicKind, string> = {
  crown: "Tiara",
  keys: "Keys",
  register: "Register",
};

/** "on the gym stage", "in the boiler room": a spot label with the right preposition. */
export function where(s: Spot) {
  const l = s.label;
  if (/stage|bleachers/.test(l)) return "on " + l;
  return "in " + l;
}

export const cap = (t: string) => t.charAt(0).toUpperCase() + t.slice(1);

export function buildNotes(spot: Record<RelicKind, Spot>): LoreNote[] {
  const crown = where(spot.crown),
    keys = where(spot.keys),
    reg = where(spot.register);
  return [
    {
      id: "memo",
      hint: "crown",
      title: "Prom Committee Memo",
      body:
        "TO: All committee members\nFROM: Mrs Okafor, Head of Year\nDATE: Thursday 14 May 1987\n\n" +
        "Final arrangements for Saturday. Doors open at seven, the buffet closes at ten and the coronation is at a quarter to midnight. Balloons and streamers go up on Friday after the last bell.\n\n" +
        `The Prom Queen's tiara came back from the jeweller this morning. It is real rhinestone, not plastic, so it is NOT to be passed round. Until the coronation it will be kept safely ${crown}.\n\n` +
        "Jenny Hale has asked for the last slow dance. Please make sure the DJ knows.",
    },
    {
      id: "janitor",
      hint: "keys",
      title: "Caretaker's Work Log",
      body:
        "Mon 11 May. Boiler pressure low again. Bled the radiators in the science block.\n\n" +
        "Tue 12 May. Someone wrote on the lockers in the north corridor. Scrubbed it off. It was back by morning.\n\n" +
        "Thu 14 May. Mr Hale wants every door locked at midnight on Saturday, prom or no prom. His orders, his school.\n\n" +
        `Sat 16 May. Lost my ring of keys. Every key in the building is on it. Last time I had them I was ${keys}. If anyone finds them, do NOT give them to Mr Hale.\n\n` +
        "Sat 16 May, 11:40. I can hear her singing in the walls.",
    },
    {
      id: "register",
      hint: "register",
      title: "Torn Register Page",
      body:
        "FORM 5H, SUMMER TERM 1987\n\n" +
        "Adams, P. Present.\nBaker, R. Present.\nDoyle, K. Absent.\nHale, J. Present.\n\n" +
        "Her name has been crossed out, then written in again underneath in red ink, over and over: PRESENT. PRESENT. PRESENT.\n\n" +
        "Pinned to the back, in the headmaster's tidy hand:\n" +
        `\"Nobody leaves until the register is complete. The register stays ${reg}, where I can keep an eye on it. A. Hale.\"`,
    },
    {
      id: "detention",
      hint: "keys",
      title: "Detention Slip",
      body:
        "HOLLOW CREEK HIGH SCHOOL\nDETENTION\n\n" +
        "Pupil: Daniel Price, 5H\nIssued by: Mr Doyle, Caretaker\n" +
        `Offence: Found ${keys} after hours, trying to pinch the master keys for a prom prank.\n` +
        "Time: Saturday 16 May, 11:30 pm until further notice.\n\n" +
        "Scrawled underneath in biro:\n" +
        `\"Doyle never let go of those keys. Not even after. When the lights went out I could still hear them jingling ${keys}. Do not go down there alone.\"`,
    },
    {
      id: "gazette",
      hint: "crown",
      title: "Hollow Creek Gazette, 19 May 1987",
      body:
        "PROM QUEEN STILL MISSING\n\n" +
        "Police have widened the search for Jennifer Hale, 17, who vanished from her school prom on Saturday night. Pupils say the lights failed at 11:47, moments before she was due to be crowned.\n\n" +
        "Her father, headmaster Arthur Hale, has not been seen since. The school caretaker, Michael Doyle, could not explain how every door came to be locked from the inside.\n\n" +
        `The school will stay closed. Her tiara was never recovered, although one pupil swears she saw it glinting ${crown}.`,
    },
    {
      id: "jenny",
      hint: "register",
      title: "A Note from Jenny",
      body:
        "Dear whoever finds this,\n\n" +
        `Dad says I'm not allowed to leave until he has ticked my name in his precious register. He keeps it ${reg} and checks it every hour, like I'm still eight.\n\n` +
        "Tonight I'm going to dance, and then I'm going to walk out of those doors and never come back. Danny says he'll wait for me in the car park.\n\n" +
        "If something happens, it was the clocks. Every clock in this school is wrong. They all say 11:47.\n\nJenny x",
    },
  ];
}
