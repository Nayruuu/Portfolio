export interface Comment {
  who: string;
  tag: string;
  color: string;
  when: string;
  body: string;
  likes: number;
  pinned?: boolean;
}
