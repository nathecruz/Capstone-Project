import React, { useEffect, useState } from 'react';
import { Animated, Easing, Platform, type ViewStyle } from 'react-native';

/**
 * A gentle fade + slide-up entrance for screen content. Deliberately subtle — short and small —
 * so the app feels alive without being distracting. `delay` lets a few elements stagger in.
 */
export function FadeIn({ children, delay = 0, offset = 12, duration = 420, style }: {
  children: React.ReactNode;
  delay?: number;
  offset?: number;
  duration?: number;
  style?: ViewStyle;
}) {
  const [anim] = useState(() => new Animated.Value(0));
  useEffect(() => {
    const animation = Animated.timing(anim, { toValue: 1, duration, delay, easing: Easing.out(Easing.cubic), useNativeDriver: Platform.OS !== 'web' });
    animation.start();
    return () => animation.stop();
  }, [anim, delay, duration]);
  return (
    <Animated.View style={[style, { opacity: anim, transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [offset, 0] }) }] }]}>
      {children}
    </Animated.View>
  );
}
