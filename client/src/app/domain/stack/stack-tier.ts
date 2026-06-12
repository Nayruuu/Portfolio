import { StackTech } from './stack-tech';

export interface StackTier {
  tierName: string;
  tierSubtitle: string;
  color: string;
  techs: StackTech[];
}
