import { AboutDetail } from './about-detail';
import { AboutLink } from './about-link';

export interface About {
  heading: string;
  subtitle: string;
  infoLabel: string;
  linksLabel: string;
  paragraphs: string[];
  details: AboutDetail[];
  links: AboutLink[];
}
