// A circular progress ring drawn with plain views (no SVG): two clipped half discs turn to show
// the filled part, and an inner disc in the card's colour makes it a ring. Anything passed as
// children sits in the middle.
import React from 'react';
import { View } from 'react-native';

type Props = {
  /** 0-100. */
  value: number;
  size: number;
  thickness: number;
  color: string;
  trackColor: string;
  /** The colour behind the ring, for its middle. */
  innerColor: string;
  children?: React.ReactNode;
};

export function ProgressRing({ value, size, thickness, color, trackColor, innerColor, children }: Props) {
  const degrees = (Math.min(100, Math.max(0, value)) / 100) * 360;
  const half = size / 2;
  const disc = { position: 'absolute' as const, top: 0, width: size, height: size };
  return (
    <View style={{ width: size, height: size }}>
      <View style={[disc, { left: 0, borderRadius: half, backgroundColor: trackColor }]} />
      {/* Right half: the first 180 degrees, from 12 o'clock. */}
      <View style={{ position: 'absolute', top: 0, left: half, width: half, height: size, overflow: 'hidden' }}>
        <View style={[disc, { left: -half, transform: [{ rotate: `${Math.min(degrees, 180)}deg` }] }]}>
          <View style={{ width: half, height: size, borderTopLeftRadius: half, borderBottomLeftRadius: half, backgroundColor: degrees > 0 ? color : 'transparent' }} />
        </View>
      </View>
      {/* Left half: the rest, from 6 o'clock. */}
      <View style={{ position: 'absolute', top: 0, left: 0, width: half, height: size, overflow: 'hidden' }}>
        <View style={[disc, { left: 0, transform: [{ rotate: `${Math.max(0, degrees - 180)}deg` }] }]}>
          <View style={{ marginLeft: half, width: half, height: size, borderTopRightRadius: half, borderBottomRightRadius: half, backgroundColor: degrees > 180 ? color : 'transparent' }} />
        </View>
      </View>
      <View style={{ position: 'absolute', top: thickness, left: thickness, width: size - thickness * 2, height: size - thickness * 2, borderRadius: half - thickness, backgroundColor: innerColor, alignItems: 'center', justifyContent: 'center' }}>
        {children}
      </View>
    </View>
  );
}
