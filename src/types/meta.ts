/**
 * Meta/WhatsApp webhook types.
 */

/** Supported WhatsApp message types */
export type MessageType =
  | 'text'
  | 'audio'
  | 'image'
  | 'document'
  | 'sticker'
  | 'location'
  | 'contacts'
  | 'interactive'
  | 'button'
  | 'unknown';

/** Parsed incoming message with all relevant fields extracted */
export interface IncomingMessage {
  userId: string;
  messageId: string;
  messageType: MessageType;
  timestamp: number;
  text: string;
  mediaId?: string | undefined;
}

/** Raw message from Meta webhook */
export interface RawMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: { body: string };
  audio?: { id: string };
  interactive?: {
    button_reply?: { title: string };
    list_reply?: { title: string };
  };
  button?: { text: string };
}

/** Contact info from Meta webhook */
export interface Contact {
  wa_id: string;
  profile?: { name: string };
}

/** Webhook value containing messages */
export interface WebhookValue {
  messaging_product: string;
  metadata: { display_phone_number: string; phone_number_id: string };
  contacts?: Contact[];
  messages?: RawMessage[];
}

/** Change entry in webhook */
export interface WebhookChange {
  field: string;
  value: WebhookValue;
}

/** Single entry in webhook payload */
export interface WebhookEntry {
  id: string;
  changes: WebhookChange[];
}

/** Full webhook payload from Meta */
export interface WebhookPayload {
  object: string;
  entry: WebhookEntry[];
}
