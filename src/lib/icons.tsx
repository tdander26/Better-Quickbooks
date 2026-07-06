// Maps the kebab-case icon names stored on categories (e.g. "credit-card") to
// lucide-react components, so category icons render as icons instead of raw
// text. Add new entries here as categories gain icons.
import {
  Stethoscope,
  Briefcase,
  Percent,
  PlusCircle,
  Users,
  Building,
  Cross,
  Paperclip,
  Monitor,
  Shield,
  Zap,
  Utensils,
  Plane,
  Scale,
  GraduationCap,
  CreditCard,
  Landmark,
  Car,
  Megaphone,
  HelpCircle,
  ArrowUpCircle,
  ArrowDownCircle,
  Repeat,
  Tag,
  type LucideIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  stethoscope: Stethoscope,
  briefcase: Briefcase,
  percent: Percent,
  "plus-circle": PlusCircle,
  users: Users,
  building: Building,
  cross: Cross,
  paperclip: Paperclip,
  monitor: Monitor,
  shield: Shield,
  zap: Zap,
  utensils: Utensils,
  plane: Plane,
  scale: Scale,
  "graduation-cap": GraduationCap,
  "credit-card": CreditCard,
  landmark: Landmark,
  car: Car,
  megaphone: Megaphone,
  "help-circle": HelpCircle,
  "arrow-up-circle": ArrowUpCircle,
  "arrow-down-circle": ArrowDownCircle,
  repeat: Repeat,
};

/** The list of icon names available to the category editor. */
export const CATEGORY_ICON_NAMES = Object.keys(ICONS);

export function categoryIcon(name: string | null | undefined): LucideIcon {
  return (name && ICONS[name]) || Tag;
}

export function CategoryIcon({
  name,
  size = 16,
  className,
}: {
  name: string | null | undefined;
  size?: number;
  className?: string;
}) {
  const Icon = categoryIcon(name);
  return <Icon size={size} className={className} />;
}
