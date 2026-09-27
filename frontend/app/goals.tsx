import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import React, { useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, useWindowDimensions, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { useAppDialog } from '@/components/ui/app-dialog';
import { getApiBaseUrl, getAuthenticatedHeaders } from '@/authentication';
import { useAppColorScheme, type Goal } from '@/hooks/color-scheme-context';

type GoalTab = 'Planner' | 'My Goals';

type GoalInsight = Goal;

const samplePrompts = [
  'I want to become healthier by being more consistent with exercise, sleep, and meal planning.',
  'I want to grow in my career by improving my confidence, skills, and professional habits.',
  'I want to save more money and build a better financial routine this year.',
  'I want to become more disciplined and focused in my studies and personal growth.',
];

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

  const goalPhrase = title.toLowerCase();
  const nextCheckIn = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
  const subject = (title.match(/(?:in|for|with|on)\s+([^,.!?]+)/i)?.[1] || title)
    .replace(/^i want to (become|be|improve|learn|build|save|grow)\s+/i, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 46);
  const dueDates = [0, 1, 3, 7].map((days) => new Date(Date.now() + days * 24 * 60 * 60 * 1000).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }));
  const actionPlan = [
    `Choose one measurable ${subject} outcome for this week.`,
    `Complete one focused 20-minute ${subject} session.`,
    `Review what helped or blocked your ${subject} progress.`,
    `Set a reminder for your next ${subject} session.`,
  ];

  const focusAreas = [
    focusFromInput[0],
    focusFromInput[1],
    focusFromInput[2],
  ];

  const nextMilestone = `Finish one meaningful milestone this week for ${title.toLowerCase()}.`;

  const summary = `This goal is strong because it is specific, meaningful, and realistic enough to sustain momentum. The right move is to make the plan visible and repeatable.`;

  return {
    id: `${Date.now()}`,
    title: title.length > 50 ? `${title.slice(0, 47)}...` : title,
    category,
    summary,
    intensity,
    focusAreas,
    actionPlan,
    actionDueDates: dueDates,
    nextMilestone,
    risk: 'Losing focus when tasks pile up or motivation drops for a few days.',
    riskAction: `If tasks pile up, pause and complete only the smallest next action for ${goalPhrase} before rescheduling the rest.`,
    timeline,
    focusTarget,
    nextCheckIn,
    completedSteps: [false, false, false, false],
    progress: 0,
    status: 'Fresh plan',
  };
};

const formatProgress = (progress: number) => `${Math.max(0, Math.min(100, progress))}%`;
const getProgressFromSteps = (completedSteps: boolean[]) => Math.round((completedSteps.filter(Boolean).length / 4) * 100);
const getGoalStatus = (progress: number) => progress >= 100 ? 'Completed' : progress >= 67 ? 'On track' : progress > 0 ? 'In progress' : 'Fresh plan';

export default function GoalsScreen() {
  const showAlert = useAppDialog();
  const { isDarkMode } = useAppColorScheme();
  const { width } = useWindowDimensions();
  const compact = width < 380;
  const [activeTab, setActiveTab] = useState<GoalTab>('Planner');
  const [goalInput, setGoalInput] = useState('');
  const [generatedGoal, setGeneratedGoal] = useState<GoalInsight | null>(null);
  const { goals: savedGoals, updateGoals } = useAppColorScheme();
  const [saveConfirmationVisible, setSaveConfirmationVisible] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [clearConfirmationVisible, setClearConfirmationVisible] = useState(false);
  const [clearUndoText, setClearUndoText] = useState<string | null>(null);
  const [expandedSteps, setExpandedSteps] = useState<Record<string, boolean>>({});
  const [focusTarget, setFocusTarget] = useState('4 habits');
  const [timelineOption, setTimelineOption] = useState('30-60 days');

  const activeGoal = useMemo(() => {
    const currentGoal = generatedGoal ?? savedGoals[0] ?? null;
    if (!currentGoal) return null;
    return savedGoals.find((goal) => goal.id === currentGoal.id) ?? currentGoal;
  }, [generatedGoal, savedGoals]);

  useEffect(() => {
    if (!clearUndoText) return;
    const timeout = setTimeout(() => setClearUndoText(null), 5000);
    return () => clearTimeout(timeout);
  }, [clearUndoText]);

  const createInsight = async () => {
    if (!goalInput.trim()) {
      showAlert('Goal prompt required', 'Write the goal you want to improve or pursue first.');
      return;
    }

    const input = goalInput.trim();
    const apiUrl = getApiBaseUrl();
    setIsGenerating(true);

    if (!apiUrl) {
      showAlert('AI planner unavailable', 'Connect the backend before generating a goal plan.');
      setIsGenerating(false);
      return;
    }

    try {
        const authHeaders = await getAuthenticatedHeaders();
        const response = await fetch(`${apiUrl}/api/goals/generate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders },
          body: JSON.stringify({ goal: input, focusTarget, timeline: timelineOption }),
        });

        if (!response.ok) throw new Error('Goal generation request failed.');
        const payload = await response.json();
        const plan = payload.plan as Partial<GoalInsight>;
        const nextGoal: GoalInsight = {
          ...buildGoalInsight(input, timelineOption, focusTarget),
          ...plan,
          id: `${Date.now()}`,
          title: input.length > 50 ? `${input.slice(0, 47)}...` : input,
          focusTarget,
          timeline: timelineOption,
          completedSteps: [false, false, false, false],
          actionDueDates: plan.actionDueDates ?? buildGoalInsight(input, timelineOption, focusTarget).actionDueDates,
          progress: 0,
          status: 'Fresh plan',
        } as GoalInsight;
        setGeneratedGoal(nextGoal);
        setActiveTab('Planner');
        setIsGenerating(false);
        return;
    } catch {
      showAlert('AI planner unavailable', 'The backend could not generate this plan. Nothing was saved.');
      setIsGenerating(false);
      return;
    }
  };

  const saveGoal = () => {
    if (!activeGoal) {
      showAlert('No plan generated yet', 'Generate a plan before saving it.');
      return;
    }

    const goalToSave: GoalInsight = {
      ...activeGoal,
      id: activeGoal.id || `${Date.now()}`,
      progress: getProgressFromSteps(activeGoal.completedSteps),
      status: getGoalStatus(getProgressFromSteps(activeGoal.completedSteps)),
    };

    updateGoals((previous) => {
      const exists = previous.some((goal) => goal.title === goalToSave.title);
      if (exists) return previous;
      return [goalToSave, ...previous];
    });

    setSaveConfirmationVisible(true);
  };

  const confirmClearGoal = () => {
    const previousText = goalInput;
    setGoalInput('');
    setClearConfirmationVisible(false);
    setClearUndoText(previousText);
  };

  const deleteGoal = (goalId: string) => {
    showAlert('Delete goal', 'Remove this goal from your saved list?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: () => {
          updateGoals((previous) => previous.filter((goal) => goal.id !== goalId));
          if (generatedGoal && generatedGoal.id === goalId) {
            setGeneratedGoal(null);
          }
        },
      },
    ]);
  };

  const toggleStep = (goalId: string, stepIndex: number) => {
    updateGoals((previous) =>
      previous.map((goal) => {
        if (goal.id !== goalId) return goal;
        const completedSteps = goal.completedSteps.map((completed, index) => index === stepIndex ? !completed : completed);
        const progress = getProgressFromSteps(completedSteps);
        return { ...goal, completedSteps, progress, status: getGoalStatus(progress) };
      }),
    );

    if (generatedGoal && generatedGoal.id === goalId) {
      const completedSteps = generatedGoal.completedSteps.map((completed, index) => index === stepIndex ? !completed : completed);
      const progress = getProgressFromSteps(completedSteps);
      setGeneratedGoal({ ...generatedGoal, completedSteps, progress, status: getGoalStatus(progress) });
    }
  };

  const quickActions = [
    { label: 'Week plan', value: 'Focus on 3 small wins this week.', icon: 'calendar-outline' },
    { label: 'Daily action', value: 'Do the first step before noon.', icon: 'flash-outline' },
    { label: 'Accountability', value: 'Review progress every evening.', icon: 'checkmark-done-outline' },
  ];

  return (
    <>
      <StatusBar style={isDarkMode ? 'light' : 'dark'} />
      <SafeAreaView style={[styles.screen, isDarkMode && styles.darkScreen]}>
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          <View style={[styles.container, { paddingHorizontal: width < 420 ? 16 : 22 }]}>
            <View style={styles.headerRow}>
              <Pressable style={styles.backButton} onPress={() => router.back()} accessibilityLabel="Go back">
                <Ionicons name="chevron-back" size={22} color={isDarkMode ? '#F2EFF8' : '#25212C'} />
              </Pressable>
              <View style={styles.headerTitleWrap}>
                <Text style={[styles.headerEyebrow, isDarkMode && styles.darkMutedText]}>MYGOALS</Text>
                <Text style={[styles.headerTitle, isDarkMode && styles.darkText]}>Personal Growth</Text>
              </View>
              <View style={styles.headerSpacer} />
            </View>

            <View style={[styles.heroCard, isDarkMode && styles.darkCard]}>
              <View style={styles.heroHeader}>
                <View style={styles.heroHeaderText}>
                  <Text style={[styles.kicker, isDarkMode && styles.darkMutedText]}>AI Goal Builder</Text>
                  <Text style={[styles.heroTitle, compact && styles.compactHeroTitle, isDarkMode && styles.darkText]}>Turn your dream into a plan.</Text>
                </View>
                <View style={styles.aiBadge}>
                  <Ionicons name="sparkles" size={14} color="#FFFFFF" />
                </View>
              </View>

              <View style={styles.heroStatsRow}>
                <View style={[styles.heroStat, isDarkMode && styles.darkHeroStat]}>
                  <Text style={[styles.heroStatLabel, isDarkMode && styles.darkMutedText]}>Effort</Text>
                  <Text style={[styles.heroStatValue, !activeGoal && styles.placeholderStatValue, isDarkMode && styles.darkText]}>{activeGoal?.intensity ?? '--'}</Text>
                </View>
                <View style={[styles.heroStat, isDarkMode && styles.darkHeroStat]}>
                  <Text style={[styles.heroStatLabel, isDarkMode && styles.darkMutedText]}>Focus</Text>
                  <Text style={[styles.heroStatValue, !activeGoal && styles.placeholderStatValue, isDarkMode && styles.darkText]}>{activeGoal?.focusTarget ?? '--'}</Text>
                </View>
                <View style={[styles.heroStat, isDarkMode && styles.darkHeroStat]}>
                  <Text style={[styles.heroStatLabel, isDarkMode && styles.darkMutedText]}>Time</Text>
                  <Text style={[styles.heroStatValue, !activeGoal && styles.placeholderStatValue, isDarkMode && styles.darkText]}>{activeGoal?.timeline ?? '--'}</Text>
                </View>
              </View>

              <View style={[styles.tabRow, isDarkMode && styles.darkTabRow]}>
                {(['Planner', 'My Goals'] as const).map((tab) => (
                  <Pressable key={tab} style={[styles.tabButton, activeTab === tab && styles.activeTabButton]} onPress={() => setActiveTab(tab)}>
                    <Text style={[styles.tabText, activeTab === tab && styles.activeTabText, isDarkMode && styles.darkTabText]}>{tab}</Text>
                  </Pressable>
                ))}
              </View>
            </View>

            {activeTab === 'Planner' ? (
              <>
                <View style={[styles.inputCard, isDarkMode && styles.darkCard]}>
                    <View style={styles.inputHeaderRow}>
                    <View>
                      <Text style={[styles.sectionTitle, isDarkMode && styles.darkText]}>What are you working toward?</Text>
                      <Text style={[styles.sectionHint, isDarkMode && styles.darkMutedText]}>Describe it in your own words.</Text>
                    </View>
                    <Pressable style={styles.modePill} onPress={() => showAlert('Live AI suggestions', 'Your goal is analyzed when you tap Generate plan. Nothing is sent until you submit it.')} accessibilityLabel="Explain live AI suggestions">
                      <View style={styles.liveDot} />
                      <Text style={styles.modePillText}>AI-ready</Text>
                    </Pressable>
                  </View>

                  <TextInput
                    value={goalInput}
                    onChangeText={setGoalInput}
                    maxLength={500}
                    multiline
                    placeholder="Example: I want to become healthier, more disciplined, and consistent with my fitness routine."
                    placeholderTextColor={isDarkMode ? '#A6A1AF' : '#8A8397'}
                    style={[styles.textInput, isDarkMode && styles.darkInput]}
                  />

                  <View style={styles.inputMetaRow}>
                    <Text style={[styles.inputGuidance, isDarkMode && styles.darkMutedText]}>Add the outcome, context, and routine you want to build.</Text>
                    <Text style={[styles.characterCount, isDarkMode && styles.darkMutedText]}>{goalInput.length}/500</Text>
                  </View>

                  <View style={styles.customizeRow}>
                    <Text style={[styles.customizeLabel, isDarkMode && styles.darkText]}>Plan settings</Text>
                    <View style={styles.customizeControls}>
                      <Pressable style={styles.settingControl} onPress={() => setFocusTarget(focusTarget === '3 habits' ? '4 habits' : focusTarget === '4 habits' ? '5 habits' : '3 habits')}>
                        <Ionicons name="locate-outline" size={14} color="#5B42D8" />
                        <Text style={styles.settingControlText}>{focusTarget}</Text>
                      </Pressable>
                      <Pressable style={styles.settingControl} onPress={() => setTimelineOption(timelineOption === '7-14 days' ? '30-60 days' : timelineOption === '30-60 days' ? '90 days' : '7-14 days')}>
                        <Ionicons name="calendar-outline" size={14} color="#5B42D8" />
                        <Text style={styles.settingControlText}>{timelineOption}</Text>
                      </Pressable>
                    </View>
                  </View>

                  <View style={styles.quickPromptRow}>
                    {samplePrompts.map((prompt) => (
                      <Pressable key={prompt} style={[styles.quickPromptChip, isDarkMode && styles.darkPromptChip]} onPress={() => setGoalInput(prompt)}>
                        <Ionicons name="add-circle-outline" size={14} color="#5B42D8" />
                        <Text style={[styles.quickPromptText, isDarkMode && styles.darkPromptText]}>{prompt}</Text>
                      </Pressable>
                    ))}
                  </View>

                  <View style={styles.actionRow}>
                    <Pressable style={styles.secondaryButton} onPress={() => {
                      if (goalInput.trim()) setClearConfirmationVisible(true);
                    }}>
                      <Text style={styles.secondaryButtonText}>Clear</Text>
                    </Pressable>
                    <Pressable style={styles.primaryButton} onPress={createInsight} disabled={isGenerating}>
                      {isGenerating ? <ActivityIndicator size="small" color="#FFFFFF" /> : <Ionicons name="sparkles-outline" size={17} color="#FFFFFF" />}
                      <Text style={styles.primaryButtonText}>{isGenerating ? 'Creating plan...' : 'Generate plan'}</Text>
                    </Pressable>
                  </View>
                </View>

                {!activeGoal && !savedGoals.length ? (
                  <View style={[styles.emptyStateCard, isDarkMode && styles.darkCard]}>
                    <View style={styles.emptyIconWrap}>
                      <Ionicons name="flag-outline" size={26} color="#5B42D8" />
                    </View>
                    <Text style={[styles.emptyTitle, isDarkMode && styles.darkText]}>No goal plan yet</Text>
                    <Text style={[styles.emptyBody, isDarkMode && styles.darkMutedText]}>
                      Write a personal goal and let the planner turn it into a realistic action plan for you.
                    </Text>
                    <Pressable style={styles.emptyStateButton} onPress={() => setGoalInput(samplePrompts[0])}>
                      <Ionicons name="create-outline" size={16} color="#FFFFFF" />
                      <Text style={styles.emptyStateButtonText}>Use a starter goal</Text>
                    </Pressable>
                  </View>
                ) : null}

                {activeGoal ? (
                  <View style={[styles.resultCard, isDarkMode && styles.darkCard]}>
                    <View style={styles.resultGlow} />

                    <View style={styles.resultHeader}>
                      <View style={styles.resultTitleWrap}>
                        <Text style={[styles.resultCategory, isDarkMode && styles.darkMutedText]}>{activeGoal.category}</Text>
                        <Text style={[styles.resultTitle, isDarkMode && styles.darkText]}>{activeGoal.title}</Text>
                      </View>
                      <View style={styles.scoreBadge}>
                        <Text style={styles.scoreBadgeLabel}>Action plan</Text>
                        <Text style={styles.scoreBadgeText}>{activeGoal.actionPlan.length} steps</Text>
                      </View>
                    </View>

                    <View style={styles.summaryBanner}>
                      <Ionicons name="sparkles" size={15} color="#5B42D8" />
                      <Text style={[styles.summaryText, isDarkMode && styles.darkMutedText]}>{activeGoal.summary}</Text>
                    </View>

                    <View style={styles.metricRow}>
                      <View style={[styles.metricCard, isDarkMode && styles.darkMetricCard]}>
                        <Text style={[styles.metricLabel, isDarkMode && styles.darkMutedText]}>Focus areas</Text>
                        <Text style={[styles.metricValue, isDarkMode && styles.darkText]}>{activeGoal.focusAreas.length}</Text>
                      </View>
                      <View style={[styles.metricCard, isDarkMode && styles.darkMetricCard]}>
                        <Text style={[styles.metricLabel, isDarkMode && styles.darkMutedText]}>Timeline</Text>
                        <Text style={[styles.metricValue, isDarkMode && styles.darkText]}>{activeGoal.timeline}</Text>
                      </View>
                      <View style={[styles.metricCard, isDarkMode && styles.darkMetricCard]}>
                        <Text style={[styles.metricLabel, isDarkMode && styles.darkMutedText]}>Status</Text>
                        <Text style={[styles.metricValue, isDarkMode && styles.darkText]}>{activeGoal.status}</Text>
                      </View>
                    </View>

                    <View style={styles.analysisPanel}>
                      <View style={styles.panelHeaderRow}>
                        <Text style={[styles.panelTitle, isDarkMode && styles.darkText]}>Focus areas</Text>
                        <View style={styles.panelTag}>
                          <Text style={styles.panelTagText}>{activeGoal.intensity}</Text>
                        </View>
                      </View>
                      <View style={styles.pillRow}>
                        {activeGoal.focusAreas.map((focus) => (
                          <View key={focus} style={styles.pill}>
                            <Text style={styles.pillText}>{focus}</Text>
                          </View>
                        ))}
                      </View>
                    </View>

                    <View style={styles.analysisPanel}>
                      <Text style={[styles.panelTitle, isDarkMode && styles.darkText]}>AI insight</Text>
                      <Text style={[styles.panelBody, isDarkMode && styles.darkMutedText]}>{activeGoal.summary}</Text>
                    </View>

                    <View style={styles.analysisPanel}>
                      <View style={styles.panelHeaderRow}>
                        <View>
                          <Text style={[styles.panelTitle, isDarkMode && styles.darkText]}>Action plan</Text>
                          <Text style={[styles.panelHint, isDarkMode && styles.darkMutedText]}>Check off each step to update your growth path.</Text>
                        </View>
                        <Text style={[styles.stepCount, isDarkMode && styles.darkMutedText]}>{activeGoal.completedSteps.filter(Boolean).length}/4</Text>
                      </View>
                      {activeGoal.actionPlan.map((step, index) => (
                        <Pressable key={`${step}-${index}`} style={styles.stepRow} onPress={() => toggleStep(activeGoal.id, index)} accessibilityRole="checkbox" accessibilityState={{ checked: activeGoal.completedSteps[index] }}>
                          <View style={[styles.stepNumber, activeGoal.completedSteps[index] && styles.stepNumberComplete]}>
                            <Ionicons name={activeGoal.completedSteps[index] ? 'checkmark' : 'ellipse-outline'} size={activeGoal.completedSteps[index] ? 15 : 12} color="#FFFFFF" />
                          </View>
                          <View style={styles.stepCopy}>
                            <Text style={[styles.stepText, activeGoal.completedSteps[index] && styles.stepTextComplete, isDarkMode && styles.darkMutedText]} numberOfLines={expandedSteps[`${activeGoal.id}-${index}`] ? undefined : 2}>{step}</Text>
                            <View style={styles.stepMetaRow}>
                              <Text style={[styles.stepDueDate, isDarkMode && styles.darkMutedText]}>Due {activeGoal.actionDueDates[index]}</Text>
                              {step.length > 70 ? <Pressable onPress={() => setExpandedSteps((previous) => ({ ...previous, [`${activeGoal.id}-${index}`]: !previous[`${activeGoal.id}-${index}`] }))}><Text style={styles.expandStepText}>{expandedSteps[`${activeGoal.id}-${index}`] ? 'Show less' : 'Show more'}</Text></Pressable> : null}
                            </View>
                          </View>
                        </Pressable>
                      ))}
                    </View>

                    <View style={styles.analysisPanel}>
                      <View style={styles.panelHeaderRow}>
                        <Text style={[styles.panelTitle, isDarkMode && styles.darkText]}>Next milestone</Text>
                        <View style={styles.dateChip}><Ionicons name="calendar-outline" size={12} color="#5B42D8" /><Text style={styles.dateChipText}>{activeGoal.nextCheckIn}</Text></View>
                      </View>
                      <Text style={[styles.panelBody, isDarkMode && styles.darkMutedText]}>{activeGoal.nextMilestone}</Text>
                      <Text style={[styles.panelBody, isDarkMode && styles.darkMutedText]}>Risk to watch: {activeGoal.risk}</Text>
                      <View style={styles.riskAction}><Ionicons name="shield-checkmark-outline" size={15} color="#2E9D5C" /><Text style={[styles.riskActionText, isDarkMode && styles.darkMutedText]}>{activeGoal.riskAction}</Text></View>
                    </View>

                    <View style={[styles.progressWrap, isDarkMode && styles.darkProgressWrap]}>
                      <View style={styles.progressHeader}>
                        <View style={styles.progressHeadingGroup}>
                          <View style={styles.progressTitleIcon}>
                            <Ionicons name="map-outline" size={15} color="#5B42D8" />
                          </View>
                          <View>
                            <Text style={[styles.panelTitle, styles.progressTitle, isDarkMode && styles.darkText]}>Your growth path</Text>
                            <Text style={[styles.progressSubtitle, isDarkMode && styles.darkMutedText]}>Move forward one stage at a time</Text>
                          </View>
                        </View>
                        <Text style={[styles.progressValue, isDarkMode && styles.darkText]}>{formatProgress(activeGoal.progress)}</Text>
                      </View>

                      <View style={styles.stageRow}>
                        {[
                          { label: 'Start', threshold: 0, range: '0-33%', icon: 'flag-outline' },
                          { label: 'Build', threshold: 34, range: '34-66%', icon: 'construct-outline' },
                          { label: 'Grow', threshold: 67, range: '67-100%', icon: 'trophy-outline' },
                        ].map((stage) => {
                          const reached = activeGoal.progress >= stage.threshold;
                          return (
                            <View key={stage.label} style={styles.stageItem}>
                              <View style={[styles.stageDot, reached && styles.stageDotActive]}>
                                <Ionicons name={stage.icon as keyof typeof Ionicons.glyphMap} size={14} color={reached ? '#FFFFFF' : '#A69DB8'} />
                              </View>
                              <Text style={[styles.stageLabel, reached && styles.stageLabelActive, isDarkMode && styles.darkMutedText]}>{stage.label}</Text>
                              <Text style={[styles.stageRange, isDarkMode && styles.darkMutedText]}>{stage.range}</Text>
                            </View>
                          );
                        })}
                      </View>

                      <View style={styles.stageTrack}>
                        <View style={[styles.stageTrackFill, { width: `${activeGoal.progress}%` }]} />
                        <Text style={[styles.trackLabel, activeGoal.progress > 45 && styles.trackLabelOnFill]}>{formatProgress(activeGoal.progress)}</Text>
                      </View>

                      <View style={[styles.progressSummaryCard, isDarkMode && styles.darkProgressSummaryCard]}>
                        <View style={styles.progressSummaryIcon}>
                          <Ionicons name="arrow-forward-outline" size={15} color="#5B42D8" />
                        </View>
                        <View style={styles.progressSummaryCopy}>
                          <Text style={[styles.progressSummaryLabel, isDarkMode && styles.darkText]}>Next step</Text>
                          <Text style={[styles.progressSummaryText, isDarkMode && styles.darkMutedText]}>Keep momentum by updating your progress daily.</Text>
                        </View>
                      </View>

                    </View>

                    <Pressable style={[styles.primaryButton, styles.saveGoalButton]} onPress={saveGoal}>
                      <Ionicons name="bookmark-outline" size={17} color="#FFFFFF" />
                      <Text style={styles.primaryButtonText}>Save goal</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : (
              <View style={styles.goalBoard}>
                {!savedGoals.length ? (
                  <View style={[styles.emptyStateCard, isDarkMode && styles.darkCard]}>
                    <View style={styles.emptyIconWrap}>
                      <Ionicons name="bookmark-outline" size={26} color="#5B42D8" />
                    </View>
                    <Text style={[styles.emptyTitle, isDarkMode && styles.darkText]}>Your saved goals will appear here</Text>
                    <Text style={[styles.emptyBody, isDarkMode && styles.darkMutedText]}>
                      Once you save a goal plan, it stays here so you can track progress and adjust it over time.
                    </Text>
                  </View>
                ) : null}

                {savedGoals.map((goal) => (
                  <View key={goal.id} style={[styles.goalCard, isDarkMode && styles.darkCard]}>
                    <View style={styles.goalCardHeader}>
                      <View style={styles.goalCardTitleWrap}>
                        <Text style={[styles.goalCardCategory, isDarkMode && styles.darkMutedText]}>{goal.category}</Text>
                        <Text style={[styles.goalCardTitle, isDarkMode && styles.darkText]}>{goal.title}</Text>
                      </View>
                      <View style={[styles.statusChip, goal.progress >= 70 ? styles.statusChipGood : styles.statusChipNeutral]}>
                        <Text style={[styles.statusChipText, goal.progress >= 70 ? styles.statusTextGood : styles.statusTextNeutral]}>{goal.status}</Text>
                      </View>
                      <Pressable style={styles.cardDeleteButton} onPress={() => deleteGoal(goal.id)} accessibilityLabel="Delete goal">
                        <Ionicons name="trash-outline" size={16} color="#D94E64" />
                      </Pressable>
                    </View>

                    <View style={styles.progressBar}>
                      <View style={[styles.progressFill, { width: `${goal.progress}%` }]} />
                      <Text style={[styles.trackLabel, goal.progress > 45 && styles.trackLabelOnFill]}>{formatProgress(goal.progress)}</Text>
                    </View>

                    <Text style={[styles.progressMeta, isDarkMode && styles.darkMutedText]}>{formatProgress(goal.progress)} complete</Text>

                    <View style={styles.goalMetaRow}>
                      <View style={styles.metaItem}>
                        <Ionicons name="timer-outline" size={14} color="#7A6AE7" />
                        <Text style={[styles.metaText, isDarkMode && styles.darkMutedText]}>{goal.timeline}</Text>
                      </View>
                      <View style={styles.metaItem}>
                        <Ionicons name="flash-outline" size={14} color="#7A6AE7" />
                        <Text style={[styles.metaText, isDarkMode && styles.darkMutedText]}>{goal.intensity}</Text>
                      </View>
                    </View>

                    <View style={styles.savedStepsList}>
                      {goal.actionPlan.map((step, index) => (
                        <Pressable key={`${goal.id}-${index}`} style={styles.savedStepRow} onPress={() => toggleStep(goal.id, index)} accessibilityRole="checkbox" accessibilityState={{ checked: goal.completedSteps[index] }}>
                          <View style={[styles.savedStepCheck, goal.completedSteps[index] && styles.savedStepCheckActive]}>
                            {goal.completedSteps[index] ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : null}
                          </View>
                          <View style={styles.stepCopy}>
                            <Text style={[styles.savedStepText, goal.completedSteps[index] && styles.savedStepTextComplete, isDarkMode && styles.darkMutedText]} numberOfLines={expandedSteps[`${goal.id}-${index}`] ? undefined : 2}>{step}</Text>
                            <Text style={[styles.stepDueDate, isDarkMode && styles.darkMutedText]}>Due {goal.actionDueDates[index]}</Text>
                          </View>
                        </Pressable>
                      ))}
                    </View>

                  </View>
                ))}

                <View style={[styles.quickTipsCard, isDarkMode && styles.darkCard]}>
                  <Text style={[styles.panelTitle, isDarkMode && styles.darkText]}>Daily reminders</Text>
                  {quickActions.map((item) => (
                    <View key={item.label} style={styles.tipRow}>
                      <View style={styles.tipIcon}><Ionicons name={item.icon as keyof typeof Ionicons.glyphMap} size={15} color="#5B42D8" /></View>
                      <View style={styles.tipCopy}>
                        <Text style={[styles.tipLabel, isDarkMode && styles.darkText]}>{item.label}</Text>
                        <Text style={[styles.tipValue, isDarkMode && styles.darkMutedText]}>{item.value}</Text>
                      </View>
                    </View>
                  ))}
                </View>
              </View>
            )}
          </View>
        </ScrollView>
      </SafeAreaView>
      <Modal
        visible={saveConfirmationVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setSaveConfirmationVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.saveModal, isDarkMode && styles.darkSaveModal]}>
            <View style={styles.saveIconWrap}>
              <Ionicons name="checkmark" size={26} color="#FFFFFF" />
            </View>
            <Text style={[styles.saveModalTitle, isDarkMode && styles.darkText]}>Goal saved</Text>
            <Text style={[styles.saveModalBody, isDarkMode && styles.darkMutedText]}>
              Your plan is ready in My Goals. Keep building momentum one small step at a time.
            </Text>

            <View style={styles.saveModalActions}>
              <Pressable
                style={[styles.saveModalButton, styles.saveModalSecondaryButton, isDarkMode && styles.darkSaveModalSecondaryButton]}
                onPress={() => setSaveConfirmationVisible(false)}
              >
                <Text style={[styles.saveModalSecondaryText, isDarkMode && styles.darkSaveModalSecondaryText]}>Stay here</Text>
              </Pressable>
              <Pressable
                style={[styles.saveModalButton, styles.saveModalPrimaryButton]}
                onPress={() => {
                  setSaveConfirmationVisible(false);
                  setActiveTab('My Goals');
                }}
              >
                <Text style={styles.saveModalPrimaryText}>View goals</Text>
                <Ionicons name="arrow-forward" size={16} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      <Modal
        visible={clearConfirmationVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setClearConfirmationVisible(false)}
      >
        <View style={styles.modalBackdrop}>
          <View style={[styles.clearModal, isDarkMode && styles.darkSaveModal]}>
            <View style={styles.clearModalIcon}>
              <Ionicons name="document-text-outline" size={22} color="#5B42D8" />
            </View>
            <Text style={[styles.saveModalTitle, isDarkMode && styles.darkText]}>Clear goal text?</Text>
            <Text style={[styles.saveModalBody, isDarkMode && styles.darkMutedText]}>
              This clears the text in the goal field only. Your saved goal plans will stay safe.
            </Text>
            <View style={styles.saveModalActions}>
              <Pressable style={[styles.saveModalButton, styles.keepEditingButton]} onPress={() => setClearConfirmationVisible(false)}>
                <Text style={styles.keepEditingText}>Keep editing</Text>
              </Pressable>
              <Pressable style={[styles.saveModalButton, styles.clearDestructiveButton]} onPress={confirmClearGoal}>
                <Text style={styles.clearDestructiveText}>Clear text</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
      {clearUndoText ? (
        <View style={[styles.undoSnackbar, isDarkMode && styles.darkUndoSnackbar]}>
          <Ionicons name="checkmark-circle-outline" size={18} color="#A9F0C7" />
          <Text style={styles.undoSnackbarText}>Goal text cleared</Text>
          <Pressable onPress={() => { setGoalInput(clearUndoText); setClearUndoText(null); }}>
            <Text style={styles.undoButtonText}>Undo</Text>
          </Pressable>
        </View>
      ) : null}
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: '#F4F1F9', paddingTop: 20 },
  darkScreen: { backgroundColor: '#0F0D16' },
  darkText: { color: '#F2EEF9' },
  darkMutedText: { color: '#B5AFC4' },
  darkCard: { backgroundColor: '#1B1823', borderColor: '#2B2433', borderWidth: 1 },
  darkInput: { backgroundColor: '#201C2B', borderColor: '#3A3246', color: '#F2EEF9' },
  darkMetricCard: { backgroundColor: '#221E2B', borderColor: '#2F2A3B' },
  darkTabRow: { backgroundColor: '#1F1B28' },
  darkProgressWrap: { backgroundColor: '#211D2B', borderColor: '#342C43' },
  darkProgressSummaryCard: { backgroundColor: '#2A2436' },
  darkTrackButtonSecondary: { backgroundColor: '#30293D' },
  darkTabText: { color: '#D7D1E0' },
  darkSaveModal: { backgroundColor: '#1B1823', borderColor: '#342C43' },
  darkSaveModalSecondaryButton: { backgroundColor: '#292331' },
  darkSaveModalSecondaryText: { color: '#D7D1E0' },
  content: { paddingBottom: 120 },
  container: { width: '100%', maxWidth: 700, alignSelf: 'center' },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 },
  backButton: { width: 38, height: 38, justifyContent: 'center', alignItems: 'center' },
  headerSpacer: { width: 38 },
  headerTitleWrap: { flex: 1, alignItems: 'center' },
  headerEyebrow: { fontSize: 9, letterSpacing: 1.8, fontWeight: '800', color: '#8A7BB5', marginBottom: 2 },
  headerTitle: { fontSize: 20, fontWeight: '800', color: '#272131' },
  heroCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, marginBottom: 14, borderWidth: 1, borderColor: '#EDE7F5' },
  heroHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start' },
  heroHeaderText: { flex: 1, paddingRight: 12 },
  kicker: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.2, color: '#7A6AE7', fontWeight: '800' },
  heroTitle: { marginTop: 6, fontSize: 26, lineHeight: 32, fontWeight: '800', color: '#201A2A' },
  compactHeroTitle: { fontSize: 23, lineHeight: 29 },
  aiBadge: { width: 36, height: 36, borderRadius: 18, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center' },
  heroStatsRow: { flexDirection: 'row', gap: 10, marginTop: 16 },
  heroStat: { flex: 1, backgroundColor: '#F7F3FF', borderRadius: 14, paddingHorizontal: 10, paddingVertical: 12 },
  darkHeroStat: { backgroundColor: '#211D2B' },
  heroStatLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1, color: '#7C718C', fontWeight: '700' },
  heroStatValue: { fontSize: 15, fontWeight: '800', color: '#201A2A', marginTop: 6 },
  placeholderStatValue: { color: '#B9B0C7' },
  tabRow: { flexDirection: 'row', backgroundColor: '#F0EBF8', borderRadius: 14, padding: 4, marginTop: 18 },
  tabButton: { flex: 1, alignItems: 'center', paddingVertical: 10, borderRadius: 11 },
  activeTabButton: { backgroundColor: '#5B42D8' },
  tabText: { fontSize: 12, fontWeight: '800', color: '#766F82' },
  activeTabText: { color: '#FFFFFF' },
  inputCard: { backgroundColor: '#FFFFFF', borderRadius: 22, padding: 18, marginBottom: 14, borderWidth: 1, borderColor: '#EDE7F5' },
  inputHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 15, fontWeight: '800', color: '#2B2432' },
  sectionHint: { fontSize: 11, color: '#8A8294', marginTop: 3 },
  modePill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: '#EEE8FF', borderRadius: 999, paddingHorizontal: 9, paddingVertical: 6 },
  modePillText: { color: '#5B42D8', fontSize: 10, fontWeight: '800' },
  liveDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: '#2E9D5C' },
  textInput: {
    minHeight: 120,
    borderWidth: 1,
    borderColor: '#E7E0F2',
    borderRadius: 16,
    backgroundColor: '#FBF9FE',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 14,
    textAlignVertical: 'top',
    fontSize: 13,
    color: '#201A2A',
    lineHeight: 20,
  },
  inputMetaRow: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10, marginTop: 7 },
  inputGuidance: { flex: 1, color: '#8A8294', fontSize: 10.5, lineHeight: 15 },
  characterCount: { color: '#8A8294', fontSize: 10.5, fontWeight: '700' },
  customizeRow: { marginTop: 15, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#EEE8F5' },
  customizeLabel: { color: '#342A45', fontSize: 11, fontWeight: '800', marginBottom: 8 },
  customizeControls: { flexDirection: 'row', gap: 8 },
  settingControl: { flex: 1, minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 5, backgroundColor: '#F2EDFF', borderRadius: 10, paddingHorizontal: 7 },
  settingControlText: { color: '#5B42D8', fontSize: 10.5, fontWeight: '800' },
  quickPromptRow: { gap: 8, marginTop: 14, marginBottom: 6 },
  quickPromptChip: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: '#F2EDFF', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 9 },
  darkPromptChip: { backgroundColor: '#2A2433' },
  quickPromptText: { flex: 1, color: '#4F3BAF', fontSize: 10.5, lineHeight: 15, fontWeight: '700' },
  darkPromptText: { color: '#D8D0F0' },
  actionRow: { flexDirection: 'row', gap: 10, marginTop: 12, marginBottom: 16 },
  primaryButton: {
    flex: 1,
    backgroundColor: '#5B42D8',
    borderRadius: 12,
    height: 46,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  primaryButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 13 },
  secondaryButton: {
    width: 100,
    backgroundColor: '#F0EBF8',
    borderRadius: 12,
    height: 46,
    alignItems: 'center',
    justifyContent: 'center',
  },
  secondaryButtonText: { color: '#473A64', fontWeight: '800', fontSize: 13 },
  resultCard: { backgroundColor: '#FFFFFF', borderRadius: 24, padding: 18, marginBottom: 16, overflow: 'hidden', position: 'relative', borderWidth: 1, borderColor: '#EDE7F5' },
  resultGlow: { position: 'absolute', top: 0, left: 0, right: 0, height: 110, backgroundColor: '#F0EAFF' },
  resultHeader: { position: 'relative', zIndex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 },
  resultTitleWrap: { flex: 1, paddingRight: 10 },
  resultCategory: { fontSize: 11, textTransform: 'uppercase', letterSpacing: 1.1, color: '#7A6AE7', fontWeight: '800' },
  resultTitle: { fontSize: 20, fontWeight: '800', color: '#211B2C', marginTop: 5 },
  scoreBadge: { backgroundColor: '#5B42D8', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 7 },
  scoreBadgeLabel: { color: '#DCD4FF', fontSize: 8, fontWeight: '800', textTransform: 'uppercase', letterSpacing: 0.4, marginBottom: 2 },
  scoreBadgeText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  summaryBanner: { position: 'relative', zIndex: 1, backgroundColor: '#F7F3FF', borderRadius: 16, padding: 12, marginBottom: 12, flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  summaryText: { flex: 1, fontSize: 12.5, lineHeight: 20, color: '#665E74', marginBottom: 0 },
  metricRow: { position: 'relative', zIndex: 1, flexDirection: 'row', gap: 10, marginBottom: 14 },
  metricCard: { flex: 1, backgroundColor: '#F8F5FF', borderRadius: 14, borderWidth: 1, borderColor: '#E9E2FF', padding: 12 },
  metricLabel: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 0.8, color: '#7B7387', fontWeight: '700' },
  metricValue: { fontSize: 13, fontWeight: '800', color: '#201A2A', marginTop: 6 },
  analysisPanel: { position: 'relative', zIndex: 1, backgroundColor: '#F9F7FC', borderRadius: 16, padding: 14, marginBottom: 12 },
  panelHeaderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  panelTag: { backgroundColor: '#EEE8FF', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  panelTagText: { color: '#5B42D8', fontSize: 9, fontWeight: '800' },
  panelTitle: { fontSize: 14, fontWeight: '800', color: '#2C2434', marginBottom: 8 },
  panelHint: { fontSize: 10.5, color: '#8A8294', marginTop: -4, marginBottom: 10 },
  stepCount: { color: '#5B42D8', fontSize: 12, fontWeight: '800' },
  panelBody: { fontFamily: 'System', fontSize: 12.5, lineHeight: 20, color: '#655F74' },
  pillRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  pill: { backgroundColor: '#EEE8FF', borderRadius: 999, paddingHorizontal: 10, paddingVertical: 7 },
  pillText: { color: '#5B42D8', fontWeight: '700', fontSize: 11 },
  stepRow: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 10 },
  stepNumber: { width: 24, height: 24, borderRadius: 12, backgroundColor: '#A79BC0', alignItems: 'center', justifyContent: 'center', marginRight: 9 },
  stepNumberComplete: { backgroundColor: '#2E9D5C' },
  stepText: { flex: 1, fontFamily: 'System', fontSize: 12.5, lineHeight: 20, color: '#655F74' },
  stepTextComplete: { color: '#2E9D5C', textDecorationLine: 'line-through' },
  stepCopy: { flex: 1 },
  stepMetaRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 4 },
  stepDueDate: { color: '#8A8294', fontSize: 10, fontWeight: '700' },
  expandStepText: { color: '#5B42D8', fontSize: 10, fontWeight: '800' },
  dateChip: { flexDirection: 'row', alignItems: 'center', gap: 4, backgroundColor: '#EEE8FF', borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  dateChipText: { color: '#5B42D8', fontSize: 9.5, fontWeight: '800' },
  riskAction: { flexDirection: 'row', alignItems: 'flex-start', gap: 7, backgroundColor: '#EFFAF3', borderRadius: 10, padding: 9, marginTop: 10 },
  riskActionText: { flex: 1, color: '#47715A', fontSize: 11.5, lineHeight: 17 },
  progressWrap: { marginTop: 8, marginBottom: 22, padding: 15, backgroundColor: '#FBF9FE', borderRadius: 18, borderWidth: 1, borderColor: '#EDE7F5' },
  progressHeader: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 },
  progressHeadingGroup: { flex: 1, flexDirection: 'row', alignItems: 'center', gap: 9 },
  progressTitleIcon: { width: 30, height: 30, borderRadius: 10, backgroundColor: '#EEE8FF', alignItems: 'center', justifyContent: 'center' },
  progressTitle: { flex: 1, marginBottom: 0 },
  progressSubtitle: { color: '#8A8294', fontSize: 10.5, marginTop: 2 },
  progressValue: { color: '#5B42D8', fontWeight: '900', fontSize: 16, marginLeft: 12 },
  stageRow: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  stageItem: { alignItems: 'center', flex: 1 },
  stageDot: { width: 32, height: 32, borderRadius: 16, backgroundColor: '#F0ECF6', borderWidth: 1, borderColor: '#E4DDEE', alignItems: 'center', justifyContent: 'center' },
  stageDotActive: { backgroundColor: '#5B42D8', borderColor: '#5B42D8' },
  stageLabel: { fontSize: 10.5, fontWeight: '700', color: '#9A92A5', marginTop: 6 },
  stageLabelActive: { color: '#5B42D8' },
  stageRange: { fontSize: 9, color: '#AAA2B4', marginTop: 2 },
  stageTrack: { height: 20, backgroundColor: '#EEE8F5', borderRadius: 999, overflow: 'hidden', marginHorizontal: 30, marginTop: -19, marginBottom: 20, justifyContent: 'center' },
  stageTrackFill: { height: '100%', backgroundColor: '#5B42D8', borderRadius: 999 },
  progressBar: { height: 22, backgroundColor: '#EEE8F5', borderRadius: 999, overflow: 'hidden', justifyContent: 'center' },
  progressFill: { height: '100%', backgroundColor: '#5B42D8', borderRadius: 999 },
  trackLabel: { position: 'absolute', left: 0, right: 0, textAlign: 'center', color: '#5B42D8', fontSize: 10, fontWeight: '900' },
  trackLabelOnFill: { color: '#FFFFFF' },
  progressSummaryCard: { marginTop: 14, backgroundColor: '#F6F2FF', borderRadius: 12, paddingHorizontal: 11, paddingVertical: 11, flexDirection: 'row', alignItems: 'center', gap: 8 },
  progressSummaryIcon: { width: 24, height: 24, borderRadius: 8, backgroundColor: '#EEE8FF', alignItems: 'center', justifyContent: 'center' },
  progressSummaryCopy: { flex: 1 },
  progressSummaryLabel: { fontSize: 11, fontWeight: '800', color: '#342A45', marginBottom: 2 },
  progressSummaryText: { fontSize: 11.5, lineHeight: 18, color: '#675D7A' },
  goalBoard: { gap: 14 },
  goalCard: { backgroundColor: '#FFFFFF', borderRadius: 18, padding: 16, borderWidth: 1, borderColor: '#EDE7F5' },
  goalCardHeader: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12 },
  goalCardTitleWrap: { flex: 1, minWidth: 0, paddingRight: 10 },
  goalCardCategory: { fontSize: 10, textTransform: 'uppercase', letterSpacing: 1.1, color: '#7B6AE7', fontWeight: '800' },
  goalCardTitle: { fontSize: 16, fontWeight: '800', color: '#201A2A', marginTop: 6 },
  statusChip: { flexShrink: 0, maxWidth: 104, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 5 },
  statusChipGood: { backgroundColor: '#EAF9EF' },
  statusChipNeutral: { backgroundColor: '#F2EDFF' },
  statusChipText: { fontSize: 9.5, fontWeight: '800', textAlign: 'center' },
  statusTextGood: { color: '#1E8F52' },
  statusTextNeutral: { color: '#5B42D8' },
  cardDeleteButton: { width: 36, height: 36, borderRadius: 10, backgroundColor: '#FFF0F1', alignItems: 'center', justifyContent: 'center', marginLeft: 8 },
  progressMeta: { fontSize: 11, fontWeight: '700', color: '#7E708B', marginTop: 8, marginBottom: 12 },
  goalMetaRow: { flexDirection: 'row', justifyContent: 'space-between', marginBottom: 14 },
  metaItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  metaText: { fontSize: 11, color: '#716B7D', fontWeight: '700' },
  smallActionRow: { flexDirection: 'row', gap: 10 },
  savedStepsList: { gap: 8, marginBottom: 14 },
  savedStepRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 8 },
  savedStepCheck: { width: 18, height: 18, borderRadius: 6, borderWidth: 1, borderColor: '#CFC5DE', alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  savedStepCheckActive: { backgroundColor: '#2E9D5C', borderColor: '#2E9D5C' },
  savedStepText: { flex: 1, color: '#655F74', fontSize: 11.5, lineHeight: 17 },
  savedStepTextComplete: { color: '#2E9D5C', textDecorationLine: 'line-through' },
  smallButton: { flex: 1, borderRadius: 10, backgroundColor: '#F0EBF8', height: 38, alignItems: 'center', justifyContent: 'center' },
  smallButtonText: { color: '#4E3B8D', fontWeight: '800', fontSize: 12 },
  smallButtonPrimary: { flex: 1, borderRadius: 10, backgroundColor: '#5B42D8', height: 38, alignItems: 'center', justifyContent: 'center' },
  smallButtonPrimaryText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  deleteButton: { width: 40, borderRadius: 10, backgroundColor: '#FFECEE', height: 38, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#FFD3DA' },
  quickTipsCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 16, borderWidth: 1, borderColor: '#EDE7F5' },
  emptyStateCard: { backgroundColor: '#FFFFFF', borderRadius: 20, padding: 24, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#EDE7F5' },
  emptyIconWrap: { width: 54, height: 54, borderRadius: 18, backgroundColor: '#EEE8FF', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  emptyTitle: { fontWeight: '800', fontSize: 17, textAlign: 'center', color: '#201A2A', marginBottom: 6 },
  emptyBody: { fontFamily: 'System', fontSize: 12.5, lineHeight: 19, textAlign: 'center', color: '#665E74' },
  emptyStateButton: { minHeight: 44, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, backgroundColor: '#5B42D8', borderRadius: 12, paddingHorizontal: 16, marginTop: 16 },
  emptyStateButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  tipRow: { flexDirection: 'row', alignItems: 'center', marginTop: 12 },
  tipIcon: { width: 28, height: 28, borderRadius: 10, backgroundColor: '#EEE8FF', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  tipCopy: { flex: 1 },
  tipLabel: { fontSize: 12, fontWeight: '800', color: '#201A2A' },
  tipValue: { fontSize: 11, color: '#6A627B', marginTop: 3 },
  trackButtons: { flexDirection: 'row', gap: 10, marginTop: 14 },
  trackButton: { flex: 1, height: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  trackButtonSecondary: { backgroundColor: '#F0EBF8' },
  trackButtonPrimary: { backgroundColor: '#5B42D8' },
  trackButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 12 },
  trackButtonTextSecondary: { color: '#4E3B8D', fontWeight: '800', fontSize: 12 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(25, 18, 38, 0.58)', alignItems: 'center', justifyContent: 'center', padding: 24 },
  saveModal: { width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: 24, borderWidth: 1, borderColor: '#EEE8F8', padding: 24, alignItems: 'center', shadowColor: '#20152F', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  clearModal: { width: '100%', maxWidth: 360, backgroundColor: '#FFFFFF', borderRadius: 24, borderWidth: 2, borderColor: '#DCD2FF', padding: 24, alignItems: 'center', shadowColor: '#20152F', shadowOpacity: 0.2, shadowRadius: 24, shadowOffset: { width: 0, height: 10 }, elevation: 10 },
  clearModalIcon: { width: 48, height: 48, borderRadius: 16, backgroundColor: '#F0EBFF', alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  saveIconWrap: { width: 58, height: 58, borderRadius: 20, backgroundColor: '#5B42D8', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  saveModalTitle: { color: '#211B2C', fontSize: 21, fontWeight: '800', marginBottom: 8 },
  saveModalBody: { color: '#6B6377', fontSize: 13, lineHeight: 20, textAlign: 'center', maxWidth: 280 },
  saveModalActions: { flexDirection: 'row', width: '100%', gap: 10, marginTop: 22 },
  saveModalButton: { flex: 1, minHeight: 44, borderRadius: 12, alignItems: 'center', justifyContent: 'center', flexDirection: 'row', gap: 7 },
  saveModalSecondaryButton: { backgroundColor: '#F1EDF8' },
  saveModalPrimaryButton: { backgroundColor: '#5B42D8' },
  saveModalSecondaryText: { color: '#4E3B8D', fontSize: 12, fontWeight: '800' },
  saveModalPrimaryText: { color: '#FFFFFF', fontSize: 12, fontWeight: '800' },
  keepEditingButton: { backgroundColor: '#5B42D8', borderWidth: 1, borderColor: '#5B42D8' },
  keepEditingText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900' },
  clearDestructiveButton: { backgroundColor: '#FFF0F1', borderWidth: 1, borderColor: '#F2B7BF' },
  clearDestructiveText: { color: '#C53D53', fontSize: 12, fontWeight: '800' },
  undoSnackbar: { position: 'absolute', left: 16, right: 16, bottom: 24, minHeight: 52, borderRadius: 14, backgroundColor: '#30215A', flexDirection: 'row', alignItems: 'center', gap: 9, paddingHorizontal: 14, shadowColor: '#20152F', shadowOpacity: 0.2, shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8 },
  darkUndoSnackbar: { backgroundColor: '#4B32C0' },
  undoSnackbarText: { flex: 1, color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
  undoButtonText: { color: '#FFFFFF', fontSize: 12, fontWeight: '900', textDecorationLine: 'underline' },
  saveGoalButton: { marginTop: 4, minHeight: 50, borderRadius: 14 },
});

