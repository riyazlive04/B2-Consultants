import {
  Wallet,
  Landmark,
  PhoneCall,
  GitBranch,
  CalendarCheck,
  Users,
  GraduationCap,
  ClipboardList,
  Filter,
  FileSearch,
  Languages,
  Map,
  BookOpen,
  MessageCircle,
  Trophy,
  SlidersHorizontal,
  Target,
  Gift,
  Sparkles,
  BarChart3,
  Shield,
  LayoutGrid,
  type LucideIcon,
} from "lucide-react";
import type { SectionIconName } from "@/lib/sections";

/**
 * Icon name → component. Typed as a total Record over SECTION_ICON_NAMES, so adding
 * a name to that list without adding a component here is a build error rather than a
 * blank square in the founder's sidebar.
 */
export const SECTION_ICONS: Record<SectionIconName, LucideIcon> = {
  wallet: Wallet,
  landmark: Landmark,
  phone: PhoneCall,
  "git-branch": GitBranch,
  "calendar-check": CalendarCheck,
  users: Users,
  "graduation-cap": GraduationCap,
  "clipboard-list": ClipboardList,
  filter: Filter,
  "file-search": FileSearch,
  languages: Languages,
  map: Map,
  "book-open": BookOpen,
  "message-circle": MessageCircle,
  trophy: Trophy,
  sliders: SlidersHorizontal,
  target: Target,
  gift: Gift,
  sparkles: Sparkles,
  "bar-chart": BarChart3,
  shield: Shield,
  "layout-grid": LayoutGrid,
};

export const FallbackIcon = LayoutGrid;
