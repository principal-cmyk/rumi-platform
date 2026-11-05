'use strict';
/**
 * The stills are read against a fixed checklist and the counts are made by code, so a pattern across the lesson (how
 * often hands went up, whether the teacher left the front) is arithmetic, not a model's impression. "Unclear" is a
 * real answer: a camera that cannot see the teacher must not read as a teacher who never moved.
 */
const {
  parseFrameObservation, summarise, evidenceText, chatSummary,
} = require('../../../bot/shared/services/coaching/video-observation');

const frame = (atSeconds, students = {}, teacher = {}) => ({
  atSeconds,
  students: { order: 'calm', hands_raised: 'none', off_task: 'none', activity: 'listening', note: '', ...students },
  teacher: { position: 'front', interaction: 'whole_class', leaning_in: 'no', note: '', ...teacher },
});

describe('parseFrameObservation', () => {
  const valid = JSON.stringify({
    classroom_visible: true,
    students: { order: 'calm', hands_raised: 'few', off_task: 'none', activity: 'writing', note: 'Pupils writing.' },
    teacher: { position: 'among_students', interaction: 'one_student', leaning_in: 'yes', note: 'Bending over a desk.' },
  });

  test('reads a checklist answer', () => {
    expect(parseFrameObservation(valid, 60)).toMatchObject({
      atSeconds: 60,
      students: { hands_raised: 'few' },
      teacher: { position: 'among_students', leaning_in: 'yes' },
    });
  });

  test('copes with a fenced reply', () => {
    expect(parseFrameObservation('```json\n' + valid + '\n```', 60)).not.toBeNull();
  });

  test('a frame with no classroom is not evidence', () => {
    expect(parseFrameObservation(JSON.stringify({ classroom_visible: false }), 60)).toBeNull();
  });

  test('prose or broken JSON is not evidence', () => {
    expect(parseFrameObservation('Students are in rows.', 60)).toBeNull();
  });

  test('an off-task claim must say what was seen, or it is discarded: a false accusation is the worst error here', () => {
    const answer = (note) => JSON.stringify({
      classroom_visible: true, students: { order: 'calm', hands_raised: 'none', off_task: 'few', note }, teacher: {},
    });
    expect(parseFrameObservation(answer(''), 60).students.off_task).toBe('unclear');
    expect(parseFrameObservation(answer('Two pupils playing with a ball at the back.'), 60).students.off_task).toBe('few');
  });

  test.each([
    ['A few students are looking away or not facing forward.'],
    ['Some pupils appear distracted.'],
    ['Two students glancing sideways.'],
    ['Some seem inattentive.'],
  ])('where someone is looking is not evidence of being off task: %s', (studentNote) => {
    const reply = JSON.stringify({
      classroom_visible: true, students: { order: 'calm', hands_raised: 'none', off_task: 'few', note: studentNote }, teacher: {},
    });
    expect(parseFrameObservation(reply, 60).students.off_task).toBe('unclear');
  });

  test('a real action still counts when the note also mentions looking', () => {
    const reply = JSON.stringify({
      classroom_visible: true,
      students: { order: 'calm', hands_raised: 'none', off_task: 'few', note: 'Two pupils looking down, playing a game on a phone.' },
      teacher: {},
    });
    expect(parseFrameObservation(reply, 60).students.off_task).toBe('few');
  });

  test('a value outside the checklist becomes unclear rather than being trusted', () => {
    const reply = JSON.stringify({ classroom_visible: true, students: { order: 'excellent', hands_raised: 12 }, teacher: {} });
    const parsed = parseFrameObservation(reply, 60);
    expect(parsed.students.order).toBe('unclear');
    expect(parsed.students.hands_raised).toBe('unclear');
    expect(parsed.teacher.position).toBe('not_visible');
  });
});

describe('summarise', () => {
  test('counts student behaviour across the lesson', () => {
    const s = summarise([
      frame(30, { hands_raised: 'few' }),
      frame(60, { hands_raised: 'many', off_task: 'few' }),
      frame(90, { order: 'some_noise', off_task: 'many' }),
    ], 3);
    expect(s.readable).toBe(3);
    expect(s.order).toMatchObject({ calm: 2, some_noise: 1 });
    expect(s.handsSeen).toBe(2);
    expect(s.offTaskSeen).toBe(2);
  });

  test('circulation is movement between areas, across frames where the teacher was visible', () => {
    const s = summarise([
      frame(30),
      frame(60, {}, { position: 'among_students' }),
      frame(90, {}, { position: 'not_visible' }),
      frame(120, {}, { position: 'among_students' }),
      frame(150),
    ], 5);
    expect(s.teacherSeen).toBe(4);
    expect(s.position.among_students).toBe(2);
    expect(s.moves).toBe(2);
  });

  test('unclear never counts as nothing happening', () => {
    const s = summarise([frame(30, { hands_raised: 'unclear', off_task: 'unclear' })], 1);
    expect(s.handsJudged).toBe(0);
    expect(s.offTaskJudged).toBe(0);
  });

  test('close work counts one-to-one and group conversations and leaning in', () => {
    const s = summarise([
      frame(30, {}, { interaction: 'one_student', leaning_in: 'yes' }),
      frame(60, {}, { interaction: 'small_group' }),
      frame(90),
    ], 3);
    expect(s.closeWork).toBe(2);
    expect(s.leaningIn).toBe(1);
  });
});

describe('evidenceText', () => {
  test('gives the scorer the counts and the timeline', () => {
    const text = evidenceText([frame(90, { hands_raised: 'few', note: 'Two hands up.' })], 2);
    expect(text).toContain('1 readable stills');
    expect(text).toMatch(/1 could not be read/);
    expect(text).toContain('[01:30]');
    expect(text).toContain('Two hands up.');
  });

  test('says so when the teacher was out of shot, rather than implying they stood still', () => {
    expect(evidenceText([frame(30, {}, { position: 'not_visible' })], 1)).toMatch(/teacher was not visible/i);
  });

  test('no readable stills means no evidence', () => {
    expect(evidenceText([], 6)).toBeNull();
  });
});

describe('chatSummary', () => {
  test('tells the teacher what was seen, as sampled moments and not a verdict', () => {
    const text = chatSummary(summarise([
      frame(30, { hands_raised: 'few' }),
      frame(60, {}, { position: 'among_students' }),
    ], 2));
    expect(text).toMatch(/2 moments/);
    expect(text).toMatch(/hands/i);
    expect(text).toMatch(/among the students/i);
  });

  test('stays quiet when nothing could be read', () => {
    expect(chatSummary(summarise([], 6))).toBeNull();
  });

  test('does not comment on teacher movement the camera could not see', () => {
    const text = chatSummary(summarise([frame(30, {}, { position: 'not_visible' })], 1));
    expect(text).toMatch(/could not see the teacher/i);
    expect(text).not.toMatch(/stayed/i);
  });
});
