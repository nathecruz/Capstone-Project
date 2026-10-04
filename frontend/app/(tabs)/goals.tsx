import { Ionicons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { TypingDots } from '@/components/ai-chat';
import { ProgressRing } from '@/components/progress-ring';
import { useAppDialog } from '@/components/ui/app-dialog';
import { generateGoalPlan } from '@/utils/ai-client';
import { useAppColorScheme, type Goal } from '@/hooks/color-scheme-context';
import { useAppTheme } from '@/hooks/dark-mode-context';
import { CONTENT_MAX_WIDTH } from '@/hooks/use-responsive-layout';
import { createThemedStyles, themedColor, useThemeColor, useThemedStyles } from '@/hooks/use-themed-styles';

type GoalTab = 'Planner' | 'My Goals';

type GoalInsight = Goal;

/** Starter goals: a tap fills the goal field with a full example. */
const STARTERS: { label: string; icon: keyof typeof Ionicons.glyphMap; prompt: string }[] = [
  { label: 'Get fit', icon: 'barbell-outline', prompt: 'I want to become healthier by being more consistent with exercise, sleep, and meal planning.' },
  { label: 'Study better', icon: 'school-outline', prompt: 'I want to become more disciplined and focused in my studies and personal growth.' },
  { label: 'Save money', icon: 'wallet-outline', prompt: 'I want to save more money and build a better financial routine this year.' },
  { label: 'Grow my career', icon: 'briefcase-outline', prompt: 'I want to grow in my career by improving my confidence, skills, and professional habits.' },
];

const FOCUS_TARGETS = [
  { value: '3 habits', label: '3 habits' },
  { value: '4 habits', label: '4 habits' },
  { value: '5 habits', label: '5 habits' },
];
const TIMELINES = [
  { value: '7-14 days', label: '2 weeks' },
  { value: '30-60 days', label: '1-2 months' },
  { value: '90 days', label: '3 months' },
];
const timelineLabel = (value: string) => TIMELINES.find((option) => option.value === value)?.label ?? value;

const CATEGORY_ICONS: Record<string, keyof typeof Ionicons.glyphMap> = {
  Health: 'fitness-outline',
  Career: 'briefcase-outline',
  Finance: 'wallet-outline',
  Education: 'school-outline',
  Relationships: 'people-outline',
  'Personal Growth': 'leaf-outline',
};

/** Long goals are kept readable; the full text stays in the goal field. */
const goalTitle = (input: string) => (input.length > 120 ? `${input.slice(0, 117)}...` : input);

const detectCategory = (input: string) => {
  const lower = input.toLowerCase();
  if (/(career|job|promotion|work|business|income|leadership)/.test(lower)) return 'Career';
  if (/(health|fitness|exercise|weight|diet|sleep|wellness|habit)/.test(lower)) return 'Health';
  if (/(money|finance|budget|saving|invest|salary|debt)/.test(lower)) return 'Finance';
  if (/(study|school|learn|skill|course|education|cert)/.test(lower)) return 'Education';
  if (/(relationship|love|family|friend|communication|connection)/.test(lower)) return 'Relationships';
  if (/(travel|creative|artist|write|design|music|passion)/.test(lower)) return 'Personal Growth';
  return 'Personal Growth';
};

/** Fields the AI plan may leave out, filled from the goal text. */
const buildGoalInsight = (input: string, timeline = '30-60 days', focusTarget = '4 habits'): GoalInsight => {
  const trimmed = input.trim();
  const title = trimmed || 'Create a stronger life plan';
  const category = detectCategory(title);
  const lower = title.toLowerCase();
  const focusFromInput = [
    lower.includes('health') || lower.includes('fitness') ? 'Daily discipline' : 'Clear priorities',
    lower.includes('career') || lower.includes('work') ? 'Career growth' : 'Consistent effort',
    lower.includes('money') || lower.includes('finance') ? 'Smart spending' : 'Healthy accountability',
  ];

  const intensity: GoalInsight['intensity'] = /fast|urgent|soon|quick|immediate/.test(lower)
    ? 'High focus'
    : /health|fitness|routine|habit/.test(lower)
      ? 'Balanced'
      : 'Quick win';

  const nextCheckIn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
  const subject = (title.match(/(?:in|for|with|on)\s+([^,.!?]+)/i)?.[1] || title)
    .replace(/^i want to (become|be|improve|learn|build|save|grow)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 46);
  const dueDates = [0, 1, 3, 7].map((days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));

  return {
    id: `${Date.now()}`,
    title: goalTitle(title),
    category,
    summary: 'This goal is specific, meaningful and realistic enough to keep your momentum. Make the plan visible and repeatable.',
    intensity,
    focusAreas: focusFromInput,
    actionPlan: [
      `Choose one measurable ${subject} outcome for this week.`,
      `Complete one focused 20-minute ${subject} session.`,
      `Review what helped or blocked your ${subject} progress.`,
      `Set a reminder for your next ${subject} session.`,
    ],
    actionDueDates: dueDates,
    nextMilestone: `Finish one meaningful milestone this week for ${lower}.`,
    risk: 'Losing focus when tasks pile up or motivation drops for a few days.',
    riskAction: `If tasks pile up, do only the smallest next action for ${lower} before rescheduling the rest.`,
    timeline,
    focusTarget,
    nextCheckIn,
    completedSteps: [false, false, false, false],
    progress: 0,
    status: 'Fresh plan',
  };
};

const getProgressFromSteps = (completedSteps: boolean[]) => Math.round((completedSteps.filter(Boolean).length / 4) * 100);
const getGoalStatus = (progress: number) => progress >= 100 ? 'Completed' : progress >= 67 ? 'On track' : progress > 0 ? 'In progress' : 'Fresh plan';

/** A row of choices for a plan setting. */
function Choice({ label, options, value, onChange }: { label: string; options: { value: string; label: string }[]; value: string; onChange: (value: string) => void }) {
  const styles = useThemedStyles(themedStyles);
  return (
    <View style={styles.choice}>
      <Text style={styles.choiceLabel}>{label}</Text>
      <View style={styles.choiceRow} accessibilityRole="radiogroup" accessibilityLabel={label}>
        {options.map((option) => {
          const selected = option.value === value;
          return (
            <Pressable key={option.value} style={({ pressed }) => [styles.choiceOption, selected && styles.choiceOptionActive, pressed && styles.pressed]} onPress={() => onChange(option.value)} accessibilityRole="radio" accessibilityState={{ checked: selected }} accessibilityLabel={`${label}: ${option.label}`}>
              <Text style={[styles.choiceText, selected && styles.choiceTextActive]}>{option.label}</Text>
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

/** One action step: tap to tick it off. */
function StepRow({ step, due, done, index, last, onPress }: { step: string; due?: string; done: boolean; index: number; last: boolean; onPress: () => void }) {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  return (
    <Pressable style={({ pressed }) => [styles.stepRow, pressed && styles.pressed]} onPress={onPress} accessibilityRole="checkbox" accessibilityState={{ checked: done }} accessibilityLabel={`Step ${index + 1}: ${step}${due ? `. Due ${due}` : ''}${done ? '. Done' : ''}`} accessibilityHint={done ? 'Done steps stay checked' : 'Marks the step as done'}>
      <View style={styles.stepRail}>
        <View style={[styles.stepDot, done && styles.stepDotDone]}>
          {done ? <Ionicons name="checkmark" size={15} color={themeColor('#FFFFFF')} /> : <Text style={styles.stepNumber}>{index + 1}</Text>}
        </View>
        {!last && <View style={[styles.stepLine, done && styles.stepLineDone]} />}
      </View>
      <View style={styles.stepCopy}>
        <Text style={[styles.stepText, done && styles.stepTextDone]}>{step}</Text>
        {done ? (
          <View style={styles.dueChip}>
            <Ionicons name="lock-closed" size={11} color={themeColor('#2E9D5C')} />
            <Text style={[styles.dueText, styles.doneText]}>Done</Text>
          </View>
        ) : due ? (
          <View style={styles.dueChip}>
            <Ionicons name="calendar-outline" size={11} color={themeColor('#6E6887')} />
            <Text style={styles.dueText}>Due {due}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

export default function GoalsScreen() {
  const styles = useThemedStyles(themedStyles);
  const themeColor = useThemeColor();
  const appTheme = useAppTheme();
  const showAlert = useAppDialog();
  const { isDarkMode, getAppStateSnapshot, syncAppState, goals: savedGoals, updateGoals } = useAppColorScheme();
  const { width } = useWindowDimensions();
  const [activeTab, setActiveTab] = useState<GoalTab>('Planner');
  const [goalInput, setGoalInput] = useState('');
  const [inputFocused, setInputFocused] = useState(false);
  const [generatedGoal, setGeneratedGoal] = useState<GoalInsight | null>(null);
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [clearUndoText, setClearUndoText] = useState<string | null>(null);
  const [openGoals, setOpenGoals] = useState<Record<string, boolean>>({});
  const [focusTarget, setFocusTarget] = useState('4 habits');
  const [timelineOption, setTimelineOption] = useState('30-60 days');
  // The hero is purple in both modes; its ring needs the same colour in the middle.
  const heroBackground = themedColor(isDarkMode ? '#30215A' : '#5B42D8', appTheme);

  const activeGoal = useMemo(() => {
    const currentGoal = generatedGoal ?? savedGoals[0] ?? null;
    if (!currentGoal) return null;
    return savedGoals.find((goal) => goal.id === currentGoal.id) ?? currentGoal;
  }, [generatedGoal, savedGoals]);
  const activeGoalSaved = Boolean(activeGoal && savedGoals.some((goal) => goal.id === activeGoal.id));
  const averageProgress = savedGoals.length ? Math.round(savedGoals.reduce((total, goal) => total + goal.progress, 0) / savedGoals.length) : 0;
  const completedGoals = savedGoals.filter((goal) => goal.progress >= 100).length;

  useEffect(() => {
    if (!clearUndoText) return;
    const timeout = setTimeout(() => setClearUndoText(null), 5000);
    return () => clearTimeout(timeout);
  }, [clearUndoText]);

  const createInsight = async () => {
    if (isGenerating) return;
    if (!goalInput.trim()) {
      showAlert('Goal prompt required', 'Write the goal you want to improve or pursue first.');
      return;
    }

    const input = goalInput.trim();
    setIsGenerating(true);
    try {
      const result = await generateGoalPlan<Partial<GoalInsight>>({ goal: input, focusTarget, timeline: timelineOption });
      if (!result.ok) {
        showAlert('AI planner unavailable', `${result.message} Nothing was saved.`);
        return;
      }
      const plan = result.plan;
      const fallback = buildGoalInsight(input, timelineOption, focusTarget);
      setGeneratedGoal({
        ...fallback,
        ...plan,
        id: `${Date.now()}`,
        title: goalTitle(input),
        focusTarget,
        timeline: timelineOption,
        completedSteps: [false, false, false, false],
        actionDueDates: plan.actionDueDates ?? fallback.actionDueDates,
        progress: 0,
        status: 'Fresh plan',
      } as GoalInsight);
      setActiveTab('Planner');
    } finally {
      setIsGenerating(false);
    }
  };

  const saveGoal = async () => {
    if (isSavingGoal || !activeGoal) return;
    const progress = getProgressFromSteps(activeGoal.completedSteps);
    const goalToSave: GoalInsight = { ...activeGoal, id: activeGoal.id || `${Date.now()}`, progress, status: getGoalStatus(progress) };
    const nextGoals = savedGoals.some((goal) => goal.title === goalToSave.title) ? savedGoals : [goalToSave, ...savedGoals];
    setIsSavingGoal(true);
    try {
      const result = await syncAppState({ ...getAppStateSnapshot(), goals: nextGoals });
      if (!result.ok) {
        showAlert('Goal not synced', 'The goal was not saved to your account. Check your connection and try again.');
        return;
      }
      updateGoals(result.state.goals);
      showAlert('Goal saved', 'Your plan is in My Goals. Tick off each step as you do it.', [
        { text: 'Stay here', style: 'cancel' },
        { text: 'View goals', onPress: () => setActiveTab('My Goals') },
      ], 'success');
    } finally {
      setIsSavingGoal(false);
    }
  };

  const clearGoalText = () => {
    if (!goalInput.trim()) return;
    showAlert('Clear goal text?', 'This clears the goal field only. Your saved goals stay safe.', [
      { text: 'Keep editing', style: 'cancel' },
      { text: 'Clear text', style: 'destructive', onPress: () => { setClearUndoText(goalInput); setGoalInput(''); } },
    ]);
  };

  const deleteGoal = (goalId: string) => {
    showAlert('Delete goal', 'Remove this goal from your saved list?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          updateGoals((previous) => previous.filter((goal) => goal.id !== goalId));
          if (generatedGoal && generatedGoal.id === goalId) setGeneratedGoal(null);
        },
      },
    ]);
  };

  // A finished step stays finished (the server keeps it done too), so ticking one is confirmed first.
  const completeStep = (goal: GoalInsight, stepIndex: number) => {
    if (goal.completedSteps[stepIndex]) {
      showAlert('Step already done', 'Finished steps stay checked, so your goal progress stays real.');
      return;
    }
    const markDone = () => {
      const completed = (item: GoalInsight) => {
        const completedSteps = item.completedSteps.map((done, index) => done || index === stepIndex);
        const progress = getProgressFromSteps(completedSteps);
        return { ...item, completedSteps, progress, status: getGoalStatus(progress) };
      };
      updateGoals((previous) => previous.map((item) => (item.id === goal.id ? completed(item) : item)));
      if (generatedGoal && generatedGoal.id === goal.id) setGeneratedGoal(completed(generatedGoal));
    };
    showAlert('Mark this step as done?', `"${goal.actionPlan[stepIndex]}"\n\nOnce it is done, it cannot be unchecked.`, [
      { text: 'Not yet', style: 'cancel' },
      { text: 'Mark as done', onPress: markDone },
    ]);
  };

  const stepsDone = (goal: GoalInsight) => goal.completedSteps.filter(Boolean).length;

  return (
    <>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <SafeAreaView style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false} keyboardShouldPersistTaps="handled">
          <View style={[styles.container, { paddingHorizontal: width < 420 ? 16 : 22 }]}>
            <View style={styles.headerRow}>
              {/* Goals is a tab, so there is nothing to go back to; the spacers keep the title centred. */}
              <View style={styles.headerSpacer} />
              <View style={styles.headerTitleWrap}>
                <Text style={styles.headerEyebrow}>MY GOALS</Text>
                <Text style={styles.headerTitle}>AI Goal Planner</Text>
              </View>
              <View style={styles.headerBadge}><Ionicons name="flag" size={16} color={themeColor('#5B42D8')} /></View>
            </View>

            <View style={[styles.hero, isDarkMode && styles.heroDark]}>
              <View style={styles.heroCopy}>
                <View style={styles.heroLabelRow}>
                  <Ionicons name="sparkles" size={12} color={themedColor('#D8D0FF', appTheme)} />
                  <Text style={styles.heroLabel}>AI GOAL PLANNER</Text>
                </View>
                <Text style={styles.heroTitle}>Turn a goal into 4 clear steps.</Text>
                <Text style={styles.heroSubtitle}>
                  {savedGoals.length
                    ? `${savedGoals.length} goal${savedGoals.length === 1 ? '' : 's'} saved · ${completedGoals} completed`
                    : 'Describe it, get a plan, then tick off each step.'}
                </Text>
              </View>
              {savedGoals.length ? (
                <ProgressRing value={averageProgress} size={88} thickness={8} color="#FFFFFF" trackColor="rgba(255,255,255,0.2)" innerColor={heroBackground}>
                  <Text style={styles.heroRingValue}>{averageProgress}%</Text>
                  <Text style={styles.heroRingLabel}>average</Text>
                </ProgressRing>
              ) : (
                <View style={styles.heroIcon}><Ionicons name="rocket" size={30} color="#FFFFFF" /></View>
              )}
            </View>

            <View style={styles.tabs} accessibilityRole="tablist">
              {(['Planner', 'My Goals'] as const).map((tab) => {
                const active = activeTab === tab;
                return (
                  <Pressable key={tab} style={[styles.tab, active && styles.tabActive]} onPress={() => setActiveTab(tab)} accessibilityRole="tab" accessibilityState={{ selected: active }}>
                    <Ionicons name={tab === 'Planner' ? 'sparkles' : 'flag'} size={15} color={active ? themeColor('#FFFFFF') : themeColor('#777283')} />
                    <Text style={[styles.tabText, active && styles.tabTextActive]}>{tab === 'My Goals' && savedGoals.length ? `My Goals (${savedGoals.length})` : tab}</Text>
                  </Pressable>
                );
              })}
            </View>

            {activeTab === 'Planner' ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>What do you want to achieve?</Text>
                  <Text style={styles.cardHint}>Write it in your own words: the outcome, and the routine you want to build.</Text>

                  <TextInput
                    value={goalInput}
                    onChangeText={setGoalInput}
                    maxLength={500}
                    multiline
                    placeholder="Example: I want to get fit and sleep better while keeping up with my classes."
                    placeholderTextColor={themeColor('#8A8397')}
                    style={[styles.textInput, inputFocused && styles.textInputFocused, Platform.OS === 'web' ? ({ outlineStyle: 'none' } as object) : null]}
                    onFocus={() => setInputFocused(true)}
                    onBlur={() => setInputFocused(false)}
                    accessibilityLabel="Your goal"
                  />
                  <View style={styles.inputMeta}>
                    <View style={styles.privacyNote}>
                      <Ionicons name="lock-closed" size={11} color={themeColor('#8A8294')} />
                      <Text style={styles.metaText}>Only this text is sent to the AI.</Text>
                    </View>
                    <Text style={styles.metaText}>{goalInput.length}/500</Text>
                  </View>

                  <Text style={styles.subheading}>Need an idea?</Text>
                  <View style={styles.starters}>
                    {STARTERS.map((starter) => (
                      <Pressable key={starter.label} style={({ pressed }) => [styles.starter, pressed && styles.pressed]} onPress={() => setGoalInput(starter.prompt)} accessibilityRole="button" accessibilityLabel={`Use the example goal: ${starter.label}`}>
                        <Ionicons name={starter.icon} size={15} color={themeColor('#5B42D8')} />
                        <Text style={styles.starterText}>{starter.label}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <Choice label="Habits to focus on" options={FOCUS_TARGETS} value={focusTarget} onChange={setFocusTarget} />
                  <Choice label="Timeline" options={TIMELINES} value={timelineOption} onChange={setTimelineOption} />

                  <View style={styles.actionRow}>
                    <Pressable style={({ pressed }) => [styles.secondaryButton, !goalInput.trim() && styles.disabled, pressed && styles.pressed]} onPress={clearGoalText} disabled={!goalInput.trim()} accessibilityRole="button">
                      <Text style={styles.secondaryButtonText}>Clear</Text>
                    </Pressable>
                    <Pressable style={({ pressed }) => [styles.primaryButton, (isGenerating || !goalInput.trim()) && styles.disabled, pressed && styles.pressed]} onPress={createInsight} disabled={isGenerating} accessibilityRole="button">
                      {isGenerating ? <ActivityIndicator size="small" color={themeColor('#FFFFFF')} /> : <Ionicons name="sparkles" size={17} color={themeColor('#FFFFFF')} />}
                      <Text style={styles.primaryButtonText}>{isGenerating ? 'Creating plan...' : 'Generate plan'}</Text>
                    </Pressable>
                  </View>
                </View>

                {isGenerating ? (
                  <View style={styles.card} accessibilityLiveRegion="polite">
                    <View style={styles.buildingRow}>
                      <View style={styles.buildingIcon}><Ionicons name="sparkles" size={17} color={themeColor('#FFFFFF')} /></View>
                      <View style={styles.buildingCopy}>
                        <Text style={styles.cardTitle}>Building your plan</Text>
                        <Text style={styles.cardHint}>Picking 4 steps for {timelineLabel(timelineOption).toLowerCase()}</Text>
                      </View>
                      <TypingDots />
                    </View>
                    {[0.92, 0.7, 0.84, 0.6].map((share) => <View key={share} style={[styles.skeleton, { width: `${share * 100}%` }]} />)}
                  </View>
                ) : activeGoal ? (
                  <View style={styles.card}>
                    <View style={styles.planHeader}>
                      <View style={styles.planHeaderCopy}>
                        <View style={styles.tagRow}>
                          <View style={styles.tag}>
                            <Ionicons name={CATEGORY_ICONS[activeGoal.category] ?? 'leaf-outline'} size={12} color={themeColor('#5B42D8')} />
                            <Text style={styles.tagText}>{activeGoal.category}</Text>
                          </View>
                          <View style={[styles.tag, styles.tagMuted]}>
                            <Ionicons name="flash-outline" size={12} color={themeColor('#6E6887')} />
                            <Text style={[styles.tagText, styles.tagTextMuted]}>{activeGoal.intensity}</Text>
                          </View>
                        </View>
                        <Text style={styles.planTitle}>{activeGoal.title}</Text>
                      </View>
                      <ProgressRing value={activeGoal.progress} size={70} thickness={7} color={themedColor('#5B42D8', appTheme)} trackColor={themeColor('#ECE8F6', 'backgroundColor')} innerColor={themeColor('#FFFFFF', 'backgroundColor')}>
                        <Text style={styles.ringValue}>{stepsDone(activeGoal)}/4</Text>
                        <Text style={styles.ringLabel}>steps</Text>
                      </ProgressRing>
                    </View>

                    <View style={styles.summary}>
                      <Ionicons name="sparkles" size={15} color={themeColor('#5B42D8')} />
                      <Text style={styles.summaryText}>{activeGoal.summary}</Text>
                    </View>

                    <View style={styles.factRow}>
                      <View style={styles.fact}><Ionicons name="time-outline" size={14} color={themeColor('#6E6887')} /><Text style={styles.factText}>{timelineLabel(activeGoal.timeline)}</Text></View>
                      <View style={styles.fact}><Ionicons name="layers-outline" size={14} color={themeColor('#6E6887')} /><Text style={styles.factText}>{activeGoal.focusTarget}</Text></View>
                      <View style={styles.fact}><Ionicons name="calendar-outline" size={14} color={themeColor('#6E6887')} /><Text style={styles.factText}>Check in {activeGoal.nextCheckIn}</Text></View>
                    </View>

                    <Text style={styles.subheading}>Focus areas</Text>
                    <View style={styles.pillRow}>
                      {activeGoal.focusAreas.map((focus) => <View key={focus} style={styles.pill}><Text style={styles.pillText}>{focus}</Text></View>)}
                    </View>

                    <View style={styles.sectionRow}>
                      <Text style={styles.subheading}>Your 4 steps</Text>
                      <Text style={styles.sectionHint}>Tap a step when you finish it</Text>
                    </View>
                    {activeGoal.actionPlan.map((step, index) => (
                      <StepRow key={`${activeGoal.id}-${index}`} step={step} due={activeGoal.actionDueDates[index]} done={Boolean(activeGoal.completedSteps[index])} index={index} last={index === activeGoal.actionPlan.length - 1} onPress={() => completeStep(activeGoal, index)} />
                    ))}

                    <View style={styles.milestone}>
                      <View style={styles.calloutIcon}><Ionicons name="flag" size={15} color={themeColor('#5B42D8')} /></View>
                      <View style={styles.calloutCopy}>
                        <Text style={styles.calloutLabel}>NEXT MILESTONE</Text>
                        <Text style={styles.calloutText}>{activeGoal.nextMilestone}</Text>
                      </View>
                    </View>
                    <View style={styles.watchOut}>
                      <View style={[styles.calloutIcon, styles.watchOutIcon]}><Ionicons name="alert" size={15} color={themeColor('#B7791F')} /></View>
                      <View style={styles.calloutCopy}>
                        <Text style={[styles.calloutLabel, styles.watchOutLabel]}>WATCH OUT FOR</Text>
                        <Text style={styles.calloutText}>{activeGoal.risk}</Text>
                        <Text style={styles.watchOutAction}><Text style={styles.watchOutActionStrong}>If it happens: </Text>{activeGoal.riskAction}</Text>
                      </View>
                    </View>

                    {activeGoalSaved ? (
                      <Pressable style={({ pressed }) => [styles.savedRow, pressed && styles.pressed]} onPress={() => setActiveTab('My Goals')} accessibilityRole="button">
                        <Ionicons name="checkmark-circle" size={18} color={themeColor('#2E9D5C')} />
                        <Text style={styles.savedText}>Saved to My Goals</Text>
                        <Text style={styles.savedLink}>Open</Text>
                        <Ionicons name="chevron-forward" size={15} color={themeColor('#5B42D8')} />
                      </Pressable>
                    ) : (
                      <Pressable style={({ pressed }) => [styles.primaryButton, styles.saveButton, isSavingGoal && styles.disabled, pressed && styles.pressed]} onPress={() => void saveGoal()} disabled={isSavingGoal} accessibilityRole="button">
                        {isSavingGoal ? <ActivityIndicator size="small" color={themeColor('#FFFFFF')} /> : <Ionicons name="bookmark" size={17} color={themeColor('#FFFFFF')} />}
                        <Text style={styles.primaryButtonText}>{isSavingGoal ? 'Saving...' : 'Save to My Goals'}</Text>
                      </Pressable>
                    )}
                  </View>
                ) : (
                  <View style={styles.card}>
                    <Text style={styles.cardTitle}>How it works</Text>
                    {[
                      { icon: 'create-outline' as const, title: 'Describe your goal', text: 'In English, Filipino or Taglish.' },
                      { icon: 'sparkles-outline' as const, title: 'Get 4 clear steps', text: 'With due dates, focus areas and what to watch out for.' },
                      { icon: 'checkmark-done-outline' as const, title: 'Tick them off', text: 'Save the plan and track it in My Goals.' },
                    ].map((item, index) => (
                      <View key={item.title} style={styles.howRow}>
                        <View style={styles.howIcon}><Ionicons name={item.icon} size={17} color={themeColor('#5B42D8')} /></View>
                        <View style={styles.calloutCopy}>
                          <Text style={styles.howTitle}>{index + 1}. {item.title}</Text>
                          <Text style={styles.cardHint}>{item.text}</Text>
                        </View>
                      </View>
                    ))}
                  </View>
                )}
              </>
            ) : (
              <View style={styles.goalList}>
                {!savedGoals.length ? (
                  <View style={[styles.card, styles.emptyCard]}>
                    <View style={styles.emptyIcon}><Ionicons name="bookmark-outline" size={26} color={themeColor('#5B42D8')} /></View>
                    <Text style={styles.emptyTitle}>No saved goals yet</Text>
                    <Text style={styles.emptyText}>Make a plan in the Planner and save it. It stays here so you can tick off each step.</Text>
                    <Pressable style={({ pressed }) => [styles.primaryButton, styles.emptyButton, pressed && styles.pressed]} onPress={() => setActiveTab('Planner')} accessibilityRole="button">
                      <Ionicons name="sparkles" size={16} color={themeColor('#FFFFFF')} />
                      <Text style={styles.primaryButtonText}>Plan a goal</Text>
                    </Pressable>
                  </View>
                ) : null}

                {savedGoals.map((goal) => {
                  const done = stepsDone(goal);
                  const nextStep = goal.actionPlan.find((_, index) => !goal.completedSteps[index]);
                  const open = Boolean(openGoals[goal.id]);
                  const complete = goal.progress >= 100;
                  return (
                    <View key={goal.id} style={styles.card}>
                      <View style={styles.goalHeader}>
                        <View style={styles.goalIcon}><Ionicons name={CATEGORY_ICONS[goal.category] ?? 'leaf-outline'} size={19} color={themeColor('#5B42D8')} /></View>
                        <View style={styles.planHeaderCopy}>
                          <Text style={styles.goalMeta}>{goal.category} · {timelineLabel(goal.timeline)}</Text>
                          <Text style={styles.goalTitle} numberOfLines={open ? undefined : 2}>{goal.title}</Text>
                        </View>
                        <Pressable style={({ pressed }) => [styles.deleteButton, pressed && styles.pressed]} onPress={() => deleteGoal(goal.id)} accessibilityRole="button" accessibilityLabel={`Delete goal: ${goal.title}`}>
                          <Ionicons name="trash-outline" size={16} color={themeColor('#D94E64')} />
                        </Pressable>
                      </View>

                      <View style={styles.progressRow}>
                        <View style={styles.progressTrack}><View style={[styles.progressFill, complete && styles.progressFillDone, { width: `${goal.progress}%` }]} /></View>
                        <Text style={styles.progressText}>{done}/4</Text>
                        <View style={[styles.statusChip, complete && styles.statusChipDone]}><Text style={[styles.statusText, complete && styles.statusTextDone]}>{goal.status}</Text></View>
                      </View>

                      <View style={styles.nextRow}>
                        <Ionicons name={nextStep ? 'arrow-forward-circle' : 'trophy'} size={16} color={nextStep ? themeColor('#5B42D8') : themeColor('#C98A0E')} />
                        <Text style={styles.nextText} numberOfLines={open ? undefined : 2}>{nextStep ? `Next: ${nextStep}` : 'All 4 steps done. Great work!'}</Text>
                      </View>

                      {open && (
                        <View style={styles.goalSteps}>
                          {goal.actionPlan.map((step, index) => (
                            <StepRow key={`${goal.id}-${index}`} step={step} due={goal.actionDueDates[index]} done={Boolean(goal.completedSteps[index])} index={index} last={index === goal.actionPlan.length - 1} onPress={() => completeStep(goal, index)} />
                          ))}
                        </View>
                      )}
                      <Pressable style={({ pressed }) => [styles.expandButton, pressed && styles.pressed]} onPress={() => setOpenGoals((current) => ({ ...current, [goal.id]: !open }))} accessibilityRole="button" accessibilityState={{ expanded: open }}>
                        <Text style={styles.expandText}>{open ? 'Hide steps' : 'Show steps'}</Text>
                        <Ionicons name={open ? 'chevron-up' : 'chevron-down'} size={15} color={themeColor('#5B42D8')} />
                      </Pressable>
                    </View>
                  );
                })}
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
      {clearUndoText ? (
        <View style={styles.snackbar} accessibilityLiveRegion="polite">
          <Ionicons name="checkmark-circle-outline" size={18} color="#A9F0C7" />
          <Text style={styles.snackbarText}>Goal text cleared</Text>
          <Pressable onPress={() => { setGoalInput(clearUndoText); setClearUndoText(null); }} accessibilityRole="button">
            <Text style={styles.snackbarButton}>Undo</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const themedStyles = createThemedStyles({
  screen: { flex: 1, backgroundColor: '#F5F4F9' },
  content: { paddingBottom: 120 },
  // Same width as the other tabs, so switching tabs does not resize the page.
  container: { width: '100%', maxWidth: CONTENT_MAX_WIDTH, alignSelf: 'center', paddingTop: 8 },
  pressed: { opacity: 0.75 },
  disabled: { opacity: 0.55 },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  headerSpacer: { width: 38, height: 38 },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerEyebrow: { fontSize: 11, letterSpacing: 1.2, fontWeight: '800', color: '#8D8998', marginBottom: 3 },
  headerTitle: { fontSize: 23, fontWeight: '800', color: '#24212D' },
  headerBadge: { width: 38, height: 38, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#ECE8FF' },
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#5B42D8', borderRadius: 24, padding: 20, marginBottom: 14 },
  heroDark: { backgroundColor: '#30215A' },
  heroCopy: { flex: 1, minWidth: 0 },
  heroLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 8 },
  heroLabel: { fontSize: 11, color: '#D8D0FF', fontWeight: '800', letterSpacing: 1 },
  heroTitle: { fontSize: 21, lineHeight: 26, color: '#FFFFFF', fontWeight: '800' },
  heroSubtitle: { fontSize: 12, lineHeight: 17, color: '#D8D0FF', fontWeight: '600', marginTop: 6 },
  heroRingValue: { fontSize: 19, color: '#FFFFFF', fontWeight: '900' },
  heroRingLabel: { fontSize: 11, color: '#D8D0FF', fontWeight: '700' },
  heroIcon: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(255,255,255,0.16)' },
  tabs: { flexDirection: 'row', backgroundColor: '#ECE9F3', borderRadius: 16, padding: 4, marginBottom: 16 },
  tab: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, borderRadius: 12 },
  tabActive: { backgroundColor: '#5B42D8' },
  tabText: { fontSize: 13, color: '#777283', fontWeight: '700' },
  tabTextActive: { color: '#FFFFFF' },
  card: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18, marginBottom: 14, shadowColor: '#292047', shadowOpacity: 0.04, shadowRadius: 10, shadowOffset: { width: 0, height: 3 }, elevation: 2 },
  cardTitle: { fontSize: 17, fontWeight: '800', color: '#25222E' },
  cardHint: { fontSize: 12, lineHeight: 17, color: '#7A728B', fontWeight: '600', marginTop: 3 },
  textInput: { minHeight: 112, marginTop: 14, borderWidth: 2, borderColor: '#EEEAF6', borderRadius: 16, backgroundColor: '#F8F6FD', paddingHorizontal: 14, paddingTop: 12, paddingBottom: 12, textAlignVertical: 'top', fontSize: 16, lineHeight: 22, color: '#201A2A' },
  textInputFocused: { borderColor: '#8E7AE8' },
  inputMeta: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10, marginTop: 7 },
  privacyNote: { flexDirection: 'row', alignItems: 'center', gap: 5, flexShrink: 1 },
  metaText: { fontSize: 11, color: '#8A8294', fontWeight: '600' },
  subheading: { fontSize: 13, fontWeight: '800', color: '#3B3650', marginTop: 16, marginBottom: 8 },
  starters: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  starter: { flexDirection: 'row', alignItems: 'center', gap: 6, minHeight: 38, paddingHorizontal: 12, borderRadius: 999, borderWidth: 1, borderColor: '#E1DAF7', backgroundColor: '#FAF8FF' },
  starterText: { fontSize: 13, fontWeight: '700', color: '#4F3BAF' },
  choice: { marginTop: 16 },
  choiceLabel: { fontSize: 13, fontWeight: '800', color: '#3B3650', marginBottom: 8 },
  choiceRow: { flexDirection: 'row', backgroundColor: '#F2F0F7', borderRadius: 13, padding: 4, gap: 4 },
  choiceOption: { flex: 1, minHeight: 40, alignItems: 'center', justifyContent: 'center', borderRadius: 10, paddingHorizontal: 4 },
  choiceOptionActive: { backgroundColor: '#FFFFFF', shadowColor: '#292047', shadowOpacity: 0.08, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  choiceText: { fontSize: 13, fontWeight: '700', color: '#777283' },
  choiceTextActive: { color: '#5B42D8', fontWeight: '900' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 20 },
  primaryButton: { flex: 1, minHeight: 50, borderRadius: 14, backgroundColor: '#5B42D8', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, paddingHorizontal: 16 },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '900', fontSize: 14 },
  secondaryButton: { width: 96, minHeight: 50, borderRadius: 14, backgroundColor: '#F0EDF7', alignItems: 'center', justifyContent: 'center' },
  secondaryButtonText: { color: '#473A64', fontWeight: '800', fontSize: 14 },
  buildingRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 16 },
  buildingIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: '#5B42D8' },
  buildingCopy: { flex: 1, minWidth: 0 },
  skeleton: { height: 14, borderRadius: 7, backgroundColor: '#EFECF6', marginTop: 10 },
  planHeader: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  planHeaderCopy: { flex: 1, minWidth: 0 },
  tagRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 8 },
  tag: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: '#F0EBFF' },
  tagMuted: { backgroundColor: '#F2F0F7' },
  tagText: { fontSize: 11, fontWeight: '800', color: '#5B42D8' },
  tagTextMuted: { color: '#6E6887' },
  planTitle: { fontSize: 18, lineHeight: 24, fontWeight: '900', color: '#211B2C' },
  ringValue: { fontSize: 16, fontWeight: '900', color: '#2D2A3D' },
  ringLabel: { fontSize: 11, fontWeight: '700', color: '#7A728B' },
  summary: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 14, padding: 12, borderRadius: 14, backgroundColor: '#F5F1FF' },
  summaryText: { flex: 1, fontSize: 13, lineHeight: 20, fontWeight: '600', color: '#4A4458' },
  factRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 },
  fact: { flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 6, borderRadius: 10, backgroundColor: '#F6F5FA' },
  factText: { fontSize: 12, fontWeight: '700', color: '#5C5670' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { backgroundColor: '#EEE8FF', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  pillText: { color: '#5B42D8', fontWeight: '800', fontSize: 12 },
  sectionRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 },
  sectionHint: { fontSize: 11, color: '#8A8294', fontWeight: '600' },
  stepRow: { flexDirection: 'row', alignItems: 'stretch', gap: 12 },
  stepRail: { width: 28, alignItems: 'center' },
  stepDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#CFC6EE', backgroundColor: '#FFFFFF' },
  stepDotDone: { backgroundColor: '#2E9D5C', borderColor: '#2E9D5C' },
  stepNumber: { fontSize: 12, fontWeight: '900', color: '#5B42D8' },
  stepLine: { flex: 1, width: 2, minHeight: 10, backgroundColor: '#E6E1F3', marginVertical: 3 },
  stepLineDone: { backgroundColor: '#9ED8B7' },
  stepCopy: { flex: 1, minWidth: 0, paddingBottom: 14 },
  stepText: { fontSize: 14, lineHeight: 20, fontWeight: '700', color: '#2D2A3D', marginTop: 3 },
  stepTextDone: { color: '#2E9D5C', textDecorationLine: 'line-through' },
  dueChip: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start', gap: 4, marginTop: 5 },
  dueText: { fontSize: 11, fontWeight: '700', color: '#6E6887' },
  doneText: { color: '#2E9D5C' },
  milestone: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 4, padding: 12, borderRadius: 16, backgroundColor: '#F5F1FF' },
  watchOut: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 10, padding: 12, borderRadius: 16, backgroundColor: '#FFF7E8' },
  calloutIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFFFFF' },
  watchOutIcon: { backgroundColor: '#FFFFFF' },
  calloutCopy: { flex: 1, minWidth: 0 },
  calloutLabel: { fontSize: 11, fontWeight: '900', letterSpacing: 0.8, color: '#5B42D8' },
  watchOutLabel: { color: '#A0661A' },
  calloutText: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#3B3650', marginTop: 3 },
  watchOutAction: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#5C5670', marginTop: 6 },
  watchOutActionStrong: { fontWeight: '900', color: '#3B3650' },
  saveButton: { flex: 0, marginTop: 16 },
  savedRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 16, minHeight: 48, paddingHorizontal: 14, borderRadius: 14, backgroundColor: '#EAF8F0' },
  savedText: { flex: 1, fontSize: 14, fontWeight: '800', color: '#23774A' },
  savedLink: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  howRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 12, marginTop: 14 },
  howIcon: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0EBFF' },
  howTitle: { fontSize: 14, fontWeight: '800', color: '#2D2A3D' },
  goalList: { gap: 0 },
  emptyCard: { alignItems: 'center', paddingVertical: 26 },
  emptyIcon: { width: 54, height: 54, borderRadius: 18, alignItems: 'center', justifyContent: 'center', backgroundColor: '#EEE8FF', marginBottom: 12 },
  emptyTitle: { fontSize: 17, fontWeight: '800', color: '#201A2A', textAlign: 'center' },
  emptyText: { fontSize: 13, lineHeight: 19, fontWeight: '600', color: '#6B6377', textAlign: 'center', marginTop: 6, maxWidth: 300 },
  emptyButton: { flex: 0, marginTop: 16, alignSelf: 'stretch' },
  goalHeader: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
  goalIcon: { width: 40, height: 40, borderRadius: 13, alignItems: 'center', justifyContent: 'center', backgroundColor: '#F0EBFF' },
  goalMeta: { fontSize: 11, fontWeight: '800', color: '#7A6AE7', letterSpacing: 0.3 },
  goalTitle: { fontSize: 16, lineHeight: 21, fontWeight: '900', color: '#201A2A', marginTop: 3 },
  deleteButton: { width: 36, height: 36, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: '#FFF0F1' },
  progressRow: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14 },
  progressTrack: { flex: 1, height: 8, borderRadius: 4, overflow: 'hidden', backgroundColor: '#EEEAF6' },
  progressFill: { height: '100%', borderRadius: 4, backgroundColor: '#5B42D8' },
  progressFillDone: { backgroundColor: '#2E9D5C' },
  progressText: { fontSize: 12, fontWeight: '900', color: '#3B3650' },
  statusChip: { paddingHorizontal: 9, paddingVertical: 5, borderRadius: 999, backgroundColor: '#F0EBFF' },
  statusChipDone: { backgroundColor: '#EAF8F0' },
  statusText: { fontSize: 11, fontWeight: '800', color: '#5B42D8' },
  statusTextDone: { color: '#23774A' },
  nextRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8, marginTop: 12 },
  nextText: { flex: 1, fontSize: 13, lineHeight: 19, fontWeight: '700', color: '#3B3650' },
  goalSteps: { marginTop: 14 },
  expandButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 4, minHeight: 40, marginTop: 10, borderTopWidth: 1, borderTopColor: '#F0EEF5' },
  expandText: { fontSize: 13, fontWeight: '800', color: '#5B42D8' },
  snackbar: { position: 'absolute', left: 16, right: 16, bottom: 96, minHeight: 52, borderRadius: 14, backgroundColor: '#30215A', flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, shadowColor: '#20152F', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  snackbarText: { flex: 1, color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
  snackbarButton: { color: '#FFFFFF', fontSize: 13, fontWeight: '900', textDecorationLine: 'underline' },
}, {
  // Dark mode: the hero keeps its deep purple, the selected choice sits a step above its track.
  hero: { flexDirection: 'row', alignItems: 'center', gap: 14, backgroundColor: '#30215A', borderRadius: 24, padding: 20, marginBottom: 14 },
  choiceOptionActive: { backgroundColor: '#3A3150', shadowColor: '#000000', shadowOpacity: 0.2, shadowRadius: 6, shadowOffset: { width: 0, height: 2 }, elevation: 2 },
  calloutIcon: { width: 30, height: 30, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#2B2540' },
  watchOutIcon: { backgroundColor: '#3A2E1A' },
  watchOut: { flexDirection: 'row', alignItems: 'flex-start', gap: 10, marginTop: 10, padding: 12, borderRadius: 16, backgroundColor: '#2E2617' },
  stepDot: { width: 28, height: 28, borderRadius: 14, alignItems: 'center', justifyContent: 'center', borderWidth: 2, borderColor: '#4A3F6B', backgroundColor: '#1B1823' },
  snackbar: { position: 'absolute', left: 16, right: 16, bottom: 96, minHeight: 52, borderRadius: 14, backgroundColor: '#4B32C0', flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, shadowColor: '#000000', shadowOpacity: 0.3, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
});
