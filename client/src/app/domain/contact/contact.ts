import { ContactMethod } from './contact-method';
import { FormLabels } from './form-labels';

export interface Contact {
  heading: string;
  subtitle: string;
  responseTime: string;
  responseTimeLabel: string;
  composeNew: string;
  orVia: string;
  otherChannels: string;
  pgp: string;
  messagePlaceholder: string;
  formLabels: FormLabels;
  subjects: string[];
  altMethods: ContactMethod[];
}
