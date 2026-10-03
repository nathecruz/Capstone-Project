// A short burst of falling confetti for celebrations. Plain Animated views, so it runs on the web
// and on phones without extra libraries; it ignores touches.
import React, { useEffect, useMemo, useState } from 'react';
import { Animated, Easing, Platform, StyleSheet, useWindowDimensions, View } from 'react-native';

const COLORS = ['#5B42D8', '#8B78E8', '#F2A93B', '#3BAA74', '#E58D8D', '#4BA3FF'];
const PIECES = 36;

function makePieces(burstKey: string | number, width: number) {
  let seed = String(burstKey).split('').reduce((sum, char) => sum + char.charCodeAt(0), 7);
  const random = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
  return Array.from({ length: PIECES }, (_, index) => ({
    key: index,
    left: random() * width,
    drift: (random() - 0.5) * 120,
    delay: random() * 0.25,
    size: 6 + random() * 6,
    turns: 1 + random() * 3,
    color: COLORS[index % COLORS.length],
    round: random() > 0.6,
  }));
}

export function Confetti({ burstKey }: { burstKey: string | number }) {
  const { width, height } = useWindowDimensions();
  const [progress] = useState(() => new Animated.Value(0));
  // A fresh, fixed layout per burst (seeded by the key, so a re-render does not move pieces).
  const pieces = useMemo(() => makePieces(burstKey, width), [burstKey, width]);

  useEffect(() => {
    progress.setValue(0);
    Animated.timing(progress, { toValue: 1, duration: 2200, easing: Easing.out(Easing.quad), useNativeDriver: Platform.OS !== 'web' }).start();
  }, [burstKey, progress]);

  return (
    <View pointerEvents="none" style={StyleSheet.absoluteFill}>
      {pieces.map((piece) => {
        const local = progress.interpolate({ inputRange: [piece.delay, 1], outputRange: [0, 1], extrapolate: 'clamp' });
        return (
          <Animated.View
            key={piece.key}
            style={{
              position: 'absolute',
              top: -20,
              left: piece.left,
              width: piece.size,
              height: piece.round ? piece.size : piece.size * 1.6,
              borderRadius: piece.round ? piece.size / 2 : 2,
              backgroundColor: piece.color,
              opacity: local.interpolate({ inputRange: [0, 0.85, 1], outputRange: [1, 1, 0] }),
              transform: [
                { translateY: local.interpolate({ inputRange: [0, 1], outputRange: [0, height * 0.75] }) },
                { translateX: local.interpolate({ inputRange: [0, 1], outputRange: [0, piece.drift] }) },
                { rotate: local.interpolate({ inputRange: [0, 1], outputRange: ['0deg', `${piece.turns * 360}deg`] }) },
              ],
            }}
          />
        );
      })}
    </View>
  );
}
