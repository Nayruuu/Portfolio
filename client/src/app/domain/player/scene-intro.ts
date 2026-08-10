import { Metric } from './metric';

export interface SceneIntro {
  hi: string;
  name: string;
  role: string;
  tagline: string;
  tags: string[];
  metrics: Metric[];
}
