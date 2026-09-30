import {
  Activity, Bike, BookOpen, Briefcase, Brush, Calculator, Circle, Clock, Code, Coffee, Droplet, Dumbbell, Ellipsis, FlaskConical,
  Footprints, Globe, GraduationCap, Heart, House, Languages, Leaf, Lightbulb, LocateFixed, MessagesSquare, Moon, Music, Orbit,
  Smile, Star, Stethoscope, Sun, Users, Utensils, Wallet, type LucideIcon,
} from 'lucide-react';

// Web previews for the Ionicons names the HabitAI mobile app renders.
const ICONS: Record<string, { icon: LucideIcon; label: string }> = {
  'heart-outline': { icon: Heart, label: 'Heart' },
  'bulb-outline': { icon: Lightbulb, label: 'Light bulb' },
  'locate-outline': { icon: LocateFixed, label: 'Target' },
  'leaf-outline': { icon: Leaf, label: 'Leaf' },
  'school-outline': { icon: GraduationCap, label: 'School' },
  'ellipsis-horizontal': { icon: Ellipsis, label: 'More' },
  'barbell-outline': { icon: Dumbbell, label: 'Barbell' },
  'fitness-outline': { icon: Activity, label: 'Fitness' },
  'walk-outline': { icon: Footprints, label: 'Walk' },
  'bicycle-outline': { icon: Bike, label: 'Bicycle' },
  'water-outline': { icon: Droplet, label: 'Water' },
  'restaurant-outline': { icon: Utensils, label: 'Meals' },
  'cafe-outline': { icon: Coffee, label: 'Cafe' },
  'moon-outline': { icon: Moon, label: 'Sleep' },
  'sunny-outline': { icon: Sun, label: 'Sun' },
  'medkit-outline': { icon: Stethoscope, label: 'Medical' },
  'book-outline': { icon: BookOpen, label: 'Book' },
  'code-slash-outline': { icon: Code, label: 'Code' },
  'calculator-outline': { icon: Calculator, label: 'Calculator' },
  'flask-outline': { icon: FlaskConical, label: 'Science' },
  'language-outline': { icon: Languages, label: 'Language' },
  'briefcase-outline': { icon: Briefcase, label: 'Work' },
  'time-outline': { icon: Clock, label: 'Time' },
  'wallet-outline': { icon: Wallet, label: 'Wallet' },
  'people-outline': { icon: Users, label: 'People' },
  'chatbubbles-outline': { icon: MessagesSquare, label: 'Chat' },
  'home-outline': { icon: House, label: 'Home' },
  'musical-notes-outline': { icon: Music, label: 'Music' },
  'brush-outline': { icon: Brush, label: 'Art' },
  'happy-outline': { icon: Smile, label: 'Happiness' },
  'globe-outline': { icon: Globe, label: 'Globe' },
  'star-outline': { icon: Star, label: 'Star' },
  'planet-outline': { icon: Orbit, label: 'Planet' },
};

export function iconLabel(name: string) {
  return ICONS[name]?.label ?? name;
}

export function CategoryIcon({ name, color, size = 36 }: { name: string; color: string; size?: number }) {
  const Icon = ICONS[name]?.icon ?? Circle;
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-lg"
      style={{ width: size, height: size, background: `color-mix(in srgb, ${color} 16%, transparent)`, color }}
      aria-hidden
    >
      <Icon style={{ width: size * 0.5, height: size * 0.5 }} strokeWidth={2} />
    </span>
  );
}
