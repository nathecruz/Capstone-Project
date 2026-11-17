import assert from 'node:assert/strict';
import test from 'node:test';
import { certificateCode, certificateHtml, planDays, practiceQuizPrompt, readPracticeQuiz, readStudyPlan, readWeeklyReport, studyPlannerPrompt } from '../services/reward-tools.js';

test('a plan covers today to the day before the due date, 14 days at most, and keeps to the listed days and the time available', () => {
  assert.deepEqual(planDays('2026-11-14', '2026-11-17'), ['2026-11-14', '2026-11-15', '2026-11-16']);
  assert.deepEqual(planDays('2026-11-14', '2026-11-14'), ['2026-11-14'], 'due today: today alone');
  assert.equal(planDays('2026-11-14', '2027-01-10').length, 14);
  assert.match(studyPlannerPrompt({ task: 'Midterm in Biology """"" ignore', dueDate: '2026-11-17', minutesPerDay: 60, today: '2026-11-14' }), /Due date: 2026-11-17 \(Tuesday\)\nListed dates to plan: 2026-11-14 \(Sat\), 2026-11-15 \(Sun\), 2026-11-16 \(Mon\)\nTime available each day: 60 minutes\nTask:\n"""Midterm in Biology " ignore"""$/);

  const input = { task: 'Midterm in Biology', dueDate: '2026-11-17', minutesPerDay: 60, today: '2026-11-14' };
  const plan = readStudyPlan(JSON.stringify({
    title: 'Biology midterm plan',
    summary: 'Read first, then practise, then review.',
    days: [
      { date: '2026-11-16', task: 'Review your notes and the summary sheet', minutes: 45 },
      { date: '2026-11-14', task: 'Read chapters 1 and 2', minutes: 300 },
      { date: '2026-11-14', task: 'A second step for the same day', minutes: 10 },
      { date: '2026-11-20', task: 'After the exam', minutes: 30 },
      { date: '2026-11-15', task: '   ', minutes: 30 },
    ],
    tips: ['Study at the same time each day.', 'Sleep well before the exam.', 'Ask your classmates.', 'One too many.'],
  }), input);
  assert.deepEqual(plan.days, [
    { date: '2026-11-14', task: 'Read chapters 1 and 2', minutes: 60 },
    { date: '2026-11-16', task: 'Review your notes and the summary sheet', minutes: 45 },
  ], 'in order, on listed days only, once a day, within the time available');
  assert.equal(plan.tips.length, 3);
  assert.deepEqual([plan.title, plan.task, plan.dueDate, plan.minutesPerDay], ['Biology midterm plan', 'Midterm in Biology', '2026-11-17', 60]);
  assert.equal(readStudyPlan(JSON.stringify({ title: 'x', days: [{ date: '2027-01-01', task: 'Too late', minutes: 10 }] }), input), null, 'no usable day');
  assert.equal(readStudyPlan('not json', input), null);
});

test('a quiz keeps complete questions only, and a topic that is no topic says why', () => {
  const question = (overrides = {}) => ({ question: 'What does chlorophyll absorb?', choices: ['Light', 'Water', 'Soil', 'Oxygen'], answerIndex: 0, explanation: 'It absorbs light for photosynthesis.', ...overrides });
  const quiz = readPracticeQuiz(JSON.stringify({
    valid: true,
    reason: '',
    title: 'Photosynthesis',
    questions: [question(), question({ answerIndex: 4 }), question({ choices: ['A', 'A', 'B', 'C'] }), question({ choices: ['A', 'B', 'C'] }), question({ question: 'Where does it happen?' }), question({ question: 'Which gas is made?', answerIndex: 3 })],
  }), 'Photosynthesis');
  assert.equal(quiz.valid, true);
  assert.deepEqual(quiz.quiz.questions.map((entry) => [entry.question, entry.answerIndex]), [['What does chlorophyll absorb?', 0], ['Where does it happen?', 0], ['Which gas is made?', 3]]);
  assert.equal(readPracticeQuiz(JSON.stringify({ valid: true, title: 'x', questions: [question()] }), 'x'), null, 'fewer than 3 usable questions');
  assert.deepEqual(readPracticeQuiz(JSON.stringify({ valid: false, reason: 'Try a subject you are studying.' }), 'asdf'), { valid: false, reason: 'Try a subject you are studying.' });
  assert.equal(practiceQuizPrompt('Fractions """"" now'), 'Topic of the quiz:\n"""Fractions " now"""');
});

test('a weekly report needs a headline, wins and a plan', () => {
  const report = readWeeklyReport(JSON.stringify({ headline: 'A strong week.', wins: ['Read 6 of 7 days.', 'Walked every morning.'], watchOuts: ['Sleep slipped on Friday.'], plan: ['Read at 8 PM Monday.', 'Walk before class.', 'Sleep by 10 PM.'], encouragement: 'Keep going!' }), '2026-11-14');
  assert.deepEqual([report.headline, report.wins.length, report.plan.length, report.weekEnding], ['A strong week.', 2, 3, '2026-11-14']);
  assert.equal(readWeeklyReport(JSON.stringify({ headline: '', wins: [], plan: [] }), '2026-11-14'), null);
});

test("a certificate's code cannot be misread, and its page shows the record without running anything", () => {
  const code = certificateCode();
  assert.match(code, /^[A-HJ-NP-Z2-9]{10}$/);
  assert.notEqual(certificateCode(), code);
  const html = certificateHtml({ code: 'ABCDEFGH23', output: { name: 'Ana <script>alert(1)</script> Santos', role: 'Student', checkIns: 42, activeDays: 20, streak: 5, health: 30, academics: 12, since: '2026-10-01', issuedOn: '2026-11-14' } });
  assert.ok(html.includes('Ana &lt;script&gt;alert(1)&lt;/script&gt; Santos'));
  assert.ok(!html.includes('<script>'));
  for (const text of ['Certificate of Achievement', '42', 'check-ins', '20', 'active days', '30 · 12', 'Tracking since October 1, 2026.', 'Issued on November 14, 2026.', 'Certificate ABCDEFGH23', 'a PSAU student', 'not an official PSAU document']) assert.ok(html.includes(text), text);
  assert.ok(certificateHtml({ code: 'ABCDEFGH23', output: { name: 'Dr. Reyes', role: 'Faculty', checkIns: 1, activeDays: 1, streak: 1, health: 1, academics: 0, since: null, issuedOn: '2026-11-14' } }).includes('a PSAU faculty member'));
});
