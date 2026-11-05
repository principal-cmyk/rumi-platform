/**
 * What a lesson video shows, read as a checklist.
 *
 * One still cannot show a teacher circulating or how often hands go up: those are patterns across a lesson. So each
 * still is read against the same fixed questions, and this file does the counting. The numbers the scorer and the
 * teacher see are arithmetic over those answers, not a model's overall impression.
 *
 * "Unclear" is a real answer everywhere. A phone at the back of a room often cannot see faces, hands or the teacher,
 * and a camera that cannot see something must never read as that thing not happening. Anything outside the checklist
 * becomes unclear rather than being trusted, and a still with no classroom in it is not evidence at all.
 */
const ORDER = ['calm', 'some_noise', 'disorderly', 'unclear'];
const LEVEL = ['none', 'few', 'many', 'unclear'];
const POSITION = ['front', 'among_students', 'back', 'at_desk', 'not_visible'];
const INTERACTION = ['whole_class', 'one_student', 'small_group', 'none', 'unclear'];
const YES_NO = ['yes', 'no', 'unclear'];
const MAX_NOTE_CHARS = 160;

// In a still, where someone is looking says little: they may be watching a teacher out of frame. An off-task claim
// has to rest on something being done. Tried in a prompt rule first, and the model still wrote "looking away".
const LOOKING_ONLY = /\b(look(ing|s)?|facing|glanc\w*|distract\w*|inattentive|not paying|gaz\w*|star(ing|es))\b/i;
const VISIBLE_ACTION = /\b(play\w*|sleep\w*|asleep|head down|heads down|wander\w*|walking|chat\w*|talking|phone|game|fight\w*|throw\w*|eating)\b/i;

const FRAME_SYSTEM_PROMPT = 'You record what is visible in images for a classroom observation. You never guess, assume '
  + 'or invent details, and you do not praise or judge.';

const FRAME_PROMPT = `This is one still from a phone video. It may or may not show a classroom, so do not assume it does.

Reply with JSON only, in exactly this shape:
{
  "classroom_visible": true or false,
  "students": {
    "order": ${ORDER.map((v) => `"${v}"`).join(' | ')},
    "hands_raised": ${LEVEL.map((v) => `"${v}"`).join(' | ')},
    "off_task": ${LEVEL.map((v) => `"${v}"`).join(' | ')},
    "activity": "<a few words: what most students are doing>",
    "note": "<one short factual sentence, or empty>"
  },
  "teacher": {
    "position": ${POSITION.map((v) => `"${v}"`).join(' | ')},
    "interaction": ${INTERACTION.map((v) => `"${v}"`).join(' | ')},
    "leaning_in": ${YES_NO.map((v) => `"${v}"`).join(' | ')},
    "note": "<one short factual sentence, or empty>"
  }
}

Rules:
- classroom_visible is false unless you can clearly see a real classroom with people or learning materials. If the image is dark, blurred, blocked, a screen, a test pattern or anything else, set it to false.
- Use "unclear" whenever you cannot see well enough to be sure. Never guess. Hands and faces at the back of a room are often unclear.
- order: "calm" means students are seated or working in an orderly way. "disorderly" means many are out of place or the room is visibly chaotic.
- off_task means students clearly doing something other than the lesson: playing with something, sleeping or head down, wandering, or chatting with their backs to the lesson. Students looking sideways or behind them are probably watching a teacher or speaker out of frame, so that is NOT off task. Glancing away, fidgeting or smiling is NOT off task. If you are not certain, answer "none" when most students seem attentive and "unclear" otherwise.
- If off_task is "few" or "many", the students note must say exactly what those students are visibly doing.
- position is where the teacher is standing: "among_students" means between the desks, "at_desk" means at the teacher's own desk, "not_visible" means the teacher is not in the picture.
- interaction is who the teacher is attending to right now. leaning_in means bending or crouching toward a student or group.
- Describe only what is visible in this one still. Do not guess at anything out of frame, do not describe what people might be thinking, and do not identify anyone.`;

function oneOf(value, allowed, fallback) {
  return allowed.includes(value) ? value : fallback;
}

function note(value) {
  return typeof value === 'string' ? value.trim().slice(0, MAX_NOTE_CHARS) : '';
}

/** @returns {object|null} a checklist reading, or null when the still gives no evidence */
function parseFrameObservation(reply, atSeconds) {
  let parsed;
  try {
    parsed = JSON.parse(String(reply).replace(/^\s*```(?:json)?\s*|\s*```\s*$/g, ''));
  } catch {
    return null;
  }
  if (!parsed || parsed.classroom_visible !== true) return null;
  const students = parsed.students || {};
  const teacher = parsed.teacher || {};
  // Calling students off task is the claim most likely to be unfair, so it must come with what was actually seen.
  const offTask = oneOf(students.off_task, LEVEL, 'unclear');
  const claim = note(students.note);
  const unsupported = (offTask === 'few' || offTask === 'many')
    && (!claim || (LOOKING_ONLY.test(claim) && !VISIBLE_ACTION.test(claim)));
  return {
    atSeconds,
    students: {
      order: oneOf(students.order, ORDER, 'unclear'),
      hands_raised: oneOf(students.hands_raised, LEVEL, 'unclear'),
      off_task: unsupported ? 'unclear' : offTask,
      activity: note(students.activity),
      note: note(students.note),
    },
    teacher: {
      position: oneOf(teacher.position, POSITION, 'not_visible'),
      interaction: oneOf(teacher.interaction, INTERACTION, 'unclear'),
      leaning_in: oneOf(teacher.leaning_in, YES_NO, 'unclear'),
      note: note(teacher.note),
    },
  };
}

function tally(values) {
  return values.reduce((counts, value) => ({ ...counts, [value]: (counts[value] || 0) + 1 }), {});
}

function summarise(observations, total) {
  const students = observations.map((o) => o.students);
  const seen = observations.map((o) => o.teacher).filter((t) => t.position !== 'not_visible');
  const handsJudged = students.filter((s) => s.hands_raised !== 'unclear');
  const offTaskJudged = students.filter((s) => s.off_task !== 'unclear');
  const positions = seen.map((t) => t.position);
  return {
    total,
    readable: observations.length,
    order: tally(students.map((s) => s.order).filter((o) => o !== 'unclear')),
    handsJudged: handsJudged.length,
    handsSeen: handsJudged.filter((s) => s.hands_raised !== 'none').length,
    offTaskJudged: offTaskJudged.length,
    offTaskSeen: offTaskJudged.filter((s) => s.off_task !== 'none').length,
    teacherSeen: seen.length,
    position: tally(positions),
    moves: positions.filter((position, i) => i > 0 && position !== positions[i - 1]).length,
    closeWork: seen.filter((t) => t.interaction === 'one_student' || t.interaction === 'small_group').length,
    leaningIn: seen.filter((t) => t.leaning_in === 'yes').length,
  };
}

function clock(totalSeconds) {
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = Math.round(totalSeconds % 60);
  return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
}

const ORDER_WORDS = { calm: 'calm', some_noise: 'some noise', disorderly: 'disorderly' };
const POSITION_WORDS = {
  front: 'at the front', among_students: 'among the students', back: 'at the back', at_desk: 'at the teacher\'s desk',
};

function describeCounts(counts, words) {
  return Object.entries(counts).map(([key, n]) => `${words[key]} in ${n}`).join(', ');
}

function timelineLine(o) {
  const parts = [
    `order ${o.students.order}`, `hands ${o.students.hands_raised}`, `off task ${o.students.off_task}`,
    `teacher ${o.teacher.position}, attending to ${o.teacher.interaction}, leaning in ${o.teacher.leaning_in}`,
  ];
  const notes = [o.students.activity, o.students.note, o.teacher.note].filter(Boolean).join(' ');
  return `[${clock(o.atSeconds)}] ${parts.join('; ')}.${notes ? ` ${notes}` : ''}`;
}

/** What the scorer reads: the counts, then the timeline, so stills can be lined up with the transcript's timestamps. */
function evidenceText(observations, total) {
  if (observations.length === 0) return null;
  const s = summarise(observations, total);
  const unread = total - s.readable;
  const lines = [
    `Counts from ${s.readable} readable stills${unread > 0 ? ` (${unread} could not be read)` : ''}:`,
    `- Order: ${describeCounts(s.order, ORDER_WORDS) || 'unclear'}.`,
    s.handsJudged > 0 ? `- Hands raised: seen in ${s.handsSeen} of ${s.handsJudged}.` : '- Hands raised: unclear.',
    s.offTaskJudged > 0 ? `- Students off task: seen in ${s.offTaskSeen} of ${s.offTaskJudged}.` : '- Students off task: unclear.',
    s.teacherSeen > 0
      ? `- Teacher position, in ${s.teacherSeen} stills where visible: ${describeCounts(s.position, POSITION_WORDS)}. Moved between areas ${s.moves} times. Attending to one student or a small group in ${s.closeWork}, leaning in during ${s.leaningIn}.`
      : '- The teacher was not visible, so nothing can be said about circulation or proximity.',
    'Timeline:',
    ...observations.map(timelineLine),
  ];
  return lines.join('\n');
}

/** The teacher's own view of what was seen: observations from sampled moments, never a verdict. */
function chatSummary(stats) {
  if (!stats || stats.readable === 0) return null;
  const lines = [
    '🎥 *What I noticed in your video*',
    `I looked at ${stats.readable} moments across the lesson. These are snapshots, so I may have missed things.`,
  ];
  const order = describeCounts(stats.order, ORDER_WORDS);
  if (order) lines.push(`• Order: ${order}.`);
  if (stats.handsJudged > 0) lines.push(`• Hands raised: seen in ${stats.handsSeen} of ${stats.handsJudged} moments.`);
  if (stats.offTaskJudged > 0) lines.push(`• Students off task: seen in ${stats.offTaskSeen} of ${stats.offTaskJudged} moments.`);
  if (stats.teacherSeen > 0) {
    lines.push(`• Where you were, in ${stats.teacherSeen} moments I could see you: ${describeCounts(stats.position, POSITION_WORDS)}.`);
    lines.push(`• You moved between areas ${stats.moves} times and were working closely with a student or group in ${stats.closeWork} moments.`);
  } else {
    lines.push('• I could not see the teacher in these moments, so I cannot comment on movement around the room.');
  }
  return lines.join('\n');
}

module.exports = {
  FRAME_PROMPT, FRAME_SYSTEM_PROMPT, parseFrameObservation, summarise, evidenceText, chatSummary,
};
