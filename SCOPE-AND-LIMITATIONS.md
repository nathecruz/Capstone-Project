# HabitAI: Scope and Limitations

This document states what HabitAI covers and where it stops, for the capstone paper and the defense. Every statement describes the system as built. The code that implements each point is named in brackets, so a panel question can be answered from the source. The app shows the same limits to its users in **Help & Support > What HabitAI can and cannot do**.

## Scope

**Users.** HabitAI is for PSAU students and faculty. Students use the app to build habits. Faculty use the same app in Faculty mode for their own habits. System administrators use only the separate Admin Panel; their accounts cannot sign in to the app.

**Platforms.** HabitAI runs on three platforms:

- an Android app, installed as an APK;
- a web app that opens on phones and computers, and on iPhone can be added to the Home Screen;
- a web-based Admin Panel.

All three share one backend, a Node.js API with a PostgreSQL database, which runs on an always-on instance. A separate machine-learning service gives habit forecasts.

**Reminders.** Reminders arrive at the times the user sets, also while HabitAI is closed:

- The Android app schedules the next two weeks of reminders on the phone, so they come even without internet [frontend/hooks/app-state/native-reminders.ts].
- About every hour, while the Android app is not open and the phone has internet, a background sync schedules the reminders of habits changed on another device (for example a habit added on the web) and sets every reminder's alarm again [frontend/hooks/app-state/reminder-sync.ts].
- On the web, including iPhone with HabitAI added to the Home Screen, the server sends each reminder as a web notification on its minute [backend/services/web-push-clock.js].

**Habit areas.** Habits are limited to two areas, **Health** and **Academics**, as the panel recommended.

- Every new habit belongs to one of the two areas. A new habit from an older version of the app is filed under the area its name suggests [backend/services/habit-rules.js].
- The Habits tab shows how a user's habits split between the two areas. When one area has no habit, the app suggests a ready-made habit for it.
- The AI planner plans habits for both areas [backend/services/ai-prompts.js].

**Input.** Users enter habits by tapping, not by typing everything:

- **Ready-made habits.** A user can add a habit in one tap. The habit comes with its reminder time and its proof already set. Students and faculty get different sets [frontend/constants/habit-templates.ts].
- **Describe your habit.** A user can describe a habit in one sentence, in English, Filipino or Taglish ("Mag-aral ng 30 minuto tuwing gabi"), and HabitAI fills in the form: the name, Health or Academics, the days, up to 2 reminder times and the proof. The user checks the form before saving. The AI reads the sentence; when it is unavailable, fixed rules read it [backend/services/habit-parse.js].
- **Follow-up questions.** After a habit is added, HabitAI asks a few questions, each answered with one tap. The answers set the habit's reminder time and amount. One question is written by the AI about that habit (a fixed question when the AI is unavailable), and a short tip follows the answers [backend/services/habit-follow-up.js].
- **Automatic records.** The Focus timer and the step counter record check-ins on their own. A habit proven by them is checked off when the timer ends or when the walk reaches its target, without another tap.

**Proof of success.** A check-in of a new habit needs proof [backend/services/check-in-proof.js]:

| Habit | Proof | What the server checks |
| --- | --- | --- |
| Timed (studying, reading, exercise, or a name with a duration) | The Focus timer, 5 to 180 minutes | The session starts on the server. The check-in is accepted only after the habit's full minutes have passed on the server's clock (10 seconds of grace). |
| Walking | The phone's step counter, 500 to 30,000 steps | The session starts on the server. The steps must reach the target and fit the time taken: at most 200 steps a minute. |
| Any other habit | A photo taken at the check-in | It must be a real JPEG, PNG or WebP image (checked by its first bytes), from 1 KB to 300 KB. |

Proofs are stored with the check-in. An administrator can review them in the Admin Panel under **Check-in proofs**, and every photo opened there is written to the audit log.

**Rewards.**

- Each check-in earns points and tokens (for up to 6 check-ins a day), and the tokens buy rewards: themes, profile frames, a custom title, items for the Habi buddy, Streak Freezes and AI Coach answers.
- Students also compete on leaderboards and can send treats to classmates.
- Faculty earn and spend tokens the same way on their own **Rewards** screen, as the panel noted. They are never on the student leaderboards, so the two rewards that show only there are not offered to them: the Buddy Showcase and treats for classmates [backend/services/rewards.js, backend/services/token-guide.js].

**AI and predictions.**

- The AI Coach, the habit planner, the follow-up questions, the tips and the help assistant use a large language model through the Groq API.
- Habit forecasts (the chance of completion and the dropout risk) come from the machine-learning service. When that service is unavailable, a rules-based formula answers instead [backend/services/forecast-rules.js].

**Faculty insight.**

- Faculty see students only as a group, in **Class Pulse** in the Admin Panel. No student is ever named.
- Any group smaller than the anonymity threshold is hidden. The threshold is 3 students by default, and an administrator can set it from 2 to 20.

## Data integrity

The panel asked that data cannot be faked. HabitAI does not trust numbers sent by the app; the server decides every value that matters:

1. **Points, tokens and streaks** are computed on the server from the check-in records and the token ledger. The app never decides an amount, and a price it sends must match the server's. Undoing a check-in takes back what it paid [backend/services/wallet.js, backend/services/streaks.js].
2. **Only today can be checked in**, and only until the habit's last reminder time. A missed day cannot be filled in later. The day is taken from the account's own time zone and calendar, not from the phone's clock alone [backend/services/check-ins.js, backend/services/account-day.js].
3. **Proof sessions are timed by the server.** The app cannot see when a session started or change it, so a Focus timer cannot be cut short. Steps that are impossible in the time taken are refused. A session proves one check-in only.
4. **Photos are checked** for type and size, and are kept for review.
5. **Saving the app's data cannot get around a proof.** A habit that needs proof is checked in only through the check-in endpoint and its checks. Saving the app's state cannot check that habit in or remove its proof requirement [backend/services/app-state-store.js].
6. **Administrator actions are logged**, including each time a proof photo is viewed.
7. **Activity counts the student, not the phone.** The Android app's background reminder sync is not recorded as a day of activity, so the engagement figures in the Admin Panel come from students opening HabitAI [backend/routes/app-state.js].

## Limitations

1. **Proof makes faking harder, not impossible.** It raises the cost of a false check-in, but it does not confirm that the activity really happened:
   - The Focus timer can run while the user does something else.
   - A phone can be shaken to add steps, as long as the count fits the time.
   - A photo can be staged or show an old scene.
   - HabitAI does not analyze photos automatically. A person reviews them only when needed.
2. **Steps are counted only in the Android app**, and only while the Walk screen is open. The phone's step counter does not count for HabitAI in the background, so the screen is kept on during a walk.
   - The web app, phones without a step counter, and phones where the user denied physical-activity access cannot count steps.
   - On those, a walk is proven with a photo instead, which is a weaker proof.
3. **An internet connection is required.** There is no offline mode: check-ins, proofs, tokens and the AI are all checked on the server. Only the Android app's reminders still come without internet, because they are set on the phone. The backend runs on a paid always-on instance; the rest of the deployment uses free tiers:
   - The machine-learning service and the Admin Panel sleep after 15 idle minutes and take up to a minute to wake. Meanwhile, forecasts come from the rules-based formula.
   - The database has a 0.5 GB limit and a monthly compute quota.
   - Email is limited to 300 messages a day.

   These limits affect speed, not correctness. See DEPLOYMENT.md.
4. **Only Health and Academics habits.** Other kinds of habits are outside the scope.
5. **Habits last one week**, from their start day to Sunday. Their check-ins stay in the stats, history and streak, but a habit does not carry over to the next week: users add new habits each week or plan them with the AI.
6. **The AI can be wrong.** Its answers, plans, follow-up questions, tips and the forms it fills in from a description are generated text, so the user checks a filled-in form before saving it. A chat remembers only its last 3 questions and answers, and only until it is closed for a new one. They are not medical, psychological or academic advice. The AI features need the Groq service. When one model reaches its usage limit, another model answers (its answers can be shorter or less specific); when the service is unavailable or every model is at its limit, the features answer from fixed rules instead or report that they are unavailable.
7. **The predictions are experimental.** The bundled machine-learning model was trained on generated scenarios, not on real HabitAI data.
   - A model is used in production only after it is retrained on approved, anonymized HabitAI outcomes and passes an independent holdout evaluation (ml-service/README.md).
   - Exporting training data needs at least 10 students with a week of history.
   - Until then, forecasts come from the rules-based formula, and the app labels them as estimates.
8. **Some features are Android only.** These are the step counter, the home-screen widget, and reminders scheduled on the phone itself. HabitAI is distributed as an Android app; iPhone users use the web app.
   - On the web and on iPhone, reminders come as web notifications. They need internet, notification permission and HTTPS, and on iPhone the app must be added to the Home Screen. A computer gets them only while its browser is running.
   - Web notifications can be delayed by the browser or the phone's operating system.
   - The Android background sync runs only with internet, about every hour, and Android may run it later to save battery. Until it runs, or until the user opens HabitAI, a habit changed on another device keeps its old reminders on the phone.
   - Battery savers of some phone makers can remove an app's reminders when it is swiped away. Turning off battery optimization for HabitAI avoids this.
9. **Faculty cannot see individual students.**
   - Class Pulse shows only group numbers, so faculty cannot review a particular student's habits or proofs.
   - Proof photos can be opened only by administrators.
   - Faculty are not ranked on any leaderboard.
10. **Data is kept for a limited time.**
    - Proof photos are deleted after 14 days. The record that a check-in was proven stays. The deployment can change the period to anywhere from 1 to 365 days with `PROOF_PHOTO_RETENTION_DAYS`.
    - Issue-report attachments are cleared 30 days after the report is closed, and after 180 days at most.
11. **The interface is mainly in English.** A Tagalog translation covers the main navigation and settings. The AI answers in the language the user writes in (English, Filipino or Taglish).
12. **Habits created before proofs were introduced** kept plain tap check-ins until their week ended. All habits created after that require proof.

## The panel's notes and where they are addressed

| Panel note | How HabitAI addresses it |
| --- | --- |
| Faculty rewards | Faculty earn tokens and spend them on their own Rewards screen. The student-only leaderboard rewards are not offered to them. |
| Balance of habits | Habits are limited to Health and Academics. The Habits tab shows the balance and suggests a habit for a missing area, and the AI planner covers both. |
| Automatic input | Ready-made habits are added in one tap, and a habit described in one sentence fills in the form. The Focus timer and the step counter check the habit in automatically. |
| Limitations of the system | This document, and Help & Support > What HabitAI can and cannot do in the app. |
| Data integrity | The server-owned points, tokens and streaks, the server-timed proof sessions, the photo checks, and the audit log (see *Data integrity*). |
| Limit to Health and Academics | Only these two areas can be chosen. |
| Tap-to-tap or click input | One-tap ready-made habits, and follow-up questions answered with one tap each. |
| AI follow-up questions after adding a habit | The questions after adding a habit: the app's own on time and amount, one written by the AI, and a tip. |
| Proof of success | The Focus timer, steps or a photo, required for each check-in and reviewable by administrators. |
| Respondents (300 students and 14 faculty), and the total number of students | These belong to the study's method, not to the system. They are settled by the researchers with their adviser. |
