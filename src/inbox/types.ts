export interface EmailMessage {
  subject: string;
  text: string;
  links: string[];
}

export interface Inbox {
  /** Most recent messages for an address, newest first. */
  latest(address: string): Promise<EmailMessage[]>;
}
