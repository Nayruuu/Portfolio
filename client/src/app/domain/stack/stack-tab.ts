import { StackTier } from './stack-tier';

export interface StackTab {
  heading: string;
  subtitle: string;
  techs: string;
  levels: StackTier[];
}
