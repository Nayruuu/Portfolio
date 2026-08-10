import { AboutDetail } from './about-detail';
import { AboutLink } from './about-link';
import { Realisations } from './realisations';

export interface About {
  heading: string;
  subtitle: string;
  infoLabel: string;
  linksLabel: string;
  paragraphs: string[];
  details: AboutDetail[];
  links: AboutLink[];
  realisations: Realisations;
}
