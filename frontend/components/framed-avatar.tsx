// Profile Frames (a token reward): a two-colour ring and a small emblem around the student's
// photo. Shown on the profile, on Home and on the leaderboard, where other students see it too.
import React from 'react';
import { Text, View } from 'react-native';

export const PROFILE_FRAMES = [
  { id: 'gold', name: 'Gold', outer: '#E9B526', inner: '#FFF0B3', emblem: '✨' },
  { id: 'neon', name: 'Neon', outer: '#D946EF', inner: '#22D3EE', emblem: '⚡' },
  { id: 'leaf', name: 'Leaf', outer: '#2E9D5C', inner: '#BDE8C9', emblem: '🌿' },
  { id: 'fire', name: 'Fire', outer: '#F0612D', inner: '#FBC24B', emblem: '🔥' },
] as const;

/**
 * `children` (the avatar, `size` across) inside the frame; without a frame, the avatar as it is.
 * The frame adds about a fifth of `size` around it.
 */
export function FramedAvatar({ frame, size, children }: { frame?: string; size: number; children: React.ReactNode }) {
  const look = PROFILE_FRAMES.find((item) => item.id === frame);
  if (!look) return <>{children}</>;
  const ring = Math.max(2, Math.round(size * 0.06));
  const outerSize = size + ring * 4;
  return (
    <View style={{ width: outerSize, height: outerSize, borderRadius: outerSize / 2, borderWidth: ring, borderColor: look.outer, alignItems: 'center', justifyContent: 'center' }} accessibilityLabel={`${look.name} frame`}>
      <View style={{ width: size + ring * 2, height: size + ring * 2, borderRadius: (size + ring * 2) / 2, borderWidth: ring, borderColor: look.inner, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' }}>
        {children}
      </View>
      {size >= 30 && <Text style={{ position: 'absolute', left: -ring, bottom: -ring, fontSize: Math.max(12, Math.round(size * 0.26)) }}>{look.emblem}</Text>}
    </View>
  );
}
