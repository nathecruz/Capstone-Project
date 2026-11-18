// Habi in 3D: the mood's animation (a still when small or with Reduce Motion), what it wears and
// holds over the picture, and the cheer it plays once when `cheer` goes up.
import { act, render } from '@testing-library/react-native';
import React from 'react';
import { AccessibilityInfo } from 'react-native';
import { BuddyAvatar, CHEER_MS } from '@/components/buddy';
import type { Buddy } from '@/utils/buddy';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));
jest.mock('expo-router', () => ({ router: { push: jest.fn() } }));
jest.mock('@react-native-async-storage/async-storage', () => jest.requireActual('@react-native-async-storage/async-storage/jest/async-storage-mock'));
jest.mock('@/hooks/color-scheme-context', () => ({ useAppColorScheme: () => ({ streakFreeze: null }) }));
jest.mock('@/hooks/use-buddy', () => ({ useBuddy: () => ({ buddy: null }) }));

// The Reduce Motion listener the avatar subscribes to, so a test can turn it on and off.
let reduceMotion: (enabled: boolean) => void = () => undefined;
jest.spyOn(AccessibilityInfo, 'addEventListener').mockImplementation(((_event: string, handler: (enabled: boolean) => void) => {
  reduceMotion = handler;
  return { remove: () => undefined };
}) as unknown as typeof AccessibilityInfo.addEventListener);

const buddy: Buddy = {
  name: 'Mochi', head: 'crown', hand: 'cookie', accessory: 'scarf', room: 'garden', owned: ['crown', 'cookie', 'scarf', 'garden'], checkIns: 160,
  items: [
    { id: 'crown', slot: 'head', name: 'Crown', emoji: '👑', cost: 300, stage: 'champ' },
    { id: 'cookie', slot: 'hand', name: 'Cookie', emoji: '🍪', cost: 45, stage: 'baby' },
    { id: 'scarf', slot: 'accessory', name: 'Scarf', emoji: '🧣', cost: 50, stage: 'baby' },
    { id: 'garden', slot: 'room', name: 'Garden', emoji: '🌳', cost: 60, stage: 'baby' },
  ],
  stages: [{ id: 'baby', name: 'Baby', min: 0 }, { id: 'kid', name: 'Kid', min: 10 }, { id: 'teen', name: 'Teen', min: 50 }, { id: 'champ', name: 'Champ', min: 150 }, { id: 'legend', name: 'Legend', min: 400 }],
  treats: [], fedTreats: [], treatsFed: 0,
};

/** The file the 3D picture shows (jest gives a bundled asset its path). */
const picture = (screen: ReturnType<typeof render>) => String(screen.getByTestId('buddy-picture').props.source?.[0]?.testUri ?? '');

afterEach(() => {
  act(() => reduceMotion(false));
  jest.useRealTimers();
});

describe('BuddyAvatar', () => {
  it("plays the mood's 3D animation, with what Habi wears and holds", () => {
    const screen = render(<BuddyAvatar buddy={buddy} checkIns={160} mood="sleepy" size={170} />);
    expect(picture(screen)).toContain('habi-sleepy.webp');
    for (const emoji of ['👑', '🍪', '🧣', '😴']) expect(screen.getByText(emoji)).toBeTruthy();
    expect(screen.getByLabelText('Mochi, feeling sleepy')).toBeTruthy();
    screen.rerender(<BuddyAvatar buddy={buddy} checkIns={160} mood="ecstatic" size={170} />);
    expect(picture(screen)).toContain('habi-ecstatic.webp');
  });

  it('keeps small ones still and without the mood bubble', () => {
    const tile = render(<BuddyAvatar buddy={buddy} checkIns={160} mood="happy" size={40} />);
    expect(picture(tile)).toContain('habi-happy-still.webp');
    expect(tile.getByText('😊')).toBeTruthy();
    const row = render(<BuddyAvatar buddy={buddy} checkIns={160} mood="happy" size={28} />);
    expect(picture(row)).toContain('habi-happy-still.webp');
    expect(row.queryByText('😊')).toBeNull();
  });

  it('hops and waves once each time `cheer` goes up, then goes back to its mood', () => {
    jest.useFakeTimers();
    const screen = render(<BuddyAvatar buddy={buddy} checkIns={160} mood="happy" size={170} cheer={0} />);
    expect(picture(screen)).toContain('habi-happy.webp');
    screen.rerender(<BuddyAvatar buddy={buddy} checkIns={160} mood="happy" size={170} cheer={1} />);
    expect(picture(screen)).toContain('habi-cheer.webp');
    act(() => jest.advanceTimersByTime(CHEER_MS));
    expect(picture(screen)).toContain('habi-happy.webp');
    // Going down (an undone quest) is no reason to cheer.
    screen.rerender(<BuddyAvatar buddy={buddy} checkIns={160} mood="happy" size={170} cheer={0} />);
    expect(picture(screen)).toContain('habi-happy.webp');
  });

  it('stays still with Reduce Motion, and does not cheer', () => {
    const screen = render(<BuddyAvatar buddy={buddy} checkIns={160} mood="hungry" size={170} cheer={0} />);
    expect(picture(screen)).toContain('habi-hungry.webp');
    act(() => reduceMotion(true));
    expect(picture(screen)).toContain('habi-hungry-still.webp');
    screen.rerender(<BuddyAvatar buddy={buddy} checkIns={160} mood="hungry" size={170} cheer={1} />);
    expect(picture(screen)).toContain('habi-hungry-still.webp');
  });
});
